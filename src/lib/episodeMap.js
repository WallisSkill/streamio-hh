/**
 * Decide which episode on the source corresponds to the episode the user
 * clicked in Stremio's official listing.
 *
 * Two numbering conventions show up on VN sites:
 *   season-relative : the entry covers ONE season and counts 1..N inside it
 *   absolute        : one entry covers the whole show and counts 1..Total
 *
 * We pick a mode explicitly and report it, so a wrong guess is visible
 * to the user in the stream label instead of silently playing episode 12
 * when they asked for season 3 episode 12.
 */
export function decideMapping({ entry, season, episode, index }) {
  const seasonCount = index?.seasonCounts?.[season] ?? null;
  const totalAbsolute = index?.totalAbsolute ?? null;
  const absolute = index?.absolute?.(season, episode) ?? null;
  const maxEp = entry.maxEpisode || 0;

  // 0) An entry holding roughly the whole show is absolute-numbered, even when
  //    it declares a season. KKPhim tags One Piece as season 1 while carrying
  //    all ~1174 episodes; trusting that tag would play episode 1 for S21E1.
  const looksFullSeries =
    totalAbsolute > 0 && maxEp >= totalAbsolute * 0.8 && totalAbsolute > (seasonCount ?? 0);
  if (looksFullSeries && absolute) {
    return {
      mode: 'absolute',
      target: absolute,
      confidence: maxEp >= absolute ? 'high' : 'low',
      note: `Nguồn gộp toàn bộ ${maxEp} tập — S${season}E${episode} = tập ${absolute}`,
    };
  }

  // 1) The entry declares the season it covers (from tmdb.season or "Phần N"
  //    in the title) and it matches -> numbering is season-relative.
  if (entry.season != null && Number(entry.season) === Number(season)) {
    return {
      mode: 'season-entry',
      target: episode,
      confidence: 'high',
      note: `Nguồn là phần ${entry.season}, đánh số theo tập trong phần`,
    };
  }

  // 2) Single-season show, or season 1 -> relative and absolute coincide.
  if (season === 1 && (totalAbsolute === null || seasonCount === totalAbsolute)) {
    return { mode: 'season-relative', target: episode, confidence: 'high', note: 'Phim 1 phần' };
  }

  // 3) Entry carries no season marker. Use its episode count to tell which
  //    convention it follows.
  if (entry.season == null && absolute && totalAbsolute) {
    const looksAbsolute = maxEp > (seasonCount ?? 0) && maxEp >= Math.min(absolute, totalAbsolute * 0.6);
    if (looksAbsolute) {
      return {
        mode: 'absolute',
        target: absolute,
        confidence: maxEp >= absolute ? 'high' : 'low',
        note: `Đánh số tuyệt đối: S${season}E${episode} = tập ${absolute}`,
      };
    }
  }

  // 4) Entry declares a DIFFERENT season than requested -> it is the wrong
  //    entry; caller should skip it rather than serve a mismatched episode.
  if (entry.season != null && Number(entry.season) !== Number(season)) {
    return {
      mode: 'reject',
      target: null,
      confidence: 'none',
      note: `Nguồn là phần ${entry.season}, không phải phần ${season}`,
    };
  }

  // 5) Fall back to season-relative, flagged low so the label warns the user.
  return {
    mode: 'season-relative',
    target: episode,
    confidence: 'low',
    note: 'Không xác định chắc cách đánh số',
  };
}

/** Pick the concrete episode object, retrying with the alternate convention. */
export function resolveEpisode({ entry, server, season, episode, index }) {
  const decision = decideMapping({ entry, season, episode, index });
  if (decision.mode === 'reject') return { decision, episode: null };

  const pool = server.episodes.filter((e) => !e.isSpecial);
  const pick = (n) => pool.find((e) => e.num === n) || null;

  let found = decision.target != null ? pick(decision.target) : null;

  // Single-file entries ("Full") answer any episode request for a movie.
  if (!found && pool.length === 1 && pool[0].isFull) found = pool[0];

  if (!found) {
    const absolute = index?.absolute?.(season, episode) ?? null;
    const alt = decision.mode === 'absolute' ? episode : absolute;
    if (alt != null && alt !== decision.target) {
      const altFound = pick(alt);
      if (altFound) {
        return {
          decision: {
            ...decision,
            mode: decision.mode === 'absolute' ? 'season-relative' : 'absolute',
            target: alt,
            confidence: 'low',
            note: `${decision.note} — đã đổi sang tập ${alt}`,
          },
          episode: altFound,
        };
      }
    }
  }

  return { decision, episode: found };
}
