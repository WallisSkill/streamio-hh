/**
 * Offline checks for embed -> playable track.
 * No network, no server:  node test/embed.mjs
 */
import { unwrapEmbed, embedFetchable, viaStremioProxy, unwrapStremioProxy } from '../src/lib/embed.js';

const b64 = (s) => Buffer.from(s).toString('base64');

const CASES = [
  {
    why: 'KKPhim/Ophim player page carries the track in ?url=',
    got: () => unwrapEmbed('https://player.phimapi.com/player/?url=https://s2.phim1280.tv/a/index.m3u8'),
    want: 'https://s2.phim1280.tv/a/index.m3u8',
  },
  {
    why: 'a URL that is already a track passes through',
    got: () => unwrapEmbed('https://s2.phim1280.tv/a/index.m3u8'),
    want: 'https://s2.phim1280.tv/a/index.m3u8',
  },
  {
    why: 'track carried base64 under an unknown key name',
    got: () => unwrapEmbed(`https://p.example/e?q=${b64('https://cdn.example/v/index.m3u8')}`),
    want: 'https://cdn.example/v/index.m3u8',
  },
  {
    why: 'mp4 counts as playable too',
    got: () => unwrapEmbed('https://p.example/e?file=https://cdn.example/v/movie.mp4'),
    want: 'https://cdn.example/v/movie.mp4',
  },
  {
    why: 'Nguồn C carries nothing in its query string -> needs the page fetch',
    got: () => unwrapEmbed('https://embed13.streamc.xyz/embed.php?hash=06af44fa5379289b9'),
    want: null,
  },
  {
    why: 'a track goes out wrapped in the viewer-side Stremio proxy, headers and all',
    got: () =>
      viaStremioProxy('https://sc.k-20.xyz/proxy-playlist.m3u8?url=a', {
        Referer: 'https://phim.nguonc.com/',
      }),
    want:
      'http://127.0.0.1:11470/proxy/d=https%3A%2F%2Fsc.k-20.xyz' +
      '&h=Referer%3Ahttps%3A%2F%2Fphim.nguonc.com%2F/proxy-playlist.m3u8?url=a',
  },
  {
    why: 'an empty header value is left out rather than sent blank',
    got: () => viaStremioProxy('https://sc.k-20.xyz/a.m3u8', { Referer: '', Origin: 'https://x.y' }),
    want: 'http://127.0.0.1:11470/proxy/d=https%3A%2F%2Fsc.k-20.xyz&h=Origin%3Ahttps%3A%2F%2Fx.y/a.m3u8',
  },
  {
    why: 'the destination survives the round trip, query string included',
    got: () =>
      unwrapStremioProxy(viaStremioProxy('https://sc.k-20.xyz/p.m3u8?url=a&key=b', { Origin: 'https://x.y' })).url,
    want: 'https://sc.k-20.xyz/p.m3u8?url=a&key=b',
  },
  {
    why: 'a header value with its own colon comes back whole',
    got: () =>
      unwrapStremioProxy(viaStremioProxy('https://sc.k-20.xyz/p.m3u8', { Referer: 'https://phim.nguonc.com/' }))
        .headers.Referer,
    want: 'https://phim.nguonc.com/',
  },
  {
    why: 'an unproxied URL passes through untouched',
    got: () => unwrapStremioProxy('https://cdn.example/v/index.m3u8').url,
    want: 'https://cdn.example/v/index.m3u8',
  },
  { why: 'no embed at all', got: () => unwrapEmbed(null), want: null },
  { why: 'not a URL', got: () => unwrapEmbed('tap-01'), want: null },
  {
    why: 'allowlisted host, subdomain included',
    got: () => embedFetchable('https://embed13.streamc.xyz/embed.php?hash=x'),
    want: true,
  },
  {
    why: 'the deployment must not be talked into fetching its own network',
    got: () => embedFetchable('http://169.254.169.254/latest/meta-data/'),
    want: false,
  },
  { why: 'non-http scheme refused', got: () => embedFetchable('file:///etc/passwd'), want: false },
];

let pass = 0;
for (const c of CASES) {
  const got = c.got();
  const ok = got === c.want;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.why}`);
  if (!ok) console.log(`      got ${JSON.stringify(got)}, want ${JSON.stringify(c.want)}`);
}
console.log(`\n${pass}/${CASES.length} passed`);
process.exit(pass === CASES.length ? 0 : 1);
