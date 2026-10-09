// Titles / achievements — bragging material. Names and descriptions live in i18n
// (`title.<id>.name`, `title.<id>.desc`). Each title is unlocked when `check(data)` becomes true
// for the accumulated stats (see storage.js for the data shape). `progress(data)` returns
// [current, goal] for the locked-badge progress hint.
//
// tier: 1 bronze, 2 silver, 3 gold, 4 legendary, 5 mythic (used for sorting and colours).

const winsIn = (d, id) => (d.perVariant[id] ? d.perVariant[id].wins : 0);
const variantsWon = (d) => Object.values(d.perVariant).filter((v) => v.wins > 0).length;
const clampProg = (cur, goal) => [Math.min(cur, goal), goal];

export const TITLES = [
  { id: 'first-blood', icon: '血', tier: 1, check: (d) => d.totals.wins >= 1, progress: (d) => clampProg(d.totals.wins, 1) },
  { id: 'triple', icon: '三', tier: 1, check: (d) => d.best.combo >= 3, progress: (d) => clampProg(d.best.combo, 3) },
  { id: 'marathon', icon: '長', tier: 1, check: (d) => d.best.longestGame >= 100, progress: (d) => clampProg(d.best.longestGame, 100) },
  { id: 'couch', icon: '友', tier: 1, check: (d) => d.pvpGames >= 10, progress: (d) => clampProg(d.pvpGames, 10) },
  { id: 'connoisseur', icon: '観', tier: 1, check: (d) => d.demoGames >= 5, progress: (d) => clampProg(d.demoGames, 5) },
  { id: 'unbroken', icon: '魂', tier: 1, check: (d) => d.totals.losses >= 10, progress: (d) => clampProg(d.totals.losses, 10) },
  { id: 'grinder', icon: '斬', tier: 2, check: (d) => d.best.combo >= 4, progress: (d) => clampProg(d.best.combo, 4) },
  { id: 'king-lord', icon: '王', tier: 2, check: (d) => d.totals.kingsMade >= 25, progress: (d) => clampProg(d.totals.kingsMade, 25) },
  { id: 'royal-family', icon: '冠', tier: 2, check: (d) => d.best.kings >= 3, progress: (d) => clampProg(d.best.kings, 3) },
  { id: 'hundred', icon: '百', tier: 2, check: (d) => winsIn(d, 'international') >= 1, progress: (d) => clampProg(winsIn(d, 'international'), 1) },
  { id: 'unstoppable', icon: '連', tier: 2, check: (d) => d.best.streak >= 5, progress: (d) => clampProg(Math.max(d.streak, 0), 5) },
  { id: 'devourer', icon: '喰', tier: 2, check: (d) => d.totals.captures >= 100, progress: (d) => clampProg(d.totals.captures, 100) },
  { id: 'philanthropist', icon: '逆', tier: 2, check: (d) => d.giveawayWins >= 1, progress: (d) => clampProg(d.giveawayWins, 1) },
  { id: 'lightning', icon: '速', tier: 2, check: (d) => d.best.fastestWin > 0 && d.best.fastestWin < 30, progress: null },
  { id: 'veteran', icon: '兵', tier: 2, check: (d) => d.totals.games + d.pvpGames >= 50, progress: (d) => clampProg(d.totals.games + d.pvpGames, 50) },
  { id: 'flawless', icon: '完', tier: 3, check: (d) => d.totals.flawless >= 1, progress: (d) => clampProg(d.totals.flawless, 1) },
  { id: 'hurricane', icon: '嵐', tier: 3, check: (d) => d.best.combo >= 5, progress: (d) => clampProg(d.best.combo, 5) },
  { id: 'sultan', icon: '帝', tier: 3, check: (d) => winsIn(d, 'turkish') >= 10, progress: (d) => clampProg(winsIn(d, 'turkish'), 10) },
  { id: 'tsar', icon: '皇', tier: 3, check: (d) => winsIn(d, 'russian') >= 10, progress: (d) => clampProg(winsIn(d, 'russian'), 10) },
  { id: 'giant', icon: '巨', tier: 3, check: (d) => winsIn(d, 'canadian') >= 1, progress: (d) => clampProg(winsIn(d, 'canadian'), 1) },
  { id: 'globetrotter', icon: '界', tier: 3, check: (d) => variantsWon(d) >= 5, progress: (d) => clampProg(variantsWon(d), 5) },
  { id: 'blade-master', icon: '将', tier: 3, check: (d) => d.maxLevelBeaten >= 4, progress: null },
  { id: 'protagonist', icon: '主', tier: 3, check: (d) => d.epicWins >= 10, progress: (d) => clampProg(d.epicWins, 10) },
  { id: 'legend', icon: '伝', tier: 4, check: (d) => d.best.streak >= 10, progress: (d) => clampProg(Math.max(d.streak, 0), 10) },
  { id: 'thunder', icon: '雷', tier: 4, check: (d) => d.totals.captures >= 500, progress: (d) => clampProg(d.totals.captures, 500) },
  { id: 'god', icon: '神', tier: 5, check: (d) => d.maxLevelBeaten >= 5, progress: null },
];

export const TITLE_BY_ID = Object.fromEntries(TITLES.map((x) => [x.id, x]));

/** Kanji emblem per AI level (used for avatars in EPIC mode). */
export const LEVEL_GLYPHS = { 1: '学', 2: '戦', 3: '侍', 4: '将', 5: '神' };
