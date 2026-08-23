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
| **KKPhim** (phimapi.com) | Có, m3u8 trực tiếp | Nhiều server: Vietsub / Thuyết Minh / Lồng Tiếng |
| **Ophim** (ophim1.com) | Có, m3u8 trực tiếp | Có `imdb.id` + `tmdb.season` cho cả donghua nên khớp ID chính xác hơn |
| **Nguồn C** (phim.nguonc.com) | Không — chỉ link mở trang | [API mở](https://phim.nguonc.com/api-document), không cần key. Xem giải thích bên dưới |
| **HH3D** (hoathinh3d) | Không — chỉ link mở trang | Xem giải thích bên dưới |

Cả KKPhim và Ophim đều là API JSON công khai, trả `link_m3u8` cho request ẩn
danh, không cần token. Mỗi server của mỗi nguồn là một lựa chọn riêng trong
Stremio.

### Vì sao Nguồn C không phát trực tiếp được

API của Nguồn C là JSON mở và addon đọc đúng phần đó. Nhưng mỗi tập chỉ trỏ
tới một trang embed, và trang đó giấu nguồn phát sau base64 lồng nhau, chạy
bộ phát hiện DevTools tự ép reload, chặn chuột phải và phím xem mã nguồn —
một lớp chống trích xuất dựng có chủ đích.

Addon **không phá lớp đó**. Tập của Nguồn C xuất hiện dưới dạng link mở đúng
trang phát của họ, tức là đúng thứ API công bố. Số tập vẫn được map chuẩn qua
cùng bộ máy như các nguồn khác.

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
`HH3D_BASE`, `ENABLE_KKPHIM`, `ENABLE_OPHIM`, `ENABLE_HH3D`, `CACHE_TTL`.

## Ghi chú

- Không phụ thuộc package nào — chỉ cần Node ≥ 18, không phải `npm install`.
- Có cache trong bộ nhớ (mặc định 30 phút) và gộp request trùng.
- Addon chỉ tổng hợp link từ nguồn công khai, không lưu trữ hay phát tán nội dung.
  Bạn tự chịu trách nhiệm về việc sử dụng phù hợp quy định nơi mình ở.
