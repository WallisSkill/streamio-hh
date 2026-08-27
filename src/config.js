const env = process.env;
const bool = (v, d) => (v === undefined ? d : !/^(0|false|no)$/i.test(String(v)));

// nguonc sits behind Cloudflare, which blocks datacenter IPs (Vercel etc.) with
// a 403 on every path while letting residential IPs through. So it is only
// useful when the addon runs from a home IP. Default it OFF on serverless hosts
// and ON otherwise; an explicit ENABLE_NGUONC always wins.
const onServerless = Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY);

export const CONFIG = {
  port: Number(env.PORT || 7000),
  baseUrl: env.ADDON_BASE_URL || '',
  kkphimApi: (env.KKPHIM_API || 'https://phimapi.com').replace(/\/+$/, ''),
  ophimApi: (env.OPHIM_API || 'https://ophim1.com').replace(/[/]+$/, ''),
  nguoncApi: (env.NGUONC_API || 'https://phim.nguonc.com').replace(/[/]+$/, ''),
  hh3dBase: (env.HH3D_BASE || 'https://hoathinh3d.so').replace(/\/+$/, ''),
  enableOphim: bool(env.ENABLE_OPHIM, true),
  enableNguonc: bool(env.ENABLE_NGUONC, !onServerless),
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
  cacheTtl: Number(env.CACHE_TTL || 1800) * 1000,
  cinemeta: 'https://v3-cinemeta.strem.io',
  kitsuApi: 'https://kitsu.io/api/edge',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  httpTimeout: 15000,
};
