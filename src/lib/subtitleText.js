/**
 * Dọn phụ đề trước khi giao cho Stremio.
 *
 * Phần lớn phụ đề tiếng Việt trên OpenSubtitles được dịch trên bản ASS/SSA rồi
 * đổi sang SRT bằng công cụ chỉ đổi phần khung giờ và giữ nguyên phần chữ. Thẻ
 * định dạng của ASS vì thế còn nằm lại trong lời thoại, mà trình phát SRT của
 * Stremio không hiểu chúng nên in ra nguyên văn:
 *
 *     {\an8}nơi một lựa chọn duy nhất
 *
 * Bỏ thẻ là mất vị trí hiển thị (\an8 nghĩa là "đặt lên đỉnh màn hình"), nhưng
 * SRT vốn không có cách diễn đạt vị trí nên giữ lại cũng không dùng được vào
 * đâu — chỉ tổ in ra giữa lời thoại.
 */

/**
 * Byte tải về -> chữ, tự nhận ra bảng mã.
 *
 * Không được đoán cứng UTF-8: phụ đề tiếng Việt trên SubSource có bản lưu
 * UTF-16. Giải bằng UTF-8 thì mỗi ký tự ra kèm một byte 00, trình phát nhận
 * một tệp đầy ký tự NUL và báo lỗi thay vì hiện phụ đề — đo 15/11/2026 trên
 * Lucifer S01E01 bản BluRay.HEVC của hbot.
 *
 * Thứ tự xét: BOM trước (chắc chắn nhất), rồi đếm byte 00 cho tệp UTF-16 không
 * BOM, rồi mới tới nhãn do nguồn khai và UTF-8. UTF-8 mà hỏng thì thử tiếp mấy
 * bảng mã Việt cũ — thà thử còn hơn giao ra một tệp đầy dấu hỏi.
 */
export function decodeSubtitle(bytes, hint = '') {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!b.length) return '';

  const strip = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const decodeWith = (slice, label) => {
    try {
      return strip(new TextDecoder(label).decode(slice));
    } catch {
      return null;
    }
  };

  // BOM nói thẳng, khỏi đoán.
  if (b[0] === 0xff && b[1] === 0xfe) return decodeWith(b.subarray(2), 'utf-16le') ?? decodeWith(b, 'utf-8') ?? '';
  if (b[0] === 0xfe && b[1] === 0xff) return decodeWith(b.subarray(2), 'utf-16be') ?? decodeWith(b, 'utf-8') ?? '';

  const body = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;

  // Không BOM: chữ ASCII trong UTF-16LE là "31 00" nên byte 00 rơi vào chỉ số
  // LẺ, còn UTF-16BE là "00 31" nên rơi vào chỉ số CHẴN. Một tệp UTF-8 bình
  // thường không có byte 00 nào.
  const n = Math.min(body.length, 4096);
  let odd = 0;
  let even = 0;
  for (let i = 0; i < n; i += 1) {
    if (body[i] === 0) {
      if (i % 2) odd += 1;
      else even += 1;
    }
  }
  if (odd > n / 8 && even < n / 64) return decodeWith(body, 'utf-16le') ?? '';
  if (even > n / 8 && odd < n / 64) return decodeWith(body, 'utf-16be') ?? '';

  // Nhãn nguồn khai, nếu có và nếu runtime hiểu.
  const label = String(hint || '').toLowerCase();
  if (label && label !== 'utf-8' && label !== 'utf8') {
    const got = decodeWith(body, label);
    if (got != null) return got;
  }

  // UTF-8 đúng chuẩn thì xong. Hỏng thì tệp này là bảng mã cũ.
  try {
    return strip(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    for (const fallback of ['windows-1258', 'windows-1252']) {
      const got = decodeWith(body, fallback);
      if (got != null) return got;
    }
    return strip(new TextDecoder('utf-8').decode(body));
  }
}

/**
 * Thẻ ghi đè của ASS luôn mở bằng dấu gạch chéo ngược: {\an8}, {\pos(192,50)},
 * {\i1}, {\c&HFFFFFF&}, {\fad(200,200)}.
 *
 * Chỉ xoá đúng dạng có gạch chéo. "{tiếng cười}" hay "{Ghi chú}" là chữ thật
 * của người dịch — quét cả dấu ngoặc nhọn là ăn mất nội dung.
 */
const OVERRIDE = /\{\s*\\[^}]*\}/g;

/**
 * Ký tự thoát của ASS lọt sang SRT: \N xuống dòng cứng, \n xuống dòng mềm,
 * \h khoảng trắng không ngắt. Trình phát SRT in ra nguyên hai chữ "\N".
 */
const ESCAPES = /\\([Nnh])/g;

/**
 * Trả về phụ đề đã bỏ thẻ ASS, giữ nguyên số thứ tự và khung giờ.
 *
 * Không đụng tới `<i>`, `<b>`, `<font>`: SRT có những thẻ đó thật và Stremio
 * hiểu chúng.
 */
export function cleanSubtitle(text) {
  if (!text) return text;

  return (
    text
      // BOM đứng trước số thứ tự làm cue đầu tiên không được nhận.
      .replace(/^﻿/, '')
      .replace(OVERRIDE, '')
      .replace(ESCAPES, (_, c) => (c === 'h' ? ' ' : '\n'))
      .split('\n')
      // Thẻ ở đầu dòng bỏ đi để lại khoảng trắng thừa. Dòng rỗng vẫn rỗng nên
      // ranh giới giữa các cue không suy suyển.
      .map((line) => line.trim())
      .join('\n')
  );
}
