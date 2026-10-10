// Public engine API (ARCHITECTURE.md §1).
//
// Result (positionResult, Game.result, Game.resign, Game.agreeDraw):
//   { winner: 1 | -1 | 0, reason, detail, limit?, rule? }
//   reason (unchanged, for compatibility): 'no-pieces' | 'no-moves' | 'resign' | 'repetition' |
//     'move-limit' | 'agreement' | 'insufficient'
//   detail (machine-readable, what exactly ended the game):
//     wins:  'no-pieces'     the loser has no pieces left (giveaway: the winner gave all away)
//            'no-moves'      the side to move is blocked (giveaway: that side wins)
//            'resign'        a player resigned
//     draws: 'repetition'    threefold repetition (Game)
//            'agreement'     draw by agreement (Game.agreeDraw)
//            'kings-only'    N moves of each side with kings only, no captures (no man moves);
//                            reason 'move-limit', limit = N
//            'no-progress'   N moves of each side without captures or forward man moves
//                            (Turkish, sideways man moves don't count); reason 'move-limit', limit = N
//            'endgame'       a specific endgame limit: 3+ kings vs a lone king (Russian 15, Pool 13
//                            moves of the strong side), FMJD 16 / 5 moves each, Russian balance rule
//                            5 / 30 / 60 moves each; reason 'move-limit', limit = N
//            'main-diagonal' a lone king holding the main diagonal against 3 pieces, 5 moves
//                            (Russian: strong side's moves, Brazilian: each); reason 'move-limit'
//            'one-each'      Turkish: one piece each (reason 'insufficient')
//            'insufficient'  reserved for other insufficient-material draws (none at present)
//   limit: the limit in moves for the counter-based draws above.
//   rule:  the engine rule id behind a 'move-limit' draw: 'quiet' (no-progress counter), 'r3v1',
//          'p3v1', 'rRoad', 'rBalance', 'f16', 'f5', 'bRoad'.
//
// drawProgress(state) → { detail, movesLeft, limit, rule } | null — the counter-based draw closest
// to ending the game (for a "N moves to a draw" warning); Game#drawProgress() does the same for
// the current position, Game#repetitionCount() tells how often the position has occurred (3 = draw).
export { WHITE, BLACK, legalMoves, applyMove, positionResult, drawProgress, materialCount } from './rules.js';
export { VARIANTS, getVariant, GIVEAWAY_RULES, giveawayRules } from './variants.js';
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
