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
