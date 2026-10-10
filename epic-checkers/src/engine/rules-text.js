// Player-facing rules texts for the rules screen: { ru: [paragraph, ...], en: [...] } per variant.
// Keep in sync with the engine flags in variants.js (draw limits etc. are what the app enforces).
// Terminology: «соперник», «дамка» (the Turkish name «дама» only in quotes), impersonal or «ты»;
// English: Black / White. Rules the app adds on its own are marked «правило приложения» / "app rule".
// Every " — " gets a non-breaking space before the dash (nbsp below), so a line never starts with «—».

const RAW_RULES_TEXT = {
  russian: {
    ru: [
      'Доска 8×8, играют только на тёмных полях. У каждого игрока по 12 шашек на трёх ближайших к нему рядах. Первыми ходят белые.',
      'Простая шашка ходит на одно поле по диагонали вперёд. Бить простая может и вперёд, и назад: она перепрыгивает через соседнюю шашку соперника на свободное поле сразу за ней.',
      'Дамка «летает»: ходит по диагонали на любое число свободных полей вперёд и назад. Бьёт она тоже издалека — через одну шашку соперника на любое свободное поле за ней, если на пути нет других шашек. Но если хотя бы с одного из этих полей можно бить дальше, дамка обязана встать именно на такое поле.',
      'Бить обязательно. Если после взятия можно бить ещё, нужно продолжать бой той же шашкой до конца. Когда вариантов взятия несколько, можно выбрать любой — не обязательно тот, где берётся больше шашек.',
      'Действует правило «турецкого удара»: побитые шашки снимаются с доски только после окончания хода. Через одну и ту же шашку нельзя перепрыгнуть дважды, а ещё не снятые побитые шашки преграждают путь.',
      'Простая, дошедшая до последнего ряда, становится дамкой. Если это произошло во время боя, она сразу же продолжает бить — уже как дамка, в том же ходе.',
      'Побеждает тот, кто взял все шашки соперника или лишил его возможности сделать ход.',
      'Ничья: при троекратном повторении позиции, по соглашению, а также если 15 ходов подряд обе стороны ходили только дамками и никто ничего не взял.',
      'Ничейные правила эндшпиля. Три дамки и больше (простые у этой стороны тоже могут быть) против одинокой дамки должны взять её за 15 своих ходов. Если одинокая дамка стоит на большой дороге (a1–h8), а против неё ровно три шашки (простые или дамки), на это даётся только 5 ходов. Если дамки есть у обеих сторон, а соотношение сил не меняется (нет взятий и новых дамок), ничья наступает через 5 ходов при 2–3 шашках на доске, через 30 — при 4–5 и через 60 — при 6–7.',
    ],
    en: [
      'Played on the dark squares of an 8×8 board. Each player starts with 12 men on the three rows nearest to them. White moves first.',
      'A man moves one square diagonally forward. Men capture both forwards and backwards by jumping over an adjacent enemy piece onto the empty square directly behind it.',
      'Kings fly: they move any number of free squares along a diagonal, forwards or backwards, and capture from a distance — over one enemy piece onto any free square beyond it, as long as nothing else is in the way. If from some of those squares the capture can be continued, the king must land on one of them.',
      'Capturing is mandatory. If more captures are possible after a jump, the same piece must keep capturing to the end. When several captures are available you may choose any of them — not necessarily the one that takes the most pieces.',
      'The “Turkish strike” rule applies: captured pieces are removed only after the move is complete. A piece cannot be jumped twice, and captured pieces that are still on the board block the way.',
      'A man that reaches the last row becomes a king. If this happens during a capture, it immediately continues capturing as a king in the same move.',
      'You win by capturing all of your opponent’s pieces or leaving them without a legal move.',
      'Draws: threefold repetition, agreement, or 15 moves in a row by both sides with kings only and no captures.',
      'Endgame draw rules. Three or more kings (the same side may also have men) must capture a lone king within 15 of their own moves; if the lone king stands on the main diagonal (a1–h8) against exactly three pieces (men or kings), within 5 moves. If both sides have kings and the material does not change (no captures, no new kings), the game is drawn after 5 moves with 2–3 pieces on the board, 30 moves with 4–5 and 60 moves with 6–7.',
    ],
  },

  turkish: {
    ru: [
      'Доска 8×8, используются все 64 поля. У каждого игрока по 16 шашек на втором и третьем рядах от себя, первый ряд пуст. Первыми ходят белые.',
      'Шашки ходят не по диагонали, а по прямым линиям. Простая шашка сдвигается на одно поле вперёд, влево или вправо. Назад и по диагонали простые не ходят и не бьют.',
      'Простая бьёт вперёд или вбок: перепрыгивает через соседнюю шашку соперника на свободное поле сразу за ней. Побитая шашка снимается сразу же, поэтому её поле мгновенно освобождается и может открыть путь для следующего удара.',
      'Дамка (по-турецки «дама») ходит по вертикали и горизонтали на любое число свободных полей — вперёд, назад и вбок. Бьёт она издалека: через одну шашку соперника, если путь до неё свободен, и встаёт на любое свободное поле за ней. Во время серии взятий дамка не может развернуться на 180° и сразу ударить в обратную сторону по той же линии.',
      'Бить обязательно, причём нужно выбрать серию, которая берёт наибольшее число шашек. Дамки и простые считаются одинаково. Если таких серий несколько, можно выбрать любую. Начатую серию нужно довести до конца.',
      'Простая, дошедшая до последнего ряда, становится дамкой. Если она дошла туда во время боя и может бить дальше, то продолжает бить как простая (вбок по последнему ряду) и становится дамкой после окончания хода.',
      'Побеждает тот, кто взял все шашки соперника или лишил его возможности сделать ход. Если у каждого игрока осталось ровно по одной шашке (простой или дамке) — сразу ничья, даже если одна из них могла бы взять другую.',
      'Ничья также при троекратном повторении позиции и по соглашению. Правило приложения: если 50 ходов подряд каждой стороны не было ни взятий, ни ходов простыми вперёд — ничья.',
    ],
    en: [
      'Played on all 64 squares of an 8×8 board. Each player has 16 men on their second and third rows; the first row starts empty. White moves first.',
      'Pieces move along straight lines, not diagonals. A man moves one square forward, left or right. Men never move or capture backwards or diagonally.',
      'A man captures forwards or sideways by jumping over an adjacent enemy piece onto the empty square directly behind it. Captured pieces are removed immediately, so the square is freed at once and may open the way for the next jump.',
      'A king (dama in Turkish) moves any number of free squares along a row or a column — forwards, backwards or sideways. It captures from a distance: it jumps over one enemy piece, provided the way to it is clear, and lands on any free square beyond it. During a capture sequence a king may not turn 180° and immediately strike back along the same line.',
      'Capturing is mandatory and you must choose the sequence that captures the most pieces. Kings and men count the same. If several sequences capture the maximum, choose any of them. A sequence must be completed.',
      'A man that reaches the last row becomes a king. If it gets there during a capture and can capture further, it continues capturing as a man (sideways along the last row) and is crowned when the move ends.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move. If each player has exactly one piece left (a man or a king), the game is drawn at once — even if one of them could capture the other.',
      'The game is also drawn by threefold repetition or by agreement. App rule: 50 moves by each side without any capture or forward man move is a draw.',
    ],
  },

  international: {
    ru: [
      'Стоклеточная доска 10×10, играют на тёмных полях. У каждого по 20 шашек на четырёх ближних рядах. Первыми ходят белые. Для записи партий поля нумеруют от 1 до 50 (на самой доске номера не пишут).',
      'Простая шашка ходит на одно поле по диагонали вперёд, а бьёт и вперёд, и назад — через соседнюю шашку соперника на свободное поле за ней.',
      'Дамка «летает»: ходит по диагонали на любое число свободных полей и бьёт издалека, вставая на любое свободное поле за побитой шашкой.',
      'Бить обязательно, и действует правило большинства: нужно выбрать серию, которая берёт наибольшее количество шашек (дамки и простые считаются одинаково). Если таких серий несколько — любую. Серию нужно довести до конца.',
      'Побитые шашки снимаются только после окончания хода («турецкий удар»): через одну шашку нельзя перепрыгнуть дважды, а побитые шашки мешают дальнейшему бою.',
      'Простая становится дамкой, только если заканчивает ход на последнем ряду. Если во время боя она прошла через последний ряд и продолжила бить, она остаётся простой.',
      'Побеждает тот, кто взял все шашки соперника или лишил его возможности сделать ход.',
      'Ничья: при троекратном повторении позиции, по соглашению, а также если 25 ходов подряд каждая сторона ходила только дамками и никто ничего не взял.',
      'Ничейные правила эндшпиля (FMJD): три шашки, среди которых есть дамка (три дамки, две дамки и простая, дамка и две простые), против одинокой дамки — ничья через 16 ходов каждой стороны; две шашки с дамкой или одна дамка против одинокой дамки — через 5 ходов.',
    ],
    en: [
      'Played on the dark squares of a 10×10 board. Each player has 20 men on the four nearest rows. White moves first. In game records the squares are numbered 1 to 50 (the numbers are not marked on the board itself).',
      'A man moves one square diagonally forward but captures both forwards and backwards, jumping over an adjacent enemy piece onto the empty square behind it.',
      'Kings fly: they move any number of free squares along a diagonal and capture from a distance, landing on any free square beyond the captured piece.',
      'Capturing is mandatory and the majority rule applies: you must play the sequence that captures the most pieces (kings and men count the same). If several sequences tie, choose any. A sequence must be completed.',
      'Captured pieces are removed only after the move (“Turkish strike”): a piece cannot be jumped twice, and captured pieces still block the way.',
      'A man is crowned only if it ends its move on the last row. A man that passes through the last row during a capture and continues capturing remains a man.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition, agreement, or 25 moves in a row by each side with kings only and no captures.',
      'Endgame draw rules (FMJD): three pieces including a king (three kings, two kings and a man, a king and two men) against a lone king — a draw after 16 moves each; two pieces with a king, or a single king, against a lone king — after 5 moves each.',
    ],
  },

  english: {
    ru: [
      'Доска 8×8, играют на тёмных полях. У каждого по 12 шашек на трёх ближних рядах. Первыми ходят чёрные.',
      'Простая шашка ходит на одно поле по диагонали вперёд и бьёт тоже только вперёд — через соседнюю шашку соперника на свободное поле за ней.',
      'Дамка «короткая»: ходит на одно поле по диагонали в любую сторону и бьёт только соседнюю шашку — вперёд и назад.',
      'Бить обязательно. Если вариантов взятия несколько, можно выбрать любой, но начатую серию прыжков нужно довести до конца. Через одну шашку нельзя перепрыгнуть дважды.',
      'Простая, дошедшая до последнего ряда, становится дамкой — и на этом её ход заканчивается, даже если дальше можно было бы бить.',
      'Побеждает тот, кто взял все шашки соперника или запер их так, что соперник не может сделать ход.',
      'Ничья: при троекратном повторении позиции, по соглашению или если 40 ходов подряд каждой стороны не было ни взятий, ни ходов простыми.',
    ],
    en: [
      'Played on the dark squares of an 8×8 board. Each player has 12 men on the three nearest rows. Black moves first.',
      'A man moves one square diagonally forward and also captures only forwards, jumping over an adjacent enemy piece onto the empty square behind it.',
      'Kings are short-range: they move one square diagonally in any direction and capture only an adjacent piece, forwards or backwards.',
      'Capturing is mandatory. If several captures are possible you may choose any of them, but a multi-jump must be completed. A piece cannot be jumped twice.',
      'A man that reaches the far row is crowned king — and its move ends there, even if it could capture again.',
      'You win by capturing all enemy pieces or blocking them so that your opponent cannot move.',
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
      'Побеждает тот, кто взял все шашки соперника или лишил его возможности сделать ход.',
      'Ничья: при троекратном повторении позиции, по соглашению, а также если 20 ходов подряд каждая сторона ходила только дамками и никто ничего не взял.',
      'Ничейные правила эндшпиля: три шашки с дамкой против одинокой дамки на главной диагонали (a1–h8) — ничья через 5 ходов каждой стороны, в остальных случаях — через 16 ходов (как в международных шашках); две шашки с дамкой или одна дамка против одинокой дамки — через 5 ходов.',
    ],
    en: [
      'International rules on a regular 8×8 board: 12 men each on the three nearest rows, played on the dark squares. White moves first.',
      'A man moves one square diagonally forward and captures both forwards and backwards.',
      'Kings fly: they move and capture along diagonals at any distance and may land on any free square beyond the captured piece.',
      'Capturing is mandatory and you must capture the maximum possible number of pieces (kings and men count the same). Ties: free choice. A sequence must be completed.',
      'Captured pieces are removed after the move (“Turkish strike”): a piece cannot be jumped twice.',
      'A man is crowned only if it ends its move on the last row; passing through it during a capture does not crown it.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition, agreement, or 20 moves in a row by each side with kings only and no captures.',
      'Endgame draw rules: three pieces including a king against a lone king on the main diagonal (a1–h8) — a draw after 5 moves each, otherwise after 16 moves (as in international draughts); two pieces with a king, or one king, against a lone king — after 5 moves each.',
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
      'Побеждает тот, кто взял все шашки соперника или лишил его возможности сделать ход.',
      'Ничья: при троекратном повторении позиции и по соглашению. Три дамки и больше против одинокой дамки должны взять её за 13 своих ходов, иначе — ничья.',
      'Правило приложения: если 15 ходов подряд каждая сторона ходила только дамками и никто ничего не взял — ничья.',
    ],
    en: [
      'American pool checkers. Played on the dark squares of an 8×8 board with 12 men each. Black moves first.',
      'A man moves one square diagonally forward and captures both forwards and backwards.',
      'Kings fly: they move and capture along diagonals at any distance. If the capture can be continued, the king must land on a square from which it continues.',
      'Capturing is mandatory, but you may choose any sequence — not necessarily the longest. A sequence must be completed.',
      'Captured pieces are removed after the move: a piece cannot be jumped twice.',
      'A man is crowned only if it ends its move on the king row. If it reaches that row during a capture and can capture further, it carries on as a man.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition and agreement. Three or more kings must capture a lone king within 13 of their own moves, otherwise the game is drawn.',
      'App rule: 15 moves in a row by each side with kings only and no captures is a draw.',
    ],
  },

  italian: {
    ru: [
      'Доска 8×8 повёрнута «по-итальянски»: в правом нижнем углу у каждого игрока тёмное поле, двойной угол — слева. По 12 шашек на трёх ближних рядах. Первыми ходят белые.',
      'Простая шашка ходит и бьёт только вперёд по диагонали на одно поле. Главная особенность: простая не может бить дамку!',
      'Дамка «короткая»: ходит на одно поле по диагонали в любую сторону и бьёт только соседнюю шашку — вперёд и назад.',
      'Бить обязательно, и действуют строгие приоритеты: 1) нужно взять как можно больше шашек; 2) при равенстве — бить дамкой, а не простой; 3) затем — взять как можно больше дамок; 4) затем — тот вариант, где дамка соперника берётся раньше. Если и после этого вариантов несколько — выбор свободный.',
      'Начатую серию прыжков нужно довести до конца; через одну шашку нельзя прыгать дважды.',
      'Простая, дошедшая до последнего ряда, становится дамкой, и её ход на этом заканчивается.',
      'Побеждает тот, кто взял все шашки соперника или лишил его возможности сделать ход.',
      'Ничья: при троекратном повторении позиции, по соглашению или (правило приложения) если 40 ходов подряд каждой стороны не было ни взятий, ни ходов простыми.',
    ],
    en: [
      'The 8×8 board is turned the Italian way: each player has a dark square in their bottom-right corner, so the double corner is on the left. 12 men each on the three nearest rows. White moves first.',
      'Men move and capture only diagonally forward, one square at a time. The key twist: a man can never capture a king!',
      'Kings are short-range: they move one square diagonally in any direction and capture only an adjacent piece, forwards or backwards.',
      'Capturing is mandatory with strict priorities: 1) capture as many pieces as possible; 2) if equal, capture with a king rather than a man; 3) then capture as many kings as possible; 4) then the sequence that takes a king earliest. Any remaining choice is free.',
      'A multi-jump must be completed; a piece cannot be jumped twice.',
      'A man that reaches the last row becomes a king and its move ends there.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition, agreement, or (app rule) 40 moves by each side without captures or man moves.',
    ],
  },

  canadian: {
    ru: [
      'Самая большая доска — 12×12, игра на тёмных полях. У каждого по 30 шашек на пяти ближних рядах. Первыми ходят белые. Для записи партий поля нумеруют от 1 до 72 (на самой доске номера не пишут).',
      'Простая ходит на одно поле по диагонали вперёд, а бьёт и вперёд, и назад.',
      'Дамка «летает»: ходит и бьёт по диагонали на любое расстояние, после взятия встаёт на любое свободное поле за побитой шашкой.',
      'Бить обязательно, по правилу большинства: нужно выбрать серию, которая берёт больше всего шашек (дамки и простые считаются одинаково). Серию нужно довести до конца.',
      'Побитые шашки снимаются после окончания хода («турецкий удар»): дважды через одну шашку прыгать нельзя.',
      'Простая становится дамкой, только если заканчивает ход на последнем ряду.',
      'Побеждает тот, кто взял все шашки соперника или лишил его возможности сделать ход.',
      'Ничья: при троекратном повторении позиции, по соглашению, а также если 25 ходов подряд каждая сторона ходила только дамками и никто ничего не взял.',
      'Ничейные правила эндшпиля (как в международных шашках): три шашки с дамкой против одинокой дамки — ничья через 16 ходов каждой стороны; две шашки с дамкой или одна дамка против одинокой дамки — через 5 ходов.',
    ],
    en: [
      'The biggest board: 12×12, played on the dark squares. Each player has 30 men on the five nearest rows. White moves first. In game records the squares are numbered 1 to 72 (the numbers are not marked on the board itself).',
      'A man moves one square diagonally forward and captures both forwards and backwards.',
      'Kings fly: they move and capture along diagonals at any distance and may land on any free square beyond the captured piece.',
      'Capturing is mandatory under the majority rule: play the sequence that captures the most pieces (kings and men count the same). A sequence must be completed.',
      'Captured pieces are removed after the move (“Turkish strike”): a piece cannot be jumped twice.',
      'A man is crowned only if it ends its move on the last row.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition, agreement, or 25 moves in a row by each side with kings only and no captures.',
      'Endgame draw rules (as in international draughts): three pieces including a king against a lone king — a draw after 16 moves each; two pieces with a king, or one king, against a lone king — after 5 moves each.',
    ],
  },

  spanish: {
    ru: [
      'Доска 8×8 повёрнута зеркально: у каждого игрока игровое поле — в правом нижнем углу, а двойной угол — слева. По 12 шашек на трёх ближних рядах. Первыми ходят белые.',
      'По традиции в испанские шашки играют на светлых полях. В приложении игровые поля тёмные, как и в остальных вариантах; их расположение и правила игры от этого не меняются.',
      'Простая шашка ходит и бьёт только вперёд по диагонали.',
      'Дамка «летает»: ходит и бьёт по диагонали на любое расстояние и после взятия может встать на любое свободное поле за побитой шашкой.',
      'Бить обязательно. Сначала действует «закон количества» — нужно взять как можно больше шашек; при равенстве — «закон качества»: взять как можно больше дамок. Серию нужно довести до конца.',
      'Побитые шашки снимаются после окончания хода: через одну шашку нельзя прыгать дважды.',
      'Простая, дошедшая до последнего ряда, становится дамкой; её ход на этом заканчивается.',
      'Побеждает тот, кто взял все шашки соперника или лишил его возможности сделать ход.',
      'Ничья: при троекратном повторении позиции, по соглашению или (правило приложения) если 20 ходов подряд каждая сторона ходила только дамками и никто ничего не взял.',
    ],
    en: [
      'The 8×8 board is mirrored: each player has a playing square in their bottom-right corner and the double corner on the left. 12 men each on the three nearest rows. White moves first.',
      'Traditionally Spanish draughts is played on the light squares. In the app the playing squares are dark, as in the other variants; their layout and the rules stay exactly the same.',
      'Men move and capture only diagonally forward.',
      'Kings fly: they move and capture along diagonals at any distance and may land on any free square beyond the captured piece.',
      'Capturing is mandatory. First the “law of quantity”: capture as many pieces as possible; on a tie the “law of quality”: capture as many kings as possible. A sequence must be completed.',
      'Captured pieces are removed after the move: a piece cannot be jumped twice.',
      'A man that reaches the last row becomes a king, and its move ends there.',
      'You win by capturing all enemy pieces or leaving your opponent without a legal move.',
      'Draws: threefold repetition, agreement, or (app rule) 20 moves in a row by each side with kings only and no captures.',
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
      'Побеждает тот, кто взял все шашки соперника или лишил его возможности сделать ход.',
      'Ничья: при троекратном повторении позиции, по соглашению или (правило приложения) если 30 ходов подряд каждая сторона ходила только дамками и никто ничего не взял.',
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

/** Non-breaking space before every spaced em dash, so a line never starts with «—». */
export function nbsp(text) {
  return String(text).replace(/ —/g, ' —');
}

function nbspAll(obj) {
  const out = {};
  for (const [lang, list] of Object.entries(obj)) out[lang] = Object.freeze(list.map(nbsp));
  return Object.freeze(out);
}

export const RULES_TEXT = Object.freeze(
  Object.fromEntries(Object.entries(RAW_RULES_TEXT).map(([id, t]) => [id, nbspAll(t)])),
);

/** Generic texts for the «Поддавки» (giveaway) option, which can be combined with any variant. */
export const GIVEAWAY_RULES = nbspAll({
  ru: [
    'Поддавки — «шашки наоборот». Все правила ходов и взятий выбранного варианта сохраняются, в том числе обязательное взятие.',
    'Цель обратная: побеждает тот, кто первым отдаст все свои шашки или окажется без ходов.',
    'Ничья — при троекратном повторении позиции, по соглашению и по правилу «долго без продвижения» выбранного варианта (например, в русских шашках — 15 ходов подряд только дамками без взятий, в турецких — 50 ходов без взятий и ходов простыми вперёд).',
    'Ничейные правила эндшпиля (например, «по одной шашке у каждого» в турецких или «три дамки против одинокой» в русских) в поддавках не действуют.',
  ],
  en: [
    'Giveaway (antidraughts) is draughts in reverse. All move and capture rules of the chosen variant still apply, including mandatory capture.',
    'The goal is reversed: you win by being the first to lose all your pieces or to have no legal move.',
    'Draws: threefold repetition, agreement, and the chosen variant’s no-progress rule (for example, 15 moves in a row with kings only and no captures in Russian draughts, 50 moves without captures or forward man moves in Turkish).',
    'Endgame draw rules (for example, “one piece each” in Turkish or “three kings against a lone king” in Russian) do not apply in giveaway.',
  ],
});

// Phrases for the endgame draw rules (rule ids of variants.js draw.rules), used by giveawayText.
const EG_PHRASES = {
  r3v1: { ru: 'три дамки против одинокой — 15 ходов', en: 'three kings against a lone king — 15 moves' },
  p3v1: { ru: 'три дамки против одинокой — 13 ходов', en: 'three kings against a lone king — 13 moves' },
  rRoad: { ru: 'одинокая дамка на большой дороге — 5 ходов', en: 'a lone king on the main diagonal — 5 moves' },
  rBalance: { ru: 'равенство сил при дамках у обеих сторон', en: 'unchanged material with kings on both sides' },
  bRoad: { ru: 'одинокая дамка на главной диагонали — 5 ходов', en: 'a lone king on the main diagonal — 5 moves' },
  f16: { ru: '16 ходов против одинокой дамки', en: '16 moves against a lone king' },
  f5: { ru: '5 ходов против одинокой дамки', en: '5 moves against a lone king' },
  f16f5: { ru: '16 и 5 ходов против одинокой дамки', en: '16 and 5 moves against a lone king' },
};

/**
 * Giveaway texts for one variant, built from its draw settings ({ quietMoves, quietProgress,
 * rules, oneEach }) so they always say what the engine does: the no-progress rule stays, the
 * endgame draw rules and the Turkish one-piece-each draw are switched off.
 */
export function giveawayText(draw) {
  const n = draw.quietMoves;
  const forward = draw.quietProgress === 'forward';
  const ru = [GIVEAWAY_RULES.ru[0], GIVEAWAY_RULES.ru[1]];
  const en = [GIVEAWAY_RULES.en[0], GIVEAWAY_RULES.en[1]];
  const what = forward ? `${n} ходов подряд без взятий и ходов простыми вперёд` : `${n} ходов подряд только дамками без взятий`;
  ru.push(`Ничья — при троекратном повторении позиции, по соглашению и по правилу${draw.appRule ? ' приложения' : ''} «${what}».`);
  const whatEn = forward ? `${n} moves by each side without captures or forward man moves` : `${n} moves in a row by each side with kings only and no captures`;
  en.push(`Draws: threefold repetition, agreement, and the ${draw.appRule ? 'app’s ' : ''}rule of ${whatEn}.`);
  let ids = draw.rules.slice();
  if (ids.includes('f16') && ids.includes('f5')) ids = ids.filter((id) => id !== 'f5').map((id) => (id === 'f16' ? 'f16f5' : id));
  if (draw.oneEach) {
    ru.push('Правило «по одной шашке у каждого — ничья» в поддавках не действует: игра идёт, пока кто-то не избавится от всех шашек или не останется без ходов.');
    en.push('The “one piece each is a draw” rule does not apply in giveaway: the game goes on until someone gets rid of all their pieces or runs out of moves.');
  } else if (ids.length) {
    ru.push(`Ничейные правила эндшпиля в поддавках не действуют: ${ids.map((id) => EG_PHRASES[id].ru).join(', ')}.`);
    en.push(`Endgame draw rules do not apply in giveaway: ${ids.map((id) => EG_PHRASES[id].en).join(', ')}.`);
  }
  return nbspAll({ ru, en });
}
