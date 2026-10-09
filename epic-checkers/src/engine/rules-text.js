// Player-facing rules texts for the rules screen: { ru: [paragraph, ...], en: [...] } per variant.
// Keep in sync with the engine flags in variants.js (draw limits etc. are what the app enforces).

export const RULES_TEXT = {
  russian: {
    ru: [
      'Доска 8×8, играют только на тёмных полях. У каждого игрока по 12 шашек на трёх ближайших к нему рядах. Первыми ходят белые.',
      'Простая шашка ходит на одно поле по диагонали вперёд. Бить простая может и вперёд, и назад: она перепрыгивает через соседнюю шашку соперника на свободное поле сразу за ней.',
      'Дамка «летает»: ходит по диагонали на любое число свободных полей вперёд и назад. Бьёт она тоже издалека — через одну шашку соперника на любое свободное поле за ней, если на пути нет других фигур. Но если хотя бы с одного из этих полей можно бить дальше, дамка обязана встать именно на такое поле.',
      'Бить обязательно. Если после взятия можно бить ещё, нужно продолжать бой той же шашкой до конца. Когда вариантов взятия несколько, можно выбрать любой — не обязательно тот, где берётся больше шашек.',
      'Действует правило «турецкого удара»: побитые шашки снимаются с доски только после окончания хода. Через одну и ту же шашку нельзя перепрыгнуть дважды, а ещё не снятые побитые шашки преграждают путь.',
      'Простая, дошедшая до последнего ряда, становится дамкой. Если это произошло во время боя, она сразу же продолжает бить — уже как дамка, в том же ходе.',
      'Побеждает тот, кто взял все шашки соперника или лишил его возможности сделать ход.',
      'Ничья: при троекратном повторении позиции; если 15 ходов подряд обе стороны ходили только дамками без взятий; если три дамки (или больше) против одинокой дамки не взяли её за 15 своих ходов (а против одинокой дамки на большой дороге при трёх фигурах — за 5 ходов); если у обоих есть дамки и соотношение сил не меняется: при 2–3 фигурах на доске — 5 ходов, при 4–5 — 30 ходов, при 6–7 — 60 ходов. Ничью можно и предложить сопернику.',
    ],
    en: [
      'Played on the dark squares of an 8×8 board. Each player starts with 12 men on the three rows nearest to them. White moves first.',
      'A man moves one square diagonally forward. Men capture both forwards and backwards by jumping over an adjacent enemy piece onto the empty square directly behind it.',
      'Kings fly: they move any number of free squares along a diagonal, forwards or backwards, and capture from a distance — over one enemy piece onto any free square beyond it, as long as nothing else is in the way. If from some of those squares the capture can be continued, the king must land on one of them.',
      'Capturing is mandatory. If more captures are possible after a jump, the same piece must keep capturing to the end. When several captures are available you may choose any of them — not necessarily the one that takes the most pieces.',
      'The “Turkish strike” rule applies: captured pieces are removed only after the move is complete. A piece cannot be jumped twice, and captured pieces that are still on the board block the way.',
      'A man that reaches the last row becomes a king. If this happens during a capture, it immediately continues capturing as a king in the same move.',
      'You win by capturing all of your opponent’s pieces or leaving them without a legal move.',
      'Draws: threefold repetition; 15 moves in a row by both sides with kings only and no captures; three or more kings fail to capture a lone king within 15 of their moves (within 5 moves if the lone king holds the main diagonal against three pieces); both sides have kings and the material stays the same for 5 moves (2–3 pieces on the board), 30 moves (4–5 pieces) or 60 moves (6–7 pieces). A draw can also be agreed.',
    ],
  },

  turkish: {
    ru: [
      'Доска 8×8, используются все 64 поля. У каждого игрока по 16 шашек на втором и третьем рядах от себя, первый ряд пуст. Первыми ходят белые.',
      'Шашки ходят не по диагонали, а по прямым линиям. Простая шашка сдвигается на одно поле вперёд, влево или вправо. Назад и по диагонали простые не ходят и не бьют.',
      'Простая бьёт вперёд или вбок: перепрыгивает через соседнюю шашку соперника на свободное поле сразу за ней. Побитая шашка снимается сразу же, поэтому её поле мгновенно освобождается и может открыть путь для следующего удара.',
      'Дама (дамка) ходит по вертикали и горизонтали на любое число свободных полей — вперёд, назад и вбок. Бьёт она издалека: перепрыгивает через шашку соперника и встаёт на любое свободное поле за ней. Во время серии взятий дама не может развернуться на 180° и сразу ударить в обратную сторону по той же линии.',
      'Бить обязательно, причём нужно выбрать серию, которая берёт наибольшее число шашек. Дамы и простые считаются одинаково. Если таких серий несколько, можно выбрать любую. Начатую серию нужно довести до конца.',
      'Простая, дошедшая до последнего ряда, становится дамой. Если она дошла туда во время боя и может бить дальше, то продолжает бить как простая (вбок по последнему ряду) и становится дамой после окончания хода.',
      'Побеждает тот, кто взял все шашки соперника или лишил их возможности ходить. Если у обоих игроков осталось ровно по одной шашке — ничья.',
      'Ничья также при троекратном повторении позиции и по соглашению. В приложении действует правило 50 ходов: если 50 ходов подряд (у каждой стороны) не было ни взятий, ни ходов простыми вперёд — ничья.',
    ],
    en: [
      'Played on all 64 squares of an 8×8 board. Each player has 16 men on their second and third rows; the first row starts empty. White moves first.',
      'Pieces move along straight lines, not diagonals. A man moves one square forward, left or right. Men never move or capture backwards or diagonally.',
      'A man captures forwards or sideways by jumping over an adjacent enemy piece onto the empty square directly behind it. Captured pieces are removed immediately, so the square is freed at once and may open the way for the next jump.',
      'A king (dama) moves any number of free squares along a row or a column — forwards, backwards or sideways. It captures from a distance: it jumps over an enemy piece and lands on any free square beyond it. During a capture sequence a king may not turn 180° and immediately strike back along the same line.',
      'Capturing is mandatory and you must choose the sequence that captures the most pieces. Kings and men count the same. If several sequences capture the maximum, choose any of them. A sequence must be completed.',
      'A man that reaches the last row becomes a king. If it gets there during a capture and can capture further, it continues capturing as a man (sideways along the last row) and is crowned when the move ends.',
      'You win by capturing all enemy pieces or leaving them without a legal move. If each player has exactly one piece left, the game is drawn.',
      'The game is also drawn by threefold repetition or by agreement. The app also applies a 50-move rule: 50 moves by each side without any capture or forward man move is a draw.',
    ],
  },

  international: {
    ru: [
      'Стоклеточная доска 10×10, играют на тёмных полях. У каждого по 20 шашек на четырёх ближних рядах. Первыми ходят белые. Поля обозначаются номерами от 1 до 50.',
      'Простая шашка ходит на одно поле по диагонали вперёд, а бьёт и вперёд, и назад — через соседнюю шашку соперника на свободное поле за ней.',
      'Дамка «летает»: ходит по диагонали на любое число свободных полей и бьёт издалека, вставая на любое свободное поле за побитой шашкой.',
      'Бить обязательно, и действует правило большинства: нужно выбрать серию, которая берёт наибольшее количество шашек (дамки и простые считаются одинаково). Если таких серий несколько — любую. Серию нужно довести до конца.',
      'Побитые шашки снимаются только после окончания хода («турецкий удар»): через одну шашку нельзя перепрыгнуть дважды, а побитые шашки мешают дальнейшему бою.',
      'Простая становится дамкой, только если заканчивает ход на последнем ряду. Если во время боя она прошла через последний ряд и продолжила бить, она остаётся простой.',
      'Побеждает тот, кто взял все шашки соперника или лишил его ходов.',
      'Ничья: троекратное повторение позиции; 25 ходов подряд каждой стороны только дамками без взятий и ходов простыми; три фигуры с дамкой (три дамки, две дамки и простая, дамка и две простые) против одинокой дамки — 16 ходов каждой стороны; две фигуры с дамкой или одна дамка против одинокой дамки — 5 ходов. Ничью можно предложить.',
    ],
    en: [
      'Played on the dark squares of a 10×10 board. Each player has 20 men on the four nearest rows. White moves first. Squares are numbered 1 to 50.',
      'A man moves one square diagonally forward but captures both forwards and backwards, jumping over an adjacent enemy piece onto the empty square behind it.',
      'Kings fly: they move any number of free squares along a diagonal and capture from a distance, landing on any free square beyond the captured piece.',
      'Capturing is mandatory and the majority rule applies: you must play the sequence that captures the most pieces (kings and men count the same). If several sequences tie, choose any. A sequence must be completed.',
      'Captured pieces are removed only after the move (“Turkish strike”): a piece cannot be jumped twice, and captured pieces still block the way.',
      'A man is crowned only if it ends its move on the last row. A man that passes through the last row during a capture and continues capturing remains a man.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition; 25 moves in a row by each side with kings only, without captures or man moves; three pieces including a king (three kings, two kings and a man, a king and two men) against a lone king — 16 moves each; two pieces with a king, or a single king, against a lone king — 5 moves each. A draw can also be agreed.',
    ],
  },

  english: {
    ru: [
      'Доска 8×8, играют на тёмных полях. У каждого по 12 шашек на трёх ближних рядах. Первыми ходят чёрные.',
      'Простая шашка ходит на одно поле по диагонали вперёд и бьёт тоже только вперёд — через соседнюю шашку соперника на свободное поле за ней.',
      'Дамка «короткая»: ходит на одно поле по диагонали в любую сторону и бьёт тоже на ближней дистанции, вперёд и назад.',
      'Бить обязательно. Если вариантов взятия несколько, можно выбрать любой, но начатую серию прыжков нужно довести до конца. Через одну шашку нельзя перепрыгнуть дважды.',
      'Простая, дошедшая до последнего ряда, становится дамкой — и на этом её ход заканчивается, даже если дальше можно было бы бить.',
      'Побеждает тот, кто взял все шашки соперника или запер их так, что ходить нечем.',
      'Ничья: троекратное повторение позиции, соглашение игроков или 40 ходов подряд каждой стороны без взятий и без ходов простыми.',
    ],
    en: [
      'Played on the dark squares of an 8×8 board. Each player has 12 men on the three nearest rows. Dark (Black) moves first.',
      'A man moves one square diagonally forward and also captures only forwards, jumping over an adjacent enemy piece onto the empty square behind it.',
      'Kings are short-range: they move one square diagonally in any direction and capture at close range, forwards and backwards.',
      'Capturing is mandatory. If several captures are possible you may choose any of them, but a multi-jump must be completed. A piece cannot be jumped twice.',
      'A man that reaches the far row is crowned king — and its move ends there, even if it could capture again.',
      'You win by capturing all enemy pieces or blocking them so they cannot move.',
      'Draws: threefold repetition, agreement, or 40 moves by each side without any capture or man move.',
    ],
  },

  brazilian: {
    ru: [
      'Международные правила на обычной доске 8×8: по 12 шашек у каждого на трёх ближних рядах, игра на тёмных полях. Первыми ходят белые.',
      'Простая ходит на одно поле по диагонали вперёд, а бьёт и вперёд, и назад.',
      'Дамка «летает»: ходит и бьёт по диагонали на любое расстояние, после взятия встаёт на любое свободное поле за побитой шашкой.',
      'Бить обязательно, причём нужно взять наибольшее возможное количество шашек (дамки и простые считаются одинаково). При равенстве — любой вариант. Серию нужно довести до конца.',
      'Побитые шашки снимаются после окончания хода («турецкий удар»): дважды через одну шашку прыгать нельзя.',
      'Простая становится дамкой, только если заканчивает ход на последнем ряду. Если в бою она прошла через последний ряд и продолжила бить, она остаётся простой.',
      'Побеждает тот, кто взял все шашки соперника или лишил его ходов.',
      'Ничья: троекратное повторение; 20 ходов подряд каждой стороны только дамками без взятий и ходов простыми; три фигуры с дамкой против одинокой дамки на главной диагонали — 5 ходов, в остальных случаях — 16 ходов; две фигуры с дамкой или одна дамка против одинокой дамки — 5 ходов.',
    ],
    en: [
      'International rules on a regular 8×8 board: 12 men each on the three nearest rows, played on the dark squares. White moves first.',
      'A man moves one square diagonally forward and captures both forwards and backwards.',
      'Kings fly: they move and capture along diagonals at any distance and may land on any free square beyond the captured piece.',
      'Capturing is mandatory and you must capture the maximum possible number of pieces (kings and men count the same). Ties: free choice. A sequence must be completed.',
      'Captured pieces are removed after the move (“Turkish strike”): a piece cannot be jumped twice.',
      'A man is crowned only if it ends its move on the last row; passing through it during a capture does not crown it.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition; 20 moves in a row by each side with kings only, without captures or man moves; three pieces including a king against a lone king on the main diagonal — 5 moves each, otherwise 16 moves; two pieces with a king, or one king, against a lone king — 5 moves each.',
    ],
  },

  pool: {
    ru: [
      'Американский пул-чекерс. Доска 8×8, игра на тёмных полях, по 12 шашек у каждого. Первыми ходят чёрные.',
      'Простая ходит на одно поле по диагонали вперёд, а бьёт и вперёд, и назад.',
      'Дамка «летает»: ходит и бьёт по диагонали на любое расстояние. Если после взятия бой можно продолжить, она должна встать на поле, откуда продолжение возможно.',
      'Бить обязательно, но выбор варианта свободный — не обязательно брать больше всего. Начатую серию нужно довести до конца.',
      'Побитые шашки снимаются после окончания хода: через одну шашку нельзя перепрыгнуть дважды.',
      'Простая становится дамкой, только если заканчивает ход на последнем ряду. Если во время боя она достигла последнего ряда и может бить дальше, она продолжает бой как простая.',
      'Побеждает тот, кто взял все шашки соперника или лишил его ходов.',
      'Ничья: троекратное повторение позиции; 15 ходов подряд только дамками без взятий и ходов простыми; три дамки (и больше) против одинокой дамки не взяли её за 15 ходов; соглашение.',
    ],
    en: [
      'American pool checkers. Played on the dark squares of an 8×8 board with 12 men each. Dark (Black) moves first.',
      'A man moves one square diagonally forward and captures both forwards and backwards.',
      'Kings fly: they move and capture along diagonals at any distance. If the capture can be continued, the king must land on a square from which it continues.',
      'Capturing is mandatory, but you may choose any sequence — not necessarily the longest. A sequence must be completed.',
      'Captured pieces are removed after the move: a piece cannot be jumped twice.',
      'A man is crowned only if it ends its move on the king row. If it reaches that row during a capture and can capture further, it carries on as a man.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition; 15 moves in a row with kings only, without captures or man moves; three or more kings fail to capture a lone king within 15 moves; agreement.',
    ],
  },

  italian: {
    ru: [
      'Доска 8×8 повёрнута «по-итальянски»: в правом нижнем углу у каждого игрока тёмное поле, двойной угол — слева. По 12 шашек на трёх ближних рядах. Первыми ходят белые.',
      'Простая шашка ходит и бьёт только вперёд по диагонали на одно поле. Главная особенность: простая не может бить дамку!',
      'Дамка «короткая»: ходит на одно поле по диагонали в любую сторону и бьёт тоже вплотную — вперёд и назад.',
      'Бить обязательно, и действуют строгие приоритеты: 1) нужно взять как можно больше шашек; 2) при равенстве — бить дамкой, а не простой; 3) затем — взять как можно больше дамок; 4) затем — тот вариант, где дамка соперника берётся раньше. Если и после этого вариантов несколько — выбор свободный.',
      'Начатую серию прыжков нужно довести до конца; через одну шашку нельзя прыгать дважды.',
      'Простая, дошедшая до последнего ряда, становится дамкой, и её ход на этом заканчивается.',
      'Побеждает тот, кто взял все шашки соперника или лишил его ходов.',
      'Ничья: троекратное повторение позиции, соглашение или 40 ходов подряд каждой стороны без взятий и ходов простыми.',
    ],
    en: [
      'The 8×8 board is turned the Italian way: each player has a dark square in their bottom-right corner, so the double corner is on the left. 12 men each on the three nearest rows. White moves first.',
      'Men move and capture only diagonally forward, one square at a time. The key twist: a man can never capture a king!',
      'Kings are short-range: they move one square diagonally in any direction and capture at close range, forwards and backwards.',
      'Capturing is mandatory with strict priorities: 1) capture as many pieces as possible; 2) if equal, capture with a king rather than a man; 3) then capture as many kings as possible; 4) then the sequence that takes a king earliest. Any remaining choice is free.',
      'A multi-jump must be completed; a piece cannot be jumped twice.',
      'A man that reaches the last row becomes a king and its move ends there.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition, agreement, or 40 moves by each side without captures or man moves.',
    ],
  },

  canadian: {
    ru: [
      'Самая большая доска — 12×12, игра на тёмных полях. У каждого по 30 шашек на пяти ближних рядах. Первыми ходят белые. Поля обозначаются номерами от 1 до 72.',
      'Простая ходит на одно поле по диагонали вперёд, а бьёт и вперёд, и назад.',
      'Дамка «летает»: ходит и бьёт по диагонали на любое расстояние, после взятия встаёт на любое свободное поле за побитой шашкой.',
      'Бить обязательно, по правилу большинства: нужно выбрать серию, которая берёт больше всего шашек (дамки и простые считаются одинаково). Серию нужно довести до конца.',
      'Побитые шашки снимаются после окончания хода («турецкий удар»): дважды через одну шашку прыгать нельзя.',
      'Простая становится дамкой, только если заканчивает ход на последнем ряду.',
      'Побеждает тот, кто взял все шашки соперника или лишил его ходов.',
      'Ничья: троекратное повторение; 25 ходов подряд каждой стороны только дамками без взятий и ходов простыми; три фигуры с дамкой против одинокой дамки — 16 ходов; две фигуры с дамкой или одна дамка против одинокой дамки — 5 ходов.',
    ],
    en: [
      'The biggest board: 12×12, played on the dark squares. Each player has 30 men on the five nearest rows. White moves first. Squares are numbered 1 to 72.',
      'A man moves one square diagonally forward and captures both forwards and backwards.',
      'Kings fly: they move and capture along diagonals at any distance and may land on any free square beyond the captured piece.',
      'Capturing is mandatory under the majority rule: play the sequence that captures the most pieces (kings and men count the same). A sequence must be completed.',
      'Captured pieces are removed after the move (“Turkish strike”): a piece cannot be jumped twice.',
      'A man is crowned only if it ends its move on the last row.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition; 25 moves in a row by each side with kings only, without captures or man moves; three pieces including a king against a lone king — 16 moves each; two pieces with a king, or one king, against a lone king — 5 moves each.',
    ],
  },

  spanish: {
    ru: [
      'Доска 8×8 повёрнута зеркально: игровое поле — в правом нижнем углу у каждого игрока, двойной угол — слева. По 12 шашек на трёх ближних рядах. Первыми ходят белые.',
      'Простая шашка ходит и бьёт только вперёд по диагонали.',
      'Дамка «летает»: ходит и бьёт по диагонали на любое расстояние и после взятия может встать на любое свободное поле за побитой шашкой.',
      'Бить обязательно. Сначала действует «закон количества» — нужно взять как можно больше шашек; при равенстве — «закон качества»: взять как можно больше дамок. Серию нужно довести до конца.',
      'Побитые шашки снимаются после окончания хода: через одну шашку нельзя прыгать дважды.',
      'Простая, дошедшая до последнего ряда, становится дамкой; её ход на этом заканчивается.',
      'Побеждает тот, кто взял все шашки соперника или лишил его ходов.',
      'Ничья: троекратное повторение, соглашение или 20 ходов подряд каждой стороны только дамками без взятий и ходов простыми.',
    ],
    en: [
      'The 8×8 board is mirrored: each player has a playing square in their bottom-right corner and the double corner on the left. 12 men each on the three nearest rows. White moves first.',
      'Men move and capture only diagonally forward.',
      'Kings fly: they move and capture along diagonals at any distance and may land on any free square beyond the captured piece.',
      'Capturing is mandatory. First the “law of quantity”: capture as many pieces as possible; on a tie the “law of quality”: capture as many kings as possible. A sequence must be completed.',
      'Captured pieces are removed after the move: a piece cannot be jumped twice.',
      'A man that reaches the last row becomes a king, and its move ends there.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition, agreement, or 20 moves in a row by each side with kings only, without captures or man moves.',
    ],
  },

  czech: {
    ru: [
      'Доска 8×8, игра на тёмных полях. По 12 шашек на трёх ближних рядах. Первыми ходят белые.',
      'Простая шашка ходит и бьёт только вперёд по диагонали.',
      'Дамка «летает»: ходит и бьёт по диагонали на любое расстояние; если бой можно продолжить, она должна встать на поле, откуда продолжение возможно.',
      'Бить обязательно. Главное правило: если бить может дамка, то бить обязана дамка. В остальном вариант взятия выбирается свободно, но начатую серию нужно довести до конца.',
      'Побитые шашки снимаются после окончания хода: через одну шашку нельзя прыгать дважды.',
      'Простая, дошедшая до последнего ряда, становится дамкой; её ход на этом заканчивается.',
      'Побеждает тот, кто взял все шашки соперника или лишил его ходов.',
      'Ничья: троекратное повторение, соглашение или (правило приложения) 30 ходов подряд каждой стороны только дамками без взятий.',
    ],
    en: [
      'Played on the dark squares of an 8×8 board. 12 men each on the three nearest rows. White moves first.',
      'Men move and capture only diagonally forward.',
      'Kings fly: they move and capture along diagonals at any distance; if the capture can be continued, the king must land on a square from which it continues.',
      'Capturing is mandatory. The golden rule: if a king can capture, a king must capture. Otherwise any capture may be chosen, but a sequence must be completed.',
      'Captured pieces are removed after the move: a piece cannot be jumped twice.',
      'A man that reaches the last row becomes a king, and its move ends there.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition, agreement, or (app rule) 30 moves in a row by each side with kings only and no captures.',
    ],
  },
};

/** Texts for the «Поддавки» (giveaway) option, which can be combined with any variant. */
export const GIVEAWAY_RULES = {
  ru: [
    'Поддавки — «шашки наоборот». Все правила ходов и взятий выбранного варианта сохраняются, включая обязательное взятие.',
    'Цель противоположная: выигрывает тот, кто первым отдаст все свои шашки или окажется в положении, когда ходить нечем.',
    'Ничья — при троекратном повторении позиции и по правилу ходов только дамками выбранного варианта.',
  ],
  en: [
    'Giveaway (antidraughts) — draughts in reverse. All move and capture rules of the chosen variant still apply, including mandatory capture.',
    'The goal is reversed: you win by losing all your pieces or by having no legal move.',
    'Draws: threefold repetition and the variant’s king-moves limit.',
  ],
};
