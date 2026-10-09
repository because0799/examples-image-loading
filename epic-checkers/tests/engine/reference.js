// Independent, deliberately naive reference move generator used for differential testing.
// Written separately from src/engine/rules.js: (row, col) arithmetic instead of precomputed rays,
// immutable board copies + Sets instead of mark/restore, rule logic re-derived from the variant
// description. Slow, but simple to audit.

const DIAG = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
const ORTHO = [
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, 0],
];

/**
 * @returns {Array<{from, to, path, captures, captured, piece, promotion, promotionAt}>}
 * Outcome-level list after priority filters; duplicates (same from/to/captured set/promotion)
 * are kept — callers group them.
 */
export function referenceMoves(v, board, turn) {
  const n = v.size;
  const dirs = v.geometry === 'orthogonal' ? ORTHO : DIAG;
  const fwd = turn === 1 ? -1 : 1;
  const lastRow = turn === 1 ? 0 : n - 1;
  const inside = (r, c) => r >= 0 && c >= 0 && r < n && c < n;
  const idx = (r, c) => r * n + c;
  const enemy = (code) => code !== 0 && Math.sign(code) === -turn;
  const own = (code) => code !== 0 && Math.sign(code) === turn;
  const isKing = (code) => Math.abs(code) === 2;

  const manMoveDir = ([dr, dc]) => {
    if (v.geometry === 'orthogonal') return dr === fwd || (dr === 0 && v.manSideways);
    return dr === fwd;
  };
  const manCapDir = (d) => (v.manBackCapture ? true : manMoveDir(d));

  // jumps available to a piece standing on (r, c)
  function jumps(b, taken, r, c, king, prevDir) {
    const res = [];
    for (const d of dirs) {
      const [dr, dc] = d;
      if (v.noReverse && prevDir && dr === -prevDir[0] && dc === -prevDir[1]) continue;
      if (!king && !manCapDir(d)) continue;
      if (king && v.flyingKings) {
        let rr = r + dr;
        let cc = c + dc;
        while (inside(rr, cc) && b[idx(rr, cc)] === 0) {
          rr += dr;
          cc += dc;
        }
        if (!inside(rr, cc)) continue;
        const x = idx(rr, cc);
        if (!enemy(b[x]) || taken.has(x)) continue;
        const lands = [];
        let r2 = rr + dr;
        let c2 = cc + dc;
        while (inside(r2, c2) && b[idx(r2, c2)] === 0) {
          lands.push([r2, c2]);
          r2 += dr;
          c2 += dc;
        }
        if (lands.length) res.push({ d, x, lands });
      } else {
        const r1 = r + dr;
        const c1 = c + dc;
        const r2 = r + 2 * dr;
        const c2 = c + 2 * dc;
        if (!inside(r2, c2)) continue;
        const x = idx(r1, c1);
        if (!enemy(b[x]) || taken.has(x)) continue;
        if (!king && !v.menCaptureKings && isKing(b[x])) continue;
        if (b[idx(r2, c2)] !== 0) continue;
        res.push({ d, x, lands: [[r2, c2]] });
      }
    }
    return res;
  }

  const seqs = [];

  function walk(b, taken, r, c, king, prevDir, path, caps, codes, promoAt, piece, js) {
    for (const j of js) {
      const code = b[j.x];
      let nb = b;
      let nt = taken;
      if (v.removal === 'immediate') {
        nb = b.slice();
        nb[j.x] = 0;
      } else {
        nt = new Set(taken);
        nt.add(j.x);
      }
      const cand = j.lands.map(([lr, lc]) => {
        let nk = king;
        let np = promoAt;
        let stop = false;
        if (!king && lr === lastRow) {
          if (v.midPromotion === 'king') {
            nk = true;
            np = path.length;
          } else if (v.midPromotion === 'stop') {
            stop = true;
          }
        }
        const next = stop ? [] : jumps(nb, nt, lr, lc, nk, j.d);
        return { lr, lc, nk, np, next };
      });
      const mustContinue = cand.some((x) => x.next.length > 0);
      for (const o of cand) {
        if (mustContinue && o.next.length === 0) continue;
        const npath = [...path, idx(o.lr, o.lc)];
        const ncaps = [...caps, j.x];
        const ncodes = [...codes, code];
        if (o.next.length === 0) {
          seqs.push(finish(npath, ncaps, ncodes, piece, o.np));
        } else {
          walk(nb, nt, o.lr, o.lc, o.nk, j.d, npath, ncaps, ncodes, o.np, piece, o.next);
        }
      }
    }
  }

  function finish(path, caps, codes, piece, promoAt) {
    const to = path[path.length - 1];
    let promotion = false;
    let promotionAt = -1;
    if (!isKing(piece)) {
      if (v.midPromotion === 'king') {
        if (promoAt >= 0) {
          promotion = true;
          promotionAt = promoAt;
        }
      } else if (Math.floor(to / n) === lastRow) {
        promotion = true;
        promotionAt = path.length - 1;
      }
    }
    return { from: path[0], to, path, captures: caps, captured: codes, piece, promotion, promotionAt };
  }

  for (let s = 0; s < n * n; s++) {
    if (!own(board[s])) continue;
    const piece = board[s];
    const b = board.slice();
    b[s] = 0;
    const r = Math.floor(s / n);
    const c = s % n;
    const js = jumps(b, new Set(), r, c, isKing(piece), null);
    if (js.length) walk(b, new Set(), r, c, isKing(piece), null, [s], [], [], -1, piece, js);
  }

  if (seqs.length) return applyPriority(v, seqs);

  const quiet = [];
  for (let s = 0; s < n * n; s++) {
    if (!own(board[s])) continue;
    const piece = board[s];
    const r = Math.floor(s / n);
    const c = s % n;
    for (const d of dirs) {
      if (!isKing(piece) && !manMoveDir(d)) continue;
      let rr = r + d[0];
      let cc = c + d[1];
      while (inside(rr, cc) && board[idx(rr, cc)] === 0) {
        const promo = !isKing(piece) && rr === lastRow;
        quiet.push({
          from: s,
          to: idx(rr, cc),
          path: [s, idx(rr, cc)],
          captures: [],
          captured: [],
          piece,
          promotion: promo,
          promotionAt: promo ? 1 : -1,
        });
        if (!isKing(piece) || !v.flyingKings) break;
        rr += d[0];
        cc += d[1];
      }
    }
  }
  return quiet;
}

function applyPriority(v, seqs) {
  const kingsOf = (m) => m.captured.filter((x) => Math.abs(x) === 2).length;
  const keepBest = (list, f) => {
    const best = Math.max(...list.map(f));
    return list.filter((m) => f(m) === best);
  };
  let list = seqs;
  if (v.capture === 'max' || v.capture === 'max-kings' || v.capture === 'italian') {
    list = keepBest(list, (m) => m.captures.length);
  }
  if (v.capture === 'max-kings') list = keepBest(list, kingsOf);
  if (v.capture === 'italian') {
    if (list.some((m) => Math.abs(m.piece) === 2)) list = list.filter((m) => Math.abs(m.piece) === 2);
    list = keepBest(list, kingsOf);
    // earliest king(s): compare the king index vectors lexicographically
    const vec = (m) => m.captured.map((x, i) => (Math.abs(x) === 2 ? i : -1)).filter((i) => i >= 0);
    const cmp = (a, b) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
      return 0;
    };
    let best = null;
    for (const m of list) if (best === null || cmp(vec(m), best) < 0) best = vec(m);
    list = list.filter((m) => cmp(vec(m), best) === 0);
  }
  if (v.capture === 'king-first' && list.some((m) => Math.abs(m.piece) === 2)) {
    list = list.filter((m) => Math.abs(m.piece) === 2);
  }
  return list;
}

/** Outcome key used to compare engine and reference move sets. */
export function outcomeKey(m) {
  const caps = [...m.captures].sort((a, b) => a - b).join(',');
  return `${m.from}>${m.to}>${m.promotion ? 1 : 0}>${caps}`;
}
