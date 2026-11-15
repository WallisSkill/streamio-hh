/**
 * Offline checks for ASS tag stripping.
 * No network, no server:  node test/subtitleText.mjs
 */
import { cleanSubtitle, decodeSubtitle } from '../src/lib/subtitleText.js';

const CASES = [
  {
    why: 'the reported bug: {\\an8} printed in front of the line',
    got: () => cleanSubtitle('{\\an8}nơi một lựa chọn duy nhất'),
    want: 'nơi một lựa chọn duy nhất',
  },
  {
    why: 'positioning and styling tags anywhere in the line',
    got: () => cleanSubtitle('{\\pos(192,50)}Chào{\\i1} anh{\\i0} nhé'),
    want: 'Chào anh nhé',
  },
  {
    why: 'colour tag, whose payload carries & and H',
    got: () => cleanSubtitle('{\\c&HFFFFFF&}Trắng'),
    want: 'Trắng',
  },
  {
    why: 'a tag written with a space after the brace',
    got: () => cleanSubtitle('{ \\an8}Trên đỉnh'),
    want: 'Trên đỉnh',
  },
  {
    why: "braces WITHOUT a backslash are the translator's own words",
    got: () => cleanSubtitle('{tiếng cười} Anh ấy nói gì?'),
    want: '{tiếng cười} Anh ấy nói gì?',
  },
  {
    why: '\\N is a hard line break, not the letter N',
    got: () => cleanSubtitle('Dòng một\\NDòng hai'),
    want: 'Dòng một\nDòng hai',
  },
  {
    why: '\\h is a non-breaking space',
    got: () => cleanSubtitle('Chương\\hI'),
    want: 'Chương I',
  },
  {
    why: 'SRT markup Stremio understands is left alone',
    got: () => cleanSubtitle('{\\i1}<i>nghiêng thật</i>'),
    want: '<i>nghiêng thật</i>',
  },
  {
    why: 'BOM in front of the first cue number',
    got: () => cleanSubtitle('﻿1'),
    want: '1',
  },
  {
    why: 'cue numbers and timing lines survive untouched',
    got: () =>
      cleanSubtitle(
        '1\n00:00:01,000 --> 00:00:04,000\n{\\an8}nơi một lựa chọn duy nhất\ncó thể dẫn tới vô số thực tại,\n\n2\n00:00:04,100 --> 00:00:06,000\n{\\pos(10,10)}Xin chào\n',
      ),
    want:
      '1\n00:00:01,000 --> 00:00:04,000\nnơi một lựa chọn duy nhất\ncó thể dẫn tới vô số thực tại,\n\n2\n00:00:04,100 --> 00:00:06,000\nXin chào\n',
  },
  // ---- nhận bảng mã ----
  //
  // SubSource có bản lưu UTF-16. Đoán cứng UTF-8 thì mỗi ký tự kèm một byte 00
  // và trình phát báo lỗi thay vì hiện phụ đề.
  ...(() => {
    const srt = '1\n00:00:01,100 --> 00:00:03,400\nSơ khởi, Chúa tạo ra vũ trụ\n';
    const u16 = (big) => {
      const out = [];
      for (const ch of srt) {
        const c = ch.codePointAt(0);
        if (big) out.push(c >> 8, c & 0xff);
        else out.push(c & 0xff, c >> 8);
      }
      return new Uint8Array(out);
    };
    const bom = (bytes, head) => new Uint8Array([...head, ...bytes]);
    const utf8 = new TextEncoder().encode(srt);
    return [
      { why: 'UTF-8 trần giữ nguyên', got: () => decodeSubtitle(utf8), want: srt },
      { why: 'BOM UTF-8 bị bỏ đi', got: () => decodeSubtitle(bom(utf8, [0xef, 0xbb, 0xbf])), want: srt },
      { why: 'UTF-16LE có BOM đọc được', got: () => decodeSubtitle(bom(u16(false), [0xff, 0xfe])), want: srt },
      { why: 'UTF-16BE có BOM đọc được', got: () => decodeSubtitle(bom(u16(true), [0xfe, 0xff])), want: srt },
      { why: 'UTF-16LE không BOM vẫn nhận ra (đếm byte 00)', got: () => decodeSubtitle(u16(false)), want: srt },
      { why: 'UTF-16BE không BOM vẫn nhận ra', got: () => decodeSubtitle(u16(true)), want: srt },
      { why: 'tệp rỗng không làm vỡ', got: () => decodeSubtitle(new Uint8Array()), want: '' },
    ];
  })(),
  { why: 'empty input passes through', got: () => cleanSubtitle(''), want: '' },
  { why: 'null input passes through', got: () => cleanSubtitle(null), want: null },
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
