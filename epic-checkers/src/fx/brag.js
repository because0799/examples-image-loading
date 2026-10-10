// Bragging / taunt texts for EPIC ШАШКИ (ARCHITECTURE.md §4).
//
//   bragLine(event, ctx, lang)  -> string   a fresh line for a game event (no immediate repeats)
//   attackName(ctx, lang)       -> string   anime special-move name («Багровый Драконий Прыжок»)
//   kanjiFor(event, lang?)      -> string   onomatopoeia / kanji for an event ('斬!', '覚醒', ...)
//
// Events: 'capture', 'combo' (scaled by ctx.n), 'promote', 'ultimate', 'kingslayer', 'comeback',
// 'win', 'flawless', 'lose', 'draw', 'taunt' (opponent → player), 'brag' (player boasts), 'start',
// 'dead' («Ты уже мёртв.»), 'nani', 'ko', 'streak' (capturing turns in a row, ctx.n), 'rage' (the
// ЯРОСТЬ meter just filled up: the next capture is the УЛЬТА). Unknown events fall back to 'brag'.
// ctx (all optional): { n: hits in the combo, name: speaker, opp: opponent name, side: 1 | -1,
// king: boolean, ultimate: boolean, random: () => [0, 1) for deterministic tests }.
// Placeholders in lines: {n} {name} {opp}, and the Russian words that agree with {n}: {pieces}
// («шашка/шашки/шашек»), {persons} («персону/персоны/персон»), {turns} («ход/хода/ходов»). Every
// line is checked for n = 1..12 by tests/fx/brag.test.js (no «за один прыжок» for multi-jump moves).

const R = Math.random;

/** Russian plural form: plural(5, ['шашка', 'шашки', 'шашек']) → 'шашек'. */
export function pluralRu(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

// =================================================================================== lines
const LINES = {
  ru: {
    capture: [
      'Слишком медленно!',
      'Ты даже не заметил удара.',
      'Это была лишь разминка.',
      'Минус один. Следующий!',
      'Твоя защита — из бумаги.',
      'Я вижу все твои ходы.',
      'Без шансов!',
      'Ты открылся. Ошибка.',
      'Минус один. Считать умеешь?',
      'Моя доска — мои правила.',
      'Это даже не половина моей силы!',
      'Как предсказуемо…',
      'Сдавайся, пока не поздно.',
      'Одним ударом!',
      'Не та клетка, не то время.',
      'Хрусть! Кто следующий?',
      'Ничего личного. Просто шашки.',
      'Слабое звено — устранено.',
    ],
    combo: [
      'Одним ходом — минус {n} {pieces}!',
      'Комбо ×{n}! Кто-нибудь, остановите меня!',
      'Это называется — искусство!',
      'Цепная реакция!',
      'Они даже не поняли, что случилось.',
      'Один ход — и {n} {pieces} в пыль!',
      'Выстроились в очередь? Как мило!',
      'Танец продолжается!',
      'Моя серия только началась.',
      'Видел? Это была техника!',
      'Не моргай — пропустишь!',
      'Красиво зашло, правда?',
      'Прыг-прыг — и тишина.',
      'Комбо, достойное легенды!',
      'Вот это урожай!',
      'Сколько вас там ещё?',
    ],
    comboBig: [
      'Это уже не игра. Это зачистка.',
      'Резня на {n} {persons}!',
      'Остановите это избиение!',
      'КОМБО ×{n}! Абсолютное превосходство!',
      'Летописи запомнят этот ход.',
      '{n} {pieces} — и ни единой царапины!',
      'Такого комбо доска ещё не видела!',
      'Мой предел? У меня его нет!',
    ],
    promote: [
      'Я пробудился!',
      'Теперь я — дамка. Бойтесь.',
      'Корона мне к лицу.',
      'Новая сила течёт во мне!',
      'Встречайте короля доски!',
      'Это моя финальная форма!',
      'Теперь я летаю.',
      'Уровень повышен!',
      'На колени перед короной!',
      'Дальний край доски — мой трон.',
      'Прошёл весь путь — и стал легендой.',
      'Эволюция завершена.',
      'Сила дамки — пробуждена!',
      'И это ещё не последняя форма…',
      'Корона ждала меня.',
      'Трепещите!',
    ],
    ultimate: [
      'Ярость на пределе!',
      'Почувствуй мою истинную силу!',
      'Это конец!',
      'Финальный удар!',
      'Мой предел — сломан!',
      'Получай всё, что накопилось!',
      'Сила, превосходящая небеса!',
      'Готовься к забвению!',
      'Тайная техника — разблокирована!',
      'Не моргай!',
      'Сто процентов ярости!',
      'Сейчас будет больно.',
    ],
    kingslayer: [
      'Корона пала!',
      'Короли тоже падают.',
      'Твоя дамка — моя добыча.',
      'Трон свободен!',
      'Прощай, Ваше Величество.',
      'Сначала королей!',
      'Корона треснула!',
      'Без короны ты никто.',
    ],
    comeback: [
      'Списали меня? Зря!',
      'Я поднимаюсь снова!',
      'Камбэк начинается сейчас!',
      'Рано праздновал!',
      'Последний герой не сдаётся!',
      'Из пепла — к победе!',
      'Думал, это конец? Это только начало!',
      'Удача? Нет. Характер!',
      'Сюжетный поворот!',
      'Герои встают даже после падения.',
      'Счёт ещё не окончательный!',
    ],
    win: [
      'Победа была предрешена.',
      'Это было слишком просто.',
      'Запишите в историю!',
      'Непобедим!',
      'Ещё один пал перед моей мощью.',
      'Так сражаются легенды.',
      'Доска принадлежит мне.',
      'Возвращайся, когда подрастёшь.',
      'Я даже не вспотел.',
      'Ни шагу назад — только вперёд!',
      'Вот что значит настоящая сила!',
      'Корона остаётся у чемпиона.',
      'GG. Без шансов.',
      'Мой путь чемпиона продолжается!',
      'Знай своё место!',
      'Ты сражался достойно… почти.',
    ],
    flawless: [
      'БЕЗУПРЕЧНО! Ни одной потери!',
      'Ни царапины!',
      'Идеальная победа.',
      'Ты даже не коснулся меня.',
      'Чистая работа. Ноль потерь.',
      'Абсолютное превосходство!',
      'Это был не бой — это был урок.',
      'У совершенства нет слабостей.',
      'Все мои шашки на месте. А твои?',
      'Сухая победа. Как и планировал.',
      'Безупречно. Иначе не умею.',
    ],
    lose: [
      'Я вернусь сильнее…',
      'Это ещё не конец.',
      'Запомни этот день. Я вернусь.',
      'Ты выиграл битву, но не войну.',
      'В следующий раз всё будет иначе.',
      'Я тренировался недостаточно…',
      'Поражение — лишь начало моего пути.',
      'Это была… разминка.',
      'Ещё увидимся. Реванш!',
      'Моя сила ещё не пробудилась…',
      'Даже легенды иногда падают.',
      'Я учусь на ошибках. Бойся следующей встречи.',
      'Признаю. Но реванш за мной!',
      'Сегодня ты. Завтра — я.',
      'Мой дух не сломлен!',
    ],
    draw: [
      'Равные силы…',
      'Достойный соперник. Уважаю.',
      'Мы ещё встретимся.',
      'Ни один не уступил.',
      'Этот бой войдёт в легенды.',
      'Баланс сил сохранён.',
      'Пусть решит следующая битва.',
      'Достойно. Очень достойно.',
      'Клинки скрестились — и замерли.',
      'Мир… на этот раз.',
    ],
    taunt: [
      'И это всё, на что ты способен?',
      'Ты ходишь как новичок.',
      'Я ждал большего.',
      'Ещё одна ошибка — и конец.',
      'Твои шашки плачут.',
      'Ты уже проиграл. Просто ещё не понял.',
      'Скучно…',
      'Подумай ещё. Хотя нет — не поможет.',
      'Хочешь, дам фору?',
      'Ты играешь в мою игру.',
      'Ловушка захлопнулась.',
      'Даже мой ученик сыграл бы лучше.',
      'Ты слишком предсказуем.',
      'Беги, пока есть шашки!',
      'Твоя ярость пуста.',
      'Я вижу твой страх.',
    ],
    brag: [
      'Смотри и учись!',
      'Вот как надо!',
      'Гений за работой.',
      'Мой ход — твоя проблема.',
      'Тактика уровня бог.',
      'Чувствуешь давление?',
      'Это было красиво.',
      'Я в ударе!',
      'Кто тут главный?',
      'Всё идёт по плану.',
      'Ярость кипит!',
      'Сила растёт!',
      'Это мой путь ниндзя!',
      'Меня не остановить!',
      'Пора заканчивать!',
    ],
    start: [
      'Да начнётся битва!',
      'Покажи, на что способен!',
      'Сегодня решится всё.',
      'Доска ждёт героя.',
      'Бой начинается!',
      'Готовься к поражению!',
      'Пусть победит сильнейший!',
      'Только один уйдёт победителем.',
      'Время легенд!',
      'В бой!',
    ],
    streak: [
      'Серия ×{n}! Кто следующий?',
      '{n} {turns} подряд со взятием!',
      'Серия ×{n}. Остановить меня некому.',
      'Я только разогреваюсь. Серия ×{n}!',
      'Удар за ударом — серия ×{n}!',
      'Серия ×{n}! Твои шашки тают.',
    ],
    rage: [
      'Ярость на пределе. Следующий удар — УЛЬТА!',
      'ЯРОСТЬ 100%! Сейчас начнётся…',
      'Чувствуешь? Это моя ярость.',
      'Сила переполняет меня!',
      'Предел достигнут. Готовься.',
      'Ярость кипит. Кто первый под удар?',
    ],
    dead: ['Ты уже мёртв.', 'Ты уже мёртв. Просто ещё не знаешь.', 'Всё уже кончено.', 'Ты проиграл ещё до удара.'],
    nani: ['НАНИ?!', 'ЧТО?!', 'КАК?!'],
    ko: ['НОКАУТ!', 'К.О.!', 'ЗАНАВЕС!'],
  },
  en: {
    capture: [
      'Too slow!',
      "You didn't even see it coming.",
      'That was just my warm-up.',
      'One down. Next!',
      'Your defense is made of paper.',
      'I can see all your moves.',
      'Not a chance!',
      'You left an opening. Mistake.',
      'Minus one. Can you count?',
      'My board, my rules.',
      "That's not even half my power!",
      'So predictable…',
      'Surrender while you still can.',
      'One strike!',
      'Wrong square, wrong time.',
      'Crunch! Who is next?',
      'Nothing personal. Just checkers.',
      'Weak link — eliminated.',
    ],
    combo: [
      '{n} {pieces} in a single move!',
      'Combo ×{n}! Somebody stop me!',
      "That's what I call art!",
      'Chain reaction!',
      "They didn't even know what hit them.",
      'One move — {n} down.',
      'Did they line up for me? How kind!',
      'The dance goes on!',
      'My streak has only just begun.',
      'Did you see that? That was technique!',
      "Don't blink — you'll miss it!",
      "Smooth, wasn't it?",
      'Hop, hop — silence.',
      'A combo worthy of legend!',
      'What a harvest!',
      'How many of you are left?',
    ],
    comboBig: [
      "This isn't a game anymore. It's a purge.",
      'A {n}-hit massacre!',
      'Somebody stop this beating!',
      'Combo ×{n}! Absolute domination!',
      'History will remember this move.',
      '{n} {pieces} — and not a scratch!',
      'This board has never seen such a combo!',
      'My limit? I have none!',
    ],
    promote: [
      'I have awakened!',
      "Now I'm a king. Fear me.",
      'The crown suits me.',
      'New power flows through me!',
      'Behold the king of the board!',
      'This is my final form!',
      'Now I can fly.',
      'Level up!',
      'Kneel before the crown!',
      'The far rank is my throne.',
      'Walked the whole board — became a legend.',
      'Evolution complete.',
      'King power — awakened!',
      "And this isn't even my final form…",
      'The crown was waiting for me.',
      'Tremble!',
    ],
    ultimate: [
      'Rage at its peak!',
      'Feel my true power!',
      'This is the end!',
      'Final strike!',
      'My limits — broken!',
      "Take everything I've stored up!",
      'Power beyond the heavens!',
      'Prepare for oblivion!',
      'Secret technique — unlocked!',
      "Don't blink!",
      'One hundred percent rage!',
      'This is going to hurt.',
    ],
    kingslayer: [
      'The crown has fallen!',
      'Kings fall too.',
      'Your king is my prey.',
      'The throne is empty!',
      'Farewell, Your Majesty.',
      'Kings first!',
      'The crown is cracked!',
      "Without a crown you're nothing.",
    ],
    comeback: [
      'Wrote me off? Big mistake!',
      'I rise again!',
      'The comeback starts now!',
      'Celebrated too early!',
      'The last hero never gives up!',
      'From the ashes — to victory!',
      'You thought this was the end? It is only the beginning!',
      'Luck? No. Willpower!',
      'Plot twist!',
      'Heroes stand up even after they fall.',
      "The score isn't final yet!",
    ],
    win: [
      'Victory was destined.',
      'That was too easy.',
      'Write it in the history books!',
      'Undefeated!',
      'Another one falls before my power.',
      'This is how legends fight.',
      'The board belongs to me.',
      "Come back when you've grown up.",
      "Didn't even break a sweat.",
      'No step back — only forward!',
      "That's what true power looks like!",
      'The crown stays with the champion.',
      'GG. No chance.',
      "My champion's road continues!",
      'Know your place!',
      'You fought well… almost.',
    ],
    flawless: [
      'FLAWLESS! Not a single loss!',
      'Not a scratch!',
      'A perfect victory.',
      'You never even touched me.',
      'Clean work. Zero losses.',
      'Absolute superiority!',
      "That wasn't a fight — it was a lesson.",
      'Perfection has no weaknesses.',
      'All my pieces are still here. And yours?',
      'A clean sweep. Just as planned.',
      "Flawless. I don't know any other way.",
    ],
    lose: [
      "I'll come back stronger…",
      "This isn't over.",
      'Remember this day. I will return.',
      'You won the battle, not the war.',
      "Next time it'll be different.",
      "I didn't train enough…",
      'Defeat is just the start of my journey.',
      'That was… a warm-up.',
      'See you again. Rematch!',
      "My power hasn't awakened yet…",
      'Even legends fall sometimes.',
      'I learn from my mistakes. Fear our next meeting.',
      'I admit it. But the rematch is mine!',
      'Today you. Tomorrow me.',
      'My spirit is not broken!',
    ],
    draw: [
      'Equal power…',
      'A draw. A worthy rival.',
      "We'll meet again.",
      'Neither one gave way.',
      'This duel will become legend.',
      'The balance of power holds.',
      'Let the next battle decide.',
      'Worthy. Very worthy.',
      'Blades crossed — and froze.',
      'Peace… for now.',
    ],
    taunt: [
      "Is that all you've got?",
      'You move like a beginner.',
      'I expected more.',
      "One more mistake and it's over.",
      'Your pieces are crying.',
      "You've already lost. You just don't know it yet.",
      'Boring…',
      "Think again. Actually, don't — it won't help.",
      'Want a head start?',
      "You're playing my game.",
      'The trap has closed.',
      'Even my apprentice would play better.',
      "You're too predictable.",
      'Run while you still have pieces!',
      'Your rage is empty.',
      'I can see your fear.',
    ],
    brag: [
      'Watch and learn!',
      "That's how it's done!",
      'Genius at work.',
      'My move — your problem.',
      'God-tier tactics.',
      'Feel the pressure?',
      'That was beautiful.',
      "I'm on fire!",
      "Who's the boss here?",
      'All according to plan.',
      'Rage is boiling!',
      'Power rising!',
      'This is my ninja way!',
      'Unstoppable!',
      'Time to finish this!',
    ],
    start: [
      'Let the battle begin!',
      "Show me what you've got!",
      'Today everything will be decided.',
      'The board awaits a hero.',
      'The fight begins!',
      'Prepare to lose!',
      'May the strongest win!',
      'Only one walks away a winner.',
      'The time of legends!',
      'To battle!',
    ],
    streak: [
      'Streak ×{n}! Who is next?',
      '{n} capturing moves in a row!',
      'Streak ×{n}. Nobody can stop me.',
      "I'm just warming up. Streak ×{n}!",
      'Strike after strike — streak ×{n}!',
      'Streak ×{n}! Your pieces are melting.',
    ],
    rage: [
      'Rage at its peak. My next strike is the ULTIMATE!',
      'RAGE 100%! Here it comes…',
      'Do you feel it? That is my rage.',
      'Power overflows me!',
      'Limit reached. Brace yourself.',
      "Rage is boiling. Who's first?",
    ],
    dead: ['You are already dead.', "You're already dead. You just don't know it.", "It's already over.", 'You lost before the strike.'],
    nani: ['NANI?!', 'WHAT?!', 'HOW?!'],
    ko: ['K.O.!', 'KNOCKOUT!', 'FINISH!'],
  },
};

// =================================================================================== picking
const recent = new Map(); // `${lang}|${bank}` -> last few picks (no immediate repeats)

function pick(list, key, rnd = R) {
  if (!list || !list.length) return '';
  if (list.length === 1) return list[0];
  let hist = recent.get(key);
  if (!hist) recent.set(key, (hist = []));
  const memory = Math.min(list.length - 1, Math.max(1, Math.floor(list.length / 2)));
  let i = Math.floor(rnd() * list.length) % list.length;
  for (let tries = 0; tries < list.length && hist.includes(i); tries++) i = (i + 1) % list.length;
  hist.push(i);
  while (hist.length > memory) hist.shift();
  return list[i];
}

function fill(line, ctx, lang) {
  const n = ctx.n != null ? ctx.n : 2;
  const en = lang === 'en';
  const pieces = en ? (n === 1 ? 'piece' : 'pieces') : pluralRu(n, ['шашка', 'шашки', 'шашек']);
  const persons = en ? (n === 1 ? 'guest' : 'guests') : pluralRu(n, ['персону', 'персоны', 'персон']);
  const turns = en ? (n === 1 ? 'move' : 'moves') : pluralRu(n, ['ход', 'хода', 'ходов']);
  return line
    .replace(/\{n\}/g, String(n))
    .replace(/\{pieces\}/g, pieces)
    .replace(/\{persons\}/g, persons)
    .replace(/\{turns\}/g, turns)
    .replace(/\{name\}/g, ctx.name || (lang === 'en' ? 'Hero' : 'Герой'))
    .replace(/\{opp\}/g, ctx.opp || (lang === 'en' ? 'rival' : 'соперник'));
}

/** Fill the placeholders of a raw line (exported for the grammar audit in the tests). */
export function fillLine(line, ctx = {}, lang = 'ru') {
  return fill(line, ctx, lang === 'en' ? 'en' : 'ru');
}

/** Every bank name (for tests / tooling). */
export function bragEvents(lang = 'ru') {
  return Object.keys(LINES[lang === 'en' ? 'en' : 'ru']);
}

/** A bragging / taunt line for `event` (see the header). Never returns an empty string. */
export function bragLine(event, ctx = {}, lang = 'ru') {
  lang = lang === 'en' ? 'en' : 'ru';
  const L = LINES[lang];
  const rnd = typeof ctx.random === 'function' ? ctx.random : R;
  let bank = event;
  if (event === 'multi') bank = 'combo';
  if (bank === 'combo' && (ctx.n || 2) >= 4 && rnd() < 0.65) bank = 'comboBig';
  if (!L[bank]) bank = 'brag';
  return fill(pick(L[bank], `${lang}|${bank}`, rnd), ctx, lang);
}

/** All lines of an event (for tests / preloading lettering). */
export function bragLines(event, lang = 'ru') {
  const L = LINES[lang === 'en' ? 'en' : 'ru'];
  return (L[event] || []).slice();
}

// =================================================================================== attack names
// Russian adjectives agree with the noun's gender: [masculine, feminine, neuter].
const RU_ADJ = {
  white: [
    ['Лазурный', 'Лазурная', 'Лазурное'],
    ['Небесный', 'Небесная', 'Небесное'],
    ['Ледяной', 'Ледяная', 'Ледяное'],
    ['Грозовой', 'Грозовая', 'Грозовое'],
    ['Звёздный', 'Звёздная', 'Звёздное'],
    ['Громовой', 'Громовая', 'Громовое'],
    ['Призрачный', 'Призрачная', 'Призрачное'],
    ['Сияющий', 'Сияющая', 'Сияющее'],
    ['Лунный', 'Лунная', 'Лунное'],
    ['Штормовой', 'Штормовая', 'Штормовое'],
  ],
  black: [
    ['Багровый', 'Багровая', 'Багровое'],
    ['Алый', 'Алая', 'Алое'],
    ['Кровавый', 'Кровавая', 'Кровавое'],
    ['Адский', 'Адская', 'Адское'],
    ['Пылающий', 'Пылающая', 'Пылающее'],
    ['Тёмный', 'Тёмная', 'Тёмное'],
    ['Демонический', 'Демоническая', 'Демоническое'],
    ['Огненный', 'Огненная', 'Огненное'],
    ['Теневой', 'Теневая', 'Теневое'],
    ['Чёрный', 'Чёрная', 'Чёрное'],
  ],
  royal: [
    ['Золотой', 'Золотая', 'Золотое'],
    ['Императорский', 'Императорская', 'Императорское'],
    ['Божественный', 'Божественная', 'Божественное'],
    ['Абсолютный', 'Абсолютная', 'Абсолютное'],
    ['Последний', 'Последняя', 'Последнее'],
    ['Бесконечный', 'Бесконечная', 'Бесконечное'],
    ['Запретный', 'Запретная', 'Запретное'],
  ],
};
const RU_BEAST = [
  ['Драконий', 'Драконья', 'Драконье'],
  ['Тигриный', 'Тигриная', 'Тигриное'],
  ['Волчий', 'Волчья', 'Волчье'],
  ['Змеиный', 'Змеиная', 'Змеиное'],
  ['Соколиный', 'Соколиная', 'Соколиное'],
  ['Орлиный', 'Орлиная', 'Орлиное'],
  ['Лисий', 'Лисья', 'Лисье'],
  ['Вороний', 'Воронья', 'Воронье'],
  ['Самурайский', 'Самурайская', 'Самурайское'],
  ['Небесный', 'Небесная', 'Небесное'],
];
// [word, gender 0 m / 1 f / 2 n]
const RU_NOUN = [
  ['Прыжок', 0], ['Удар', 0], ['Ураган', 0], ['Вихрь', 0], ['Шторм', 0], ['Танец', 0], ['Гнев', 0],
  ['Клинок', 0], ['Рёв', 0], ['Натиск', 0], ['Прорыв', 0], ['Смерч', 0], ['Приговор', 0], ['Разлом', 0],
  ['Буря', 1], ['Молния', 1], ['Комета', 1], ['Кара', 1], ['Ярость', 1], ['Атака', 1], ['Казнь', 1], ['Волна', 1], ['Гроза', 1],
  ['Пламя', 2], ['Сияние', 2], ['Возмездие', 2], ['Сокрушение', 2], ['Затмение', 2], ['Цунами', 2],
];
// pairs that read as a "move" + "of many things": Ураган Тысячи Клинков
const RU_MANY_HEAD = ['Ураган', 'Танец', 'Шторм', 'Вихрь', 'Буря', 'Казнь', 'Ливень', 'Гнев', 'Дождь', 'Вальс', 'Рой', 'Охота'];
const RU_MANY_TAIL = ['Клинков', 'Молний', 'Драконов', 'Теней', 'Звёзд', 'Прыжков', 'Ударов', 'Солнц', 'Бурь', 'Демонов', 'Волков', 'Тигров', 'Лепестков', 'Комет', 'Ураганов'];
const RU_NUM_GEN = { 2: 'Двух', 3: 'Трёх', 4: 'Четырёх', 5: 'Пяти', 6: 'Шести', 7: 'Семи', 8: 'Восьми', 9: 'Девяти', 10: 'Десяти' };
const RU_GEN = [
  'Небесного Дракона', 'Алой Луны', 'Чёрного Солнца', 'Багровой Сакуры', 'Стального Феникса', 'Девятого Круга',
  'Падшего Бога', 'Ледяного Ветра', 'Тысячи Теней', 'Восьми Ветров', 'Бездны', 'Грома', 'Последнего Самурая',
  'Пылающего Тигра', 'Вечной Ночи', 'Звёздного Неба', 'Разбитых Небес',
];
const RU_PREFIX = ['Тайная техника', 'Запретное искусство', 'Секретный стиль', 'Последний приём', 'Высшая техника'];

const EN_ADJ = {
  white: ['Azure', 'Heavenly', 'Frozen', 'Thunder', 'Starlight', 'Storm', 'Phantom', 'Radiant', 'Lunar', 'Cyan'],
  black: ['Crimson', 'Scarlet', 'Blood', 'Infernal', 'Blazing', 'Dark', 'Demonic', 'Burning', 'Shadow', 'Black'],
  royal: ['Golden', 'Imperial', 'Divine', 'Absolute', 'Final', 'Endless', 'Forbidden'],
};
const EN_BEAST = ['Dragon', 'Tiger', 'Wolf', 'Serpent', 'Falcon', 'Eagle', 'Fox', 'Raven', 'Samurai', 'Phoenix'];
const EN_NOUN = ['Leap', 'Strike', 'Hurricane', 'Whirlwind', 'Storm', 'Dance', 'Wrath', 'Blade', 'Roar', 'Onslaught', 'Breaker', 'Tornado', 'Verdict', 'Rift', 'Tempest', 'Lightning', 'Comet', 'Judgement', 'Fury', 'Execution', 'Wave', 'Flame', 'Radiance', 'Vengeance', 'Eclipse', 'Tsunami'];
const EN_MANY_HEAD = ['Hurricane', 'Dance', 'Storm', 'Whirlwind', 'Tempest', 'Execution', 'Rain', 'Wrath', 'Waltz', 'Swarm', 'Hunt'];
const EN_MANY_TAIL = ['Blades', 'Lightnings', 'Dragons', 'Shadows', 'Stars', 'Leaps', 'Strikes', 'Suns', 'Storms', 'Demons', 'Wolves', 'Tigers', 'Petals', 'Comets', 'Fangs'];
const EN_NUM = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten' };
const EN_GEN = [
  'the Heavenly Dragon', 'the Scarlet Moon', 'the Black Sun', 'the Crimson Sakura', 'the Steel Phoenix', 'the Ninth Circle',
  'the Fallen God', 'the Frozen Wind', 'a Thousand Shadows', 'the Eight Winds', 'the Abyss', 'Thunder', 'the Last Samurai',
  'the Blazing Tiger', 'Eternal Night', 'the Starry Sky', 'the Shattered Heavens',
];
const EN_PREFIX = ['Secret Art', 'Forbidden Technique', 'Hidden Style', 'Final Form', 'Ultimate Technique'];

const oneOf = (list, rnd) => list[Math.floor(rnd() * list.length) % list.length];

function adjPool(ctx) {
  const side = ctx.side === -1 ? 'black' : 'white';
  return { side, royal: !!(ctx.king || ctx.ultimate) };
}

/**
 * Anime special-move name. ctx: { n (hits; the number shows up in «… Трёх Клинков»), side, king,
 * ultimate, random }. Russian adjectives always agree with the noun's gender.
 */
export function attackName(ctx = {}, lang = 'ru') {
  const rnd = typeof ctx.random === 'function' ? ctx.random : R;
  const n = Math.max(1, ctx.n | 0 || 1);
  const { side, royal } = adjPool(ctx);
  const useRoyal = royal && rnd() < 0.5;
  const ult = !!ctx.ultimate;
  // a big plain combo (×5+) echoes its count («Казнь Пяти Драконов»); the «Тайная техника:» prefix
  // stays exclusive to the ULTIMATE, whose name drops the adjective so it fits in ≤ 2 lines
  const big = !ult && n >= 5 && n <= 10;
  let name;
  let pattern = Math.floor(rnd() * 3);
  if (n >= 2 && rnd() < 0.45) pattern = 1; // numbers that match the combo read great
  if (big) pattern = 1;
  if (lang === 'en') {
    const adj = oneOf(useRoyal ? EN_ADJ.royal : EN_ADJ[side], rnd);
    if (pattern === 0) {
      name = ult ? `${oneOf(EN_BEAST, rnd)} ${oneOf(EN_NOUN, rnd)}` : `${adj} ${oneOf(EN_BEAST, rnd)} ${oneOf(EN_NOUN, rnd)}`;
    } else if (pattern === 1) {
      const num = n >= 2 && n <= 10 && (big || rnd() < 0.75) ? EN_NUM[n] : rnd() < 0.5 ? 'a Thousand' : 'a Hundred';
      name = `${oneOf(EN_MANY_HEAD, rnd)} of ${num} ${oneOf(EN_MANY_TAIL, rnd)}`;
    } else {
      name = ult ? `${oneOf(EN_NOUN, rnd)} of ${oneOf(EN_GEN, rnd)}` : `${adj} ${oneOf(EN_NOUN, rnd)} of ${oneOf(EN_GEN, rnd)}`;
    }
    // the prefix belongs to the ULTIMATE alone (EAD-14)
    if (ult) name = `${oneOf(EN_PREFIX, rnd)}: ${name}`;
    return name;
  }
  const adjForms = oneOf(useRoyal ? RU_ADJ.royal : RU_ADJ[side], rnd);
  if (pattern === 0) {
    const [noun, g] = oneOf(RU_NOUN, rnd);
    let beast = oneOf(RU_BEAST, rnd);
    if (beast[0] === adjForms[0]) beast = RU_BEAST[0];
    name = ult ? `${beast[g]} ${noun}` : `${adjForms[g]} ${beast[g]} ${noun}`;
  } else if (pattern === 1) {
    const num = n >= 2 && n <= 10 && (big || rnd() < 0.75) ? RU_NUM_GEN[n] : rnd() < 0.5 ? 'Тысячи' : 'Сотни';
    name = `${oneOf(RU_MANY_HEAD, rnd)} ${num} ${oneOf(RU_MANY_TAIL, rnd)}`;
  } else {
    const [noun, g] = oneOf(RU_NOUN, rnd);
    name = ult ? `${noun} ${oneOf(RU_GEN, rnd)}` : `${adjForms[g]} ${noun} ${oneOf(RU_GEN, rnd)}`;
  }
  if (ult) name = `${oneOf(RU_PREFIX, rnd)}: ${name}`;
  return name;
}

// =================================================================================== kanji
const KANJI = {
  capture: ['斬!', '撃!', 'ドン!', '破!'],
  captureRu: ['БАХ!', 'ХРЯСЬ!', 'БАМ!'],
  captureEn: ['BAM!', 'WHAM!', 'CRASH!'],
  hit: ['斬!', '撃!', '破!', '裂!', '砕!'],
  combo: ['連撃', '連斬'],
  finale: ['爆!', 'ドン!', '滅!', '轟!'],
  promote: ['覚醒'],
  ultimate: ['必殺'],
  win: ['勝利'],
  flawless: ['完璧'],
  lose: ['敗北'],
  draw: ['引き分け'],
  start: ['対決'],
  nani: ['何?!'],
  menacing: ['ゴ'],
  ko: ['K.O.'],
};

/** Onomatopoeia / kanji for an event. With lang, capture sometimes yields «БАХ!» / "BAM!". */
export function kanjiFor(event, lang) {
  const rnd = R;
  if (event === 'capture') {
    const local = lang === 'en' ? KANJI.captureEn : lang === 'ru' ? KANJI.captureRu : null;
    if (local && rnd() < 0.3) return pick(local, `k|${lang}|capture`);
    return pick(KANJI.capture, 'k|capture');
  }
  const list = KANJI[event];
  if (!list) return '!';
  return list.length === 1 ? list[0] : pick(list, `k|${event}`);
}

/** Every glyph string the Director may draw (to warm up the lettering cache / fonts). */
export function allKanji() {
  const out = new Set();
  for (const list of Object.values(KANJI)) for (const k of list) out.add(k);
  return [...out];
}
