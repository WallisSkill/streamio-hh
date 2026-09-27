import { CONFIG } from '../config.js';
import { safe } from '../lib/http.js';
import { cached } from '../lib/cache.js';
import { detectSeason, decodeEntities } from '../lib/text.js';

/**
 * HH3D (hoathinh3d) — trang tìm kiếm, trang phim, và link từng tập.
 *
 * Module này chỉ đọc mấy trang công khai để biết phim nào có tập nào. Việc biến
 * một trang tập thành link phát nằm ở `lib/hh3dPlayer.js`.
 *
 * Hai thứ đã đổi so với bản trước, và đổi vì đo lại chứ không vì đoán:
 *
 *   • Không cần curl nữa. Trước đây site trả 403 cho fetch của Node và 200 cho
 *     curl, nên phần này chạy qua tiến trình con — và vì Workers không có tiến
 *     trình con, HH3D tắt vĩnh viễn ở đó. Trên hoathinh3d.de thì fetch thường
 *     được 200, kể cả từ Worker.
 *   • Không cần giãn cách 1.5 giây giữa các request nữa: sáu trang phim gọi
 *     song song đều trả 200 trong 650ms (đo 22/09/2026). Cache vẫn giữ.
 *
 * Trang phim chỉ ghi tên tiếng Việt, không có tên gốc — nên tìm HH3D bằng tên
 * tiếng Anh của Cinemeta gần như luôn ra rỗng. Người gọi phải đưa tên tiếng Việt
 * vào, và tên đó lấy từ mục đã khớp ở KKPhim/Nguồn C (xem handlers/stream.js).
 */

const RX_ARTICLE = /<article[^>]*class="[^"]*grid-item[^"]*"[\s\S]*?(?=<article|<\/main|$)/g;
const RX_THUMB = /<a[^>]*class="halim-thumb"[^>]*href="([^"]+)"[^>]*title="([^"]*)"/;
const RX_ENTRY = /<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]*)/;
const RX_ORIG = /<p[^>]*class="[^"]*original_title[^"]*"[^>]*>([^<]*)/;
const RX_EPISODE_LINK = /href="(https?:[/][/][^"]*[/]xem-phim-[^"]+[/]tap-([0-9]+)-sv([0-9]+)[.]html)"/g;
const RX_SHOW_URL = /^https?:[/][/][^/]+[/][a-z0-9-]+[/]?$/i;

/** Một trang công khai của HH3D, kèm URL cuối sau chuyển hướng. */
async function fetchPage(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(CONFIG.httpTimeout),
    headers: {
      'user-agent': CONFIG.userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return { body: await res.text(), finalUrl: res.url };
}

/** Search hh3d. Note: a single strong match makes WordPress redirect to the show page. */
export async function search(keyword) {
  if (!keyword || !CONFIG.enableHh3d) return [];
  const url = `${CONFIG.hh3dBase}/?s=${encodeURIComponent(keyword)}`;
  const res = await safe(cached(`hh3d:search:${keyword}`, () => fetchPage(url)), 'hh3d-search');
  if (!res) return [];
  const { body, finalUrl } = res;

  const out = [];
  for (const block of body.match(RX_ARTICLE) || []) {
    const thumb = RX_THUMB.exec(block);
    if (!thumb) continue;
    const link = thumb[1];
    if (!RX_SHOW_URL.test(link)) continue;
    const name = decodeEntities(RX_ENTRY.exec(block)?.[1] || thumb[2]);
    const origRaw = decodeEntities(RX_ORIG.exec(block)?.[1] || '');
    const yearMatch = /\((\d{4})\)/.exec(origRaw);
    const originName = origRaw.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    out.push(toCandidate({ link, name, originName, year: yearMatch ? Number(yearMatch[1]) : null }));
  }

  // search collapsed straight to a show page
  if (!out.length && finalUrl && !/[?&]s=|\/search\//.test(finalUrl) && RX_SHOW_URL.test(finalUrl)) {
    const name = decodeEntities(/<title>([^<]*)<\/title>/.exec(body)?.[1] || '')
      .replace(/\s*[|–-]\s*HH3D.*$/i, '')
      .replace(/\s*Tập\s*\d+.*$/i, '')
      .trim();
    if (name) out.push(toCandidate({ link: finalUrl, name, originName: '', year: null }));
  }
  return out;
}

function toCandidate({ link, name, originName, year }) {
  const slug = new URL(link).pathname.replace(/^\/+|\/+$/g, '');
  return {
    source: 'hh3d',
    slug,
    url: link.replace(/\/+$/, ''),
    name,
    originName,
    altNames: [],
    year,
    type: 'hoathinh',
    imdbId: null,
    tmdbId: null,
    season: detectSeason(name, originName),
  };
}

/** Read the show page and collect which episodes exist. */
export async function detail(slug) {
  if (!slug || !CONFIG.enableHh3d) return null;
  return cached(`hh3d:detail:${slug}`, async () => {
    const res = await safe(fetchPage(`${CONFIG.hh3dBase}/${slug}`), 'hh3d-detail');
    if (!res) return null;
    const { body } = res;

    const byNum = new Map();
    RX_EPISODE_LINK.lastIndex = 0;
    let m;
    while ((m = RX_EPISODE_LINK.exec(body))) {
      const num = Number(m[2]);
      if (!byNum.has(num)) {
        byNum.set(num, { label: `Tập ${num}`, num, isSpecial: false, isFull: false, page: m[1] });
      }
    }
    if (!byNum.size) return null;

    const name = decodeEntities(/<h1[^>]*>([^<]*)/.exec(body)?.[1] || slug);
    const episodes = [...byNum.values()].sort((a, b) => a.num - b.num);
    return {
      source: 'hh3d',
      slug,
      url: `${CONFIG.hh3dBase}/${slug}`,
      name,
      originName: decodeEntities(RX_ORIG.exec(body)?.[1] || ''),
      altNames: [],
      year: null,
      type: 'hoathinh',
      imdbId: null,
      tmdbId: null,
      season: detectSeason(name),
      servers: [{ name: 'HH3D', episodes }],
      maxEpisode: Math.max(...episodes.map((e) => e.num)),
    };
  });
}
