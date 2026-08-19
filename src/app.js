import { CONFIG } from './config.js';
import { MANIFEST } from './manifest.js';
import { getStreams } from './handlers/stream.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

/**
 * `edge` puts the response in the host CDN for 10 minutes.
 * On serverless the in-process cache dies with each cold start, so letting the
 * CDN answer repeats is what keeps a second click on the same episode instant.
 */
function send(res, status, body, { edge = false } = {}) {
  res.writeHead(status, {
    ...CORS,
    ...(edge
      ? { 'cache-control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400' }
      : {}),
  });
  res.end(JSON.stringify(body));
}

/** Public URL of this deployment, derived from the request so no config is needed. */
function baseUrlOf(req) {
  if (CONFIG.baseUrl) return CONFIG.baseUrl;
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || `localhost:${CONFIG.port}`)
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

function landingPage(req) {
  const base = baseUrlOf(req);
  const install = `stremio://${base.replace(/^https?:[/][/]/, '')}/manifest.json`;
  return `<!doctype html><meta charset="utf-8"><title>${MANIFEST.name}</title>
<style>body{font-family:system-ui;max-width:720px;margin:60px auto;padding:0 20px;line-height:1.6}
code{background:#eee;padding:2px 6px;border-radius:4px}a.btn{display:inline-block;background:#7b5bf2;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600}</style>
<h1>${MANIFEST.name}</h1><p>${MANIFEST.description}</p>
<p><a class="btn" href="${install}">Cài vào Stremio</a></p>
<p>Hoặc dán URL này vào Stremio → Addons → Add addon:<br><code>${base}/manifest.json</code></p>
<h3>Kiểm tra khớp tập</h3>
<p><code>/debug/series/tt0388629:21:1</code> — xem addon chọn nguồn nào và map ra tập nào.</p>`;
}

/**
 * Shared request handler.
 * Used by the local node:http server and by the Vercel serverless entry point,
 * so both surfaces route identically.
 */
export async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    // Inside the try: a stray '%' makes decodeURIComponent throw URIError, and a
    // proxied req.url is not guaranteed to parse. Neither may crash the process.
    let path;
    try {
      path = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
      path = decodeURIComponent(path);
    } catch {
      path = String(req.url || '/').split('?')[0];
    }
    path = path.replace(/\/+$/, '') || '/';

    if (path === '/') {
      res.writeHead(200, { ...CORS, 'content-type': 'text/html; charset=utf-8' });
      return res.end(landingPage(req));
    }
    if (path === '/manifest.json') return send(res, 200, MANIFEST, { edge: true });

    // /stream/:type/:id.json
    const m = /^\/stream\/(movie|series)\/(.+?)(?:\.json)?$/.exec(path);
    if (m) {
      const [, type, id] = m;
      const { streams } = await getStreams(type, id);
      return send(res, 200, { streams, cacheMaxAge: 600 }, { edge: true });
    }

    // /debug/:type/:id — shows how the episode was matched
    const d = /^\/debug\/(movie|series)\/(.+?)(?:\.json)?$/.exec(path);
    if (d) {
      const [, type, id] = d;
      return send(res, 200, await getStreams(type, id));
    }

    return send(res, 404, { err: 'not found' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { err: err.message });
  }
}
