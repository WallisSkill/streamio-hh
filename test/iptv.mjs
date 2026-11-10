/**
 * Offline checks for the IPTV playlist support.
 * No network, no server:  node test/iptv.mjs
 * fetch is stubbed; any request outside the fake playlist hosts fails the run.
 */

const LIST_A = `#EXTM3U url-tvg="https://epg.example/epg.xml"
#EXTINF:-1 tvg-id="ch1" tvg-logo="https://img.example/1.png" group-title="Tin tức & Thời sự",Kênh Một
https://live.example/one/index.m3u8
#EXTINF:-1 tvg-id="ch2" group-title="Thể thao",Kênh, Hai
#EXTVLCOPT:http-user-agent=TestUA/1.0
#EXTVLCOPT:http-referrer=https://ref.example/
https://live.example/two.m3u8
#EXTINF:-1 group-title="Thể thao",Kênh Ba
https://live.example/three.m3u8|Referer=https%3A%2F%2Fthree.example%2F&User-Agent=Kodi
#EXTINF:-1 group-title="Phim",Kênh Khoá
#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha
#KODIPROP:inputstream.adaptive.license_key=https://lic.example/
https://live.example/drm.mpd
#EXTINF:-1,Không nhóm
https://live.example/nogroup.m3u8
not a url line
`;

const LIST_B = `#EXTM3U
#EXTINF:0 tvg-id="ch1" group-title="Khác nữa",KÊNH MỘT
https://backup.example/one.m3u8
#EXTGRP:Âm nhạc
#EXTINF:-1,Kênh Nhạc
#EXTHTTP:{"User-Agent":"JsonUA","X-Ignored":"1"}
udp://@225.1.2.3:30120
`;

const PLAYLISTS = {
  'https://lists.example/a.m3u': LIST_A,
  'https://lists.example/b.m3u8': LIST_B,
};
const fetched = [];
globalThis.fetch = async (url) => {
  const href = String(url);
  fetched.push(href);
  if (href === 'https://lists.example/broken.m3u') return new Response('nope', { status: 404 });
  if (!(href in PLAYLISTS)) throw new Error(`unexpected network call: ${href}`);
  return new Response(PLAYLISTS[href], { status: 200, headers: { 'content-type': 'audio/x-mpegurl' } });
};

delete process.env.IPTV_ALLOW_PRIVATE;
process.env.IPTV_PLAYLISTS = '';

const iptv = await import('../src/lib/iptv.js');
const { encodeConfig } = await import('../src/lib/addonConfig.js');
const { handleRequest } = await import('../src/app.js');

async function call(path) {
  return new Promise((resolve) => {
    let status = 0;
    const res = {
      writeHead(code) { status = code; return res; },
      end(body) { resolve({ status, body: body ? JSON.parse(body) : null }); },
      headersSent: false,
    };
    handleRequest({ method: 'GET', url: path, headers: { host: 'addon.test' } }, res);
  });
}

const entries = iptv.parseM3U(LIST_A);
const seg = encodeConfig({ iptv: 'https://lists.example/a.m3u\nhttps://lists.example/b.m3u8' });
const manifest = (await call(`/${seg}/manifest.json`)).body;
const bare = (await call('/manifest.json')).body;
const cat = manifest.catalogs?.[0];
const all = (await call(`/${seg}/catalog/tv/wis-iptv.json`)).body.metas;
const sport = (await call(`/${seg}/catalog/tv/wis-iptv/genre=${encodeURIComponent('Thể thao')}.json`)).body.metas;
const news = (await call(`/${seg}/catalog/tv/wis-iptv/genre=${encodeURIComponent('Tin tức & Thời sự')}.json`)).body.metas;
const found = (await call(`/${seg}/catalog/tv/wis-iptv/search=${encodeURIComponent('kenh mot')}.json`)).body.metas;
const one = all.find((m) => m.name === 'Kênh Một');
const meta = (await call(`/${seg}/meta/tv/${one.id}.json`)).body.meta;
const streams = (await call(`/${seg}/stream/tv/${one.id}.json`)).body.streams;
const two = all.find((m) => m.name === 'Kênh, Hai');
const twoStreams = (await call(`/${seg}/stream/tv/${two.id}.json`)).body.streams;
const otherInstall = (await call(`/${encodeConfig({ iptv: 'https://lists.example/b.m3u8' })}/stream/tv/${two.id}.json`)).body.streams;
const brokenSeg = encodeConfig({ iptv: 'https://lists.example/broken.m3u https://lists.example/b.m3u8' });
const partial = (await call(`/${brokenSeg}/catalog/tv/wis-iptv.json`)).body.metas;
let privateErr = '';
try {
  await iptv.loadChannels(['http://127.0.0.1:8080/list.m3u']).then((r) => { privateErr = r.errors.join(); });
} catch (e) { privateErr = String(e); }

const CASES = [
  { why: 'parser keeps http entries and drops DRM and junk lines', got: () => entries.map((e) => e.name).join('|'), want: 'Kênh Một|Kênh, Hai|Kênh Ba|Không nhóm' },
  { why: 'a quoted comma does not cut the name, a bare one does', got: () => entries[1].name, want: 'Kênh, Hai' },
  { why: 'logo and group come from the attributes', got: () => `${entries[0].logo}|${entries[0].group}`, want: 'https://img.example/1.png|Tin tức & Thời sự' },
  { why: '#EXTVLCOPT headers are kept', got: () => JSON.stringify(entries[1].headers), want: '{"User-Agent":"TestUA/1.0","Referer":"https://ref.example/"}' },
  { why: 'Kodi |headers are split off the URL', got: () => `${entries[2].url} ${JSON.stringify(entries[2].headers)}`, want: 'https://live.example/three.m3u8 {"Referer":"https://three.example/","User-Agent":"Kodi"}' },
  { why: '#EXTGRP and #EXTHTTP apply to the next entry', got: () => { const e = iptv.parseM3U(LIST_B)[1]; return `${e.group}|${JSON.stringify(e.headers)}|${e.url}`; }, want: 'Âm nhạc|{"User-Agent":"JsonUA"}|udp://@225.1.2.3:30120' },
  { why: 'playlistUrls keeps http(s), drops the rest and dedupes', got: () => iptv.playlistUrls('https://a.example/x.m3u, ftp://b/c\nhttps://a.example/x.m3u javascript:alert(1)').join(), want: 'https://a.example/x.m3u' },
  { why: 'playlistUrls caps at five lists', got: () => iptv.playlistUrls([1, 2, 3, 4, 5, 6, 7].map((i) => `https://l${i}.example/`).join(' ')).length, want: 5 },
  { why: 'private hosts are refused', got: () => ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '[::1]', 'printer.local'].every(iptv.isPrivateHost), want: true },
  { why: 'public hosts pass', got: () => ['example.com', '8.8.8.8', '172.32.0.1', 'raw.githubusercontent.com'].some(iptv.isPrivateHost), want: false },
  { why: 'a private playlist URL is never fetched', got: () => /nội bộ/.test(privateErr) && !fetched.some((u) => u.includes('127.0.0.1')), want: true },

  { why: 'a bare install keeps the old manifest: no catalog', got: () => JSON.stringify([bare.catalogs, bare.resources, bare.types]), want: '[[],["stream","subtitles"],["movie","series"]]' },
  { why: 'a configured install declares a tv catalog', got: () => `${cat?.type}/${cat?.id}/${cat?.name}`, want: 'tv/wis-iptv/Truyền hình' },
  { why: 'groups become genre options in playlist order', got: () => cat.extra.find((e) => e.name === 'genre').options.join('|'), want: 'Tin tức & Thời sự|Thể thao|Khác|Âm nhạc' },
  { why: 'meta and stream resources cover the iptv prefix', got: () => JSON.stringify(manifest.resources.slice(1, 3).map((r) => [r.name, r.types, r.idPrefixes.includes('iptv:')])), want: '[["meta",["tv"],true],["stream",["movie","series","tv"],true]]' },
  { why: 'subtitles stay limited to movies and series', got: () => JSON.stringify(manifest.resources[3].types), want: '["movie","series"]' },
  { why: 'the same channel in two lists is one tile', got: () => all.filter((m) => /^k[eê]nh m[oộ]t$/i.test(m.name)).length, want: 1 },
  { why: 'catalog lists every playable channel once', got: () => all.length, want: 5 },
  { why: 'tiles are square with the playlist logo', got: () => `${one.posterShape}|${one.poster}|${one.type}`, want: 'square|https://img.example/1.png|tv' },
  { why: 'genre filter works', got: () => sport.map((m) => m.name).join('|'), want: 'Kênh, Hai|Kênh Ba' },
  { why: 'a group name with & survives the route', got: () => news.map((m) => m.name).join('|'), want: 'Kênh Một' },
  { why: 'search ignores accents and case', got: () => found.map((m) => m.name).join('|'), want: 'Kênh Một' },
  { why: 'meta resolves the channel', got: () => `${meta?.name}|${meta?.description}`, want: 'Kênh Một|Tin tức & Thời sự · 2 nguồn phát' },
  { why: 'both links of a merged channel are streams', got: () => streams.map((s) => s.url).join(' '), want: 'https://live.example/one/index.m3u8 https://backup.example/one.m3u8' },
  { why: 'headers travel as proxyHeaders', got: () => JSON.stringify(twoStreams[0].behaviorHints.proxyHeaders), want: '{"request":{"User-Agent":"TestUA/1.0","Referer":"https://ref.example/"}}' },
  { why: 'a channel from another install is not served', got: () => otherInstall.length, want: 0 },
  { why: 'a broken list does not take the others down', got: () => partial.map((m) => m.name).join('|'), want: 'KÊNH MỘT|Kênh Nhạc' },
  { why: 'nothing outside the fake hosts was fetched', got: () => fetched.every((u) => u.startsWith('https://lists.example/')), want: true },
];

let pass = 0;
for (const c of CASES) {
  let got;
  try { got = await c.got(); } catch (e) { got = `THREW ${e?.message || e}`; }
  const ok = got === c.want;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.why}`);
  if (!ok) console.log(`      got ${JSON.stringify(got)}, want ${JSON.stringify(c.want)}`);
}
console.log(`\n${pass}/${CASES.length} passed`);
process.exit(pass === CASES.length ? 0 : 1);
