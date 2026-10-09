// Rules core: legal move generation for every variant, move application with draw counters,
// and position results. Hot paths avoid closures and reuse scratch buffers (the generator is
// synchronous and non-reentrant).

import { getVariant } from './variants.js';
import { getGeometry } from './geometry.js';

export const WHITE = 1;
export const BLACK = -1;

// ---------------------------------------------------------------------------------------------
// Move generation
// ---------------------------------------------------------------------------------------------

const scratchBySize = new Map();

function scratchFor(count) {
  let s = scratchBySize.get(count);
  if (!s) {
    s = { work: new Int8Array(count), mark: new Uint8Array(count) };
    scratchBySize.set(count, s);
  }
  return s;
}

// Generation context (reused; legalMoves is not re-entrant).
const ctx = {
  v: null,
  g: null,
  work: null,
  mark: null,
  color: 0,
  flying: false,
  immediate: false,
  noReverse: false,
  menCaptureKings: true,
  mid: 'king',
  promoRow: 0,
  size: 8,
  piece: 0,
  path: [],
  caps: [],
  capCodes: [],
  out: [],
};

/**
 * All legal moves of the side to move: mandatory capture, maximum/priority rules, dedup of
 * sequences with an identical outcome (same from, to, captured set, promotion). Deterministic
 * order: by origin square ascending, then direction order, then landing distance.
 * A deduplicated move lists the other equivalent paths in `move.alts` (only present if any).
 */
export function legalMoves(state) {
  const v = getVariant(state.variantId);
  const g = getGeometry(v);
  const board = state.board;
  const color = state.turn;
  const sqs = g.squares;

  const s = scratchFor(g.count);
  s.work.set(board);
  s.mark.fill(0);
  ctx.v = v;
  ctx.g = g;
  ctx.work = s.work;
  ctx.mark = s.mark;
  ctx.color = color;
  ctx.flying = v.flyingKings;
  ctx.immediate = v.removal === 'immediate';
  ctx.noReverse = v.noReverse;
  ctx.menCaptureKings = v.menCaptureKings;
  ctx.mid = v.midPromotion;
  ctx.promoRow = g.promoRow[color];
  ctx.size = g.size;
  const out = [];
  ctx.out = out;

  for (let i = 0; i < sqs.length; i++) {
    const sq = sqs[i];
    const code = board[sq];
    if (code === 0 || (code > 0) !== (color > 0)) continue;
    capturesFrom(sq, code);
  }
  ctx.out = null;
  ctx.work = null;
  ctx.mark = null;
  if (out.length) return finalizeCaptures(v, out);
  return quietMoves(v, g, board, color);
}

function capturesFrom(from, code) {
  const work = ctx.work;
  work[from] = 0; // the moving piece leaves its square (it may pass/land there again)
  const king = code === 2 || code === -2;
  const opts = findJumps(from, king, -1);
  if (opts !== null) {
    ctx.piece = code;
    ctx.path.length = 0;
    ctx.caps.length = 0;
    ctx.capCodes.length = 0;
    ctx.path.push(from);
    extend(king, -1, opts);
  }
  work[from] = code;
}

/** Jump options from `sq`: array of { d, x, lands } or null. */
function findJumps(sq, king, lastDir) {
  const g = ctx.g;
  const work = ctx.work;
  const mark = ctx.mark;
  const color = ctx.color;
  const rays = g.rays;
  const dirs = king ? g.kingDirs : g.manCapDirs[color];
  const banned = ctx.noReverse && lastDir >= 0 ? 3 - lastDir : -1;
  let res = null;
  for (let k = 0; k < dirs.length; k++) {
    const d = dirs[k];
    if (d === banned) continue;
    const ray = rays[sq * 4 + d];
    const len = ray.length;
    if (len < 2) continue;
    if (king && ctx.flying) {
      let i = 0;
      while (i < len && work[ray[i]] === 0) i++;
      if (i >= len - 1) continue;
      const x = ray[i];
      if (work[x] * color >= 0 || mark[x] === 1) continue;
      let j = i + 1;
      if (work[ray[j]] !== 0) continue;
      const lands = [];
      while (j < len && work[ray[j]] === 0) {
        lands.push(ray[j]);
        j++;
      }
      if (res === null) res = [];
      res.push({ d, x, lands });
    } else {
      const x = ray[0];
      const xc = work[x];
      if (xc * color >= 0 || mark[x] === 1) continue;
      if (!king && !ctx.menCaptureKings && (xc === 2 || xc === -2)) continue;
      const l = ray[1];
      if (work[l] !== 0) continue;
      if (res === null) res = [];
      res.push({ d, x, lands: [l] });
    }
  }
  return res;
}

function extend(king, promoAt, opts) {
  const work = ctx.work;
  const mark = ctx.mark;
  const path = ctx.path;
  const caps = ctx.caps;
  const capCodes = ctx.capCodes;
  const size = ctx.size;
  const promoRow = ctx.promoRow;
  const mid = ctx.mid;
  const immediate = ctx.immediate;

  for (let o = 0; o < opts.length; o++) {
    const opt = opts[o];
    const x = opt.x;
    const xc = work[x];
    if (immediate) work[x] = 0;
    else mark[x] = 1;
    caps.push(x);
    capCodes.push(xc);

    const lands = opt.lands;
    const m = lands.length;
    if (m === 1) {
      const L = lands[0];
      let nk = king;
      let np = promoAt;
      let stop = false;
      if (!king && ((L / size) | 0) === promoRow) {
        if (mid === 'king') {
          nk = true;
          np = path.length;
        } else if (mid === 'stop') stop = true;
      }
      const cont = stop ? null : findJumps(L, nk, opt.d);
      path.push(L);
      if (cont !== null) extend(nk, np, cont);
      else emit(np);
      path.pop();
    } else {
      // Flying king with several landing squares: if the capture can be continued from some of
      // them, the king must land on one of those.
      const conts = new Array(m);
      let any = false;
      for (let i = 0; i < m; i++) {
        const c = findJumps(lands[i], king, opt.d);
        conts[i] = c;
        if (c !== null) any = true;
      }
      for (let i = 0; i < m; i++) {
        const c = conts[i];
        if (any && c === null) continue;
        path.push(lands[i]);
        if (c !== null) extend(king, promoAt, c);
        else emit(promoAt);
        path.pop();
      }
    }

    caps.pop();
    capCodes.pop();
    if (immediate) work[x] = xc;
    else mark[x] = 0;
  }
}

function emit(promoAt) {
  const path = ctx.path.slice();
  const to = path[path.length - 1];
  const piece = ctx.piece;
  let promotion = false;
  let promotionAt = -1;
  if (piece === 1 || piece === -1) {
    if (ctx.mid === 'king') {
      if (promoAt >= 0) {
        promotion = true;
        promotionAt = promoAt;
      }
    } else if (((to / ctx.size) | 0) === ctx.promoRow) {
      promotion = true;
      promotionAt = path.length - 1;
    }
  }
  ctx.out.push({
    from: path[0],
    to,
    path,
    captures: ctx.caps.slice(),
    captured: ctx.capCodes.slice(),
    piece,
    promotion,
    promotionAt,
  });
}

function isKingCode(c) {
  return c === 2 || c === -2;
}

function kingsCaptured(m) {
  let k = 0;
  const cc = m.captured;
  for (let i = 0; i < cc.length; i++) if (isKingCode(cc[i])) k++;
  return k;
}

function filterMax(list, score) {
  let best = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const s = score(list[i]);
    if (s > best) best = s;
  }
  return list.filter((m) => score(m) === best);
}

function compareKingOrder(a, b) {
  // lexicographic comparison of the indices at which kings were captured (earlier is better)
  const ka = [];
  const kb = [];
  for (let i = 0; i < a.captured.length; i++) if (isKingCode(a.captured[i])) ka.push(i);
  for (let i = 0; i < b.captured.length; i++) if (isKingCode(b.captured[i])) kb.push(i);
  const n = Math.min(ka.length, kb.length);
  for (let i = 0; i < n; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

function finalizeCaptures(v, list) {
  switch (v.capture) {
    case 'max':
      list = filterMax(list, (m) => m.captures.length);
      break;
    case 'max-kings':
      list = filterMax(list, (m) => m.captures.length);
      list = filterMax(list, kingsCaptured);
      break;
    case 'italian': {
      list = filterMax(list, (m) => m.captures.length);
      if (list.some((m) => isKingCode(m.piece))) list = list.filter((m) => isKingCode(m.piece));
      list = filterMax(list, kingsCaptured);
      if (kingsCaptured(list[0]) > 0) {
        let best = list[0];
        for (let i = 1; i < list.length; i++) if (compareKingOrder(list[i], best) < 0) best = list[i];
        list = list.filter((m) => compareKingOrder(m, best) === 0);
      }
      break;
    }
    case 'king-first':
      if (list.some((m) => isKingCode(m.piece))) list = list.filter((m) => isKingCode(m.piece));
      break;
    default:
      break;
  }
  return dedup(list);
}

/** Merge sequences with identical outcome; the first (canonical) keeps the others in `alts`. */
function dedup(list) {
  let needs = false;
  for (let i = 0; i < list.length; i++) {
    if (list[i].captures.length >= 2) {
      needs = true;
      break;
    }
  }
  if (!needs) return list;
  const seen = new Map();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.captures.length < 2) {
      out.push(m);
      continue;
    }
    const key = `${m.from}>${m.to}>${m.promotion ? 1 : 0}>${m.captures
      .slice()
      .sort((a, b) => a - b)
      .join(',')}`;
    const first = seen.get(key);
    if (first) {
      if (!first.alts) first.alts = [];
      first.alts.push(m.path);
    } else {
      seen.set(key, m);
      out.push(m);
    }
  }
  return out;
}

function quietMoves(v, g, board, color) {
  const out = [];
  const sqs = g.squares;
  const rays = g.rays;
  const size = g.size;
  const promoRow = g.promoRow[color];
  const manDirs = g.manMoveDirs[color];
  const flying = v.flyingKings;
  for (let i = 0; i < sqs.length; i++) {
    const sq = sqs[i];
    const code = board[sq];
    if (code === 0 || (code > 0) !== (color > 0)) continue;
    if (code === 2 || code === -2) {
      for (let d = 0; d < 4; d++) {
        const ray = rays[sq * 4 + d];
        for (let j = 0; j < ray.length; j++) {
          const t = ray[j];
          if (board[t] !== 0) break;
          out.push({ from: sq, to: t, path: [sq, t], captures: [], captured: [], piece: code, promotion: false, promotionAt: -1 });
          if (!flying) break;
        }
      }
    } else {
      for (let k = 0; k < manDirs.length; k++) {
        const ray = rays[sq * 4 + manDirs[k]];
        if (ray.length === 0) continue;
        const t = ray[0];
        if (board[t] !== 0) continue;
        const promo = ((t / size) | 0) === promoRow;
        out.push({
          from: sq,
          to: t,
          path: [sq, t],
          captures: [],
          captured: [],
          piece: code,
          promotion: promo,
          promotionAt: promo ? 1 : -1,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Counters (draw rules)
// ---------------------------------------------------------------------------------------------

function loneKingSquare(board, color) {
  const code = 2 * color;
  for (let i = 0; i < board.length; i++) if (board[i] === code) return i;
  return -1;
}

function strongMoves(key, n, f) {
  const strong = key.charCodeAt(0) === 119 /* 'w' */ ? 1 : -1;
  return strong === f ? (n + 1) >> 1 : n >> 1;
}

// Each endgame rule: key(material, board, geometry) → '' (not applicable) or a string whose first
// char is the strong side ('w'/'b') where relevant; draw(key, plies, firstMover) → boolean.
const EG_RULES = {
  // Russian: 3+ kings vs a lone king — the strong side has 15 own moves.
  r3v1: {
    key(m) {
      if (m.bm === 0 && m.bk === 1 && m.wk >= 3) return 'w';
      if (m.wm === 0 && m.wk === 1 && m.bk >= 3) return 'b';
      return '';
    },
    draw: (k, n, f) => strongMoves(k, n, f) >= 15,
  },
  // Russian: 3 pieces (any) vs a lone king on the main road — 5 own moves of the strong side.
  rRoad: {
    key(m, board, g) {
      if (m.bm === 0 && m.bk === 1 && m.wm + m.wk === 3 && g.mainDiag[loneKingSquare(board, -1)]) return 'w';
      if (m.wm === 0 && m.wk === 1 && m.bm + m.bk === 3 && g.mainDiag[loneKingSquare(board, 1)]) return 'b';
      return '';
    },
    draw: (k, n, f) => strongMoves(k, n, f) >= 5,
  },
  // Russian: both sides have kings, material unchanged: 2–3 pieces 5 moves, 4–5 → 30, 6–7 → 60.
  rBalance: {
    key(m) {
      if (m.wk < 1 || m.bk < 1) return '';
      const t = m.wm + m.wk + m.bm + m.bk;
      if (t > 7) return '';
      return `t${t}:${m.wm}.${m.wk}.${m.bm}.${m.bk}`;
    },
    draw(k, n) {
      const t = k.charCodeAt(1) - 48;
      const limit = t <= 3 ? 5 : t <= 5 ? 30 : 60;
      return n >= 2 * limit;
    },
  },
  // FMJD: 3 pieces incl. a king vs a lone king — 16 moves each.
  f16: {
    key(m) {
      if (m.bm === 0 && m.bk === 1 && m.wk >= 1 && m.wm + m.wk === 3) return 'w';
      if (m.wm === 0 && m.wk === 1 && m.bk >= 1 && m.bm + m.bk === 3) return 'b';
      return '';
    },
    draw: (k, n) => n >= 32,
  },
  // FMJD: ≤2 pieces incl. a king vs a lone king — 5 moves each.
  f5: {
    key(m) {
      const w = m.wm + m.wk;
      const b = m.bm + m.bk;
      if (m.bm === 0 && m.bk === 1 && m.wk >= 1 && w <= 2) return 'w';
      if (m.wm === 0 && m.wk === 1 && m.bk >= 1 && b <= 2) return 'b';
      return '';
    },
    draw: (k, n) => n >= 10,
  },
  // Brazilian (CBD Codex): 3 pieces incl. a king vs a lone king on the main diagonal — 5 moves each.
  bRoad: {
    key(m, board, g) {
      if (m.bm === 0 && m.bk === 1 && m.wk >= 1 && m.wm + m.wk === 3 && g.mainDiag[loneKingSquare(board, -1)]) return 'w';
      if (m.wm === 0 && m.wk === 1 && m.bk >= 1 && m.bm + m.bk === 3 && g.mainDiag[loneKingSquare(board, 1)]) return 'b';
      return '';
    },
    draw: (k, n) => n >= 10,
  },
};

const EMPTY_EG = new Map();

function emptyEg(len) {
  let e = EMPTY_EG.get(len);
  if (!e) {
    e = [];
    for (let i = 0; i < len; i++) e.push('', 0, 0);
    Object.freeze(e);
    EMPTY_EG.set(len, e);
  }
  return e;
}

function activeRules(v, options) {
  return options && options.giveaway ? [] : v.draw.rules;
}

/**
 * Endgame-rule trackers, flat array [key, plies, firstMover] per rule of the variant.
 * `prev` is the previous array (or null to start fresh); `turn` = side to move in the new state.
 */
function updateEg(v, options, m, board, turn, prev) {
  const rules = activeRules(v, options);
  const len = rules.length;
  if (len === 0) return emptyEg(0);
  const total = m.wm + m.wk + m.bm + m.bk;
  if (total > 7) return emptyEg(len);
  const g = getGeometry(v);
  const out = new Array(len * 3);
  for (let i = 0; i < len; i++) {
    const key = EG_RULES[rules[i]].key(m, board, g);
    const pk = prev && prev.length === len * 3 ? prev[i * 3] : '';
    if (key === '') {
      out[i * 3] = '';
      out[i * 3 + 1] = 0;
      out[i * 3 + 2] = 0;
    } else if (key === pk) {
      out[i * 3] = key;
      out[i * 3 + 1] = prev[i * 3 + 1] + 1;
      out[i * 3 + 2] = prev[i * 3 + 2];
    } else {
      out[i * 3] = key;
      out[i * 3 + 1] = 0;
      out[i * 3 + 2] = turn;
    }
  }
  return out;
}

export function countMaterial(board) {
  let wm = 0;
  let wk = 0;
  let bm = 0;
  let bk = 0;
  for (let i = 0; i < board.length; i++) {
    const c = board[i];
    if (c === 1) wm++;
    else if (c === 2) wk++;
    else if (c === -1) bm++;
    else if (c === -2) bk++;
  }
  return { wm, wk, bm, bk };
}

/** Fresh counters for a position (no history): quiet = 0, endgame trackers start now. */
export function initialCounters(variantId, board, turn, options) {
  const v = getVariant(variantId);
  const m = countMaterial(board);
  return { quiet: 0, wm: m.wm, wk: m.wk, bm: m.bm, bk: m.bk, eg: updateEg(v, options, m, board, turn, null) };
}

/** Validate/complete counters supplied from outside (deserialization, text positions). */
export function normalizeCounters(variantId, board, turn, options, counters) {
  const fresh = initialCounters(variantId, board, turn, options);
  if (!counters || typeof counters !== 'object') return fresh;
  const quiet = Number.isFinite(counters.quiet) && counters.quiet >= 0 ? Math.floor(counters.quiet) : 0;
  let eg = fresh.eg;
  if (Array.isArray(counters.eg) && counters.eg.length === fresh.eg.length) {
    // keep the supplied trackers only where they agree with the actual position
    const merged = fresh.eg.slice();
    for (let i = 0; i < merged.length; i += 3) {
      if (merged[i] !== '' && counters.eg[i] === merged[i]) {
        const n = Number(counters.eg[i + 1]);
        const f = Number(counters.eg[i + 2]);
        merged[i + 1] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
        merged[i + 2] = f === 1 || f === -1 ? f : turn;
      }
    }
    eg = merged;
  }
  return { quiet, wm: fresh.wm, wk: fresh.wk, bm: fresh.bm, bk: fresh.bk, eg };
}

// ---------------------------------------------------------------------------------------------
// applyMove / positionResult
// ---------------------------------------------------------------------------------------------

/** Counters of a state; hand-built states without counters get fresh ones. */
function countersOf(state) {
  const c = state.counters;
  if (c && Number.isFinite(c.wm) && Array.isArray(c.eg)) return c;
  return normalizeCounters(state.variantId, state.board, state.turn, state.options, c);
}

/** Returns a NEW state with `move` played; the input state is never mutated. */
export function applyMove(state, move) {
  const v = getVariant(state.variantId);
  const board = state.board;
  const turn = state.turn;
  const from = move.from;
  const piece = board[from];
  if (piece === 0 || (piece > 0) !== (turn > 0)) {
    throw new Error(`applyMove: no piece of the side to move on square ${from}`);
  }
  const to = move.to;
  const size = state.size;
  const nb = board.slice();
  nb[from] = 0;
  const c = countersOf(state);
  let wm = c.wm;
  let wk = c.wk;
  let bm = c.bm;
  let bk = c.bk;
  const caps = move.captures;
  for (let i = 0; i < caps.length; i++) {
    const x = caps[i];
    const xc = nb[x];
    if (xc * turn >= 0) throw new Error(`applyMove: square ${x} holds no enemy piece`);
    if (xc === 1) wm--;
    else if (xc === 2) wk--;
    else if (xc === -1) bm--;
    else bk--;
    nb[x] = 0;
  }
  if (nb[to] !== 0) throw new Error(`applyMove: destination ${to} is occupied`);
  const isKing = piece === 2 || piece === -2;
  if (move.promotion && !isKing) {
    nb[to] = 2 * turn;
    if (turn === 1) {
      wm--;
      wk++;
    } else {
      bm--;
      bk++;
    }
  } else {
    nb[to] = piece;
  }

  let progress = caps.length > 0;
  if (!progress && !isKing) {
    progress = v.draw.quietProgress === 'man' || ((from / size) | 0) !== ((to / size) | 0);
  }
  const options = state.options;
  const m = { wm, wk, bm, bk };
  const eg = updateEg(v, options, m, nb, -turn, c.eg);
  return {
    variantId: state.variantId,
    size,
    board: nb,
    turn: -turn,
    ply: (state.ply | 0) + 1,
    counters: { quiet: progress ? 0 : c.quiet + 1, wm, wk, bm, bk, eg },
    options,
  };
}

/**
 * Game-theoretic result of the position, or null if the game goes on.
 * Handles: no pieces / no legal moves (inverted in giveaway), Turkish one-piece-each draw,
 * the variant's no-progress (king moves) limit and the endgame move limits.
 * Threefold repetition / resign / agreement are handled by Game.
 */
export function positionResult(state, moves) {
  const v = getVariant(state.variantId);
  const c = countersOf(state);
  const gw = !!(state.options && state.options.giveaway);
  const me = state.turn;
  const white = c.wm + c.wk;
  const black = c.bm + c.bk;
  const mine = me === 1 ? white : black;
  const theirs = me === 1 ? black : white;
  if (mine === 0) return { winner: gw ? me : -me, reason: 'no-pieces' };
  if (theirs === 0) return { winner: gw ? -me : me, reason: 'no-pieces' };
  const list = moves || legalMoves(state);
  if (list.length === 0) return { winner: gw ? me : -me, reason: 'no-moves' };
  if (!gw && v.draw.oneEach && mine === 1 && theirs === 1) return { winner: 0, reason: 'insufficient' };
  if (c.quiet >= 2 * v.draw.quietMoves) return { winner: 0, reason: 'move-limit' };
  const rules = activeRules(v, state.options);
  const eg = c.eg;
  if (rules.length && eg.length === rules.length * 3) {
    for (let i = 0; i < rules.length; i++) {
      const k = eg[i * 3];
      if (k !== '' && EG_RULES[rules[i]].draw(k, eg[i * 3 + 1], eg[i * 3 + 2])) {
        return { winner: 0, reason: 'move-limit' };
      }
    }
  }
  return null;
}

/** Piece counts of a state: { wm, wk, bm, bk } (white/black men/kings). */
export function materialCount(state) {
  const c = state.counters;
  if (c && Number.isFinite(c.wm)) return { wm: c.wm, wk: c.wk, bm: c.bm, bk: c.bk };
  return countMaterial(state.board);
}
