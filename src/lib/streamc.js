import { CONFIG } from '../config.js';
import { cached } from './cache.js';
import { viaStremioProxy } from './embed.js';

/**
 * streamc.xyz (Nguồn C) -> a playlist Stremio can play.
 *
 * The player page no longer carries anything playable in its markup: since the
 * `r25` rewrite it ships an empty `#player` plus one bootstrap object naming
 * its own URL as an API, and everything else is asked for over that API:
 *
 *   POST embed.php?hash=…  {"action":"bootstrap"}  -> { bootstrap: <jwt>, turnstileEnabled }
 *   POST embed.php?hash=…  {"action":"issue", bootstrap, playlist_format}
 *                                                 -> { playlist, issuedAt, expiresAt }
 *
 * Two details decide whether the result is usable:
 *
 *   • `playlist_format`. The page asks for 'aesgcm-v2' everywhere except Apple
 *     devices, and that one arrives AES-GCM encrypted for its own JS to undo —
 *     unplayable outside a browser. Asking for 'hls', the format it serves
 *     Safari, returns a plain media playlist instead.
 *   • the segments. They are MPEG-TS bytes named `.png` on a separate host that
 *     answers 403 to any request without a Referer, and Stremio's player sends
 *     none — so each one is rewritten through the viewer's own streaming server
 *     (see viaStremioProxy), which replays it with the Referer attached.
 *
 * The playlist itself is fetched here rather than handed over, because the
 * Cloudflare edge in front of streamc answers 403 to the streaming server while
 * letting this addon through — and because the segment lines have to be
 * rewritten one by one anyway.
 *
 * `turnstileEnabled` is the site's own switch for a Cloudflare Turnstile
 * challenge. It is off at the time of writing; when it is on, the grant needs a
 * solved challenge, which this addon does not attempt — it returns null and the
 * episode falls back to an external link.
 */

const HOST = /(^|[.])streamc[.]xyz$/i;

/** True for the embed hosts this module knows how to talk to. */
export function isStreamc(url) {
  try {
    return HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** One POST to the embed's own URL, which doubles as its API endpoint. */
async function api(embed, body) {
  const origin = new URL(embed).origin;
  const res = await fetch(embed, {
    method: 'POST',
    // The endpoint checks the caller's Origin and answers 403 `wrong_origin`
    // without it, so both header and page URL are stated explicitly.
    headers: {
      'user-agent': CONFIG.userAgent,
      'content-type': 'application/json',
      accept: 'application/json',
      referer: embed,
      origin,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CONFIG.httpTimeout),
  });
  if (!res.ok) throw new Error(`streamc ${body.action}: HTTP ${res.status}`);
  return res.json();
}

/**
 * The frame the grant is issued for.
 *
 * bootstrap hashes whatever origins it is told the player sits inside, and
 * `issue` checks its own list against those hashes — so both calls must name
 * the same one, and Nguồn C is where these embeds really are used.
 */
const frames = () => [CONFIG.nguoncApi];

/** { playlist, expiresAt } for an embed, or null when the site withholds it. */
export async function issuePlaylist(embed) {
  return cached(
    `streamc:issue:${embed}`,
    async () => {
      const boot = await api(embed, {
        action: 'bootstrap',
        referrer: `${CONFIG.nguoncApi}/`,
        frame_origins: frames(),
      });
      if (!boot?.bootstrap) return null;
      // Challenge turned on -> no grant without solving it. Stop here.
      if (boot.turnstileEnabled) return null;

      const issued = await api(embed, {
        action: 'issue',
        bootstrap: boot.bootstrap,
        turnstile_response: '',
        playlist_format: 'hls',
        pretty_url: true,
        path_chunks: true,
        frame_origins: frames(),
      });
      if (!issued?.playlist) return null;
      return { playlist: issued.playlist, format: issued.playlistFormat || null, expiresAt: issued.expiresAt || null };
    },
    CONFIG.embedTtl,
  );
}

/** Absolute URL of a playlist line, resolved against the playlist itself. */
const absolute = (line, base) => {
  try {
    return new URL(line, base).href;
  } catch {
    return null;
  }
};

/**
 * Every URL in the playlist, sent through the viewer's streaming server so it
 * arrives with the Referer its host demands. Comments pass through untouched,
 * except `#EXT-X-KEY`, whose URI is a fetch like any other.
 */
function rewrite(text, playlistUrl, referer) {
  const proxy = (raw) => {
    const url = absolute(raw, playlistUrl);
    return url ? viaStremioProxy(url, { Referer: referer }) : raw;
  };

  return text
    .split(/\r?\n/)
    .map((line) => {
      const s = line.trim();
      if (!s) return line;
      if (s.startsWith('#')) {
        return s.startsWith('#EXT-X-KEY')
          ? s.replace(/URI="([^"]+)"/, (_, uri) => `URI="${proxy(uri)}"`)
          : line;
      }
      return proxy(s);
    })
    .join('\n');
}

/**
 * Embed URL -> playlist text ready to hand to Stremio, or null.
 *
 * A master playlist (variant streams) would need its children rewritten too,
 * which nothing here does — the 'hls' format serves a flat media playlist, and
 * anything else is reported as unsupported rather than served half-working.
 */
export async function playlistFor(embed) {
  const issued = await issuePlaylist(embed);
  if (!issued) return null;

  const referer = `${new URL(embed).origin}/`;
  const res = await fetch(issued.playlist, {
    headers: { 'user-agent': CONFIG.userAgent, referer },
    signal: AbortSignal.timeout(CONFIG.httpTimeout),
  });
  if (!res.ok) throw new Error(`streamc playlist: HTTP ${res.status}`);

  const text = await res.text();
  if (!/^#EXTM3U/.test(text.trim())) throw new Error('streamc playlist: không phải m3u8');
  if (/#EXT-X-STREAM-INF/.test(text)) return null;

  return { body: rewrite(text, issued.playlist, referer), via: 'grant', issued };
}

/**
 * What streamc says to THIS deployment, step by step.
 *
 * The three calls fail independently and for different reasons — the page is a
 * plain GET, the grant is a POST its edge treats differently, and the playlist
 * is a signed URL — so a single "403" tells you nothing about which one to fix.
 * Cloudflare's own headers come back too: they name who refused.
 */
export async function diagnose(embed) {
  const origin = new URL(embed).origin;
  const step = async (label, init) => {
    const started = Date.now();
    const { url = embed, ...rest } = init;
    try {
      const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(CONFIG.httpTimeout) });
      const body = await res.text();
      return {
        label,
        url,
        status: res.status,
        ms: Date.now() - started,
        server: res.headers.get('server') || null,
        cfRay: res.headers.get('cf-ray') || null,
        cfMitigated: res.headers.get('cf-mitigated') || null,
        contentType: res.headers.get('content-type') || null,
        snippet: body.slice(0, 160),
      };
    } catch (err) {
      return { label, status: null, ms: Date.now() - started, error: err.message };
    }
  };

  const page = await step('GET page', {
    headers: { 'user-agent': CONFIG.userAgent, accept: 'text/html', referer: `${CONFIG.nguoncApi}/` },
  });
  const boot = await step('POST bootstrap', {
    method: 'POST',
    headers: {
      'user-agent': CONFIG.userAgent,
      'content-type': 'application/json',
      accept: 'application/json',
      referer: embed,
      origin,
    },
    body: JSON.stringify({ action: 'bootstrap', referrer: `${CONFIG.nguoncApi}/`, frame_origins: frames() }),
  });
  return { steps: [page, boot] };
}

/**
 * Dựng playlist từ CDN, không qua streamc.
 *
 * Vì sao phải có đường này: Cloudflare Workers không gọi được streamc — zone đó
 * chặn sạch traffic đi từ Worker (403 sau 3ms, kể cả file .js tĩnh, kể cả khi
 * giả đủ bộ header trình duyệt). Nhưng CDN chứa segment lại là tên miền khác và
 * Worker gọi được bình thường, nên playlist có thể dựng lại từ đó.
 *
 * Ba mảnh cần có, và cách lấy từng mảnh:
 *
 *   • Đường dẫn. Segment nằm ở `https://<host>/<hash>/streamaaa0000.png`, với
 *     `hash` chính là tham số hash trong URL embed — thứ API nguonc đã trả về.
 *     Đánh số liên tục từ 0000, là MPEG-TS đội lốt .png.
 *   • Host. Mỗi server embed có đúng một CDN của nó (đo 22/09/2026, bảng dưới).
 *     Một video chỉ nằm trên một host — các host không dùng chung dữ liệu, nên
 *     host sai thì 404 và phải dò tiếp cả danh sách.
 *   • Số đoạn và độ dài. Không nơi nào công bố, nên đo: số đoạn bằng cách dò
 *     nhị phân xem segment thứ n có tồn tại không, độ dài bằng cách đọc mốc
 *     thời gian PCR trong chính file TS.
 *
 * Playlist dựng ra không mang token nào — link CDN không hết hạn — nên nó cache
 * được lâu, khác với playlist do streamc cấp (4 giờ).
 *
 * Đánh đổi phải nói rõ: độ dài mỗi đoạn là số đo trung bình của mấy đoạn mẫu,
 * không phải số thật của từng đoạn. Phim phát đúng và liền mạch, nhưng tổng
 * thời lượng lệch được vài phần trăm và tua tới thì lệch trong khoảng một đoạn.
 * Muốn đúng từng đoạn thì phải lấy playlist thật từ streamc, và Worker không
 * gọi được.
 */

/** Server embed -> CDN chứa segment của nó. Ghi đè bằng STREAMC_SEGMENT_HOSTS. */
const SEGMENT_HOSTS = {
  embed1: 'aninnn.hihihoho1.top',
  embed2: 'sings2.amass2.top',
  embed10: 'sings10.amass2.top',
  embed11: 'seouls11.amass11.top',
  embed12: 'cyin1.sbs',
  embed13: 'thais.hihihoho3.top',
  embed14: 'jps14.hihihoho4.top',
  embed15: 'indoss15.amass15.top',
  embed17: 'saus17.amass17.top',
  embed18: 'phili18.amass15.top',
};

function hostTable() {
  const extra = String(CONFIG.streamcSegmentHosts || '')
    .split(',')
    .map((pair) => pair.split('=').map((s) => s.trim()))
    .filter(([key, value]) => key && value);
  return { ...SEGMENT_HOSTS, ...Object.fromEntries(extra) };
}

const segmentUrl = (host, hash, i) =>
  `https://${host}/${hash}/streamaaa${String(i).padStart(4, '0')}.png`;

/** Segment thứ `i` có tồn tại không. Xin 1 byte, vì chỉ cần status. */
async function segmentExists(host, hash, i, referer) {
  try {
    const res = await fetch(segmentUrl(host, hash, i), {
      headers: { 'user-agent': CONFIG.userAgent, referer, range: 'bytes=0-0' },
      signal: AbortSignal.timeout(CONFIG.httpTimeout),
    });
    return res.status === 200 || res.status === 206;
  } catch {
    return false;
  }
}

/**
 * CDN nào đang giữ video này.
 *
 * Thử host trong bảng trước — đúng gần như mọi lần và chỉ tốn một request. Sai
 * thì video đã bị chuyển host (họ đổi CDN theo thời gian), nên dò cả danh sách
 * một lượt song song thay vì bỏ cuộc.
 */
async function findHost(embed, hash, referer) {
  const table = hostTable();
  const server = new URL(embed).hostname.split('.')[0];
  const mapped = table[server];

  if (mapped && (await segmentExists(mapped, hash, 0, referer))) return mapped;

  const rest = [...new Set(Object.values(table))].filter((h) => h !== mapped);
  const hits = await Promise.all(
    rest.map(async (h) => ((await segmentExists(h, hash, 0, referer)) ? h : null)),
  );
  return hits.find(Boolean) || null;
}

/**
 * Có bao nhiêu đoạn.
 *
 * Nhân đôi để khoanh vùng — làm song song vì sáu lần thử tuần tự là sáu vòng
 * chờ mạng — rồi dò nhị phân trong khoảng đã khoanh. Khoảng 17 request cho một
 * phim 300 đoạn, và kết quả được cache nên chỉ tốn ở lần bấm đầu.
 */
async function countSegments(host, hash, referer) {
  const marks = [64, 128, 256, 512, 1024, 2048];
  const found = await Promise.all(marks.map((n) => segmentExists(host, hash, n, referer)));

  let lo = 0;
  let hi = marks[0];
  for (let i = 0; i < marks.length; i++) {
    if (found[i]) {
      lo = marks[i];
      hi = marks[i + 1] ?? marks[i] * 2;
    }
  }

  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (await segmentExists(host, hash, mid, referer)) lo = mid;
    else hi = mid;
  }
  return lo + 1;
}

/**
 * Mốc thời gian PCR trong một khối byte TS.
 *
 * Phải căn lưới trước: gói TS dài 188 byte và mở đầu bằng 0x47, nhưng 0x47 cũng
 * xuất hiện đầy trong payload — không căn thì đọc nhầm rác thành mốc thời gian
 * (đã đo: ra 80000 giây cho một phim 20 phút).
 */
function readPcrs(buf) {
  let base = -1;
  for (let o = 0; o < 188 && o + 188 * 5 < buf.length; o++) {
    let aligned = true;
    for (let k = 0; k < 5; k++) {
      if (buf[o + k * 188] !== 0x47) {
        aligned = false;
        break;
      }
    }
    if (aligned) {
      base = o;
      break;
    }
  }
  if (base < 0) return [];

  const out = [];
  for (let i = base; i + 188 <= buf.length; i += 188) {
    const adaptation = (buf[i + 3] >> 4) & 0x03;
    if (adaptation !== 2 && adaptation !== 3) continue;
    if (buf[i + 4] < 7) continue;
    if (!(buf[i + 5] & 0x10)) continue; // PCR_flag
    const b = buf.subarray(i + 6);
    const ticks = b[0] * 2 ** 25 + b[1] * 2 ** 17 + b[2] * 2 ** 9 + b[3] * 2 + (b[4] >> 7);
    out.push(ticks / 90000);
  }
  return out;
}

/** Độ dài một đoạn: mốc cuối trừ mốc đầu của chính file đó. */
async function segmentSeconds(host, hash, i, referer) {
  const grab = async (range) => {
    try {
      const res = await fetch(segmentUrl(host, hash, i), {
        headers: { 'user-agent': CONFIG.userAgent, referer, range },
        signal: AbortSignal.timeout(CONFIG.httpTimeout),
      });
      if (!res.ok) return [];
      return readPcrs(new Uint8Array(await res.arrayBuffer()));
    } catch {
      return [];
    }
  };
  // 64 KB mỗi đầu: theo chuẩn thì PCR phải xuất hiện ít nhất mỗi 100ms, nhưng
  // cửa sổ 9 KB đã đo là có lúc không chứa mốc nào.
  const [head, tail] = await Promise.all([grab('bytes=0-65535'), grab('bytes=-65536')]);
  if (!head.length || !tail.length) return null;
  const seconds = tail[tail.length - 1] - head[0];
  return seconds > 0 && seconds < 60 ? seconds : null;
}

/**
 * Playlist cho một embed, đường nào lấy được thì dùng đường đó.
 *
 * Playlist thật của streamc là bản đúng từng đoạn, nên thử trước — chạy được ở
 * máy nhà và trên mọi host Cloudflare không chặn. Thất bại thì dựng lại từ CDN,
 * đường duy nhất còn sống trên Workers.
 */
export async function playlistOf(embed) {
  try {
    const real = await playlistFor(embed);
    if (real) return real;
  } catch {
    // Không cần biết vì sao: bước sau không phụ thuộc bước này.
  }
  return playlistFromCdn(embed);
}

/** Playlist dựng từ CDN cho một embed, hoặc null nếu không tìm ra video. */
export async function playlistFromCdn(embed) {
  return cached(
    `streamc:cdn:${embed}`,
    async () => {
      const hash = new URL(embed).searchParams.get('hash');
      if (!hash) return null;
      const referer = `${new URL(embed).origin}/`;

      const host = await findHost(embed, hash, referer);
      if (!host) return null;

      const count = await countSegments(host, hash, referer);

      // Mẫu rải khắp phim: đoạn cuối thường ngắn hơn hẳn nên đo riêng, còn lại
      // lấy trung bình của mấy đoạn giữa.
      const picks = [...new Set([0, count >> 2, count >> 1, (count * 3) >> 2])].filter(
        (i) => i < count - 1,
      );
      const samples = (
        await Promise.all(picks.map((i) => segmentSeconds(host, hash, i, referer)))
      ).filter((v) => v != null);
      const last = count > 1 ? await segmentSeconds(host, hash, count - 1, referer) : null;

      const each = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 10;
      const target = Math.ceil(Math.max(each, last ?? 0));

      const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        `#EXT-X-TARGETDURATION:${target}`,
        '#EXT-X-MEDIA-SEQUENCE:0',
      ];
      for (let i = 0; i < count; i++) {
        const seconds = i === count - 1 && last ? last : each;
        lines.push(`#EXTINF:${seconds.toFixed(6)},`);
        lines.push(viaStremioProxy(segmentUrl(host, hash, i), { Referer: referer }));
      }
      lines.push('#EXT-X-ENDLIST');

      return {
        body: lines.join('\n'),
        via: 'cdn',
        host,
        count,
        each: Number(each.toFixed(3)),
        sampled: samples.length,
      };
    },
    CONFIG.cacheTtl,
  );
}
