/**
 * Offline checks for ASS/SSA -> SRT.
 * No network, no server:  node test/assToSrt.mjs
 */
import { assToSrt, isAss } from '../src/lib/assToSrt.js';

const HEADER = [
  '[Script Info]',
  'Title: Test',
  'ScriptType: v4.00+',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize',
  'Style: Default,Arial,20',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
].join('\n');

/** Dựng một file ASS đủ phần đầu, chỉ khác nhau ở các dòng Dialogue. */
const ass = (...events) => `${HEADER}\n${events.join('\n')}\n`;

/** Một dòng Dialogue với khung giờ và lời thoại cho sẵn. */
const dlg = (start, end, text) => `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;

const CASES = [
  {
    why: 'centiseconds become milliseconds: .50 is 500ms, not 50ms',
    got: () => assToSrt(ass(dlg('0:00:01.00', '0:00:04.50', 'Chào'))),
    want: '1\n00:00:01,000 --> 00:00:04,500\nChào\n',
  },
  {
    why: 'the dialogue text may contain commas',
    got: () => assToSrt(ass(dlg('0:00:01.00', '0:00:02.00', 'Xin chào, anh khoẻ không?'))),
    want: '1\n00:00:01,000 --> 00:00:02,000\nXin chào, anh khoẻ không?\n',
  },
  {
    why: 'ASS override tags are gone from the converted cue',
    got: () => assToSrt(ass(dlg('0:00:01.00', '0:00:02.00', '{\\an8}nơi một lựa chọn duy nhất'))),
    want: '1\n00:00:01,000 --> 00:00:02,000\nnơi một lựa chọn duy nhất\n',
  },
  {
    why: '\\N becomes a real line break inside the cue',
    got: () => assToSrt(ass(dlg('0:00:01.00', '0:00:02.00', 'Dòng một\\NDòng hai'))),
    want: '1\n00:00:01,000 --> 00:00:02,000\nDòng một\nDòng hai\n',
  },
  {
    why: 'Comment: lines are the translator\'s notes and never play',
    got: () =>
      assToSrt(
        ass(
          'Comment: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,đừng phát dòng này',
          dlg('0:00:03.00', '0:00:04.00', 'Lời thoại thật'),
        ),
      ),
    want: '1\n00:00:03,000 --> 00:00:04,000\nLời thoại thật\n',
  },
  {
    why: 'vector drawing cues ({\\p1}) are coordinates, not speech',
    got: () =>
      assToSrt(
        ass(
          dlg('0:00:01.00', '0:00:02.00', '{\\p1}m 0 0 l 100 0 100 50{\\p0}'),
          dlg('0:00:03.00', '0:00:04.00', 'Lời thoại thật'),
        ),
      ),
    want: '1\n00:00:03,000 --> 00:00:04,000\nLời thoại thật\n',
  },
  {
    why: 'two cues on the same timing merge instead of fighting each other',
    got: () =>
      assToSrt(
        ass(
          dlg('0:00:01.00', '0:00:02.00', 'Lời thoại'),
          dlg('0:00:01.00', '0:00:02.00', '{\\an8}BIỂN HIỆU'),
        ),
      ),
    want: '1\n00:00:01,000 --> 00:00:02,000\nLời thoại\nBIỂN HIỆU\n',
  },
  {
    why: 'Dialogue lines out of order are sorted by start time',
    got: () =>
      assToSrt(
        ass(
          dlg('0:00:09.00', '0:00:10.00', 'Sau'),
          dlg('0:00:01.00', '0:00:02.00', 'Trước'),
        ),
      ),
    want: '1\n00:00:01,000 --> 00:00:02,000\nTrước\n\n2\n00:00:09,000 --> 00:00:10,000\nSau\n',
  },
  {
    why: 'a Format line in a different column order is honoured',
    got: () =>
      assToSrt(
        [
          '[Events]',
          'Format: Start, End, Style, Text',
          'Dialogue: 0:00:01.00,0:00:02.00,Default,Cột khác thứ tự',
        ].join('\n'),
      ),
    want: '1\n00:00:01,000 --> 00:00:02,000\nCột khác thứ tự\n',
  },
  {
    why: 'hours past 9 keep two digits',
    got: () => assToSrt(ass(dlg('1:02:03.04', '1:02:04.00', 'Muộn'))),
    want: '1\n01:02:03,040 --> 01:02:04,000\nMuộn\n',
  },
  {
    why: 'a zero-length cue is dropped',
    got: () => assToSrt(ass(dlg('0:00:01.00', '0:00:01.00', 'Chớp mắt'))),
    want: '',
  },
  {
    why: 'nothing convertible yields empty, so /sub.srt answers 502',
    got: () => assToSrt('[Script Info]\nTitle: trống rỗng\n'),
    want: '',
  },
  { why: 'empty input', got: () => assToSrt(''), want: '' },

  { why: 'detects a v4+ script', got: () => isAss(ass(dlg('0:00:01.00', '0:00:02.00', 'x'))), want: true },
  {
    why: 'detects an [Events]-only fragment',
    got: () => isAss('[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,x'),
    want: true,
  },
  {
    why: 'a real SRT is not mistaken for ASS',
    got: () => isAss('1\n00:00:01,000 --> 00:00:02,000\nChào bạn\n'),
    want: false,
  },
  { why: 'empty is not ASS', got: () => isAss(''), want: false },
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
