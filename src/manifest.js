export const MANIFEST = {
  // Giữ nguyên id cũ: đổi id thì Stremio coi đây là addon khác, mọi người đã
  // cài phải gỡ ra cài lại. Tên hiển thị đổi được tự do, id thì không nên.
  id: 'community.vn.kkphim.hh3d',
  version: '1.0.0',
  name: 'wisFilm',
  description:
    'Gộp nhiều nguồn phim trong nước, khớp đúng số tập với danh sách chính thức trên Stremio (Cinemeta/Kitsu). Hỗ trợ đánh số theo phần và đánh số tuyệt đối.',
  // Logo do chính addon phục vụ ở /logo.svg, gắn địa chỉ tuyệt đối lúc trả
  // manifest — không mượn favicon của nguồn khác nữa.
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'kitsu'],
  catalogs: [],
  behaviorHints: { configurable: false, adult: false },
};
