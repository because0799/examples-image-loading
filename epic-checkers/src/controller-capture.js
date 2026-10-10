// Why can't this piece be picked up? (RO-2 / MUX-02 / MUX-16)
//
// The engine's legalMoves() already applies the capture-priority rules (majority rule, Spanish
// "quantity then quality", Italian priorities, Czech "a king must capture"), so a piece that
// physically CAN capture is simply missing from the legal moves. To explain a refused tap
// precisely, this helper replays the engine's capture generation for one piece WITHOUT the
// priority filter (same geometry tables and movement flags as src/engine/rules.js findJumps /
// extend) and compares its best sequence with the legal ones.
//
//   rawCaptureStats(state, sq) -> { count, kings, manVsKing, lands, kingLands } | null
//   illegalTapReason(state, moves, sq, selected = -1) -> null | 'mustCapture' | 'mustCaptureMax' |
//       'mustCaptureMaxAny' | 'mustCaptureKings' | 'capturePriority' | 'kingMustCapture' |
//       'manCantTakeKing' | 'noMovesForPiece'
// The reason maps to the i18n key `status.<reason>`.

import { getGeometry } from './engine/geometry.js';
import { getVariant } from './engine/index.js';

const NODE_LIMIT = 200000; // safety cap for pathological flying-king positions (12×12)

const isKing = (c) => c === 2 || c === -2;

/**
 * Best raw capture sequence of the piece on `sq` (ignoring the capture-priority rules):
 * `count` = most pieces it can take in one move, `kings` = most kings among sequences with that
 * count; `lands` = landing squares of its possible first jumps; `manVsKing` / `kingLands` = it is
 * a man next to an enemy king it could jump if men were allowed to capture kings (Italian), and
 * where it would land. null for an empty square.
 */
export function rawCaptureStats(state, sq) {
  const code = state && state.board ? state.board[sq] : 0;
  if (!code) return null;
  const v = getVariant(state.variantId);
  const g = getGeometry(v);
  const color = code > 0 ? 1 : -1;
  const work = Int8Array.from(state.board);
  const mark = new Uint8Array(work.length);
  work[sq] = 0; // the moving piece leaves its square (it may pass / land there again)
  const flying = !!v.flyingKings;
  const immediate = v.removal === 'immediate';
  const noReverse = !!v.noReverse;
  const menTakeKings = v.menCaptureKings !== false;
  const mid = v.midPromotion;
  const promoRow = g.promoRow[color];
  const size = g.size;
  const rays = g.rays;
  let best = { count: 0, kings: 0 };
  let manVsKing = false;
  const kingLands = [];
  let lands = [];
  let nodes = 0;

  const record = (count, kings) => {
    if (count > best.count || (count === best.count && kings > best.kings)) best = { count, kings };
  };

  // mirror of rules.js findJumps(): jump options from `from` as [{ d, x, lands }]
  const jumps = (from, king, lastDir, top) => {
    const dirs = king ? g.kingDirs : g.manCapDirs[color];
    const banned = noReverse && lastDir >= 0 ? 3 - lastDir : -1;
    let res = null;
    for (let k = 0; k < dirs.length; k++) {
      const d = dirs[k];
      if (d === banned) continue;
      const ray = rays[from * 4 + d];
      const len = ray.length;
      if (len < 2) continue;
      if (king && flying) {
        let i = 0;
        while (i < len && work[ray[i]] === 0) i++;
        if (i >= len - 1) continue;
        const x = ray[i];
        if (work[x] * color >= 0 || mark[x] === 1) continue;
        let j = i + 1;
        if (work[ray[j]] !== 0) continue;
        const lands = [];
        while (j < len && work[ray[j]] === 0) lands.push(ray[j++]);
        (res || (res = [])).push({ d, x, lands });
      } else {
        const x = ray[0];
        const xc = work[x];
        if (xc * color >= 0 || mark[x] === 1) continue;
        if (work[ray[1]] !== 0) continue;
        if (!king && !menTakeKings && isKing(xc)) {
          if (top) {
            manVsKing = true;
            kingLands.push(ray[1]);
          }
          continue;
        }
        (res || (res = [])).push({ d, x, lands: [ray[1]] });
      }
    }
    return res;
  };

  const extend = (from, king, lastDir, count, kings) => {
    if (++nodes > NODE_LIMIT) return;
    const opts = jumps(from, king, lastDir, count === 0);
    if (count === 0 && opts) lands = opts.reduce((a, o) => a.concat(o.lands), []);
    if (!opts) {
      record(count, kings);
      return;
    }
    for (const o of opts) {
      const xc = work[o.x];
      if (immediate) work[o.x] = 0;
      else mark[o.x] = 1;
      const k2 = isKing(xc) ? kings + 1 : kings;
      for (const L of o.lands) {
        let nk = king;
        let stop = false;
        if (!king && ((L / size) | 0) === promoRow) {
          if (mid === 'king') nk = true;
          else if (mid === 'stop') stop = true;
        }
        if (stop) record(count + 1, k2);
        else extend(L, nk, o.d, count + 1, k2);
      }
      if (immediate) work[o.x] = xc;
      else mark[o.x] = 0;
    }
  };

  extend(sq, isKing(code), -1, 0, 0);
  return { count: best.count, kings: best.kings, manVsKing, lands, kingLands };
}

function kingsTaken(m) {
  let k = 0;
  for (const c of m.captured || []) if (isKing(c)) k++;
  return k;
}

/**
 * Why a tap on `sq` cannot start a move, given the legal `moves` of `state` (side to move).
 * `selected`: the square of the piece picked up before (no hop entered yet) when the tap was
 * meant as its destination, else -1. null when there is nothing to explain (an empty / enemy
 * square while no capture is pending, or a piece that does have legal moves).
 */
export function illegalTapReason(state, moves, sq, selected = -1) {
  const code = state.board[sq];
  const own = code !== 0 && (code > 0 ? 1 : -1) === state.turn;
  const capturing = moves.some((m) => m.captures.length > 0);
  if (!own) {
    if (selected >= 0 && code === 0) {
      // the selected piece was aimed at a capture the rules do not allow
      let raw = null;
      try {
        raw = rawCaptureStats(state, selected);
      } catch (e) {
        raw = null;
      }
      const legalHop = moves.some((m) => m.path[0] === selected && [m.path].concat(m.alts || []).some((p) => p[1] === sq));
      if (raw && !legalHop) {
        if (raw.kingLands.includes(sq)) return 'manCantTakeKing';
        if (raw.lands.includes(sq) && capturing) {
          const rule = getVariant(state.variantId).capture;
          if (rule === 'max') return 'mustCaptureMaxAny';
          if (rule === 'king-first') return 'kingMustCapture';
          return 'capturePriority';
        }
      }
    }
    return capturing ? 'mustCapture' : null;
  }
  if (moves.some((m) => m.path[0] === sq)) return null;
  let raw = null;
  try {
    raw = rawCaptureStats(state, sq);
  } catch (e) {
    raw = null;
  }
  if (!capturing) return raw && raw.manVsKing ? 'manCantTakeKing' : 'noMovesForPiece';
  if (!raw || raw.count === 0) return raw && raw.manVsKing ? 'manCantTakeKing' : 'mustCapture';

  // the piece can capture, but a priority rule gives the move to another one
  const v = getVariant(state.variantId);
  let M = 0;
  for (const m of moves) M = Math.max(M, m.captures.length);
  let K = 0;
  for (const m of moves) if (m.captures.length === M) K = Math.max(K, kingsTaken(m));
  const kingsOnly = moves.every((m) => isKing(m.piece));
  switch (v.capture) {
    case 'max':
      return 'mustCaptureMax';
    case 'max-kings':
      if (raw.count < M) return 'mustCaptureMax';
      return raw.kings < K ? 'mustCaptureKings' : 'capturePriority';
    case 'italian':
      if (raw.count < M) return 'mustCaptureMax';
      if (!isKing(code) && kingsOnly) return 'kingMustCapture';
      return raw.kings < K ? 'mustCaptureKings' : 'capturePriority';
    case 'king-first':
      return !isKing(code) && kingsOnly ? 'kingMustCapture' : 'capturePriority';
    default:
      return 'mustCapture';
  }
}
