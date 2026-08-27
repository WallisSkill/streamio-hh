/**
 * Ghim tay cho những phim mà bộ khớp tên đoán sai.
 *
 * Nguồn dữ liệu tuỳ nơi chạy: có hệ thống tệp thì đọc `overrides.json` ở gốc
 * repo, còn Cloudflare Workers thì không có tệp nào cả — nơi đó nạp qua
 * `setOverrides()` từ biến môi trường OVERRIDES.
 *
 * Vì vậy `node:fs` được nạp động và bọc trong try: một import tĩnh sẽ làm vỡ
 * bản đóng gói cho Workers ngay lúc build, trước khi kịp chạy dòng nào.
 */

let data = {};

function count(obj) {
  return Object.keys(obj).filter((k) => !k.startsWith('_')).length;
}

/** Nạp thẳng từ chuỗi JSON hoặc object — dùng cho runtime không có tệp. */
export function setOverrides(source) {
  try {
    data = typeof source === 'string' ? JSON.parse(source) : source || {};
    console.log(`[overrides] nạp ${count(data)} mục từ biến môi trường`);
  } catch (err) {
    console.warn(`[overrides] OVERRIDES không phải JSON hợp lệ: ${err.message}`);
    data = {};
  }
}

async function loadFromDisk() {
  const [fs, { fileURLToPath }, { dirname, join }] = await Promise.all([
    import('node:fs'),
    import('node:url'),
    import('node:path'),
  ]);

  const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'overrides.json');

  const read = () => {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
      console.log(`[overrides] loaded ${count(data)} entries`);
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[overrides] ${err.message}`);
      data = {};
    }
  };

  read();

  // Nạp lại khi tệp đổi chỉ có nghĩa với server chạy dài; serverless đọc một
  // lần mỗi lần khởi động nguội.
  if (!process.env.VERCEL) {
    try {
      fs.watchFile(file, { interval: 5000 }, read).unref?.();
    } catch {}
  }
}

// Chỉ Node mới có tệp. Chạy nền chứ không chặn module: overrides là ghim tay,
// hiếm dùng, và trên Node thì nó xong từ lâu trước request đầu tiên.
if (typeof process !== 'undefined' && process.versions?.node) {
  loadFromDisk().catch((err) => console.warn(`[overrides] ${err.message}`));
}

/** Manual pin for a show id, optionally for one season. */
export function getOverride(id, season) {
  const entry = data[id];
  if (!entry) return null;
  const perSeason = season != null ? entry.seasons?.[String(season)] : null;
  return {
    titles: entry.titles || [],
    kkphim: perSeason?.kkphim || entry.kkphim || null,
    hh3d: perSeason?.hh3d || entry.hh3d || null,
    mode: perSeason?.mode || entry.mode || null,
    offset: Number(perSeason?.offset ?? entry.offset ?? 0),
  };
}
