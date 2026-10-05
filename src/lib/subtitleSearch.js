import { CONFIG } from '../config.js';
import { cacheGet, cacheSet } from './cache.js';

/**
 * Tìm phụ đề TIẾNG VIỆT cho một phim, không cần key.
 *
 * Dùng cửa REST cũ của opensubtitles.org. Vì sao chọn nó:
 *
 *   • Không cần đăng ký key — cửa `api.opensubtitles.com/api/v1` và
 *     `api.subsource.net/api/v1` đều đòi key, còn cửa keyless của SubSource
 *     (`/v1/subtitles/search`) bỏ qua mọi tham số, hỏi phim nào cũng trả về
 *     cùng một phim (đo 05/10/2026).
 *   • Lọc được ngay theo ngôn ngữ: `sublanguageid-vie`, nên chỉ tải tiếng Việt.
 *   • Trả kèm số lượt tải và tên bản release — hai thứ đủ để xếp bản nào khớp
 *     nhất lên đầu mà không phải đoán.
 *
 * Hai chỗ phải cẩn thận, đều do đo mà biết:
 *   • Mã IMDb phải GIỮ số 0 đầu: `imdbid-0944947` trả về 5 bản, `imdbid-944947`
 *     thì lỗi.
 *   • Cửa này chập chờn, thỉnh thoảng đứt giữa chừng (giới hạn theo IP), nên
 *     thử lại một lần và cache kết quả.
 */

const BASE = 'https://rest.opensubtitles.org/search';

/** Số lượt tải nhiều thì thường là bản dịch tốt và khớp nhiều bản phim. */
const downloads = (s) => Number(s?.SubDownloadsCnt) || 0;

async function ask(path) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(BASE + path, {
        headers: { 'user-agent': CONFIG.subtitleUserAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(CONFIG.httpTimeout),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) return data;
    } catch {
      // đứt giữa chừng là chuyện thường ở cửa này — thử lại lần nữa rồi thôi
    }
  }
  return null;
}

/**
 * Danh sách phụ đề tiếng Việt cho một id Stremio (`tt123` hoặc `tt123:1:5`).
 * Bản khớp tên tệp đang xem được đẩy lên đầu, sau đó tới bản nhiều lượt tải.
 */
export async function vietnameseSubtitles(id, filename = '') {
  if (!CONFIG.subtitleSearch) return [];

  const [base, season, episode] = String(id).split(':');
  const digits = base.replace(/^tt/, '');
  if (!/^\d+$/.test(digits)) return [];

  // Mã IMDb giữ nguyên số 0 đầu — bỏ đi là cửa này lỗi.
  const path =
    season && episode
      ? `/episode-${Number(episode)}/imdbid-${digits}/season-${Number(season)}/sublanguageid-vie`
      : `/imdbid-${digits}/sublanguageid-vie`;

  const key = `subs:vie:${path}`;
  let list = cacheGet(key);
  if (list === undefined) {
    list = await ask(path);
    // Không cache lần trượt: cửa này hay đứt, cache cái đứt là mất phụ đề cả
    // nửa tiếng vì một cú vấp mạng.
    if (list) cacheSet(key, list, CONFIG.cacheTtl);
  }
  if (!list?.length) return [];

  const name = String(filename).toLowerCase();
  const words = name.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 3);

  /** Bao nhiêu mẩu trong tên tệp đang xem cũng có trong tên bản phụ đề. */
  const overlap = (s) => {
    if (!words.length) return 0;
    const hay = `${s.MovieReleaseName || ''} ${s.SubFileName || ''}`.toLowerCase();
    return words.filter((w) => hay.includes(w)).length;
  };

  return list
    .filter((s) => s?.SubDownloadLink && (s.SubLanguageID || '').toLowerCase() === 'vie')
    .map((s) => ({
      id: String(s.IDSubtitleFile),
      release: s.MovieReleaseName || s.SubFileName || 'phụ đề',
      downloads: downloads(s),
      encoding: s.SubEncoding || 'UTF-8',
      url: s.SubDownloadLink,
      score: overlap(s),
    }))
    .sort((a, b) => b.score - a.score || b.downloads - a.downloads)
    .slice(0, CONFIG.subtitleLimit);
}

/** Chỉ tải hộ phụ đề từ đúng nơi cửa trên trả về, không thành proxy mở. */
export function downloadAllowed(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'dl.opensubtitles.org' || host.endsWith('.opensubtitles.org');
  } catch {
    return false;
  }
}

/**
 * Tải một phụ đề về dạng Stremio đọc được.
 *
 * Hai thứ phải làm, không bỏ được cái nào: file tải về là `.gz` (người chơi
 * không đọc được), và bảng mã thường không phải UTF-8 — bỏ qua bước này thì phụ
 * đề tiếng Việt ra đầy dấu hỏi.
 */
export async function fetchSubtitle(url, encoding = 'UTF-8') {
  const res = await fetch(url, {
    headers: { 'user-agent': CONFIG.subtitleUserAgent },
    signal: AbortSignal.timeout(CONFIG.httpTimeout),
  });
  if (!res.ok || !res.body) return null;

  const raw = new Uint8Array(
    await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),
  );

  const label = String(encoding || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(label).decode(raw);
  } catch {
    return new TextDecoder('utf-8').decode(raw);
  }
}
