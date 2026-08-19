import { getJson, safe } from '../lib/http.js';
import { cached } from '../lib/cache.js';
import { parseEpisodeLabel, detectSeason } from '../lib/text.js';

/**
 * KKPhim and Ophim expose the same JSON API shape, so both are built from here.
 * Both publish `link_m3u8` openly to anonymous callers — no token, no gate.
 */
export function createPhimApiSource({ id, label, api }) {
  const toCandidate = (item) => ({
    source: id,
    sourceLabel: label,
    slug: item.slug,
    name: item.name,
    originName: item.origin_name,
    altNames: item.alternative_names || [],
    year: item.year || null,
    type: item.type,
    imdbId: item.imdb?.id || null,
    tmdbId: item.tmdb?.id ? String(item.tmdb.id) : null,
    tmdbType: item.tmdb?.type || null,
    tmdbSeason: item.tmdb?.season ?? null,
    episodeCurrent: item.episode_current || '',
    season: item.tmdb?.season ?? detectSeason(item.name, item.origin_name),
  });

  async function search(keyword, limit = 20) {
    if (!keyword) return [];
    const url = `${api}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&limit=${limit}`;
    const data = await safe(getJson(url), `${id}-search`);
    return (data?.data?.items || []).map(toCandidate);
  }

  async function detail(slug) {
    if (!slug) return null;
    return cached(`${id}:detail:${slug}`, async () => {
      const data = await safe(getJson(`${api}/phim/${slug}`), `${id}-detail`);
      const movie = data?.movie;
      if (!movie) return null;

      const servers = (data.episodes || movie.episodes || []).map((srv) => ({
        name: srv.server_name || 'Server',
        episodes: (srv.server_data || [])
          .map((ep) => {
            const parsed = parseEpisodeLabel(ep.name);
            return {
              label: ep.name,
              num: parsed.num,
              isFull: parsed.isFull,
              isSpecial: parsed.isSpecial,
              m3u8: ep.link_m3u8 || null,
              embed: ep.link_embed || null,
            };
          })
          .filter((ep) => ep.m3u8 || ep.embed),
      }));

      return {
        ...toCandidate(movie),
        episodeTotal: Number(movie.episode_total) || null,
        quality: movie.quality || '',
        lang: movie.lang || '',
        servers,
        maxEpisode: Math.max(
          0,
          ...servers.flatMap((s) => s.episodes.filter((e) => !e.isSpecial && e.num).map((e) => e.num)),
        ),
      };
    });
  }

  return { id, label, search, detail };
}
