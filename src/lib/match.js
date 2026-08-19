import { baseTitle, similarity, normalize } from './text.js';

/** KKPhim `type` -> stremio type. `single` is a standalone film, everything else is episodic. */
export function typeGroup(candidate) {
  return candidate.type === 'single' ? 'movie' : 'series';
}

/**
 * Score a source candidate against the official Stremio title.
 * ID matches dominate; titles are a fallback because VN sites often carry a
 * completely different translated title than IMDb/TMDB.
 */
export function scoreCandidate(candidate, target) {
  const reasons = [];
  let score = 0;

  if (target.imdbId && candidate.imdbId && candidate.imdbId === target.imdbId) {
    score += 100;
    reasons.push('imdb-exact');
  }
  if (target.tmdbId && candidate.tmdbId && String(candidate.tmdbId) === String(target.tmdbId)) {
    score += 90;
    reasons.push('tmdb-exact');
  }

  const candTitles = [candidate.name, candidate.originName, ...(candidate.altNames || [])].filter(Boolean);
  const targetTitles = target.titles.filter(Boolean);

  let exactBase = false;
  let best = 0;
  for (const ct of candTitles) {
    for (const tt of targetTitles) {
      if (baseTitle(ct) && baseTitle(ct) === baseTitle(tt)) exactBase = true;
      best = Math.max(best, similarity(baseTitle(ct), baseTitle(tt)));
    }
  }
  if (exactBase) {
    score += 60;
    reasons.push('title-exact');
  }
  if (best > 0) {
    score += Math.round(best * 40);
    if (!exactBase) reasons.push(`title-sim:${best.toFixed(2)}`);
  }

  if (target.year && candidate.year) {
    const diff = Math.abs(Number(target.year) - Number(candidate.year));
    if (diff <= 1) {
      score += 10;
      reasons.push('year-close');
    } else if (diff <= 3) {
      score += 4;
    } else if (diff > 6) {
      score -= 10;
      reasons.push('year-far');
    }
  }

  return { score, reasons, exactId: reasons.some((r) => r.endsWith('-exact') && r !== 'title-exact') };
}

/**
 * Keep only candidates that plausibly belong to the requested show AND
 * the requested kind (series vs standalone film).
 */
export function filterCandidates(candidates, target, wantType) {
  return candidates
    .filter((c) => typeGroup(c) === wantType)
    .map((c) => ({ candidate: c, ...scoreCandidate(c, target) }))
    .filter((r) => r.exactId || r.score >= 45)
    .sort((a, b) => b.score - a.score);
}

export { baseTitle, normalize };
