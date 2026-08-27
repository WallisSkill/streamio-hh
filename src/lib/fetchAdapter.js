/**
 * Chạy router `(req, res)` bằng một `Request` kiểu fetch.
 *
 * Cloudflare Workers nói Request/Response, còn router nói node:http. Nhưng
 * router chỉ dùng đúng `writeHead()` và `end()`, nên cả bề mặt gói gọn trong
 * vài dòng — và giữ phần chuyển đổi ở đây nghĩa là `app.js` không phải sửa gì,
 * Vercel vẫn chạy nguyên code đang chạy.
 */

/** Những status mà chuẩn HTTP cấm mang body — Response sẽ ném lỗi nếu cố nhét. */
const BODYLESS = new Set([101, 204, 205, 304]);

export function toResponse(handler, request) {
  return new Promise((resolve, reject) => {
    const url = new URL(request.url);

    const headers = {};
    for (const [key, value] of request.headers) {
      headers[key.toLowerCase()] = value;
    }
    // Router dựng link tuyệt đối trỏ về chính nó từ mấy header này.
    headers.host ||= url.host;
    headers['x-forwarded-proto'] ||= url.protocol.replace(':', '');
    headers['x-forwarded-host'] ||= url.host;

    const req = {
      method: request.method,
      url: url.pathname + url.search,
      headers,
    };

    let status = 200;
    let outHeaders = {};
    let settled = false;

    const res = {
      writeHead(code, hdrs) {
        status = code;
        outHeaders = hdrs || {};
        return res;
      },
      end(body) {
        if (settled) return res;
        settled = true;
        resolve(
          new Response(BODYLESS.has(status) ? null : (body ?? null), {
            status,
            headers: outHeaders,
          }),
        );
        return res;
      },
      get headersSent() {
        return settled;
      },
    };

    try {
      // Router bắt lỗi bên trong và tự trả 500, nhưng nếu nó vỡ trước khi kịp
      // gọi end() thì promise này sẽ treo — nên bắt cả hai lối thoát.
      Promise.resolve(handler(req, res)).catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}
