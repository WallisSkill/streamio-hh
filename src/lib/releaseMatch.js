/**
 * Chấm điểm một bản phụ đề so với BẢN PHIM đang xem.
 *
 * Cách cũ đếm số từ trùng nhau và cho mọi từ nặng ngang nhau. Hỏng ở chỗ: với
 * "Spider-Man Brand New Day 2026", một bản phụ đề TELESYNC trùng đúng bằng số
 * từ với một bản WEB-DL — `spider`, `brand`, `2026` — nên nó lên đầu khi đang
 * xem bản 2160p. Mà TELESYNC là bản quay lén trong rạp: độ dài khác, có logo
 * đầu phim, cắt cảnh khác. Không bao giờ khớp tiếng với bản retail.
 *
 * Thứ tự quan trọng của các dấu hiệu:
 *
 *   1. NHÓM RELEASE  — cùng nhóm gần như chắc chắn cùng timing.
 *   2. ĐỘ PHÂN GIẢI  — khớp thì cộng nặng, lệch thì trừ.
 *   3. HỌ NGUỒN      — cam/TS so với retail là khác hẳn độ dài phim.
 *   4. PHIÊN BẢN     — EXTENDED so với bản chiếu rạp lệch hàng phút.
 *
 * Độ phân giải đứng cao theo yêu cầu, nhưng hình phạt cam/retail vẫn phải giữ,
 * và đây là lý do: bản TELESYNC hay tự gắn nhãn "1080p". Nếu chỉ xét độ phân
 * giải thì khi xem bản 1080p, chính cái TELESYNC ấy lại được cộng điểm và trèo
 * lên đầu — đúng cái lỗi cần sửa, chỉ đổi sang kịch bản khác.
 */

/** Bỏ đuôi tệp trước khi tách, nếu không ".ts" bị đọc thành nguồn TELESYNC. */
const stripExt = (s) => String(s || '').replace(/\.(mkv|mp4|avi|srt|ass|ssa|sub|vtt|m2ts|ts)$/i, '');

/** 4K và UHD là cùng một thứ với 2160p — gom về một tên để so được. */
function resolutionOf(text) {
  if (/\b(2160p?|4k|uhd)\b/i.test(text)) return '2160p';
  const m = /\b(1080[pi]|720p|576p|480p)\b/i.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Họ nguồn. Thứ tự xét có ý nghĩa: `cam` phải đứng trước vì một tên như
 * "HDTS" cũng chứa chuỗi khớp với nhánh khác.
 */
const FAMILIES = [
  [/\b(cam|camrip|hdcam|ts|telesync|hdts|tc|telecine|dvdscr|scr|screener|predvd|hqcam)\b/i, 'cam'],
  [/\b(web[\s._-]?dl|web[\s._-]?rip|webdl|webrip|web|amzn|nf|dsnp|hmax|hulu|atvp|pcok|stan)\b/i, 'web'],
  [/\b(blu[\s._-]?ray|bluray|bd[\s._-]?rip|br[\s._-]?rip|bd[\s._-]?remux|remux|bdmv)\b/i, 'disc'],
  [/\b(hdtv|pdtv|dsr|dvd[\s._-]?rip|dvdrip|dvd)\b/i, 'tv'],
];

function sourceOf(text) {
  for (const [re, name] of FAMILIES) if (re.test(text)) return name;
  return null;
}

/** Bản dựng khác nhau thì lệch tới hàng phút, không cứu được bằng chỉnh độ trễ. */
const EDITIONS = /\b(extended|unrated|directors?[\s._-]?cut|theatrical|remastered|imax|open[\s._-]?matte|final[\s._-]?cut|ultimate)\b/gi;

function editionsOf(text) {
  const found = String(text).match(EDITIONS) || [];
  return new Set(found.map((x) => x.toLowerCase().replace(/[\s._-]+/g, '')));
}

/** Nhóm phát hành: chữ sau dấu gạch cuối cùng, hoặc [trong ngoặc] kiểu anime. */
function groupOf(text) {
  const tail = /-([a-z0-9]{2,20})\s*$/i.exec(text.trim());
  if (tail) return tail[1].toLowerCase();
  const bracket = /^\[([^\]]{2,20})\]/.exec(text.trim());
  return bracket ? bracket[1].toLowerCase() : null;
}

/** Tách một tên bản phát hành thành những dấu hiệu đáng so. */
export function parseRelease(name) {
  const text = stripExt(name);
  return {
    resolution: resolutionOf(text),
    source: sourceOf(text),
    editions: editionsOf(text),
    group: groupOf(text),
    year: (/\b(19|20)\d{2}\b/.exec(text) || [null])[0],
  };
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Điểm của MỘT tên bản phụ đề so với bản phim đang xem.
 * Trả về `{ score, verdict }`; verdict để gắn dấu vào nhãn cho người xem thấy.
 */
function scoreOne(watched, candidateName) {
  const b = parseRelease(candidateName);
  let score = 0;
  let verdict = 'unknown';

  // 1. Cùng nhóm phát hành là dấu hiệu mạnh nhất, gần như đảm bảo cùng timing.
  if (watched.group && b.group && watched.group === b.group) {
    score += 60;
    verdict = 'group';
  }

  // 2. Độ phân giải. Khớp thì cộng nặng, lệch thì trừ — có trừ mới đẩy được
  //    bản 1080p xuống dưới bản 2160p khi đang xem 2160p. Chỉ cộng mà không
  //    trừ thì hai bản chỉ hơn kém nhau đúng phần cộng, chưa đủ để đảo thứ tự
  //    khi bản 1080p ăn điểm ở chỗ khác.
  if (watched.resolution && b.resolution) {
    if (watched.resolution === b.resolution) {
      score += 40;
      if (verdict === 'unknown') verdict = 'match';
    } else {
      score -= 15;
    }
  }

  // 3. Họ nguồn. Lệch giữa cam và retail là hỏng hẳn chứ không hỏng một ít —
  //    phạt đủ nặng để nó chìm xuống dưới, kể cả khi nó khai đúng độ phân giải
  //    đang xem. Đó chính là trường hợp TELESYNC gắn nhãn 1080p.
  if (watched.source && b.source) {
    if (watched.source === b.source) {
      score += 30;
      if (verdict === 'unknown') verdict = 'match';
    } else if (watched.source === 'cam' || b.source === 'cam') {
      score -= 80;
      verdict = 'mismatch';
    } else {
      // web so với bluray: thường lệch chút ở đoạn đầu, chỉnh độ trễ là xong.
      score -= 10;
    }
  } else if (b.source === 'cam' && !watched.source) {
    // Không biết đang xem bản gì. Không đoán bừa, chỉ đẩy nhẹ bản quay lén
    // xuống vì nó hiếm khi là thứ người ta muốn.
    score -= 15;
  }

  // 4. Bản dựng khác nhau. Phạt nặng ngang cam/retail, và phải nặng HƠN mức
  //    cộng cho cùng nhóm — nếu không thì bản EXTENDED cùng nhóm vẫn thắng bản
  //    chiếu rạp khác nhóm, trong khi nó mới là bản không bao giờ khớp được.
  //    Lệch nhóm thường chỉ lệch một khoảng cố định, chỉnh độ trễ là xong; lệch
  //    bản dựng thì thừa hẳn mấy phút phim ở giữa, càng xem càng trôi.
  if (!sameSet(watched.editions, b.editions)) {
    score -= 90;
    verdict = 'mismatch';
  }

  if (watched.year && b.year && watched.year === b.year) score += 5;

  return { score, verdict };
}

/**
 * Điểm cao nhất trong các tên bản mà một mục phụ đề công bố.
 *
 * SubSource trả `releaseInfo` là MẢNG: một mục phụ đề có thể khai nhiều bản
 * cùng lúc. Chấm theo bản khớp nhất chứ không theo cả cụm, nếu không một mục
 * khai mười bản sẽ bị loãng điểm và luôn thua mục chỉ khai một bản.
 */
export function releaseScore(watchedName, candidate) {
  const names = (Array.isArray(candidate) ? candidate : String(candidate || '').split(','))
    .map((x) => String(x).trim())
    .filter(Boolean);

  // Stremio không phải lúc nào cũng gửi kèm tên tệp. Không biết đang xem bản
  // nào thì không có cơ sở chấm — trả 0 để người gọi lùi về tiêu chí của họ
  // (lượt tải chẳng hạn) thay vì xếp hạng bằng số bịa ra.
  if (!watchedName || !names.length) return { score: 0, verdict: 'unknown' };

  const watched = parseRelease(watchedName);
  let best = { score: -Infinity, verdict: 'unknown' };
  for (const n of names) {
    const got = scoreOne(watched, n);
    if (got.score > best.score) best = got;
  }
  return best;
}

/**
 * Số phần/tập mà một tên bản phát hành tự khai, hoặc null nếu nó không khai.
 * Nhận cả "S02E07" lẫn "2x07".
 */
export function episodeOf(name) {
  const text = stripExt(name);

  const sxe = /\bs(\d{1,2})[\s._-]*e(\d{1,3})(?!\d)/i.exec(text);
  if (sxe) return { season: Number(sxe[1]), episode: Number(sxe[2]) };

  const nxn = /\b(\d{1,2})x(\d{1,3})(?!\d)/i.exec(text);
  if (nxn) return { season: Number(nxn[1]), episode: Number(nxn[2]) };

  return null;
}

/**
 * Mục phụ đề này có khai nhầm tập không?
 *
 * Đây là thứ bộ chấm điểm KHÔNG làm được và cũng không nên làm: điểm là thang
 * liên tục, nên một bản sai tập vẫn gỡ lại được bằng cách khớp độ phân giải và
 * nhóm phát hành rồi trèo lên đầu. Sai tập không phải là "kém khớp hơn" — nó
 * là phụ đề của phim khác. Phải loại hẳn chứ không trừ điểm.
 *
 * Chỉ loại khi mục đó CÓ khai số tập và không tên nào khớp. Không khai gì thì
 * giữ lại: kho trọn phần thường không ghi số tập trong tên bản, và tệp đúng
 * tập nằm bên trong kho.
 */
export function wrongEpisode(names, season, episode) {
  if (season == null || episode == null) return false;

  const tags = [].concat(names).map(episodeOf).filter(Boolean);
  if (!tags.length) return false;

  return !tags.some((t) => t.season === Number(season) && t.episode === Number(episode));
}

/** Dấu gắn trước nhãn, để nhìn danh sách là biết vì sao nó xếp thứ tự đó. */
export function verdictMark(verdict) {
  if (verdict === 'group' || verdict === 'match') return '✓ ';
  if (verdict === 'mismatch') return '⚠ ';
  return '';
}
