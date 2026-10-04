import { CONFIG } from '../config.js';

/**
 * Phụ đề ghim tay.
 *
 * Vì sao có cái này: addon phụ đề tự tìm luôn phải ĐOÁN bản phụ đề nào khớp với
 * bản phim đang xem, và đoán sai thì lệch tiếng. Ghim tay thì không đoán gì cả —
 * bạn chọn đúng file cho đúng bản release, addon chỉ việc đưa ra.
 *
 * Nó độc lập với nguồn phát: Stremio hỏi phụ đề theo id của phim, hỏi mọi addon
 * có khai `subtitles`, nên phụ đề ghim ở đây gắn được vào cả luồng torrent của
 * addon khác (1337x…) chứ không riêng phim do addon này phục vụ.
 *
 * Nguồn dữ liệu tuỳ nơi chạy, giống overrides: có hệ thống tệp thì đọc
 * `subtitles.json` ở gốc repo, còn Workers thì nạp từ biến môi trường SUBTITLES.
 */

let data = {};

const count = (obj) => Object.keys(obj).filter((k) => !k.startsWith('_')).length;

/** Nạp thẳng từ chuỗi JSON hoặc object — dùng cho runtime không có tệp. */
export function setSubtitlePins(source) {
  try {
    data = typeof source === 'string' ? JSON.parse(source) : source || {};
    console.log(`[subtitles] nạp ${count(data)} mục từ biến môi trường`);
  } catch (err) {
    console.warn(`[subtitles] SUBTITLES không phải JSON hợp lệ: ${err.message}`);
    data = {};
  }
}

async function loadFromDisk() {
  const [fs, { fileURLToPath }, { dirname, join }] = await Promise.all([
    import('node:fs'),
    import('node:url'),
    import('node:path'),
  ]);
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'subtitles.json');
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(`[subtitles] nạp ${count(data)} mục từ subtitles.json`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[subtitles] ${err.message}`);
    data = {};
  }
}

// Workers không có node:fs, và import tĩnh sẽ làm vỡ bản đóng gói ngay lúc
// build — nên nạp động, bọc trong catch, y như overrides.
if (!CONFIG.onWorkers) loadFromDisk().catch(() => {});

/**
 * Phụ đề đã ghim cho một id, bản khớp tên tệp xếp trước.
 *
 * Tra theo id đầy đủ trước (`tt123:4:56` — ghim riêng một tập), rồi tới id phim
 * (`tt123` — ghim cho cả bộ). `match` là một mẩu chữ trong tên tệp của bản
 * release; có nó thì phụ đề chỉ nhận đúng bản đó, và khi Stremio gửi kèm
 * `filename` thì bản khớp được đẩy lên đầu.
 */
export function pinsFor(id, filename = '') {
  const base = String(id).split(':')[0];
  const list = [...(data[id] || []), ...(id === base ? [] : data[base] || [])];
  const name = String(filename).toLowerCase();

  const usable = list.filter((s) => s?.url && (!s.match || !name || name.includes(String(s.match).toLowerCase())));
  const matched = (s) => (s.match && name && name.includes(String(s.match).toLowerCase()) ? 0 : 1);

  return usable
    .map((s, i) => ({ ...s, _rank: matched(s) * 100 + i }))
    .sort((a, b) => a._rank - b._rank)
    .map(({ _rank, ...s }) => s);
}
