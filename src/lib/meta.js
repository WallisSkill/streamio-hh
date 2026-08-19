import { CONFIG } from '../config.js';
import { getJson, safe } from './http.js';
import { cached } from './cache.js';

/**
 * Official Stremio metadata (Cinemeta) for an IMDb id.
 * This is the source of truth for what the user sees in the Stremio UI,
 * so every episode mapping is computed against THIS numbering.
 */
export async function getCinemeta(type, imdbId) {
  const url = `${CONFIG.cinemeta}/meta/${type}/${imdbId}.json`;
  const data = await getJson(url);
  return data?.meta || null;
}

/**
 * Build the season/episode index of the official listing.
 *  - absolute numbering ignores season 0 (specials), matching how VN sites count
 *  - seasonCounts[s] = number of episodes Stremio shows in season s
 */
export function buildEpisodeIndex(meta) {
  const videos = (meta?.videos || [])
    .filter((v) => Number(v.season) > 0 && Number.isFinite(Number(v.number)))
    .map((v) => ({ season: Number(v.season), number: Number(v.number), released: v.released || v.firstAired }))
    .sort((a, b) => a.season - b.season || a.number - b.number);

  const seasonCounts = {};
  const absOf = new Map(); // "s:e" -> absolute index (1-based)
  videos.forEach((v, i) => {
    seasonCounts[v.season] = (seasonCounts[v.season] || 0) + 1;
    absOf.set(`${v.season}:${v.number}`, i + 1);
  });

  const seasons = Object.keys(seasonCounts).map(Number).sort((a, b) => a - b);

  return {
    videos,
    seasons,
    seasonCounts,
    totalAbsolute: videos.length,
    /** absolute episode number across the whole show, or null if unknown */
    absolute(season, episode) {
      return absOf.get(`${season}:${episode}`) ?? null;
    },
    /** how many episodes precede this season (absolute offset) */
    offsetOfSeason(season) {
      let off = 0;
      for (const s of seasons) {
        if (s >= season) break;
        off += seasonCounts[s];
      }
      return off;
    },
  };
}

/**
 * Extra title aliases from Kitsu. Chinese donghua is listed on IMDb/TMDB under a
 * different English title than VN sites use, so aliases materially improve search.
 */
export async function getAliases(name, year) {
  if (!name) return [];
  return cached(`aliases:${name}:${year || ''}`, async () => {
    const url = `${CONFIG.kitsuApi}/anime?filter[text]=${encodeURIComponent(name)}&page[limit]=5`;
    const data = await safe(getJson(url, { headers: { accept: 'application/vnd.api+json' } }), 'kitsu');
    const out = new Set();
    for (const item of data?.data || []) {
      const a = item.attributes || {};
      const start = a.startDate ? Number(String(a.startDate).slice(0, 4)) : null;
      if (year && start && Math.abs(start - Number(year)) > 2) continue;
      for (const t of Object.values(a.titles || {})) if (t) out.add(t);
      for (const t of a.abbreviatedTitles || []) if (t) out.add(t);
    }
    return [...out].slice(0, 8);
  });
}

/** Kitsu id -> title/episode info, for `kitsu:<id>[:<ep>]` stream requests. */
export async function getKitsuMeta(kitsuId) {
  const url = `${CONFIG.kitsuApi}/anime/${kitsuId}`;
  const data = await safe(getJson(url, { headers: { accept: 'application/vnd.api+json' } }), 'kitsu-meta');
  const a = data?.data?.attributes;
  if (!a) return null;
  const titles = [...new Set(Object.values(a.titles || {}).filter(Boolean).concat(a.abbreviatedTitles || []))];
  return {
    name: a.canonicalTitle,
    titles,
    year: a.startDate ? Number(String(a.startDate).slice(0, 4)) : null,
    episodeCount: a.episodeCount || null,
    type: a.subtype === 'movie' ? 'movie' : 'series',
  };
}
