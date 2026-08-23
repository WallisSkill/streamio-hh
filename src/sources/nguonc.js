import { CONFIG } from '../config.js';
import { getJson, safe } from '../lib/http.js';
import { cached } from '../lib/cache.js';
import { parseEpisodeLabel, detectSeason } from '../lib/text.js';

/**
 * Nguồn C (phim.nguonc.com) — https://phim.nguonc.com/api-document
 *
 * The JSON API is open (no key) and is all this module reads. The stream itself
 * is not extracted: episodes point at an embed page that obfuscates its source
 * behind nested base64, runs a devtools detector that reloads the page when
 * opened, and blocks view-source shortcuts — a deliberate anti-extraction stack.
 * So episodes are surfaced as links that open the publisher's own player, which
 * is exactly what the API hands out.
 */

/** category is a numbered map of groups; the year sits in the group named "Năm". */
function yearOf(movie) {
  for (const g of Object.values(movie?.category || {})) {
    if (/n(ă|a)m/i.test(g?.group?.name || '')) {
      const y = Number(g.list?.[0]?.name);
      if (Number.isFinite(y)) return y;
    }
  }
  return null;
}

/** original_name packs several aliases into one comma-separated string. */
function aliasesOf(item) {
  return String(item?.original_name || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Search results carry no `category`, so the format group is only available on
 * the detail response. Episode count stands in for it: a one-episode entry is a
 * standalone film, anything longer is episodic.
 */
function typeOf(item) {
  const format = item?.category?.['1']?.list?.[0]?.name;
  if (format) return /l(ẻ|e)/i.test(format) ? 'single' : 'series';
  return Number(item?.total_episodes) === 1 ? 'single' : 'series';
}

function toCandidate(item) {
  const alts = aliasesOf(item);
  return {
    source: 'nguonc',
    sourceLabel: 'Nguồn C',
    slug: item.slug,
    name: item.name,
    originName: alts[0] || '',
    altNames: alts,
    year: yearOf(item),
    type: typeOf(item),
    imdbId: null,
    tmdbId: null,
    season: detectSeason(item.name, ...alts),
  };
}

export async function search(keyword) {
  if (!keyword) return [];
  const url = `${CONFIG.nguoncApi}/api/films/search?keyword=${encodeURIComponent(keyword)}`;
  const data = await safe(getJson(url), 'nguonc-search');
  return (data?.items || []).map(toCandidate);
}

export async function detail(slug) {
  if (!slug) return null;
  return cached(`nguonc:detail:${slug}`, async () => {
    const data = await safe(getJson(`${CONFIG.nguoncApi}/api/film/${slug}`), 'nguonc-detail');
    const movie = data?.movie;
    if (!movie) return null;

    const servers = (movie.episodes || []).map((srv) => ({
      name: srv.server_name || 'Server',
      episodes: (srv.items || [])
        .map((ep) => {
          const parsed = parseEpisodeLabel(ep.name);
          return {
            label: /^\d+$/.test(String(ep.name).trim()) ? `Tập ${ep.name}` : String(ep.name),
            num: parsed.num,
            isFull: parsed.isFull,
            isSpecial: parsed.isSpecial,
            m3u8: null,
            embed: ep.embed || null,
            page: ep.embed || null,
          };
        })
        .filter((ep) => ep.embed),
    }));

    return {
      ...toCandidate(movie),
      quality: movie.quality || '',
      lang: movie.language || '',
      episodeTotal: Number(movie.total_episodes) || null,
      servers,
      maxEpisode: Math.max(
        0,
        ...servers.flatMap((s) => s.episodes.filter((e) => !e.isSpecial && e.num).map((e) => e.num)),
      ),
    };
  });
}

/** linkOnly: streams open the publisher's player instead of playing inline. */
export default { id: 'nguonc', label: 'Nguồn C', linkOnly: true, search, detail };
