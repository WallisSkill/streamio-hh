import { CONFIG } from '../config.js';
import { cacheGet, cacheSet } from './cache.js';

/**
 * HH3D (hoathinh3d) -> một playlist Stremio phát được.
 *
 * Trước đây nguồn này chỉ tạo ra link mở trang, vì link phát không nằm trong
 * HTML. Nó nằm sau ba lớp, và cả ba đều mở ra được bằng HTTP thường:
 *
 *   1. `player.php?episode_slug=&server_id=&post_id=` trả về một gói mã hoá
 *      `{ _encrypted, v, kid, iv, payload }`. Nó đòi đúng ba header: Referer là
 *      trang tập (thiếu thì 404), `X-Requested-With: XMLHttpRequest`, và
 *      `X-Halim-Client` — một chuỗi ngẫu nhiên do player tự sinh, giá trị nào
 *      cũng được, chỉ cần có và giữ nguyên trong cả phiên.
 *   2. `POST /wp-json/halim/v1/player-key { key_id: kid }` trả về khoá. Khoá
 *      dùng MỘT LẦN và gắn với phiên: gọi mà không mang cookie của chính request
 *      lấy gói ở bước 1 thì nhận `player_key_expired`. Nên cả luồng phải đi
 *      chung một giỏ cookie.
 *   3. Giải AES-GCM (khoá 32 byte, iv 12 byte, cả hai base64url) ra JSON, trong
 *      đó `file` là một playlist HLS VOD thật — và nó không đòi header gì cả.
 *
 * Còn một lớp nữa nằm ở segment: mỗi segment bị bọc một ảnh PNG 1x1 dài đúng 70
 * byte ở đầu, MPEG-TS bắt đầu từ byte 70 (đo trên nhiều segment rải khắp phim:
 * IEND ở 62, gói TS 188 byte lặp đúng từ 70). Player của họ cắt phần đó trong JS
 * rồi dựng blob. Ở đây không cần đụng tới byte nào: playlist trả cho Stremio
 * ghi thêm `#EXT-X-BYTERANGE:<dài>@70` cho mỗi segment, và chính người chơi bỏ
 * qua 70 byte đầu bằng một request Range.
 *
 * Độ dài lấy trần rất lớn thay vì số thật, vì số thật đòi một HEAD cho mỗi
 * segment — 700 request cho một tập. CDN tự kẹp về hết file khi Range vượt quá,
 * và ffmpeg (đúng bản Stremio dùng) đọc được.
 *
 * Nhờ vậy nguồn này không cần server nội bộ của Stremio: segment đi thẳng từ
 * máy người xem tới CDN, không header, không proxy.
 */

/** Trần cho #EXT-X-BYTERANGE: lớn hơn mọi segment thực tế (đo: tối đa ~2 MB). */
const RANGE_CAP = 20_000_000;

/** Số byte PNG chèn trước dữ liệu TS. */
const PNG_PREFIX = 70;

const b64url = (value) => {
  const norm = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
};

/**
 * Một phiên HTTP có giỏ cookie.
 *
 * Bắt buộc phải có: khoá player gắn với phiên, nên request lấy gói mã hoá và
 * request lấy khoá phải mang cùng cookie. fetch() không tự giữ cookie.
 */
function session() {
  const jar = new Map();
  return {
    cookie: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
    async go(url, init = {}) {
      const res = await fetch(url, { ...init, redirect: 'follow', signal: AbortSignal.timeout(CONFIG.httpTimeout) });
      for (const raw of res.headers.getSetCookie?.() || []) {
        const [pair] = raw.split(';');
        const at = pair.indexOf('=');
        if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
      }
      return res;
    },
  };
}

/** Chuỗi ngẫu nhiên đóng vai X-Halim-Client, như player tự sinh trong sessionStorage. */
const clientId = () =>
  [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** `/xem-phim-<slug>/tap-288-sv1.html` -> { episode: 'tap-288', server: '1' } */
export function parseEpisodeUrl(pageUrl) {
  const m = /\/(tap-[^/]+?)(?:-sv(\d+))?\.html$/.exec(new URL(pageUrl).pathname);
  if (!m) return null;
  return { episode: m[1], server: m[2] || '1' };
}

/** Cấu hình player đã giải mã cho một trang tập, hoặc null. */
async function playerConfig(pageUrl) {
  const parsed = parseEpisodeUrl(pageUrl);
  if (!parsed) return null;

  const origin = new URL(pageUrl).origin;
  const client = clientId();
  const s = session();

  // Trang tập trước: nó vừa cho post_id vừa mở phiên (cookie).
  const pageRes = await s.go(pageUrl, { headers: { 'user-agent': CONFIG.userAgent } });
  if (!pageRes.ok) return null;
  const postId = /"post_id":\s*"?(\d+)/.exec(await pageRes.text())?.[1];
  if (!postId) return null;

  const headers = () => ({
    'user-agent': CONFIG.userAgent,
    referer: pageUrl,
    'x-requested-with': 'XMLHttpRequest',
    'x-halim-client': client,
    cookie: s.cookie(),
  });

  const cfgUrl =
    `${origin}/wp-content/themes/halimmovies/player.php` +
    `?episode_slug=${encodeURIComponent(parsed.episode)}&server_id=${encodeURIComponent(parsed.server)}` +
    `&subsv_id=&post_id=${postId}`;
  const cfg = await (await s.go(cfgUrl, { headers: headers() })).json().catch(() => null);
  if (!cfg?._encrypted || !cfg.kid || !cfg.iv || !cfg.payload) return null;

  const keyRes = await s.go(`${origin}/wp-json/halim/v1/player-key`, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({ key_id: cfg.kid }),
  });
  const keyJson = await keyRes.json().catch(() => null);
  if (!keyJson?.key) return null;

  const key = await crypto.subtle.importKey('raw', b64url(keyJson.key), { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64url(cfg.iv), tagLength: 128 },
    key,
    b64url(cfg.payload),
  );
  const data = JSON.parse(new TextDecoder().decode(plain));

  // Tập không có nguồn phát trả về { data: { sources: "" } } — đúng hình dạng
  // nhưng rỗng, nên phải xét `file` chứ không xét `status`.
  return data?.file ? { file: data.file, label: data.label || null, skip: Number(data.skip_time) || 0 } : null;
}

/**
 * Trang tập HH3D -> playlist phát được, hoặc null.
 *
 * Cache theo trang tập: link CDN trong playlist không mang token nên sống lâu,
 * còn URL playlist gốc thì có token hết hạn sau khoảng một giờ — nên cái được
 * giữ lại là playlist đã viết lại, không phải URL gốc.
 */
export async function playlistFor(pageUrl) {
  const hit = cacheGet(`hh3d:playlist:${pageUrl}`);
  if (hit) return hit;

  const built = await build(pageUrl);
  // Chỉ cache khi có kết quả. Luồng này chập chờn — đo 22/09/2026: cùng một tập
  // 2 lần được 1 lần trượt — nên cache cả lần trượt là biến một cái vấp mạng
  // thành nửa tiếng phim không phát được, đúng cái bẫy getAliases từng mắc.
  return built ? cacheSet(`hh3d:playlist:${pageUrl}`, built, CONFIG.cacheTtl) : null;
}

/**
 * Dựng playlist, thử lại một lần.
 *
 * Khoá player dùng một lần và gắn với phiên, nên khi trượt thì phải đi lại từ
 * đầu bằng phiên mới chứ không gọi lại riêng bước lấy khoá.
 */
async function build(pageUrl) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const out = await once(pageUrl);
    if (out) return out;
  }
  return null;
}

async function once(pageUrl) {
  const config = await playerConfig(pageUrl);
  if (!config) return null;

  const res = await fetch(config.file, {
    headers: { 'user-agent': CONFIG.userAgent },
    signal: AbortSignal.timeout(CONFIG.httpTimeout),
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!/^#EXTM3U/.test(text.trim())) return null;

  // Playlist nhiều chất lượng thì từng dòng con lại là một playlist nữa,
  // và ghi BYTERANGE lên đó là sai — báo không xử lý được thay vì trả bừa.
  if (/#EXT-X-STREAM-INF/.test(text)) return null;

  let segments = 0;
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      lines.push(line);
      continue;
    }
    segments += 1;
    lines.push(`#EXT-X-BYTERANGE:${RANGE_CAP}@${PNG_PREFIX}`);
    lines.push(new URL(line, config.file).href);
  }
  if (!segments) return null;
  if (!lines.includes('#EXT-X-ENDLIST')) lines.push('#EXT-X-ENDLIST');

  const seconds = [...text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  return {
    body: lines.join('\n'),
    segments,
    seconds: Number(seconds.toFixed(1)),
    label: config.label,
    skip: config.skip,
  };
}
