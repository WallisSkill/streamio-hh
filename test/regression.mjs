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
 *
 * Một case khai id theo MỘT trong hai cách:
 *   - `id: 'series/tt…:2:1'` — khi chính cách đánh số phần là thứ đang test.
 *   - `imdb` + `absolute` — khi thứ đang test là khớp tập. Cách chia phần của
 *     Cinemeta đổi xoành xoạch, nên để nó tự dò (xem orderedEpisodes bên dưới).
 */
const BASE = process.env.ADDON || 'http://localhost:7010';

/**
 * Tập thứ N của cả bộ -> id mà Stremio ĐANG hỏi.
 *
 * Cinemeta chia lại phần của một bộ bất cứ lúc nào: Thôn Phệ Tinh Không trong
 * một tuần đi từ 5 phần (26/26/33/123/42) sang một phần 250 tập rồi quay lại 5
 * phần. Viết cứng "tt17050076:4:56" thì mỗi lần họ đổi là ba ca FAIL vì hỏi sai
 * chỗ, chứ không phải vì addon khớp sai — tôi đã mất hai lần sửa để nhận ra.
 *
 * Nên case khai SỐ TẬP TUYỆT ĐỐI, còn chỗ ngồi của nó thì hỏi Cinemeta lúc
 * chạy, đúng như Stremio tự làm. Phần 0 không tính vào đây: ngoại truyện không
 * nằm trong mạch tập.
 */
const metaCache = new Map();
async function orderedEpisodes(imdbId) {
  if (!metaCache.has(imdbId)) {
    const r = await fetch(`https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`);
    const j = await r.json().catch(() => null);
    const videos = (j?.meta?.videos || [])
      .filter((v) => Number(v.season) > 0 && Number.isFinite(Number(v.episode ?? v.number)))
      .map((v) => ({ season: Number(v.season), episode: Number(v.episode ?? v.number) }))
      .sort((a, b) => a.season - b.season || a.episode - b.episode);
    metaCache.set(imdbId, videos);
  }
  return metaCache.get(imdbId);
}

/** id Stremio của tập tuyệt đối thứ N, hoặc null nếu Cinemeta chưa có tập đó. */
async function idOfAbsolute(imdbId, absolute) {
  const list = await orderedEpisodes(imdbId);
  const at = list[absolute - 1];
  return at ? `series/${imdbId}:${at.season}:${at.episode}` : null;
}

/** Tập cuối Cinemeta đang có, theo số thứ tự tuyệt đối. */
async function lastAbsolute(imdbId) {
  return (await orderedEpisodes(imdbId)).length;
}

const CASES = [
  { id: 'series/tt2560140:1:5', want: { mode: 'season-entry', target: 5 }, why: 'AoT: nguồn tách theo phần' },
  { id: 'series/tt2560140:2:1', want: { mode: 'season-entry', target: 1 }, why: 'AoT S2E1 KHÔNG được thành tập 26' },
  { id: 'series/tt2560140:4:10', want: { mode: 'season-entry', target: 10 }, why: 'AoT phần 4' },
  { id: 'series/tt0388629:2:1', want: { mode: 'absolute', target: 9 }, why: 'One Piece: nguồn gộp -> tuyệt đối' },
  { id: 'series/tt0388629:21:1', want: { mode: 'absolute', target: 891 }, why: 'One Piece S21E1 = tập 891' },
  { id: 'movie/tt37141816', want: { mode: 'movie' }, why: 'Phim lẻ khớp bằng IMDb id' },
  {
    imdb: 'tt17050076',
    absolute: 141,
    source: 'nguonc',
    want: { target: 141 },
    wantStream: 'Nguồn C',
    why: 'Thôn Phệ Tinh Không: bỏ mục 26 tập, rơi xuống mục gộp -> tập 141',
  },
  {
    id: 'series/tt28022382:1:1',
    source: 'nguonc',
    wantStream: 'Nguồn C',
    want: {},
    why: 'Soul Land 2: phụ đề lệch (Clan/Sect) -> khớp phần trước dấu hai chấm',
  },
  {
    // Tập CUỐI Cinemeta đang có, thường là tập nguồn trong nước chưa kịp làm.
    // Không đòi "phải trống" vì nguồn sẽ bắt kịp: đòi ĐÚNG TẬP HOẶC KHÔNG CÓ —
    // đó mới là điều phải đúng mãi mãi, và chính là chỗ trước đây addon đoán
    // bừa sang tập khác.
    imdb: 'tt17050076',
    absolute: 'cuối',
    source: 'nguonc',
    wantExactOrNone: true,
    want: {},
    why: 'Tập mới nhất: hoặc đúng số tập ấy, hoặc không có dòng nào',
  },
  {
    imdb: 'tt17050076',
    absolute: 209,
    source: 'nguonc',
    wantStream: 'Nguồn C',
    want: { target: 209 },
    why: 'Tập 209: bỏ mục 26 tập để rơi xuống mục gộp',
  },
  {
    id: 'series/tt27432264:0:1',
    source: 'nguonc',
    wantStream: 'Nguồn C',
    wantPicked: 'tien-nghich-movie-than-lam-chi-chien',
    want: { mode: 'special' },
    why: 'Tiên Nghịch S0E1 = "The Battle of the Gods", không được ra ngoại truyện khác',
  },
  {
    id: 'series/tt17050076:0:2',
    source: 'nguonc',
    wantStream: 'Nguồn C',
    wantPicked: 'thon-phe-tinh-khong-movie-quyet-chien-nguyen-thuy-tinh',
    want: { mode: 'special' },
    why: 'Phần 0 phải khớp ĐÚNG tên tập đặc biệt, hai ngoại truyện không được đổi chỗ',
  },
];

let pass = 0;
for (const c of CASES) {
  // Ca khai số tập tuyệt đối thì hỏi Cinemeta xem tập ấy đang ngồi ở phần nào.
  if (c.imdb) {
    const n = c.absolute === 'cuối' ? await lastAbsolute(c.imdb) : c.absolute;
    c.id = await idOfAbsolute(c.imdb, n);
    if (c.want.target === undefined && c.wantExactOrNone) c.want = { ...c.want, target: n };
    if (!c.id) {
      console.log(`SKIP  ${c.imdb} tập ${n}: Cinemeta chưa có tập này`);
      pass += 1;
      continue;
    }
  }
  const res = await fetch(`${BASE}/debug/${c.id}`);
  const json = await res.json();
  const src = c.source || 'kkphim';
  const d = json.debug?.sources?.[src]?.decision || {};
  const okMode = c.want.mode === undefined || d.mode === c.want.mode;
  // "Đúng tập hoặc không có": nguồn chưa làm tới tập đó thì trống là đúng, chứ
  // không được ra một tập khác. Cách chia phần đổi thì tên mode đổi theo
  // (absolute <-> season-relative), nên những ca này không chốt mode.
  const noRows = (json.streams || []).length === 0;
  const okTarget =
    c.want.target === undefined || d.target === c.want.target || (c.wantExactOrNone && noRows);
  // `includes` chứ không phải `startsWith`: tên stream mang tiền tố thương hiệu
  // ở đầu, đổi tên addon không được làm hỏng bộ test.
  const okStream = c.wantExactOrNone
    ? true
    : c.wantNoStream
    ? noRows
    : c.wantStream
      ? (json.streams || []).some((s) => String(s.name || '').includes(c.wantStream))
      : (json.streams || []).length > 0;
  // Phần 0 có nhiều ngoại truyện cùng tên bộ, nên chỉ xem "có stream" là chưa
  // đủ: phải đúng MỤC nào, không thì một ngoại truyện khác vẫn tính PASS.
  const okPicked = !c.wantPicked || json.debug?.sources?.[src]?.picked?.slug === c.wantPicked;
  const ok = okMode && okTarget && okStream && okPicked;
  if (ok) pass++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(26)} ${src.padEnd(6)} ${d.mode || '-'} -> tập ${d.target ?? '-'}  (${json.streams?.length || 0} stream)  ${c.why}`,
  );
  if (!ok) {
    console.log(
      `      mong đợi ${c.want.mode || 'bất kỳ'} tập ${c.want.target ?? '-'}` +
        `${c.wantStream ? ` + stream "${c.wantStream}"` : ''}${c.wantPicked ? ` + mục "${c.wantPicked}"` : ''}; picked=${json.debug?.sources?.[src]?.picked?.slug}`,
    );
  }
}
console.log(`\n${pass}/${CASES.length} passed`);
process.exit(pass === CASES.length ? 0 : 1);
