// Fast mutable board for the AI search: allocation-free move generation (mirrors the engine's
// rules for every variant), make/unmake, incremental 64-bit Zobrist hash (two int32 halves),
// incremental no-progress counter and a replica of the engine's endgame draw trackers.
//
// The engine (src/engine) stays the single source of truth: the search root always maps its
// moves to the engine's legalMoves(state), and tests/ai/board.test.js cross-checks this generator,
// the hash and the draw rules against the engine on many thousands of random positions.
//
// Moves live in typed-array stacks owned by the board. generate() appends the moves of the
// current position at `mTop`; the search resets `mTop`/`cTop` when it leaves a node, so a child
// always generates above its parent's list (stack discipline, no allocation).

import { getVariant, isPlayableSquare } from '../engine/index.js';

export const MAX_PLY = 128;

// Direction order matches the engine: the opposite of direction d is 3 - d.
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

// capture rules
export const CAP_FREE = 0;
export const CAP_MAX = 1;
export const CAP_MAX_KINGS = 2;
export const CAP_ITALIAN = 3;
export const CAP_KING_FIRST = 4;
const CAPTURE_RULES = { free: CAP_FREE, max: CAP_MAX, 'max-kings': CAP_MAX_KINGS, italian: CAP_ITALIAN, 'king-first': CAP_KING_FIRST };

// mid-capture promotion
export const MID_KING = 0;
export const MID_MAN = 1;
export const MID_STOP = 2;
const MID_RULES = { king: MID_KING, man: MID_MAN, stop: MID_STOP };

// endgame draw trackers (replica of the engine's EG_RULES, see src/engine/rules.js)
const EG_R3V1 = 1;
const EG_RROAD = 2;
const EG_RBALANCE = 3;
const EG_F16 = 4;
const EG_F5 = 5;
const EG_BROAD = 6;
const EG_IDS = { r3v1: EG_R3V1, rRoad: EG_RROAD, rBalance: EG_RBALANCE, f16: EG_F16, f5: EG_F5, bRoad: EG_BROAD };
const KEY_W = 1;
const KEY_B = 2;
const BALANCE_BASE = 100000;

// ---------------------------------------------------------------------------------------------
// Zobrist keys (deterministic xorshift; index = sq * 4 + codeIndex(code))
// ---------------------------------------------------------------------------------------------

const MAX_SQUARES = 144;
export const Z_LO = new Int32Array(MAX_SQUARES * 4);
export const Z_HI = new Int32Array(MAX_SQUARES * 4);
export const SIG = new Int32Array(MAX_SQUARES); // capture-set signatures (dedup)
let zSideLo = 0;
let zSideHi = 0;
(function initZobrist() {
  let s = 0x2545f491;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s | 0;
  };
  for (let i = 0; i < Z_LO.length; i++) {
    Z_LO[i] = next();
    Z_HI[i] = next();
  }
  for (let i = 0; i < SIG.length; i++) SIG[i] = next() | 1;
  zSideLo = next();
  zSideHi = next();
})();
export const Z_SIDE_LO = zSideLo;
export const Z_SIDE_HI = zSideHi;

/** 1 → 0, 2 → 1, -1 → 2, -2 → 3 */
export function codeIndex(code) {
  return code > 0 ? code - 1 : 1 - code;
}

/** Zobrist hash { lo, hi } of a board + side to move. */
export function zobrist(board, turn) {
  let lo = 0;
  let hi = 0;
  for (let sq = 0; sq < board.length; sq++) {
    const c = board[sq];
    if (c === 0) continue;
    const zi = sq * 4 + codeIndex(c);
    lo ^= Z_LO[zi];
    hi ^= Z_HI[zi];
  }
  if (turn === -1) {
    lo ^= zSideLo;
    hi ^= zSideHi;
  }
  return { lo, hi };
}

// Characters of the engine's hashState() strings, indexed by code + 2.
const HASH_CODE = { B: -2, b: -1, '.': 0, w: 1, W: 2 };

/** Zobrist hash of an engine hashState() string ('w'/'b' + one char per square); null if malformed. */
export function zobristFromHashString(str, count) {
  if (typeof str !== 'string' || str.length !== count + 1) return null;
  const t = str[0];
  if (t !== 'w' && t !== 'b') return null;
  let lo = 0;
  let hi = 0;
  for (let sq = 0; sq < count; sq++) {
    const c = HASH_CODE[str[sq + 1]];
    if (c === undefined) return null;
    if (c === 0) continue;
    const zi = sq * 4 + codeIndex(c);
    lo ^= Z_LO[zi];
    hi ^= Z_HI[zi];
  }
  if (t === 'b') {
    lo ^= zSideLo;
    hi ^= zSideHi;
  }
  return { lo, hi };
}

// ---------------------------------------------------------------------------------------------
// Per-variant tables
// ---------------------------------------------------------------------------------------------

const tablesCache = new Map();

/** Geometry + rule tables of a variant (cached). */
export function getTables(variantId) {
  const v = getVariant(variantId);
  let t = tablesCache.get(v.id);
  if (!t) {
    t = buildTables(v);
    tablesCache.set(v.id, t);
  }
  return t;
}

function buildTables(v) {
  const n = v.size;
  const count = n * n;
  const ortho = v.geometry === 'orthogonal';
  const dirs = ortho ? ORTHO : DIAG;
  const playable = new Uint8Array(count);
  const list = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (isPlayableSquare(v, r, c)) {
        playable[r * n + c] = 1;
        list.push(r * n + c);
      }
    }
  }
  const rayOff = new Int32Array(count * 4);
  const rayLen = new Uint8Array(count * 4);
  const data = [];
  for (const sq of list) {
    const r0 = (sq / n) | 0;
    const c0 = sq % n;
    for (let d = 0; d < 4; d++) {
      rayOff[sq * 4 + d] = data.length;
      let r = r0 + dirs[d][0];
      let c = c0 + dirs[d][1];
      let len = 0;
      while (r >= 0 && c >= 0 && r < n && c < n) {
        if (playable[r * n + c]) {
          data.push(r * n + c);
          len++;
        }
        r += dirs[d][0];
        c += dirs[d][1];
      }
      rayLen[sq * 4 + d] = len;
    }
  }
  // first / second square along each ray (-1 if none): fast short-range checks
  const adj1 = new Int16Array(count * 4).fill(-1);
  const adj2 = new Int16Array(count * 4).fill(-1);
  for (let i = 0; i < count * 4; i++) {
    if (rayLen[i] >= 1) adj1[i] = data[rayOff[i]];
    if (rayLen[i] >= 2) adj2[i] = data[rayOff[i] + 1];
  }
  const row = new Uint8Array(count);
  const col = new Uint8Array(count);
  for (let sq = 0; sq < count; sq++) {
    row[sq] = (sq / n) | 0;
    col[sq] = sq % n;
  }
  let manMoveW;
  let manMoveB;
  if (ortho) {
    manMoveW = v.manSideways ? [0, 1, 2] : [0];
    manMoveB = v.manSideways ? [1, 2, 3] : [3];
  } else {
    manMoveW = [0, 1];
    manMoveB = [2, 3];
  }
  const all = [0, 1, 2, 3];
  const mainDiag = new Uint8Array(count);
  if (!ortho) {
    for (let i = 0; i < n; i++) {
      const sq = v.darkParity === 1 ? (n - 1 - i) * n + i : i * n + i;
      if (playable[sq]) mainDiag[sq] = 1;
    }
  }
  const rules = v.draw.rules.map((id) => {
    const r = EG_IDS[id];
    if (!r) throw new Error(`AI: unknown endgame draw rule ${id}`);
    return r;
  });
  return Object.freeze({
    id: v.id,
    v,
    n,
    count,
    ortho,
    playable,
    sqs: Int16Array.from(list),
    rays: Int16Array.from(data),
    rayOff,
    rayLen,
    adj1,
    adj2,
    row,
    col,
    manMoveW: Int8Array.from(manMoveW),
    manMoveB: Int8Array.from(manMoveB),
    manCapW: Int8Array.from(v.manBackCapture ? all : manMoveW),
    manCapB: Int8Array.from(v.manBackCapture ? all : manMoveB),
    kingDirs: Int8Array.from(all),
    flying: !!v.flyingKings,
    immediate: v.removal === 'immediate',
    noReverse: !!v.noReverse,
    menCaptureKings: v.menCaptureKings !== false,
    mid: MID_RULES[v.midPromotion],
    captureRule: CAPTURE_RULES[v.capture],
    quietLimit: 2 * v.draw.quietMoves,
    quietProgressMan: v.draw.quietProgress === 'man',
    oneEach: !!v.draw.oneEach,
    egRules: Int8Array.from(rules),
    mainDiag,
    initialPieces: 2 * v.piecesPerSide,
  });
}

// ---------------------------------------------------------------------------------------------
// Endgame tracker helpers
// ---------------------------------------------------------------------------------------------

function loneKingSquare(board, code) {
  for (let i = 0; i < board.length; i++) if (board[i] === code) return i;
  return -1;
}

function egKey(rule, wm, wk, bm, bk, board, mainDiag) {
  switch (rule) {
    case EG_R3V1:
      if (bm === 0 && bk === 1 && wk >= 3) return KEY_W;
      if (wm === 0 && wk === 1 && bk >= 3) return KEY_B;
      return 0;
    case EG_RROAD:
      if (bm === 0 && bk === 1 && wm + wk === 3 && mainDiag[loneKingSquare(board, -2)] === 1) return KEY_W;
      if (wm === 0 && wk === 1 && bm + bk === 3 && mainDiag[loneKingSquare(board, 2)] === 1) return KEY_B;
      return 0;
    case EG_RBALANCE: {
      if (wk < 1 || bk < 1) return 0;
      const t = wm + wk + bm + bk;
      if (t > 7) return 0;
      return BALANCE_BASE + t * 10000 + wm * 1000 + wk * 100 + bm * 10 + bk;
    }
    case EG_F16:
      if (bm === 0 && bk === 1 && wk >= 1 && wm + wk === 3) return KEY_W;
      if (wm === 0 && wk === 1 && bk >= 1 && bm + bk === 3) return KEY_B;
      return 0;
    case EG_F5:
      if (bm === 0 && bk === 1 && wk >= 1 && wm + wk <= 2) return KEY_W;
      if (wm === 0 && wk === 1 && bk >= 1 && bm + bk <= 2) return KEY_B;
      return 0;
    case EG_BROAD:
      if (bm === 0 && bk === 1 && wk >= 1 && wm + wk === 3 && mainDiag[loneKingSquare(board, -2)] === 1) return KEY_W;
      if (wm === 0 && wk === 1 && bk >= 1 && bm + bk === 3 && mainDiag[loneKingSquare(board, 2)] === 1) return KEY_B;
      return 0;
    default:
      return 0;
  }
}

function strongMoves(key, n, f) {
  const strong = key === KEY_W ? 1 : -1;
  return strong === f ? (n + 1) >> 1 : n >> 1;
}

function egDraw(rule, key, n, f) {
  switch (rule) {
    case EG_R3V1:
      return strongMoves(key, n, f) >= 15;
    case EG_RROAD:
      return strongMoves(key, n, f) >= 5;
    case EG_RBALANCE: {
      const t = Math.floor((key - BALANCE_BASE) / 10000);
      const limit = t <= 3 ? 5 : t <= 5 ? 30 : 60;
      return n >= 2 * limit;
    }
    case EG_F16:
      return n >= 32;
    case EG_F5:
    case EG_BROAD:
      return n >= 10;
    default:
      return false;
  }
}

/** Engine tracker key ('' | 'w' | 'b' | 't5:1.2.0.2') → numeric key used here. */
function egKeyFromEngine(k) {
  if (k === '' || k === undefined || k === null) return 0;
  if (k === 'w') return KEY_W;
  if (k === 'b') return KEY_B;
  const m = /^t(\d+):(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(k));
  if (m) return BALANCE_BASE + Number(m[1]) * 10000 + Number(m[2]) * 1000 + Number(m[3]) * 100 + Number(m[4]) * 10 + Number(m[5]);
  return -1; // unknown format
}

// ---------------------------------------------------------------------------------------------
// SearchBoard
// ---------------------------------------------------------------------------------------------

const INITIAL_MOVES = 1 << 14;
const INITIAL_CAPS = 1 << 16;

export class SearchBoard {
  constructor(variantId, giveaway = false) {
    const t = getTables(variantId);
    this.t = t;
    this.giveaway = !!giveaway;
    this.board = new Int8Array(t.count);
    this.mark = new Uint8Array(t.count);
    this.turn = 1;
    this.wm = 0;
    this.wk = 0;
    this.bm = 0;
    this.bk = 0;
    this.quiet = 0;
    this.hashLo = 0;
    this.hashHi = 0;
    this.ply = 0;

    this.egRules = this.giveaway ? new Int8Array(0) : t.egRules;
    this.R3 = this.egRules.length * 3;
    this.eg = new Int32Array(this.R3);
    this.egStack = new Int32Array(Math.max(1, (MAX_PLY + 2) * this.R3));

    // undo stacks (indexed by ply before the move)
    this.uPiece = new Int8Array(MAX_PLY + 2);
    this.uQuiet = new Int32Array(MAX_PLY + 2);
    this.uMat = new Int32Array(MAX_PLY + 2);
    // hash of the position at each ply (ply 0 = root) for repetition detection
    this.hLo = new Int32Array(MAX_PLY + 2);
    this.hHi = new Int32Array(MAX_PLY + 2);
    this.history = null; // Map<lo, hi[]> of game-history positions

    // move stack
    this.mCap = INITIAL_MOVES;
    this.mFrom = new Int16Array(this.mCap);
    this.mTo = new Int16Array(this.mCap);
    this.mPromo = new Uint8Array(this.mCap);
    this.mCapStart = new Int32Array(this.mCap);
    this.mCapN = new Uint16Array(this.mCap);
    this.mKCap = new Uint16Array(this.mCap);
    this.mSig = new Int32Array(this.mCap);
    this.mScore = new Int32Array(this.mCap);
    this.mOrd = new Int32Array(this.mCap);
    this.mTop = 0;
    this.cCap = INITIAL_CAPS;
    this.capBuf = new Int16Array(this.cCap);
    this.codeBuf = new Int8Array(this.cCap);
    this.cTop = 0;

    // generation scratch
    this.path = new Int16Array(512); // captured squares of the sequence being built
    this.pathCodes = new Int8Array(512);
    this.capN = 0;
    this.kN = 0;
    this.sig = 0;
    this.gFrom = 0;
    this.gPiece = 0;
    this.gStart = 0;
    this.gCapStart = 0;
    this.gBest = 0;
    this.gBestK = 0;
    this.gDedup = true;
    this.defer = new Int16Array(4096);
    this.deferTop = 0;
    /** true if the last generate() produced captures */
    this.genCap = false;
  }

  /** Load an engine State (board, turn, counters incl. endgame trackers). */
  load(state) {
    const t = this.t;
    if (state.board.length !== t.count) throw new Error('SearchBoard.load: board size mismatch');
    this.board.set(state.board);
    this.mark.fill(0);
    this.turn = state.turn === -1 ? -1 : 1;
    let wm = 0;
    let wk = 0;
    let bm = 0;
    let bk = 0;
    const b = this.board;
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (c === 1) wm++;
      else if (c === 2) wk++;
      else if (c === -1) bm++;
      else if (c === -2) bk++;
    }
    this.wm = wm;
    this.wk = wk;
    this.bm = bm;
    this.bk = bk;
    const c = state.counters;
    this.quiet = c && Number.isFinite(c.quiet) && c.quiet > 0 ? c.quiet | 0 : 0;
    // endgame trackers: take the engine's when the format is understood, else start fresh
    const R3 = this.R3;
    let ok = false;
    if (R3 > 0 && c && Array.isArray(c.eg) && c.eg.length === R3) {
      ok = true;
      for (let i = 0; i < R3; i += 3) {
        const key = egKeyFromEngine(c.eg[i]);
        if (key < 0) {
          ok = false;
          break;
        }
        this.eg[i] = key;
        this.eg[i + 1] = Number(c.eg[i + 1]) | 0;
        this.eg[i + 2] = Number(c.eg[i + 2]) | 0;
      }
    }
    if (R3 > 0 && !ok) {
      this.eg.fill(0);
      this.updateEg(); // fresh trackers for the current material (count 0, started now)
    }
    const z = zobrist(this.board, this.turn);
    this.hashLo = z.lo;
    this.hashHi = z.hi;
    this.ply = 0;
    this.hLo[0] = z.lo;
    this.hHi[0] = z.hi;
    this.mTop = 0;
    this.cTop = 0;
    this.deferTop = 0;
  }

  /**
   * Game-history hashes (engine hashState strings, oldest first) for repetition detection. Call
   * after load(): only the last `quiet + 1` positions can recur (older ones precede an
   * irreversible move), so the rest is skipped.
   */
  setHistory(hashStrings) {
    this.history = null;
    if (!Array.isArray(hashStrings) || hashStrings.length === 0) return;
    const map = new Map();
    const from = Math.max(0, hashStrings.length - (this.quiet + 2));
    for (let k = from; k < hashStrings.length; k++) {
      const h = hashStrings[k];
      const z = zobristFromHashString(h, this.t.count);
      if (!z) continue;
      const arr = map.get(z.lo);
      if (arr) {
        if (!arr.includes(z.hi)) arr.push(z.hi);
      } else map.set(z.lo, [z.hi]);
    }
    this.history = map.size ? map : null;
  }

  // ----------------------------------------------------------------------------- generation

  _growMoves() {
    const cap = this.mCap * 2;
    const grow = (a, Ctor) => {
      const b = new Ctor(cap);
      b.set(a);
      return b;
    };
    this.mFrom = grow(this.mFrom, Int16Array);
    this.mTo = grow(this.mTo, Int16Array);
    this.mPromo = grow(this.mPromo, Uint8Array);
    this.mCapStart = grow(this.mCapStart, Int32Array);
    this.mCapN = grow(this.mCapN, Uint16Array);
    this.mKCap = grow(this.mKCap, Uint16Array);
    this.mSig = grow(this.mSig, Int32Array);
    this.mScore = grow(this.mScore, Int32Array);
    this.mOrd = grow(this.mOrd, Int32Array);
    this.mCap = cap;
  }

  _growCaps(need) {
    let cap = this.cCap;
    while (cap < need) cap *= 2;
    const a = new Int16Array(cap);
    a.set(this.capBuf);
    const b = new Int8Array(cap);
    b.set(this.codeBuf);
    this.capBuf = a;
    this.codeBuf = b;
    this.cCap = cap;
  }

  /**
   * Generate all legal moves of the side to move at mTop. Returns the number of moves; the list
   * is [start, this.mTop) with start = mTop before the call. Sets this.genCap.
   * `capHint`: 0 = unknown, 1 = the side to move is known to have a capture, 2 = known not to.
   */
  generate(capHint = 0) {
    const t = this.t;
    const board = this.board;
    const color = this.turn;
    const sqs = t.sqs;
    const start = this.mTop;
    this.gStart = start;
    this.gCapStart = this.cTop;
    this.gBest = 0;
    this.gBestK = 0;
    this.gDedup = t.captureRule !== CAP_ITALIAN;
    const anyCapture = capHint === 1 ? true : capHint === 2 ? false : this.hasCapture(color);
    if (!anyCapture) {
      this.genCap = false;
      this._quiet();
      return this.mTop - start;
    }
    for (let i = 0; i < sqs.length; i++) {
      const sq = sqs[i];
      const code = board[sq];
      if (code === 0 || (code > 0) !== (color > 0)) continue;
      if (!this._canCapture(sq, code, color)) continue;
      board[sq] = 0; // the moving piece leaves its square (it may pass/land there again)
      this.gFrom = sq;
      this.gPiece = code;
      this.capN = 0;
      this.kN = 0;
      this.sig = 0;
      this._dfs(sq, code === 2 || code === -2, -1, false);
      board[sq] = code;
    }
    if (this.mTop > start) {
      const rule = t.captureRule;
      if (rule === CAP_ITALIAN) this._filterItalian(start);
      else if (rule === CAP_KING_FIRST) this._filterKingFirst(start);
      this.genCap = true;
      return this.mTop - start;
    }
    this.genCap = false;
    this._quiet();
    return this.mTop - start;
  }

  _dfs(sq, king, lastDir, promoted) {
    const t = this.t;
    const board = this.board;
    const mark = this.mark;
    const color = this.turn;
    const rays = t.rays;
    const dirs = king ? t.kingDirs : color > 0 ? t.manCapW : t.manCapB;
    const banned = t.noReverse && lastDir >= 0 ? 3 - lastDir : -1;
    const immediate = t.immediate;
    const flyingKing = king && t.flying;
    let found = false;
    for (let k = 0; k < dirs.length; k++) {
      const d = dirs[k];
      if (d === banned) continue;
      const ri = sq * 4 + d;
      const len = t.rayLen[ri];
      if (len < 2) continue;
      const off = t.rayOff[ri];
      if (flyingKing) {
        let i = 0;
        while (i < len && board[rays[off + i]] === 0) i++;
        if (i >= len - 1) continue;
        const x = rays[off + i];
        const xc = board[x];
        if (xc * color >= 0 || mark[x] === 1) continue;
        if (board[rays[off + i + 1]] !== 0) continue;
        found = true;
        this._pushCap(x, xc);
        if (immediate) board[x] = 0;
        else mark[x] = 1;
        // Landing squares: if the capture can be continued from some of them, the king must land
        // on one of those; terminal landings are deferred until we know.
        const deferStart = this.deferTop;
        let anyCont = false;
        for (let j = i + 1; j < len; j++) {
          const L = rays[off + j];
          if (board[L] !== 0) break;
          if (this._dfs(L, true, d, promoted)) anyCont = true;
          else if (!anyCont) {
            if (this.deferTop >= this.defer.length) {
              const nd = new Int16Array(this.defer.length * 2);
              nd.set(this.defer);
              this.defer = nd;
            }
            this.defer[this.deferTop++] = L;
          }
        }
        if (!anyCont) for (let j = deferStart; j < this.deferTop; j++) this._emit(this.defer[j], promoted);
        this.deferTop = deferStart;
        this._popCap(x);
        if (immediate) board[x] = xc;
        else mark[x] = 0;
      } else {
        const x = rays[off];
        const xc = board[x];
        if (xc * color >= 0 || mark[x] === 1) continue;
        if (!king && !t.menCaptureKings && (xc === 2 || xc === -2)) continue;
        const L = rays[off + 1];
        if (board[L] !== 0) continue;
        found = true;
        this._pushCap(x, xc);
        if (immediate) board[x] = 0;
        else mark[x] = 1;
        let nk = king;
        let np = promoted;
        let stop = false;
        if (!king && t.row[L] === (color > 0 ? 0 : t.n - 1)) {
          if (t.mid === MID_KING) {
            nk = true;
            np = true;
          } else if (t.mid === MID_STOP) stop = true;
        }
        if (stop || !this._dfs(L, nk, d, np)) this._emit(L, np);
        this._popCap(x);
        if (immediate) board[x] = xc;
        else mark[x] = 0;
      }
    }
    return found;
  }

  _pushCap(x, xc) {
    const n = this.capN;
    if (n >= this.path.length) {
      const p = new Int16Array(this.path.length * 2);
      p.set(this.path);
      this.path = p;
      const c = new Int8Array(this.pathCodes.length * 2);
      c.set(this.pathCodes);
      this.pathCodes = c;
    }
    this.path[n] = x;
    this.pathCodes[n] = xc;
    this.capN = n + 1;
    if (xc === 2 || xc === -2) this.kN++;
    this.sig ^= SIG[x];
  }

  _popCap(x) {
    const n = --this.capN;
    const xc = this.pathCodes[n];
    if (xc === 2 || xc === -2) this.kN--;
    this.sig ^= SIG[x];
  }

  _emit(to, promoted) {
    const t = this.t;
    const piece = this.gPiece;
    const n = this.capN;
    const k = this.kN;
    let promo = 0;
    if (piece === 1 || piece === -1) {
      if (t.mid === MID_KING) promo = promoted ? 1 : 0;
      else if (t.row[to] === (piece > 0 ? 0 : t.n - 1)) promo = 1;
    }
    const rule = t.captureRule;
    if (rule === CAP_MAX || rule === CAP_ITALIAN) {
      if (n < this.gBest) return;
      if (n > this.gBest) {
        this.mTop = this.gStart;
        this.cTop = this.gCapStart;
        this.gBest = n;
      }
    } else if (rule === CAP_MAX_KINGS) {
      if (n < this.gBest || (n === this.gBest && k < this.gBestK)) return;
      if (n > this.gBest || k > this.gBestK) {
        this.mTop = this.gStart;
        this.cTop = this.gCapStart;
        this.gBest = n;
        this.gBestK = k;
      }
    }
    const from = this.gFrom;
    const sig = this.sig;
    if (n >= 2 && this.gDedup && this._isDup(from, to, promo, n, sig)) return;
    if (this.mTop >= this.mCap) this._growMoves();
    if (this.cTop + n > this.cCap) this._growCaps(this.cTop + n);
    const i = this.mTop++;
    this.mFrom[i] = from;
    this.mTo[i] = to;
    this.mPromo[i] = promo;
    this.mCapStart[i] = this.cTop;
    this.mCapN[i] = n;
    this.mKCap[i] = k;
    this.mSig[i] = sig;
    const cap = this.capBuf;
    const path = this.path;
    const base = this.cTop;
    for (let j = 0; j < n; j++) cap[base + j] = path[j];
    this.cTop = base + n;
  }

  _isDup(from, to, promo, n, sig) {
    const path = this.path;
    for (let i = this.gStart; i < this.mTop; i++) {
      if (this.mSig[i] !== sig || this.mFrom[i] !== from || this.mTo[i] !== to) continue;
      if (this.mCapN[i] !== n || this.mPromo[i] !== promo) continue;
      if (this._sameSet(this.mCapStart[i], path, n)) return true;
    }
    return false;
  }

  _sameSet(cs, path, n) {
    const cap = this.capBuf;
    for (let a = 0; a < n; a++) {
      const x = path[a];
      let ok = false;
      for (let b = 0; b < n; b++) {
        if (cap[cs + b] === x) {
          ok = true;
          break;
        }
      }
      if (!ok) return false;
    }
    return true;
  }

  _moveIsKing(i) {
    const c = this.board[this.mFrom[i]];
    return c === 2 || c === -2;
  }

  _compact(start, keep) {
    let w = start;
    for (let i = start; i < this.mTop; i++) {
      if (!keep(i)) continue;
      if (w !== i) {
        this.mFrom[w] = this.mFrom[i];
        this.mTo[w] = this.mTo[i];
        this.mPromo[w] = this.mPromo[i];
        this.mCapStart[w] = this.mCapStart[i];
        this.mCapN[w] = this.mCapN[i];
        this.mKCap[w] = this.mKCap[i];
        this.mSig[w] = this.mSig[i];
      }
      w++;
    }
    this.mTop = w;
  }

  _filterKingFirst(start) {
    let anyKing = false;
    for (let i = start; i < this.mTop; i++) {
      if (this._moveIsKing(i)) {
        anyKing = true;
        break;
      }
    }
    if (anyKing) this._compact(start, (i) => this._moveIsKing(i));
  }

  /** Italian priorities after "most pieces" (already enforced): king capturer, most kings, earliest kings; then dedup. */
  _filterItalian(start) {
    let anyKing = false;
    for (let i = start; i < this.mTop; i++) {
      if (this._moveIsKing(i)) {
        anyKing = true;
        break;
      }
    }
    if (anyKing) this._compact(start, (i) => this._moveIsKing(i));
    let maxK = 0;
    for (let i = start; i < this.mTop; i++) if (this.mKCap[i] > maxK) maxK = this.mKCap[i];
    this._compact(start, (i) => this.mKCap[i] === maxK);
    if (maxK > 0) {
      let best = start;
      for (let i = start + 1; i < this.mTop; i++) if (this._kingOrder(i, best) < 0) best = i;
      const bestIdx = best;
      // copy the reference order (compaction may move `best`)
      const ref = this._kingIndices(bestIdx);
      this._compact(start, (i) => this._cmpKingIndices(this._kingIndices(i), ref) === 0);
    }
    // dedup (identical outcome) after the order-dependent filter, like the engine
    let w = start;
    for (let i = start; i < this.mTop; i++) {
      let dup = false;
      if (this.mCapN[i] >= 2) {
        for (let j = start; j < w; j++) {
          if (
            this.mSig[j] === this.mSig[i] &&
            this.mFrom[j] === this.mFrom[i] &&
            this.mTo[j] === this.mTo[i] &&
            this.mCapN[j] === this.mCapN[i] &&
            this.mPromo[j] === this.mPromo[i] &&
            this._sameCaps(j, i)
          ) {
            dup = true;
            break;
          }
        }
      }
      if (dup) continue;
      if (w !== i) {
        this.mFrom[w] = this.mFrom[i];
        this.mTo[w] = this.mTo[i];
        this.mPromo[w] = this.mPromo[i];
        this.mCapStart[w] = this.mCapStart[i];
        this.mCapN[w] = this.mCapN[i];
        this.mKCap[w] = this.mKCap[i];
        this.mSig[w] = this.mSig[i];
      }
      w++;
    }
    this.mTop = w;
  }

  _sameCaps(a, b) {
    const n = this.mCapN[a];
    const ca = this.mCapStart[a];
    const cb = this.mCapStart[b];
    const cap = this.capBuf;
    for (let i = 0; i < n; i++) {
      const x = cap[ca + i];
      let ok = false;
      for (let j = 0; j < n; j++) {
        if (cap[cb + j] === x) {
          ok = true;
          break;
        }
      }
      if (!ok) return false;
    }
    return true;
  }

  _kingIndices(i) {
    const out = [];
    const cs = this.mCapStart[i];
    const n = this.mCapN[i];
    for (let j = 0; j < n; j++) {
      const c = this.board[this.capBuf[cs + j]];
      if (c === 2 || c === -2) out.push(j);
    }
    return out;
  }

  _cmpKingIndices(ka, kb) {
    const n = Math.min(ka.length, kb.length);
    for (let i = 0; i < n; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  }

  _kingOrder(a, b) {
    return this._cmpKingIndices(this._kingIndices(a), this._kingIndices(b));
  }

  _quiet() {
    const t = this.t;
    const board = this.board;
    const color = this.turn;
    const sqs = t.sqs;
    const rays = t.rays;
    const flying = t.flying;
    const manDirs = color > 0 ? t.manMoveW : t.manMoveB;
    const promoRow = color > 0 ? 0 : t.n - 1;
    const row = t.row;
    for (let s = 0; s < sqs.length; s++) {
      const sq = sqs[s];
      const code = board[sq];
      if (code === 0 || (code > 0) !== (color > 0)) continue;
      if (code === 2 || code === -2) {
        for (let d = 0; d < 4; d++) {
          const ri = sq * 4 + d;
          const off = t.rayOff[ri];
          const len = t.rayLen[ri];
          for (let j = 0; j < len; j++) {
            const to = rays[off + j];
            if (board[to] !== 0) break;
            this._pushQuiet(sq, to, 0);
            if (!flying) break;
          }
        }
      } else {
        for (let k = 0; k < manDirs.length; k++) {
          const ri = sq * 4 + manDirs[k];
          if (t.rayLen[ri] === 0) continue;
          const to = rays[t.rayOff[ri]];
          if (board[to] !== 0) continue;
          this._pushQuiet(sq, to, row[to] === promoRow ? 1 : 0);
        }
      }
    }
  }

  _pushQuiet(from, to, promo) {
    if (this.mTop >= this.mCap) this._growMoves();
    const i = this.mTop++;
    this.mFrom[i] = from;
    this.mTo[i] = to;
    this.mPromo[i] = promo;
    this.mCapStart[i] = this.cTop;
    this.mCapN[i] = 0;
    this.mKCap[i] = 0;
    this.mSig[i] = 0;
  }

  /** Append a move given from outside (engine root moves). Returns its index. */
  pushMove(from, to, promo, captures) {
    const n = captures.length;
    if (this.mTop >= this.mCap) this._growMoves();
    if (this.cTop + n > this.cCap) this._growCaps(this.cTop + n);
    const i = this.mTop++;
    let k = 0;
    let sig = 0;
    for (let j = 0; j < n; j++) {
      const x = captures[j];
      this.capBuf[this.cTop + j] = x;
      const c = this.board[x];
      if (c === 2 || c === -2) k++;
      sig ^= SIG[x];
    }
    this.mFrom[i] = from;
    this.mTo[i] = to;
    this.mPromo[i] = promo ? 1 : 0;
    this.mCapStart[i] = this.cTop;
    this.mCapN[i] = n;
    this.mKCap[i] = k;
    this.mSig[i] = sig;
    this.cTop += n;
    return i;
  }

  /** Does `color` have at least one capture available (single jump check, no full generation)? */
  hasCapture(color) {
    const board = this.board;
    const sqs = this.t.sqs;
    for (let s = 0; s < sqs.length; s++) {
      const sq = sqs[s];
      const code = board[sq];
      if (code === 0 || (code > 0) !== (color > 0)) continue;
      if (this._canCapture(sq, code, color)) return true;
    }
    return false;
  }

  /** Can the piece `code` of `color` on `sq` make a first jump? */
  _canCapture(sq, code, color) {
    const t = this.t;
    const board = this.board;
    const king = code === 2 || code === -2;
    const dirs = king ? t.kingDirs : color > 0 ? t.manCapW : t.manCapB;
    if (king && t.flying) {
      const rays = t.rays;
      for (let k = 0; k < 4; k++) {
        const ri = sq * 4 + k;
        const len = t.rayLen[ri];
        if (len < 2) continue;
        const off = t.rayOff[ri];
        let i = 0;
        while (i < len && board[rays[off + i]] === 0) i++;
        if (i >= len - 1) continue;
        if (board[rays[off + i]] * color < 0 && board[rays[off + i + 1]] === 0) return true;
      }
      return false;
    }
    const adj1 = t.adj1;
    const adj2 = t.adj2;
    const mck = t.menCaptureKings || king;
    for (let k = 0; k < dirs.length; k++) {
      const ri = sq * 4 + dirs[k];
      const l = adj2[ri];
      if (l < 0 || board[l] !== 0) continue;
      const xc = board[adj1[ri]];
      if (xc * color >= 0) continue;
      if (!mck && (xc === 2 || xc === -2)) continue;
      return true;
    }
    return false;
  }

  /** Does the side to move have a non-capturing move? (early exit; ignores mandatory capture) */
  hasQuietMove() {
    const t = this.t;
    const board = this.board;
    const color = this.turn;
    const sqs = t.sqs;
    const adj1 = t.adj1;
    const manDirs = color > 0 ? t.manMoveW : t.manMoveB;
    for (let s = 0; s < sqs.length; s++) {
      const sq = sqs[s];
      const code = board[sq];
      if (code === 0 || (code > 0) !== (color > 0)) continue;
      if (code === 2 || code === -2) {
        for (let d = 0; d < 4; d++) {
          const a = adj1[sq * 4 + d];
          if (a >= 0 && board[a] === 0) return true;
        }
      } else {
        for (let k = 0; k < manDirs.length; k++) {
          const a = adj1[sq * 4 + manDirs[k]];
          if (a >= 0 && board[a] === 0) return true;
        }
      }
    }
    return false;
  }

  // ----------------------------------------------------------------------------- make / unmake

  make(i) {
    const t = this.t;
    const board = this.board;
    const ply = this.ply;
    const from = this.mFrom[i];
    const to = this.mTo[i];
    const promo = this.mPromo[i];
    const cs = this.mCapStart[i];
    const cn = this.mCapN[i];
    const piece = board[from];
    this.uPiece[ply] = piece;
    this.uQuiet[ply] = this.quiet;
    this.uMat[ply] = this.wm | (this.wk << 8) | (this.bm << 16) | (this.bk << 24);
    const R3 = this.R3;
    if (R3 > 0) {
      const base = ply * R3;
      for (let j = 0; j < R3; j++) this.egStack[base + j] = this.eg[j];
    }
    let lo = this.hashLo ^ zSideLo;
    let hi = this.hashHi ^ zSideHi;
    let zi = from * 4 + (piece > 0 ? piece - 1 : 1 - piece);
    lo ^= Z_LO[zi];
    hi ^= Z_HI[zi];
    board[from] = 0;
    const cap = this.capBuf;
    const codes = this.codeBuf;
    for (let k = 0; k < cn; k++) {
      const x = cap[cs + k];
      const c = board[x];
      codes[cs + k] = c;
      board[x] = 0;
      zi = x * 4 + (c > 0 ? c - 1 : 1 - c);
      lo ^= Z_LO[zi];
      hi ^= Z_HI[zi];
      if (c === 1) this.wm--;
      else if (c === 2) this.wk--;
      else if (c === -1) this.bm--;
      else this.bk--;
    }
    let fin = piece;
    if (promo) {
      if (piece > 0) {
        fin = 2;
        this.wm--;
        this.wk++;
      } else {
        fin = -2;
        this.bm--;
        this.bk++;
      }
    }
    board[to] = fin;
    zi = to * 4 + (fin > 0 ? fin - 1 : 1 - fin);
    lo ^= Z_LO[zi];
    hi ^= Z_HI[zi];
    this.hashLo = lo;
    this.hashHi = hi;
    this.turn = -this.turn;
    let progress = cn > 0;
    if (!progress && (piece === 1 || piece === -1)) progress = t.quietProgressMan || t.row[from] !== t.row[to];
    this.quiet = progress ? 0 : this.quiet + 1;
    this.ply = ply + 1;
    this.hLo[ply + 1] = lo;
    this.hHi[ply + 1] = hi;
    if (R3 > 0) this.updateEg();
  }

  unmake(i) {
    const board = this.board;
    const ply = --this.ply;
    const from = this.mFrom[i];
    const to = this.mTo[i];
    const cs = this.mCapStart[i];
    const cn = this.mCapN[i];
    board[to] = 0;
    const cap = this.capBuf;
    const codes = this.codeBuf;
    for (let k = 0; k < cn; k++) board[cap[cs + k]] = codes[cs + k];
    board[from] = this.uPiece[ply];
    this.turn = -this.turn;
    this.quiet = this.uQuiet[ply];
    const m = this.uMat[ply];
    this.wm = m & 255;
    this.wk = (m >> 8) & 255;
    this.bm = (m >> 16) & 255;
    this.bk = (m >>> 24) & 255;
    this.hashLo = this.hLo[ply];
    this.hashHi = this.hHi[ply];
    const R3 = this.R3;
    if (R3 > 0) {
      const base = ply * R3;
      for (let j = 0; j < R3; j++) this.eg[j] = this.egStack[base + j];
    }
  }

  // ----------------------------------------------------------------------------- draws

  /** Update the endgame trackers after a move (this.turn = side to move in the new position). */
  updateEg() {
    const R3 = this.R3;
    const eg = this.eg;
    const wm = this.wm;
    const wk = this.wk;
    const bm = this.bm;
    const bk = this.bk;
    if (wm + wk + bm + bk > 7) {
      for (let j = 0; j < R3; j++) eg[j] = 0;
      return;
    }
    const rules = this.egRules;
    for (let r = 0; r < rules.length; r++) {
      const key = egKey(rules[r], wm, wk, bm, bk, this.board, this.t.mainDiag);
      const j = r * 3;
      if (key === 0) {
        eg[j] = 0;
        eg[j + 1] = 0;
        eg[j + 2] = 0;
      } else if (key === eg[j]) {
        eg[j + 1]++;
      } else {
        eg[j] = key;
        eg[j + 1] = 0;
        eg[j + 2] = this.turn;
      }
    }
  }

  /**
   * Draw by a counter rule in the current position (assuming the side to move has a legal move):
   * Turkish one-piece-each, the no-progress limit and the endgame move limits.
   */
  drawByRule() {
    const t = this.t;
    if (this.quiet >= t.quietLimit) return true;
    if (this.giveaway) return false;
    if (t.oneEach && this.wm + this.wk === 1 && this.bm + this.bk === 1) return true;
    const R3 = this.R3;
    if (R3 === 0) return false;
    const eg = this.eg;
    const rules = this.egRules;
    for (let r = 0; r < rules.length; r++) {
      const key = eg[r * 3];
      if (key !== 0 && egDraw(rules[r], key, eg[r * 3 + 1], eg[r * 3 + 2])) return true;
    }
    return false;
  }

  /** The current position occurred before (search path since the last irreversible move, or game history). */
  isRepetition() {
    const q = this.quiet;
    if (q < 4) return false;
    const p = this.ply;
    const lo = this.hashLo;
    const hi = this.hashHi;
    const lim = p - q > 0 ? p - q : 0;
    for (let i = p - 4; i >= lim; i -= 2) if (this.hLo[i] === lo && this.hHi[i] === hi) return true;
    if (q > p && this.history !== null) {
      const arr = this.history.get(lo);
      if (arr !== undefined) for (let i = 0; i < arr.length; i++) if (arr[i] === hi) return true;
    }
    return false;
  }

  /** Pieces of the side to move / of the opponent. */
  ownPieces() {
    return this.turn > 0 ? this.wm + this.wk : this.bm + this.bk;
  }

  /** Captured-square list of move i (array copy; not for hot paths). */
  capturesOf(i) {
    const out = [];
    const cs = this.mCapStart[i];
    for (let k = 0; k < this.mCapN[i]; k++) out.push(this.capBuf[cs + k]);
    return out;
  }
}
