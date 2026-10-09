// Public engine API (ARCHITECTURE.md §1).
export { WHITE, BLACK, legalMoves, applyMove, positionResult, materialCount } from './rules.js';
export { VARIANTS, getVariant, GIVEAWAY_RULES } from './variants.js';
export {
  createInitialState,
  cloneState,
  hashState,
  serializeState,
  deserializeState,
} from './state.js';
export {
  stateToString,
  stateFromString,
  squareName,
  parseSquare,
  moveToString,
  parseMove,
  rcToSq,
  sqToRc,
  isPlayableSquare,
} from './notation.js';
export { Game, findMove, movesWithPrefix } from './game.js';
