// Campaign (GDD §14–15): 3 chapters × (8 stages + boss) = 27 stages in one linear unlock order.
// STAGES are rules.CAMPAIGN entries (all original fields kept, so the battle engine can read
// rule / mechanics / bossRules / hpMult / escorts / collapseShift directly) plus the chapter's
// background, gimmick, round limit and ★★★ round target, and meta extras (order, prev/next,
// rewards, XP, recommended power, first side). Treat STAGES as read-only.

import { CAMPAIGN, ECONOMY, BOARD, battleXp } from '../data/rules.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { powerAt, lineupPower } from './progression.js';

// ---------------------------------------------------------------------------- board notation

/** 'd2' -> sq (file a..h = col 0..7, rank 1..8 = row 7..0; a1 is dark). -1 if invalid. */
export function squareIndex(name) {
  const m = /^([a-h])([1-8])$/.exec(String(name || '').toLowerCase());
  if (!m) return -1;
  const col = m[1].charCodeAt(0) - 97;
  const row = 8 - Number(m[2]);
  return row * BOARD.size + col;
}

/** sq -> 'd2'. */
export function squareName(sq) {
  const row = Math.floor(sq / BOARD.size);
  const col = sq % BOARD.size;
  return String.fromCharCode(97 + col) + (8 - row);
}

export function isDarkSquare(sq) {
  if (!Number.isInteger(sq) || sq < 0 || sq >= BOARD.size * BOARD.size) return false;
  return (Math.floor(sq / BOARD.size) + (sq % BOARD.size)) % 2 === 1;
}

/** The 8 dark deployment squares of a side (1 = player rows 6–7, -1 = enemy rows 0–1). */
export function deploySquares(side) {
  const rows = side === -1 ? BOARD.deployRows.enemy : BOARD.deployRows.player;
  const out = [];
  for (const r of rows) for (let c = 0; c < BOARD.size; c++) if ((r + c) % 2 === 1) out.push(r * BOARD.size + c);
  return out;
}

// ------------------------------------------------------------------------------- chapters/stages

const STARTER = ECONOMY.starterSquad;

/** Recommended squad power for a stage level: the starter squad at that level, C0. */
export function recommendedPower(level) {
  let sum = 0;
  for (const id of STARTER) sum += powerAt(id, level, 0);
  return sum;
}

function buildStages() {
  const out = [];
  for (const ch of CAMPAIGN) {
    ch.stages.forEach((raw, index) => {
      const boss = !!raw.boss;
      const firstClear = {
        crystals: boss ? ECONOMY.firstClear.boss : ECONOMY.firstClear.stage,
        xpScrolls: boss ? 3 : ECONOMY.firstClear.xpScrollsCh[ch.chapter - 1] || 0,
      };
      out.push({
        ...raw,
        chapter: ch.chapter,
        chapterName: ch.name,
        index,
        order: out.length,
        boss,
        bg: ch.bg,
        gimmick: ch.gimmick,
        roundLimit: raw.roundLimit || ch.roundLimit,
        threeStarRounds: raw.threeStarRounds || ch.threeStarRounds,
        first: raw.rule && raw.rule.id === 'enemyFirst' ? -1 : 1,
        rewards: { firstClear, threeStar: ECONOMY.threeStarChest, repeat: ECONOMY.repeatWin },
        xp: battleXp(raw.level),
        recommendedPower: recommendedPower(raw.level),
        prev: null,
        next: null,
      });
    });
  }
  for (let i = 0; i < out.length; i++) {
    out[i].prev = i > 0 ? out[i - 1].id : null;
    out[i].next = i + 1 < out.length ? out[i + 1].id : null;
  }
  return out;
}

export const STAGES = buildStages();
const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));
export const STAGE_IDS = STAGES.map((s) => s.id);

export const CHAPTERS = CAMPAIGN.map((ch) => ({
  chapter: ch.chapter,
  name: ch.name,
  bg: ch.bg,
  levels: ch.levels.slice(),
  roundLimit: ch.roundLimit,
  threeStarRounds: ch.threeStarRounds,
  gimmick: ch.gimmick,
  stageIds: ch.stages.map((s) => s.id),
  bossId: (ch.stages.find((s) => s.boss) || {}).id || null,
}));

export function stageById(id) {
  return STAGE_BY_ID[id] || null;
}

export function chapterOf(stageId) {
  const s = STAGE_BY_ID[stageId];
  return s ? CHAPTERS[s.chapter - 1] : null;
}

// ----------------------------------------------------------------------------------- enemies

function refl(heroId, level, extra) {
  return { heroId, level, constellation: 0, reflection: true, ...extra };
}

/**
 * Enemy Squad of a stage: [{ heroId, level, constellation: 0, reflection: true, elite?, miniBoss?,
 * boss?, hpMult?, bossRules?, mirror? }]. `profile` is needed for the mirror stage (3-8, the
 * player's current squad with its constellations at the stage level); without it the starter squad
 * is mirrored. Positions are left to the battle engine (default AI deployment, or the stage rule
 * `presetFormation` such as 1-3's ladder, which the engine owns). Always returns fresh objects.
 */
export function enemySquad(stage, profile = null) {
  const st = typeof stage === 'string' ? stageById(stage) : stage;
  if (!st) return [];
  const level = st.level;
  if (st.boss) {
    const out = [refl(st.bossHero, level, { boss: true, hpMult: st.hpMult || 1 })];
    if (st.bossRules) out[0].bossRules = JSON.parse(JSON.stringify(st.bossRules));
    for (const [id, lvl] of st.escorts || []) out.push(refl(id, lvl));
    return out;
  }
  if (st.enemies === 'mirror') {
    const ids = profile && Array.isArray(profile.squad) && profile.squad.length ? profile.squad : STARTER;
    return ids
      .filter((id) => HERO_BY_ID[id])
      .map((id) => {
        const e = profile && profile.heroes && profile.heroes[id];
        return refl(id, level, { constellation: e ? e.constellation | 0 : 0, mirror: true });
      });
  }
  const elites = new Set(st.elite || []);
  let miniBossUsed = false;
  const out = (st.enemies || []).map((id) => {
    const e = refl(id, level);
    if (elites.has(id)) e.elite = true;
    if (st.miniBoss && st.miniBoss.hero === id && !miniBossUsed) {
      miniBossUsed = true;
      e.miniBoss = true;
      e.hpMult = st.miniBoss.hpMult || 1;
    }
    return e;
  });
  return out;
}

/** Power of a stage's enemy lineup (boss HP multipliers not included). */
export function enemyPower(stage, profile = null) {
  return lineupPower(enemySquad(stage, profile));
}

// ------------------------------------------------------------------------------- unlocks/stars

export function stageRecord(profile, stageId) {
  const r = profile && profile.campaign && profile.campaign[stageId];
  return r || { stars: 0, cleared: false, clears: 0, attempts: 0, lossStreak: 0, bestRounds: 0 };
}

/** Linear unlock: 1-1 is open; every other stage needs the previous one cleared. */
export function isUnlocked(profile, stageId) {
  const st = STAGE_BY_ID[stageId];
  if (!st) return false;
  if (!st.prev) return true;
  return !!stageRecord(profile, st.prev).cleared;
}

export function isCleared(profile, stageId) {
  return !!stageRecord(profile, stageId).cleared;
}

/** First unlocked stage that is not cleared yet (null when the campaign is complete). */
export function nextStage(profile) {
  for (const s of STAGES) if (!isCleared(profile, s.id)) return isUnlocked(profile, s.id) ? s : null;
  return null;
}

export function isChapterUnlocked(profile, chapter) {
  const ch = CHAPTERS[chapter - 1];
  return !!ch && isUnlocked(profile, ch.stageIds[0]);
}

/**
 * Stars for a finished battle (GDD §14): ★ win · ★★ win with ≤ 1 hero KO'd · ★★★ win with no KO
 * within `threeStarRounds` rounds. 0 when not won.
 */
export function computeStars({ won, lost = 0, rounds = 0, threeStarRounds = Infinity }) {
  if (!won) return 0;
  if (lost <= 0 && rounds <= threeStarRounds) return 3;
  if (lost <= 1) return 2;
  return 1;
}

/** Star conditions of a stage, for the stage sheet / results screen. */
export function starConditions(stage) {
  const st = typeof stage === 'string' ? stageById(stage) : stage;
  if (!st) return [];
  return [
    { stars: 1, text: { ru: 'Победа', en: 'Victory' } },
    { stars: 2, text: { ru: 'Выбыло не больше одной героини', en: 'No more than one hero knocked out' } },
    {
      stars: 3,
      text: {
        ru: `Без потерь, не позже ${st.threeStarRounds}-го раунда`,
        en: `No losses, by round ${st.threeStarRounds}`,
      },
    },
  ];
}

export function chapterProgress(profile, chapter) {
  const ch = CHAPTERS[chapter - 1];
  if (!ch) return null;
  let cleared = 0;
  let stars = 0;
  for (const id of ch.stageIds) {
    const r = stageRecord(profile, id);
    if (r.cleared) cleared++;
    stars += r.stars | 0;
  }
  return {
    chapter,
    cleared,
    total: ch.stageIds.length,
    stars,
    maxStars: ch.stageIds.length * 3,
    unlocked: isChapterUnlocked(profile, chapter),
    bossCleared: isCleared(profile, ch.bossId),
    complete: cleared === ch.stageIds.length,
  };
}

export function campaignProgress(profile) {
  const chapters = CHAPTERS.map((c) => chapterProgress(profile, c.chapter));
  return {
    chapters,
    cleared: chapters.reduce((a, c) => a + c.cleared, 0),
    total: STAGES.length,
    stars: chapters.reduce((a, c) => a + c.stars, 0),
    maxStars: STAGES.length * 3,
    threeStarStages: STAGES.filter((s) => stageRecord(profile, s.id).stars >= 3).length,
    next: nextStage(profile),
  };
}

/** «Авто-бой ×2» is available once a stage was cleared manually (GDD §16). */
export function canAutoBattle(profile, stageId) {
  return isCleared(profile, stageId);
}

/**
 * Help after defeats (GDD §14.4): after 2 losses in a row on a stage the UI shows a hint and a
 * «Тренировка на этом уровне» button. -> { show, lossStreak, trainingLevel, enemyElements,
 * enemyRoles, counterElements }
 */
export function stageAdvice(profile, stageId) {
  const st = stageById(stageId);
  if (!st) return null;
  const rec = stageRecord(profile, stageId);
  const squad = enemySquad(st, profile);
  const count = (key) => {
    const m = {};
    for (const u of squad) {
      const h = HERO_BY_ID[u.heroId];
      if (h) m[h[key]] = (m[h[key]] || 0) + 1;
    }
    return m;
  };
  const enemyElements = count('element');
  const enemyRoles = count('role');
  // Element multipliers (GDD §5): Radiance ↔ Umbra ×1.3 both ways; a hero takes ×0.8 from her own
  // element, so an element shared by several enemies is a poor choice against this lineup.
  const counterElements = [];
  if (enemyElements.umbra) counterElements.push('radiance');
  if (enemyElements.radiance) counterElements.push('umbra');
  const avoidElements = Object.keys(enemyElements).filter((el) => enemyElements[el] >= 2);
  return {
    show: (rec.lossStreak | 0) >= 2,
    lossStreak: rec.lossStreak | 0,
    trainingLevel: st.level,
    recommendedPower: st.recommendedPower,
    enemyElements,
    enemyRoles,
    counterElements,
    avoidElements,
  };
}
