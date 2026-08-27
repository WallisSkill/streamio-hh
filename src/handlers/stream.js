import { CONFIG } from '../config.js';
import kkphim from '../sources/kkphim.js';
import ophim from '../sources/ophim.js';
import nguonc from '../sources/nguonc.js';
import * as hh3d from '../sources/hh3d.js';
import { getCinemeta, buildEpisodeIndex, getAliases, getKitsuMeta } from '../lib/meta.js';
import { filterCandidates } from '../lib/match.js';
import { resolveEpisode } from '../lib/episodeMap.js';
import { baseTitle } from '../lib/text.js';
import { getOverride } from '../lib/overrides.js';
import { unwrapEmbed, embedFetchable } from '../lib/embed.js';

/** API sources that publish playable links openly. Order = display order. */
function apiSources() {
  return [
    CONFIG.enableKkphim ? kkphim : null,
    CONFIG.enableOphim ? ophim : null,
    CONFIG.enableNguonc ? nguonc : null,
  ].filter(Boolean);
}

/** `tt123`, `tt123:2:5`, `kitsu:456`, `kitsu:456:7` */
export function parseId(type, rawId) {
  // Stremio ids are already safe, but a hand-typed URL can carry a stray '%'
  // and decodeURIComponent throws on those.
  let id;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    id = String(rawId);
  }
  id = id.replace(/[.]json$/, '');
  const kitsu = /^kitsu:(\d+)(?::(\d+))?(?::(\d+))?$/.exec(id);
  if (kitsu) {
    const [, kid, a, b] = kitsu;
    const season = b ? Number(a) : 1;
    const episode = b ? Number(b) : a ? Number(a) : null;
    return { baseId: `kitsu:${kid}`, kitsuId: kid, imdbId: null, season, episode, type };
  }
  const imdb = /^(tt\d+)(?::(\d+):(\d+))?$/.exec(id);
  if (imdb) {
    const [, ttId, s, e] = imdb;
    return {
      baseId: ttId,
      imdbId: ttId,
      kitsuId: null,
      season: s ? Number(s) : null,
      episode: e ? Number(e) : null,
      type,
    };
  }
  return null;
}

/** Identity + official numbering of what the user is looking at in Stremio. */
async function resolveTarget(parsed) {
  const override = getOverride(parsed.baseId, parsed.season);
  if (parsed.imdbId) {
    const meta = await getCinemeta(parsed.type === 'movie' ? 'movie' : 'series', parsed.imdbId);
    if (!meta) return null;
    const aliases = await getAliases(meta.name, meta.year);
    return {
      name: meta.name,
      year: meta.year ? Number(String(meta.year).slice(0, 4)) : null,
      imdbId: parsed.imdbId,
      tmdbId: meta.moviedb_id ? String(meta.moviedb_id) : null,
      titles: [...new Set([meta.name, ...(override?.titles || []), ...aliases])],
      index: parsed.type === 'series' ? buildEpisodeIndex(meta) : null,
      override,
    };
  }
  const k = await getKitsuMeta(parsed.kitsuId);
  if (!k) return null;
  return {
    name: k.name,
    year: k.year,
    imdbId: null,
    tmdbId: null,
    titles: [...new Set([k.name, ...(override?.titles || []), ...k.titles])],
    index: null,
    override,
  };
}

/** VN sites title seasons inline, so ask for them by name too. */
function buildQueries(target, season) {
  const q = new Set();
  for (const t of target.titles.slice(0, 6)) {
    if (!t) continue;
    q.add(t);
    q.add(baseTitle(t));
  }
  if (season && season > 1) {
    for (const t of target.titles.slice(0, 3)) {
      const b = baseTitle(t);
      if (b) {
        q.add(`${b} phan ${season}`);
        q.add(`${b} ${season}`);
      }
    }
  }
  return [...q].filter(Boolean).slice(0, 10);
}

async function gatherFrom(source, target, season) {
  const seen = new Map();
  const results = await Promise.all(buildQueries(target, season).map((q) => source.search(q, 20)));
  for (const list of results) for (const c of list) if (!seen.has(c.slug)) seen.set(c.slug, c);
  return [...seen.values()];
}

/**
 * Choose the entry that covers the requested season.
 *
 * Order matters: first narrow to the right SHOW, then to the right season.
 * A different show carrying the requested season number must never displace an
 * id-confirmed match (KKPhim lists a live-action One Piece as 'Phần 2'), while
 * seasons of the same show must stay reachable even when only some entries
 * carry the shared series-level IMDb id.
 */
function pickEntry(scored, season) {
  if (!scored.length) return null;
  const top = scored[0];
  if (season == null) return top;

  const bySeason = (list) =>
    list.find((s) => s.candidate.season != null && Number(s.candidate.season) === Number(season));

  const idMatched = scored.filter((s) => s.exactId);
  const pool = idMatched.length ? idMatched : scored;

  const hit = bySeason(pool);
  if (hit) return hit;

  if (idMatched.length) {
    const fam = baseTitle(idMatched[0].candidate.name);
    const relatives = scored.filter((s) => !s.exactId && baseTitle(s.candidate.name) === fam);
    const relHit = bySeason(relatives);
    if (relHit) return relHit;
  }

  return pool.find((s) => s.candidate.season == null) || pool[0];
}

/**
 * The entries worth trying on a source, best first.
 *
 * One pick is not enough, because whether an entry can serve the requested
 * episode is only knowable after its episode list is fetched. Nguồn C carries
 * Swallowed Star as both a 26-episode season 1 and a 212-episode merged entry,
 * and the exact title belongs to the short one — so S4E56 has to be allowed to
 * fall through to the entry behind it instead of coming back empty.
 */
async function shortlistFor(source, target, parsed, wantType, limit = 3) {
  const pin = target.override?.[source.id];
  if (pin) return [{ candidate: { slug: pin }, via: 'override' }];

  const candidates = await gatherFrom(source, target, parsed.season);
  const scored = filterCandidates(candidates, target, wantType);
  const best = pickEntry(scored, parsed.season);
  if (!best) return [];
  return [best, ...scored.filter((s) => s !== best)].slice(0, limit);
}

/**
 * Resolve one API source into playable streams.
 * The extra detail() calls only happen on the path that used to return
 * nothing, so a source that matches on its first pick costs exactly as before.
 */
async function streamsFrom(source, target, parsed, wantType, dbg, baseUrl) {
  const tried = [];

  for (const pick of await shortlistFor(source, target, parsed, wantType)) {
    const entry = await source.detail(pick.candidate.slug);
    if (!entry) continue;

    dbg.picked = {
      slug: pick.candidate.slug,
      via: pick.via,
      score: pick.score,
      reasons: pick.reasons,
      season: pick.candidate.season,
    };

    const out = streamsFromEntry(entry, source, target, parsed, wantType, dbg, baseUrl);
    if (out.length) {
      if (tried.length) dbg.tried = tried;
      return out;
    }
    tried.push({ slug: pick.candidate.slug, why: dbg.decision?.note || 'không có tập nào khớp' });
  }

  if (tried.length) dbg.tried = tried;
  return [];
}

/** Build the stream list out of one entry whose episodes are already loaded. */
function streamsFromEntry(entry, source, target, parsed, wantType, dbg, baseUrl) {
  const out = [];
  for (const server of entry.servers) {
    if (!server.episodes.length) continue;

    const picked =
      wantType === 'movie'
        ? { episode: server.episodes[0], decision: { mode: 'movie', confidence: 'high', note: 'Phim lẻ' } }
        : resolveEpisode({
            entry,
            server,
            season: parsed.season ?? 1,
            episode: (parsed.episode ?? 1) + (target.override?.offset || 0),
            index: target.index,
          });

    dbg.decision = picked.decision;
    if (!picked.episode) continue;

    // An embed link is an HTML page and Stremio's player only takes a media
    // track. Most player pages carry that track in their own query string
    // (player.phimapi.com/player/?url=<m3u8>), which costs nothing to read; the
    // rest are deferred to /resolve so the page is fetched when the user hits
    // play, not once per server while the list is being built.
    const embed = picked.episode.embed || null;
    const direct = picked.episode.m3u8 || unwrapEmbed(embed);
    const lazy =
      !direct && embed && baseUrl && !source.linkOnly && embedFetchable(embed)
        ? `${baseUrl}/resolve?u=${encodeURIComponent(embed)}`
        : null;
    const url = direct || lazy;
    if (!url && !embed) continue;

    const warn = picked.decision.confidence === 'low' ? ' ⚠️' : '';
    const quality = entry.quality ? `${entry.quality} · ${entry.lang}` : '';
    const title = [entry.name, `▶ ${picked.episode.label}${warn}`, picked.decision.note, quality]
      .filter(Boolean)
      .join('\n');
    const name = `${source.label}${warn}\n${server.name}`;

    // Nothing playable came out of the embed — hand over the publisher's own
    // player page as a link rather than asking Stremio to play markup.
    if (!url) {
      out.push({ name, title: `${title}\n↗ Mở trên ${source.label}`, externalUrl: embed });
      continue;
    }

    out.push({
      name,
      title: direct ? title : `${title}\n⟳ Lấy link lúc bấm phát`,
      url,
      behaviorHints: {
        notWebReady: !/[.]m3u8([?]|$)/i.test(url),
        bingeGroup: `${source.id}-${entry.slug}-${server.name}`,
      },
    });
  }
  return out;
}

/**
 * HH3D as an external link.
 *
 * Only the episode permalink is produced — the stream URL sits behind HH3D's
 * keyed player endpoint, which this addon does not attempt to defeat.
 * Discovery reads the public listing pages when the site is reachable; a slug
 * pinned in overrides.json keeps working when it is not.
 */
async function hh3dStream(target, parsed, dbg) {
  if (!CONFIG.enableHh3d || parsed.season == null) return [];

  let entry = null;
  const pin = target.override?.hh3d;

  if (pin) {
    entry = (await hh3d.detail(pin)) || { slug: pin, name: target.name, season: null, maxEpisode: 0, servers: [] };
  } else {
    const candidates = [];
    for (const q of buildQueries(target, parsed.season).slice(0, 2)) {
      candidates.push(...(await hh3d.search(q)));
    }
    const scored = filterCandidates(candidates, target, 'series');
    const best = pickEntry(scored, parsed.season);
    if (!best) return [];
    dbg.picked = { slug: best.candidate.slug, score: best.score, season: best.candidate.season };
    entry = await hh3d.detail(best.candidate.slug);
  }
  if (!entry) return [];

  const server = entry.servers?.[0];

  // Episode list read from the site -> map it like any other source.
  if (server?.episodes?.length) {
    const picked = resolveEpisode({
      entry,
      server,
      season: parsed.season,
      episode: (parsed.episode ?? 1) + (target.override?.offset || 0),
      index: target.index,
    });
    dbg.decision = picked.decision;
    if (!picked.episode) return [];
    return [
      {
        name: 'HH3D\nMở trang',
        title: [entry.name, `▶ Tập ${picked.episode.num}`, picked.decision.note, 'Mở trên hoathinh3d']
          .filter(Boolean)
          .join('\n'),
        externalUrl: picked.episode.page,
      },
    ];
  }

  // Pinned slug while the site is unreachable -> build the permalink directly.
  if (!pin) return [];
  let epNum =
    target.override?.mode === 'absolute' && target.index
      ? target.index.absolute(parsed.season, parsed.episode ?? 1) ?? parsed.episode ?? 1
      : parsed.episode ?? 1;
  epNum += target.override?.offset || 0;
  dbg.decision = { mode: 'pinned', target: epNum, confidence: 'medium', note: 'Dựng link từ slug đã ghim' };
  return [
    {
      name: 'HH3D\nMở trang',
      title: [target.name, `▶ Tập ${epNum}`, 'Mở trên hoathinh3d'].join('\n'),
      externalUrl: `${CONFIG.hh3dBase}/xem-phim-${entry.slug}/tap-${epNum}-sv1.html`,
    },
  ];
}

export async function getStreams(type, rawId, { baseUrl = '' } = {}) {
  const parsed = parseId(type, rawId);
  if (!parsed) return { streams: [] };

  const target = await resolveTarget(parsed);
  if (!target) return { streams: [] };

  const wantType = type === 'movie' ? 'movie' : 'series';
  const debug = { id: rawId, name: target.name, sources: {} };

  /** One dead source must never take the whole response down. */
  const guard = async (key, fn) => {
    const dbg = {};
    debug.sources[key] = dbg;
    try {
      return await fn(dbg);
    } catch (err) {
      dbg.error = err.message;
      return [];
    }
  };

  const jobs = apiSources().map((source) =>
    guard(source.id, (dbg) => streamsFrom(source, target, parsed, wantType, dbg, baseUrl)),
  );

  if (wantType === 'series') {
    jobs.push(guard('hh3d', (dbg) => hh3dStream(target, parsed, dbg)));
  }

  const streams = (await Promise.all(jobs)).flat();
  return { streams, debug };
}
