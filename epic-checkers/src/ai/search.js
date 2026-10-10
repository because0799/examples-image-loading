// AI search (pure; runs in Node, a Web Worker or the main thread).
//
//   search(state, { level = 3, timeMs, maxDepth, maxNodes, historyHashes = [], seed, newGame, allScores })
//     -> { path, score, depth, selDepth, nodes, timeMs, nps, level, mate, pv, forced, scores? }
//   score: side to move's view, 100 = one man; ±(1000000 - plies) = forced win/loss (mate = plies).
//   allScores: score every root move exactly (slower) → scores: [{ path, score }] best first.
//   searchAsync(state, opts, { sliceMs, signal }) → Promise: the same search in time slices
//   that yield to the event loop (main-thread fallback when no Web Worker is available).
//
// Negamax alpha-beta (PVS) with iterative deepening and a hard time limit (checked every 1024
// nodes), a two-slot transposition table keyed by an incremental 64-bit Zobrist hash, move
// ordering (TT move, captures by size / kings taken, promotions, two killers per ply, history
// heuristic), late-move reductions, forced-reply extensions, a capture quiescence (captures are
// mandatory, so there is no stand-pat while one is available) with a threat extension when the
// opponent has a capture pending at the horizon, draw awareness (repetition along the search
// path and against the game history, the variant's move-limit and endgame draw rules) and mate
// scores by distance. Giveaway (поддавки) inverts terminal results and evaluation.
//
// Draw scores. A draw is not simply 0:
//  - contempt: while plenty of material is on the board (≥ 1/3 of the start), the side that runs
//    the search (the root side) scores a draw as slightly bad for itself (LEVEL_PARAMS.contempt,
//    0.2 man). Two equal engines (AI-vs-AI demo) therefore avoid early threefold repetitions
//    instead of shuffling into them (RTR-01). The contempt is off in endgames — there a draw by
//    rule is often the honest result and must not be "avoided" by giving material away — and in
//    giveaway. Because the contempt depends on the root side, the transposition table key is
//    salted per contempt mode (none / white root / black root), so the two sides of a demo game,
//    or the player's hints, never reuse each other's draw-biased scores.
//  - material tie-break: a draw (repetition or by rule) scores 2 × (own pieces − opponent's
//    pieces), so among draws the AI keeps its material instead of hanging a king (RTR-03).
//
// The root always works on the engine's legalMoves(state), so the returned path is legal by
// construction; the internal generator (board.js) is only used below the root.

import { legalMoves, getVariant, squareName } from '../engine/index.js';
import { SearchBoard, MAX_PLY } from './board.js';
import { evaluate, getEvalTables } from './evaluate.js';
import { LEVEL_PARAMS, clampLevel } from './levels.js';

export const MATE = 1000000;
export const MATE_BOUND = MATE - 10000;
const INF = 1000000000;

const EXACT = 1;
const LOWER = 2;
const UPPER = 3;

// ordering scores
const ORD_TT = 1 << 30;
const ORD_CAPTURE = 1 << 24;
const ORD_PROMO = 3000000;
const ORD_KILLER1 = 2000000;
const ORD_KILLER2 = 1900000;
const HISTORY_MAX = 1000000;

const now =
  typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

// ---------------------------------------------------------------------------------------------
// Transposition table: buckets of two slots (0 = depth-preferred, 1 = always replace).
// ---------------------------------------------------------------------------------------------

class TranspositionTable {
  constructor(bits) {
    this.bits = bits;
    const size = 1 << bits;
    this.size = size;
    this.mask = (size - 1) & ~1;
    this.lock = new Int32Array(size);
    this.score = new Int32Array(size);
    this.move = new Int16Array(size);
    this.depth = new Int8Array(size);
    this.flag = new Uint8Array(size);
    this.age = new Uint8Array(size);
    this.gen = 1;
  }

  clear() {
    this.flag.fill(0);
    this.gen = 1;
  }

  newSearch() {
    this.gen = (this.gen % 250) + 1;
  }

  probe(lo, hi) {
    const i = lo & this.mask;
    if (this.flag[i] !== 0 && this.lock[i] === hi) return i;
    const j = i + 1;
    if (this.flag[j] !== 0 && this.lock[j] === hi) return j;
    return -1;
  }

  store(lo, hi, depth, flag, score, move) {
    const i = lo & this.mask;
    let slot;
    if (this.flag[i] === 0 || this.lock[i] === hi) {
      // same position or empty: keep a deeper entry of this search unless the new one is exact
      if (this.flag[i] !== 0 && this.age[i] === this.gen && this.depth[i] > depth && flag !== EXACT) slot = i + 1;
      else slot = i;
    } else if (this.age[i] !== this.gen || depth >= this.depth[i]) {
      slot = i;
    } else {
      slot = i + 1;
    }
    this.lock[slot] = hi;
    this.score[slot] = score;
    this.move[slot] = move > 32767 ? -1 : move;
    this.depth[slot] = depth > 127 ? 127 : depth;
    this.flag[slot] = flag;
    this.age[slot] = this.gen;
  }
}

// ---------------------------------------------------------------------------------------------
// Search context (module level: one search at a time per thread)
// ---------------------------------------------------------------------------------------------

const S = {
  b: null,
  e: null,
  tt: null,
  ttKey: '',
  boards: new Map(),
  history: null, // Int32Array(2 * count * count)
  historyKey: '',
  killer1: new Int32Array(MAX_PLY + 2),
  killer2: new Int32Array(MAX_PLY + 2),
  nodes: 0,
  stop: false,
  deadline: Infinity,
  maxNodes: Infinity,
  selDepth: 0,
  jitter: 0,
  seed: 0,
  threatExt: 1,
  lmr: true,
  count: 64,
  rootTurn: 1,
  contempt: 0,
  saltLo: 0,
  saltHi: 0,
};

// Transposition-table salts per contempt mode: [no contempt, white root, black root].
const SALT_LO = [0, 0x5bd1e995 | 0, 0x1b873593 | 0];
const SALT_HI = [0, 0x27d4eb2f | 0, 0x165667b1 | 0];
const DRAW_TIEBREAK = 2;

/**
 * Score of a drawn position (repetition / draw by rule) for the side to move: the root side's
 * contempt plus a small material tie-break (none in giveaway, where material is a liability).
 */
function drawScore() {
  const b = S.b;
  if (b.giveaway) return 0;
  const own = b.turn > 0 ? b.wm + b.wk : b.bm + b.bk;
  const opp = b.turn > 0 ? b.bm + b.bk : b.wm + b.wk;
  const c = b.turn === S.rootTurn ? -S.contempt : S.contempt;
  return c + DRAW_TIEBREAK * (own - opp);
}

let ttBitsDefault = 20;

/** Configure the transposition table size (2^bits entries, ~13 bytes each). Clears it. */
export function configureSearch({ ttBits } = {}) {
  if (Number.isFinite(ttBits)) {
    ttBitsDefault = Math.max(12, Math.min(24, ttBits | 0));
    S.tt = null;
    S.ttKey = '';
  }
}

/** Forget everything learned (transposition table, history) — e.g. on a new game. */
export function resetSearch() {
  if (S.tt) S.tt.clear();
  if (S.history) S.history.fill(0);
}

function boardFor(variantId, giveaway) {
  const key = `${variantId}|${giveaway ? 1 : 0}`;
  let b = S.boards.get(key);
  if (!b) {
    b = new SearchBoard(variantId, giveaway);
    S.boards.set(key, b);
  }
  return b;
}

/** Make sure the TT / history tables belong to this variant (cleared when it changes). */
function ensureTables(variantId, giveaway, newGame) {
  const key = `${variantId}|${giveaway ? 1 : 0}`;
  if (!S.tt) S.tt = new TranspositionTable(ttBitsDefault);
  let fresh = false;
  if (S.ttKey !== key || newGame) {
    S.tt.clear();
    S.ttKey = key;
    fresh = true;
  }
  const t = S.b.t;
  if (!S.history || S.historyKey !== t.id || newGame) {
    S.history = new Int32Array(2 * t.count * t.count);
    S.historyKey = t.id;
    fresh = true;
  }
  S.count = t.count;
  return fresh;
}

/** Per-search preparation: fresh killers, aged history, new TT generation. */
function prepareTables(variantId, giveaway, newGame) {
  const fresh = ensureTables(variantId, giveaway, newGame);
  S.tt.newSearch();
  if (!fresh) {
    const h = S.history;
    for (let i = 0; i < h.length; i++) h[i] >>= 2;
  }
  S.killer1.fill(-1);
  S.killer2.fill(-1);
}

function checkLimits() {
  if (S.nodes >= S.maxNodes || now() >= S.deadline) S.stop = true;
}

function lossScore(ply) {
  return S.b.giveaway ? MATE - ply : -MATE + ply;
}

function toTT(score, ply) {
  if (score > MATE_BOUND) return score + ply;
  if (score < -MATE_BOUND) return score - ply;
  return score;
}

function fromTT(score, ply) {
  if (score > MATE_BOUND) return score - ply;
  if (score < -MATE_BOUND) return score + ply;
  return score;
}

function staticEval() {
  return evaluate(S.b, S.e, S.jitter, S.seed);
}

/** Fill move-ordering scores for moves [start, end) of the node at `ply`. */
function scoreMoves(start, end, ttIndex, ply, isCap) {
  const b = S.b;
  const sc = b.mScore;
  const ord = b.mOrd;
  const hist = S.history;
  const base = b.turn > 0 ? 0 : S.count * S.count;
  const count = S.count;
  const k1 = S.killer1[ply];
  const k2 = S.killer2[ply];
  for (let i = start; i < end; i++) {
    ord[i] = i;
    let s;
    if (i - start === ttIndex) s = ORD_TT;
    else if (isCap) s = ORD_CAPTURE + b.mCapN[i] * 4096 + b.mKCap[i] * 1024 + b.mPromo[i] * 512;
    else {
      const from = b.mFrom[i];
      const to = b.mTo[i];
      const key = from * 1024 + to;
      if (b.mPromo[i]) s = ORD_PROMO;
      else if (key === k1) s = ORD_KILLER1;
      else if (key === k2) s = ORD_KILLER2;
      else {
        s = hist[base + from * count + to];
        if (s > HISTORY_MAX) s = HISTORY_MAX;
      }
    }
    sc[i] = s;
  }
}

function negamax(depth, alpha, beta, ply, ext) {
  const b = S.b;
  S.nodes++;
  if ((S.nodes & 1023) === 0) checkLimits();
  if (S.stop) return 0;
  if (ply > S.selDepth) S.selDepth = ply;

  if (b.isRepetition()) return drawScore();

  const start = b.mTop;
  const cstart = b.cTop;
  if (b.drawByRule()) {
    const n = b.generate();
    b.mTop = start;
    b.cTop = cstart;
    return n === 0 ? lossScore(ply) : drawScore();
  }

  // mate distance pruning
  const mateHere = MATE - ply;
  if (alpha < -mateHere) alpha = -mateHere;
  if (beta > mateHere - 1) beta = mateHere - 1;
  if (alpha >= beta) return alpha;

  const lo = b.hashLo ^ S.saltLo;
  const hi = b.hashHi ^ S.saltHi;
  const tt = S.tt;
  let ttIndex = -1;
  const te = tt.probe(lo, hi);
  if (te >= 0) {
    ttIndex = tt.move[te];
    if (depth > 0 && tt.depth[te] >= depth) {
      const sc = fromTT(tt.score[te], ply);
      const f = tt.flag[te];
      if (f === EXACT || (f === LOWER && sc >= beta) || (f === UPPER && sc <= alpha)) return sc;
    }
  }

  let capHint = 0;
  if (depth <= 0 || ply >= MAX_PLY - 4) {
    // horizon: captures are forced and searched (no stand-pat while one is available); in a quiet
    // position stand pat, unless the opponent threatens a capture (then look one ply further)
    if (b.hasCapture(b.turn)) capHint = 1;
    else {
      if (!b.hasQuietMove()) return lossScore(ply);
      if (ext > 0 && ply < MAX_PLY - 4 && b.hasCapture(-b.turn)) {
        depth = 1;
        ext--;
        capHint = 2;
      } else return staticEval();
    }
    if (ply >= MAX_PLY - 4) return staticEval();
  }
  const n = b.generate(capHint);
  if (n === 0) {
    b.mTop = start;
    b.cTop = cstart;
    return lossScore(ply);
  }
  const isCap = b.genCap;
  const end = b.mTop;
  if (ttIndex >= n) ttIndex = -1;
  scoreMoves(start, end, ttIndex, ply, isCap);
  const newDepth = n === 1 ? depth : depth - 1; // forced replies cost nothing
  const ord = b.mOrd;
  const sc = b.mScore;
  const origAlpha = alpha;
  let best = -INF;
  let bestI = -1;
  for (let k = start; k < end; k++) {
    let bj = k;
    let bs = sc[ord[k]];
    for (let j = k + 1; j < end; j++) {
      const s = sc[ord[j]];
      if (s > bs) {
        bs = s;
        bj = j;
      }
    }
    if (bj !== k) {
      const tmp = ord[k];
      ord[k] = ord[bj];
      ord[bj] = tmp;
    }
    const mi = ord[k];
    const quietMove = !isCap && b.mPromo[mi] === 0;
    const moveNo = k - start;
    b.make(mi);
    let score;
    if (moveNo === 0) {
      score = -negamax(newDepth, -beta, -alpha, ply + 1, ext);
    } else {
      let r = 0;
      if (S.lmr && quietMove && depth >= 3 && moveNo >= 3 && bs < ORD_KILLER2) r = moveNo >= 8 && depth >= 5 ? 2 : 1;
      score = -negamax(newDepth - r, -alpha - 1, -alpha, ply + 1, ext);
      if (r > 0 && score > alpha && !S.stop) score = -negamax(newDepth, -alpha - 1, -alpha, ply + 1, ext);
      if (score > alpha && score < beta && !S.stop) score = -negamax(newDepth, -beta, -alpha, ply + 1, ext);
    }
    b.unmake(mi);
    if (S.stop) {
      b.mTop = start;
      b.cTop = cstart;
      return 0;
    }
    if (score > best) {
      best = score;
      bestI = mi;
      if (score > alpha) {
        alpha = score;
        if (score >= beta) {
          if (quietMove) {
            const key = b.mFrom[mi] * 1024 + b.mTo[mi];
            if (S.killer1[ply] !== key) {
              S.killer2[ply] = S.killer1[ply];
              S.killer1[ply] = key;
            }
            const hidx = (b.turn > 0 ? 0 : S.count * S.count) + b.mFrom[mi] * S.count + b.mTo[mi];
            S.history[hidx] += depth * depth;
          }
          break;
        }
      }
    }
  }
  if (depth > 0) {
    const flag = best <= origAlpha ? UPPER : best >= beta ? LOWER : EXACT;
    tt.store(lo, hi, depth, flag, toTT(best, ply), bestI - start);
  }
  b.mTop = start;
  b.cTop = cstart;
  return best;
}

// ---------------------------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------------------------

function moveKey(from, to, promo, caps) {
  return `${from}>${to}>${promo ? 1 : 0}>${Array.from(caps)
    .sort((a, b) => a - b)
    .join(',')}`;
}

/**
 * Root move list: the engine's legal moves, each tied to an internal move index. The internal
 * generator's list is used when it matches the engine exactly (keeps TT move indices consistent
 * with interior nodes); otherwise the engine moves are pushed as they are.
 */
function buildRoot(b, engineMoves) {
  const start = b.mTop;
  const cstart = b.cTop;
  const n = b.generate();
  const map = new Map();
  for (let i = start; i < start + n; i++) map.set(moveKey(b.mFrom[i], b.mTo[i], b.mPromo[i], b.capturesOf(i)), i);
  const list = [];
  let ok = n === engineMoves.length;
  if (ok) {
    for (const m of engineMoves) {
      const i = map.get(moveKey(m.from, m.to, m.promotion, m.captures));
      if (i === undefined) {
        ok = false;
        break;
      }
      list.push({ i, em: m, score: -INF, prev: -INF });
    }
  }
  if (!ok) {
    b.mTop = start;
    b.cTop = cstart;
    list.length = 0;
    for (const m of engineMoves) list.push({ i: b.pushMove(m.from, m.to, m.promotion, m.captures), em: m, score: -INF, prev: -INF });
  }
  return { list, genIndexed: ok, start };
}

function rootOrderScore(b, r) {
  const i = r.i;
  return b.mCapN[i] * 4096 + b.mKCap[i] * 1024 + b.mPromo[i] * 512;
}

/**
 * Contempt for this search: the level's value while at least a third of the starting material is
 * on the board, 0 in endgames and in giveaway.
 */
function rootContempt(b, P, giveaway) {
  const c = Number.isFinite(P.contempt) ? P.contempt : 0;
  if (giveaway || c === 0) return 0;
  const total = b.wm + b.wk + b.bm + b.bk;
  return 3 * total >= b.t.initialPieces ? c : 0;
}

/** One alpha-beta iteration at the root. Returns { completed, best, score }. */
function rootIteration(list, depth, ext) {
  const b = S.b;
  let alpha = -INF;
  const beta = INF;
  let best = null;
  let bestScore = -INF;
  for (let k = 0; k < list.length; k++) {
    const r = list[k];
    b.make(r.i);
    let score;
    if (k === 0) score = -negamax(depth - 1, -beta, -alpha, 1, ext);
    else {
      score = -negamax(depth - 1, -alpha - 1, -alpha, 1, ext);
      if (!S.stop && score > alpha) {
        // fail high: this move is better than the current best; re-search for the exact score
        const failHigh = score;
        score = -negamax(depth - 1, -beta, -alpha, 1, ext);
        if (S.stop) {
          b.unmake(r.i);
          return { completed: false, best: r, score: failHigh };
        }
      }
    }
    b.unmake(r.i);
    if (S.stop) return { completed: false, best, score: bestScore };
    r.score = score;
    if (score > bestScore) {
      bestScore = score;
      best = r;
      if (score > alpha) alpha = score;
    }
  }
  return { completed: true, best, score: bestScore };
}

/** Exact scores for every root move (full window), for the noisy low levels. */
function rootMultiPV(list, depth, ext) {
  const b = S.b;
  const scores = new Array(list.length);
  for (let k = 0; k < list.length; k++) {
    const r = list[k];
    b.make(r.i);
    const score = -negamax(depth - 1, -INF, INF, 1, ext);
    b.unmake(r.i);
    if (S.stop) return null;
    scores[k] = score;
  }
  return scores;
}

function makeRng(seed) {
  if (seed === undefined || seed === null) return Math.random;
  let a = Number(seed) >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function moveText(variantId, from, to, isCapture) {
  const numeric = getVariant(variantId).notation === 'numeric';
  return `${squareName(variantId, from)}${isCapture ? (numeric ? 'x' : ':') : '-'}${squareName(variantId, to)}`;
}

/** Principal variation from the TT (internal moves → 'from-to' / 'from:to' strings). */
function extractPV(first, maxLen) {
  const b = S.b;
  const variantId = b.t.id;
  const pv = [moveText(variantId, first.em.from, first.em.to, first.em.captures.length > 0)];
  const top0 = b.mTop;
  const ctop0 = b.cTop;
  const made = [];
  b.make(first.i);
  made.push(first.i);
  const seen = new Set();
  while (pv.length < maxLen) {
    const key = `${b.hashLo},${b.hashHi}`;
    if (seen.has(key)) break;
    seen.add(key);
    const te = S.tt.probe(b.hashLo ^ S.saltLo, b.hashHi ^ S.saltHi);
    if (te < 0) break;
    const idx = S.tt.move[te];
    const start = b.mTop;
    const n = b.generate();
    if (idx < 0 || idx >= n) {
      b.mTop = start;
      break;
    }
    const mi = start + idx;
    pv.push(moveText(variantId, b.mFrom[mi], b.mTo[mi], b.mCapN[mi] > 0));
    b.make(mi);
    made.push(mi);
  }
  for (let k = made.length - 1; k >= 0; k--) b.unmake(made[k]);
  b.mTop = top0;
  b.cTop = ctop0;
  return pv;
}

function mateInfo(score) {
  if (score > MATE_BOUND) return MATE - score; // side to move wins in N plies
  if (score < -MATE_BOUND) return -(MATE + score); // loses in N plies
  return 0;
}

/**
 * Search core as a generator. With sliceMs > 0 it pauses (yields) whenever a time slice is used
 * up and continues where it left off when resumed: an interrupted iteration is simply retried —
 * the transposition table keeps the finished subtrees, so every retry gets further. The board
 * and tables are shared module state, so they are re-attached after each pause (another search
 * may have used them meanwhile). With sliceMs = 0 it never yields.
 */
function* searchSteps(state, opts, sliceMs) {
  const t0 = now();
  const level = clampLevel(opts.level === undefined ? 3 : opts.level);
  // `params` (testing / tuning only) overrides individual level parameters
  const P = opts.params && typeof opts.params === 'object' ? { ...LEVEL_PARAMS[level], ...opts.params } : LEVEL_PARAMS[level];
  const timeMs = Number.isFinite(opts.timeMs) && opts.timeMs > 0 ? opts.timeMs : P.timeMs;
  const maxDepth = Math.max(1, Math.min(60, Number.isFinite(opts.maxDepth) && opts.maxDepth > 0 ? opts.maxDepth | 0 : P.maxDepth));
  const maxNodes = Number.isFinite(opts.maxNodes) && opts.maxNodes > 0 ? opts.maxNodes : Infinity;
  const rng = makeRng(opts.seed);
  const giveaway = !!(state.options && state.options.giveaway);
  const hardDeadline = t0 + timeMs;

  const engineMoves = legalMoves(state);
  let nodes = 0;
  let selDepth = 0;
  const done = (r) => {
    const ms = now() - t0;
    if (r.score === 0) r.score = 0; // no -0 from negation
    if (r.scores) for (const x of r.scores) if (x.score === 0) x.score = 0;
    r.timeMs = Math.round(ms);
    r.nps = ms > 0 ? Math.round((r.nodes * 1000) / ms) : 0;
    r.level = level;
    return r;
  };
  if (engineMoves.length === 0) {
    return done({ path: null, score: giveaway ? MATE : -MATE, depth: 0, selDepth: 0, nodes: 0, mate: 0, pv: [], forced: false });
  }

  const evalSeed = (rng() * 4294967296) | 0;
  const attach = () => {
    S.b = boardFor(state.variantId, giveaway);
    S.e = getEvalTables(state.variantId);
    S.b.load(state);
    S.b.setHistory(opts.historyHashes);
    S.maxNodes = maxNodes;
    S.jitter = P.jitter;
    S.seed = evalSeed;
    S.threatExt = P.threatExt;
    S.lmr = P.lmr;
    S.rootTurn = S.b.turn;
    S.contempt = rootContempt(S.b, P, giveaway);
    const mode = S.contempt === 0 ? 0 : S.rootTurn === 1 ? 1 : 2;
    S.saltLo = SALT_LO[mode];
    S.saltHi = SALT_HI[mode];
  };
  attach();
  prepareTables(state.variantId, giveaway, !!opts.newGame);
  S.nodes = 0;
  S.stop = false;
  S.selDepth = 0;
  S.deadline = hardDeadline;

  if (engineMoves.length === 1) {
    const score = staticEval();
    return done({ path: engineMoves[0].path.slice(), score, depth: 0, selDepth: 0, nodes: 0, mate: 0, pv: [], forced: true });
  }

  const list = buildRoot(S.b, engineMoves).list;
  // initial order: captures by size, then the engine order
  list.forEach((r, k) => {
    r.prev = rootOrderScore(S.b, r) * 64 - k;
  });
  list.sort((x, y) => y.prev - x.prev);
  const ext = S.threatExt;

  // the current slice ends at `sliceEnd` (reset only after a pause)
  let sliceEnd = sliceMs > 0 ? now() + sliceMs : hardDeadline;
  const beginSlice = () => {
    S.stop = false;
    S.deadline = Math.min(hardDeadline, sliceEnd);
  };
  const outOfTime = () => now() >= hardDeadline || S.nodes >= maxNodes;
  const pause = () => {
    nodes = S.nodes;
    selDepth = Math.max(selDepth, S.selDepth);
  };
  const resume = () => {
    sliceEnd = now() + sliceMs;
    attach();
    ensureTables(state.variantId, giveaway, false);
    const fresh = buildRoot(S.b, engineMoves).list;
    const idx = new Map(fresh.map((r) => [r.em, r.i]));
    for (const r of list) r.i = idx.get(r.em);
    S.nodes = nodes;
    S.selDepth = 0;
  };

  let best = list[0];
  let bestScore = 0;
  let completedDepth = 0;
  let rootScores = null;

  if (P.multiPV || opts.allScores) {
    let scores = null;
    outer: for (let d = 1; d <= maxDepth; d++) {
      for (;;) {
        beginSlice();
        const sc = rootMultiPV(list, d, ext);
        if (sc) {
          scores = sc;
          completedDepth = d;
          break;
        }
        if (outOfTime() || sliceMs <= 0) break outer;
        pause();
        yield;
        resume();
      }
      if (now() - t0 > timeMs * 0.45 || S.nodes > maxNodes * 0.45) break;
    }
    if (!scores) scores = list.map(() => 0);
    let pick = 0;
    if (P.blunder > 0 && rng() < P.blunder) {
      pick = Math.floor(rng() * list.length);
    } else {
      let bestNoisy = -Infinity;
      for (let k = 0; k < list.length; k++) {
        const noisy = scores[k] + (P.noise > 0 ? gaussian(rng) * P.noise : 0);
        if (noisy > bestNoisy) {
          bestNoisy = noisy;
          pick = k;
        }
      }
    }
    best = list[pick];
    bestScore = scores[pick];
    if (opts.allScores) {
      rootScores = list.map((r, k) => ({ path: r.em.path.slice(), score: scores[k] })).sort((x, y) => y.score - x.score);
    }
  } else {
    outer: for (let d = 1; d <= maxDepth; d++) {
      S.selDepth = 0;
      let it;
      for (;;) {
        beginSlice();
        it = rootIteration(list, d, ext);
        if (it.completed) break;
        if (outOfTime() || sliceMs <= 0) {
          if (it.best) {
            best = it.best;
            bestScore = it.score;
          }
          break outer;
        }
        pause();
        yield;
        resume();
      }
      best = it.best;
      bestScore = it.score;
      completedDepth = d;
      selDepth = Math.max(selDepth, S.selDepth);
      // next iteration: best first, the others by this iteration's scores
      for (const r of list) r.prev = r === best ? INF : r.score;
      list.sort((x, y) => y.prev - x.prev);
      if (Math.abs(bestScore) > MATE_BOUND && d >= mateInfo(Math.abs(bestScore)) + 2) break;
      // the next iteration would rarely finish in the remaining budget
      if (now() - t0 > timeMs * 0.5 || S.nodes > maxNodes * 0.5) break;
    }
    // Promote when it costs nothing: an unstoppable promotion often scores the same now or
    // later (the horizon sees the king either way), but delaying it looks careless.
    if (completedDepth >= 1 && !best.em.promotion && !outOfTime()) {
      const margin = 12;
      const bound = bestScore - margin;
      for (const r of list) {
        if (!r.em.promotion || r === best) continue;
        let sc;
        for (;;) {
          beginSlice();
          S.b.make(r.i);
          sc = -negamax(completedDepth - 1, -bound, -(bound - 1), 1, ext);
          S.b.unmake(r.i);
          if (!S.stop || outOfTime() || sliceMs <= 0) break;
          pause();
          yield;
          resume();
        }
        if (S.stop) break;
        if (sc >= bound) {
          best = r;
          bestScore = Math.min(sc, bestScore);
          break;
        }
      }
      S.stop = false;
    }
  }

  let pv = [];
  try {
    pv = extractPV(best, 12);
  } catch (err) {
    pv = [];
  }
  return done({
    path: best.em.path.slice(),
    score: bestScore,
    depth: completedDepth,
    selDepth: Math.max(selDepth, S.selDepth),
    nodes: S.nodes,
    mate: mateInfo(bestScore),
    pv,
    forced: false,
    ...(rootScores ? { scores: rootScores } : {}),
  });
}

/**
 * Pick a move for the side to move (synchronous; blocks for up to timeMs).
 * @param {object} state engine State
 * @param {object} opts { level 1..5, timeMs, maxDepth, maxNodes, historyHashes, seed, newGame, allScores }
 */
export function search(state, opts = {}) {
  const it = searchSteps(state, opts, 0);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/**
 * Time-sliced search for the main thread: runs in slices of `sliceMs` and yields to the event
 * loop in between (setTimeout), so the UI stays responsive. Resolves the same result as
 * search(), or null if `signal.cancelled` becomes true (checked between slices).
 * @param {object} state engine State
 * @param {object} opts same as search()
 * @param {{ sliceMs?: number, signal?: { cancelled: boolean } }} [control]
 */
export function searchAsync(state, opts = {}, { sliceMs = 30, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    let it;
    try {
      it = searchSteps(state, opts, Math.max(5, sliceMs));
    } catch (err) {
      reject(err);
      return;
    }
    const step = () => {
      if (signal && signal.cancelled) {
        try {
          it.return();
        } catch (err) {
          /* ignore */
        }
        resolve(null);
        return;
      }
      let r;
      try {
        r = it.next();
      } catch (err) {
        reject(err);
        return;
      }
      if (r.done) resolve(r.value);
      else setTimeout(step, 0);
    };
    step();
  });
}

/**
 * Static evaluation of an engine State from WHITE's point of view (100 = a man). Handy for an
 * advantage bar; not a search.
 */
export function evaluateState(state) {
  const giveaway = !!(state.options && state.options.giveaway);
  const b = boardFor(state.variantId, giveaway);
  b.load(state);
  const e = getEvalTables(state.variantId);
  const s = evaluate(b, e, 0, 0);
  return b.turn === 1 ? s : -s;
}
