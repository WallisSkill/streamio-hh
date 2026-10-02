import { CONFIG } from '../config.js';
import { cacheGet, cacheSet } from './cache.js';
import { hh3dBase } from './hh3dBase.js';

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
 * Còn một lớp nữa nằm ở segment, và chỗ này tôi từng đoán sai: một SỐ phim có
 * segment bị bọc một ảnh PNG 1x1 ở đầu (IEND ở byte 62, MPEG-TS bắt đầu từ byte
 * 70), nhưng phần lớn thì không bọc gì cả — TS bắt đầu ngay byte 0. Đo 27/09/2026
 * trên bốn phim: chỉ Thế Giới Hoàn Mỹ bị bọc, ba phim còn lại không.
 *
 * Nên độ lệch phải ĐO cho từng phim, đừng cắt cứng (xem tsOffset). Cắt 70 byte
 * của một phim không bọc là cắt mất 70 byte giữa gói TS đầu tiên: ffmpeg tự dò
 * lại nên trên PC không thấy gì, còn player chặt chẽ hơn phải dò lại ở từng
 * segment và xem bị lag — đúng triệu chứng "PC thì mượt, điện thoại thì lag".
 *
 * Từ đó playlist dựng theo hai cách:
 *
 *   • Phim không bọc (phần lớn): trỏ thẳng CDN, không range, không proxy. HLS
 *     thường, đúng chuẩn, player nào cũng đọc được, và không tốn băng thông của
 *     addon — segment đi thẳng từ máy người xem tới CDN.
 *   • Phim có bọc: trỏ qua /hh3d-seg của chính addon, chỗ đó bỏ đúng số byte đã
 *     đo rồi giao phần còn lại. Vẫn là HLS thường, không dùng `#EXT-X-BYTERANGE`
 *     nữa vì độ dài thật chỉ biết được bằng một HEAD cho mỗi segment (649 request
 *     một tập), mà khai độ dài không đúng là thứ RFC 8216 cấm và cũng là thứ làm
 *     player chặt chẽ thử lại liên tục.
 *
 * Cả hai cách đều không cần server nội bộ của Stremio, khác Nguồn C.
 */

/**
 * Trần cho `#EXT-X-BYTERANGE` ở chế độ cũ (HH3D_DIRECT_SEGMENTS=1).
 *
 * Lớn hơn mọi segment thực tế, và đó chính là chỗ sai: RFC 8216 đòi độ dài phải
 * đúng, còn độ dài thật thì phải HEAD từng segment mới biết — 649 request một
 * tập. ffmpeg bỏ qua chuyện đó nên Stremio trên PC vẫn mượt, player chặt chẽ hơn
 * thì thử lại liên tục và sinh ra lag. Chế độ này giữ lại để so sánh và cho ai
 * muốn không đẩy byte qua addon.
 */
const RANGE_CAP = 20_000_000;

/**
 * Dữ liệu TS bắt đầu ở byte thứ mấy của một segment.
 *
 * Đây là chỗ tôi từng đoán sai và phải đo mới ra: KHÔNG phải phim nào cũng bị
 * bọc. Đo 27/09/2026 trên bốn phim, mỗi phim ba segment rải khắp:
 *
 *   Thế Giới Hoàn Mỹ tập 288   -> PNG 1x1 ở đầu, TS bắt đầu ở byte 70
 *   Đại Chúa Tể tập 1          -> không bọc, TS ở byte 0
 *   Tiên Nghịch tập 1          -> không bọc
 *   Thôn Phệ Tinh Không tập 141 -> không bọc
 *
 * Trong một phim thì các segment giống nhau, nên đo một segment là đủ cho cả
 * playlist. Cắt cứng 70 byte cho mọi phim là cắt mất 70 byte GIỮA gói TS đầu
 * tiên của ba phần tư số phim: ffmpeg tự dò lại nên trên PC không thấy gì, còn
 * player chặt chẽ hơn thì phải dò lại ở từng segment và xem bị lag.
 *
 * Tìm bằng cách soi lưới: gói TS dài 188 byte và mở đầu bằng 0x47, nên vị trí
 * đúng là chỗ có 0x47 lặp lại đúng ba lần cách nhau 188 byte. Không thấy thì trả
 * 0 — giao nguyên văn còn hơn tự cắt theo phỏng đoán.
 */
async function tsOffset(segmentUrl, referer) {
  try {
    const res = await fetch(segmentUrl, {
      headers: { 'user-agent': CONFIG.userAgent, referer, range: 'bytes=0-2047' },
      signal: AbortSignal.timeout(CONFIG.httpTimeout),
    });
    if (!res.ok && res.status !== 206) return 0;
    const b = new Uint8Array(await res.arrayBuffer());
    for (let i = 0; i + 188 * 3 < b.length; i += 1) {
      if (b[i] === 0x47 && b[i + 188] === 0x47 && b[i + 376] === 0x47) return i;
    }
    return 0;
  } catch {
    return 0;
  }
}

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

  // HH3D giao theo hai kiểu, và đổi giữa chúng lúc nào cũng được: `file` là
  // playlist HLS thẳng, `embed_url` là trang player của CDN (xem
  // playlistFromEmbed). Tập không có nguồn phát trả về { data: { sources: "" } }
  // — đúng hình dạng nhưng rỗng, nên xét hai trường đó chứ không xét `status`.
  const common = { label: data?.label || null, skip: Number(data?.skip_time) || 0 };
  if (data?.file) return { ...common, file: data.file };
  if (data?.embed_url) return { ...common, embedUrl: data.embed_url };
  return null;
}

/**
 * Trang embed -> nội dung playlist, cho những phim HH3D giao theo kiểu `embed`.
 *
 * Ngày 02/10/2026 HH3D chuyển toàn bộ server sang kiểu này: `player.php` thôi
 * trả `file` mà trả `embed_url` trỏ sang trang player của CDN. Link phát nằm sau
 * hai lớp nữa, cả hai đọc được từ chính trang embed đó:
 *
 *   1. Thẻ `#player` mang hai thuộc tính `data-p` và `data-m`. Mở ra bằng XOR
 *      lặp: khoá là `data-m` ĐẢO CHUỖI rồi base64, dữ liệu là `data-p` base64.
 *      Kết quả là JSON `{ c, k, i, s, ao }` — `s` là đường dẫn stream kèm token
 *      đã ký, `k` và `i` là khoá và IV cho bước sau, `ao` là origin được phép.
 *   2. Tải `s` thì nhận về một khối base64, không phải m3u8. Giải AES-GCM bằng
 *      `k`/`i` mới ra playlist thật.
 *
 * Tìm ra bằng cách đọc tĩnh bundle player 241 KB của họ: nó làm rối theo kiểu
 * obfuscator.io (mảng chuỗi xoay 168 bước, mỗi chuỗi là base64 bảng CHỮ THƯỜNG
 * TRƯỚC rồi RC4 theo khoá riêng từng lời gọi). Dịch 2358 chuỗi ra thì phần
 * `getAttribute("data-p")` và lời gọi `crypto.subtle` lộ nguyên hình. Lúc đầu
 * tôi đoán lớp 1 cũng là AES và thử 40 tổ hợp khoá/IV — sai, nó chỉ là XOR.
 *
 * Lớp bảo vệ này sống hay chết là do họ: tên file bundle băm theo nội dung nên
 * họ build lại lúc nào cũng được. Hỏng thì /probe/hh3d báo ngay ở bước nào.
 */
async function playlistFromEmbed(embedUrl) {
  const referer = `${await hh3dBase()}/`;
  const res = await fetch(embedUrl, {
    headers: { 'user-agent': CONFIG.userAgent, referer },
    signal: AbortSignal.timeout(CONFIG.httpTimeout),
  });
  if (!res.ok) return null;
  const page = await res.text();

  const dataP = /data-p="([^"]+)"/.exec(page)?.[1];
  const dataM = /data-m="([^"]+)"/.exec(page)?.[1];
  if (!dataP || !dataM) return null;

  const key = b64url([...dataM].reverse().join(''));
  const data = b64url(dataP);
  if (!key.length || !data.length) return null;
  const plain = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) plain[i] = data[i] ^ key[i % key.length];

  let grant;
  try {
    grant = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
  if (!grant?.s && !grant?.c) return null;
  if (!grant?.k || !grant?.i) return null;

  const streamUrl = new URL(grant.s || grant.c, embedUrl).href;
  const body = await fetch(streamUrl, {
    headers: { 'user-agent': CONFIG.userAgent, referer: embedUrl },
    signal: AbortSignal.timeout(CONFIG.httpTimeout),
  });
  if (!body.ok) return null;
  const sealed = (await body.text()).trim();

  // Hai đường cùng tồn tại: `s` (đường có token) trả thẳng m3u8, còn `c` trả một
  // khối base64 phải giải AES-GCM. Nhận cả hai thay vì đoán, vì họ đổi được bất
  // cứ lúc nào — và tôi đã mắc đúng chỗ này một lần: fetch `s` rồi vẫn đem đi
  // giải mã, nên hỏng im lặng.
  if (/^#EXTM3U/.test(sealed)) return { text: sealed, base: streamUrl };

  try {
    const aes = await crypto.subtle.importKey('raw', b64url(grant.k), { name: 'AES-GCM' }, false, ['decrypt']);
    const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64url(grant.i) }, aes, b64url(sealed));
    return { text: new TextDecoder().decode(opened), base: streamUrl };
  } catch {
    return null;
  }
}

/** Nội dung playlist của một tập, bất kể HH3D giao theo kiểu nào. */
async function playlistSource(config) {
  if (config.embedUrl) return playlistFromEmbed(config.embedUrl);

  const res = await fetch(config.file, {
    headers: { 'user-agent': CONFIG.userAgent },
    signal: AbortSignal.timeout(CONFIG.httpTimeout),
  });
  if (!res.ok) return null;
  return { text: await res.text(), base: config.file };
}

/**
 * Trang tập HH3D -> playlist phát được, hoặc null.
 *
 * `segmentBase` là địa chỉ /hh3d-seg của chính addon. Có nó thì playlist trỏ
 * segment qua đó — HLS thường, không range, đúng chuẩn, và người chơi nào cũng
 * đọc được. Không có (hoặc HH3D_DIRECT_SEGMENTS=1) thì quay về cách cũ: trỏ
 * thẳng CDN kèm `#EXT-X-BYTERANGE` để người chơi tự bỏ 70 byte đầu — nhanh hơn
 * và không tốn băng thông của addon, nhưng khai độ dài không đúng chuẩn nên chỉ
 * player dễ tính mới mượt.
 *
 * Cache theo cả hai: cùng một tập nhưng hai cách dựng là hai playlist khác nhau.
 */
export async function playlistFor(pageUrl, { segmentBase = null } = {}) {
  const proxied = segmentBase && !CONFIG.hh3dDirectSegments ? segmentBase : null;
  const key = `hh3d:playlist:${proxied ? 'seg' : 'range'}:${pageUrl}`;

  const hit = cacheGet(key);
  if (hit) return hit;

  const built = await build(pageUrl, proxied);
  // Chỉ cache khi có kết quả. Luồng này chập chờn — đo 22/09/2026: cùng một tập
  // 2 lần được 1 lần trượt — nên cache cả lần trượt là biến một cái vấp mạng
  // thành nửa tiếng phim không phát được, đúng cái bẫy getAliases từng mắc.
  return built ? cacheSet(key, built, CONFIG.cacheTtl) : null;
}

/**
 * Dựng playlist, thử lại một lần.
 *
 * Khoá player dùng một lần và gắn với phiên, nên khi trượt thì phải đi lại từ
 * đầu bằng phiên mới chứ không gọi lại riêng bước lấy khoá.
 *
 * Lỗi cũng tính là trượt, không để nó vọt ra ngoài. Hai kiểu trượt đã đo đều tự
 * khỏi ở lần hai: tập trả về sources rỗng (~1/3 lần), và request treo tới hết
 * hạn chờ vì tiến trình sống lâu tái dùng một socket keep-alive đã chết —
 * lần sau đi socket mới.
 */
async function build(pageUrl, segmentBase) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const out = await once(pageUrl, segmentBase);
      if (out) return out;
    } catch (err) {
      last = err;
    }
  }
  if (last) console.warn(`[hh3d-player] ${last.message}`);
  return null;
}

async function once(pageUrl, segmentBase) {
  const config = await playerConfig(pageUrl);
  if (!config) return null;

  const source = await playlistSource(config);
  if (!source) return null;
  const { text, base } = source;
  if (!/^#EXTM3U/.test(text.trim())) return null;

  // Playlist nhiều chất lượng thì từng dòng con lại là một playlist nữa, và viết
  // lại dòng segment lên đó là sai — báo không xử lý được thay vì trả bừa.
  if (/#EXT-X-STREAM-INF/.test(text)) return null;

  const urls = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => new URL(l, base).href);
  if (!urls.length) return null;

  // Đo một segment là đủ: trong cùng một phim chúng giống nhau.
  const offset = await tsOffset(urls[0], `${new URL(pageUrl).origin}/`);

  let segments = 0;
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      lines.push(line);
      continue;
    }
    const at = urls[segments];
    segments += 1;
    if (!offset) {
      // Không bọc gì: trỏ thẳng CDN. Đúng chuẩn, nhanh nhất, và không byte nào
      // của phim đi qua addon.
      lines.push(at);
    } else if (segmentBase) {
      // Trỏ theo TRANG TẬP và số thứ tự, không theo URL của CDN. Nhờ vậy
      // /hh3d-seg không bao giờ tải một địa chỉ do người gọi đặt ra: nó tự dựng
      // lại playlist rồi lấy đúng segment thứ i. Không cần danh sách host CDN —
      // mà danh sách đó cũng đã cũ đúng lúc họ đổi tên miền (CDN đổi theo:
      // m.ckjdsib32rkjvsd.xyz -> scontent-sin11-1.xx.cdnfb.net).
      lines.push(`${segmentBase}?p=${encodeURIComponent(pageUrl)}&i=${segments - 1}`);
    } else {
      lines.push(`#EXT-X-BYTERANGE:${RANGE_CAP}@${offset}`);
      lines.push(at);
    }
  }
  if (!segments) return null;
  if (!lines.includes('#EXT-X-ENDLIST')) lines.push('#EXT-X-ENDLIST');

  const seconds = [...text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  return {
    body: lines.join('\n'),
    via: !offset ? 'direct' : segmentBase ? 'proxy' : 'byterange',
    offset,
    urls,
    segments,
    seconds: Number(seconds.toFixed(1)),
    label: config.label,
    skip: config.skip,
  };
}
