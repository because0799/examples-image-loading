/*
 * Variant definitions: player-facing metadata (read by the UI) + engine rule flags.
 *
 * ============================================================================================
 * RESEARCH SUMMARY (sources + decisions). Sources were consulted in Oct 2026.
 * ============================================================================================
 *
 * RUSSIAN (шашки-64). Sources: Правила вида спорта «шашки» (Минспорт РФ, приказ №201 от
 *   17.03.2022, legalacts.ru); ФШР shashki.ru/variations/draughts64; ru.wikipedia «Русские шашки»;
 *   gambiter.ru, fenix64.com «ничья в шашках»; lidraughts.org/variant/russian.
 *   - Men move 1 diagonal forward, capture forward AND backward. Flying kings.
 *   - Capture mandatory, any sequence may be chosen (no majority rule), but it must be completed.
 *   - «Турецкий удар»: captured pieces are removed after the move; a piece cannot be jumped twice;
 *     captured (still standing) pieces block.
 *   - A king after a jump may land on any free square beyond the captured piece, but if from some
 *     of them the capture can be continued it must land on one of those.
 *   - A man reaching the last row during a capture becomes a king immediately and continues
 *     capturing as a king in the same move (midPromotion: 'king').
 *   - Draws (implemented): threefold repetition (Game); 15 moves (each side) of king moves only,
 *     no captures and no man moves; 3+ kings vs a lone king: the strong side has 15 own moves
 *     from the moment the balance arose; 3 pieces (any) vs a lone king standing on the main road
 *     (a1–h8): the strong side has 5 own moves; both sides having kings with unchanged material
 *     (no capture, no promotion): 2–3 pieces 5 moves, 4–5 pieces 30, 6–7 pieces 60.
 *
 * TURKISH (Dama). Sources: TÜDAF «Türk Daması Kuralları» v3 (turkdamasi.org.tr, 2022) via its
 *   summaries; github.com/ardacagankeser/turkish-draughts (docs/RULES.md implementing TÜDAF, with
 *   its 10 worked rulebook examples and perft numbers, used in our tests); en.wikipedia
 *   «Turkish draughts»; mindsports.nl «Dama».
 *   - All 64 squares; 16 men each on the 2nd and 3rd rows (back row empty); white first.
 *   - Men move 1 square forward or sideways (orthogonally), never backward/diagonally; capture
 *     forward or sideways by jumping an adjacent enemy piece.
 *   - Kings (dama) fly orthogonally; capture from distance, landing on any empty square beyond.
 *   - Captured pieces are removed IMMEDIATELY (removal: 'immediate').
 *   - Maximum capture is mandatory; men and kings count equally (both as capturers and victims);
 *     ties: free choice.
 *   - A king may not turn 180° between two consecutive jumps (noReverse). A U-turn over two
 *     90° turns is allowed.
 *   - Promotion mid-capture (TÜDAF R5): a man reaching the last row by capturing continues
 *     capturing AS A MAN (sideways along the last row) and is promoted when the move ends
 *     (midPromotion: 'man').
 *   - Draw when each side has exactly one piece (TÜDAF «Beraberlik»), threefold repetition,
 *     agreement. No move-count rule exists in TÜDAF; to guarantee termination the app uses a
 *     50-move no-progress rule (no capture and no forward man move by either side).
 *
 * INTERNATIONAL (FMJD 10×10). Sources: FMJD official rules (Annex 1, fmjd.org), lidraughts.org
 *   /variant/standard, UWCCPI 2022 regulations (FMJD rules), en.wikipedia.
 *   - 20 men each, white first; men capture backward; flying kings; Turkish strike.
 *   - Majority capture (count pieces; kings = men); ties: free choice.
 *   - A man passing through the promotion row during a capture stays a man (midPromotion 'man').
 *   - Draws: threefold repetition; 25 successive moves (each side) of kings only without captures
 *     or man moves; 3 kings / 2 kings + man / king + 2 men vs a lone king: 16 moves each;
 *     2 kings / king + man / king vs a lone king: 5 moves each.
 *
 * BRAZILIAN. Sources: CBD Codex (damasciencias.com.br/codex, codexdamas.com.br), lidraughts.org
 *   /variant/brazilian, playstrategy.org. FMJD movement/capture rules on 8×8, 12 men each.
 *   - Draws (CBD Codex for 64 squares): 20 successive king moves (each) without captures or man
 *     moves; 3 pieces incl. a king vs a lone king on the main diagonal: 5 moves each; FMJD-style
 *     16 moves (3 pieces incl. a king vs lone king) and 5 moves (≤2 pieces incl. a king vs lone
 *     king) endgame limits.
 *
 * ENGLISH (checkers). Sources: en.wikipedia «English draughts», playstrategy.org/variant/english,
 *   perft: talkchess.com «perft for 8x8 checkers» (7, 49, 302, 1469, 7361, 36768, 179740…).
 *   - Dark (BLACK) moves first; men move/capture diagonally forward only; kings move and capture
 *     one square in all diagonal directions; capture mandatory, any sequence, must be completed;
 *     a man reaching the king row is crowned and the move ends (midPromotion 'stop').
 *   - Draws: threefold repetition; 40 moves (each side) without progress (no capture, no man move).
 *
 * POOL (American pool checkers). Sources: en.wikipedia «American Pool Checkers» (APCA rules),
 *   playstrategy.org/variant/pool («same rules as Russian draughts, but with no promotion during a
 *   capture chain»), ludoteka.com «Pool checkers».
 *   - Dark (BLACK) moves first; men capture backward; flying kings; capture mandatory with free
 *     choice of sequence, must be completed; Turkish strike; a man reaching the king row during a
 *     capture continues as a man and is crowned only if the move ends there (midPromotion 'man').
 *   - Draws (as Russian on lidraughts/playstrategy): repetition; 15 king-only moves each; 3+ kings
 *     vs a lone king: 15 moves of the strong side.
 *
 * ITALIAN. Sources: en.wikipedia «Italian draughts», Federdama «Elementary course of Italian
 *   draughts», ludoteka.com, playcheckers.io.
 *   - Board mirrored: each player's bottom-RIGHT corner is a dark (playable) square → parity 0.
 *   - White first; men move and capture forward only; MEN CANNOT CAPTURE KINGS; kings short.
 *   - Capture priority: 1) most pieces; 2) capture with a king rather than a man; 3) most kings
 *     captured; 4) the king(s) captured earliest; then free choice.
 *   - Promotion ends the move. Draws: repetition; app rule — 40 moves each without progress
 *     (the FID «40 mosse» count; sources disagree on details).
 *
 * CANADIAN. Sources: en.wikipedia «Canadian checkers», mindsports.nl «Canadian draughts».
 *   International rules on 12×12, 30 men each (5 rows), white first. FMJD draw conventions are
 *   applied (25-move king rule, 16/5-move endgame limits) plus repetition.
 *
 * SPANISH (extra). Sources: ludoteka.com «Spanish draughts», en.wikipedia «Checkers» variant table
 *   (light square on the right, double corner on the left), checkersonline.io, Jocly rules.
 *   - Same geometry as Italian (parity 0). White first; men forward only (move & capture); flying
 *     kings; Turkish strike; majority capture, ties → most kings ("ley de cantidad/calidad");
 *     promotion ends the move (men cannot capture backward). Draw: 20 king-only moves each.
 *
 * CZECH (extra). Sources: ČFD «Pravidla české dámy» (damweb.cz), en.wikipedia «Czech draughts».
 *   - a1 dark, 12 men each on 3 rows, white first; men forward only (move & capture); flying
 *     kings; capture mandatory; if a king can capture, a king must capture; otherwise free
 *     choice; sequences must be completed; Turkish strike; promotion ends the move.
 *   - Draws: repetition, agreement; app rule — 30 king-only moves each without captures.
 *
 * GIVEAWAY (поддавки / antidraughts) option: same move rules; the side that cannot move (no pieces
 *   or blocked) WINS. Material-based endgame draw limits are disabled; the variant's king-move
 *   (no-progress) limit and threefold repetition remain.
 *
 * Not added: Armenian (Tama), Thai — sources found were too inconsistent to implement with
 * confidence.
 * ============================================================================================
 *
 * Engine flags (internal; the UI reads only the metadata fields):
 *   geometry        'diagonal' | 'orthogonal'
 *   darkParity      playable iff (r + c) % 2 === darkParity (when playable === 'dark')
 *   homeRows        rows of men per side; homeOffset = empty rows behind them (Turkish: 1)
 *   manBackCapture  men may capture backward
 *   manSideways     men move/capture sideways (Turkish)
 *   flyingKings     kings move/capture any distance
 *   capture         'free' | 'max' | 'max-kings' | 'italian' | 'king-first'
 *   removal         'end' (Turkish strike) | 'immediate'
 *   noReverse       kings may not turn 180° between consecutive jumps
 *   midPromotion    'king' (promote immediately, continue as king) | 'man' (continue as man,
 *                   promote only if the move ends on the last row) | 'stop' (move ends)
 *   menCaptureKings false in Italian
 *   draw            { quietMoves, quietProgress: 'man' | 'forward', rules: [...], oneEach }
 *                   quietMoves: moves EACH without progress (capture / man move) → draw.
 *   notation        'algebraic' (e3) | 'numeric' (1..N, FMJD style)
 */

import { RULES_TEXT, GIVEAWAY_RULES } from './rules-text.js';

const BASE_DIAGONAL = {
  geometry: 'diagonal',
  darkParity: 1,
  homeOffset: 0,
  manBackCapture: true,
  manSideways: false,
  flyingKings: true,
  capture: 'free',
  removal: 'end',
  noReverse: false,
  midPromotion: 'king',
  menCaptureKings: true,
  notation: 'algebraic',
};

function def(meta, flags) {
  const v = { ...BASE_DIAGONAL, ...flags, ...meta };
  v.rules = RULES_TEXT[v.id];
  if (!v.rules) throw new Error(`Missing rules text for ${v.id}`);
  return Object.freeze(v);
}

export const VARIANTS = [
  def(
    {
      id: 'russian',
      flag: '🇷🇺',
      size: 8,
      playable: 'dark',
      piecesPerSide: 12,
      first: 1,
      name: { ru: 'Русские шашки', en: 'Russian draughts' },
      short: {
        ru: 'Классика: дамка летает, простые бьют назад, превращение прямо во время боя.',
        en: 'The classic: flying kings, men capture backwards, promotion mid-capture.',
      },
      badges: {
        ru: ['8×8', 'Дамка летает', 'Бой назад', 'Любой вариант боя'],
        en: ['8×8', 'Flying kings', 'Backward capture', 'Free capture choice'],
      },
    },
    {
      homeRows: 3,
      capture: 'free',
      midPromotion: 'king',
      draw: { quietMoves: 15, quietProgress: 'man', rules: ['r3v1', 'rRoad', 'rBalance'], oneEach: false },
    },
  ),
  def(
    {
      id: 'turkish',
      flag: '🇹🇷',
      size: 8,
      playable: 'all',
      piecesPerSide: 16,
      first: 1,
      name: { ru: 'Турецкие шашки', en: 'Turkish draughts' },
      short: {
        ru: 'Дама: ходы по прямой вперёд и вбок, 16 шашек, бить максимум — обязательно.',
        en: 'Dama: orthogonal moves forward and sideways, 16 pieces, maximum capture.',
      },
      badges: {
        ru: ['Все 64 поля', 'Ходы по прямой', 'Летающая дама', 'Бить максимум'],
        en: ['All 64 squares', 'Orthogonal', 'Flying kings', 'Max capture'],
      },
    },
    {
      geometry: 'orthogonal',
      homeRows: 2,
      homeOffset: 1,
      manBackCapture: false,
      manSideways: true,
      flyingKings: true,
      capture: 'max',
      removal: 'immediate',
      noReverse: true,
      midPromotion: 'man',
      draw: { quietMoves: 50, quietProgress: 'forward', rules: [], oneEach: true },
    },
  ),
  def(
    {
      id: 'international',
      flag: '🌍',
      size: 10,
      playable: 'dark',
      piecesPerSide: 20,
      first: 1,
      name: { ru: 'Международные шашки', en: 'International draughts' },
      short: {
        ru: 'Стоклеточные 10×10: 20 шашек, летающие дамки, бить максимум.',
        en: '10×10 board, 20 pieces each, flying kings, maximum capture.',
      },
      badges: {
        ru: ['10×10', 'Дамка летает', 'Бить максимум'],
        en: ['10×10', 'Flying kings', 'Max capture'],
      },
    },
    {
      homeRows: 4,
      capture: 'max',
      midPromotion: 'man',
      notation: 'numeric',
      draw: { quietMoves: 25, quietProgress: 'man', rules: ['f16', 'f5'], oneEach: false },
    },
  ),
  def(
    {
      id: 'english',
      flag: '🇬🇧',
      size: 8,
      playable: 'dark',
      piecesPerSide: 12,
      first: -1,
      name: { ru: 'Английские шашки (чекерс)', en: 'English draughts (checkers)' },
      short: {
        ru: 'Чекерс: простые бьют только вперёд, дамка ходит на одно поле. Начинают чёрные.',
        en: 'Checkers: men capture forward only, kings move one square. Dark moves first.',
      },
      badges: {
        ru: ['8×8', 'Короткая дамка', 'Бой только вперёд', 'Начинают чёрные'],
        en: ['8×8', 'Short kings', 'Forward capture', 'Dark starts'],
      },
    },
    {
      homeRows: 3,
      manBackCapture: false,
      flyingKings: false,
      capture: 'free',
      midPromotion: 'stop',
      draw: { quietMoves: 40, quietProgress: 'man', rules: [], oneEach: false },
    },
  ),
  def(
    {
      id: 'brazilian',
      flag: '🇧🇷',
      size: 8,
      playable: 'dark',
      piecesPerSide: 12,
      first: 1,
      name: { ru: 'Бразильские шашки', en: 'Brazilian draughts' },
      short: {
        ru: 'Международные правила на доске 8×8: летающие дамки и обязательный бой максимума.',
        en: 'International rules on an 8×8 board: flying kings and maximum capture.',
      },
      badges: {
        ru: ['8×8', 'Дамка летает', 'Бить максимум'],
        en: ['8×8', 'Flying kings', 'Max capture'],
      },
    },
    {
      homeRows: 3,
      capture: 'max',
      midPromotion: 'man',
      draw: { quietMoves: 20, quietProgress: 'man', rules: ['bRoad', 'f16', 'f5'], oneEach: false },
    },
  ),
  def(
    {
      id: 'pool',
      flag: '🇺🇸',
      size: 8,
      playable: 'dark',
      piecesPerSide: 12,
      first: -1,
      name: { ru: 'Пул-чекерс', en: 'Pool checkers' },
      short: {
        ru: 'Американский пул: летающие дамки, бой назад, любой вариант взятия. Начинают чёрные.',
        en: 'American pool: flying kings, backward captures, any capture sequence. Dark starts.',
      },
      badges: {
        ru: ['8×8', 'Дамка летает', 'Свободный выбор боя'],
        en: ['8×8', 'Flying kings', 'Free capture choice'],
      },
    },
    {
      homeRows: 3,
      capture: 'free',
      midPromotion: 'man',
      draw: { quietMoves: 15, quietProgress: 'man', rules: ['r3v1'], oneEach: false },
    },
  ),
  def(
    {
      id: 'italian',
      flag: '🇮🇹',
      size: 8,
      playable: 'dark',
      piecesPerSide: 12,
      first: 1,
      name: { ru: 'Итальянские шашки', en: 'Italian draughts' },
      short: {
        ru: 'Простая не может бить дамку, строгие приоритеты взятия, короткая дамка.',
        en: 'Men cannot capture kings, strict capture priorities, short kings.',
      },
      badges: {
        ru: ['8×8', 'Короткая дамка', 'Приоритеты боя', 'Простая не бьёт дамку'],
        en: ['8×8', 'Short kings', 'Capture priorities', 'Men can’t take kings'],
      },
    },
    {
      darkParity: 0,
      homeRows: 3,
      manBackCapture: false,
      flyingKings: false,
      capture: 'italian',
      midPromotion: 'stop',
      menCaptureKings: false,
      draw: { quietMoves: 40, quietProgress: 'man', rules: [], oneEach: false },
    },
  ),
  def(
    {
      id: 'canadian',
      flag: '🇨🇦',
      size: 12,
      playable: 'dark',
      piecesPerSide: 30,
      first: 1,
      name: { ru: 'Канадские шашки', en: 'Canadian draughts' },
      short: {
        ru: 'Гигант 12×12: по 30 шашек, международные правила. Эпичные битвы!',
        en: 'The giant 12×12: 30 pieces each, international rules. Epic battles!',
      },
      badges: {
        ru: ['12×12', 'Дамка летает', 'Бить максимум'],
        en: ['12×12', 'Flying kings', 'Max capture'],
      },
    },
    {
      homeRows: 5,
      capture: 'max',
      midPromotion: 'man',
      notation: 'numeric',
      draw: { quietMoves: 25, quietProgress: 'man', rules: ['f16', 'f5'], oneEach: false },
    },
  ),
  def(
    {
      id: 'spanish',
      flag: '🇪🇸',
      size: 8,
      playable: 'dark',
      piecesPerSide: 12,
      first: 1,
      name: { ru: 'Испанские шашки', en: 'Spanish draughts' },
      short: {
        ru: 'Зеркальная доска, летающие дамки, простые бьют только вперёд, бить максимум.',
        en: 'Mirrored board, flying kings, men capture forward only, maximum capture.',
      },
      badges: {
        ru: ['8×8', 'Дамка летает', 'Бить максимум', 'Бой только вперёд'],
        en: ['8×8', 'Flying kings', 'Max capture', 'Forward capture'],
      },
    },
    {
      darkParity: 0,
      homeRows: 3,
      manBackCapture: false,
      capture: 'max-kings',
      midPromotion: 'stop',
      draw: { quietMoves: 20, quietProgress: 'man', rules: [], oneEach: false },
    },
  ),
  def(
    {
      id: 'czech',
      flag: '🇨🇿',
      size: 8,
      playable: 'dark',
      piecesPerSide: 12,
      first: 1,
      name: { ru: 'Чешские шашки', en: 'Czech draughts' },
      short: {
        ru: 'Летающие дамки и главный закон: если может бить дамка — бьёт дамка.',
        en: 'Flying kings and one golden rule: if a king can capture, a king must capture.',
      },
      badges: {
        ru: ['8×8', 'Дамка летает', 'Дамка бьёт первой', 'Бой только вперёд'],
        en: ['8×8', 'Flying kings', 'King captures first', 'Forward capture'],
      },
    },
    {
      homeRows: 3,
      manBackCapture: false,
      capture: 'king-first',
      midPromotion: 'stop',
      draw: { quietMoves: 30, quietProgress: 'man', rules: [], oneEach: false },
    },
  ),
];

const BY_ID = new Map(VARIANTS.map((v) => [v.id, v]));

/** Variant object by id; throws on unknown ids. Accepts a Variant object as well. */
export function getVariant(id) {
  if (id && typeof id === 'object' && BY_ID.get(id.id) === id) return id;
  const v = BY_ID.get(id);
  if (!v) throw new Error(`Unknown variant: ${id}`);
  return v;
}

export { GIVEAWAY_RULES };
