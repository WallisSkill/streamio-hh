/**
 * Điểm vào cho Cloudflare Workers.
 *
 * Vì sao chạy addon ở đây mà không phải Vercel: Cloudflare của nguonc chặn
 * theo IP, và IP của Vercel nằm trong dải bị chặn. Đã đo và loại trừ từng
 * đường vòng — proxy của bên thứ ba, rồi Worker relay riêng — cả hai đều hỏng
 * vì cùng một lẽ: khi một Worker gọi sang site khác cũng nằm sau Cloudflare,
 * request không rời mạng Cloudflare và bên nhận xét theo IP của NGƯỜI DÙNG
 * GỐC. Worker chuyển tiếp IP chứ không giấu nó.
 *
 * Chính cơ chế đó lại là lời giải khi addon nằm luôn trên Workers: người gọi
 * là Stremio trên máy người xem, tức một IP dân cư, và nguonc cho qua. Không
 * cần thiết bị nào bật ở nhà, không cần NGUONC_PROXY.
 *
 * Deploy: npx wrangler deploy
 */

import { toResponse } from '../src/lib/fetchAdapter.js';

let appPromise;

export default {
  async fetch(request, env) {
    // CONFIG đọc process.env ngay lúc app.js được nạp lần đầu, mà trên Workers
    // các biến chỉ tồn tại trong `env` của mỗi request — nên phải đổ vào trước
    // khi import xảy ra. Import động ở dưới giữ đúng thứ tự đó.
    globalThis.process ??= { env: {} };
    Object.assign(globalThis.process.env, env);

    try {
      appPromise ??= import('../src/app.js');
      const { handleRequest } = await appPromise;

      if (env.OVERRIDES) {
        const { setOverrides } = await import('../src/lib/overrides.js');
        setOverrides(env.OVERRIDES);
      }

      return await toResponse(handleRequest, request);
    } catch (err) {
      // Nạp module hỏng thì mọi request sau đều hỏng theo nếu giữ lại promise
      // lỗi — bỏ đi để lần sau thử lại, và trả lỗi đọc được thay vì trang 1101
      // trống trơn của Cloudflare.
      appPromise = undefined;
      console.error('[addon] fatal', err);

      return new Response(
        JSON.stringify({
          err: err?.message || String(err),
          stack: String(err?.stack || '').split('\n').slice(0, 6),
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'access-control-allow-origin': '*',
          },
        },
      );
    }
  },
};
