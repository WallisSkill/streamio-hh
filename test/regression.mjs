/**
 * Live regression suite for episode mapping.
 * Run the addon first:  PORT=7010 node src/server.js
 * Then:                 node test/regression.mjs
 */
const BASE = process.env.ADDON || 'http://localhost:7010';

const CASES = [
  { id: 'series/tt2560140:1:5', want: { mode: 'season-entry', target: 5 }, why: 'AoT: nguồn tách theo phần' },
  { id: 'series/tt2560140:2:1', want: { mode: 'season-entry', target: 1 }, why: 'AoT S2E1 KHÔNG được thành tập 26' },
  { id: 'series/tt2560140:4:10', want: { mode: 'season-entry', target: 10 }, why: 'AoT phần 4' },
  { id: 'series/tt0388629:2:1', want: { mode: 'absolute', target: 9 }, why: 'One Piece: nguồn gộp -> tuyệt đối' },
  { id: 'series/tt0388629:21:1', want: { mode: 'absolute', target: 891 }, why: 'One Piece S21E1 = tập 891' },
  { id: 'movie/tt37141816', want: { mode: 'movie' }, why: 'Phim lẻ khớp bằng IMDb id' },
];

let pass = 0;
for (const c of CASES) {
  const res = await fetch(`${BASE}/debug/${c.id}`);
  const json = await res.json();
  const d = json.debug?.sources?.kkphim?.decision || {};
  const okMode = d.mode === c.want.mode;
  const okTarget = c.want.target === undefined || d.target === c.want.target;
  const okStream = (json.streams || []).length > 0;
  const ok = okMode && okTarget && okStream;
  if (ok) pass++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(26)} ${d.mode || '-'} -> tập ${d.target ?? '-'}  (${json.streams?.length || 0} stream)  ${c.why}`,
  );
  if (!ok) console.log(`      mong đợi ${c.want.mode} tập ${c.want.target ?? '-'}; picked=${json.debug?.sources?.kkphim?.picked?.slug}`);
}
console.log(`\n${pass}/${CASES.length} passed`);
process.exit(pass === CASES.length ? 0 : 1);
