import { CONFIG } from '../config.js';
import { getJson, safe } from '../lib/http.js';
import { cached } from '../lib/cache.js';
import { parseEpisodeLabel, detectSeason } from '../lib/text.js';

/**
 * Nguồn C (phim.nguonc.com)
 *
 * API:
 *
 *   https://phim.nguonc.com/api-document
 *
 * Flow:
 *
 *   search
 *      ↓
 *   /api/films/search
 *      ↓
 *   slug
 *      ↓
 *   /api/film/{slug}
 *      ↓
 *   movie.episodes
 *      ↓
 *   server.items
 *      ↓
 *   episode.embed / episode.link_embed
 *
 * API detail trả về link embed của từng episode.
 *
 * Module này KHÔNG tự generate token/hash/key.
 * Những thông tin đó thuộc stream provider phía sau embed.
 */

/**
 * category is a numbered map of groups; the year sits in the group named "Năm".
 */
function yearOf(movie) {
  for (const g of Object.values(movie?.category || {})) {
    if (/n(ă|a)m/i.test(g?.group?.name || '')) {
      const y = Number(g.list?.[0]?.name);

      if (Number.isFinite(y)) {
        return y;
      }
    }
  }

  return null;
}

/**
 * original_name packs several aliases into one comma-separated string.
 */
function aliasesOf(item) {
  return String(item?.original_name || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Search results carry no `category`, so the format group is only available
 * on the detail response.
 *
 * Episode count stands in for it:
 *   - 1 episode => standalone film
 *   - >1 episodes => series
 */
function typeOf(item) {
  const format = item?.category?.['1']?.list?.[0]?.name;

  if (format) {
    return /l(ẻ|e)/i.test(format) ? 'single' : 'series';
  }

  return Number(item?.total_episodes) === 1
    ? 'single'
    : 'series';
}

/**
 * Convert movie item returned by Nguồn C API
 * into our internal candidate format.
 */
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

    season: detectSeason(
      item.name,
      ...alts,
    ),
  };
}

/**
 * Get embed URL from an episode.
 *
 * Depending on API response/version, Nguồn C may expose:
 *
 *   embed
 *
 * or:
 *
 *   link_embed
 *
 * Support both.
 */
function getEpisodeEmbed(ep) {
  if (!ep) {
    return null;
  }

  return (
    ep.embed ||
    ep.link_embed ||
    ep.embed_url ||
    ep.url_embed ||
    null
  );
}

/**
 * Get m3u8 URL if API happens to provide one.
 *
 * Nguồn C responses may expose:
 *
 *   link_m3u8
 *
 * We keep this as fallback.
 *
 * IMPORTANT:
 * We do not generate key/hash/token here.
 */
function getEpisodeM3u8(ep) {
  if (!ep) {
    return null;
  }

  return (
    ep.m3u8 ||
    ep.link_m3u8 ||
    ep.m3u8_url ||
    ep.url_m3u8 ||
    null
  );
}

/**
 * Search movies.
 */
export async function search(keyword) {
  if (!keyword) {
    return [];
  }

  const url =
    `${CONFIG.nguoncApi}/api/films/search` +
    `?keyword=${encodeURIComponent(keyword)}`;

  const data = await safe(
    getJson(url),
    'nguonc-search',
  );

  return (data?.items || []).map(toCandidate);
}

/**
 * Get movie detail + servers + episodes.
 *
 * Example API flow:
 *
 *   GET /api/film/{slug}
 *
 * Response:
 *
 *   {
 *     movie: {
 *       ...
 *       episodes: [
 *         {
 *           server_name: "...",
 *           items: [
 *             {
 *               name: "1",
 *               embed: "https://...",
 *               link_embed: "https://...",
 *               link_m3u8: "https://..."
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   }
 */
export async function detail(slug) {
  if (!slug) {
    return null;
  }

  return cached(
    `nguonc:detail:${slug}`,
    async () => {
      const data = await safe(
        getJson(
          `${CONFIG.nguoncApi}/api/film/${slug}`,
        ),
        'nguonc-detail',
      );

      const movie = data?.movie;

      if (!movie) {
        return null;
      }

      const servers = (movie.episodes || [])
        .map((srv) => ({
          name: srv.server_name || 'Server',

          episodes: (srv.items || [])
            .map((ep) => {
              const parsed = parseEpisodeLabel(ep.name);

              const embed = getEpisodeEmbed(ep);

              const m3u8 = getEpisodeM3u8(ep);

              return {
                /**
                 * Display name.
                 */
                label:
                  /^\d+$/.test(
                    String(ep.name).trim(),
                  )
                    ? `Tập ${ep.name}`
                    : String(ep.name),

                /**
                 * Episode number.
                 */
                num: parsed.num,

                isFull: parsed.isFull,

                isSpecial: parsed.isSpecial,

                /**
                 * If API already provides m3u8,
                 * keep it.
                 *
                 * Otherwise null.
                 */
                m3u8,

                /**
                 * This is the important part:
                 *
                 * embed returned directly by
                 * Nguồn C API.
                 */
                embed,

                /**
                 * Keep page alias for compatibility
                 * with the existing application.
                 */
                page: embed,

                /**
                 * Keep original API fields useful
                 * for debugging/future integration.
                 */
                sourceEpisode: ep,
              };
            })
            /**
             * Only expose episodes that have an embed
             * or direct m3u8.
             */
            .filter(
              (ep) =>
                ep.embed ||
                ep.m3u8,
            ),
        }));

      return {
        ...toCandidate(movie),

        quality:
          movie.quality || '',

        lang:
          movie.language || '',

        episodeTotal:
          Number(movie.total_episodes) || null,

        servers,

        maxEpisode: Math.max(
          0,

          ...servers.flatMap(
            (s) =>
              s.episodes
                .filter(
                  (e) =>
                    !e.isSpecial &&
                    e.num,
                )
                .map(
                  (e) =>
                    e.num,
                ),
          ),
        ),
      };
    },
  );
}

/**
 * Get embed URL directly from a movie episode.
 *
 * This helper is useful if the caller already has
 * the detail response and only needs the player URL.
 */
export function getEmbed(episode) {
  return episode?.embed || null;
}

/**
 * Get direct m3u8 returned by API, if available.
 */
export function getM3u8(episode) {
  return episode?.m3u8 || null;
}

/**
 * Module definition.
 *
 * IMPORTANT:
 *
 * `linkOnly` is now false because the module exposes
 * the embed URL returned by the Nguồn C API.
 */
export default {
  id: 'nguonc',

  label: 'Nguồn C',

  linkOnly: false,

  search,

  detail,

  getEmbed,

  getM3u8,
};