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
 *   episode.embed
 *
 * API detail trả về embed URL của từng episode.
 *
 * Module này chỉ đọc phần API công khai trả về — nó dừng ở embed URL.
 *
 * Việc biến embed URL đó thành link phát được nằm ở `lib/embed.js`
 * (`fromStreamc`): trang embed công bố stream token và video hash trong
 * `#player[data-obf]`, hai giá trị đó được đưa qua `CONFIG.streamcProxy`
 * vì bản thân playlist về ở dạng mã hoá và segment đòi Referer.
 *
 * Đặt `STREAMC_PROXY=` rỗng thì tập Nguồn C quay lại dạng link mở ngoài.
 */

/**
 * Lấy năm phim từ category.
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
 * original_name có thể chứa nhiều tên,
 * phân cách bằng dấu phẩy.
 */
function aliasesOf(item) {
  return String(item?.original_name || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Xác định loại phim.
 */
function typeOf(item) {
  const format = item?.category?.['1']?.list?.[0]?.name;

  if (format) {
    return /l(ẻ|e)/i.test(format)
      ? 'single'
      : 'series';
  }

  return Number(item?.total_episodes) === 1
    ? 'single'
    : 'series';
}

/**
 * Convert movie API object sang internal candidate.
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
 * Lấy embed URL từ episode.
 *
 * Ưu tiên embed vì đây là field được API
 * Nguồn C trả về trong response hiện tại.
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
 * Nếu API có trả trực tiếp m3u8 thì giữ lại.
 *
 * Không tự generate m3u8/token/key.
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
 * Mọi đường đi tới nguonc, tốt nhất trước.
 *
 * Cloudflare của nguonc chặn IP datacenter, nên bản chạy serverless phải mượn
 * một IP đi được. Thứ tự: upstream của chính bạn trước (bạn kiểm soát được),
 * rồi tới proxy công cộng, cuối cùng là gọi thẳng.
 *
 * Có bước lùi này thì máy nhà tắt không làm mất hẳn Nguồn C — chỉ chuyển
 * sang đường sau. Máy chạy ở nhà không đặt biến nào thì danh sách chỉ có
 * đúng đường gọi thẳng, y như trước.
 */
function routesTo(path) {
  const direct = `${CONFIG.nguoncApi}${path}`;
  const routes = [];

  if (CONFIG.nguoncUpstream) {
    routes.push(`${CONFIG.nguoncUpstream}/upstream/nguonc${path}`);
  }
  if (CONFIG.nguoncProxy) {
    routes.push(CONFIG.nguoncProxy.replace('{url}', encodeURIComponent(direct)));
  }
  routes.push(direct);

  return routes;
}

/**
 * Gọi nguonc qua đường nào trả lời được.
 *
 * Một proxy bị chặn vẫn có thể trả 200 kèm trang chặn của Cloudflare, nên
 * phải soi hình dạng dữ liệu chứ không tin mỗi status code.
 */
async function getNguonc(path, label) {
  for (const url of routesTo(path)) {
    const data = await safe(getJson(url), label);

    if (data?.status === 'success' || data?.items || data?.movie) {
      return data;
    }
  }

  return null;
}

/**
 * Search phim.
 */
export async function search(keyword) {
  if (!keyword) {
    return [];
  }

  const data = await getNguonc(
    `/api/films/search?keyword=${encodeURIComponent(keyword)}`,
    'nguonc-search',
  );

  return (data?.items || [])
    .map(toCandidate);
}

/**
 * Lấy detail phim.
 */
export async function detail(slug) {
  if (!slug) {
    return null;
  }

  return cached(
    `nguonc:detail:${slug}`,
    async () => {
      const data = await getNguonc(
        `/api/film/${slug}`,
        'nguonc-detail',
      );

      const movie = data?.movie;

      if (!movie) {
        return null;
      }

      const servers = (movie.episodes || [])
        .map((srv) => ({
          name:
            srv.server_name ||
            'Server',

          episodes:
            (srv.items || [])
              .map((ep) => {
                const parsed =
                  parseEpisodeLabel(
                    ep.name,
                  );

                const embed =
                  getEpisodeEmbed(ep);

                const m3u8 =
                  getEpisodeM3u8(ep);

                return {
                  label:
                    /^\d+$/.test(
                      String(
                        ep.name,
                      ).trim(),
                    )
                      ? `Tập ${ep.name}`
                      : String(
                          ep.name,
                        ),

                  num: parsed.num,

                  isFull:
                    parsed.isFull,

                  isSpecial:
                    parsed.isSpecial,

                  /**
                   * Chỉ dùng m3u8 nếu API
                   * trả trực tiếp field này.
                   */
                  m3u8,

                  /**
                   * Embed URL chính thức
                   * được API trả về.
                   *
                   * Ví dụ:
                   *
                   * https://embed1.streamc.xyz/
                   * embed.php?hash=430b...
                   */
                  embed,

                  /**
                   * Alias tương thích với
                   * code player hiện tại.
                   */
                  page: embed,

                  /**
                   * Giữ response gốc nếu cần
                   * debug.
                   */
                  sourceEpisode: ep,
                };
              })
              .filter(
                (ep) =>
                  Boolean(
                    ep.embed ||
                    ep.m3u8,
                  ),
              ),
        }));

      return {
        ...toCandidate(movie),

        quality:
          movie.quality || '',

        lang:
          movie.language || '',

        episodeTotal:
          Number(
            movie.total_episodes,
          ) || null,

        servers,

        maxEpisode: Math.max(
          0,

          ...servers.flatMap(
            (server) =>
              server.episodes
                .filter(
                  (episode) =>
                    !episode.isSpecial &&
                    episode.num,
                )
                .map(
                  (episode) =>
                    episode.num,
                ),
          ),
        ),
      };
    },
  );
}

/**
 * Lấy embed URL.
 *
 * Ví dụ:
 *
 * getEmbed(episode)
 *
 * =>
 *
 * https://embed1.streamc.xyz/embed.php?hash=430b4d...
 */
export function getEmbed(episode) {
  return getEpisodeEmbed(episode);
}

/**
 * Lấy m3u8 nếu API có trả trực tiếp.
 */
export function getM3u8(episode) {
  return getEpisodeM3u8(episode);
}

/**
 * Module definition.
 */
export default {
  id: 'nguonc',

  label: 'Nguồn C',

  /**
   * false:
   * player được phép sử dụng embed URL.
   */
  linkOnly: false,

  search,

  detail,

  getEmbed,

  getM3u8,
};