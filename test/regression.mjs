/**
 * Live regression suite for episode mapping.
 * Run the addon first:  PORT=7010 node src/server.js
 * Then:                 node test/regression.mjs
 *
 * ADDON trỏ vào instance nào thì test instance đó — nhớ kiểm tra cổng đang
 * chạy đúng code muốn test, một server cũ còn sống sẽ báo PASS cho code cũ:
 *                       ADDON=http://localhost:7000 node test/regression.mjs
 *
 * Các case `source: 'nguonc'` cần chạy từ IP dân cư: Cloudflare của nguonc
 * chặn IP datacenter, nên trên server thuê chúng sẽ fail vì lý do khác.
 */
const BASE = process.env.ADDON || 'http://localhost:7010';

const CASES = [
  { id: 'series/tt2560140:1:5', want: { mode: 'season-entry', target: 5 }, why: 'AoT: nguồn tách theo phần' },
  { id: 'series/tt2560140:2:1', want: { mode: 'season-entry', target: 1 }, why: 'AoT S2E1 KHÔNG được thành tập 26' },
  { id: 'series/tt2560140:4:10', want: { mode: 'season-entry', target: 10 }, why: 'AoT phần 4' },
  { id: 'series/tt0388629:2:1', want: { mode: 'absolute', target: 9 }, why: 'One Piece: nguồn gộp -> tuyệt đối' },
  { id: 'series/tt0388629:21:1', want: { mode: 'absolute', target: 891 }, why: 'One Piece S21E1 = tập 891' },
  { id: 'movie/tt37141816', want: { mode: 'movie' }, why: 'Phim lẻ khớp bằng IMDb id' },
  {
    id: 'series/tt17050076:4:56',
    source: 'nguonc',
    want: { mode: 'absolute', target: 141 },
    wantStream: 'Nguồn C',
    why: 'Thôn Phệ Tinh Không: bỏ mục 26 tập, rơi xuống mục gộp 212 tập',
  },
  {
    id: 'series/tt28022382:1:1',
    source: 'nguonc',
    wantStream: 'Nguồn C',
    want: {},
    why: 'Soul Land 2: phụ đề lệch (Clan/Sect) -> khớp phần trước dấu hai chấm',
  },
];

let pass = 0;
for (const c of CASES) {
  const res = await fetch(`${BASE}/debug/${c.id}`);
  const json = await res.json();
  const src = c.source || 'kkphim';
  const d = json.debug?.sources?.[src]?.decision || {};
  const okMode = c.want.mode === undefined || d.mode === c.want.mode;
  const okTarget = c.want.target === undefined || d.target === c.want.target;
  // `includes` chứ không phải `startsWith`: tên stream mang tiền tố thương hiệu
  // ở đầu, đổi tên addon không được làm hỏng bộ test.
  const okStream = c.wantStream
    ? (json.streams || []).some((s) => String(s.name || '').includes(c.wantStream))
    : (json.streams || []).length > 0;
  const ok = okMode && okTarget && okStream;
  if (ok) pass++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(26)} ${src.padEnd(6)} ${d.mode || '-'} -> tập ${d.target ?? '-'}  (${json.streams?.length || 0} stream)  ${c.why}`,
  );
  if (!ok) {
    console.log(
      `      mong đợi ${c.want.mode || 'bất kỳ'} tập ${c.want.target ?? '-'}` +
        `${c.wantStream ? ` + stream "${c.wantStream}"` : ''}; picked=${json.debug?.sources?.[src]?.picked?.slug}`,
    );
  }
}
console.log(`\n${pass}/${CASES.length} passed`);
process.exit(pass === CASES.length ? 0 : 1);
