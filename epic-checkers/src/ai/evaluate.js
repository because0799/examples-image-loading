// Static evaluation for every variant family (score from the side to move's point of view,
// 100 = one man). Terms: material (king value depends on flying vs short kings, board size and
// Turkish kings), advancement / tempo (middlegame and endgame tables blended by phase), centre
// control, back-rank guard, defensive support of men, king centralisation / main diagonal /
// mobility, Turkish orthogonal structure, a trade-down bonus for the side ahead, drawish-endgame
// scaling — and an inverted evaluation for GIVEAWAY (поддавки), where losing pieces is the goal.

import { getTables } from './board.js';

const cache = new Map();

// Set by evalNormal when it returned the exact score of a dead-drawn ending (no jitter then).
let drawishExact = false;

/** Per-variant evaluation tables (cached). */
export function getEvalTables(variantId) {
  const t = getTables(variantId);
  let e = cache.get(t.id);
  if (!e) {
    e = buildEval(t);
    cache.set(t.id, e);
  }
  return e;
}

function buildEval(t) {
  const n = t.n;
  const count = t.count;
  const v = t.v;
  const ortho = t.ortho;
  const flying = t.flying;

  let kingValue;
  if (ortho) kingValue = 330;
  else if (!flying) kingValue = 150;
  else if (n >= 10) kingValue = 320;
  else kingValue = v.manBackCapture ? 270 : 300;
  // a man on the last rank before promotion must stay clearly below a king, so promoting pays
  const egMax = Math.min(42, Math.round((kingValue - 100) * 0.5));
  const mgMax = Math.min(16, Math.round((kingValue - 100) * 0.3));

  // Man tables from WHITE's point of view (rank 0 = own back row); black uses the mirrored rank.
  const manMgW = new Int16Array(count);
  const manEgW = new Int16Array(count);
  const manMgB = new Int16Array(count);
  const manEgB = new Int16Array(count);
  const kingW = new Int16Array(count);
  const kingB = new Int16Array(count);

  const top = n - 2; // last rank a man can stand on (n-1 is the promotion row)
  const centre = (n - 1) / 2;
  const backGuard = ortho ? 0 : !flying ? 9 : n === 8 ? 7 : 5;

  for (let sq = 0; sq < count; sq++) {
    if (!t.playable[sq]) continue;
    const r = t.row[sq];
    const c = t.col[sq];
    const dc = Math.abs(c - centre); // 0.5 .. centre
    const dr = Math.abs(r - centre);
    const colCentre = Math.max(0, centre - dc); // 0 at the edge … ~n/2 in the middle

    for (const color of [1, -1]) {
      const rank = color === 1 ? n - 1 - r : r; // 0 = own back row
      let mg = 0;
      let eg = 0;
      if (rank <= top) {
        const f = rank / top;
        if (ortho) {
          // Turkish men start on ranks 1-2; promotion makes a monster flying king → pushing pays.
          mg = Math.round(3 * rank + (rank >= n - 3 ? (rank - (n - 4)) * 9 : 0));
          eg = Math.round(7 * rank + (rank >= n - 3 ? (rank - (n - 4)) * 16 : 0));
          mg += Math.round(colCentre * 1.2);
        } else {
          mg = Math.round(mgMax * f * f + (rank === 0 ? backGuard : 0));
          eg = Math.round(egMax * Math.pow(f, 1.4));
          // centre files are stronger in the middlegame; edges are passive
          mg += Math.round(colCentre * (n === 8 ? 1.6 : 1.1));
          if (c === 0 || c === n - 1) mg -= 2;
        }
      }
      if (color === 1) {
        manMgW[sq] = mg;
        manEgW[sq] = eg;
      } else {
        manMgB[sq] = mg;
        manEgB[sq] = eg;
      }
    }

    // Kings: centralisation, main diagonal for flying diagonal kings, edges bad for short kings.
    const dist = Math.max(dc, dr); // Chebyshev distance from the centre
    let k;
    if (ortho) {
      k = Math.round(6 - dist * 1.2);
    } else if (flying) {
      k = Math.round(4 - dist * 0.8);
      if (t.mainDiag[sq]) k += 10;
      // the "double" diagonals (g1–a7 / h2–b8, perpendicular to the main road) are strong too
      if (n === 8) {
        const dbl = t.v.darkParity === 1 ? Math.abs(r - c) : Math.abs(r + c - (n - 1));
        if (dbl === 1) k += 4;
      }
    } else {
      k = Math.round(8 - dist * 2.4);
      if (c === 0 || c === n - 1 || r === 0 || r === n - 1) k -= 3;
    }
    kingW[sq] = k;
    kingB[sq] = k;
  }

  return {
    t,
    manValue: 100,
    kingValue,
    giveawayKing: 160,
    manMgW,
    manEgW,
    manMgB,
    manEgB,
    kingW,
    kingB,
    mobilityWeight: ortho ? 2 : flying ? (n === 8 ? 2 : 1) : 3,
    supportBonus: ortho ? 3 : 2,
    sideBonus: ortho ? 2 : 0,
    tradeK: 0.35,
  };
}

/** King mobility: free squares along the rays (flying) or adjacent free squares (short kings). */
function kingMobility(t, board, sq) {
  const rays = t.rays;
  let m = 0;
  for (let d = 0; d < 4; d++) {
    const ri = sq * 4 + d;
    const off = t.rayOff[ri];
    const len = t.rayLen[ri];
    if (!t.flying) {
      if (len > 0 && board[rays[off]] === 0) m++;
      continue;
    }
    for (let j = 0; j < len; j++) {
      if (board[rays[off + j]] !== 0) break;
      m++;
    }
  }
  return m;
}

/**
 * Evaluate the position of a SearchBoard from the side to move's point of view.
 * `jitter` (>= 0) adds deterministic per-position noise (seeded) for variety at lower levels.
 */
export function evaluate(b, e, jitter = 0, seed = 0) {
  const t = e.t;
  const board = b.board;
  const wm = b.wm;
  const wk = b.wk;
  const bm = b.bm;
  const bk = b.bk;
  let score;
  drawishExact = false;
  if (b.giveaway) score = evalGiveaway(b, e);
  else score = evalNormal(b, e, t, board, wm, wk, bm, bk);
  if (jitter > 0 && !drawishExact) {
    const h = Math.imul(b.hashLo ^ seed, 0x9e3779b1) ^ Math.imul(b.hashHi, 0x85ebca6b);
    score += ((h >>> 0) % (2 * jitter + 1)) - jitter;
  }
  return b.turn === 1 ? score : -score;
}

function evalNormal(b, e, t, board, wm, wk, bm, bk) {
  const sqs = t.sqs;
  const rays = t.rays;
  const n = t.n;
  const ortho = t.ortho;
  let mg = 0;
  let eg = 0;
  let pos = 0;
  let structure = 0;
  const mobW = e.mobilityWeight;

  for (let i = 0; i < sqs.length; i++) {
    const sq = sqs[i];
    const code = board[sq];
    if (code === 0) continue;
    if (code === 1) {
      mg += e.manMgW[sq];
      eg += e.manEgW[sq];
      structure += manSupport(t, board, sq, 1, ortho, e, rays, n);
    } else if (code === -1) {
      mg -= e.manMgB[sq];
      eg -= e.manEgB[sq];
      structure -= manSupport(t, board, sq, -1, ortho, e, rays, n);
    } else if (code === 2) {
      pos += e.kingW[sq] + mobW * kingMobility(t, board, sq);
    } else {
      pos -= e.kingB[sq] + mobW * kingMobility(t, board, sq);
    }
  }

  const total = wm + wk + bm + bk;
  let phase = total / t.initialPieces; // 1 = opening, → 0 endgame
  if (phase > 1) phase = 1;
  const matW = wm * e.manValue + wk * e.kingValue;
  const matB = bm * e.manValue + bk * e.kingValue;
  const diff = matW - matB;
  let score = diff + Math.round(mg * phase + eg * (1 - phase)) + pos + Math.round(structure * phase);
  // the side ahead in material likes trades
  score += Math.round(diff * e.tradeK * (1 - phase));

  // drawish endings
  if (score !== 0) {
    const strongW = score > 0;
    const sp = strongW ? wm + wk : bm + bk;
    const sk = strongW ? wk : bk;
    const wp = strongW ? bm + bk : wm + wk;
    const wkk = strongW ? bk : wk;
    let div = 1;
    if (wkk >= 1) {
      // Two pieces (or one) against a lone king cannot win with flying kings (and they are a draw by
      // rule soon anyway: FMJD 5 moves, Russian balance rule), nor in Turkish (one piece each is an
      // immediate draw; 2 kings vs 1 is practically drawn). Score it as the draw it is, plus the
      // same small material tie-break as a draw in the search, so that from 3 pieces vs 1 the AI
      // never "cashes in" a king for an illusory plus (RTR-03).
      if (wp === 1 && sp <= 2 && (t.flying || ortho)) {
        const tie = 2 * (sp - wp);
        drawishExact = true; // an exact draw score: the level's evaluation jitter must not tip it
        return strongW ? tie : -tie;
      }
      if (t.flying && !ortho) {
        if (wp === 1) {
          if (sp === 3) {
            if (n >= 10) div = 8;
            else if (t.mainDiag[loneKing(board, strongW ? -2 : 2)]) div = 8;
          } else if (sp === 4 && n >= 10 && t.mainDiag[loneKing(board, strongW ? -2 : 2)]) div = 4;
        } else if (wp === 2 && sp <= 3 && sk >= 1) div = 4;
        else if (sk >= 1 && sp - wp <= 1 && Math.abs(diff) < e.kingValue) div = 2;
      } else if (!t.flying) {
        if (wp === 1 && sp === 1) div = 16;
        else if (sp - wp <= 0 && sk <= wkk) div = 2;
      }
    }
    if (div > 1) score = Math.round(score / div);
  }
  return score;
}

function loneKing(board, code) {
  for (let i = 0; i < board.length; i++) if (board[i] === code) return i;
  return 0;
}

/**
 * Defensive structure of a man: on diagonal boards, a man whose back diagonals are covered (own
 * piece or board edge) cannot be jumped from the front. On the Turkish board: covered from
 * behind (vertical) and on both sides (horizontal).
 */
function manSupport(t, board, sq, color, ortho, e, rays, n) {
  let s = 0;
  if (ortho) {
    // behind = direction 3 (down) for white, 0 (up) for black; sides = 1 and 2
    const back = sq * 4 + (color > 0 ? 3 : 0);
    if (t.rayLen[back] === 0 || board[rays[t.rayOff[back]]] * color > 0) s += e.supportBonus;
    const l = sq * 4 + 1;
    const r = sq * 4 + 2;
    const lc = t.rayLen[l] === 0 || board[rays[t.rayOff[l]]] * color > 0;
    const rc = t.rayLen[r] === 0 || board[rays[t.rayOff[r]]] * color > 0;
    if (lc && rc) s += e.sideBonus;
  } else {
    const d1 = sq * 4 + (color > 0 ? 2 : 0);
    const d2 = sq * 4 + (color > 0 ? 3 : 1);
    if (t.rayLen[d1] === 0 || board[rays[t.rayOff[d1]]] * color > 0) s += e.supportBonus;
    if (t.rayLen[d2] === 0 || board[rays[t.rayOff[d2]]] * color > 0) s += e.supportBonus;
  }
  return s;
}

/**
 * Giveaway (поддавки): the side that runs out of pieces or moves wins. Own material is a
 * liability (kings even more so — they are hard to get rid of); advanced men are slightly bad
 * (they turn into kings). White's point of view.
 */
function evalGiveaway(b, e) {
  const t = e.t;
  const board = b.board;
  const n = t.n;
  let score = (b.bm - b.wm) * e.manValue + (b.bk - b.wk) * e.giveawayKing;
  const sqs = t.sqs;
  let adv = 0;
  for (let i = 0; i < sqs.length; i++) {
    const sq = sqs[i];
    const c = board[sq];
    if (c === 1) adv -= n - 1 - t.row[sq];
    else if (c === -1) adv += t.row[sq];
  }
  score += adv;
  return score;
}
