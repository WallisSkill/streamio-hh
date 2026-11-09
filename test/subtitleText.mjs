/**
 * Offline checks for ASS tag stripping.
 * No network, no server:  node test/subtitleText.mjs
 */
import { cleanSubtitle } from '../src/lib/subtitleText.js';

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
