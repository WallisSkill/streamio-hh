/**
 * Cấu hình do người cài đặt, mang theo trong chính URL của addon.
 *
 * Stremio không có chỗ cất cấu hình hộ addon. Cách duy nhất là nhét nó vào URL
 * cài: `https://addon/<cấu hình>/manifest.json`. Mọi tuyến sau đó cũng mang
 * đoạn ấy, nên mỗi request tự biết khoá của người gọi mà không cần phiên hay
 * kho dữ liệu nào.
 *
 * ĐÁNH ĐỔI PHẢI BIẾT: base64url là MÃ HOÁ HIỂN THỊ, không phải mã hoá bảo mật.
 * Ai có link cài là có khoá. Link đó nằm trong danh sách addon của Stremio và
 * trong log của bất cứ thứ gì ghi lại đường dẫn. Muốn khoá không bao giờ rời
 * máy chủ thì dùng secret SUBSOURCE_API_KEY — đường đó vẫn còn, và là mặc định
 * khi URL không mang cấu hình.
 */
import { CONFIG } from '../config.js';
import { playlistUrls } from './iptv.js';

/**
 * Hình dạng đoạn cấu hình. Dùng để loại nhanh những đoạn rõ ràng là tên tuyến
 * trước khi thử giải mã — `sub.srt`, `manifest.json` có dấu chấm nên trượt ngay.
 */
const SHAPE = /^[A-Za-z0-9_-]{8,4096}$/;

function b64urlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(seg) {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Object -> đoạn đường dẫn. Trả chuỗi rỗng khi không có gì đáng mang theo. */
export function encodeConfig(obj) {
  const clean = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const text = String(v ?? '').trim();
    if (text) clean[k] = text;
  }
  if (!Object.keys(clean).length) return '';
  return b64urlEncode(JSON.stringify(clean));
}

/**
 * Đoạn đường dẫn -> object, hoặc null nếu đoạn đó không phải cấu hình.
 *
 * Phải khắt khe: hàm này chính là thứ phân biệt `/<cấu hình>/stream/...` với
 * `/stream/...`. Chỉ nhận object JSON thật, nên một tên tuyến như `subtitles`
 * giải ra rác rồi trượt ở JSON.parse.
 */
export function decodeConfig(seg) {
  if (!seg || !SHAPE.test(seg)) return null;
  try {
    const obj = JSON.parse(b64urlDecode(seg));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * Tách đoạn cấu hình ra khỏi đường dẫn.
 * `/abc123/stream/movie/tt1.json` -> { seg: 'abc123', rest: '/stream/movie/tt1.json' }
 */
export function splitConfig(path) {
  const m = /^\/([^/]+)(\/.*)?$/.exec(path || '');
  if (!m) return { seg: '', rest: path || '/', config: null };

  const [, head, tail] = m;
  const config = decodeConfig(head);
  if (!config) return { seg: '', rest: path, config: null };

  return { seg: head, rest: tail || '/', config };
}

/**
 * Thiết lập dùng cho MỘT request: cấu hình trong URL đè lên biến môi trường.
 *
 * Trả về object riêng chứ không sửa CONFIG. Trên Workers nhiều request dùng
 * chung một isolate, nên gán vào CONFIG là khoá của người này rò sang người kia.
 */
export function settingsFrom(config) {
  // URL trần, không mang cấu hình: đây là bản cài của chính chủ deployment, nên
  // dùng khoá đặt bằng secret. Tuyến này giữ nguyên, không bỏ.
  if (!config) {
    return {
      subsourceKey: CONFIG.subsourceKey,
      subsourceLang: CONFIG.subsourceLang,
      iptv: playlistUrls(CONFIG.iptvPlaylists),
    };
  }

  // URL có cấu hình: khoá của người cài là khoá DUY NHẤT, không có dự phòng.
  // Hai lẽ. Một, khoá của bạn không gánh hạn mức 60 lượt/phút cho người lạ.
  // Hai, khoá gõ sai phải hỏng ra mặt — âm thầm chạy bằng khoá máy chủ thì
  // người ta tưởng khoá mình đúng, tới lúc bạn gỡ secret là cả đám chết chung
  // mà không ai hiểu vì sao.
  return {
    subsourceKey: String(config.subsourceKey || '').trim(),
    // Ngôn ngữ không phải thông tin bí mật, để trống thì lấy mặc định.
    subsourceLang: String(config.subsourceLang || '').trim() || CONFIG.subsourceLang,
    // Danh sách kênh cũng chỉ của người cài: bản đã cấu hình không mượn của
    // deployment, kẻo người ta thấy kênh mà không biết từ đâu ra.
    iptv: playlistUrls(config.iptv),
  };
}
