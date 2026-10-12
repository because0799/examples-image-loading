// «Валькирии доски» — Japanese voice lines (ElevenLabs TTS) for every Epic / Legendary / Mythic hero.
//
// Rare heroes have NO voice (client decision). 14 voiced heroes × 4 events = 56 lines.
// Every Japanese line is ≤ 25 characters (punctuation included), original, and written in the
// hero's archetype voice. ru / en are subtitles shown under the cut-in / on the hero card.
//
// Voices are grouped by ARCHETYPE: one ElevenLabs voice per archetype, 10 voices in total.
// Only voices from the approved list of Japanese female voices are used. No male hero is Epic+, so no
// 'MALE_TBD' entry is needed.
//
// Files: assets/rpg/voice/<heroId>-<event>.mp3  (mono, 44.1 kHz, −16 LUFS integrated, trimmed
// silence, ≤ 3.5 s). The summon line also plays on the hero card's first voice button.

export const VOICE_EVENTS = ['summon', 'skill', 'ultimate', 'victory'];

export const VOICE_EVENT_NAMES = {
  summon: { ru: 'Призыв / знакомство', en: 'Summon / intro' },
  skill: { ru: 'Навык', en: 'Skill' },
  ultimate: { ru: 'Вспышка', en: 'Ultimate' },
  victory: { ru: 'Победа', en: 'Victory' },
};

export const TTS = {
  provider: 'elevenlabs',
  language: 'ja',
  // Suggested starting settings; tune per archetype by ear after the first batch.
  defaults: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
  file: (heroId, event) => `assets/rpg/voice/${heroId}-${event}.mp3`,
};

// archetype id -> ElevenLabs voice. `settings` override TTS.defaults.
export const VOICE_ARCHETYPES = {
  'radiant-sovereign': {
    name: { ru: 'Сияющая владычица', en: 'Radiant Sovereign' },
    voiceId: 'IgiTcMDSHJPIJjnlwIdM', voiceName: 'Kurea',
    voiceDesc: 'warm, expressive, mature, confident',
    why: { ru: 'Тёплая уверенная королева, которой хочется подчиняться.', en: 'A warm, confident queen you want to follow.' },
    settings: { stability: 0.5, style: 0.3 },
    heroes: ['liora'],
  },
  'eclipse-empress': {
    name: { ru: 'Императрица затмения', en: 'Eclipse Empress' },
    voiceId: 'fVUIeVRB3vuo1X2r1gMM', voiceName: 'Mithiru',
    voiceDesc: 'low, raspy, husky, mysterious',
    why: { ru: 'Низкий, с хрипотцой, скучающе-властный.', en: 'Low, husky, bored and imperious.' },
    settings: { stability: 0.55, style: 0.25 },
    heroes: ['nocturna'],
  },
  'frost-noble': {
    name: { ru: 'Ледяная аристократка', en: 'Frost Noble' },
    voiceId: 'SYjaeawCEiQrxiyl1IWh', voiceName: 'Leira',
    voiceDesc: 'elegant aristocratic young lady',
    why: { ru: 'Элегантная речь с «ですわ».', en: 'Elegant speech with "desu wa".' },
    settings: { stability: 0.5, style: 0.3 },
    heroes: ['fuyuka'],
  },
  'elder-sister': {
    name: { ru: 'Старшая сестра', en: 'Elder Sister' },
    voiceId: 'Y1JL3teRC0POFnlfftJe', voiceName: 'Ayame',
    voiceDesc: 'mature older-sister',
    why: { ru: 'Опекающая, слегка дразнящая «онээ-сан».', en: 'Protective, slightly teasing onee-san.' },
    settings: { stability: 0.45, style: 0.4 },
    heroes: ['vermilia', 'zlata'],
  },
  'cool-marksman': {
    name: { ru: 'Хладнокровная стрелица', en: 'Cool Marksman' },
    voiceId: 'JTlYtJrcTzPC71hMLOxo', voiceName: 'Yuki',
    voiceDesc: 'calm, composed, cool',
    why: { ru: 'Ровный, собранный голос снайпера.', en: "A sniper's even, composed voice." },
    settings: { stability: 0.6, style: 0.2 },
    heroes: ['reika', 'koyuki'],
  },
  'hot-blood': {
    name: { ru: 'Горячая кровь', en: 'Hot Blood' },
    voiceId: 'oAlEJuW30knHWhA6cF0e', voiceName: 'Itsuki',
    voiceDesc: 'tomboyish, energetic, confident, lower pitch',
    why: { ru: 'Сорванцы и бойцы, рвущиеся вперёд.', en: 'Tomboys and fighters who charge ahead.' },
    settings: { stability: 0.4, style: 0.5 },
    heroes: ['tsubame', 'akane'],
  },
  'quiet-whisper': {
    name: { ru: 'Тихий шёпот', en: 'Quiet Whisper' },
    voiceId: 'cpUQFbEcX3tjJdSSiDPb', voiceName: 'Izayoi',
    voiceDesc: 'serene, soft, whispery, mysterious',
    why: { ru: 'Безмятежная жрица и молчаливая тень.', en: 'A serene priestess and a silent shadow.' },
    settings: { stability: 0.55, style: 0.25 },
    heroes: ['mizuha', 'karasu'],
  },
  'sunny-dancer': {
    name: { ru: 'Солнечная танцовщица', en: 'Sunny Dancer' },
    voiceId: 'GSFvrPXzdN7bQvY4mEAd', voiceName: 'Yuna',
    voiceDesc: 'cute, sweet, energetic anime girl',
    why: { ru: 'Жизнерадостная, звонкая.', en: 'Joyful and bright.' },
    settings: { stability: 0.4, style: 0.45 },
    heroes: ['kaede'],
  },
  trickster: {
    name: { ru: 'Озорница', en: 'Trickster' },
    voiceId: 'iTqcz0mjbxzCZAfsqojU', voiceName: 'Nao',
    voiceDesc: 'cute, playful, bright, teasing',
    why: { ru: 'Шкодливая ведьма с подколками.', en: 'A teasing, mischievous witch.' },
    settings: { stability: 0.35, style: 0.55 },
    heroes: ['volta'],
  },
  'gentle-saint': {
    name: { ru: 'Нежная святая', en: 'Gentle Saint' },
    voiceId: 'KtSs8OSniRPofXnr5PeA', voiceName: 'Sumire',
    voiceDesc: 'sweet, clear, high, breathy',
    why: { ru: 'Мягкий, светлый, с придыханием.', en: 'Soft, light and breathy.' },
    settings: { stability: 0.5, style: 0.3 },
    heroes: ['lucille'],
  },
};

// heroId -> { voice: archetype id, lines: { event: { jp, ru, en, tts? } } }
// `tts` (optional) = the exact text to send to ElevenLabs when the kanji reading is ambiguous
// (hero names, ultimate names); the on-screen subtitle always shows `jp`.
export const VOICE_LINES = {
  liora: {
    voice: 'radiant-sovereign',
    lines: {
      summon: { jp: '盤上の女王、リオラ。あなたの一手に光を。', ru: 'Королева доски, Лиора. Пусть твой ход озарится светом.', en: 'Queen of the board, Liora. May light guide your move.' },
      skill: { jp: '夜明けの裁きよ、走れ!', ru: 'Рассветный приговор — вперёд!', en: "Dawn's verdict — strike!" },
      ultimate: { jp: '冠は天に、光は地に。天后の聖歌!', tts: 'かんむりはてんに、ひかりはちに。てんこうのせいか!', ru: 'Корона — небесам, свет — земле. Гимн Небесной Дамки!', en: 'The crown to the heavens, the light to the earth. Hymn of the Celestial Queen!' },
      victory: { jp: 'よく指しました。勝利はあなたのもの。', ru: 'Прекрасно сыграно. Победа — твоя.', en: 'Well played. The victory is yours.' },
    },
  },
  nocturna: {
    voice: 'eclipse-empress',
    lines: {
      summon: { jp: '月を喰らう夜…ノクトゥルナ。跪きなさい。', ru: 'Ночь, что пожирает луну… Ноктюрна. Преклонись.', en: 'The night that devours the moon… Nocturna. Kneel.' },
      skill: { jp: '月よ、落ちなさい。', ru: 'Луна, падай.', en: 'Fall, moon.' },
      ultimate: { jp: 'すべての光に、終わりを。皇蝕!', tts: 'すべてのひかりに、おわりを。こうしょく!', ru: 'Всему свету — конец. Императорское Затмение!', en: 'An end to every light. Imperial Eclipse!' },
      victory: { jp: '退屈な夜だったわ。次はもっと楽しませて。', ru: 'Скучная выдалась ночь. В следующий раз развлеки меня получше.', en: 'What a dull night. Entertain me better next time.' },
    },
  },
  reika: {
    voice: 'cool-marksman',
    lines: {
      summon: { jp: '零華、照準よし。標的を指示して。', tts: 'れいか、しょうじゅんよし。ひょうてきをしじして。', ru: 'Рэйка. Прицел готов. Укажи цель.', en: 'Reika. Sights aligned. Designate the target.' },
      skill: { jp: '貫け、雷の線。', ru: 'Пронзи их, громовая линия.', en: 'Pierce through, line of thunder.' },
      ultimate: { jp: '天弩、全弾解放。…終わりよ。', tts: 'てんど、ぜんだんかいほう。…おわりよ。', ru: 'Небесная баллиста — полный залп. …Конец.', en: 'Heaven Ballista, full release. …It’s over.' },
      victory: { jp: '命中率百パーセント。問題なし。', ru: 'Точность — сто процентов. Без проблем.', en: 'One hundred percent accuracy. No problems.' },
    },
  },
  fuyuka: {
    voice: 'frost-noble',
    lines: {
      summon: { jp: '冬華と申します。この城、崩させはしませんわ。', tts: 'ふゆかともうします。このしろ、くずさせはしませんわ。', ru: 'Меня зовут Фуюка. Эта крепость не падёт, уж поверьте.', en: 'I am Fuyuka. This castle shall not fall, I assure you.' },
      skill: { jp: '氷の城壁よ、立ちなさい。', ru: 'Ледяные стены, встаньте!', en: 'Rise, walls of ice.' },
      ultimate: { jp: '宮廷に永遠の冬を。お控えなさい。', ru: 'Двору — вечную зиму. Знайте своё место.', en: 'Eternal winter upon the court. Mind your place.' },
      victory: { jp: '当然の結果ですわ。お茶にしましょう。', ru: 'Закономерный итог. А теперь — чаю.', en: 'A natural outcome. Now, shall we have tea?' },
    },
  },
  vermilia: {
    voice: 'elder-sister',
    lines: {
      summon: { jp: 'ヴァーミリア、灰より参上。火傷に気をつけてね。', ru: 'Вермилия восстала из пепла. Смотри не обожгись.', en: 'Vermilia, risen from the ashes. Careful not to get burned.' },
      skill: { jp: '舞いなさい、炎の扇。', ru: 'Танцуй, огненный веер!', en: 'Dance, fan of flames!' },
      ultimate: { jp: '最後の一手は、不死鳥が指すの!', ru: 'Последний ход сделает феникс!', en: 'The final move belongs to the phoenix!' },
      victory: { jp: 'ふふ、熱かったでしょう?またね。', ru: 'Хи-хи, жарковато было? До встречи.', en: 'Heh, a little too hot for you? See you.' },
    },
  },
  tsubame: {
    voice: 'hot-blood',
    lines: {
      summon: { jp: '燕参上!風より速く、ついて来いよ!', tts: 'つばめさんじょう!かぜよりはやく、ついてこいよ!', ru: 'Цубамэ здесь! Быстрее ветра — не отставай!', en: "Tsubame's here! Faster than the wind — keep up!" },
      skill: { jp: 'ひと筆で、斬る!', ru: 'Одним росчерком — разрежу!', en: 'One stroke — slash!' },
      ultimate: { jp: '千の羽根、嵐になれ!', ru: 'Тысяча перьев — станьте бурей!', en: 'A thousand feathers — become the storm!' },
      victory: { jp: 'へへっ、楽勝!次はもっと速い奴を頼む!', ru: 'Хе-хе, легкотня! В следующий раз подавай кого побыстрее!', en: 'Heh, easy win! Bring me someone faster next time!' },
    },
  },
  mizuha: {
    voice: 'quiet-whisper',
    lines: {
      summon: { jp: '潮の音が呼びました。瑞葉、お側に。', tts: 'しおのねがよびました。みずは、おそばに。', ru: 'Меня позвал шум прибоя. Мидзуха — рядом с тобой.', en: 'The sound of the tide called me. Mizuha, at your side.' },
      skill: { jp: '鈴の音に、癒やしを。', ru: 'Пусть звон колокольчика исцелит.', en: "Let the bell's chime bring healing." },
      ultimate: { jp: '満ちて、満ちて…大潮よ。', ru: 'Прибывай, прибывай… Высокая вода.', en: 'Rise, rise… high tide.' },
      victory: { jp: '波が静まりました。皆さん、ご無事で何より。', ru: 'Волны утихли. Как хорошо, что все целы.', en: "The waves have calmed. I'm so glad everyone is safe." },
    },
  },
  akane: {
    voice: 'hot-blood',
    lines: {
      summon: { jp: '茜、推参!一歩も退かないからね!', tts: 'あかね、すいさん!いっぽもひかないからね!', ru: 'Аканэ прибыла! Ни шагу назад, так и знай!', en: "Akane, here to fight! I won't take a single step back!" },
      skill: { jp: '緋の三日月、斬り裂け!', tts: 'ひのみかづき、きりさけ!', ru: 'Алый полумесяц, рассеки!', en: 'Scarlet crescent, cleave!' },
      ultimate: { jp: '昇れ、緋色の太陽──!', tts: 'のぼれ、ひいろのたいよう──!', ru: 'Восходи, алое солнце!', en: 'Rise, scarlet sun!' },
      victory: { jp: 'よっしゃー!前に進んだ分だけ強くなる!', ru: 'Йес! Каждый шаг вперёд делает меня сильнее!', en: 'Yes! Every step forward makes me stronger!' },
    },
  },
  volta: {
    voice: 'trickster',
    lines: {
      summon: { jp: 'ヴォルタちゃん登場!ビリッとさせてあげる♪', ru: 'Вольта на сцене! Сейчас тебя слегка тряхнёт♪', en: "Volta's here! Let me give you a little jolt♪" },
      skill: { jp: 'ほら、お友達のビリビリ玉!', ru: 'Держи — мой дружок, искрящийся шарик!', en: 'Here — meet my buddy, the zappy ball!' },
      ultimate: { jp: '予報どおり、落雷注意でーす!', ru: 'Как и обещал прогноз — осторожно, молнии!', en: 'Just as forecast — beware of lightning strikes!' },
      victory: { jp: 'えへへ、しびれた?また遊ぼうね!', ru: 'Хи-хи, пробрало? Давай ещё поиграем!', en: 'Hehe, did that give you a shock? Let’s play again!' },
    },
  },
  koyuki: {
    voice: 'cool-marksman',
    lines: {
      summon: { jp: '小雪です。静かに、確実に射ます。', tts: 'こゆきです。しずかに、かくじつにいます。', ru: 'Я Коюки. Стреляю тихо и наверняка.', en: "I'm Koyuki. I shoot quietly — and surely." },
      skill: { jp: '氷柱よ、降れ。', ru: 'Сосульки, падайте.', en: 'Icicles, fall.' },
      ultimate: { jp: '音もなく…吹雪は来る。', ru: 'Беззвучно… приходит метель.', en: 'Without a sound… the blizzard comes.' },
      victory: { jp: '終わりました。…雪、綺麗ですね。', ru: 'Всё закончилось. …Красивый снег, правда?', en: "It's over. …The snow is beautiful, isn't it?" },
    },
  },
  lucille: {
    voice: 'gentle-saint',
    lines: {
      summon: { jp: 'リュシールです。小さな灯りで、あなたを守ります。', ru: 'Я Люсиль. Своим маленьким огоньком я буду тебя оберегать.', en: "I'm Lucille. With my little light, I'll protect you." },
      skill: { jp: '灯りよ、勇気をあげて。', ru: 'Огонёк, подари отвагу!', en: 'Little light, give them courage.' },
      ultimate: { jp: '夜明けの祈りよ、届いて…!', ru: 'Рассветная молитва — достигни их!', en: 'Prayer of dawn — please, reach them!' },
      victory: { jp: 'みんな無事…よかったぁ。', ru: 'Все целы… Как же я рада.', en: 'Everyone’s safe… Thank goodness.' },
    },
  },
  karasu: {
    voice: 'quiet-whisper',
    lines: {
      summon: { jp: '…鴉。影の中から、見ている。', tts: '…からす。かげのなかから、みている。', ru: '…Карасу. Я наблюдаю из тени.', en: '…Karasu. Watching from the shadows.' },
      skill: { jp: '羽音は、聞こえない。', ru: 'Взмаха крыльев не услышишь.', en: "You won't hear the wingbeat." },
      ultimate: { jp: '星のない真夜中へ、おやすみ。', ru: 'Спи — в полночь без звёзд.', en: 'Sleep — into a starless midnight.' },
      victory: { jp: '任務完了。…少しだけ、褒めて。', ru: 'Задание выполнено. …Похвали меня. Чуть-чуть.', en: 'Mission complete. …Praise me. Just a little.' },
    },
  },
  zlata: {
    voice: 'elder-sister',
    lines: {
      summon: { jp: 'ズラータよ。お姉さんの後ろに隠れてなさい。', ru: 'Я Злата. Прячься за спину старшей сестрёнки.', en: "I'm Zlata. Stay behind your big sister." },
      skill: { jp: 'さあ、こっちを見なさい!', ru: 'А ну, все смотрите сюда!', en: 'Come on, look over here!' },
      ultimate: { jp: '琥珀の砦、誰も通さないわ!', ru: 'Янтарная крепость — никто не пройдёт!', en: 'Amber fortress — no one gets through!' },
      victory: { jp: 'はい、みんなよく頑張りました。', ru: 'Вот так. Все отлично постарались.', en: 'There we go. Everyone did a great job.' },
    },
  },
  kaede: {
    voice: 'sunny-dancer',
    lines: {
      summon: { jp: '楓だよ!一緒に舞おう、くるくるっと!', ru: 'Я Каэдэ! Давай танцевать вместе — кружимся!', en: "I'm Kaede! Let's dance together — spin, spin!" },
      skill: { jp: '紅葉のつむじ風〜!', ru: 'Кленовый смерч!', en: 'Maple whirlwind!' },
      ultimate: { jp: '秋の嵐、ぜんぶ巻き込んじゃえ!', ru: 'Осенняя буря — затяни всех!', en: 'Autumn storm — sweep them all up!' },
      victory: { jp: 'やったー!ご褒美に紅葉狩り行こ!', ru: 'Ура! В награду — идём любоваться клёнами!', en: "Yay! Let's go maple-viewing as a reward!" },
    },
  },
};
