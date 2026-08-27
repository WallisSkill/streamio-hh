/**
 * Cloudflare Worker: chuyển tiếp API của Nguồn C.
 *
 * Cloudflare của nguonc chặn theo IP nguồn, và IP của Vercel nằm trong dải bị
 * chặn — mọi path đều 403. Worker chạy trên mạng Cloudflare nên lệnh gọi ra
 * mang IP của Cloudflare; nguonc có nhận dải đó hay không thì chỉ deploy mới
 * biết, xem bước kiểm tra trong README.
 *
 * Chỉ chuyển tiếp GET tới phim.nguonc.com. Không có dòng chặn đó thì đây là
 * một open proxy: ai biết địa chỉ cũng sai khiến nó tải hộ bất cứ thứ gì.
 *
 * Deploy: dash.cloudflare.com -> Workers & Pages -> Create -> dán file này.
 * Dùng:   NGUONC_PROXY=https://<tên>.<tài-khoản>.workers.dev/?url={url}
 */

const ALLOWED = 'https://phim.nguonc.com/';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' +
  ' (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return new Response('chỉ nhận GET', { status: 405 });
    }

    const target = new URL(request.url).searchParams.get('url');

    if (!target) {
      return new Response('thiếu ?url=', { status: 400 });
    }
    if (!target.startsWith(ALLOWED)) {
      return new Response(`chỉ chuyển tiếp ${ALLOWED}`, { status: 403 });
    }

    let upstream;
    try {
      upstream = await fetch(target, {
        headers: {
          'user-agent': UA,
          accept: 'application/json, text/plain, */*',
          'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8',
          referer: ALLOWED,
        },
      });
    } catch (err) {
      return new Response(`không gọi được nguonc: ${err.message}`, { status: 502 });
    }

    // Trả nguyên văn cả status: addon cần thấy đúng thứ nguonc nói, còn 403 của
    // Cloudflare thì phải lộ ra ở /probe/nguonc chứ không được hoá trang thành
    // dữ liệu rỗng.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'cache-control': 'public, max-age=300',
      },
    });
  },
};
