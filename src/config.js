const env = process.env;
const bool = (v, d) => (v === undefined ? d : !/^(0|false|no)$/i.test(String(v)));

export const CONFIG = {
  port: Number(env.PORT || 7000),
  baseUrl: env.ADDON_BASE_URL || '',
  kkphimApi: (env.KKPHIM_API || 'https://phimapi.com').replace(/\/+$/, ''),
  ophimApi: (env.OPHIM_API || 'https://ophim1.com').replace(/[/]+$/, ''),
  hh3dBase: (env.HH3D_BASE || 'https://hoathinh3d.so').replace(/\/+$/, ''),
  enableOphim: bool(env.ENABLE_OPHIM, true),
  enableKkphim: bool(env.ENABLE_KKPHIM, true),
  enableHh3d: bool(env.ENABLE_HH3D, true),
  cacheTtl: Number(env.CACHE_TTL || 1800) * 1000,
  cinemeta: 'https://v3-cinemeta.strem.io',
  kitsuApi: 'https://kitsu.io/api/edge',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  httpTimeout: 15000,
};
