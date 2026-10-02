import { CONFIG } from '../config.js';
import kkphim from '../sources/kkphim.js';
import ophim from '../sources/ophim.js';
import nguonc from '../sources/nguonc.js';
import * as hh3d from '../sources/hh3d.js';
import { getCinemeta, buildEpisodeIndex, getAliases, getKitsuMeta } from '../lib/meta.js';
import { filterCandidates } from '../lib/match.js';
import { resolveEpisode } from '../lib/episodeMap.js';
import { baseTitle, titleHead } from '../lib/text.js';
import { getOverride } from '../lib/overrides.js';
import { unwrapEmbed, embedFetchable } from '../lib/embed.js';
import { isStreamc } from '../lib/streamc.js';
import { hh3dBase } from '../lib/hh3dBase.js';
import { playlistFor as hh3dPlaylist } from '../lib/hh3dPlayer.js';
import { MANIFEST } from '../manifest.js';

/**
 * Tên thương hiệu đứng đầu mỗi dòng stream trong Stremio.
 *
 * Danh sách stream của một tập trộn lẫn kết quả từ nhiều addon, nên phải nhìn
 * ra ngay dòng nào là của addon này. Lấy thẳng từ manifest để đổi tên một chỗ
 * là đổi khắp nơi, không sót dòng nào mang tên cũ.
 */
const BRAND = MANIFEST.name;

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
  // Gộp theo bản đã bỏ hoa/thường. baseTitle() viết thường mọi thứ, nên mỗi
  // tên gốc viết hoa sinh thêm một truy vấn gần như trùng — "Swallowed Star"
  // và "swallowed star" trả về cùng một kết quả, hỏi cả hai là tự nhân đôi số
  // request. Đo trên Thôn Phệ Tinh Không: 11 truy vấn còn 7.
  const seen = new Map();
  const add = (value) => {
    const text = String(value || '').trim();
    const key = text.toLowerCase();
    if (text && !seen.has(key)) seen.set(key, text);
  };

  for (const t of target.titles.slice(0, 6)) {
    if (!t) continue;
    add(t);
    add(baseTitle(t));
    // Subtitles are where translations disagree, so the name in front of the
    // colon is the part a VN site is most likely to have written the same way.
    add(titleHead(t));
  }
  if (season && season > 1) {
    for (const t of target.titles.slice(0, 3)) {
      const b = baseTitle(t);
      if (b) {
        add(`${b} phan ${season}`);
        add(`${b} ${season}`);
      }
    }
  }
  return [...seen.values()].slice(0, CONFIG.maxQueries);
}

/**
 * Run tasks with at most `limit` of them in flight.
 *
 * Firing every query at once is free on a source that does not count them, and
 * fatal on one that does: nguonc answers 429 to a burst of six searches from
 * the same caller, and the addon then reports "no match" for a film the source
 * has. Sources that need pacing say so with `searchConcurrency`.
 */
async function pooled(tasks, limit) {
  if (!Number.isFinite(limit) || limit >= tasks.length) return Promise.all(tasks.map((t) => t()));

  const out = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
  return out;
}

async function gatherFrom(source, target, season) {
  const seen = new Map();
  const queries = buildQueries(target, season);
  const results = await pooled(
    queries.map((q) => () => source.search(q, 20)),
    source.searchConcurrency ?? Infinity,
  );
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
      // Tên tiếng Việt của mục vừa khớp. Trang HH3D không ghi tên gốc nên đây là
      // thứ duy nhất tìm ra nó — xem hh3dStream.
      name: entry.name,
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
    // rest are deferred to this addon's own /resolve or /hls.m3u8, so the page
    // is opened when the user hits play — not once per server while the list is
    // being built, and while any token it hands out is still valid.
    const embed = picked.episode.embed || null;
    const direct = picked.episode.m3u8 || unwrapEmbed(embed);
    const deferrable = !direct && embed && baseUrl && !source.linkOnly && embedFetchable(embed);
    // streamc hands out its playlist over its own API, and every segment in it
    // has to be rewritten before Stremio can fetch it — so that one is served
    // as a playlist by this addon instead of resolved to a URL elsewhere.
    // Nguồn C chỉ cần server nội bộ của Stremio để gắn Referer cho từng
    // segment. Còn playlist thì lấy được ở cả trên Workers: streamc chặn Worker
    // nhưng CDN chứa segment của họ thì không (xem lib/streamc.js).
    const hlsBase = CONFIG.streamcUpstream || baseUrl;
    const lazy = !deferrable
      ? null
      : isStreamc(embed)
        ? CONFIG.stremioProxy && hlsBase && `${hlsBase}/hls.m3u8?u=${encodeURIComponent(embed)}`
        : `${baseUrl}/resolve?u=${encodeURIComponent(embed)}`;
    const url = direct || lazy || null;
    if (!url && !embed) continue;

    const warn = picked.decision.confidence === 'low' ? ' ⚠️' : '';
    const quality = entry.quality ? `${entry.quality} · ${entry.lang}` : '';
    const title = [entry.name, `▶ ${picked.episode.label}${warn}`, picked.decision.note, quality]
      .filter(Boolean)
      .join('\n');
    const name = `${BRAND} | ${source.label}${warn}\n${server.name}`;

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
 * Tên tiếng Việt, gọt cho vừa cái ô tìm kiếm của HH3D.
 *
 * Tìm kiếm của họ kén một cách cụ thể, đo ngày 22/09/2026 trên chính hai phim
 * từng trượt:
 *
 *   "Đại Chúa Tể 3D"                        -> 3 kết quả, không cái nào đúng
 *   "Đại Chúa Tể"                           -> 20 kết quả, có dai-chua-te
 *   "Đấu La Đại Lục 2 (Tuyệt Thế Đường Môn)" -> 0 kết quả
 *   "Đấu La Đại Lục 2"                      -> đúng phim ở hạng 1
 *   "dai chua te 3d"                        -> 1 kết quả, sai phim
 *
 * Nên: cắt phần trong ngoặc và phần sau dấu hai chấm, bỏ đuôi "3D", và GIỮ dấu
 * tiếng Việt — bỏ dấu là ra rác.
 */
function hh3dTitle(name) {
  return String(name || '')
    .replace(/\s*[([].*$/, '')
    .replace(/\s*:.*$/, '')
    .replace(/\s+3\s*d\s*$/i, '')
    .trim();
}

/**
 * Một dòng HH3D.
 *
 * Link phát được lấy NGAY LÚC DỰNG DANH SÁCH, không để tới lúc bấm phát. Trước
 * đây làm ngược lại để danh sách ra nhanh hơn, và cái giá là một dòng chết: khi
 * HH3D đổi cách giao link (họ vừa chuyển cả site từ `type: hls` sang
 * `type: embed`), dòng HH3D vẫn hiện ra, vẫn đứng đầu, và Stremio bấm vào thì
 * báo không kết nối được. Thà chờ thêm một nhịp còn hơn bày ra thứ không chạy.
 *
 * Tốn thêm chừng một giây cho phim có HH3D, nhưng không tốn thêm request: trước
 * đó addon vẫn làm đúng việc này ở chế độ làm nóng, chỉ là làm sau khi đã trả lời.
 * Bù lại cú bấm phát giờ chỉ còn đọc cache.
 *
 * Segment của HH3D không đòi header nào, nên dòng này phát được cả trên máy xem
 * không có server nội bộ của Stremio — khác Nguồn C.
 */
async function hh3dRow({ name, epNum, page, note, baseUrl, slug }) {
  // Dựng được playlist thì mới có dòng. Không được thì bỏ hẳn, để dòng đầu là
  // một nguồn chạy được chứ không phải một nguồn chết.
  const playlist = baseUrl ? await hh3dPlaylist(page, { segmentBase: `${baseUrl}/hh3d-seg` }).catch(() => null) : null;
  if (baseUrl && !playlist) return null;

  const url = baseUrl ? `${baseUrl}/hh3d.m3u8?u=${encodeURIComponent(page)}` : null;
  const title = [name, `▶ Tập ${epNum}`, note, url ? '⟳ Lấy link lúc bấm phát' : '↗ Mở trên hoathinh3d']
    .filter(Boolean)
    .join('\n');

  if (!url) return { name: `${BRAND} | HH3D\nMở trang`, title, externalUrl: page };
  return {
    name: `${BRAND} | HH3D\n1080p`,
    title,
    url,
    behaviorHints: { notWebReady: false, bingeGroup: `hh3d-${slug}` },
  };
}

/**
 * HH3D, phát trực tiếp.
 *
 * Tên tiếng Việt vào cả hai chỗ, và cả hai đều cần thiết:
 *
 *   • vào truy vấn, vì trang HH3D không ghi tên gốc nên hỏi bằng tên tiếng Anh
 *     của Cinemeta gần như luôn ra rỗng;
 *   • vào danh sách tên để khớp, vì nếu không thì "Đại Chúa Tể" của HH3D đọ với
 *     "The Great Ruler" của Cinemeta chỉ được 34 điểm — dưới ngưỡng 45 — và một
 *     phim có thật bị loại đúng ở bước cuối.
 *
 * Slug ghim trong overrides.json vẫn là đường chắc nhất cho phim mà cả hai cách
 * trên đều không tìm ra.
 */
async function hh3dStream(target, parsed, dbg, baseUrl, vnTitles = []) {
  if (!CONFIG.enableHh3d || parsed.season == null) return [];

  let entry = null;
  const pin = target.override?.hh3d;
  const vnNames = [...new Set(vnTitles.flatMap((name) => [name, hh3dTitle(name)]))].filter(Boolean);
  const local = vnNames.length ? { ...target, titles: [...new Set([...target.titles, ...vnNames])] } : target;

  if (pin) {
    entry = (await hh3d.detail(pin)) || { slug: pin, name: target.name, season: null, maxEpisode: 0, servers: [] };
  } else {
    const queries = [...new Set([...vnNames, ...buildQueries(target, parsed.season).slice(0, 2)])].slice(0, 4);
    dbg.queries = queries;

    const candidates = (await Promise.all(queries.map((q) => hh3d.search(q)))).flat();
    const scored = filterCandidates(candidates, local, 'series');
    const best = pickEntry(scored, parsed.season);
    if (!best) return [];
    dbg.picked = { slug: best.candidate.slug, score: best.score, reasons: best.reasons, season: best.candidate.season };
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
    const row = await hh3dRow({
      name: entry.name,
      epNum: picked.episode.num,
      page: picked.episode.page,
      note: picked.decision.note,
      baseUrl,
      slug: entry.slug,
    });
    return row ? [row] : [];
  }

  // Pinned slug while the site is unreachable -> build the permalink directly.
  if (!pin) return [];
  let epNum =
    target.override?.mode === 'absolute' && target.index
      ? target.index.absolute(parsed.season, parsed.episode ?? 1) ?? parsed.episode ?? 1
      : parsed.episode ?? 1;
  epNum += target.override?.offset || 0;
  dbg.decision = { mode: 'pinned', target: epNum, confidence: 'medium', note: 'Dựng link từ slug đã ghim' };
  const pinnedRow = await hh3dRow({
    name: target.name,
    epNum,
    page: `${await hh3dBase()}/xem-phim-${entry.slug}/tap-${epNum}-sv1.html`,
    note: 'Dựng link từ slug đã ghim',
    baseUrl,
    slug: entry.slug,
  });
  return pinnedRow ? [pinnedRow] : [];
}

/**
 * Thứ tự dòng stream, xếp theo số đo chứ không theo cảm giác.
 *
 * Stremio phát dòng đầu tiên khi bấm phát nhanh và khi tự sang tập sau, nên thứ
 * tự này là thứ quyết định người xem gặp nguồn nào trước. Đo ngày 22/09/2026 từ
 * máy xem, tải thật 6 segment đầu của cùng một tập, hai lượt:
 *
 *   KKPhim    2.2–2.3x thời gian thực   (2.4 Mbps nội dung)
 *   HH3D      6.6–7.2x                  (1.9 Mbps)
 *   Nguồn C   10.5–12.6x                (2.0 Mbps)
 *
 * KKPhim xuống cuối vì 2.2x là mức duy nhất sát thời gian thực: mạng chớm yếu là
 * hết đệm và đứng hình. Còn giữa HH3D và Nguồn C thì HH3D lên trước dù chậm hơn,
 * vì trên 6x thì thêm băng thông không làm mượt hơn nữa, trong khi hai thứ khác
 * thì có: HH3D không cần server nội bộ của Stremio, và độ dài từng đoạn là số
 * thật của họ nên thanh thời gian với tua tới đều đúng — playlist Nguồn C dựng
 * từ CDN chỉ có độ dài trung bình.
 *
 * Nguồn nào không có tên ở đây thì xuống dưới cùng, giữ nguyên thứ tự cũ.
 */
const SOURCE_ORDER = ['hh3d', 'nguonc', 'kkphim', 'ophim'];

const rankOf = (stream) => {
  const at = SOURCE_ORDER.findIndex((id) => stream.behaviorHints?.bingeGroup?.startsWith(`${id}-`));
  return at === -1 ? SOURCE_ORDER.length : at;
};

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

  const fromApi = (await Promise.all(jobs)).flat();

  // HH3D đi sau chứ không song song: nó cần tên tiếng Việt để tìm được phim, mà
  // tên tiếng Việt lại là thứ các nguồn API vừa tìm ra. Trả giá bằng một chặng
  // chờ nữa, nhưng chặng đó quyết định có tìm thấy phim hay không, chứ không phải
  // chỉ để nhanh hơn.
  const vnTitles = [...new Set(Object.values(debug.sources).map((s) => s.picked?.name).filter(Boolean))];
  const fromHh3d =
    wantType === 'series' ? await guard('hh3d', (dbg) => hh3dStream(target, parsed, dbg, baseUrl, vnTitles)) : [];

  const all = [...fromApi, ...fromHh3d].sort((a, b) => rankOf(a) - rankOf(b));
  const streams = CONFIG.linkRows ? all : all.filter((s) => !s.externalUrl);
  if (!CONFIG.linkRows) debug.hidden = all.length - streams.length;
  return { streams, debug };
}
