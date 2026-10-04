export const MANIFEST = {
  // Giữ nguyên id cũ: đổi id thì Stremio coi đây là addon khác, mọi người đã
  // cài phải gỡ ra cài lại. Tên hiển thị đổi được tự do, id thì không nên.
  id: 'community.vn.kkphim.hh3d',
  version: '1.0.0',
  name: 'WiSFilm',
  description:
    'Gộp nhiều nguồn phim trong nước, khớp đúng số tập với danh sách chính thức trên Stremio (Cinemeta/Kitsu). Hỗ trợ đánh số theo phần và đánh số tuyệt đối.',
  // Logo do chính addon phục vụ ở /logo.svg, gắn địa chỉ tuyệt đối lúc trả
  // manifest — không mượn favicon của nguồn khác nữa.
  // 'subtitles' đứng độc lập với 'stream': Stremio hỏi phụ đề theo id phim và
  // hỏi mọi addon có khai nó, nên phụ đề của addon này gắn được vào cả luồng do
  // addon khác cung cấp (torrent 1337x…).
  resources: ['stream', 'subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'kitsu'],
  catalogs: [],
  behaviorHints: { configurable: false, adult: false },
};
