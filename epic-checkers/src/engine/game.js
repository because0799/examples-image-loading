// Game: state + history + undo + threefold repetition + resign/agreement + JSON persistence.

import { getVariant } from './variants.js';
import { legalMoves, applyMove, positionResult } from './rules.js';
import { createInitialState, cloneState, hashState, serializeState, deserializeState } from './state.js';

function samePath(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Find the move whose path (or one of its equivalent `alts`) equals `path`. */
export function findMove(moves, path) {
  if (!Array.isArray(path)) return null;
  for (const m of moves) if (samePath(m.path, path)) return m;
  for (const m of moves) {
    if (m.alts) for (const a of m.alts) if (samePath(a, path)) return m;
  }
  return null;
}

/**
 * Moves whose path (or an equivalent alt path) starts with `prefix` — handy for tap-by-tap entry.
 * Returns [{ move, path }] where `path` is the matching (possibly alternative) path.
 */
export function movesWithPrefix(moves, prefix) {
  const out = [];
  const starts = (p) => {
    if (p.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) if (p[i] !== prefix[i]) return false;
    return true;
  };
  for (const m of moves) {
    if (starts(m.path)) out.push({ move: m, path: m.path });
    if (m.alts) for (const a of m.alts) if (starts(a)) out.push({ move: m, path: a });
  }
  return out;
}

export class Game {
  /**
   * @param {string} variantId
   * @param {{giveaway?: boolean}} options
   * @param {object} [startState] optional start position (its own options win over `options`)
   */
  constructor(variantId, options = { giveaway: false }, startState) {
    this.variant = getVariant(variantId);
    if (startState) {
      if (startState.variantId !== this.variant.id) throw new Error('Game: start state is for another variant');
      this.startState = cloneState(startState);
    } else {
      this.startState = createInitialState(this.variant.id, options);
    }
    this.options = { giveaway: !!this.startState.options.giveaway };
    this.state = this.startState;
    this.history = [];
    this._hashes = [hashState(this.state)];
    this._manual = null;
    this._moves = null;
    this._result = undefined;
  }

  /** Legal moves of the current state (cached). Empty when the game is over. */
  get moves() {
    if (this._moves === null) this._moves = legalMoves(this.state);
    return this.result ? [] : this._moves;
  }

  get canUndo() {
    return this.history.length > 0 || this._manual !== null;
  }

  get lastMove() {
    return this.history.length ? this.history[this.history.length - 1].move : null;
  }

  /** Position hashes from the start up to the current position (for AI repetition checks). */
  get hashes() {
    return this._hashes.slice();
  }

  get over() {
    return this.result !== null;
  }

  /** null while the game goes on, else { winner: 1|-1|0, reason }. */
  get result() {
    if (this._manual) return this._manual;
    if (this._result !== undefined) return this._result;
    if (this._moves === null) this._moves = legalMoves(this.state);
    let r = positionResult(this.state, this._moves);
    if (!r && this.repetitionCount() >= 3) r = { winner: 0, reason: 'repetition' };
    this._result = r;
    return r;
  }

  /** How many times the current position (incl. side to move) has occurred. */
  repetitionCount() {
    const h = this._hashes[this._hashes.length - 1];
    let n = 0;
    for (let i = this._hashes.length - 1; i >= 0; i--) if (this._hashes[i] === h) n++;
    return n;
  }

  /** Play a Move object (from this.moves) or a path array. Throws on illegal moves. */
  play(moveOrPath) {
    if (this.result) throw new Error('Game is over');
    const path = Array.isArray(moveOrPath) ? moveOrPath : moveOrPath && moveOrPath.path;
    const move = findMove(this._moves, path);
    if (!move) throw new Error(`Illegal move: ${JSON.stringify(path)}`);
    const before = this.state;
    this.state = applyMove(before, move);
    this.history.push({ move, before });
    this._hashes.push(hashState(this.state));
    this._moves = null;
    this._result = undefined;
    return move;
  }

  /** Take back the last move (and clear a resignation/agreement). */
  undo() {
    if (this._manual) {
      this._manual = null;
      this._result = undefined;
      if (!this.history.length) return true;
    }
    if (!this.history.length) return false;
    const h = this.history.pop();
    this._hashes.pop();
    this.state = h.before;
    this._moves = null;
    this._result = undefined;
    return true;
  }

  resign(color) {
    if (this.result) return this.result;
    if (color !== 1 && color !== -1) throw new Error('resign: color must be 1 or -1');
    this._manual = { winner: -color, reason: 'resign' };
    return this._manual;
  }

  agreeDraw() {
    if (this.result) return this.result;
    this._manual = { winner: 0, reason: 'agreement' };
    return this._manual;
  }

  toJSON() {
    return {
      v: 1,
      variantId: this.variant.id,
      options: { giveaway: this.options.giveaway },
      start: serializeState(this.startState),
      moves: this.history.map((h) => h.move.path.slice()),
      manual: this._manual ? { ...this._manual } : null,
    };
  }

  static fromJSON(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('Game.fromJSON: object expected');
    const start = obj.start ? deserializeState(obj.start) : undefined;
    const g = new Game(obj.variantId, obj.options || {}, start);
    for (const p of obj.moves || []) g.play(p);
    if (obj.manual && (obj.manual.reason === 'resign' || obj.manual.reason === 'agreement')) {
      g._manual = { winner: obj.manual.winner, reason: obj.manual.reason };
    }
    return g;
  }
}
