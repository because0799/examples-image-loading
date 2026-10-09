// i18n — every user-visible UI string in Russian (default) and English.
//
//   t(key, params)   -> string. `{name}` placeholders are replaced from params. Plural entries
//                       ({ one, few, many } / { one, other }) pick a form by params.n.
//   tl(key)          -> string[] (paragraph / phrase lists)
//   pick(key, seed)  -> one entry of a phrase list (random, or deterministic with a seed)
//   loc(obj)         -> picks obj[lang] from a { ru, en } object (variant metadata etc.)
//   setLang(lang), getLang(), onLangChange(fn) -> unsubscribe
//
// Missing keys fall back to Russian, then to the key itself (never throws).

const RU = {
  'app.name': 'EPIC ШАШКИ',
  'app.logoTop': 'EPIC',
  'app.logoMain': 'ШАШКИ',
  'app.tagline': 'Каждый ход — битва',
  'app.version': 'Версия {v}',

  // ---------------------------------------------------------------- common
  'common.back': 'Назад',
  'common.close': 'Закрыть',
  'common.yes': 'Да',
  'common.no': 'Нет',
  'common.ok': 'OK',
  'common.cancel': 'Отмена',
  'common.on': 'Вкл',
  'common.off': 'Выкл',
  'common.white': 'Белые',
  'common.black': 'Чёрные',
  'common.whiteGen': 'белых',
  'common.blackGen': 'чёрных',
  'common.pieces': { one: '{n} шашка', few: '{n} шашки', many: '{n} шашек' },
  'common.moves': { one: '{n} ход', few: '{n} хода', many: '{n} ходов' },
  'common.games': { one: '{n} партия', few: '{n} партии', many: '{n} партий' },
  'common.minSec': '{m} мин {s} с',
  'common.sec': '{s} с',

  // ---------------------------------------------------------------- title
  'title.tap': 'Коснитесь, чтобы начать',
  'title.sub': 'Турецкие · Русские · Международные · и другие',

  // ---------------------------------------------------------------- menu
  'menu.playAi': 'Играть с ИИ',
  'menu.playAiSub': 'Пять уровней: от новичка до гроссмейстера',
  'menu.pvp': 'Вдвоём',
  'menu.pvpSub': 'Два игрока на одном телефоне',
  'menu.demo': 'Битва ИИ',
  'menu.demoSub': 'Смотрите, как сражаются машины',
  'menu.rules': 'Правила',
  'menu.stats': 'Статистика',
  'menu.settings': 'Настройки',
  'menu.yourTitle': 'Ваш титул',
  'menu.rookie': 'Новобранец',
  'menu.titlesCount': 'Титулов: {n} из {total}',

  // ---------------------------------------------------------------- epic toggle
  'epic.name': 'EPIC BADASS MODE',
  'epic.pitch': 'Максимум эффектов и хвастовства',
  'epic.onHint': 'Каждый ход — аниме-битва!',
  'epic.offHint': 'Сейчас спокойная классика. Включай!',
  'epic.on': 'ВКЛ',
  'epic.off': 'ВЫКЛ',
  'epic.toastOn': 'EPIC РЕЖИМ АКТИВИРОВАН',
  'epic.toastOff': 'Классический режим',

  // ---------------------------------------------------------------- setup
  'setup.title.ai': 'Игра с ИИ',
  'setup.title.pvp': 'Вдвоём',
  'setup.title.demo': 'Битва ИИ',
  'setup.variant': 'Вариант шашек',
  'setup.color': 'Ваш цвет',
  'setup.random': 'Случайно',
  'setup.level': 'Уровень ИИ',
  'setup.levelDemo': 'Сила бойцов',
  'setup.mode': 'Режим',
  'setup.giveaway': 'Поддавки',
  'setup.giveawayDesc': 'Всё наоборот: побеждает тот, кто первым отдаст все шашки или останется без ходов',
  'setup.pvpHint': 'Передавайте телефон друг другу после каждого хода. Белые внизу.',
  'setup.demoHint': 'Два ИИ сражаются между собой, а вы наслаждаетесь шоу. Касание — пропустить сцену.',
  'setup.start': 'Начать игру',
  'setup.startEpic': 'В БОЙ!',
  'setup.rules': 'Правила',
  'setup.firstWhite': 'Начинают белые',
  'setup.firstBlack': 'Начинают чёрные',
  'setup.allSquares': 'Все поля',
  'setup.perSide': { one: 'по {n} шашке', few: 'по {n} шашки', many: 'по {n} шашек' },
  'setup.swipe': 'Листайте',

  // ---------------------------------------------------------------- AI levels
  'level.label': 'Уровень {n}',
  'level.1': 'Новичок',
  'level.2': 'Любитель',
  'level.3': 'Боец',
  'level.4': 'Мастер',
  'level.5': 'Гроссмейстер',
  'levelEpic.1': 'Ученик',
  'levelEpic.2': 'Воин',
  'levelEpic.3': 'Самурай',
  'levelEpic.4': 'Сёгун',
  'levelEpic.5': 'Бог шашек',
  'levelDesc.1': 'Только учится ходить',
  'levelDesc.2': 'Знает правила, но иногда зевает',
  'levelDesc.3': 'Крепкий соперник',
  'levelDesc.4': 'Видит комбинации далеко вперёд',
  'levelDesc.5': 'Беспощаден. Думает до трёх секунд',
  'levelDescEpic.1': 'Держит шашку двумя руками',
  'levelDescEpic.2': 'Голоден до драки',
  'levelDescEpic.3': 'Путь клинка: точность и честь',
  'levelDescEpic.4': 'Правит доской железной рукой',
  'levelDescEpic.5': 'Говорят, он не проигрывал никогда',

  // ---------------------------------------------------------------- settings
  'settings.title': 'Настройки',
  'settings.secGeneral': 'Общие',
  'settings.secSound': 'Звук',
  'settings.secGame': 'Игра',
  'settings.secGraphics': 'Графика',
  'settings.lang': 'Язык',
  'settings.sfx': 'Звуковые эффекты',
  'settings.music': 'Музыка',
  'settings.vibration': 'Вибрация',
  'settings.vibrationDesc': 'Отдача при ударах и взятиях',
  'settings.announcer': 'Голос комментатора',
  'settings.announcerDesc': 'Кричит «КОМБО!» и «НОКАУТ!» в EPIC режиме',
  'settings.quality': 'Качество эффектов',
  'settings.qualityDesc': 'Снизьте, если игра подтормаживает или телефон греется',
  'settings.q.high': 'Максимум',
  'settings.q.medium': 'Средне',
  'settings.q.low': 'Минимум',
  'settings.showMoves': 'Показывать ходы',
  'settings.showMovesDesc': 'Подсвечивать поля, куда можно пойти',
  'settings.animSpeed': 'Скорость анимации',
  'settings.animSpeedDesc': 'Ускоряет ходы и кинематографичные сцены',
  'settings.resetStats': 'Сбросить статистику',
  'settings.resetConfirm': 'Удалить всю статистику, рекорды и титулы? Это нельзя отменить.',
  'settings.resetDone': 'Статистика сброшена',
  'settings.reset': 'Сбросить',

  // ---------------------------------------------------------------- rules
  'rules.title': 'Правила',
  'rules.basics': 'Основы',
  'rules.howTo': 'Как играть',
  'rules.howToSub': 'Ходы, бой, дамки и управление',
  'rules.epic': 'Что такое EPIC режим',
  'rules.epicSub': 'Аниме-битва на шашечной доске',
  'rules.variants': 'Варианты шашек',
  'rules.board': 'Доска',
  'rules.pieces': 'Шашек',
  'rules.first': 'Первый ход',
  'rules.squares': 'Поля',
  'rules.squaresDark': 'Тёмные',
  'rules.squaresAll': 'Все',
  'rules.keyFacts': 'Главное',
  'rules.full': 'Подробные правила',
  'rules.giveawayTitle': 'Поддавки',
  'rules.giveaway': 'Поддавки можно включить в любом варианте. Правила ходов и боя те же, но цель обратная: побеждает тот, кто первым лишится всех шашек или не сможет сделать ход.',
  'rules.howToText': [
    'Игроки ходят по очереди. Простые шашки ходят на одно поле вперёд: по диагонали по тёмным клеткам, а в турецких шашках — по прямой вперёд или вбок. Цель — побить все шашки соперника или оставить его без ходов.',
    'Бить обязательно. Взятие — это прыжок через шашку соперника на свободное поле за ней. Если после прыжка можно бить дальше, бой продолжается тем же ходом — так рождаются комбо.',
    'Шашка, дошедшая до последнего ряда, становится дамкой. Во многих вариантах дамка «летает» — ходит на любое число свободных полей по линии.',
    'Управление: коснитесь своей шашки — подсветятся доступные ходы. Затем коснитесь поля, куда хотите пойти. При взятии нескольких шашек отмечайте поля прыжков по очереди.',
    'Кнопки внизу экрана: «Меню» — пауза, правила и настройки; «Отмена» — вернуть ход; «Подсказка» — ИИ покажет сильный ход.',
    'Детали отличаются от варианта к варианту: кто ходит первым, может ли простая бить назад, как ходит дамка и нужно ли бить максимум шашек. Выберите вариант ниже, чтобы прочитать его правила.',
  ],
  'rules.epicText': [
    'EPIC BADASS MODE превращает каждую партию в аниме-сражение: рывки со скоростными линиями, удары с замедлением времени, вспышки, молнии и взрывы.',
    'Каждое взятие — добивающий приём. Серия взятий — комбо: камера следует за каждым прыжком, растёт счётчик ударов, а в финале звучит название суперприёма.',
    'Шкала ЯРОСТИ заполняется с каждым взятием. Когда она полна, следующее взятие станет УЛЬТОЙ — самой зрелищной атакой в игре.',
    'Превращение в дамку — ПРОБУЖДЕНИЕ: столб света с небес, золотая спираль и вечная огненная аура.',
    'Игра хвастается за вас: подписи к ударам, титулы, рекорды и голос комментатора. Скромность — не наш стиль.',
    'Любую сцену можно пропустить касанием экрана. Если телефон греется — снизьте качество эффектов в настройках.',
  ],

  // ---------------------------------------------------------------- stats
  'stats.title': 'Статистика',
  'stats.vsAi': 'Против ИИ',
  'stats.games': 'Партий',
  'stats.wins': 'Победы',
  'stats.losses': 'Поражения',
  'stats.draws': 'Ничьи',
  'stats.winRate': 'Побед',
  'stats.feats': 'Подвиги',
  'stats.bestCombo': 'Лучшее комбо',
  'stats.captures': 'Взято шашек',
  'stats.kings': 'Дамок проведено',
  'stats.flawless': 'Безупречных побед',
  'stats.streak': 'Серия побед',
  'stats.bestStreak': 'Лучшая серия',
  'stats.perVariant': 'По вариантам',
  'stats.titles': 'Титулы',
  'stats.titlesCount': '{n} из {total}',
  'stats.other': 'Другие режимы',
  'stats.pvpGames': 'Партий вдвоём',
  'stats.demoGames': 'Битв ИИ досмотрено',
  'stats.playTime': 'Время в игре',
  'stats.empty': 'Сыграйте первую партию с ИИ — и здесь появятся ваши подвиги.',
  'stats.locked': 'Закрыт',
  'stats.unlocked': 'Получен',
  'stats.w': 'В',
  'stats.l': 'П',
  'stats.d': 'Н',
  'stats.noGames': 'ещё не играли',
  'stats.yourTitle': 'Ваш титул',
  'stats.progress': '{cur} / {goal}',

  // ---------------------------------------------------------------- titles (achievements)
  'title.first-blood.name': 'Первая кровь',
  'title.first-blood.desc': 'Выиграйте первую партию у ИИ',
  'title.flawless.name': 'Безупречный',
  'title.flawless.desc': 'Победите, не потеряв ни одной шашки',
  'title.triple.name': 'Тройной удар',
  'title.triple.desc': 'Возьмите 3 шашки за один ход',
  'title.grinder.name': 'Мясорубка',
  'title.grinder.desc': 'Комбо ×4: четыре шашки за один ход',
  'title.hurricane.name': 'Шашечный ураган',
  'title.hurricane.desc': 'Комбо ×5 и больше',
  'title.king-lord.name': 'Повелитель дамок',
  'title.king-lord.desc': 'Проведите 25 дамок',
  'title.royal-family.name': 'Королевская семья',
  'title.royal-family.desc': 'Проведите 3 дамки за одну партию',
  'title.sultan.name': 'Турецкий султан',
  'title.sultan.desc': '10 побед в турецких шашках',
  'title.tsar.name': 'Царь доски',
  'title.tsar.desc': '10 побед в русских шашках',
  'title.hundred.name': 'Покоритель ста клеток',
  'title.hundred.desc': 'Победа в международных шашках 10×10',
  'title.giant.name': 'Убийца гигантов',
  'title.giant.desc': 'Победа в канадских шашках 12×12',
  'title.globetrotter.name': 'Гражданин мира',
  'title.globetrotter.desc': 'Побеждайте в 5 разных вариантах',
  'title.blade-master.name': 'Мастер клинка',
  'title.blade-master.desc': 'Победите ИИ 4-го уровня',
  'title.god.name': 'Бог шашек',
  'title.god.desc': 'Победите ИИ 5-го уровня',
  'title.unstoppable.name': 'Неудержимый',
  'title.unstoppable.desc': '5 побед подряд',
  'title.legend.name': 'Живая легенда',
  'title.legend.desc': '10 побед подряд',
  'title.devourer.name': 'Пожиратель шашек',
  'title.devourer.desc': 'Возьмите 100 шашек',
  'title.thunder.name': 'Гроза доски',
  'title.thunder.desc': 'Возьмите 500 шашек',
  'title.protagonist.name': 'Главный герой аниме',
  'title.protagonist.desc': '10 побед в EPIC режиме',
  'title.philanthropist.name': 'Великий филантроп',
  'title.philanthropist.desc': 'Выиграйте в поддавки',
  'title.lightning.name': 'Молниеносный',
  'title.lightning.desc': 'Победите быстрее чем за 30 ходов',
  'title.marathon.name': 'Марафонец',
  'title.marathon.desc': 'Сыграйте партию длиной 100+ ходов',
  'title.veteran.name': 'Ветеран',
  'title.veteran.desc': 'Сыграйте 50 партий',
  'title.couch.name': 'Хозяин дивана',
  'title.couch.desc': 'Сыграйте 10 партий вдвоём',
  'title.connoisseur.name': 'Ценитель битв',
  'title.connoisseur.desc': 'Досмотрите 5 битв ИИ до конца',
  'title.unbroken.name': 'Несломленный',
  'title.unbroken.desc': 'Проиграйте 10 раз — и не сдавайтесь',

  // ---------------------------------------------------------------- records
  'record.bestCombo': 'Лучшее комбо',
  'record.bestStreak': 'Серия побед',
  'record.mostCaptures': 'Взятий за партию',
  'record.mostKings': 'Дамок за партию',
  'record.fastestWin': 'Самая быстрая победа',
  'record.value.bestCombo': '×{n}',
  'record.value.bestStreak': '{n}',
  'record.value.mostCaptures': '{n}',
  'record.value.mostKings': '{n}',
  'record.value.fastestWin': { one: '{n} ход', few: '{n} хода', many: '{n} ходов' },

  // ---------------------------------------------------------------- HUD
  'hud.you': 'Вы',
  'hud.player': 'Игрок',
  'hud.ai': 'ИИ',
  'hud.aiLevel': 'ИИ · уровень {n}',
  'hud.thinking': 'Думает',
  'hud.thinkingEpic': 'Копит силу',
  'hud.pieces': 'Шашек на доске',
  'hud.captured': 'Взято',
  'hud.rage': 'ЯРОСТЬ',
  'hud.rageFull': 'УЛЬТА ГОТОВА!',
  'hud.turnWhite': 'Ход белых',
  'hud.turnBlack': 'Ход чёрных',
  'hud.yourTurn': 'Ваш ход',
  'hud.opponentTurn': 'Ход соперника',
  'hud.mustCapture': 'Обязательный бой!',
  'hud.menu': 'Меню',
  'hud.undo': 'Отмена',
  'hud.hint': 'Подсказка',
  'hud.skip': 'Пропустить',
  'hud.giveaway': 'Поддавки',
  'hud.demo': 'Битва ИИ',

  // ---------------------------------------------------------------- pause
  'pause.title': 'Пауза',
  'pause.resume': 'Продолжить',
  'pause.restart': 'Начать заново',
  'pause.resign': 'Сдаться',
  'pause.offerDraw': 'Предложить ничью',
  'pause.rules': 'Правила этого варианта',
  'pause.settings': 'Настройки',
  'pause.toMenu': 'В меню',
  'pause.confirmResign': 'Сдаться? Партия будет засчитана как поражение.',
  'pause.confirmResignSide': '{side} сдаются?',
  'pause.confirmMenu': 'Выйти в меню? Текущая партия будет прервана.',
  'pause.confirmRestart': 'Начать партию заново?',
  'pause.drawOffer': '{side} предлагают ничью. {other}, принимаете?',
  'pause.drawAccept': 'Принять ничью',
  'pause.drawDecline': 'Отказаться',
  'pause.drawDeclined': 'Ничья отклонена — бьёмся дальше!',
  'pause.vsAi': 'с ИИ',
  'pause.pvp': 'вдвоём',
  'pause.demo': 'битва ИИ',

  // ---------------------------------------------------------------- game over
  'go.win': 'Победа',
  'go.loss': 'Поражение',
  'go.draw': 'Ничья',
  'go.winEpic': 'ПОБЕДА!',
  'go.lossEpic': 'ПОРАЖЕНИЕ',
  'go.drawEpic': 'НИЧЬЯ',
  'go.whiteWins': 'Победа белых',
  'go.blackWins': 'Победа чёрных',
  'go.whiteWinsEpic': 'БЕЛЫЕ ПОБЕДИЛИ!',
  'go.blackWinsEpic': 'ЧЁРНЫЕ ПОБЕДИЛИ!',
  'go.r.no-pieces.win': 'Все шашки соперника разбиты',
  'go.r.no-pieces.loss': 'Все ваши шашки биты',
  'go.r.no-pieces.side': '{loser} остались без шашек',
  'go.r.no-moves.win': 'Соперник заперт — ходов нет',
  'go.r.no-moves.loss': 'Вы заперты — ходов нет',
  'go.r.no-moves.side': '{loser} заперты — ходов нет',
  'go.r.resign.win': 'Соперник сдался',
  'go.r.resign.loss': 'Вы сдались',
  'go.r.resign.side': '{loser} сдались',
  'go.r.ga.no-pieces.win': 'Вы первым отдали все шашки — победа в поддавках!',
  'go.r.ga.no-pieces.loss': 'Соперник первым отдал все шашки',
  'go.r.ga.no-pieces.side': '{winner} первыми отдали все шашки',
  'go.r.ga.no-moves.win': 'Вам некуда ходить — в поддавках это победа!',
  'go.r.ga.no-moves.loss': 'Сопернику некуда ходить — в поддавках это его победа',
  'go.r.ga.no-moves.side': '{winner} заперты — в поддавках это победа',
  'go.r.repetition': 'Троекратное повторение позиции',
  'go.r.move-limit': 'Слишком долго без взятий',
  'go.r.agreement': 'Ничья по соглашению',
  'go.r.insufficient': 'Ни у кого нет сил на победу',
  'go.r.timeout': 'Время вышло',
  'go.classic.win': 'Блестящая партия!',
  'go.classic.loss': 'Не сдавайтесь — следующая партия будет вашей.',
  'go.classic.draw': 'Равная борьба до последнего хода.',
  'go.brag.win': [
    'Абсолютное доминирование.',
    'Соперник стёрт в пыль.',
    'Это было даже слишком просто.',
    'Доска склонилась перед тобой.',
    'Легенды будут петь об этой партии.',
  ],
  'go.brag.flawless': ['Ни царапины. Абсолютное совершенство.', 'Соперник даже не коснулся тебя.'],
  'go.brag.loss': ['Я вернусь сильнее…', 'Это была лишь разминка…', 'Тренировки продолжаются. Месть близка.'],
  'go.brag.draw': ['Достойные соперники.', 'Битва титанов закончилась вничью.'],
  'go.brag.side': ['Легендарная битва машин.', 'Победитель забирает всё.'],
  'go.stat.combo': 'Комбо ×{n}',
  'go.stat.lost': 'Потерь: {n}',
  'go.stat.kings': 'Дамок: {n}',
  'go.stat.captures': 'Взято: {n}',
  'go.stat.moves': 'Ходов: {n}',
  'go.label.moves': 'Ходов',
  'go.label.captured': 'Взято',
  'go.label.lost': 'Потеряно',
  'go.label.kings': 'Дамок',
  'go.label.combo': 'Комбо',
  'go.label.time': 'Время',
  'go.flawless': 'БЕЗУПРЕЧНО',
  'go.newRecord': 'Новый рекорд!',
  'go.newTitle': 'Новый титул!',
  'go.rematch': 'Реванш',
  'go.menu': 'В меню',
}

const EN = {
  'app.name': 'EPIC CHECKERS',
  'app.logoTop': 'EPIC',
  'app.logoMain': 'CHECKERS',
  'app.tagline': 'Every move is a battle',
  'app.version': 'Version {v}',

  'common.back': 'Back',
  'common.close': 'Close',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.on': 'On',
  'common.off': 'Off',
  'common.white': 'White',
  'common.black': 'Black',
  'common.whiteGen': 'White',
  'common.blackGen': 'Black',
  'common.pieces': { one: '{n} piece', other: '{n} pieces' },
  'common.moves': { one: '{n} move', other: '{n} moves' },
  'common.games': { one: '{n} game', other: '{n} games' },
  'common.minSec': '{m} min {s} s',
  'common.sec': '{s} s',

  'title.tap': 'Tap to start',
  'title.sub': 'Turkish · Russian · International · and more',

  'menu.playAi': 'Play vs AI',
  'menu.playAiSub': 'Five levels: from novice to grandmaster',
  'menu.pvp': 'Two players',
  'menu.pvpSub': 'Two players on one phone',
  'menu.demo': 'AI battle',
  'menu.demoSub': 'Watch the machines fight',
  'menu.rules': 'Rules',
  'menu.stats': 'Stats',
  'menu.settings': 'Settings',
  'menu.yourTitle': 'Your title',
  'menu.rookie': 'Rookie',
  'menu.titlesCount': 'Titles: {n} of {total}',

  'epic.name': 'EPIC BADASS MODE',
  'epic.pitch': 'Maximum effects and bragging',
  'epic.onHint': 'Every move is an anime fight!',
  'epic.offHint': 'Calm classic right now. Turn it on!',
  'epic.on': 'ON',
  'epic.off': 'OFF',
  'epic.toastOn': 'EPIC MODE ACTIVATED',
  'epic.toastOff': 'Classic mode',

  'setup.title.ai': 'Play vs AI',
  'setup.title.pvp': 'Two players',
  'setup.title.demo': 'AI battle',
  'setup.variant': 'Variant',
  'setup.color': 'Your color',
  'setup.random': 'Random',
  'setup.level': 'AI level',
  'setup.levelDemo': 'Fighters strength',
  'setup.mode': 'Mode',
  'setup.giveaway': 'Giveaway',
  'setup.giveawayDesc': 'Reversed: the first side to lose all pieces or run out of moves wins',
  'setup.pvpHint': 'Pass the phone to each other after every move. White plays from the bottom.',
  'setup.demoHint': 'Two AIs fight each other while you enjoy the show. Tap to skip a scene.',
  'setup.start': 'Start game',
  'setup.startEpic': 'FIGHT!',
  'setup.rules': 'Rules',
  'setup.firstWhite': 'White moves first',
  'setup.firstBlack': 'Black moves first',
  'setup.allSquares': 'All squares',
  'setup.perSide': { one: '{n} piece each', other: '{n} pieces each' },
  'setup.swipe': 'Swipe',

  'level.label': 'Level {n}',
  'level.1': 'Novice',
  'level.2': 'Amateur',
  'level.3': 'Fighter',
  'level.4': 'Master',
  'level.5': 'Grandmaster',
  'levelEpic.1': 'Apprentice',
  'levelEpic.2': 'Warrior',
  'levelEpic.3': 'Samurai',
  'levelEpic.4': 'Shogun',
  'levelEpic.5': 'God of Draughts',
  'levelDesc.1': 'Still learning the moves',
  'levelDesc.2': 'Knows the rules, sometimes blunders',
  'levelDesc.3': 'A solid opponent',
  'levelDesc.4': 'Sees combinations far ahead',
  'levelDesc.5': 'Merciless. Thinks up to three seconds',
  'levelDescEpic.1': 'Holds a piece with both hands',
  'levelDescEpic.2': 'Hungry for a fight',
  'levelDescEpic.3': 'The way of the blade: precision and honor',
  'levelDescEpic.4': 'Rules the board with an iron fist',
  'levelDescEpic.5': 'Legends say it has never lost',

  'settings.title': 'Settings',
  'settings.secGeneral': 'General',
  'settings.secSound': 'Sound',
  'settings.secGame': 'Gameplay',
  'settings.secGraphics': 'Graphics',
  'settings.lang': 'Language',
  'settings.sfx': 'Sound effects',
  'settings.music': 'Music',
  'settings.vibration': 'Vibration',
  'settings.vibrationDesc': 'Haptic kick on hits and captures',
  'settings.announcer': 'Announcer voice',
  'settings.announcerDesc': 'Shouts “COMBO!” and “K.O.!” in EPIC mode',
  'settings.quality': 'Effects quality',
  'settings.qualityDesc': 'Lower it if the game stutters or the phone gets hot',
  'settings.q.high': 'Max',
  'settings.q.medium': 'Medium',
  'settings.q.low': 'Low',
  'settings.showMoves': 'Show possible moves',
  'settings.showMovesDesc': 'Highlight the squares you can move to',
  'settings.animSpeed': 'Animation speed',
  'settings.animSpeedDesc': 'Speeds up moves and cinematic scenes',
  'settings.resetStats': 'Reset statistics',
  'settings.resetConfirm': 'Delete all statistics, records and titles? This cannot be undone.',
  'settings.resetDone': 'Statistics reset',
  'settings.reset': 'Reset',

  'rules.title': 'Rules',
  'rules.basics': 'Basics',
  'rules.howTo': 'How to play',
  'rules.howToSub': 'Moves, captures, kings and controls',
  'rules.epic': 'What is EPIC mode',
  'rules.epicSub': 'An anime battle on the checkerboard',
  'rules.variants': 'Variants',
  'rules.board': 'Board',
  'rules.pieces': 'Pieces',
  'rules.first': 'First move',
  'rules.squares': 'Squares',
  'rules.squaresDark': 'Dark',
  'rules.squaresAll': 'All',
  'rules.keyFacts': 'Key facts',
  'rules.full': 'Full rules',
  'rules.giveawayTitle': 'Giveaway',
  'rules.giveaway': 'Giveaway can be enabled for any variant. Moves and captures stay the same, but the goal is reversed: the first side to lose all its pieces or to have no legal move wins.',
  'rules.howToText': [
    'Players move in turns. Men move one square forward: diagonally on the dark squares, or straight forward and sideways in Turkish draughts. The goal is to capture all enemy pieces or leave the opponent without a move.',
    'Capturing is mandatory. A capture is a jump over an enemy piece onto the empty square behind it. If another capture is available after the jump, it continues in the same turn — that is how combos are born.',
    'A man that reaches the last row becomes a king. In many variants the king “flies” — it moves any number of empty squares along a line.',
    'Controls: tap one of your pieces to see its moves, then tap the destination square. For a multi-capture, tap each landing square in turn.',
    'Buttons at the bottom: “Menu” — pause, rules and settings; “Undo” — take back a move; “Hint” — the AI suggests a strong move.',
    'Details differ between variants: who moves first, whether men capture backwards, how kings move and whether you must take the maximum. Pick a variant below to read its rules.',
  ],
  'rules.epicText': [
    'EPIC BADASS MODE turns every game into an anime fight: dashes with speed lines, slow-motion hits, flashes, lightning and explosions.',
    'Every capture is a finishing move. A chain of captures is a combo: the camera follows each jump, the hit counter climbs, and the finale names your special attack.',
    'The RAGE meter fills with every capture. When it is full, your next capture becomes an ULTIMATE — the most spectacular attack in the game.',
    'Promotion is an AWAKENING: a pillar of light from the sky, a golden spiral and an eternal flame aura.',
    'The game brags for you: hit captions, titles, records and an announcer voice. Modesty is not our style.',
    'Tap the screen to skip any scene. If your phone gets hot, lower the effects quality in the settings.',
  ],

  'stats.title': 'Statistics',
  'stats.vsAi': 'Vs AI',
  'stats.games': 'Games',
  'stats.wins': 'Wins',
  'stats.losses': 'Losses',
  'stats.draws': 'Draws',
  'stats.winRate': 'Win rate',
  'stats.feats': 'Feats',
  'stats.bestCombo': 'Best combo',
  'stats.captures': 'Pieces captured',
  'stats.kings': 'Kings made',
  'stats.flawless': 'Flawless wins',
  'stats.streak': 'Win streak',
  'stats.bestStreak': 'Best streak',
  'stats.perVariant': 'By variant',
  'stats.titles': 'Titles',
  'stats.titlesCount': '{n} of {total}',
  'stats.other': 'Other modes',
  'stats.pvpGames': 'Two-player games',
  'stats.demoGames': 'AI battles watched',
  'stats.playTime': 'Time played',
  'stats.empty': 'Play your first game against the AI and your feats will show up here.',
  'stats.locked': 'Locked',
  'stats.unlocked': 'Unlocked',
  'stats.w': 'W',
  'stats.l': 'L',
  'stats.d': 'D',
  'stats.noGames': 'not played yet',
  'stats.yourTitle': 'Your title',
  'stats.progress': '{cur} / {goal}',

  'title.first-blood.name': 'First Blood',
  'title.first-blood.desc': 'Win your first game against the AI',
  'title.flawless.name': 'Flawless',
  'title.flawless.desc': 'Win without losing a single piece',
  'title.triple.name': 'Triple Strike',
  'title.triple.desc': 'Capture 3 pieces in one move',
  'title.grinder.name': 'Meat Grinder',
  'title.grinder.desc': 'Combo ×4: four pieces in one move',
  'title.hurricane.name': 'Checker Hurricane',
  'title.hurricane.desc': 'Combo ×5 or more',
  'title.king-lord.name': 'Lord of Kings',
  'title.king-lord.desc': 'Make 25 kings',
  'title.royal-family.name': 'Royal Family',
  'title.royal-family.desc': 'Make 3 kings in a single game',
  'title.sultan.name': 'Turkish Sultan',
  'title.sultan.desc': '10 wins in Turkish draughts',
  'title.tsar.name': 'Tsar of the Board',
  'title.tsar.desc': '10 wins in Russian draughts',
  'title.hundred.name': 'Conqueror of 100 Squares',
  'title.hundred.desc': 'Win International draughts 10×10',
  'title.giant.name': 'Giant Slayer',
  'title.giant.desc': 'Win Canadian draughts 12×12',
  'title.globetrotter.name': 'Citizen of the World',
  'title.globetrotter.desc': 'Win in 5 different variants',
  'title.blade-master.name': 'Blade Master',
  'title.blade-master.desc': 'Beat the level 4 AI',
  'title.god.name': 'God of Draughts',
  'title.god.desc': 'Beat the level 5 AI',
  'title.unstoppable.name': 'Unstoppable',
  'title.unstoppable.desc': '5 wins in a row',
  'title.legend.name': 'Living Legend',
  'title.legend.desc': '10 wins in a row',
  'title.devourer.name': 'Piece Devourer',
  'title.devourer.desc': 'Capture 100 pieces',
  'title.thunder.name': 'Terror of the Board',
  'title.thunder.desc': 'Capture 500 pieces',
  'title.protagonist.name': 'Anime Protagonist',
  'title.protagonist.desc': '10 wins in EPIC mode',
  'title.philanthropist.name': 'Great Philanthropist',
  'title.philanthropist.desc': 'Win a giveaway game',
  'title.lightning.name': 'Lightning Fast',
  'title.lightning.desc': 'Win in fewer than 30 moves',
  'title.marathon.name': 'Marathon Runner',
  'title.marathon.desc': 'Play a game of 100+ moves',
  'title.veteran.name': 'Veteran',
  'title.veteran.desc': 'Play 50 games',
  'title.couch.name': 'Couch Champion',
  'title.couch.desc': 'Play 10 two-player games',
  'title.connoisseur.name': 'Battle Connoisseur',
  'title.connoisseur.desc': 'Watch 5 AI battles to the end',
  'title.unbroken.name': 'Unbroken',
  'title.unbroken.desc': 'Lose 10 times and keep fighting',

  'record.bestCombo': 'Best combo',
  'record.bestStreak': 'Win streak',
  'record.mostCaptures': 'Captures in a game',
  'record.mostKings': 'Kings in a game',
  'record.fastestWin': 'Fastest win',
  'record.value.bestCombo': '×{n}',
  'record.value.bestStreak': '{n}',
  'record.value.mostCaptures': '{n}',
  'record.value.mostKings': '{n}',
  'record.value.fastestWin': { one: '{n} move', other: '{n} moves' },

  'hud.you': 'You',
  'hud.player': 'Player',
  'hud.ai': 'AI',
  'hud.aiLevel': 'AI · level {n}',
  'hud.thinking': 'Thinking',
  'hud.thinkingEpic': 'Charging up',
  'hud.pieces': 'Pieces on board',
  'hud.captured': 'Captured',
  'hud.rage': 'RAGE',
  'hud.rageFull': 'ULTIMATE READY!',
  'hud.turnWhite': 'White to move',
  'hud.turnBlack': 'Black to move',
  'hud.yourTurn': 'Your move',
  'hud.opponentTurn': "Opponent's move",
  'hud.mustCapture': 'Capture is mandatory!',
  'hud.menu': 'Menu',
  'hud.undo': 'Undo',
  'hud.hint': 'Hint',
  'hud.skip': 'Skip',
  'hud.giveaway': 'Giveaway',
  'hud.demo': 'AI battle',

  'pause.title': 'Paused',
  'pause.resume': 'Resume',
  'pause.restart': 'Restart',
  'pause.resign': 'Resign',
  'pause.offerDraw': 'Offer a draw',
  'pause.rules': 'Rules of this variant',
  'pause.settings': 'Settings',
  'pause.toMenu': 'Main menu',
  'pause.confirmResign': 'Resign? The game will count as a loss.',
  'pause.confirmResignSide': '{side} resign?',
  'pause.confirmMenu': 'Quit to the menu? The current game will be abandoned.',
  'pause.confirmRestart': 'Restart the game?',
  'pause.drawOffer': '{side} offer a draw. {other}, do you accept?',
  'pause.drawAccept': 'Accept the draw',
  'pause.drawDecline': 'Decline',
  'pause.drawDeclined': 'Draw declined — the fight goes on!',
  'pause.vsAi': 'vs AI',
  'pause.pvp': 'two players',
  'pause.demo': 'AI battle',

  'go.win': 'Victory',
  'go.loss': 'Defeat',
  'go.draw': 'Draw',
  'go.winEpic': 'VICTORY!',
  'go.lossEpic': 'DEFEAT',
  'go.drawEpic': 'DRAW',
  'go.whiteWins': 'White wins',
  'go.blackWins': 'Black wins',
  'go.whiteWinsEpic': 'WHITE WINS!',
  'go.blackWinsEpic': 'BLACK WINS!',
  'go.r.no-pieces.win': 'Every enemy piece destroyed',
  'go.r.no-pieces.loss': 'All your pieces were captured',
  'go.r.no-pieces.side': '{loser} have no pieces left',
  'go.r.no-moves.win': 'The opponent is blocked — no moves',
  'go.r.no-moves.loss': 'You are blocked — no moves',
  'go.r.no-moves.side': '{loser} are blocked — no moves',
  'go.r.resign.win': 'The opponent resigned',
  'go.r.resign.loss': 'You resigned',
  'go.r.resign.side': '{loser} resigned',
  'go.r.ga.no-pieces.win': 'You gave away all your pieces first — giveaway won!',
  'go.r.ga.no-pieces.loss': 'The opponent gave away all pieces first',
  'go.r.ga.no-pieces.side': '{winner} gave away all their pieces first',
  'go.r.ga.no-moves.win': 'You have no moves — in giveaway that is a win!',
  'go.r.ga.no-moves.loss': 'The opponent has no moves — in giveaway that is their win',
  'go.r.ga.no-moves.side': '{winner} are blocked — in giveaway that is a win',
  'go.r.repetition': 'Threefold repetition',
  'go.r.move-limit': 'Too long without a capture',
  'go.r.agreement': 'Draw by agreement',
  'go.r.insufficient': 'Neither side can force a win',
  'go.r.timeout': 'Time is up',
  'go.classic.win': 'A brilliant game!',
  'go.classic.loss': "Don't give up — the next game is yours.",
  'go.classic.draw': 'An even fight to the very last move.',
  'go.brag.win': [
    'Total domination.',
    'The opponent was wiped off the board.',
    'That was almost too easy.',
    'The board bows before you.',
    'Legends will sing of this game.',
  ],
  'go.brag.flawless': ['Not a scratch. Absolute perfection.', 'The opponent never even touched you.'],
  'go.brag.loss': ['I will return stronger…', 'That was just a warm-up…', 'Training continues. Revenge is near.'],
  'go.brag.draw': ['Worthy rivals.', 'A clash of titans ends in a draw.'],
  'go.brag.side': ['A legendary battle of machines.', 'The winner takes it all.'],
  'go.stat.combo': 'Combo ×{n}',
  'go.stat.lost': 'Lost: {n}',
  'go.stat.kings': 'Kings: {n}',
  'go.stat.captures': 'Captured: {n}',
  'go.stat.moves': 'Moves: {n}',
  'go.label.moves': 'Moves',
  'go.label.captured': 'Captured',
  'go.label.lost': 'Lost',
  'go.label.kings': 'Kings',
  'go.label.combo': 'Combo',
  'go.label.time': 'Time',
  'go.flawless': 'FLAWLESS',
  'go.newRecord': 'New record!',
  'go.newTitle': 'Title unlocked!',
  'go.rematch': 'Rematch',
  'go.menu': 'Menu',
};

export const TABLES = { ru: RU, en: EN };
export const LANGS = ['ru', 'en'];

let current = 'ru';
const listeners = new Set();

export function setLang(lang) {
  const next = LANGS.includes(lang) ? lang : 'ru';
  if (next === current) return;
  current = next;
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = next;
  for (const fn of [...listeners]) {
    try {
      fn(next);
    } catch (e) {
      console.error(e);
    }
  }
}

export function getLang() {
  return current;
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Plural category for a number in the given language. */
export function pluralCategory(n, lang = current) {
  const a = Math.abs(Math.trunc(Number(n) || 0));
  if (lang === 'ru') {
    const m100 = a % 100;
    const m10 = a % 10;
    if (m100 >= 11 && m100 <= 14) return 'many';
    if (m10 === 1) return 'one';
    if (m10 >= 2 && m10 <= 4) return 'few';
    return 'many';
  }
  return a === 1 ? 'one' : 'other';
}

function raw(key, lang) {
  const tab = TABLES[lang] || RU;
  if (Object.prototype.hasOwnProperty.call(tab, key)) return tab[key];
  if (Object.prototype.hasOwnProperty.call(RU, key)) return RU[key];
  return undefined;
}

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, name) => (params[name] != null ? String(params[name]) : m));
}

/** Translate `key`. Unknown keys return the key itself. */
export function t(key, params) {
  let v = raw(key, current);
  if (v == null) return key;
  if (Array.isArray(v)) v = v.join('\n');
  else if (typeof v === 'object') {
    const n = params && (params.n ?? params.count);
    const cat = pluralCategory(n, current);
    v = v[cat] ?? v.other ?? v.many ?? v.one ?? '';
  }
  return interpolate(String(v), params);
}

/** Translate a list entry (array of strings). Non-list keys return a single-item array. */
export function tl(key, params) {
  const v = raw(key, current);
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((s) => interpolate(s, params));
  return [t(key, params)];
}

/** Pick one phrase from a list. With a numeric seed the choice is deterministic. */
export function pick(key, seed, params) {
  const list = tl(key, params);
  if (!list.length) return '';
  const i = seed == null ? Math.floor(Math.random() * list.length) : Math.abs(Math.trunc(seed)) % list.length;
  return list[i];
}

/** `{ ru, en }` (or a plain string) -> string in the current language. */
export function loc(obj) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[current] ?? obj.ru ?? obj.en ?? '';
}

/** `{ ru: [...], en: [...] }` -> array in the current language. */
export function locList(obj) {
  if (!obj) return [];
  const v = obj[current] ?? obj.ru ?? obj.en;
  return Array.isArray(v) ? v : v ? [v] : [];
}

/** Does the key exist (in the current language or the Russian fallback)? */
export function has(key) {
  return raw(key, current) != null;
}
