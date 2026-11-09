/**
 * Phụ đề từ SubSource, gọi thẳng API chính chủ.
 *
 * Vì sao không dùng addon SubSource có sẵn: nó tải cả kho .zip rồi mới bung ra
 * chọn, nên gặp kho lớn là gục và in ra giữa màn hình "The subtitle archive is
 * too large to be processed". Ở đây đọc mục lục ZIP trước rồi chỉ giải nén đúng
 * tập đang xem, nên kho to bao nhiêu cũng không thành vấn đề.
 *
 * Cần khoá API (SUBSOURCE_API_KEY). Trần của SubSource: 60 lượt/phút,
 * 1.800/giờ, 7.200/ngày — nên mọi lệnh gọi đều đi qua cache chung.
 *
 * Hình dạng API lấy từ tài liệu chính thức (subsource.net/api-docs) đối chiếu
 * với client Go của clustarr, vì trang tài liệu liệt kê đường dẫn nhưng không
 * nói tên tham số lẫn tên trường JSON.
 */
import { CONFIG } from '../config.js';
import { cached } from '../lib/cache.js';
import { getCinemeta, getKitsuMeta } from '../lib/meta.js';
import { isZip, readZip, extractEntry } from '../lib/zip.js';
import { cleanSubtitle } from '../lib/subtitleText.js';
import { isAss, assToSrt } from '../lib/assToSrt.js';
import { releaseScore, wrongEpisode } from '../lib/releaseMatch.js';

const SUB_EXT = /\.(srt|ass|ssa|vtt|sub)$/i;

/**
 * Một lệnh gọi API. Khoá đi trong header chứ không bao giờ nằm trên URL.
 *
 * `key` truyền vào từng lệnh gọi chứ không đọc từ CONFIG: trên Workers nhiều
 * request dùng chung một isolate, nên bất cứ thứ gì mang tính "của người đang
 * gọi" mà cất vào biến dùng chung là rò từ người này sang người kia.
 */
async function api(path, params, key) {
  const url = new URL(CONFIG.subsourceApi + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: {
      'x-api-key': key,
      accept: 'application/json',
      'user-agent': CONFIG.userAgent,
    },
    signal: AbortSignal.timeout(CONFIG.httpTimeout),
  });
  if (!res.ok) throw new Error(`SubSource HTTP ${res.status} ${path}`);
  return res.json();
}

/** Tên phim để tìm bằng chữ, chỉ lấy khi tìm bằng mã IMDb đã trượt. */
async function titleOf(baseId, kitsuId) {
  try {
    if (kitsuId) return (await getKitsuMeta(kitsuId))?.name || '';
    const meta = (await getCinemeta('series', baseId)) || (await getCinemeta('movie', baseId));
    return meta?.name || '';
  } catch {
    return '';
  }
}

/**
 * Mã phim bên SubSource.
 *
 * Tìm bằng mã IMDb trước vì đó là thứ chắc chắn đúng; trượt mới lùi về tìm bằng
 * tên, và chỉ khi đó mới phải gọi Cinemeta.
 */
async function movieIdFor(baseId, kitsuId, season, key) {
  const imdb = /^tt\d+$/.test(baseId) ? baseId : null;

  if (imdb) {
    const data = await api('/movies/search', { searchType: 'imdb', imdb, season }, key);
    const hit = data?.data?.[0];
    if (hit?.movieId != null) return hit.movieId;
  }

  const title = await titleOf(baseId, kitsuId);
  if (!title) return null;

  const data = await api('/movies/search', { searchType: 'text', q: title.toLowerCase(), season }, key);
  return data?.data?.[0]?.movieId ?? null;
}

/** Những mẩu chữ đáng so trong tên tệp đang xem. */
function wordsOf(filename) {
  return String(filename)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 3);
}

/** Bao nhiêu mẩu trong tên tệp đang xem cũng xuất hiện ở tên bản phụ đề. */
function overlap(words, haystack) {
  if (!words.length) return 0;
  const hay = String(haystack).toLowerCase();
  return words.filter((w) => hay.includes(w)).length;
}

/**
 * Danh sách phụ đề SubSource cho một id Stremio (`tt123` hoặc `tt123:1:5`).
 * Bản khớp tên tệp đang xem xếp trước.
 */
export async function subsourceSubtitles(id, filename = '', settings = {}) {
  const apiKey = settings.subsourceKey;
  const lang = settings.subsourceLang || CONFIG.subsourceLang;
  if (!CONFIG.enableSubsource || !apiKey) return [];

  const [baseId, s, e] = String(id).split(':');
  const kitsuId = baseId === 'kitsu' ? s : null;
  const season = kitsuId ? null : s ? Number(s) : null;
  const episode = kitsuId ? null : e ? Number(e) : null;

  // Khoá cache KHÔNG chứa apiKey: kết quả chỉ phụ thuộc phim và ngôn ngữ, khoá
  // chỉ để xác thực. Nhét khoá vào đây thì mỗi người một bản cache, vừa phí vừa
  // dễ làm khoá rơi ra chỗ không ngờ.
  const cacheKey = `subsource:${id}:${lang}`;
  let list = cached(cacheKey, async () => {
    const movieId = await movieIdFor(baseId, kitsuId, season, apiKey);
    if (movieId == null) return [];

    const data = await api('/subtitles', {
      movieId,
      language: lang,
      limit: 100,
      seasonNumber: season,
      episodeNumber: episode,
    }, apiKey);
    // API báo hỏng bằng chuỗi "false" ở trường success chứ không bằng mã HTTP.
    if (String(data?.success) === 'false') return [];
    return data?.data || [];
  });

  try {
    list = await list;
  } catch {
    // Một nguồn chết không được kéo cả danh sách phụ đề xuống theo.
    return [];
  }
  if (!list?.length) return [];

  // `releaseInfo` là MẢNG tên bản, truyền thẳng mảng vào bộ chấm điểm: nó lấy
  // bản khớp nhất trong đó. Nối thành chuỗi trước thì một mục khai mười bản sẽ
  // bị loãng điểm và luôn thua mục chỉ khai một bản.
  const picked = list
    .filter((x) => x?.subtitleId != null)
    .map((x) => {
      const names = [].concat(x.releaseInfo || []).filter(Boolean);
      return { raw: x, names: names.length ? names : [String(x.link || '')] };
    })
    // Sai tập thì LOẠI HẲN, không phải trừ điểm.
    //
    // Đo 10/10/2026 trên What If...? S02E07: API trả về nguyên phần 2 dù đã
    // gửi seasonNumber/episodeNumber, và bản S02E09 khớp đúng nhóm RBB lẫn độ
    // phân giải nên ăn điểm cao nhất rồi lên đầu danh sách kèm dấu ✓. Điểm là
    // thang liên tục, không bao giờ chặn được chuyện đó — phải lọc.
    .filter(({ names }) => !wrongEpisode(names, season, episode))
    .map(({ raw, names }) => {
      const judged = releaseScore(filename, names);
      return {
        id: String(raw.subtitleId),
        release: names.filter(Boolean).join(', ') || 'phụ đề',
        hearingImpaired: Boolean(raw.hearingImpaired),
        contributors: contributorsOf(raw),
        commentary: oneLine(raw.commentary),
        uploaderId: raw.uploaderId ?? null,
        rating: raw.rating?.total ? { good: Number(raw.rating.good) || 0, total: Number(raw.rating.total) } : null,
        score: judged.score,
        verdict: judged.verdict,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, CONFIG.subtitleLimit);

  // Tên người đăng không có trong danh sách phụ đề, chỉ có mã — phải hỏi riêng
  // /users/{id}. Chỉ hỏi cho đúng mấy bản sẽ hiện ra, và cache dài vì tên với
  // huy hiệu của một người hầu như không đổi.
  const uploaders = await Promise.all(
    picked.map((x) => (x.uploaderId == null ? null : uploaderOf(x.uploaderId, apiKey))),
  );
  return picked.map((x, i) => ({ ...x, uploader: uploaders[i] }));
}

/**
 * Nhãn một dòng cho danh sách phụ đề của Stremio: bản phim, người đăng (kèm
 * huy hiệu), người dịch, lượt thích và lời người đăng — đủ để chọn mà không
 * phải mở SubSource ra xem.
 */
export function subsourceLabel(s) {
  const parts = ['WisFilm-SubSource', s.release];
  if (s.hearingImpaired) parts.push('CC');
  const up = s.uploader;
  if (up?.name) {
    const tag = up.verified ? ' (đã xác minh)' : up.badges?.length ? ` (${up.badges.join(', ')})` : '';
    parts.push(`Đăng: ${up.name}${tag}`);
  }
  const others = (s.contributors || []).filter((c) => c !== up?.name);
  if (others.length) parts.push(`Dịch: ${others.join(', ')}`);
  if (s.rating?.total) parts.push(`${s.rating.good}/${s.rating.total} thích`);
  if (s.commentary) parts.push(`“${s.commentary}”`);
  return parts.filter(Boolean).join(' · ');
}

/** Gọn một đoạn chú thích của người đăng thành một dòng ngắn cho nhãn. */
function oneLine(text, max = 80) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return [...s].length > max ? `${[...s].slice(0, max - 1).join('')}…` : s;
}

function contributorsOf(raw) {
  return [].concat(raw.contributors || [])
    .map((c) => String((typeof c === 'string' ? c : c?.displayname || c?.username) || '').trim())
    .filter(Boolean);
}

/**
 * Tên chữ của một huy hiệu. Tài liệu chỉ ghi `badges: []`, không nói phần tử
 * trông thế nào, nên nhận cả chuỗi lẫn object có tên/nhãn.
 */
function badgeName(b) {
  if (typeof b === 'string') return b.trim();
  return String(b?.name || b?.title || b?.label || b?.type || '').trim();
}

const USER_TTL = 24 * 60 * 60 * 1000;

/** { name, badges, verified } của người đăng, hoặc null khi không hỏi được. */
async function uploaderOf(userId, key) {
  try {
    return await cached(`subsource:user:${userId}`, async () => {
      const data = await api(`/users/${encodeURIComponent(userId)}`, {}, key);
      const u = data?.data;
      if (!u) return null;
      const badges = [].concat(u.badges || []).map(badgeName).filter(Boolean);
      return {
        name: String(u.displayname || u.username || '').trim(),
        badges,
        verified: badges.some((b) => /verif|trusted/i.test(b)),
      };
    }, USER_TTL);
  } catch {
    return null;
  }
}

/**
 * Chọn tệp phụ đề trong kho.
 *
 * Với phim bộ, khớp SxxExx là thứ quan trọng nhất: kho của SubSource thường là
 * nguyên một phần phim. Khớp sai thì phụ đề tập 7 chạy trên tập 1 — tệ hơn hẳn
 * là không có phụ đề, nên không khớp được thì trả về null chứ không đoán bừa.
 */
export function pickSubtitleEntry(entries, { filename = '', season = null, episode = null } = {}) {
  const usable = entries.filter((x) => {
    const base = x.name.split('/').pop() || '';
    if (!base || base.startsWith('.')) return false;
    if (x.name.startsWith('__MACOSX/')) return false;
    return SUB_EXT.test(base);
  });
  if (!usable.length) return null;
  // Một tệp duy nhất vẫn phải qua cửa sai tập: kho của tập 9 chỉ có đúng tệp
  // S01E09 thì đó vẫn là phụ đề của tập khác, không phải "đành lấy tạm".
  if (usable.length === 1) {
    return wrongEpisode([usable[0].name.split('/').pop()], season, episode) ? null : usable[0];
  }

  const words = wordsOf(filename);
  // Hai cách đặt tên thông dụng: "S01E05" và "1x05". Thiếu dạng thứ hai thì
  // kho dùng lối đặt tên đó bị coi là không khớp tập nào và rơi về null.
  const tag =
    season != null && episode != null
      ? new RegExp(`(?:s0*${season}[\\s._-]*e0*${episode}|\\b0*${season}x0*${episode})(?!\\d)`, 'i')
      : null;

  const scored = usable
    .map((x) => {
      let score = overlap(words, x.name);
      if (tag?.test(x.name)) score += 100;
      if (/\.srt$/i.test(x.name)) score += 1;
      return { entry: x, score };
    })
    .sort((a, b) => b.score - a.score || b.entry.size - a.entry.size);

  // Biết rõ đang xem tập nào mà không tệp nào mang đúng số tập ấy -> thà không
  // có còn hơn phát nhầm tập khác.
  if (tag && scored[0].score < 100) return null;

  return scored[0].entry;
}

/** Đọc thân phản hồi có trần, để một kho khổng lồ không thổi bay bộ nhớ Worker. */
async function readCapped(res, cap) {
  const declared = Number(res.headers.get('content-length') || 0);
  const mb = (n) => `${(n / 1048576).toFixed(1)}MB`;
  if (declared && declared > cap) throw new Error(`kho ${mb(declared)} vượt trần ${mb(cap)}`);

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel();
      throw new Error(`kho vượt trần ${mb(cap)}`);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Tải một phụ đề SubSource về dạng SRT Stremio đọc được.
 * Trả null khi không rút ra được tệp nào dùng được.
 */
export async function fetchSubsourceSubtitle(subtitleId, ctx = {}, settings = {}) {
  const apiKey = settings.subsourceKey;
  if (!apiKey) throw new Error('chưa có khoá SubSource');

  const res = await fetch(
    `${CONFIG.subsourceApi}/subtitles/${encodeURIComponent(subtitleId)}/download`,
    {
      headers: { 'x-api-key': apiKey, 'user-agent': CONFIG.userAgent },
      signal: AbortSignal.timeout(CONFIG.httpTimeout),
    },
  );
  if (!res.ok || !res.body) throw new Error(`SubSource HTTP ${res.status} khi tải`);

  const bytes = await readCapped(res, CONFIG.subsourceMaxArchive);

  // Có bản tải về là .srt trần chứ không đóng kho.
  let raw = bytes;
  if (isZip(bytes)) {
    const entry = pickSubtitleEntry(readZip(bytes), ctx);
    if (!entry) return null;
    raw = await extractEntry(bytes, entry);
    if (!raw) return null;
  }

  const text = new TextDecoder('utf-8').decode(raw);
  return isAss(text) ? assToSrt(text) : cleanSubtitle(text);
}
