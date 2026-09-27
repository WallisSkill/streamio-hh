# VN Phim — Stremio addon (KKPhim + Nguồn C + HH3D)

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

### Ba điều cần biết khi chạy serverless

**Cache trong RAM mất mỗi lần cold start.** Bù lại, mọi phản hồi đều gắn
`s-maxage=600`, nên CDN của Vercel trả thẳng cho lần bấm thứ hai mà không
gọi lại hàm. Lần đầu một tập mất khoảng 3–4 giây, sau đó gần như tức thì.

**HH3D chạy được ở mọi nơi.** Phần dò phim từng cần `curl` (site trả 403 cho
fetch của Node) nên tắt trên serverless; `hoathinh3d.de` giờ trả 200 cho fetch
thường, kể cả từ Worker. Slug ghim trong `overrides.json` vẫn là đường chắc nhất
cho phim mà tìm kiếm của họ không ra.

**Nguồn C bị chặn theo IP, và có cách đi vòng.** Cloudflare của nguonc trả
403 cho IP datacenter ở mọi path, nên addon tự tắt nguồn này khi phát hiện
đang chạy serverless. Kiểm bằng `/probe/nguonc` — chạy từ chính deployment
và báo path nào bị chặn.

Chỉ mỗi **API** bị chặn. Trang embed `*.streamc.xyz` và CDN segment vẫn trả
lời IP datacenter bình thường (đã đo trên Vercel), nên chỉ cần đưa đúng phần
API đi vòng:

```
NGUONC_UPSTREAM=https://<addon chạy ở nhà>
```

Bản trên Vercel sẽ gửi lệnh gọi nguonc tới `/upstream/nguonc/...` của bản
chạy ở nhà, bản đó gọi nguonc bằng IP dân cư rồi trả kết quả về nguyên văn.
Đặt biến này cũng tự bật lại Nguồn C trên serverless. Route `/upstream/nguonc`
chỉ chuyển tiếp `GET /api/...` của nguonc — không phải proxy mở.

Chỉ có dữ liệu API đi đường này; video vẫn đi thẳng từ máy người xem tới CDN
của Nguồn C, không qua nhà bạn và cũng không qua Vercel.

Máy ở nhà tắt thì còn một đường lùi nữa, `NGUONC_PROXY` — một mẫu URL chứa
`{url}`, thử sau upstream:

```
NGUONC_PROXY=https://<fetcher>/?url={url}
```

**Tên miền `sc.k-20.xyz` đã chết** (không phân giải được, đo 21/09/2026). Ví dụ
cũ dùng nó nên nay không còn dùng được — cần một fetcher khác, hoặc bỏ hẳn
đường này.

Thứ tự đầy đủ là **upstream → proxy → gọi thẳng**, đường nào trả về dữ liệu
đúng hình dạng thì dừng ở đó. Một proxy bị chặn vẫn có thể trả 200 kèm trang
chặn của Cloudflare, nên addon soi hình dạng dữ liệu chứ không tin status code.

Đây là hạ tầng của người khác, dùng cho việc không phải của nó — họ chặn hoặc
đổi tham số lúc nào cũng được. Nên coi là tạm bợ: mất nó thì Nguồn C biến mất,
các nguồn khác không ảnh hưởng. Cả hai biến để rỗng thì Nguồn C tự tắt trên
serverless như trước.

**Đo được (28/08/2026):** `sc.k-20.xyz` trả `200` cho máy ở nhà nhưng `403`
cho Vercel ở cùng một URL — họ cho proxy video, không cho mượn IP gọi API.
Trong khi đó `proxy.cors.sh` lại gọi được nguonc, nên nguonc chặn theo dải chứ
không chặn mọi IP datacenter. Đừng tin một relay chỉ vì nó chạy từ máy bạn:
**thử từ chính deployment** bằng `/probe/nguonc` rồi hãy kết luận.

### Chạy addon trên Cloudflare Workers

Cách gọn nhất để có Nguồn C mà không cần thiết bị nào ở nhà — và nó đến từ
chính cơ chế đã làm hỏng mọi đường vòng phía trên.

Worker gọi sang một site cũng nằm sau Cloudflare thì request không rời mạng
Cloudflare, và bên nhận xét tường lửa theo **IP của người dùng gốc**. Worker
chuyển tiếp IP chứ không giấu nó — nên relay đặt trên Cloudflare vô dụng khi
người gọi là Vercel.

Nhưng đặt luôn addon ở đó thì người gọi là Stremio trên máy người xem, tức một
IP dân cư, và nguonc cho qua. Đã kiểm chứng: `IP nhà → Worker → nguonc` trả
`200`, trong khi `Vercel → Worker → nguonc` trả `403`, cùng một Worker.

```bash
npm run deploy:worker    # npx wrangler deploy
```

Lần đầu wrangler sẽ mở trình duyệt để đăng nhập Cloudflare. Xong thì lấy URL nó
in ra, thêm `/manifest.json`, dán vào Stremio.

Ở đây **không đặt** `NGUONC_PROXY` hay `NGUONC_UPSTREAM` — đặt vào chỉ thêm một
chặng hỏng, vì đường gọi thẳng đã đi được. Khác biệt so với Vercel:

- Nguồn C chỉ chạy cho người xem có IP dân cư; xem qua VPN đặt ở datacenter thì
  nguồn này lại tắt
- HH3D chạy đủ cả dò phim lẫn link phát (không cần `curl` nữa)
- `overrides.json` không đọc được vì không có hệ thống tệp — nạp qua biến
  `OVERRIDES` chứa chuỗi JSON, xem [`wrangler.toml`](wrangler.toml)

Router dùng chung: [`src/lib/fetchAdapter.js`](src/lib/fetchAdapter.js) chuyển
`Request` thành cặp `(req, res)` mà `app.js` vốn nói, nên cùng một bộ định
tuyến chạy cả trên node:http, Vercel lẫn Workers.

### Worker chỉ để chuyển tiếp API

[`worker/nguonc-relay.js`](worker/nguonc-relay.js) là bản relay 40 dòng, chỉ
chuyển tiếp `GET` tới `phim.nguonc.com` (bỏ dòng chặn đó đi thì nó thành open
proxy). Giữ lại vì nó **hữu ích khi người gọi có IP dân cư**, và vì nó là bằng
chứng cho kết luận ở trên.

**Nó KHÔNG cứu được bản chạy trên Vercel.** Đã đo, cùng một Worker cùng một URL:

| Người gọi | Kết quả |
|---|---|
| Máy nhà | `200`, JSON đầy đủ |
| Vercel | `403`, kèm nguyên trang chặn của nguonc |

Worker có chạy — nó gọi nguonc, nguonc từ chối, nó trả nguyên văn về (thân
phản hồi là HTML của Cloudflare chứ không phải dòng chặn của chính relay). Lý
do: request từ Worker sang một site Cloudflare khác được xét theo IP người gọi
gốc. Nên relay đặt trên Cloudflare **chuyển tiếp** IP của Vercel chứ không giấu
nó, và `sc.k-20.xyz` cũng hỏng y hệt vì cùng lẽ đó.

Muốn Nguồn C mà không có thiết bị ở nhà thì chuyển hẳn addon lên Workers, xem
mục trên.

Bản chạy ở nhà cần một địa chỉ công khai. Nhanh nhất:

```bash
cloudflared tunnel --url http://localhost:7000
```

URL `trycloudflare` đổi mỗi lần khởi động lại, nên nếu định để lâu thì dùng
named tunnel gắn domain của bạn để `NGUONC_UPSTREAM` khỏi phải sửa liên tục.

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
| **Ophim** (ophim1.com) | **Đang hỏng, tắt mặc định trên Workers** | API trả 404 ở mọi path (đo 28/08/2026), không mirror nào còn sống. Bật lại bằng `ENABLE_OPHIM=1` khi nó hồi phục |
| **Nguồn C** (phim.nguonc.com) | Có, qua `/hls.m3u8` + `STREMIO_PROXY` | [API mở](https://phim.nguonc.com/api-document), không cần key. Trang embed không công bố link phát và segment đòi Referer — xem giải thích bên dưới |
| **HH3D** (hoathinh3d) | Có, 1080p — không cần `STREMIO_PROXY` | Link phát nằm sau một gói mã hoá AES-GCM và một khoá dùng một lần; segment bọc PNG 70 byte. Xem giải thích bên dưới |

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

Trang embed của Nguồn C (`*.streamc.xyz`) không viết link phát ra markup, nên
bộ giải embed thông thường chạy qua nó không lấy được gì. Từ bản `r25` của
trang, `#player` là một thẻ rỗng và tất cả nằm sau API của chính trang đó:

```
POST embed.php?hash=…  {"action":"bootstrap"}                 -> { bootstrap, turnstileEnabled }
POST embed.php?hash=…  {"action":"issue", bootstrap, playlist_format}
                                                              -> { playlist, issuedAt, expiresAt }
```

Hai chi tiết quyết định link lấy về có dùng được hay không:

- **`playlist_format`.** Player của họ xin `aesgcm-v2` ở mọi nơi trừ máy Apple,
  và định dạng đó về ở dạng mã hoá AES-GCM để JS của họ tự giải — Stremio đọc
  không ra. Xin đúng `hls`, định dạng họ phục vụ Safari, thì nhận được media
  playlist thường.
- **Segment.** Là MPEG-TS đội lốt `.png`, nằm trên host xoay vòng (`cyin1.sbs`,
  `seouls11.amass11.top`…) và trả `403` cho mọi request không có Referer, mà
  Stremio thì không gửi Referer nào.

Nên `lib/streamc.js` tự xin playlist, rồi addon phục vụ lại nó ở
`/hls.m3u8?u=<embed>` với từng dòng segment được viết qua **`STREMIO_PROXY`**
(`127.0.0.1:11470`) — server nội bộ của Stremio, chạy trên **máy đang xem** chứ
không phải máy chạy addon. Nó nhận đích và header ngay trong URL rồi gọi lại
đúng như vậy:

```
http://127.0.0.1:11470/proxy/d=<origin>&h=<Tên:Giá trị>&h=…/<path>?<query>
```

Luồng video vì thế đi thẳng từ máy người xem tới CDN của họ, không qua
deployment của addon; addon chỉ phục vụ đúng file playlist vài chục dòng.

Việc đó chạy lúc bấm phát chứ không phải lúc dựng danh sách stream: grant chỉ
sống vài giờ, dựng sớm thì tới lúc xem có thể đã hết hạn.

**Trên Cloudflare Workers không gọi được streamc** — và không phải vì header.
Đo ngày 22/09/2026, cùng một URL embed:

| Gọi từ | Header | Kết quả |
|---|---|---|
| Máy thường | không header / UA curl | `403` |
| Máy thường | UA trình duyệt | `200` |
| Worker | UA trình duyệt | `403` sau 3ms |
| Worker | đủ bộ sec-ch-ua, sec-fetch, accept-language… | `403` sau 3ms |
| Worker | file `.js` tĩnh, cả trang gốc của site | `403` sau 3ms |

Hai kiểu chặn khác nhau. Với máy thường, streamc lọc theo hình dạng request —
đúng UA trình duyệt là qua. Với Worker thì chặn sạch cả zone, kể cả file tĩnh:
request từ Worker sang zone Cloudflare khác không rời mạng đó và bị loại ngay ở
biên. Giả header không cứu được. Lớp này streamc mới bật (cùng đợt `r25`) —
trước đó bản trên Workers phát Nguồn C bình thường.

### Dựng lại playlist từ CDN

Nhưng CDN chứa segment là tên miền khác (`cyin1.sbs`, `seouls11.amass11.top`…)
và **Worker gọi được bình thường** — 206, đúng bytes MPEG-TS. Nên playlist dựng
lại được mà không cần đụng tới streamc. Ba mảnh, ba cách lấy:

- **Đường dẫn.** Segment nằm ở `https://<host>/<hash>/streamaaa0000.png`, đánh
  số liên tục, và `hash` chính là tham số hash trong URL embed — thứ API nguonc
  đã trả về rồi.
- **Host.** Mỗi server embed có đúng một CDN của nó, quan hệ 1:1 (bảng trong
  `lib/streamc.js`, đo trên 10 server). Một video chỉ nằm trên một host, các
  host không dùng chung dữ liệu — nên host trong bảng sai thì dò cả danh sách.
  Họ đổi CDN thì ghi đè bằng `STREAMC_SEGMENT_HOSTS="embed12=host,…"`.
- **Số đoạn và độ dài.** Không ai công bố, nên đo. Số đoạn: khoanh vùng bằng
  cách nhân đôi rồi dò nhị phân xem segment thứ n có tồn tại không (~17 request
  cho phim 300 đoạn). Độ dài: đọc mốc thời gian PCR trong chính file TS, lấy 64
  KB đầu và 64 KB cuối của mấy đoạn mẫu.

Đo lại bằng ffprobe (đúng bản ffmpeg Stremio dùng), qua đúng đường Stremio đi —
Worker trả playlist, segment vòng qua server nội bộ của Stremio để có Referer:

| Phim | Số đoạn dựng ra / thật | Tổng thời lượng dựng ra / thật |
|---|---|---|
| Đại Chúa Tể (embed12) | 123 / 123 | 1219.3s / 1224.2s |
| Thôn Phệ Tinh Không (embed13) | 312 / 312 | 925.7s / 933.7s |
| embed11 | 268 / 268 | 2669.3s / 2680s |

Số đoạn đúng tuyệt đối; thời lượng lệch dưới 1%, vì độ dài mỗi đoạn là số đo
trung bình của mấy đoạn mẫu chứ không phải số thật của từng đoạn. Hệ quả: phim
phát liền mạch và đúng nội dung, nhưng thanh thời gian lệch được vài giây và tua
tới thì lệch trong khoảng một đoạn. Muốn đúng từng đoạn thì phải lấy playlist
thật từ streamc — `/hls.m3u8` vẫn thử đường đó trước, và nó chạy ở máy nhà hoặc
bất cứ đâu Cloudflare không đứng chặn giữa.

Playlist dựng từ CDN không mang token nào nên cache được lâu; bản do streamc cấp
thì hết hạn sau 4 giờ.

`turnstileEnabled` là công tắc Cloudflare Turnstile của chính trang đó. Lúc
viết dòng này nó đang tắt; khi bật thì grant đòi một challenge đã giải, addon
**không** làm việc đó — nó trả null và tập Nguồn C quay về dạng link mở trang
phát của họ. Đặt `STREMIO_PROXY=` rỗng cũng cho kết quả tương tự, vì không còn
ai gắn Referer hộ segment nữa.

Kiểm tra một tập bất kỳ bằng `/probe/embed` — với embed streamc nó báo grant có
về không, playlist có bao nhiêu segment, và segment đầu tiên tải được hay không.

### HH3D phát trực tiếp bằng cách nào

Trang tập HH3D **không** đặt link phát trong HTML — chỉ có `player_key_url` trỏ
tới `/wp-json/halim/v1/player-key`. Trước đây README này kết luận từ đó là không
lấy được. Đọc bundle player thì ra cả ba lớp đều mở được bằng HTTP thường:

```
player.php?episode_slug=&server_id=&post_id=   -> { _encrypted, kid, iv, payload }
POST /wp-json/halim/v1/player-key { key_id }   -> { key }
AES-GCM(payload, key, iv)                      -> { file: <m3u8>, label, skip_time }
```

Ba chi tiết quyết định, đo ngày 22/09/2026:

- `player.php` đòi đúng ba header: `Referer` là trang tập (thiếu thì 404),
  `X-Requested-With: XMLHttpRequest`, và `X-Halim-Client` — một chuỗi ngẫu nhiên
  player tự sinh rồi giữ trong `sessionStorage`; giá trị nào cũng được.
- Khoá **dùng một lần và gắn với phiên**: gọi `player-key` mà không mang cookie
  của chính request lấy gói mã hoá thì nhận `player_key_expired` ("phiên khác").
  Nên cả luồng phải đi chung một giỏ cookie, thứ `fetch()` không tự giữ.
- Playlist trả về là HLS VOD thật và **không đòi header nào**, kể cả Referer.

Còn một lớp ở segment: mỗi segment bị bọc một ảnh PNG 1x1 dài **đúng 70 byte** ở
đầu (IEND ở byte 62, gói TS 188 byte lặp đúng từ byte 70 — kiểm trên nhiều
segment rải khắp phim). Player của họ cắt phần đó trong JS rồi dựng `blob:`, nên
nhìn từ ngoài tưởng là stream không lấy được.

Ở đây không cắt byte nào: playlist trả cho Stremio ghi thêm
`#EXT-X-BYTERANGE:<trần>@70` cho mỗi segment, và **chính người chơi** bỏ qua 70
byte đầu bằng một request Range. Dùng trần lớn thay cho độ dài thật, vì độ dài
thật đòi một HEAD cho mỗi segment — 700 request cho một tập; CDN tự kẹp về hết
file khi Range vượt quá.

Nhờ vậy HH3D **không cần `STREMIO_PROXY`** như Nguồn C: segment đi thẳng từ máy
người xem tới CDN, không header, không proxy. Và độ dài từng đoạn là số thật của
họ, nên thanh thời gian và tua tới đều đúng.

Phần dò phim cũng không cần `curl` nữa — `hoathinh3d.de` trả `200` cho `fetch`
thường, kể cả từ Cloudflare Workers, và sáu trang gọi song song đều `200` trong
650ms nên không còn giãn cách 1.5 giây. Nhưng tìm kiếm của họ kén một cách cụ
thể:

| Truy vấn | Kết quả |
|---|---|
| `Đại Chúa Tể 3D` | 3 kết quả, không cái nào đúng |
| `Đại Chúa Tể` | 20 kết quả, có `dai-chua-te` |
| `Đấu La Đại Lục 2 (Tuyệt Thế Đường Môn)` | 0 kết quả |
| `Đấu La Đại Lục 2` | đúng phim ở hạng 1 |
| `dai chua te 3d` | 1 kết quả, sai phim |

Nên tên đưa vào phải là **tiếng Việt, còn dấu**, đã cắt phần trong ngoặc và phần
sau dấu hai chấm. Trang HH3D không ghi tên gốc, nên tên tiếng Việt lấy từ mục đã
khớp ở KKPhim/Nguồn C — vì thế HH3D chạy SAU hai nguồn kia chứ không song song.
Tên đó cũng được đưa vào danh sách tên để khớp, không chỉ vào truy vấn: nếu
không thì `Đại Chúa Tể` của HH3D đọ với `The Great Ruler` của Cinemeta chỉ được
34 điểm, dưới ngưỡng 45, và một phim có thật bị loại đúng ở bước cuối.

Kiểm một tập bất kỳ bằng `/probe/hh3d?u=<trang tập>`. Hai kiểu trượt đã đo đều tự
khỏi ở lần thử thứ hai nên addon thử lại một lần: tập trả về `sources` rỗng
(~1/3 lần), và request treo tới hết hạn chờ vì tiến trình sống lâu tái dùng một
socket keep-alive đã chết. Phim nào rỗng nguồn ở mọi tập thì là bên họ thiếu, ghi
`hh3d` slug trong `overrides.json` cũng không cứu được.

## Cấu hình

Xem `.env.example`: `PORT`, `ADDON_BASE_URL`, `KKPHIM_API`, `OPHIM_API`,
`NGUONC_API`, `HH3D_BASE`, `ENABLE_KKPHIM`, `ENABLE_OPHIM`, `ENABLE_NGUONC`,
`ENABLE_HH3D`, `RESOLVE_EMBEDS`, `EMBED_HOSTS`, `EMBED_TTL`, `CACHE_TTL`.

## Ghi chú

- Không phụ thuộc package nào — chỉ cần Node ≥ 18, không phải `npm install`.
- Có cache trong bộ nhớ (mặc định 30 phút) và gộp request trùng.
- Addon chỉ tổng hợp link từ nguồn công khai, không lưu trữ hay phát tán nội dung.
  Bạn tự chịu trách nhiệm về việc sử dụng phù hợp quy định nơi mình ở.
