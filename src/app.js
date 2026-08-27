import { CONFIG } from './config.js';
import { MANIFEST } from './manifest.js';
import { getStreams } from './handlers/stream.js';
import { probe } from './lib/http.js';
import { unwrapEmbed, embedFetchable, resolveEmbed, inspectMedia } from './lib/embed.js';
import { routesTo } from './sources/nguonc.js';

/**
 * Try one route to nguonc and say whether real data came back.
 *
 * Status alone does not settle it: a blocked proxy answers 200 and hands over
 * Cloudflare's challenge page, which parses as neither failure nor film list.
 */
async function tryRoute(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': CONFIG.userAgent, accept: 'application/json, */*' },
      signal: AbortSignal.timeout(CONFIG.httpTimeout),
    });
    const text = await res.text();
    let usable = false;
    try {
      const data = JSON.parse(text);
      usable = data?.status === 'success' || Boolean(data?.items || data?.movie);
    } catch {
      usable = false;
    }
    return { status: res.status, usable, ms: Date.now() - started };
  } catch (err) {
    return { status: null, usable: false, ms: Date.now() - started, error: err.message };
  }
}

/**
 * Which routes to nguonc this deployment is configured with, and which of them
 * actually answer — the question every NGUONC_UPSTREAM / NGUONC_PROXY problem
 * comes down to. Env vars are set in a dashboard far from here and take effect
 * only on redeploy, so guessing from the outside is hopeless; this says it.
 */
async function probeNguoncRoutes() {
  const labels = [];
  if (CONFIG.nguoncUpstream) labels.push('upstream');
  if (CONFIG.nguoncProxy) labels.push('proxy');
  labels.push('direct');

  const urls = routesTo(`/api/films/search?keyword=${encodeURIComponent('dai chua te')}`);
  const host = (u) => {
    try {
      return new URL(u).host;
    } catch {
      return null;
    }
  };

  const tried = await Promise.all(
    urls.map(async (url, i) => ({ via: labels[i], host: host(url), ...(await tryRoute(url)) })),
  );

  return {
    enabled: CONFIG.enableNguonc,
    upstream: CONFIG.nguoncUpstream || null,
    proxy: CONFIG.nguoncProxy ? host(CONFIG.nguoncProxy.replace('{url}', 'x')) : null,
    // Set but thrown away for want of {url}: the one failure with no symptom.
    proxyIgnored: CONFIG.nguoncProxyIgnored,
    tried,
    // Nguồn tắt thì mọi đường có thông cũng vô nghĩa, nên xét trước.
    verdict: !CONFIG.enableNguonc
      ? CONFIG.nguoncProxyIgnored
        ? 'Nguồn C đang TẮT — NGUONC_PROXY có đặt nhưng thiếu {url} nên bị bỏ qua'
        : 'Nguồn C đang TẮT — chưa đặt NGUONC_PROXY / NGUONC_UPSTREAM / ENABLE_NGUONC'
      : CONFIG.nguoncProxyIgnored
        ? 'NGUONC_PROXY có đặt nhưng thiếu {url} nên bị bỏ qua'
        : tried.some((t) => t.usable)
          ? `đi được qua: ${tried.filter((t) => t.usable).map((t) => t.via).join(', ')}`
          : 'không đường nào tới được nguonc — Nguồn C sẽ không có stream',
  };
}

/**
 * Hit every nguonc endpoint from this process's own IP and report the raw
 * outcome of each — so when it runs on Vercel it shows precisely which path
 * Cloudflare blocks (403) and which, if any, gets through (200).
 */
async function probeNguonc(keyword) {
  const base = CONFIG.nguoncApi;
  const kw = encodeURIComponent(keyword);
  const slug = 'dai-chua-te';
  const targets = [
    { label: 'api-search', url: `${base}/api/films/search?keyword=${kw}` },
    { label: 'api-detail', url: `${base}/api/film/${slug}` },
    { label: 'web-search', url: `${base}/tim-kiem?load=1&keyword=${kw}`, headers: { 'x-requested-with': 'XMLHttpRequest' } },
    { label: 'web-detail', url: `${base}/phim/${slug}` },
  ];
  const results = {};
  await Promise.all(
    targets.map(async (t) => {
      results[t.label] = await probe(t.url, { headers: t.headers });
    }),
  );
  const verdict = Object.fromEntries(
    Object.entries(results).map(([k, v]) => [k, v.ok ? `OK ${v.status}` : `BLOCKED ${v.status ?? v.error}`]),
  );
  return { keyword, from: 'this-deployment-ip', verdict, routes: await probeNguoncRoutes(), detail: results };
}

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
 *
 * Also exported as default: Vercel may pick this module as the function
 * entrypoint, and it rejects an entrypoint whose default export is not a
 * function or a server. The (req, res) signature already matches what it wants.
 */
export async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    // Inside the try: a stray '%' makes decodeURIComponent throw URIError, and a
    // proxied req.url is not guaranteed to parse. Neither may crash the process.
    let path;
    let url = null;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      path = decodeURIComponent(url.pathname);
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
      const { streams } = await getStreams(type, id, { baseUrl: baseUrlOf(req) });
      return send(res, 200, { streams, cacheMaxAge: 600 }, { edge: true });
    }

    // /debug/:type/:id — shows how the episode was matched
    const d = /^\/debug\/(movie|series)\/(.+?)(?:\.json)?$/.exec(path);
    if (d) {
      const [, type, id] = d;
      return send(res, 200, await getStreams(type, id, { baseUrl: baseUrlOf(req) }));
    }

    /**
     * /resolve?u=<embed url> — the embed link, made playable.
     *
     * Stremio cannot run a player page, so the page is turned into a media URL
     * here and handed over as a redirect. Doing it at play time rather than
     * while building the stream list means one fetch per click instead of one
     * per server, and a short-lived token is fetched while it is still valid.
     */
    if (path === '/resolve') {
      const u = url?.searchParams?.get('u') || '';
      if (!u || !embedFetchable(u)) {
        return send(res, 400, { err: 'embed host không nằm trong EMBED_HOSTS', embed: u || null });
      }
      const hit = await resolveEmbed(u);
      if (!hit) return send(res, 502, { err: 'trang embed không công bố link phát', embed: u });
      res.writeHead(302, {
        ...CORS,
        location: hit.url,
        'cache-control': 'public, max-age=0, s-maxage=120',
      });
      return res.end();
    }

    // /probe/embed?u=<embed url> — why a given embed can or cannot be played
    // inside Stremio: what the query string carries, what the page declares,
    // and whether the track that comes out is a manifest Stremio can read.
    if (path === '/probe/embed') {
      const u = url?.searchParams?.get('u') || '';
      if (!u) return send(res, 400, { err: 'thiếu ?u=<embed url>' });
      const hit = await resolveEmbed(u);
      const media = hit ? await inspectMedia(hit.url) : null;
      return send(res, 200, {
        embed: u,
        fromQuery: unwrapEmbed(u),
        hostAllowed: embedFetchable(u),
        resolved: hit,
        media,
        verdict: media?.playable
          ? 'phát được trong Stremio'
          : hit
            ? `có link nhưng không phát được (${media?.kind})`
            : 'trang embed không công bố link phát → chỉ mở link ngoài',
      });
    }

    // /probe/nguonc — run FROM this deployment's IP and report each nguonc
    // endpoint's real status, so it is visible exactly which path is blocked.
    if (path === '/probe/nguonc') {
      const kw = url?.searchParams?.get('kw') || 'dai chua te';
      return send(res, 200, await probeNguonc(kw));
    }

    /**
     * /upstream/nguonc/<path> — nguonc, fetched from THIS machine's IP.
     *
     * Cloudflare answers 403 to datacenter IPs, so a deployment sitting in one
     * borrows a residential one: it sets NGUONC_UPSTREAM to a home instance and
     * its nguonc calls land here instead. Only nguonc's own read-only /api/
     * paths are forwarded, and only GET — this must not become an open proxy.
     *
     * The response is passed through verbatim, status included, so the caller's
     * own error handling sees what nguonc actually said.
     */
    if (path.startsWith('/upstream/nguonc/')) {
      const rest = path.slice('/upstream/nguonc'.length);
      if (req.method !== 'GET' || !rest.startsWith('/api/')) {
        return send(res, 400, { err: 'chỉ chuyển tiếp GET /api/... của nguonc', path: rest });
      }
      const upstream = `${CONFIG.nguoncApi}${rest}${url?.search || ''}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CONFIG.httpTimeout);
      try {
        const hit = await fetch(upstream, {
          signal: ctrl.signal,
          headers: {
            'user-agent': CONFIG.userAgent,
            accept: 'application/json, text/plain, */*',
            referer: `${CONFIG.nguoncApi}/`,
          },
        });
        const body = await hit.text();
        res.writeHead(hit.status, {
          ...CORS,
          'cache-control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400',
        });
        return res.end(body);
      } catch (err) {
        return send(res, 502, { err: err.message, upstream });
      } finally {
        clearTimeout(timer);
      }
    }

    return send(res, 404, { err: 'not found' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { err: err.message });
  }
}

export default handleRequest;
