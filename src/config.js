const env = process.env;
const bool = (v, d) => (v === undefined ? d : !/^(0|false|no)$/i.test(String(v)));

// nguonc sits behind Cloudflare, which blocks datacenter IPs (Vercel etc.) with
// a 403 on every path while letting residential IPs through. So it is only
// useful when the addon runs from a home IP. Default it OFF on serverless hosts
// and ON otherwise; an explicit ENABLE_NGUONC always wins.
const onServerless = Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY);

const nguoncApi = (env.NGUONC_API || 'https://phim.nguonc.com').replace(/[/]+$/, '');

// A second instance of this addon running on a home connection, which forwards
// nguonc from its own IP through /upstream/nguonc. Set it on a serverless
// deployment to give nguonc back: only the API call travels this way, the embed
// pages and the stream itself stay direct (both already answer datacenter IPs).
const nguoncUpstream = (env.NGUONC_UPSTREAM || '').replace(/[/]+$/, '');

export const CONFIG = {
  port: Number(env.PORT || 7000),
  baseUrl: env.ADDON_BASE_URL || '',
  kkphimApi: (env.KKPHIM_API || 'https://phimapi.com').replace(/\/+$/, ''),
  ophimApi: (env.OPHIM_API || 'https://ophim1.com').replace(/[/]+$/, ''),
  nguoncApi,
  nguoncUpstream,
  // Where the nguonc source actually sends its calls. /probe/nguonc keeps using
  // nguoncApi directly, so it still reports whether THIS IP is blocked.
  nguoncBase: nguoncUpstream ? `${nguoncUpstream}/upstream/nguonc` : nguoncApi,
  hh3dBase: (env.HH3D_BASE || 'https://hoathinh3d.so').replace(/\/+$/, ''),
  enableOphim: bool(env.ENABLE_OPHIM, true),
  enableNguonc: bool(env.ENABLE_NGUONC, !onServerless || Boolean(nguoncUpstream)),
  enableKkphim: bool(env.ENABLE_KKPHIM, true),
  enableHh3d: bool(env.ENABLE_HH3D, true),
  // Embed pages: turn them into a playable track when they publish one.
  resolveEmbeds: bool(env.RESOLVE_EMBEDS, true),
  // Allowlist for the fetching path — /resolve takes its URL from the request line.
  embedHosts: String(env.EMBED_HOSTS || 'player.phimapi.com,streamc.xyz')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
  embedTtl: Number(env.EMBED_TTL || 300) * 1000,
  // Nguồn C serves its playlist AES-GCM encrypted, and its segments answer 403
  // to any request without a Referer — so the raw track is unplayable in
  // Stremio on both counts. This proxy decrypts the playlist and rewrites every
  // segment through itself, carrying the Referer the segment host demands.
  // Empty disables it: streamc episodes then fall back to an external link.
  streamcProxy: (env.STREAMC_PROXY ?? 'https://sc.k-20.xyz').replace(/\/+$/, ''),
  // Stremio's own streaming server, running on the machine that plays the
  // video — 127.0.0.1 here means the viewer's machine, not this deployment's.
  // Wrapping the track in it makes Stremio fetch the track with the Referer and
  // Origin of the site it came from. Empty hands over the bare URL instead.
  stremioProxy: (env.STREMIO_PROXY ?? 'http://127.0.0.1:11470').replace(/\/+$/, ''),
  cacheTtl: Number(env.CACHE_TTL || 1800) * 1000,
  cinemeta: 'https://v3-cinemeta.strem.io',
  kitsuApi: 'https://kitsu.io/api/edge',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  httpTimeout: 15000,
};
