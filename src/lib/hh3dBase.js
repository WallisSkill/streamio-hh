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
      headers: { 'user-agent': CONFIG.userAgent, accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(CONFIG.httpTimeout),
    });
    if (!res.ok) return null;
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
