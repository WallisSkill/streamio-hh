import { CONFIG } from '../config.js';
import { cacheGet, cacheSet } from './cache.js';
import { cleanSubtitle } from './subtitleText.js';
import { isAss, assToSrt } from './assToSrt.js';
import { releaseScore, wrongEpisode } from './releaseMatch.js';

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

const lines = (text) => String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const namesOf = (s) => [...lines(s.MovieReleaseName), String(s.SubFileName || '').trim()].filter(Boolean);

function oneLine(text, max = 80) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return [...s].length > max ? `${[...s].slice(0, max - 1).join('')}…` : s;
}

/**
 * Nhãn một dòng: bản phim, người đăng (kèm hạng hoặc cờ tin cậy), người dịch,
 * máy dịch hay không, lượt tải và lời người đăng.
 */
export function openSubtitlesLabel(s) {
  const parts = ['WisFilm-OpenSubtitles', s.moreReleases ? `${s.release} +${s.moreReleases} bản` : s.release];
  if (s.hearingImpaired) parts.push('CC');
  if (s.uploader) parts.push(`Đăng: ${s.uploader}${s.trusted ? ' (tin cậy)' : s.rank ? ` (${s.rank})` : ''}`);
  if (s.translator && s.translator !== s.uploader) parts.push(`Dịch: ${s.translator}`);
  if (s.machine) parts.push('máy dịch');
  parts.push(`${(s.downloads || 0).toLocaleString('vi-VN')} lượt tải`);
  if (s.comment) parts.push(`“${s.comment}”`);
  return parts.filter(Boolean).join(' · ');
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

  // Xếp hạng theo BẢN PHIM đang xem, không phải theo số từ trùng nhau.
  // So với cả MovieReleaseName lẫn SubFileName: nhiều mục bỏ trống trường đầu,
  // và tên tệp thường mới là chỗ ghi đủ 2160p / WEB-DL / tên nhóm.
  const ranked = list
    .filter((s) => s?.SubDownloadLink && (s.SubLanguageID || '').toLowerCase() === 'vie')
    // Cửa này lọc theo tập ngay trên đường dẫn nên hiếm khi trả nhầm, nhưng
    // lưới an toàn vẫn đáng giữ: sai tập là phụ đề của phim khác, không phải
    // phụ đề kém khớp, nên không bao giờ được để nó lọt vào danh sách.
    .filter((s) => !wrongEpisode(namesOf(s), season, episode))
    .map((s) => {
      // MovieReleaseName có thể là NHIỀU bản, mỗi bản một dòng — bản phụ đề khớp
      // được với tất cả. Tách ra để chấm từng bản, và để nhãn khỏi xuống dòng.
      const releases = lines(s.MovieReleaseName);
      const judged = releaseScore(filename, namesOf(s));
      return {
        id: String(s.IDSubtitleFile),
        release: releases[0] || String(s.SubFileName || '').trim() || 'phụ đề',
        moreReleases: Math.max(0, releases.length - 1),
        downloads: downloads(s),
        encoding: s.SubEncoding || 'UTF-8',
        url: s.SubDownloadLink,
        uploader: String(s.UserNickName || '').trim(),
        rank: String(s.UserRank || '').trim(),
        trusted: s.SubFromTrusted === '1' || s.SubFromTrusted === 1,
        machine: s.SubAutoTranslation === '1' || s.SubAutoTranslation === 1,
        hearingImpaired: s.SubHearingImpaired === '1' || s.SubHearingImpaired === 1,
        translator: String(s.SubTranslator || '').replace(/\s*\(\d+\)\s*$/, '').trim(),
        comment: oneLine(lines(s.SubAuthorComment)[0]),
        score: judged.score,
        verdict: judged.verdict,
      };
    });

  // Lượt tải chỉ là tiêu chí phụ. Khi Stremio không gửi kèm tên tệp thì mọi
  // mục đều 0 điểm, và lúc đó lượt tải thành tiêu chí duy nhất — đúng như cách
  // cũ, vì không biết đang xem bản nào thì chẳng có gì hơn để dựa vào.
  return ranked
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
  let text;
  try {
    text = new TextDecoder(label).decode(raw);
  } catch {
    // Nhãn bảng mã lạ làm TextDecoder ném ngay lúc dựng — lùi về UTF-8.
    text = new TextDecoder('utf-8').decode(raw);
  }

  // File ASS nguyên bản: Stremio không dựng được cue nào từ nó, phải đổi hẳn
  // sang SRT chứ dọn thẻ thôi không đủ.
  if (isAss(text)) return assToSrt(text);

  // Còn lại là SRT đã đổi từ ASS nhưng thẻ định dạng vẫn nằm trong lời thoại.
  return cleanSubtitle(text);
}
