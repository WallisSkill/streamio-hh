import { CONFIG } from '../config.js';
import { getText, safe } from './http.js';
import { cached } from './cache.js';

/**
 * Embed page -> a track Stremio can actually play.
 *
 * Stremio's player takes a media URL, never an HTML page. Handing it an embed
 * URL as `url` makes it try to play markup, so every embed has to become an
 * m3u8/mp4 first — and the ones that cannot are better off as external links.
 *
 * Three ways in, cheapest first:
 *   1. the player page carries the track in its own query string
 *      (`player.phimapi.com/player/?url=<m3u8>`) — pure string work, no request;
 *   2. the page declares it openly in markup (`file:`, `sources: [...]`,
 *      `<video src>`, a base64 data attribute) — one fetch;
 *   3. streamc.xyz publishes what its own player needs — a signed stream token
 *      and the video hash — in a base64 data attribute, which is enough to
 *      build a playable track through CONFIG.streamcProxy. See fromStreamc.
 *
 * A page that publishes none of the three is out of scope: resolveEmbed returns
 * null and the caller falls back to an external link.
 */

const MEDIA = /https?:\/\/[^\s"'<>\\)]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\)]*)?/i;

/** Query keys player pages use to carry the real track in plain sight. */
const CARRIERS = ['url', 'link', 'source', 'src', 'file', 'm3u8', 'video', 'play'];

/** Markup often arrives JSON-escaped, where every slash wears a backslash. */
const clean = (s) => String(s ?? '').replace(/\\\//g, '/').trim();

/** Some players pass the track base64'd rather than plain. */
function decodeMaybe(value) {
  if (!/^[A-Za-z0-9+/_=-]{16,}$/.test(value)) return null;
  try {
    const out = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return /^[\t\n\r\x20-\x7e]+$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** The media URL inside `value`, plain or base64'd — null if there is none. */
function asMedia(value) {
  const v = clean(value);
  if (!v) return null;
  if (/^https?:/i.test(v) && MEDIA.test(v)) return MEDIA.exec(v)[0];
  const decoded = clean(decodeMaybe(v));
  if (decoded && MEDIA.test(decoded)) return MEDIA.exec(decoded)[0];
  return null;
}

/** Track carried by the embed URL itself. Sync — no request, so it is free. */
export function unwrapEmbed(embed) {
  if (!embed) return null;
  let u;
  try {
    u = new URL(embed);
  } catch {
    return null;
  }
  if (/[.](?:m3u8|mp4)$/i.test(u.pathname)) return embed; // already a track, just named "embed"
  for (const key of CARRIERS) {
    const hit = asMedia(u.searchParams.get(key));
    if (hit) return hit;
  }
  for (const [, value] of u.searchParams) {
    const hit = asMedia(value); // same idea, under a key name we do not know
    if (hit) return hit;
  }
  return null;
}

/**
 * Guard for the fetching path. /resolve takes its URL from the request line, so
 * without a host allowlist it would fetch anything a caller names — including
 * the deployment's own network. Extend the list with EMBED_HOSTS.
 */
export function embedFetchable(embed) {
  try {
    const u = new URL(embed);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return CONFIG.embedHosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** How player pages that do publish their track tend to write it down. */
const DECLARED = [
  /["']?(?:file|src|source|hls|m3u8|stream)["']?\s*[:=]\s*["']([^"']{8,})["']/gi,
  /data-[\w-]+\s*=\s*["']([^"']{16,})["']/gi,
];

function fromMarkup(html) {
  for (const re of DECLARED) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(html))) {
      const hit = asMedia(m[1]);
      if (hit) return hit;
    }
  }
  const bare = MEDIA.exec(html);
  return bare ? clean(bare[0]) : null;
}

/**
 * streamc.xyz (Nguồn C) -> a track through CONFIG.streamcProxy.
 *
 * The page hands its own player everything it needs in one base64 attribute,
 * `#player[data-obf]`, which decodes to { sUb, hD }: a signed stream token and
 * the video hash. Neither is playable as-is — the playlist behind the token
 * arrives AES-GCM encrypted, and its segments answer 403 to any request without
 * a Referer, which Stremio never sends. So both are handed to the proxy, which
 * returns a plain playlist with every segment rewritten through itself.
 *
 * `t` inside the token is the same value the proxy wants as `key`; if the token
 * ever stops being readable JSON, the key is simply left empty rather than
 * failing the whole resolve.
 */
function fromStreamc(html, embed) {
  if (!CONFIG.streamcProxy) return null;

  const attr = /data-obf\s*=\s*["']([A-Za-z0-9+/=]{16,})["']/.exec(html);
  if (!attr) return null;

  const b64 = (value) => {
    try {
      return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  };

  const data = b64(attr[1]);
  const token = String(data?.sUb || '');
  const hash = String(data?.hD || '');
  if (!token || !hash) return null;

  const query = new URLSearchParams({
    url: `${new URL(embed).origin}/${token}.m3u8`,
    key: String(b64(token)?.t || ''),
    hash,
    referer: embed,
  });
  const track = `${CONFIG.streamcProxy}/proxy-playlist.m3u8?${query}`;

  // The proxy answers this one without any header, but the site it fronts is
  // header-gated throughout, so the track is handed over with Nguồn C's own
  // Referer/Origin attached rather than betting on that staying true.
  return viaStremioProxy(track, {
    Referer: `${CONFIG.nguoncApi}/`,
    'User-Agent': CONFIG.userAgent,
    Origin: CONFIG.nguoncApi,
  });
}

/**
 * Track -> the same track fetched by Stremio's streaming server with headers.
 *
 * Stremio's player sends no Referer of its own, so a host that demands one is
 * unreachable from it. Its local server takes the destination and the headers
 * in the URL itself and replays the request with them:
 *
 *   http://127.0.0.1:11470/proxy/d=<origin>&h=<Name:Value>&h=…/<path>?<query>
 *
 * 127.0.0.1 is the machine playing the video, not the one running this addon —
 * so this URL is built for the viewer and never fetched here.
 */
export function viaStremioProxy(track, headers = {}) {
  if (!CONFIG.stremioProxy) return track;

  let target;
  try {
    target = new URL(track);
  } catch {
    return track;
  }

  const opts = new URLSearchParams({ d: target.origin });
  for (const [name, value] of Object.entries(headers)) {
    if (value) opts.append('h', `${name}:${value}`);
  }
  return `${CONFIG.stremioProxy}/proxy/${opts}${target.pathname}${target.search}`;
}

/**
 * The reverse, for diagnostics: the real destination and headers behind a
 * proxy URL. /probe/embed runs on the addon's machine, where 127.0.0.1:11470
 * is either absent or someone else's server, so it has to look through it.
 */
export function unwrapStremioProxy(url) {
  const at = String(url).indexOf('/proxy/d=');
  if (at === -1) return { url, headers: {} };

  const rest = url.slice(at + '/proxy/'.length);
  const cut = rest.indexOf('/');
  if (cut === -1) return { url, headers: {} };

  const opts = new URLSearchParams(rest.slice(0, cut));
  const origin = opts.get('d');
  if (!origin) return { url, headers: {} };

  const headers = {};
  for (const pair of opts.getAll('h')) {
    const at2 = pair.indexOf(':');
    if (at2 > 0) headers[pair.slice(0, at2).trim()] = pair.slice(at2 + 1).trim();
  }
  return { url: origin + rest.slice(cut), headers };
}

/**
 * Embed URL -> { url, via } or null when the page does not publish its track.
 * `via` names the route that found it, so /probe/embed can show the reason.
 */
export async function resolveEmbed(embed) {
  const direct = unwrapEmbed(embed);
  if (direct) return { url: direct, via: 'query' };
  if (!CONFIG.resolveEmbeds || !embedFetchable(embed)) return null;

  return cached(
    `embed:${embed}`,
    async () => {
      const origin = `${new URL(embed).origin}/`;
      const page = await safe(getText(embed, { referer: origin, fresh: true }), 'embed');
      if (!page?.body) return null;

      // Host-specific first: on a streamc page the generic markup sweep has
      // nothing correct to find, so letting it guess first only risks a wrong
      // hit from an unrelated URL sitting in the page.
      const viaStreamc = fromStreamc(page.body, embed);
      if (viaStreamc) return { url: viaStreamc, via: 'streamc' };

      const hit = fromMarkup(page.body);
      return hit ? { url: hit, via: 'page' } : null;
    },
    CONFIG.embedTtl,
  );
}

/**
 * What a resolved URL really serves. A manifest that arrives encrypted
 * (`#ENC-`, `#EXT-X-B65` — decrypted by the site's own player at runtime) is
 * not something Stremio can play, and this is what says so out loud.
 */
export async function inspectMedia(url) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  // A proxied URL points at the viewer's machine, so what gets probed is the
  // destination behind it — with the headers the proxy would have replayed.
  const direct = unwrapStremioProxy(url);
  try {
    const res = await fetch(direct.url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': CONFIG.userAgent, range: 'bytes=0-2047', ...direct.headers },
    });
    const head = (await res.text()).slice(0, 800);
    let kind = 'unknown';
    if (/^#EXTM3U/.test(head)) kind = /#ENC-|#EXT-X-B65/.test(head) ? 'hls-encrypted' : 'hls';
    else if (/[.]mp4([?]|$)/i.test(direct.url)) kind = 'mp4';
    return {
      url,
      probed: direct.url === url ? undefined : direct.url,
      status: res.status,
      ms: Date.now() - started,
      contentType: res.headers.get('content-type') || null,
      kind,
      playable: kind === 'hls' || kind === 'mp4',
      head: head.slice(0, 180),
    };
  } catch (err) {
    return { url, status: null, ms: Date.now() - started, kind: 'error', playable: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}
