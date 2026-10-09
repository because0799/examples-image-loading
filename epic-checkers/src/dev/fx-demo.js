// FX library showcase / visual test page.
//
//   dev/fx-demo/index.html?mode=epic|classic &variant=russian|turkish|international|canadian|...
//        &quality=high|medium|low &auto=<effect> &delay=ms &panel=0|1 &flipped=0|1
//
// A button per FX primitive plus hand-made combos (capture, multi, promote, quiet, ultimate,
// victory, defeat, versus). ?auto=<name> runs it after load (and hides the panel).
//
// window.__fx (for tools/shot.mjs steps):
//   run(name)            trigger an effect / combo by name (returns its promise)
//   freeze()             stop the Pixi ticker — afterwards time only moves with advance()
//   advance(ms)          step the game deterministically by `ms` (60 fps steps) and render once
//   stats()              FX stats incl. attached filters (verify cleanup)
//   reset()              restore the demo position, camera and clock
//   names                all effect names

import { Renderer } from '../render/renderer.js';
import { wait, Ease } from '../render/tween.js';
import { EPIC, CLASSIC } from '../render/palette.js';
import { VARIANTS, getVariant } from '../engine/variants.js';
import { FX } from '../fx/fx.js';

const params = new URLSearchParams(location.search);
const P = {
  mode: params.get('mode') === 'classic' ? 'classic' : 'epic',
  variant: params.get('variant') || 'russian',
  quality: params.get('quality') || 'high',
  auto: params.get('auto'),
  delay: Number(params.get('delay') || 600),
  panel: params.get('panel') != null ? params.get('panel') !== '0' : !params.get('auto'),
  flipped: params.get('flipped') === '1',
  lang: params.get('lang') === 'en' ? 'en' : 'ru',
};

const stage = document.getElementById('stage');
const slot = document.getElementById('board-slot');
const panel = document.getElementById('panel');
if (!P.panel) panel.style.display = 'none';

function layoutSlot() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const top = Math.max(64, Math.round(h * 0.1));
  const bottom = P.panel ? Math.max(120, Math.round(h * 0.3)) : Math.max(64, Math.round(h * 0.1));
  const side = Math.min(w - 12, h - top - bottom, 900);
  const x = Math.round((w - side) / 2);
  const y = Math.round(top + (h - top - bottom - side) / 2);
  Object.assign(slot.style, { left: `${x}px`, top: `${y}px`, width: `${side}px`, height: `${side}px` });
  return { x, y, width: side, height: side };
}

function variantFor(id) {
  try {
    return getVariant(id);
  } catch {
    return VARIANTS[0];
  }
}

// ------------------------------------------------------------------------------- scene
/** A showcase mid-game position + named squares used by the effects (not rules-exact). */
function buildScene(v) {
  const n = v.size;
  const turk = v.playable === 'all';
  const parity = v.darkParity != null ? v.darkParity : 1;
  const S = (r, c) => r * n + c;
  const dark = (r, c) => turk || (r + c) % 2 === parity;
  const b = new Int8Array(n * n);
  const sc = { n };
  if (turk) {
    for (let c = 0; c < n; c++) {
      b[S(1, c)] = -1;
      b[S(2, c)] = -1;
      b[S(5, c)] = 1;
      b[S(6, c)] = 1;
    }
    sc.path = [S(5, 1), S(3, 1), S(3, 3), S(1, 3)];
    sc.victims = [S(4, 1), S(3, 2), S(2, 3)];
    b[S(4, 1)] = -1;
    b[S(3, 2)] = -1;
    b[S(1, 3)] = 0;
    sc.quiet = [S(5, 6), S(4, 6)];
    sc.promo = [S(1, 6), S(0, 6)];
    b[S(1, 6)] = 1;
    sc.king = S(4, 5);
    b[S(4, 5)] = 2;
    sc.bking = S(3, 6);
    b[S(3, 6)] = -2;
  } else {
    const k = n / 2 - 1;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!dark(r, c)) continue;
        if (r < k) b[S(r, c)] = -1;
        else if (r >= n - k) b[S(r, c)] = 1;
      }
    }
    const bf = k - 1;
    const c0 = dark(bf + 3, 0) ? 0 : 1;
    sc.path = [S(bf + 3, c0), S(bf + 1, c0 + 2), S(bf - 1, c0 + 4), S(bf + 1, c0 + 6)];
    sc.victims = [S(bf + 2, c0 + 1), S(bf, c0 + 3), S(bf, c0 + 5)];
    b[sc.victims[0]] = -1;
    b[sc.victims[1]] = -1;
    b[sc.victims[2]] = -1;
    b[sc.path[1]] = 0;
    b[sc.path[2]] = 0;
    b[sc.path[3]] = 0;
    // quiet move on the right flank
    let qc = n - 1;
    while (!dark(n - k, qc)) qc--;
    // (target chosen after the kings are placed, see below)
    sc.quietFrom = S(n - k, qc);
    // promotion candidate
    let pc = n - 2;
    while (!dark(1, pc)) pc--;
    b[S(1, pc)] = 1;
    b[S(0, pc + 1 < n ? pc + 1 : pc - 1)] = 0;
    sc.promo = [S(1, pc), S(0, pc + 1 < n ? pc + 1 : pc - 1)];
    b[S(2, pc + 1 < n ? pc + 1 : pc - 1)] = 0;
    // kings
    let kc = n - 2;
    while (!dark(bf + 2, kc) || b[S(bf + 2, kc)]) kc--;
    sc.king = S(bf + 2, kc);
    b[sc.king] = 2;
    let bkc = c0 + 2;
    while (!dark(bf + 2, bkc) || b[S(bf + 2, bkc)]) bkc++;
    sc.bking = S(bf + 2, bkc);
    b[sc.bking] = -2;
    const qr = Math.floor(sc.quietFrom / n) - 1;
    const qcol = sc.quietFrom % n;
    const qt = [qcol - 1, qcol + 1].find((c) => c >= 0 && c < n && !b[S(qr, c)]);
    sc.quiet = [sc.quietFrom, S(qr, qt != null ? qt : qcol - 1)];
  }
  sc.board = b;
  return sc;
}

// ------------------------------------------------------------------------------- main
const renderer = new Renderer(stage);
let variant = variantFor(P.variant);
let scene = buildScene(variant);
let fx = null;
let kingAura = null;
let frozen = false;

const C = (sq) => renderer.squareCenter(sq);
const sqPx = () => renderer.squareSize;
const sideColor = (s) => (fx.epic ? EPIC.side[s] : CLASSIC.gold);

function reset() {
  if (fx) fx.clear();
  kingAura = null;
  renderer.camera.snap();
  renderer.clock.setScale(1);
  renderer.highlights.clear(true);
  renderer.setPosition({ size: scene.n, board: scene.board.slice(), turn: 1 });
  renderer.setTurnGlow(1);
}

function angleOf(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// ------------------------------------------------------------------------------- single primitives
const E = {};
const victim = () => C(scene.victims[0]);
const attacker = () => C(scene.path[0]);

E.spark = () => fx.burst(victim().x, victim().y, { kind: 'spark', color: sideColor(1) });
E.dust = () => fx.burst(victim().x, victim().y, { kind: 'dust' });
E.shards = () => fx.burst(victim().x, victim().y, { kind: 'shards', color: sideColor(-1), angle: angleOf(attacker(), victim()) });
E.embers = () => fx.burst(victim().x, victim().y, { kind: 'embers' });
E.energy = () => fx.burst(victim().x, victim().y, { kind: 'energy', color: sideColor(1) });
E.energyIn = () => fx.burst(victim().x, victim().y, { kind: 'energy', color: EPIC.gold, inward: true });
E.petals = () => fx.burst(renderer.boardCenter.x, renderer.boardCenter.y, { kind: 'petals' });
E.confetti = () => fx.burst(renderer.boardCenter.x, renderer.boardCenter.y + sqPx() * 2, { kind: 'confetti' });
E.smoke = () => fx.burst(victim().x, victim().y, { kind: 'smoke' });
E.stars = () => fx.burst(victim().x, victim().y, { kind: 'stars' });
E.fire = () => fx.burst(victim().x, victim().y, { kind: 'fire' });
E.shockwave = () => fx.shockwave(victim().x, victim().y);
E.flash = () => fx.flash(0xffffff, { duration: 220 });
E.impactFrame = () => fx.impactFrame({ focus: victim() });
E.speedLines = () => fx.speedLines({ focus: victim(), duration: 700 });
E.focusLines = () => fx.focusLines({ focus: victim(), duration: 800 });
E.dashLines = () => fx.speedLines({ style: 'dash', angle: -Math.PI / 4, duration: 700 });
E.shake = () => fx.shake(0.6, 500);
E.slowMo = () => fx.slowMo(0.25, 800);
E.hitStop = () => fx.hitStop(300);
E.chromatic = () => fx.chromatic(1.4, 600);
E.zoomBlur = () => fx.zoomBlur(victim().x, victim().y, 0.3, 600);
E.bloomPulse = () => fx.bloomPulse(1.2, 900);
E.lightning = () => {
  const a = attacker();
  const v = C(scene.victims[2]);
  return fx.lightning(a.x, a.y, v.x, v.y, { color: sideColor(1), sky: true });
};
E.slash = () => fx.slash(victim().x, victim().y, angleOf(attacker(), victim()) - 0.5, { color: sideColor(1) });
E.kanji = () => fx.kanji('斬!', victim().x, victim().y - sqPx() * 0.5, { color: sideColor(1) });
E.kanjiDon = () => fx.kanji('ドン!', victim().x, victim().y - sqPx() * 0.4, { color: EPIC.gold, exit: 'shatter' });
E.kanjiBurst = () => fx.kanji('БАХ!', victim().x, victim().y - sqPx() * 0.4, { color: sideColor(-1), backdrop: 'burst', exit: 'fade' });
E.kanjiScreen = () => fx.kanji('勝利', renderer.screen.width / 2, renderer.screen.height * 0.3, { screen: true, color: EPIC.gold, duration: 1400, exit: 'fade' });
E.banner = () => fx.banner('ПРОБУЖДЕНИЕ', { sub: 'ДАМКА ВОССТАЛА ИЗ ПЕПЛА', style: 'gold' });
E.bannerVictory = () => fx.banner('ПОБЕДА!', { sub: 'БЕЗУПРЕЧНО · 0 ПОТЕРЬ', style: 'victory', duration: 2200 });
E.bannerDefeat = () => fx.banner('ПОРАЖЕНИЕ', { sub: 'Я вернусь сильнее…', style: 'defeat' });
E.cutIn = () => fx.cutIn({ title: 'ТЫСЯЧА РАЗЯЩИХ ПРЫЖКОВ!', subtitle: 'КОМБО ×3 · УЛЬТРА', side: 'left', pieceColor: 1 });
E.cutInRight = () => fx.cutIn({ title: 'АЛЫЙ ШТОРМ', subtitle: 'ЧЁРНЫЕ НАНОСЯТ УДАР', side: 'right', pieceColor: -1, king: true });
let comboN = 1;
E.combo = () => {
  comboN = comboN >= 7 ? 2 : comboN + 1;
  return fx.comboCounter(comboN);
};
E.comboRun = async () => {
  for (let n = 2; n <= 5; n++) {
    fx.comboCounter(n);
    await wait(380, { clock: renderer.clock, realtime: true });
  }
  return true;
};
E.pillar = () => {
  const p = C(scene.promo[0]);
  return fx.pillar(p.x, p.y);
};
E.aura = () => {
  if (kingAura) {
    const a = kingAura;
    kingAura = null;
    return a.stop();
  }
  const v = renderer.pieceAt(scene.king);
  if (!v) return Promise.resolve(false);
  kingAura = fx.aura(v, { color: fx.epic ? EPIC.gold : CLASSIC.goldLight });
  const v2 = renderer.pieceAt(scene.bking);
  if (v2 && fx.epic) fx.aura(v2, { color: EPIC.black });
  return Promise.resolve(true);
};
E.afterimages = async () => {
  const [a, b] = scene.quiet;
  const v = renderer.pieceAt(a);
  if (!v) return false;
  fx.afterimages(v, { duration: 520 });
  await renderer.movePiece(a, b, { duration: 420, arc: 0.4 });
  await wait(300, { clock: renderer.clock });
  fx.afterimages(v, { duration: 520 });
  await renderer.movePiece(b, a, { duration: 420, arc: 0.4 });
  return true;
};
E.crack = () => fx.crack(victim().x, victim().y, { color: sideColor(1) });
E.menacing = () => {
  const k = C(scene.bking);
  return fx.menacing(k.x, k.y);
};
E.explosion = () => fx.explosion(victim().x, victim().y);
E.charge = () => fx.charge(victim().x, victim().y, { color: sideColor(1), duration: 900 });
E.rays = () => fx.rays(victim().x, victim().y, { color: EPIC.gold });
E.weatherPetals = () => fx.weather('petals', { duration: 3000 });
E.weatherRain = () => fx.weather('rain', { duration: 2500 });
E.grade = () => fx.grade({ duration: 2200 });
E.vignette = () => fx.vignette(0x000000, { alpha: 0.8, duration: 1400 });
/** Static sheet of every lettering style (for tuning the text renderer). */
E.lettering = async () => {
  const A = await import('../fx/anime.js');
  const sq = sqPx();
  const scr = renderer.screen;
  const items = [
    ['斬!', A.kanjiStyle(fx, Math.round(sq * 1.85), EPIC.white)],
    ['ドン!', A.kanjiStyle(fx, Math.round(sq * 1.85), EPIC.gold)],
    ['БАХ!', A.kanjiStyle(fx, Math.round(sq * 1.6), EPIC.black)],
    ['覚醒', A.kanjiStyle(fx, Math.round(sq * 1.85), EPIC.gold)],
    ['ПРОБУЖДЕНИЕ', A.titleStyle(fx, 52, EPIC.gold, 'epic')],
    ['ДАМКА ВОССТАЛА', A.subStyle(fx, 20, EPIC.gold, 'epic')],
    ['ПОРАЖЕНИЕ', A.titleStyle(fx, 46, 0x4f5c7a, 'defeat')],
    ['Победа', A.titleStyle(fx, 46, CLASSIC.gold, 'classic')],
  ];
  const box = new (await import('pixi.js')).Container();
  fx.c.screenUI.addChild(box);
  let y = 40;
  const made = [];
  for (const [t, st] of items) {
    await document.fonts.load(`${st.weight || 400} ${st.size}px ${st.font}`, t);
    const tex = fx.textures.text(t, st);
    const s = fx._sprite(tex, box);
    const sc = Math.min(1, (scr.width * 0.95) / tex.width);
    s.scale.set(sc);
    s.position.set(scr.width / 2, y + (tex.height * sc) / 2);
    y += tex.height * sc - 4;
    made.push([s, tex]);
  }
  await wait(2500, { clock: renderer.clock, realtime: true });
  for (const [s, tex] of made) {
    fx._free(s);
    fx.textures.releaseText(tex);
  }
  box.destroy();
  return true;
};

// ------------------------------------------------------------------------------- combos
const X = {};

/** One capture: punch + hit-stop + impact frame + slash + shards + shockwave + kanji + shake. */
X.capture = async () => {
  reset();
  const sq = sqPx();
  const [from, to] = scene.path;
  const vSq = scene.victims[0];
  const a = C(from);
  const v = C(vSq);
  const ang = angleOf(a, v);
  const view = renderer.pieceAt(from);
  const cam = renderer.camera;
  if (fx.epic) {
    fx.afterimages(view, { duration: 360 });
    fx.speedLines({ focus: v, duration: 420, density: 0.7 });
    cam.focus(v.x, v.y, 1.18, 260, Ease.outCubic);
  }
  let hit = false;
  const mv = renderer.movePiece(from, to, {
    arc: 0.85,
    duration: 360,
    onUpdate: (e) => {
      if (hit || e < 0.48) return;
      hit = true;
      cam.punch(fx.epic ? 1.1 : 1.03, 280);
      fx.hitStop(110);
      fx.impactFrame({ focus: v });
      fx.slash(v.x, v.y, ang - 0.55, { color: sideColor(1) });
      renderer.removePiece(vSq, { duration: 220 });
      fx.burst(v.x, v.y, { kind: 'shards', color: sideColor(-1), angle: ang });
      fx.burst(v.x, v.y, { kind: fx.epic ? 'spark' : 'stars', color: sideColor(1) });
      fx.shockwave(v.x, v.y);
      fx.crack(v.x, v.y, { color: sideColor(1) });
      fx.kanji('斬!', v.x, v.y - sq * 0.75, { color: sideColor(1), delay: 140 });
      fx.shake(0.55, 420, { angle: ang });
      fx.chromatic(1, 280);
    },
  });
  await mv;
  fx.burst(C(to).x, C(to).y, { kind: 'dust' });
  await wait(420, { clock: renderer.clock });
  await cam.reset(320);
  return true;
};

/** Triple capture: slow-mo, camera follow, combo counter, lightning chain, cut-in finale. */
X.multi = async () => {
  reset();
  const sq = sqPx();
  const path = scene.path;
  const cam = renderer.camera;
  const victims = scene.victims;
  const col = sideColor(1);
  if (fx.epic) fx.slowMo(0.55, 2200, { inMs: 120, outMs: 300 });
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    const vSq = victims[i - 1];
    const v = C(vSq);
    const a = C(from);
    const ang = angleOf(a, v);
    const view = renderer.pieceAt(from);
    cam.focus(v.x, v.y, fx.epic ? 1.3 : 1.1, 300, Ease.inOutCubic);
    if (fx.epic) fx.afterimages(view, { duration: 360 });
    let hit = false;
    await renderer.movePiece(from, to, {
      arc: 0.85,
      duration: 380,
      onUpdate: (e) => {
        if (hit || e < 0.5) return;
        hit = true;
        cam.punch(1.08, 240);
        fx.hitStop(80);
        if (i === 1) fx.impactFrame({ focus: v, frames: 2, duration: 80 });
        fx.slash(v.x, v.y, ang + (i % 2 ? -0.6 : 0.6), { color: col, flip: i % 2 === 0 });
        renderer.removePiece(vSq, { duration: 200 });
        fx.burst(v.x, v.y, { kind: 'shards', color: sideColor(-1), angle: ang });
        fx.shockwave(v.x, v.y, { strength: 0.8 });
        fx.shake(0.45, 360, { angle: ang });
        if (i > 1) fx.comboCounter(i);
        if (i > 1) {
          const pv = C(victims[i - 2]);
          fx.lightning(pv.x, pv.y, v.x, v.y, { color: col, branches: 2 });
        }
        fx.kanji(i === 1 ? '斬!' : i === 2 ? 'ドン!' : 'БАХ!', v.x, v.y - sq * 0.7, { color: col, duration: 700 });
      },
    });
  }
  const end = C(path[path.length - 1]);
  fx.cutIn({ title: 'ТЫСЯЧА РАЗЯЩИХ ПРЫЖКОВ!', subtitle: 'ТРОЙНОЙ УДАР', side: 'left', pieceColor: 1, duration: 1100 });
  await wait(250, { clock: renderer.clock, realtime: true });
  fx.explosion(end.x, end.y, { color: col });
  fx.flash(0xffffff, { duration: 260, alpha: 0.7 });
  fx.chromatic(1.2, 420);
  fx.bloomPulse(1, 700);
  fx.shake(0.8, 560);
  await cam.reset(420, Ease.inOutCubic, { realtime: true });
  await wait(900, { clock: renderer.clock, realtime: true });
  return true;
};

/** Promotion «ПРОБУЖДЕНИЕ»: pillar from the sky, energy spiral, 覚醒, crown, permanent aura. */
X.promote = async () => {
  reset();
  const sq = sqPx();
  const [from, to] = scene.promo;
  const p = C(to);
  const cam = renderer.camera;
  await renderer.movePiece(from, to, { arc: 0.5, duration: 360 });
  if (fx.epic) {
    cam.focus(p.x, p.y, 1.25, 400);
    fx.charge(p.x, p.y, { color: EPIC.gold, duration: 420 });
    await wait(380, { clock: renderer.clock });
  }
  fx.pillar(p.x, p.y, { duration: 1500 });
  fx.shake(0.4, 500);
  fx.flash(fx.epic ? EPIC.gold : 0xfff1d0, { duration: 260, alpha: 0.5 });
  await wait(fx.epic ? 140 : 220, { clock: renderer.clock });
  renderer.setPieceKing(to, true, { animate: true });
  fx.kanji(fx.epic ? '覚醒' : 'Дамка!', p.x, p.y - sq * 0.9, { color: EPIC.gold, exit: 'fade', duration: 1300 });
  if (fx.epic) fx.banner('ПРОБУЖДЕНИЕ', { sub: 'ДАМКА ВОССТАЛА', style: 'gold', y: renderer.screen.height * 0.2, duration: 1500 });
  await wait(900, { clock: renderer.clock });
  const v = renderer.pieceAt(to);
  if (v) fx.aura(v, { color: fx.epic ? EPIC.gold : CLASSIC.goldLight });
  await cam.reset(400);
  return true;
};

/** Quiet move: dash with speed lines and afterimages, landing ring + dust + micro-shake. */
X.quiet = async () => {
  reset();
  const [a, b] = scene.quiet;
  const view = renderer.pieceAt(a);
  const pa = C(a);
  const pb = C(b);
  fx.afterimages(view, { duration: 300 });
  if (fx.epic) fx.speedLines({ style: 'dash', angle: angleOf(pa, pb), duration: 380, density: 0.6 });
  await renderer.movePiece(a, b, { duration: 300, arc: 0.25, ease: Ease.inOutCubic });
  fx.burst(pb.x, pb.y, { kind: 'dust', count: 10 });
  fx.shockwave(pb.x, pb.y, { strength: 0.35, radius: 1.3, duration: 380 });
  fx.shake(0.14, 220);
  await wait(500, { clock: renderer.clock });
  return true;
};

/** Ultimate: charge, cut-in, then everything at once. */
X.ultimate = async () => {
  reset();
  const v = victim();
  const cam = renderer.camera;
  cam.focus(v.x, v.y, 1.2, 500);
  fx.menacing(v.x, v.y, { count: 3, duration: 1300 });
  await fx.charge(v.x, v.y, { color: EPIC.white, duration: 700 });
  fx.cutIn({ title: 'УЛЬТИМЕЙТ!', subtitle: 'ЯРОСТЬ НА МАКСИМУМЕ', side: 'right', pieceColor: 1, king: true, duration: 1000 });
  await wait(1000, { clock: renderer.clock, realtime: true });
  fx.hitStop(160);
  fx.impactFrame({ focus: v, frames: 4, duration: 150 });
  renderer.removePiece(scene.victims[0], { duration: 200 });
  fx.crack(v.x, v.y, { color: EPIC.white, size: 3 });
  await wait(150, { clock: renderer.clock, realtime: true });
  fx.explosion(v.x, v.y, { color: EPIC.white, size: 1.3 });
  fx.burst(v.x, v.y, { kind: 'shards', color: EPIC.black, count: 30 });
  fx.zoomBlur(v.x, v.y, 0.3, 480);
  fx.chromatic(1.4, 480);
  fx.bloomPulse(1.2, 800);
  fx.flash(0xffffff, { duration: 240, alpha: 0.55 });
  fx.kanji('必殺', v.x, v.y - sqPx() * 0.6, { color: EPIC.gold, size: sqPx() * 2.3, duration: 1300, delay: 80 });
  fx.shake(1, 700);
  await wait(600, { clock: renderer.clock, realtime: true });
  await cam.reset(500);
  return true;
};

X.victory = async () => {
  const scr = renderer.screen;
  fx.rays(scr.width / 2, scr.height * 0.42, { screen: true, color: fx.epic ? EPIC.gold : CLASSIC.goldLight, duration: 3000 });
  fx.weather('confetti', { duration: 2600 });
  if (fx.epic) fx.weather('petals', { duration: 3200 });
  fx.bloomPulse(0.9, 900);
  if (fx.epic) fx.kanji('勝利', scr.width / 2, scr.height * 0.25, { screen: true, color: EPIC.gold, duration: 2600, exit: 'fade' });
  await fx.banner(fx.epic ? 'ПОБЕДА!' : 'Победа', { sub: 'БЕЗУПРЕЧНО · КОМБО ×4', style: 'victory', duration: 2600, y: scr.height * 0.45 });
  return true;
};

X.defeat = async () => {
  fx.grade({ duration: 3200 });
  fx.weather('rain', { duration: 3000 });
  fx.vignette(0x000000, { alpha: 0.7, duration: 3200 });
  await fx.banner('ПОРАЖЕНИЕ', { sub: 'Я вернусь сильнее…', style: 'defeat', duration: 2600 });
  return true;
};

X.versus = async () => {
  const scr = renderer.screen;
  fx.cutIn({ title: 'БЕЛЫЕ', subtitle: 'УРОВЕНЬ СИЛЫ 9000', side: 'left', pieceColor: 1, y: scr.height * 0.3, duration: 1700 });
  await wait(250, { clock: renderer.clock, realtime: true });
  fx.cutIn({ title: 'ЧЁРНЫЕ', subtitle: 'ГРОССМЕЙСТЕР', side: 'right', pieceColor: -1, y: scr.height * 0.62, duration: 1450 });
  await wait(350, { clock: renderer.clock, realtime: true });
  fx.kanji('対決', scr.width / 2, scr.height * 0.46, { screen: true, color: EPIC.gold, duration: 1200, size: Math.min(150, scr.width * 0.34) });
  fx.flash(0xffffff, { duration: 200, alpha: 0.6 });
  fx.shake(0.5, 400);
  await wait(1400, { clock: renderer.clock, realtime: true });
  return true;
};

const ALL = { ...E, ...X };

// ------------------------------------------------------------------------------- UI
function buildPanel() {
  const grid = document.getElementById('grid');
  const add = (title, names, cls) => {
    const h = document.createElement('h3');
    h.textContent = title;
    grid.appendChild(h);
    for (const name of names) {
      const b = document.createElement('button');
      b.textContent = name;
      if (cls) b.className = cls;
      b.onclick = () => run(name);
      grid.appendChild(b);
    }
  };
  add('combos', Object.keys(X), 'combo');
  add('primitives', Object.keys(E));
  const modeBtn = document.getElementById('mode');
  const qBtn = document.getElementById('q');
  const sync = () => {
    modeBtn.textContent = fx.mode;
    qBtn.textContent = fx.quality;
  };
  modeBtn.onclick = () => {
    const m = fx.mode === 'epic' ? 'classic' : 'epic';
    fx.setMode(m);
    renderer.setTheme(m);
    reset();
    sync();
  };
  qBtn.onclick = () => {
    const order = ['high', 'medium', 'low'];
    const q = order[(order.indexOf(fx.quality) + 1) % 3];
    fx.setQuality(q);
    renderer.setQuality(q);
    sync();
  };
  document.getElementById('clr').onclick = () => reset();
  document.getElementById('tog').onclick = () => panel.classList.toggle('collapsed');
  sync();
}

let busy = false;
async function run(name) {
  const fn = ALL[name];
  if (!fn) {
    console.warn('unknown effect', name);
    return false;
  }
  if (X[name]) {
    if (busy) return false;
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  }
  return fn();
}

function advance(ms, step = 1000 / 60) {
  const t = renderer.app.ticker;
  const n = Math.max(1, Math.round(ms / step));
  for (let i = 0; i < n - 1; i++) renderer._tick({ deltaMS: step });
  t.update(t.lastTime + step);
  return fx.stats();
}

(async () => {
  await renderer.init({ quality: P.quality });
  renderer.setTheme(P.mode);
  renderer.setVariant(variant, { flipped: P.flipped });
  renderer.setBoardRect(layoutSlot());
  window.addEventListener('resize', () => renderer.setBoardRect(layoutSlot()));
  fx = new FX({ renderer, quality: P.quality, mode: P.mode });
  fx.setLang(P.lang);
  reset();
  await fx.preload(['覚醒', '必殺', '勝利', '対決', 'БАХ!']);
  if (P.panel) buildPanel();
  window.__fx = {
    fx,
    renderer,
    run,
    names: Object.keys(ALL),
    reset,
    stats: () => fx.stats(),
    freeze: () => {
      frozen = true;
      renderer.app.ticker.stop();
      return true;
    },
    unfreeze: () => {
      frozen = false;
      renderer.app.ticker.start();
      return true;
    },
    advance,
    get frozen() {
      return frozen;
    },
    setVariant: (id) => {
      variant = variantFor(id);
      scene = buildScene(variant);
      renderer.setVariant(variant, { flipped: P.flipped });
      reset();
    },
    ready: true,
  };
  if (P.auto) {
    await wait(P.delay, { clock: renderer.clock, realtime: true });
    window.__fx.autoPromise = run(P.auto);
  }
})();
