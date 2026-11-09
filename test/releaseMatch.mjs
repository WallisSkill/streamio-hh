/**
 * Offline checks for release-aware subtitle ranking.
 * No network, no server:  node test/releaseMatch.mjs
 */
import {
  parseRelease,
  releaseScore,
  verdictMark,
  episodeOf,
  wrongEpisode,
} from '../src/lib/releaseMatch.js';

/** Xếp hạng một danh sách tên bản phụ đề theo bản phim đang xem. */
const rank = (watched, names) =>
  names
    .map((n) => ({ n, s: releaseScore(watched, n).score }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.n);

const WATCHED_4K = 'Spider-Man.Brand.New.Day.2026.2160p.WEB-DL.DDP5.1.Atmos.H.265-FLUX.mkv';

const CASES = [
  // ---- tách dấu hiệu ----
  { why: '2160p is read as 2160p', got: () => parseRelease('X.2160p.WEB-DL.mkv').resolution, want: '2160p' },
  { why: '4K is the same thing as 2160p', got: () => parseRelease('X.4K.WEB-DL.mkv').resolution, want: '2160p' },
  { why: 'UHD is the same thing as 2160p', got: () => parseRelease('X.UHD.BluRay.mkv').resolution, want: '2160p' },
  { why: 'TELESYNC lands in the cam family', got: () => parseRelease('X.2026.TELESYNC.x264.mkv').source, want: 'cam' },
  { why: 'WEB-DL lands in the web family', got: () => parseRelease('X.2160p.WEB-DL.mkv').source, want: 'web' },
  { why: 'BluRay lands in the disc family', got: () => parseRelease('X.1080p.BluRay.x264.mkv').source, want: 'disc' },
  {
    why: 'a .ts file extension is NOT read as TELESYNC',
    got: () => parseRelease('Spider-Man.2026.1080p.WEB-DL.ts').source,
    want: 'web',
  },
  { why: 'the release group is the tail after the last dash', got: () => parseRelease('X.2160p.WEB-DL.H265-FLUX.mkv').group, want: 'flux' },

  // ---- đúng lỗi đã báo ----
  {
    why: 'watching 4K: the 2160p subtitle comes first, TELESYNC goes last',
    got: () =>
      rank(WATCHED_4K, [
        'Spider-Man Brand New Day 2026 TELESYNC x264',
        'Spider-Man.Brand.New.Day.2026.1080p.WEB-DL-FLUX',
        'Spider-Man.Brand.New.Day.2026.2160p.WEB-DL.H.265-FLUX',
      ]).join(' | '),
    want:
      'Spider-Man.Brand.New.Day.2026.2160p.WEB-DL.H.265-FLUX | ' +
      'Spider-Man.Brand.New.Day.2026.1080p.WEB-DL-FLUX | ' +
      'Spider-Man Brand New Day 2026 TELESYNC x264',
  },
  {
    why: 'a TELESYNC scores below zero against a retail release',
    got: () => releaseScore(WATCHED_4K, 'Spider-Man Brand New Day 2026 TELESYNC').score < 0,
    want: true,
  },
  {
    why: 'a TELESYNC claiming 1080p still loses to a real 1080p release',
    got: () =>
      rank('Movie.2026.1080p.WEB-DL-FLUX.mkv', [
        'Movie.2026.1080p.HDTS.x264',
        'Movie.2026.1080p.WEB-DL-FLUX',
      ])[0],
    want: 'Movie.2026.1080p.WEB-DL-FLUX',
  },
  {
    why: 'resolution decides when no release group matches',
    got: () =>
      rank('Movie.2026.2160p.WEB-DL-AAA.mkv', [
        'Movie.2026.1080p.WEB-DL-BBB',
        'Movie.2026.2160p.WEB-DL-CCC',
      ])[0],
    want: 'Movie.2026.2160p.WEB-DL-CCC',
  },
  {
    // Cùng nhóm thì thường là cùng một bản encode gốc, chỉ khác độ phân giải,
    // nên timing giống hệt. Lệch nhóm ở cùng độ phân giải mới là thứ hay lệch.
    why: 'the same group at another resolution beats another group at this one',
    got: () =>
      rank('Movie.2026.2160p.WEB-DL-AAA.mkv', [
        'Movie.2026.2160p.WEB-DL-BBB',
        'Movie.2026.1080p.WEB-DL-AAA',
      ])[0],
    want: 'Movie.2026.1080p.WEB-DL-AAA',
  },

  // ---- các dấu hiệu khác ----
  {
    why: 'the same release group wins over a different one at equal resolution',
    got: () =>
      rank('Movie.2026.1080p.WEB-DL-FLUX.mkv', [
        'Movie.2026.1080p.WEB-DL-RARBG',
        'Movie.2026.1080p.WEB-DL-FLUX',
      ])[0],
    want: 'Movie.2026.1080p.WEB-DL-FLUX',
  },
  {
    why: 'EXTENDED is not the theatrical cut and is pushed down',
    got: () =>
      rank('Movie.2026.1080p.BluRay-AAA.mkv', [
        'Movie.2026.EXTENDED.1080p.BluRay-AAA',
        'Movie.2026.1080p.BluRay-BBB',
      ])[0],
    want: 'Movie.2026.1080p.BluRay-BBB',
  },
  {
    why: 'with no filename nothing can be judged, so every score is 0',
    got: () => releaseScore('', 'Movie.2026.2160p.WEB-DL').score,
    want: 0,
  },
  {
    why: 'an entry listing many releases is judged on its best one',
    got: () =>
      releaseScore(WATCHED_4K, [
        'Some.Other.Movie.720p.HDTV',
        'Spider-Man.Brand.New.Day.2026.2160p.WEB-DL.H.265-FLUX',
      ]).verdict,
    want: 'group',
  },
  {
    why: 'listing many releases does not dilute the score',
    got: () => {
      const one = releaseScore(WATCHED_4K, ['Spider-Man.Brand.New.Day.2026.2160p.WEB-DL.H.265-FLUX']).score;
      const many = releaseScore(WATCHED_4K, [
        'Unrelated.720p.HDTV',
        'Spider-Man.Brand.New.Day.2026.2160p.WEB-DL.H.265-FLUX',
        'Another.480p.DVDRip',
      ]).score;
      return one === many;
    },
    want: true,
  },

  // ---- số tập: phải LOẠI, không phải trừ điểm ----
  {
    why: 'S02E09 is read out of a release name',
    got: () => JSON.stringify(episodeOf('What.If.2021.S02E09.WEB.H264-RBB')),
    want: '{"season":2,"episode":9}',
  },
  {
    why: 'the 2x07 style is read too',
    got: () => JSON.stringify(episodeOf('What.If.2021.2x07.1080p')),
    want: '{"season":2,"episode":7}',
  },
  {
    why: 'a film declares no episode',
    got: () => episodeOf('Spider-Man.Brand.New.Day.2026.2160p.WEB-DL-FLUX'),
    want: null,
  },
  {
    // Đúng ca đã gặp: xem 2×7, SubSource trả nguyên phần 2, và bản S02E09 khớp
    // nhóm RBB lẫn độ phân giải nên ăn điểm cao nhất.
    why: 'watching S02E07, an all-S02E09 entry is dropped however well it scores',
    got: () =>
      wrongEpisode(
        [
          'What.If.2021.S02E09.WEB.H264-RBB',
          'What.If.2021.S02E09.480p.x264-mSD',
          'What.If.2021.S02E09.DV.HDR.2160p.WEB.H265-EDITH',
        ],
        2,
        7,
      ),
    want: true,
  },
  {
    why: 'an entry that lists the episode being watched is kept',
    got: () =>
      wrongEpisode(['What.If.2021.S02E09.WEB.H264-RBB', 'What.If.2021.S02E07.WEB.H264-RBB'], 2, 7),
    want: false,
  },
  {
    why: 'a season pack declaring no episode is kept — the file is inside it',
    got: () => wrongEpisode(['What.If.2021.S02.COMPLETE.1080p.WEB-DL'], 2, 7),
    want: false,
  },
  {
    why: 'the right episode of the wrong season is still wrong',
    got: () => wrongEpisode(['What.If.2021.S01E07.WEB.H264-RBB'], 2, 7),
    want: true,
  },
  {
    why: 'a film is never dropped for an episode it cannot have',
    got: () => wrongEpisode(['Spider-Man.2026.2160p.WEB-DL'], null, null),
    want: false,
  },
  {
    why: 'string season and episode work, since ids arrive as text',
    got: () => wrongEpisode(['What.If.2021.S02E07.WEB.H264-RBB'], '2', '7'),
    want: false,
  },

  // ---- dấu hiển thị ----
  { why: 'a group match is marked', got: () => verdictMark('group'), want: '✓ ' },
  { why: 'a cam/retail clash is marked', got: () => verdictMark('mismatch'), want: '⚠ ' },
  { why: 'an unknown match gets no mark', got: () => verdictMark('unknown'), want: '' },
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
