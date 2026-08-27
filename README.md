# VN Phim — Stremio addon (KKPhim + HH3D)

Addon **stream-only**: bạn vẫn duyệt phim bằng danh mục chính thức của Stremio
(Cinemeta), addon chỉ cung cấp nguồn phát. Nhờ vậy tên phim, poster, danh sách
phần/tập luôn là bản chuẩn — và việc còn lại là map cho đúng tập.

## Cài đặt

```bash
npm start
```

Mở `http://localhost:7000` rồi bấm **Cài vào Stremio**, hoặc dán thẳng URL này
vào Stremio → Addons → Add addon:

```
http://localhost:7000/manifest.json
```

Đổi cổng khi cần (mặc định 7000):

```bash
PORT=7010 npm start
```

## Deploy lên Vercel

Repo đã có sẵn `api/index.js` và `vercel.json`, không cần cấu hình gì thêm:

```bash
npx vercel --prod
```

Hoặc vào vercel.com → Add New Project → import repo này → Deploy. Không cần
khai biến môi trường nào; địa chỉ addon tự suy ra từ domain Vercel cấp.

Xong thì mở `https://<tên-app>.vercel.app` và bấm **Cài vào Stremio**.

### Hai điều cần biết khi chạy serverless

**Cache trong RAM mất mỗi lần cold start.** Bù lại, mọi phản hồi đều gắn
`s-maxage=600`, nên CDN của Vercel trả thẳng cho lần bấm thứ hai mà không
gọi lại hàm. Lần đầu một tập mất khoảng 3–4 giây, sau đó gần như tức thì.

**Tự dò slug HH3D không chạy trên Vercel** vì runtime không có `curl`. Addon
tự bỏ qua HH3D, các nguồn khác không ảnh hưởng. Muốn giữ link HH3D thì ghim
slug trong `overrides.json` — cách đó vẫn chạy bình thường trên serverless.

## Vấn đề số tập, và cách addon xử lý

Đây là phần khó nhất. Các trang phim Việt đánh số tập theo **hai kiểu khác nhau**,
và đoán sai là phát nhầm tập:

| Kiểu | Nguồn trông như thế nào | Ví dụ thật |
|---|---|---|
| Theo phần | mỗi phần là một mục riêng, đếm lại từ 1 | `Đại Chiến Người Khổng Lồ (Phần 2)` → S2E1 là **Tập 01** |
| Tuyệt đối | một mục gộp toàn bộ, đếm 1..N liên tục | `Đảo Hải Tặc` giữ 1174 tập → S21E1 là **Tập 891** |

Addon quyết định theo thứ tự:

1. **Ghim thủ công** trong `overrides.json` — cao nhất, xem bên dưới.
2. **Mục gộp toàn bộ** — nếu số tập của nguồn ≈ tổng tập tuyệt đối của Cinemeta
   thì dùng đánh số tuyệt đối, *kể cả khi nguồn tự khai là phần 1*. KKPhim gắn
   nhãn `season 1` cho One Piece dù nó chứa cả 1174 tập; tin cái nhãn đó thì
   S21E1 sẽ phát tập 1.
3. **Nguồn khai đúng phần đang xem** (từ `tmdb.season` hoặc chữ "Phần N" trong
   tên) → đếm theo tập trong phần.
4. **Nguồn khai phần khác** → *từ chối*, không trả stream. Thà không có nguồn
   còn hơn phát nhầm tập.
5. Không chắc → vẫn trả stream nhưng gắn ⚠️ và ghi rõ cách map trong nhãn.

Mỗi stream đều hiện thẳng cách map, ví dụ:
`▶ Tập 891 · Nguồn gộp toàn bộ 1174 tập — S21E1 = tập 891`.

### Chọn đúng *phim* trước khi chọn đúng *tập*

Khớp bằng tên là không đủ: donghua trên IMDb/TMDB thường mang tên tiếng Anh khác
hẳn tên trên trang Việt (`Battle Through the Heavens` vs `Fights Break Sphere` —
độ giống nhau bằng 0). Nên addon xếp hạng theo: IMDb id → TMDB id → tên (có bổ
sung tên gọi khác lấy từ Kitsu) → năm phát hành.

Và **khớp phần không bao giờ được lấn khớp ID**: KKPhim có `Đảo Hải Tặc (Live
Action) (Phần 2)` — đúng số phần nhưng sai phim.

## Ghim thủ công

Sửa `overrides.json` (tự nạp lại sau ~5 giây, không cần restart):

```json
{
  "tt1234567": {
    "titles": ["tên phụ để tìm kiếm"],
    "seasons": {
      "3": { "kkphim": "slug-tren-kkphim-phan-3", "mode": "season", "offset": 0 }
    }
  }
}
```

- `mode`: `season` (đếm trong phần) hoặc `absolute`
- `offset`: cộng bù khi phim chia cour lệch số

## Kiểm tra

Bộ giải link embed — chạy offline, không cần mạng, không cần server:

```bash
node test/embed.mjs
```

Khớp tập — cần addon đang chạy (`PORT=7010 npm start`):

```bash
node test/regression.mjs
```

Xem addon đã quyết định thế nào cho một tập bất kỳ:

```
http://localhost:7000/debug/series/tt0388629:21:1
```

Trả về nguồn đã chọn, điểm khớp, lý do khớp và chế độ đánh số.

## Các nguồn

| Nguồn | Phát trong Stremio | Ghi chú |
|---|---|---|
| **KKPhim** (phimapi.com) | Có, m3u8 trực tiếp | Nhiều server: Vietsub / Thuyết Minh / Lồng Tiếng. Tập chỉ có `link_embed` cũng phát được — xem phần link embed bên dưới |
| **Ophim** (ophim1.com) | Có, m3u8 trực tiếp | Có `imdb.id` + `tmdb.season` cho cả donghua nên khớp ID chính xác hơn |
| **Nguồn C** (phim.nguonc.com) | Có, qua `STREAMC_PROXY` | [API mở](https://phim.nguonc.com/api-document), không cần key. Playlist về ở dạng mã hoá nên phải đi vòng — xem giải thích bên dưới |
| **HH3D** (hoathinh3d) | Không — chỉ link mở trang | Xem giải thích bên dưới |

Cả KKPhim và Ophim đều là API JSON công khai, trả `link_m3u8` cho request ẩn
danh, không cần token. Mỗi server của mỗi nguồn là một lựa chọn riêng trong
Stremio.

### Link embed được tích hợp vào Stremio như thế nào

Trình phát của Stremio chỉ nhận **link media** (m3u8/mp4), không nhận trang
HTML. Đưa thẳng một link embed vào ô `url` thì Stremio sẽ cố phát mã nguồn
trang — nên mọi link embed đều phải đổi thành link phát trước.

Addon thử hai đường, rẻ trước:

| Đường | Cách làm | Ví dụ |
|---|---|---|
| **Query** | link phát nằm sẵn trong chính query string của trang player, chỉ cần đọc — không tốn request nào | `player.phimapi.com/player/?url=<m3u8>` → lấy thẳng `<m3u8>` |
| **Trang** | trang tự khai link phát trong HTML (`file:`, `sources: [...]`, `<video src>`, thuộc tính `data-` dạng base64) | tải trang một lần qua `/resolve`, đúng lúc bấm phát |

Đường **Query** chạy đồng bộ khi dựng danh sách stream, nên KKPhim/Ophim có
tập chỉ có `link_embed` mà không có `link_m3u8` vẫn phát được ngay, không chậm
thêm mili-giây nào. Đường **Trang** hoãn tới `/resolve?u=<embed>` — addon tải
trang lúc người dùng bấm phát rồi 302 sang link thật, tức là một request mỗi
lần bấm thay vì một request cho mỗi server trong danh sách, và token ngắn hạn
được lấy khi còn hạn.

`/resolve` chỉ tải trang của những host trong `EMBED_HOSTS`. Endpoint này nhận
URL từ query string, không có allowlist thì nó sẽ tải bất cứ địa chỉ nào người
gọi đưa vào — kể cả mạng nội bộ của chính deployment.

Xem một link embed có phát được trong Stremio hay không:

```
http://localhost:7000/probe/embed?u=<link embed đã encode>
```

Trả về: query string có mang link phát không, trang có tự khai không, và link
lấy ra có phải manifest Stremio đọc được không.

### Nguồn C phát trực tiếp bằng cách nào

Trang embed của Nguồn C (`*.streamc.xyz`) không viết link phát ra ở đâu cả, nên
bộ giải embed thông thường chạy qua nó không lấy được gì. Link thô cũng không
dùng được, vì hai lớp sau:

- **Manifest về ở dạng mã hoá.** Playlist không phải HLS chuẩn mà là
  `#EXTM3U` kèm `#ENC-AESGCM;iv=…` và các dòng `#EXT-X-B65:`. Khoá là
  `HMAC-SHA256("stream-derive-v1", videoHash)` lấy 32 byte đầu, giải AES-256-GCM
  bằng IV nằm ngay trên dòng đó. Trình phát của Stremio đọc không ra.
- **Endpoint đòi header.** Segment là MPEG-TS đội lốt `.png`, và host phục vụ
  chúng xoay vòng (`cyin1.sbs`, `vivurtr.sbs`, `sings2.amass2.top`…). Gọi thẳng
  trả `403 Access Denied: Missing Referer or Origin headers`, mà Stremio thì
  không gửi Referer do addon đặt.

Nhưng trang embed **có** công bố hai mảnh mà player của họ cần:
`#player[data-obf]` là base64 của `{"sUb":"<stream token>","hD":"<video hash>"}`.
Từ hai giá trị đó, `lib/embed.js` dựng link qua hai lớp:

1. **`STREAMC_PROXY`** (`sc.k-20.xyz`) — giải playlist và ghi lại từng segment
   qua chính nó, kèm Referer mà segment host đòi. Ra một m3u8 thường.
2. **`STREMIO_PROXY`** (`127.0.0.1:11470`) — server nội bộ của Stremio, chạy
   trên **máy đang xem** chứ không phải máy chạy addon. Nó nhận đích và header
   ngay trong URL rồi gọi lại đúng như vậy:

   ```
   http://127.0.0.1:11470/proxy/d=<origin>&h=<Tên:Giá trị>&h=…/<path>?<query>
   ```

   Stremio tự viết lại từng dòng segment trong playlist thành `/proxy/…` của nó
   kèm nguyên bộ header, nên cả manifest lẫn segment đều đi kèm Referer/Origin
   của Nguồn C. Luồng video không đi qua deployment của addon.

Việc đó chạy trong `/resolve` chứ không phải lúc dựng danh sách stream: token
trong `sUb` là token ngắn hạn, dựng sớm thì tới lúc bấm phát có thể đã hết hạn.

Hiện `sc.k-20.xyz` trả lời cả khi không có header nào, nên lớp 2 là để phòng xa
chứ chưa bắt buộc — đặt `STREMIO_PROXY=` rỗng thì addon giao thẳng link m3u8,
chạy được trên cả client không có server nội bộ. Đặt `STREAMC_PROXY=` rỗng thì
addon không đụng tới hai lớp chặn nữa, và tập Nguồn C quay về dạng link mở đúng
trang phát của họ.

Kiểm tra một tập bất kỳ bằng `/probe/embed` — `resolved.via` sẽ là `streamc` và
`media.kind` là `hls` khi đường này còn chạy.

### Vì sao HH3D không phát trực tiếp được

HH3D **không** đặt link phát trong HTML. Trang tập chỉ chứa `player_key_url`
trỏ tới `/wp-json/halim/v1/player-key`, và endpoint đó đòi tham số `key_id`
do bundle JS của player tự sinh lúc chạy. Cộng thêm hệ thống đăng nhập, nhãn
VIP và việc chặn client không phải trình duyệt — cả chồng biện pháp đó nhằm
đảm bảo chỉ player của họ mới lấy được link.

Addon này **không phá cơ chế đó**. HH3D chỉ xuất hiện dưới dạng link mở đúng
trang tập.

Phần tự dò slug HH3D đọc trang công khai qua `curl`, nhưng site giới hạn tần
suất theo IP nên hay trả 403; khi đó addon bỏ qua HH3D, các nguồn khác không bị
ảnh hưởng. Ghim `hh3d` slug trong `overrides.json` thì link tập vẫn dựng
được kể cả lúc site chặn, vì URL tập suy ra được tất định.

## Cấu hình

Xem `.env.example`: `PORT`, `ADDON_BASE_URL`, `KKPHIM_API`, `OPHIM_API`,
`NGUONC_API`, `HH3D_BASE`, `ENABLE_KKPHIM`, `ENABLE_OPHIM`, `ENABLE_NGUONC`,
`ENABLE_HH3D`, `RESOLVE_EMBEDS`, `EMBED_HOSTS`, `EMBED_TTL`, `CACHE_TTL`.

## Ghi chú

- Không phụ thuộc package nào — chỉ cần Node ≥ 18, không phải `npm install`.
- Có cache trong bộ nhớ (mặc định 30 phút) và gộp request trùng.
- Addon chỉ tổng hợp link từ nguồn công khai, không lưu trữ hay phát tán nội dung.
  Bạn tự chịu trách nhiệm về việc sử dụng phù hợp quy định nơi mình ở.
