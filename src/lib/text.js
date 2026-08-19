/** Strip Vietnamese diacritics + đ, lowercase, drop punctuation, collapse spaces. */
export function normalize(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0111]/g, 'd')
    .replace(/[\u0110]/g, 'D')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/**
 * Detect which season a source listing covers, from its title.
 * VN sites name seasons inline: "Đấu Phá Thương Khung (Phần 5)", "Season 5", "Mùa 2", "Part 3".
 * Returns null when the title carries no season marker (single/absolute listing).
 */
export function detectSeason(...titles) {
  for (const title of titles) {
    const n = normalize(title);
    if (!n) continue;
    let m =
      /(?:phan|season|mua|part|quyen)\s+(\d{1,2})\b/.exec(n) ||
      /\bs(?:eason)?\s?(\d{1,2})\b/.exec(n);
    if (m) return Number(m[1]);
    // trailing roman numeral: "Tru Tien II"
    m = /\b(ii|iii|iv|vi{0,3}|ix|x)$/.exec(n);
    if (m && ROMAN[m[1]]) return ROMAN[m[1]];
    // trailing bare number that is not part of the name, e.g. "Doraemon 2"
    m = /\s(\d{1,2})$/.exec(n);
    if (m) {
      const v = Number(m[1]);
      if (v >= 2 && v <= 12) return v;
    }
  }
  return null;
}

/** Remove season markers so two seasons of one show normalize to the same base name. */
export function baseTitle(title) {
  return normalize(title)
    .replace(/\((?:phan|season|mua|part)\s*\d{1,2}\)/g, ' ')
    .replace(/\b(?:phan|season|mua|part|quyen)\s+\d{1,2}\b/g, ' ')
    .replace(/\bs\d{1,2}\b/g, ' ')
    .replace(/\b(ii|iii|iv|vi{0,3}|ix|x)$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse an episode number out of a source label.
 * Handles "Tập 01", "Tap 12", "12", "Episode 5", "12-13" (takes first), "Full".
 * Returns { num, isFull, isSpecial }.
 */
export function parseEpisodeLabel(label) {
  const n = normalize(label);
  if (!n) return { num: null, isFull: false, isSpecial: false };
  if (/\b(full|tron bo|fullhd)\b/.test(n) && !/\d/.test(n)) {
    return { num: null, isFull: true, isSpecial: false };
  }
  const isSpecial = /\b(pd|ova|oav|sp|special|ngoai truyen|preview|trailer|tap dac biet)\b/.test(n);
  const m = /(?:tap|episode|ep|e)?\s*0*(\d{1,4})/.exec(n);
  return { num: m ? Number(m[1]) : null, isFull: false, isSpecial };
}

/** Token-overlap similarity in [0,1], order-insensitive. */
export function similarity(a, b) {
  const ta = new Set(normalize(a).split(' ').filter(Boolean));
  const tb = new Set(normalize(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

export function decodeEntities(str = '') {
  return str
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}
