import { CONFIG } from '../config.js';
import { cacheGet, cacheSet, cacheDelete } from './cache.js';

/**
 * Tên miền đang sống của HH3D.
 *
 * Họ đổi tên miền thường xuyên — `hoathinh3d.so` rồi `.de` rồi `.you` chỉ trong
 * một tháng — nên đóng cứng địa chỉ vào code hay vào biến môi trường là hẹn trước
 * một lần hỏng: DNS mất, mọi request timeout, nguồn biến mất khỏi Stremio mà
 * không có dòng log nào nói vì sao.
 *
 * Bản thân họ công bố một link rút gọn luôn trỏ về bản đang sống, nên chỗ này đi
 * theo link đó. Chuỗi chuyển hướng có chặng trung gian (đo 30/09/2026:
 * bit.ly/hh3d -> googie.top -> hoathinh3d.you), nên phải lấy URL CUỐI chứ không
 * phải `Location` của chặng đầu.
 *
 * Và phải soi tên miền cuối trước khi tin: link rút gọn là của người khác, ai đổi
 * đích thì addon đi theo đó mà gọi. Chỉ nhận tên miền còn mang đúng thương hiệu
 * (`HH3D_HOST_HINT`), nên chặng `googie.top` bị loại. Họ đổi hẳn tên thương hiệu
 * thì sửa một biến môi trường, không phải sửa code.
 *
 * `HH3D_BASE` đặt tay vẫn thắng — để ghim khi cần, và để test khỏi phụ thuộc
 * mạng ngoài.
 */

const KEY = 'hh3d:base';

/**
 * Tên miền dùng khi không dò được.
 *
 * Nó cũng sẽ cũ đi như mọi giá trị đóng cứng khác, nhưng ở đây thì vô hại: chỉ
 * tới lượt nó khi link rút gọn không trả lời, và thà thử một tên miền có thể đã
 * chết còn hơn không thử gì.
 */
const FALLBACK = 'https://hoathinh3d.you';

/**
 * Header giả một lượt mở trang bằng trình duyệt.
 *
 * Từ 15/11/2026 họ bật Cloudflare challenge: chỉ `user-agent` thôi là 403 ngay ở
 * biên (đo 2ms, `cf-mitigated: challenge`), còn thêm đủ `accept` + `sec-fetch-*`
 * + `sec-ch-ua` thì 200 (đo 29ms, 75KB) — kể cả từ IP của Cloudflare Workers.
 * Nghĩa là họ lọc theo dấu vết request chứ không theo IP, nên thiếu cụm header
 * này là cả nguồn HH3D tắt, không phải lag hay chậm.
 *
 * `kind: 'xhr'` cho mấy lời gọi nền của chính trang (player.php, player-key):
 * trình duyệt gửi `sec-fetch-*` khác hẳn lúc mở trang, mà khớp đúng vai mới an
 * toàn — hai cụm này không được lẫn vào nhau.
 */
export function hh3dHeaders(kind = 'document', extra = {}) {
  const common = {
    'user-agent': CONFIG.userAgent,
    'accept-language': 'vi,en-US;q=0.9,en;q=0.8',
    'sec-ch-ua': '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };
  const role =
    kind === 'xhr'
      ? {
          accept: 'application/json, text/javascript, */*; q=0.01',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
        }
      : {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'upgrade-insecure-requests': '1',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': extra.referer ? 'same-origin' : 'none',
          'sec-fetch-user': '?1',
        };
  return { ...common, ...role, ...extra };
}

/** Tên miền dò được gần nhất, dùng khi lần dò sau thất bại. */
let lastGood = null;

const looksRight = (origin) => {
  try {
    return new URL(origin).hostname.toLowerCase().includes(CONFIG.hh3dHostHint);
  } catch {
    return false;
  }
};

async function resolve() {
  try {
    const res = await fetch(CONFIG.hh3dShortlink, {
      redirect: 'follow',
      headers: hh3dHeaders(),
      signal: AbortSignal.timeout(CONFIG.httpTimeout),
    });
    // KHÔNG đòi res.ok: tên miền mới (hoathinh3d.pw) bật Cloudflare challenge nên
    // trả 403 cho request không phải trình duyệt. Trạng thái đó nói về TRANG, còn
    // chỗ chuyển hướng đến vẫn là tên miền đúng — bỏ nó đi là rơi về tên miền
    // dự phòng đã chết, và cả nguồn HH3D tắt theo.
    const origin = new URL(res.url).origin;
    return looksRight(origin) ? origin : null;
  } catch {
    return null;
  }
}

/** Địa chỉ gốc của HH3D, không có dấu `/` cuối. */
export async function hh3dBase() {
  if (CONFIG.hh3dBase) return CONFIG.hh3dBase;

  const hit = cacheGet(KEY);
  if (hit) return hit;

  const found = await resolve();
  if (!found) return lastGood || FALLBACK;

  lastGood = found;
  return cacheSet(KEY, found, CONFIG.hh3dBaseTtl);
}

/**
 * Quên tên miền đã dò, để lần gọi sau dò lại.
 *
 * Gọi khi request tới HH3D chết ở tầng mạng — dấu hiệu của đúng cái đã xảy ra
 * với `.de`. Không có bước này thì addon ngồi chờ hết hạn cache (mặc định 6 giờ)
 * mới biết tên miền đã đổi.
 */
export function forgetHh3dBase() {
  cacheDelete(KEY);
}

/** Trang này có thuộc HH3D không — dùng để chặn /hh3d.m3u8 và /hh3d-seg. */
export async function isHh3dPage(candidate) {
  try {
    const at = new URL(candidate);
    if (at.protocol !== 'https:' && at.protocol !== 'http:') return false;
    const host = at.hostname.toLowerCase();
    const base = new URL(await hh3dBase()).hostname.toLowerCase();
    return host === base || host.includes(CONFIG.hh3dHostHint);
  } catch {
    return false;
  }
}
