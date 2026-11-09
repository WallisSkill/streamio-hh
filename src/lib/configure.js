/**
 * Trang /configure — nơi người cài nhập khoá SubSource của chính họ.
 *
 * Stremio mở trang này khi manifest khai `behaviorHints.configurable`. Việc của
 * trang: nhận khoá rồi dựng lại URL cài có mang cấu hình. Toàn bộ phần dựng URL
 * chạy ở TRÌNH DUYỆT — khoá không bao giờ được gửi lên máy chủ ở bước này, nên
 * nó cũng không nằm trong log của ai cả cho tới khi Stremio bắt đầu gọi addon.
 */
import { MANIFEST } from '../manifest.js';
import { LOGO_SVG } from './logo.js';
import { CONFIG } from '../config.js';

const escape = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function configurePage(baseUrl, current = null) {
  const base = baseUrl.replace(/[/]+$/, '');
  const cur = current || {};

  return `<!doctype html>
<html lang="vi">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cấu hình ${escape(MANIFEST.name)}</title>
<style>
  :root {
    --bg: #f6f7fb; --card: #fff; --line: #e4e7f0; --ink: #12141c; --dim: #5d6479;
    --accent: #6b4df0; --accent-ink: #fff; --warn: #b4690e;
    --shadow: 0 1px 2px rgba(18,20,28,.06), 0 8px 24px rgba(18,20,28,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b0d13; --card: #141824; --line: #242a3a; --ink: #e9ebf2; --dim: #939bb0;
      --accent: #7b5bf2; --warn: #e0a33c;
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
  h1 { margin: 0; font-size: 28px; letter-spacing: -.02em; }
  .lede { color: var(--dim); margin: 0 0 28px; }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    padding: 22px; margin-bottom: 16px; box-shadow: var(--shadow);
  }
  label { display: block; font-size: 14px; font-weight: 600; margin: 0 0 6px; }
  .hint { font-size: 13px; color: var(--dim); font-weight: 400; margin: 0 0 8px; }
  input[type=text], input[type=password] {
    width: 100%; font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    padding: 12px; border-radius: 9px; border: 1px solid var(--line);
    background: var(--bg); color: var(--ink);
  }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .field { margin-bottom: 20px; }
  .btn {
    display: block; width: 100%; text-align: center; background: var(--accent); color: var(--accent-ink);
    padding: 15px 22px; border-radius: 11px; text-decoration: none; font-weight: 650; font-size: 17px;
    border: 0; cursor: pointer; font-family: inherit;
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
    font-family: inherit;
  }
  .url button:hover { border-color: var(--accent); color: var(--accent); }
  .warn {
    border-left: 3px solid var(--warn); padding: 2px 0 2px 14px; margin: 0;
    color: var(--dim); font-size: 14px;
  }
  .warn b { color: var(--ink); }
  a { color: var(--accent); }
  footer { color: var(--dim); font-size: 13px; text-align: center; margin-top: 28px; }
</style>
<div class="wrap">
  <header>${LOGO_SVG}<h1>Cấu hình</h1></header>
  <p class="lede">Nhập khoá SubSource của bạn, rồi bấm cài. Khoá đi theo URL cài addon.</p>

  <div class="card">
    <div class="field">
      <label for="key">SubSource API key</label>
      <p class="hint">Lấy ở subsource.net → My Profile. Để trống thì addon vẫn chạy, chỉ thiếu nguồn SubSource.</p>
      <input type="password" id="key" autocomplete="off" spellcheck="false" value="${escape(cur.subsourceKey || '')}">
    </div>

    <div class="field">
      <label for="lang">Ngôn ngữ phụ đề SubSource</label>
      <p class="hint">Tên ngôn ngữ theo cách SubSource gọi, không phải mã ISO — <code>vie</code> và <code>vi</code> đều trả về rỗng.</p>
      <input type="text" id="lang" autocomplete="off" spellcheck="false"
             placeholder="${escape(CONFIG.subsourceLang)}" value="${escape(cur.subsourceLang || '')}">
    </div>

    <button class="btn" id="go">Cài vào Stremio</button>
    <p class="or">hoặc chép URL này vào Stremio → Addons → Add addon</p>
    <div class="url">
      <input type="text" id="out" readonly>
      <button id="copy">Chép</button>
    </div>
  </div>

  <div class="card">
    <p class="warn">
      <b>Khoá nằm trong URL cài.</b> Đó là cách duy nhất Stremio mang được cấu hình,
      nên ai có link là có khoá — đừng chia sẻ link đã cấu hình. Khoá chỉ được mã hoá
      hiển thị chứ không mã hoá bảo mật.
      Lộ thì vào subsource.net thu hồi rồi cấu hình lại.
    </p>
  </div>

  <footer>${escape(MANIFEST.name)} v${escape(MANIFEST.version)}</footer>
</div>
<script>
  var BASE = ${JSON.stringify(base).replace(/</g, String.fromCharCode(92) + "u003c")};

  function b64url(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }

  function segment() {
    var cfg = {};
    var key = document.getElementById('key').value.trim();
    var lang = document.getElementById('lang').value.trim();
    if (key) cfg.subsourceKey = key;
    if (lang) cfg.subsourceLang = lang;
    if (!Object.keys(cfg).length) return '';
    return '/' + b64url(JSON.stringify(cfg));
  }

  function refresh() {
    document.getElementById('out').value = BASE + segment() + '/manifest.json';
  }

  document.getElementById('key').addEventListener('input', refresh);
  document.getElementById('lang').addEventListener('input', refresh);

  document.getElementById('go').addEventListener('click', function () {
    var url = BASE + segment() + '/manifest.json';
    window.location.href = /^https:/.test(url) ? url.replace(/^https:/, 'stremio:') : url;
  });

  document.getElementById('copy').addEventListener('click', function () {
    var out = document.getElementById('out');
    out.select();
    navigator.clipboard.writeText(out.value).then(function () {
      var b = document.getElementById('copy');
      b.textContent = 'Đã chép';
      setTimeout(function () { b.textContent = 'Chép'; }, 1400);
    });
  });

  refresh();
</script>
`;
}
