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
 *
 * `firm` nói CÁCH ĐÁNH SỐ đã chắc chưa, tách khỏi `confidence` nói kết quả có
 * đáng tin không. Trộn hai thứ đó là nguồn gốc của một lỗi thật: S5E36 của Thôn
 * Phệ Tinh Không ra tập tuyệt đối 244, nguồn mới có 243 tập, nên code tưởng mình
 * đoán nhầm cách đánh số và đổi sang "tập 36" — trong khi sự thật chỉ là tập đó
 * CHƯA RA. Cách đánh số đã chắc thì không thấy tập là không có tập, không đổi
 * sang cách khác.
 */
export function decideMapping({ entry, season, episode, index }) {
  const seasonCount = index?.seasonCounts?.[season] ?? null;
  const totalAbsolute = index?.totalAbsolute ?? null;
  const absolute = index?.absolute?.(season, episode) ?? null;
  const maxEp = entry.maxEpisode || 0;

  // -1) Phần 0 của Stremio là tập đặc biệt (OVA, movie, ngoại truyện). Nguồn VN
  //     không đánh số chúng cùng dãy với phim chính, nên ép S0E1 vào danh sách
  //     tập thường là sai chắc chắn — đã thấy: Tiên Nghịch S0E1 "The Battle of
  //     the Gods" ra tập 1 của phim chính. Chỉ mục phim lẻ mới phục vụ được.
  if (Number(season) === 0) {
    return {
      mode: 'special',
      target: null,
      confidence: 'none',
      firm: true,
      note: 'Tập đặc biệt — chỉ nhận mục phim lẻ',
    };
  }

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
      firm: true,
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
      firm: true,
      note: `Nguồn là phần ${entry.season}, đánh số theo tập trong phần`,
    };
  }

  // 2) Single-season show, or season 1 -> relative and absolute coincide.
  if (season === 1 && (totalAbsolute === null || seasonCount === totalAbsolute)) {
    return { mode: 'season-relative', target: episode, confidence: 'high', firm: true, note: 'Phim 1 phần' };
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
        firm: true,
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
      firm: true,
      note: `Nguồn là phần ${entry.season}, không phải phần ${season}`,
    };
  }

  // 5) Chưa biết nguồn đánh số kiểu gì. Đây là chỗ DUY NHẤT được phép thử cách
  //    kia khi tìm không thấy.
  return {
    mode: 'season-relative',
    target: episode,
    confidence: 'low',
    firm: false,
    guess: true,
    note: 'Không xác định chắc cách đánh số',
  };
}

/** Pick the concrete episode object, retrying with the alternate convention. */
export function resolveEpisode({ entry, server, season, episode, index }) {
  const decision = decideMapping({ entry, season, episode, index });
  if (decision.mode === 'reject') return { decision, episode: null };

  const pool = server.episodes.filter((e) => !e.isSpecial);
  const pick = (n) => pool.find((e) => e.num === n) || null;
  // Mục chỉ có một file ("Full") — tức là một phim lẻ, không phải bộ.
  const single = pool.length === 1 && pool[0].isFull ? pool[0] : null;

  // Tập đặc biệt: chỉ mục phim lẻ mới đúng. Mục là cả bộ thì bỏ, đừng gán bừa.
  if (decision.mode === 'special') {
    if (!single) return { decision, episode: null };
    return {
      decision: { ...decision, confidence: 'high', note: 'Phim lẻ — khớp tập đặc biệt' },
      episode: single,
    };
  }

  let found = decision.target != null ? pick(decision.target) : null;

  // Đoán "tập trong phần" chỉ an toàn ở phần 1, nơi số tương đối trùng số tuyệt
  // đối. Từ phần 2 trở đi nó là tung đồng xu, và tệ hơn: đoán ra kết quả thì
  // addon dừng ở mục này luôn, không rơi xuống mục khác trong danh sách rút gọn.
  // Đã thấy: Thôn Phệ Tinh Không S5E1 bắt trúng mục 26 tập rồi trả "Tập 1",
  // trong khi mục gộp 217 tập ngay sau đó trả đúng tập 209.
  if (found && decision.guess && Number(season) > 1) found = null;

  // Một mục phim lẻ chỉ trả lời đúng cho tập 1; hỏi tập 36 mà đưa phim lẻ ra là
  // đưa nhầm phim.
  if (!found && single && Number(episode) === 1) found = single;

  // Chỉ đổi cách đánh số khi CHƯA chắc nguồn đánh số kiểu gì. Chắc rồi mà không
  // thấy tập thì là tập chưa ra — trả về rỗng, để người xem khỏi bấm nhầm tập.
  if (!found && !decision.firm) {
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
