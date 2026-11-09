/**
 * Offline checks for the SubSource list and its labels, against a fake API.
 * No network, no key:  node test/subsource.mjs
 */
process.env.ENABLE_SUBSOURCE = '1';

const calls = [];
const USERS = {
  7: { userId: 7, displayname: 'bobbyocean', badges: [{ name: 'Verified' }] },
  8: { userId: 8, displayname: 'VuxxLong', badges: [] },
};

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  calls.push({ path: url.pathname, key: init.headers?.['x-api-key'] });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  if (url.pathname.endsWith('/movies/search')) return json({ success: true, data: [{ movieId: 42 }] });
  if (url.pathname.endsWith('/subtitles')) {
    return json({
      success: true,
      data: [
        {
          subtitleId: 1,
          releaseInfo: ['Loki.S01E06.WEBRip.x264-ION10'],
          commentary: 'Dịch bởi bobbyocean (Fb.com/ImHighOnKetamine)   | sync lại',
          uploaderId: 7,
          contributors: [{ id: 7, displayname: 'bobbyocean' }],
          rating: { good: 12, bad: 2, total: 14 },
        },
        {
          subtitleId: 2,
          releaseInfo: ['Loki.S01E06.1080p.DSNP.WEBRip.DDP5.1.x264-TOMMY'],
          commentary: '',
          uploaderId: 8,
          contributors: [{ id: 9, displayname: 'NguyenUyen' }],
          hearingImpaired: true,
        },
        { subtitleId: 3, releaseInfo: ['Loki.S01E05.WEBRip.x264-ION10'], uploaderId: 7 },
        { subtitleId: 4, releaseInfo: ['Loki.S01E06.HDR.2160p.WEB.H265-EXPLOIT'], uploaderId: 99 },
      ],
    });
  }
  const user = url.pathname.match(/\/users\/(\d+)$/);
  if (user) return USERS[user[1]] ? json({ success: true, data: USERS[user[1]] }) : json({ error: 'not found' }, 404);
  return json({ error: 'unexpected' }, 500);
};

const { subsourceSubtitles, subsourceLabel } = await import('../src/sources/subsource.js');

const list = await subsourceSubtitles('tt9140554:1:6', 'Loki.S01E06.WEBRip.x264-ION10.mkv', {
  subsourceKey: 'k-test',
  subsourceLang: 'vietnamese',
});
const byId = Object.fromEntries(list.map((s) => [s.id, s]));

const CASES = [
  { why: 'the other episode is dropped', got: () => byId['3'], want: undefined },
  { why: 'the matching release ranks first', got: () => list[0]?.id, want: '1' },
  {
    why: 'a verified uploader, its translator and comment are in the label',
    got: () => subsourceLabel(byId['1']),
    want: 'WisFilm-SubSource · Loki.S01E06.WEBRip.x264-ION10 · Đăng: bobbyocean (đã xác minh) · 12/14 thích · “Dịch bởi bobbyocean (Fb.com/ImHighOnKetamine) | sync lại”',
  },
  {
    why: 'a translator other than the uploader is named, and CC is kept',
    got: () => subsourceLabel(byId['2']),
    want: 'WisFilm-SubSource · Loki.S01E06.1080p.DSNP.WEBRip.DDP5.1.x264-TOMMY · CC · Đăng: VuxxLong · Dịch: NguyenUyen',
  },
  {
    why: 'an uploader that cannot be looked up leaves the label without a name',
    got: () => subsourceLabel(byId['4']),
    want: 'WisFilm-SubSource · Loki.S01E06.HDR.2160p.WEB.H265-EXPLOIT',
  },
  { why: 'the key goes in the header on every call', got: () => calls.every((c) => c.key === 'k-test'), want: true },
  {
    why: 'each uploader is asked once',
    got: () => calls.filter((c) => c.path.endsWith('/users/7')).length,
    want: 1,
  },
  {
    why: 'a long comment is cut to one short line',
    got: () => [...subsourceLabel({ release: 'x', commentary: 'a'.repeat(79) + '…' })].length < 120,
    want: true,
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
