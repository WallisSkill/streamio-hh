/**
 * Offline checks for the in-URL addon configuration.
 * No network, no server:  node test/addonConfig.mjs
 */

// Phải đặt TRƯỚC khi nạp config.js — CONFIG đọc process.env đúng một lần lúc
// import. Khoá giả này có mặt để chứng minh nó KHÔNG rò vào bản cài có cấu hình.
process.env.SUBSOURCE_API_KEY = 'env-key-must-not-leak';
process.env.SUBSOURCE_LANG = 'vietnamese';

const { encodeConfig, decodeConfig, splitConfig, settingsFrom } = await import(
  '../src/lib/addonConfig.js'
);

const seg = encodeConfig({ subsourceKey: 'sk_user_key', subsourceLang: 'vietnamese' });

const CASES = [
  {
    why: 'a config survives the round trip',
    got: () => JSON.stringify(decodeConfig(encodeConfig({ subsourceKey: 'abc123' }))),
    want: '{"subsourceKey":"abc123"}',
  },
  {
    why: 'the encoded segment is URL-safe',
    got: () => /^[A-Za-z0-9_-]+$/.test(seg),
    want: true,
  },
  {
    why: 'non-ASCII values survive',
    got: () => decodeConfig(encodeConfig({ subsourceLang: 'tiếng việt' }))?.subsourceLang,
    want: 'tiếng việt',
  },
  { why: 'an empty config encodes to nothing', got: () => encodeConfig({}), want: '' },
  {
    why: 'blank values are dropped rather than carried as empty strings',
    got: () => encodeConfig({ subsourceKey: '   ', subsourceLang: '' }),
    want: '',
  },

  // ---- không được nhầm tên tuyến là cấu hình ----
  { why: 'route name "subtitles" is not a config', got: () => decodeConfig('subtitles'), want: null },
  { why: 'route name "configure" is not a config', got: () => decodeConfig('configure'), want: null },
  { why: 'route name "manifest.json" is not a config', got: () => decodeConfig('manifest.json'), want: null },
  { why: 'route name "subsource.srt" is not a config', got: () => decodeConfig('subsource.srt'), want: null },
  { why: 'a JSON array is not accepted as config', got: () => decodeConfig(encodeConfig({}) || 'W10'), want: null },

  // ---- tách đường dẫn ----
  {
    why: 'a plain path is left completely alone',
    got: () => splitConfig('/stream/movie/tt1234567.json').rest,
    want: '/stream/movie/tt1234567.json',
  },
  {
    why: 'a plain path reports no config segment',
    got: () => splitConfig('/subtitles/series/tt1:1:5.json').seg,
    want: '',
  },
  {
    why: '/configure stays /configure',
    got: () => splitConfig('/configure').rest,
    want: '/configure',
  },
  {
    why: 'a configured path hands back the route without the segment',
    got: () => splitConfig(`/${seg}/subtitles/series/tt1:1:5.json`).rest,
    want: '/subtitles/series/tt1:1:5.json',
  },
  {
    why: 'a configured manifest path resolves to /manifest.json',
    got: () => splitConfig(`/${seg}/manifest.json`).rest,
    want: '/manifest.json',
  },
  {
    why: 'the segment alone resolves to the root',
    got: () => splitConfig(`/${seg}`).rest,
    want: '/',
  },
  {
    why: 'the decoded config comes back with the path',
    got: () => splitConfig(`/${seg}/manifest.json`).config?.subsourceKey,
    want: 'sk_user_key',
  },

  // ---- khoá: không có dự phòng khi URL mang cấu hình ----
  {
    why: 'a bare install falls back to the deployment secret',
    got: () => settingsFrom(null).subsourceKey,
    want: 'env-key-must-not-leak',
  },
  {
    why: "a configured install uses the installer's own key",
    got: () => settingsFrom({ subsourceKey: 'sk_user_key' }).subsourceKey,
    want: 'sk_user_key',
  },
  {
    why: 'a configured install with NO key does not borrow the deployment secret',
    got: () => settingsFrom({ subsourceLang: 'english' }).subsourceKey,
    want: '',
  },
  {
    why: 'a configured install with a blank key does not borrow it either',
    got: () => settingsFrom({ subsourceKey: '  ' }).subsourceKey,
    want: '',
  },
  {
    why: 'language is not a secret, so it still falls back to the default',
    got: () => settingsFrom({ subsourceKey: 'x' }).subsourceLang,
    want: 'vietnamese',
  },
  {
    why: 'a configured language wins over the default',
    got: () => settingsFrom({ subsourceKey: 'x', subsourceLang: 'english' }).subsourceLang,
    want: 'english',
  },
];

let pass = 0;
for (const c of CASES) {
  const got = await c.got();
  const ok = got === c.want;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.why}`);
  if (!ok) console.log(`      got ${JSON.stringify(got)}, want ${JSON.stringify(c.want)}`);
}
console.log(`\n${pass}/${CASES.length} passed`);
process.exit(pass === CASES.length ? 0 : 1);
