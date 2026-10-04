import { CONFIG } from './config.js';
import { MANIFEST } from './manifest.js';
import { getStreams } from './handlers/stream.js';
import { probe } from './lib/http.js';
import { unwrapEmbed, embedFetchable, resolveEmbed, inspectMedia } from './lib/embed.js';
import { isStreamc, playlistOf, diagnose } from './lib/streamc.js';
import { playlistFor as hh3dPlaylist } from './lib/hh3dPlayer.js';
import { hh3dBase, isHh3dPage } from './lib/hh3dBase.js';
import { routesTo } from './sources/nguonc.js';
import { pinsFor } from './lib/subtitlePins.js';
import { landingPage } from './lib/landing.js';
import { LOGO_SVG, LOGO_PNG } from './lib/logo.js';

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
    return {
      status: res.status,
      usable,
      ms: Date.now() - started,
      // Ai từ chối: relay của mình, hay biên Cloudflare đứng trước nó? Hai bên
      // cùng trả 403 nên status không phân biệt được — nội dung thì có.
      server: res.headers.get('server'),
      cfRay: res.headers.get('cf-ray'),
      snippet: usable ? undefined : text.slice(0, 200),
    };
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

/**
 * Manifest kèm địa chỉ logo tuyệt đối.
 *
 * Stremio đọc `logo` như một URL đứng riêng, không ghép với địa chỉ addon, nên
 * nó phải là đường dẫn đầy đủ. Suy ra từ chính request thay vì cấu hình, để
 * addon chạy ở đâu cũng trỏ đúng vào bản thân nó.
 */
function manifestFor(req) {
  // PNG chứ không phải SVG: Stremio dựng logo bằng thẻ ảnh, và không phải bản
  // nào cũng đọc được SVG — hỏng thì ô addon chỉ còn hình mảnh ghép.
  return { ...MANIFEST, logo: `${baseUrlOf(req)}/logo.png` };
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
      return res.end(landingPage(baseUrlOf(req)));
    }
    if (path === '/manifest.json') return send(res, 200, manifestFor(req), { edge: true });

    // Logo của addon, phục vụ tại chỗ để manifest khỏi trỏ ra bên ngoài.
    // Hai định dạng: PNG cho Stremio, SVG cho trang web và ai muốn bản nét.
    if (path === '/logo.png' || path === '/logo.svg') {
      const png = path === '/logo.png';
      res.writeHead(200, {
        ...CORS,
        'content-type': png ? 'image/png' : 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=86400',
      });
      return res.end(png ? LOGO_PNG : LOGO_SVG);
    }

    // /stream/:type/:id.json
    const m = /^\/stream\/(movie|series)\/(.+?)(?:\.json)?$/.exec(path);
    if (m) {
      const [, type, id] = m;
      const baseUrl = baseUrlOf(req);
      const { streams } = await getStreams(type, id, { baseUrl });
      return send(res, 200, { streams, cacheMaxAge: 600 }, { edge: true });
    }

    /**
     * /subtitles/:type/:id/:extra.json — phụ đề cho phim đang xem.
     *
     * Stremio hỏi MỌI addon có khai `subtitles` theo id của phim, không quan tâm
     * luồng đang phát do addon nào cung cấp. Nên phụ đề ghim ở đây gắn được vào
     * cả torrent của addon khác, không riêng phim do addon này phục vụ.
     *
     * `extra` là chuỗi kiểu query mà Stremio gắn thêm khi biết: `filename`,
     * `videoHash`, `videoSize`. `filename` là thứ đáng giá nhất — nó cho biết
     * đang xem BẢN RELEASE nào, và phụ đề khớp bản thì mới khớp tiếng.
     */
    const sub = /^\/subtitles\/(movie|series)\/(.+?)(?:\.json)?$/.exec(path);
    if (sub) {
      const [, , rest] = sub;
      const cut = rest.indexOf('/');
      const id = cut === -1 ? rest : rest.slice(0, cut);
      const extra = new URLSearchParams(cut === -1 ? '' : rest.slice(cut + 1));
      const filename = extra.get('filename') || '';

      const subtitles = pinsFor(id, filename).map((s, i) => ({
        id: `wisfilm-${i}`,
        url: s.url,
        lang: s.lang || 'vie',
        ...(s.label ? { label: s.label } : {}),
      }));

      return send(res, 200, { subtitles, cacheMaxAge: 1800 }, { edge: true });
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

    /**
     * /hls.m3u8?u=<embed url> — a Nguồn C episode as a playlist.
     *
     * streamc publishes no track in its page: the playlist is granted over the
     * page's own API, and its segments are MPEG-TS named .png on a host that
     * answers 403 without a Referer. So the playlist is fetched here and served
     * with every segment pointed at the viewer's own streaming server, which is
     * what can attach that Referer. See lib/streamc.js.
     */
    if (path === '/hls.m3u8') {
      const u = url?.searchParams?.get('u') || '';
      if (!u || !isStreamc(u) || !embedFetchable(u)) {
        return send(res, 400, { err: 'chỉ nhận embed của streamc.xyz', embed: u || null });
      }
      let playlist;
      try {
        playlist = await playlistOf(u);
      } catch (err) {
        return send(res, 502, { err: err.message, embed: u });
      }
      if (!playlist) return send(res, 502, { err: 'streamc không cấp playlist phát được', embed: u });
      res.writeHead(200, {
        ...CORS,
        'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
        // The grant inside is short-lived, and a stale copy is a dead playlist.
        // Playlist dựng từ CDN không mang token nên cache được; bản do streamc
        // cấp thì hết hạn sau vài giờ, và một bản cũ là một playlist chết.
        'cache-control': playlist.via === 'cdn' ? 'public, max-age=0, s-maxage=1800' : 'no-store',
      });
      return res.end(playlist.body);
    }

    // /probe/embed?u=<embed url> — why a given embed can or cannot be played
    // inside Stremio: what the query string carries, what the page declares,
    // and whether the track that comes out is a manifest Stremio can read.
    if (path === '/probe/embed') {
      const u = url?.searchParams?.get('u') || '';
      if (!u) return send(res, 400, { err: 'thiếu ?u=<embed url>' });

      // streamc never resolves to a single URL — it is served as a playlist by
      // /hls.m3u8 — so what gets reported is whether the grant came through and
      // whether the first segment behind it can actually be fetched.
      if (isStreamc(u)) {
        const playlist = await playlistOf(u).catch((err) => ({ error: err.message }));
        const lines = String(playlist?.body || '').split(/\r?\n/);
        const first = lines.find((line) => /^https?:/.test(line));
        const media = first ? await inspectMedia(first) : null;
        // Không lấy được gì thì mới cần biết ai từ chối, ở bước nào.
        const steps = playlist?.body ? undefined : (await diagnose(u)).steps;
        const ok = media?.status === 200 || media?.status === 206;

        return send(res, 200, {
          embed: u,
          hostAllowed: embedFetchable(u),
          via: playlist?.via || null,
          host: playlist?.host,
          segments: lines.filter((l) => /^https?:/.test(l)).length,
          segmentSeconds: playlist?.each,
          firstSegment: media,
          steps,
          stremioProxy: CONFIG.stremioProxy || null,
          verdict: !playlist?.body
            ? 'không dựng được playlist — xem steps'
            : !CONFIG.stremioProxy
              ? 'có playlist nhưng STREMIO_PROXY rỗng → segment sẽ 403'
              : ok
                ? `phát được trong Stremio (playlist: ${playlist.via})`
                : `có playlist nhưng segment không tải được (${media?.status ?? media?.error})`,
        });
      }

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

    /**
     * /hh3d.m3u8?u=<trang tập> — một tập HH3D, phát được trong Stremio.
     *
     * Link phát của HH3D nằm sau một gói mã hoá và một khoá dùng một lần; chỗ
     * mở ra nằm ở lib/hh3dPlayer.js. Playlist trả về trỏ thẳng vào CDN của họ và
     * không đòi header nào, nên nguồn này phát được cả khi máy xem không có
     * server nội bộ của Stremio.
     */
    if (path === '/hh3d.m3u8') {
      const u = url?.searchParams?.get('u') || '';
      if (!(await isHh3dPage(u))) {
        return send(res, 400, { err: 'chỉ nhận trang tập của hoathinh3d', page: u || null });
      }
      let playlist;
      try {
        playlist = await hh3dPlaylist(u, { segmentBase: `${baseUrlOf(req)}/hh3d-seg` });
      } catch (err) {
        return send(res, 502, { err: err.message, page: u });
      }
      if (!playlist) return send(res, 502, { err: 'không lấy được link phát của tập này', page: u });
      res.writeHead(200, {
        ...CORS,
        'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'cache-control': 'public, max-age=0, s-maxage=1800',
      });
      return res.end(playlist.body);
    }

    // /probe/hh3d?u=<trang tập> — luồng lấy link phát của HH3D, từng bước.
    if (path === '/probe/hh3d') {
      const u = url?.searchParams?.get('u') || '';
      if (!u) return send(res, 400, { err: 'thiếu ?u=<trang tập>' });
      const started = Date.now();
      let playlist = null;
      let error = null;
      try {
        playlist = await hh3dPlaylist(u, { segmentBase: `${baseUrlOf(req)}/hh3d-seg` });
      } catch (err) {
        error = err.message;
      }
      const first = String(playlist?.body || '')
        .split(/\r?\n/)
        .find((line) => /^https?:/.test(line));
      const media = first ? await inspectMedia(first) : null;
      return send(res, 200, {
        page: u,
        ms: Date.now() - started,
        error,
        base: await hh3dBase(),
        via: playlist?.via ?? null,
        offset: playlist?.offset ?? null,
        segments: playlist?.segments ?? 0,
        seconds: playlist?.seconds ?? null,
        label: playlist?.label ?? null,
        skip: playlist?.skip ?? null,
        firstSegment: media && { status: media.status, contentType: media.contentType, bytes: media.head?.length },
        verdict: playlist ? 'lấy được link phát' : error ? 'lỗi: ' + error : 'không lấy được link phát',
      });
    }

    /**
     * /hh3d-seg?p=<trang tập>&i=<số thứ tự> — một segment, đã bỏ lớp PNG.
     *
     * Chỉ dùng cho phim có bọc PNG; phim không bọc thì playlist trỏ thẳng CDN và
     * route này không được gọi tới.
     *
     * Nhận TRANG TẬP và số thứ tự chứ không nhận URL của CDN, vì hai lẽ. Một:
     * địa chỉ đi ra do chính addon dựng lại từ playlist, nên đây không phải proxy
     * mở và không cần danh sách host nào — mà danh sách host thì cũng cũ đúng lúc
     * họ đổi tên miền, CDN đổi theo. Hai: độ lệch cần bỏ nằm trong playlist, lấy
     * cùng chỗ luôn thì không thể lệch nhau giữa hai bên.
     *
     * Dựng lại playlist ở đây gần như luôn chỉ là đọc cache, vì trước đó Stremio
     * vừa gọi /hh3d.m3u8. Một isolate lạnh thì tốn bốn request cho segment đầu,
     * rồi các segment sau đọc cache.
     *
     * Phải trả đúng Range: người chơi tua tới sẽ xin một khoảng, tính trên vật
     * thể ĐÃ bỏ mấy byte đầu, nên phải dịch sang khoảng của file gốc rồi dịch câu
     * trả lời ngược lại.
     */
    if (path === '/hh3d-seg') {
      const page = url?.searchParams?.get('p') || '';
      const index = Number(url?.searchParams?.get('i'));
      if (!Number.isInteger(index) || index < 0 || !(await isHh3dPage(page))) {
        return send(res, 400, { err: 'cần ?p=<trang tập hh3d>&i=<số thứ tự>', page: page || null });
      }

      const playlist = await hh3dPlaylist(page, { segmentBase: `${baseUrlOf(req)}/hh3d-seg` }).catch(() => null);
      const target = playlist?.urls?.[index];
      if (!target) return send(res, 502, { err: 'không dựng lại được segment này', page, index });
      const skip = playlist.offset || 0;

      const asked = req.headers.range || '';
      const m = /^bytes=(\d*)-(\d*)$/.exec(asked.trim());
      const from = m && m[1] ? Number(m[1]) : 0;
      const to = m && m[2] ? Number(m[2]) : null;

      try {
        const hit = await fetch(target, {
          headers: {
            'user-agent': CONFIG.userAgent,
            referer: `${new URL(page).origin}/`,
            range: `bytes=${skip + from}-${to == null ? '' : skip + to}`,
          },
          signal: AbortSignal.timeout(CONFIG.httpTimeout),
        });
        if (!hit.ok && hit.status !== 206) {
          return send(res, 502, { err: `segment trả HTTP ${hit.status}`, segment: target });
        }

        // Kích thước thật nằm trong Content-Range của CDN; trừ phần đã bỏ ra là
        // kích thước vật thể mà người chơi nhìn thấy.
        const total = Number(/\/(\d+)$/.exec(hit.headers.get('content-range') || '')?.[1]);
        const size = Number.isFinite(total) ? total - skip : null;
        const headers = {
          'access-control-allow-origin': '*',
          'content-type': 'video/mp2t',
          'accept-ranges': 'bytes',
          // Segment không bao giờ đổi nội dung, nên cache dài và để biên
          // Cloudflare trả cho lần xem sau.
          'cache-control': 'public, max-age=86400, s-maxage=604800, immutable',
        };
        const length = hit.headers.get('content-length');
        if (length) headers['content-length'] = length;

        if (m && size != null) {
          const last = to == null ? size - 1 : Math.min(to, size - 1);
          res.writeHead(206, { ...headers, 'content-range': `bytes ${from}-${last}/${size}` });
        } else {
          res.writeHead(200, headers);
        }
        // Workers nhận ReadableStream nên byte chảy qua chứ không đệm hết vào
        // RAM; node:http thì không, nên bản chạy ở nhà đệm từng segment.
        return res.end(CONFIG.onWorkers ? hit.body : Buffer.from(await hit.arrayBuffer()));
      } catch (err) {
        return send(res, 502, { err: err.message, segment: target });
      }
    }
    // /probe/seg?u=<segment url>&r=<referer> — liệu deployment này có gọi được CDN
    // segment hay không. Câu hỏi riêng, vì CDN đó là tên miền khác với trang
    // embed và có thể không nằm sau cùng một lớp chặn.
    if (path === '/probe/seg') {
      const u = url?.searchParams?.get('u') || '';
      const r = url?.searchParams?.get('r') || '';
      if (!u) return send(res, 400, { err: 'thiếu ?u=' });
      const started = Date.now();
      try {
        const hit = await fetch(u, {
          headers: { 'user-agent': CONFIG.userAgent, range: 'bytes=0-15', ...(r ? { referer: r } : {}) },
          signal: AbortSignal.timeout(CONFIG.httpTimeout),
        });
        const buf = new Uint8Array(await hit.arrayBuffer());
        return send(res, 200, {
          url: u,
          status: hit.status,
          ms: Date.now() - started,
          server: hit.headers.get('server') || null,
          contentType: hit.headers.get('content-type') || null,
          bytes: buf.length,
          isTs: buf[0] === 0x47,
        });
      } catch (err) {
        return send(res, 200, { url: u, status: null, ms: Date.now() - started, error: err.message });
      }
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
