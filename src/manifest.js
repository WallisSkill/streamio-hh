export const MANIFEST = {
  // Giữ nguyên id cũ: đổi id thì Stremio coi đây là addon khác, mọi người đã
  // cài phải gỡ ra cài lại. Tên hiển thị đổi được tự do, id thì không nên.
  id: 'community.vn.kkphim.hh3d',
  // Stremio so SỐ PHIÊN BẢN để biết có cần nạp lại manifest hay không. Thêm
  // resource mà quên tăng số này thì bản đã cài vẫn giữ manifest cũ: addon khai
  // 'subtitles' mà Stremio không bao giờ hỏi xin phụ đề. Thêm/bớt resource là
  // phải tăng.
  version: '1.3.0',
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
  // Stremio thấy cờ configurable thì hiện nút Configure và mở /configure của
  // addon. configurationRequired để false vì bản cài trần vẫn chạy đủ mọi thứ,
  // chỉ thiếu mỗi nguồn SubSource.
  config: [
    { key: 'subsourceKey', type: 'password', title: 'SubSource API key' },
    { key: 'subsourceLang', type: 'text', title: 'Ngôn ngữ phụ đề SubSource', default: 'vietnamese' },
    { key: 'iptv', type: 'text', title: 'Link danh sách IPTV (M3U)' },
  ],
  behaviorHints: { configurable: true, configurationRequired: false, adult: false },
};
