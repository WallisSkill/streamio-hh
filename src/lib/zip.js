/**
 * Đọc ZIP vừa đủ để lấy MỘT tệp ra.
 *
 * Vì sao tự viết thay vì thêm thư viện: addon này không có dependency nào, và
 * thứ cần làm chỉ là đọc bảng mục lục rồi giải nén đúng một mục. `DecompressionStream`
 * có sẵn cả trên Workers lẫn Node 18+, nên phần nặng nhất đã có người làm hộ.
 *
 * Nhưng lý do chính là bộ nhớ. Kho phụ đề của một bộ phim dài có thể chứa vài
 * chục tệp; addon SubSource ngoài kia bung cả kho ra rồi mới chọn, nên gặp kho
 * lớn là chết với thông báo "subtitle archive is too large to be processed".
 * Đọc mục lục trước thì chỉ giải nén đúng tập đang xem, kho to bao nhiêu cũng
 * không đổi lượng việc phải làm.
 */

const EOCD_SIG = 0x06054b50; // End of Central Directory
const CEN_SIG = 0x02014b50; // Central directory file header
const LOC_SIG = 0x04034b50; // Local file header

/** Trần của trường 32-bit trong ZIP cũ; chạm trần nghĩa là tệp dùng ZIP64. */
const ZIP64 = 0xffffffff;

const utf8 = new TextDecoder('utf-8');

/** Bốn byte đầu của mọi tệp ZIP. Tải về có khi là .srt trần chứ không phải kho. */
export function isZip(bytes) {
  return (
    bytes?.length > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/**
 * Tìm bản ghi EOCD — mục lục nằm ở CUỐI tệp ZIP, không phải đầu.
 *
 * Phải dò ngược vì sau EOCD còn có thể có phần chú thích dài tới 64KB, nên vị
 * trí của nó không cố định.
 */
function findEocd(view, len) {
  const floor = Math.max(0, len - (22 + 0xffff));
  for (let i = len - 22; i >= floor; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Danh sách tệp trong kho, đọc từ mục lục. Không giải nén gì cả.
 * Trả về mảng rỗng nếu không phải ZIP đọc được.
 */
export function readZip(bytes) {
  if (!isZip(bytes)) return [];

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view, bytes.length);
  if (eocd === -1) return [];

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CEN_SIG) break;

    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLen));

    // ZIP64 cất kích thước thật trong trường phụ. Phụ đề không bao giờ to tới
    // mức đó, nên bỏ qua mục ấy còn hơn đọc ra số sai.
    if (compressed !== ZIP64 && offset !== ZIP64) {
      entries.push({ name, method, compressed, size, offset });
    }
    at += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Giải nén đúng một mục đã chọn từ `readZip`.
 *
 * Độ dài trường phụ ở local header KHÁC với ở mục lục — đây là chỗ sai kinh
 * điển khi tự đọc ZIP, và sai thì dữ liệu lệch đi vài byte rồi giải nén hỏng.
 * Nên phải đọc lại độ dài từ chính local header.
 */
/**
 * Trần cho MỘT tệp sau khi giải nén. Phụ đề cả bộ phim dài cũng chỉ vài trăm KB,
 * còn kho tự khai `size` thế nào cũng được — một mục nén vài KB có thể nở ra
 * hàng GB (zip bomb) và giết Worker. Đếm byte thật khi giải nén, không tin `size`.
 */
export const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

async function inflateCapped(data, cap) {
  const reader = new Response(data).body.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function extractEntry(bytes, entry, cap = MAX_ENTRY_BYTES) {
  if (!entry) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.offset + 30 > bytes.length || view.getUint32(entry.offset, true) !== LOC_SIG) return null;

  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const from = entry.offset + 30 + nameLen + extraLen;
  const data = bytes.subarray(from, from + entry.compressed);

  if (entry.method === 0) return data.length > cap ? null : data; // stored, không nén
  if (entry.method !== 8) return null; // chỉ deflate mới phổ biến trong ZIP phụ đề

  return inflateCapped(data, cap);
}
