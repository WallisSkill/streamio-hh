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
 * Two ways in, cheapest first:
 *   1. the player page carries the track in its own query string
 *      (`player.phimapi.com/player/?url=<m3u8>`) — pure string work, no request;
 *   2. the page declares it openly in markup (`file:`, `sources: [...]`,
 *      `<video src>`, a base64 data attribute) — one fetch.
 *
 * A page that only assembles its track at runtime, behind a manifest its own
 * player decrypts, is deliberately out of scope: resolveEmbed returns null and
 * the caller falls back to an external link.
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
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': CONFIG.userAgent, range: 'bytes=0-2047' },
    });
    const head = (await res.text()).slice(0, 800);
    let kind = 'unknown';
    if (/^#EXTM3U/.test(head)) kind = /#ENC-|#EXT-X-B65/.test(head) ? 'hls-encrypted' : 'hls';
    else if (/[.]mp4([?]|$)/i.test(url)) kind = 'mp4';
    return {
      url,
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
