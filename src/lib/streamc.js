import { CONFIG } from '../config.js';
import { cached } from './cache.js';
import { viaStremioProxy } from './embed.js';

/**
 * streamc.xyz (Nguồn C) -> a playlist Stremio can play.
 *
 * The player page no longer carries anything playable in its markup: since the
 * `r25` rewrite it ships an empty `#player` plus one bootstrap object naming
 * its own URL as an API, and everything else is asked for over that API:
 *
 *   POST embed.php?hash=…  {"action":"bootstrap"}  -> { bootstrap: <jwt>, turnstileEnabled }
 *   POST embed.php?hash=…  {"action":"issue", bootstrap, playlist_format}
 *                                                 -> { playlist, issuedAt, expiresAt }
 *
 * Two details decide whether the result is usable:
 *
 *   • `playlist_format`. The page asks for 'aesgcm-v2' everywhere except Apple
 *     devices, and that one arrives AES-GCM encrypted for its own JS to undo —
 *     unplayable outside a browser. Asking for 'hls', the format it serves
 *     Safari, returns a plain media playlist instead.
 *   • the segments. They are MPEG-TS bytes named `.png` on a separate host that
 *     answers 403 to any request without a Referer, and Stremio's player sends
 *     none — so each one is rewritten through the viewer's own streaming server
 *     (see viaStremioProxy), which replays it with the Referer attached.
 *
 * The playlist itself is fetched here rather than handed over, because the
 * Cloudflare edge in front of streamc answers 403 to the streaming server while
 * letting this addon through — and because the segment lines have to be
 * rewritten one by one anyway.
 *
 * `turnstileEnabled` is the site's own switch for a Cloudflare Turnstile
 * challenge. It is off at the time of writing; when it is on, the grant needs a
 * solved challenge, which this addon does not attempt — it returns null and the
 * episode falls back to an external link.
 */

const HOST = /(^|[.])streamc[.]xyz$/i;

/** True for the embed hosts this module knows how to talk to. */
export function isStreamc(url) {
  try {
    return HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** One POST to the embed's own URL, which doubles as its API endpoint. */
async function api(embed, body) {
  const origin = new URL(embed).origin;
  const res = await fetch(embed, {
    method: 'POST',
    // The endpoint checks the caller's Origin and answers 403 `wrong_origin`
    // without it, so both header and page URL are stated explicitly.
    headers: {
      'user-agent': CONFIG.userAgent,
      'content-type': 'application/json',
      accept: 'application/json',
      referer: embed,
      origin,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CONFIG.httpTimeout),
  });
  if (!res.ok) throw new Error(`streamc ${body.action}: HTTP ${res.status}`);
  return res.json();
}

/**
 * The frame the grant is issued for.
 *
 * bootstrap hashes whatever origins it is told the player sits inside, and
 * `issue` checks its own list against those hashes — so both calls must name
 * the same one, and Nguồn C is where these embeds really are used.
 */
const frames = () => [CONFIG.nguoncApi];

/** { playlist, expiresAt } for an embed, or null when the site withholds it. */
export async function issuePlaylist(embed) {
  return cached(
    `streamc:issue:${embed}`,
    async () => {
      const boot = await api(embed, {
        action: 'bootstrap',
        referrer: `${CONFIG.nguoncApi}/`,
        frame_origins: frames(),
      });
      if (!boot?.bootstrap) return null;
      // Challenge turned on -> no grant without solving it. Stop here.
      if (boot.turnstileEnabled) return null;

      const issued = await api(embed, {
        action: 'issue',
        bootstrap: boot.bootstrap,
        turnstile_response: '',
        playlist_format: 'hls',
        pretty_url: true,
        path_chunks: true,
        frame_origins: frames(),
      });
      if (!issued?.playlist) return null;
      return { playlist: issued.playlist, format: issued.playlistFormat || null, expiresAt: issued.expiresAt || null };
    },
    CONFIG.embedTtl,
  );
}

/** Absolute URL of a playlist line, resolved against the playlist itself. */
const absolute = (line, base) => {
  try {
    return new URL(line, base).href;
  } catch {
    return null;
  }
};

/**
 * Every URL in the playlist, sent through the viewer's streaming server so it
 * arrives with the Referer its host demands. Comments pass through untouched,
 * except `#EXT-X-KEY`, whose URI is a fetch like any other.
 */
function rewrite(text, playlistUrl, referer) {
  const proxy = (raw) => {
    const url = absolute(raw, playlistUrl);
    return url ? viaStremioProxy(url, { Referer: referer }) : raw;
  };

  return text
    .split(/\r?\n/)
    .map((line) => {
      const s = line.trim();
      if (!s) return line;
      if (s.startsWith('#')) {
        return s.startsWith('#EXT-X-KEY')
          ? s.replace(/URI="([^"]+)"/, (_, uri) => `URI="${proxy(uri)}"`)
          : line;
      }
      return proxy(s);
    })
    .join('\n');
}

/**
 * Embed URL -> playlist text ready to hand to Stremio, or null.
 *
 * A master playlist (variant streams) would need its children rewritten too,
 * which nothing here does — the 'hls' format serves a flat media playlist, and
 * anything else is reported as unsupported rather than served half-working.
 */
export async function playlistFor(embed) {
  const issued = await issuePlaylist(embed);
  if (!issued) return null;

  const referer = `${new URL(embed).origin}/`;
  const res = await fetch(issued.playlist, {
    headers: { 'user-agent': CONFIG.userAgent, referer },
    signal: AbortSignal.timeout(CONFIG.httpTimeout),
  });
  if (!res.ok) throw new Error(`streamc playlist: HTTP ${res.status}`);

  const text = await res.text();
  if (!/^#EXTM3U/.test(text.trim())) throw new Error('streamc playlist: không phải m3u8');
  if (/#EXT-X-STREAM-INF/.test(text)) return null;

  return { body: rewrite(text, issued.playlist, referer), issued };
}

/**
 * What streamc says to THIS deployment, step by step.
 *
 * The three calls fail independently and for different reasons — the page is a
 * plain GET, the grant is a POST its edge treats differently, and the playlist
 * is a signed URL — so a single "403" tells you nothing about which one to fix.
 * Cloudflare's own headers come back too: they name who refused.
 */
export async function diagnose(embed) {
  const origin = new URL(embed).origin;
  const step = async (label, init) => {
    const started = Date.now();
    const { url = embed, ...rest } = init;
    try {
      const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(CONFIG.httpTimeout) });
      const body = await res.text();
      return {
        label,
        url,
        status: res.status,
        ms: Date.now() - started,
        server: res.headers.get('server') || null,
        cfRay: res.headers.get('cf-ray') || null,
        cfMitigated: res.headers.get('cf-mitigated') || null,
        contentType: res.headers.get('content-type') || null,
        snippet: body.slice(0, 160),
      };
    } catch (err) {
      return { label, status: null, ms: Date.now() - started, error: err.message };
    }
  };

  const page = await step('GET page', {
    headers: { 'user-agent': CONFIG.userAgent, accept: 'text/html', referer: `${CONFIG.nguoncApi}/` },
  });
  const boot = await step('POST bootstrap', {
    method: 'POST',
    headers: {
      'user-agent': CONFIG.userAgent,
      'content-type': 'application/json',
      accept: 'application/json',
      referer: embed,
      origin,
    },
    body: JSON.stringify({ action: 'bootstrap', referrer: `${CONFIG.nguoncApi}/`, frame_origins: frames() }),
  });
  return { steps: [page, boot] };
}
