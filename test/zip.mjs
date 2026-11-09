/**
 * Offline checks for the minimal ZIP reader and subtitle picking.
 * No network, no server:  node test/zip.mjs
 */
import { isZip, readZip, extractEntry } from '../src/lib/zip.js';
import { pickSubtitleEntry } from '../src/sources/subsource.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

async function deflateRaw(bytes) {
  const s = new Response(bytes).body.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/**
 * Dựng một tệp ZIP thật trong bộ nhớ.
 *
 * `localExtra` cố tình chỉ bơm vào local header chứ không vào mục lục: đó đúng
 * là tình huống làm người tự đọc ZIP tính lệch vị trí dữ liệu.
 */
async function makeZip(files, { comment = '' } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const plain = enc.encode(f.text ?? '');
    const method = f.method ?? 8;
    const data = method === 8 ? await deflateRaw(plain) : plain;
    const extra = new Uint8Array(f.localExtra || 0);

    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(plain.length),
      ...u16(name.length), ...u16(extra.length),
      ...name, ...extra, ...data,
    ]);
    locals.push(local);

    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(plain.length),
      ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ...name,
    ]));
    offset += local.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const note = enc.encode(comment);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(offset),
    ...u16(note.length), ...note,
  ]);

  const parts = [...locals, ...central, eocd];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Lấy nội dung tệp tên `name` ra khỏi kho. */
async function readOut(zip, name) {
  const entry = readZip(zip).find((x) => x.name === name);
  const bytes = await extractEntry(zip, entry);
  return bytes === null ? null : dec.decode(bytes);
}

/** Danh sách mục giả, chỉ cần tên và cỡ — đúng thứ pickSubtitleEntry dùng. */
const entries = (...names) => names.map((name) => ({ name, size: 1000 }));

const CASES = [
  {
    why: 'a built archive is recognised as a zip',
    got: async () => isZip(await makeZip([{ name: 'a.srt', text: 'xin chào' }])),
    want: true,
  },
  {
    why: 'a bare .srt is not a zip',
    got: () => isZip(enc.encode('1\n00:00:01,000 --> 00:00:02,000\nChào\n')),
    want: false,
  },
  {
    why: 'the central directory lists every entry',
    got: async () =>
      readZip(
        await makeZip([
          { name: 'one.srt', text: 'a' },
          { name: 'two.srt', text: 'b' },
        ]),
      )
        .map((x) => x.name)
        .join(','),
    want: 'one.srt,two.srt',
  },
  {
    why: 'a deflated entry round-trips',
    got: async () => {
      const body = 'Xin chào, đây là phụ đề. '.repeat(40);
      return readOut(await makeZip([{ name: 'a.srt', text: body }]), 'a.srt');
    },
    want: 'Xin chào, đây là phụ đề. '.repeat(40),
  },
  {
    why: 'a stored (uncompressed) entry round-trips',
    got: async () =>
      readOut(await makeZip([{ name: 'a.srt', text: 'không nén', method: 0 }]), 'a.srt'),
    want: 'không nén',
  },
  {
    why: 'local header extra field longer than the central one still reads right',
    got: async () =>
      readOut(await makeZip([{ name: 'a.srt', text: 'lệch byte là hỏng', localExtra: 17 }]), 'a.srt'),
    want: 'lệch byte là hỏng',
  },
  {
    why: 'only the asked-for entry is inflated, out of many',
    got: async () => {
      const zip = await makeZip([
        { name: 'S01E01.srt', text: 'tập một' },
        { name: 'S01E02.srt', text: 'tập hai' },
        { name: 'S01E03.srt', text: 'tập ba' },
      ]);
      return readOut(zip, 'S01E02.srt');
    },
    want: 'tập hai',
  },
  {
    why: 'EOCD is found behind a trailing archive comment',
    got: async () =>
      readOut(await makeZip([{ name: 'a.srt', text: 'có chú thích' }], { comment: 'x'.repeat(300) }), 'a.srt'),
    want: 'có chú thích',
  },
  { why: 'garbage is not a zip and lists nothing', got: () => readZip(enc.encode('not a zip')).length, want: 0 },

  // ---- chọn tệp trong kho ----
  {
    why: 'a season pack picks the episode being watched',
    got: () =>
      pickSubtitleEntry(entries('Show.S01E01.srt', 'Show.S01E05.srt', 'Show.S01E12.srt'), {
        season: 1,
        episode: 5,
      })?.name,
    want: 'Show.S01E05.srt',
  },
  {
    why: 'the 1x05 naming style counts as the same episode',
    got: () =>
      pickSubtitleEntry(entries('Show.1x01.srt', 'Show.1x05.srt'), { season: 1, episode: 5 })?.name,
    want: 'Show.1x05.srt',
  },
  {
    why: 'E05 must not match E15',
    got: () =>
      pickSubtitleEntry(entries('Show.S01E15.srt', 'Show.S01E16.srt'), { season: 1, episode: 5 }),
    want: null,
  },
  {
    why: 'rather no subtitle than another episode\'s',
    got: () =>
      pickSubtitleEntry(entries('Show.S02E01.srt', 'Show.S02E02.srt'), { season: 1, episode: 5 }),
    want: null,
  },
  {
    why: '__MACOSX junk is never chosen',
    got: () =>
      pickSubtitleEntry(entries('__MACOSX/._Show.S01E05.srt', 'Show.S01E05.srt'), {
        season: 1,
        episode: 5,
      })?.name,
    want: 'Show.S01E05.srt',
  },
  {
    why: 'non-subtitle files in the archive are ignored',
    got: () => pickSubtitleEntry(entries('readme.txt', 'poster.jpg', 'phim.srt'))?.name,
    want: 'phim.srt',
  },
  {
    why: 'a lone subtitle is taken even with no hints at all',
    got: () => pickSubtitleEntry(entries('whatever.ass'))?.name,
    want: 'whatever.ass',
  },
  {
    why: 'a lone subtitle of another episode is still refused',
    got: () => pickSubtitleEntry(entries('Show.S01E09.srt'), { season: 1, episode: 5 }),
    want: null,
  },
  {
    why: 'a lone subtitle of the right episode is taken',
    got: () => pickSubtitleEntry(entries('Show.S01E05.srt'), { season: 1, episode: 5 })?.name,
    want: 'Show.S01E05.srt',
  },
  {
    why: 'a lone subtitle with no episode in its name is taken for a series',
    got: () => pickSubtitleEntry(entries('vietsub.srt'), { season: 1, episode: 5 })?.name,
    want: 'vietsub.srt',
  },
  {
    why: 'an entry that inflates past the cap is refused (zip bomb)',
    got: async () => {
      const zip = await makeZip([{ name: 'bomb.srt', text: 'a'.repeat(200000) }]);
      return extractEntry(zip, readZip(zip)[0], 1000);
    },
    want: null,
  },
  {
    why: 'a stored entry past the cap is refused too',
    got: async () => {
      const zip = await makeZip([{ name: 'big.srt', text: 'b'.repeat(5000), method: 0 }]);
      return extractEntry(zip, readZip(zip)[0], 1000);
    },
    want: null,
  },
  {
    why: 'for a film, the release name in the filename decides',
    got: () =>
      pickSubtitleEntry(entries('Movie.2024.WEBRip.x264-AAA.srt', 'Movie.2024.BluRay.x264-BBB.srt'), {
        filename: 'Movie.2024.BluRay.x264-BBB.mkv',
      })?.name,
    want: 'Movie.2024.BluRay.x264-BBB.srt',
  },
  {
    why: 'an archive with no subtitle at all yields nothing',
    got: () => pickSubtitleEntry(entries('readme.txt', 'cover.png')),
    want: null,
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
