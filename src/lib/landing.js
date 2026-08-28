import { CONFIG } from '../config.js';
import { MANIFEST } from '../manifest.js';

/**
 * Trang chủ của addon.
 *
 * Người mở trang này chỉ có đúng một việc cần làm: đưa addon vào Stremio. Nên
 * nút cài đứng trước, URL kèm nút chép đứng ngay sau nó, còn lại là thứ trả
 * lời câu hỏi "nó có đang chạy không" — trạng thái từng nguồn lấy thẳng từ
 * CONFIG, không phải chữ viết sẵn, nên trang không bao giờ nói sai về chính nó.
 *
 * Không tải font hay ảnh từ ngoài: trang phải hiện đầy đủ ngay cả khi mạng
 * chặn CDN, và mỗi request ngoài là một lần chờ thêm.
 */

/** Logo, dùng chung cho trang này và cho ô ảnh của addon trong Stremio. */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#7b5bf2"/>
  <path d="M14 20h6l4 16 4-16h6l4 16 4-16h6l-7 26h-7l-3-12-3 12h-7z" fill="#fff"/>
</svg>`;

const SOURCES = () => [
  { name: 'KKPhim', on: CONFIG.enableKkphim, note: 'm3u8 trực tiếp' },
  { name: 'Nguồn C', on: CONFIG.enableNguonc, note: 'cần IP dân cư' },
  { name: 'Ophim', on: CONFIG.enableOphim, note: 'API đang hỏng' },
  { name: 'HH3D', on: CONFIG.enableHh3d, note: 'chỉ link mở trang' },
];

const escape = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function landingPage(baseUrl) {
  const manifestUrl = `${baseUrl}/manifest.json`;
  const install = `stremio://${baseUrl.replace(/^https?:[/][/]/, '')}/manifest.json`;

  const pills = SOURCES()
    .map(
      (s) =>
        `<li class="${s.on ? 'on' : 'off'}"><span class="dot"></span><b>${escape(s.name)}</b><em>${escape(
          s.on ? s.note : 'đang tắt',
        )}</em></li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="vi">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(MANIFEST.name)}</title>
<style>
  :root {
    --bg: #f6f7fb; --card: #fff; --line: #e4e7f0; --ink: #12141c; --dim: #5d6479;
    --accent: #6b4df0; --accent-ink: #fff; --on: #14a058; --off: #9aa1b4;
    --shadow: 0 1px 2px rgba(18,20,28,.06), 0 8px 24px rgba(18,20,28,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b0d13; --card: #141824; --line: #242a3a; --ink: #e9ebf2; --dim: #939bb0;
      --accent: #7b5bf2; --on: #35d07f; --off: #6b7386;
      --shadow: 0 1px 2px rgba(0,0,0,.4), 0 12px 32px rgba(0,0,0,.35);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 20px 72px; background: var(--bg); color: var(--ink);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 620px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
  header svg { width: 52px; height: 52px; border-radius: 14px; box-shadow: var(--shadow); flex: none; }
  h1 { margin: 0; font-size: 30px; letter-spacing: -.02em; }
  .ver {
    font-size: 12px; color: var(--dim); border: 1px solid var(--line); border-radius: 999px;
    padding: 2px 9px; vertical-align: 3px; margin-left: 8px; font-weight: 500;
  }
  .lede { color: var(--dim); margin: 0 0 28px; }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    padding: 22px; margin-bottom: 16px; box-shadow: var(--shadow);
  }
  .btn {
    display: block; text-align: center; background: var(--accent); color: var(--accent-ink);
    padding: 15px 22px; border-radius: 11px; text-decoration: none; font-weight: 650; font-size: 17px;
  }
  .btn:hover { filter: brightness(1.08); }
  .or { text-align: center; color: var(--dim); font-size: 13px; margin: 18px 0 10px; }
  .url { display: flex; gap: 8px; }
  .url input {
    flex: 1; min-width: 0; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    padding: 11px 12px; border-radius: 9px; border: 1px solid var(--line);
    background: var(--bg); color: var(--ink);
  }
  .url button {
    border: 1px solid var(--line); background: var(--bg); color: var(--ink);
    border-radius: 9px; padding: 0 16px; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .url button:hover { border-color: var(--accent); color: var(--accent); }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .07em; color: var(--dim); margin: 0 0 14px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  li { display: flex; align-items: center; gap: 10px; font-size: 15px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--off); flex: none; }
  li.on .dot { background: var(--on); box-shadow: 0 0 0 3px color-mix(in srgb, var(--on) 22%, transparent); }
  li.off b { color: var(--dim); }
  li em { font-style: normal; color: var(--dim); font-size: 13px; margin-left: auto; text-align: right; }
  .links { display: grid; gap: 12px; }
  .links a {
    color: var(--accent); text-decoration: none;
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .links a:hover { text-decoration: underline; }
  .links p { margin: 2px 0 0; color: var(--dim); font-size: 13px; }
  footer { color: var(--dim); font-size: 13px; text-align: center; margin-top: 28px; }
</style>
<div class="wrap">
  <header>
    ${LOGO_SVG}
    <h1>${escape(MANIFEST.name)}<span class="ver">v${escape(MANIFEST.version)}</span></h1>
  </header>
  <p class="lede">${escape(MANIFEST.description)}</p>

  <div class="card">
    <a class="btn" href="${escape(install)}">Cài vào Stremio</a>
    <p class="or">hoặc dán URL này vào Stremio → Addons → Add addon</p>
    <div class="url">
      <input id="u" value="${escape(manifestUrl)}" readonly onclick="this.select()">
      <button id="c" type="button">Chép</button>
    </div>
  </div>

  <div class="card">
    <h2>Nguồn</h2>
    <ul>${pills}</ul>
  </div>

  <div class="card">
    <h2>Kiểm tra</h2>
    <div class="links">
      <div>
        <a href="/probe/nguonc">/probe/nguonc</a>
        <p>Đường nào tới được Nguồn C, đo từ chính máy chủ này</p>
      </div>
      <div>
        <a href="/debug/series/tt0388629:21:1">/debug/series/tt0388629:21:1</a>
        <p>Addon chọn nguồn nào cho tập đó, và map ra tập số mấy</p>
      </div>
    </div>
  </div>

  <footer>Khớp số tập theo Cinemeta &amp; Kitsu · phần và đánh số tuyệt đối</footer>
</div>
<script>
  document.getElementById('c').addEventListener('click', function () {
    var input = document.getElementById('u');
    var done = function () { this.textContent = 'Đã chép'; setTimeout(function () { document.getElementById('c').textContent = 'Chép'; }, 1600); }.bind(this);
    if (navigator.clipboard) { navigator.clipboard.writeText(input.value).then(done, done); }
    else { input.select(); document.execCommand('copy'); done(); }
  });
</script>
</html>`;
}
