// Render module showcase / visual test page.
//
//   dev/render-demo/index.html?variant=russian|turkish|international|canadian|english|italian|...
//        &theme=classic|epic &flipped=0|1 &anim=0|1 &hl=0|1|2 &quality=high|medium|low &hud=0|1
//
//   hl=1  quiet-move selection: selectable rings, selected piece, target dots, last move, hint path
//   hl=2  capture entry: selected piece, partial multi-jump trail, capture target
//   anim=1 loops: quiet moves, a slow-mo triple capture with camera follow / punch / shake,
//          promotion, camera focus + dutch angle, reset
//
// window.__demo exposes the renderer and helpers for tools/shot.mjs steps, e.g.
//   {"eval":"__demo.capture()"} {"burst":{"name":"cap","count":12,"interval":90}}

import { Renderer } from '../render/renderer.js';
import { tween, wait, Ease } from '../render/tween.js';
import { VARIANTS, getVariant } from '../engine/variants.js';

const params = new URLSearchParams(location.search);
const P = {
  variant: params.get('variant') || 'russian',
  theme: params.get('theme') === 'epic' ? 'epic' : 'classic',
  flipped: params.get('flipped') === '1',
  anim: params.get('anim') === '1',
  hl: Number(params.get('hl') ?? 1),
  quality: params.get('quality') || 'high',
  hud: params.get('hud') === '1',
};

// ------------------------------------------------------------------------------- page
document.body.style.margin = '0';
document.body.style.background = '#000';
const stage = document.createElement('div');
stage.id = 'stage';
Object.assign(stage.style, { position: 'fixed', inset: '0', overflow: 'hidden' });
document.body.appendChild(stage);
const slot = document.createElement('div');
slot.id = 'board-slot';
Object.assign(slot.style, { position: 'fixed', pointerEvents: 'none' });
document.body.appendChild(slot);

function layoutSlot() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const top = Math.max(72, Math.round(h * 0.12));
  const bottom = Math.max(72, Math.round(h * 0.12));
  const side = Math.min(w - 12, h - top - bottom, 900);
  const x = Math.round((w - side) / 2);
  const y = Math.round(top + (h - top - bottom - side) / 2);
  Object.assign(slot.style, { left: `${x}px`, top: `${y}px`, width: `${side}px`, height: `${side}px` });
  return { x, y, width: side, height: side };
}

let hud = null;
if (P.hud) {
  hud = document.createElement('div');
  hud.innerHTML = `<div style="position:fixed;left:12px;right:12px;top:14px;height:48px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;font:600 15px Oswald;display:flex;align-items:center;padding:0 14px">Чёрные · Компьютер</div>
  <div style="position:fixed;left:12px;right:12px;bottom:14px;height:52px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;font:600 15px Oswald;display:flex;align-items:center;padding:0 14px">Белые · Вы</div>`;
  document.body.appendChild(hud);
}

// ------------------------------------------------------------------------------- scenes
function variantFor(id) {
  try {
    return getVariant(id);
  } catch {
    return VARIANTS[0];
  }
}

/**
 * Build a showcase mid-game position + scripted squares for the variant geometry.
 * Not rules-exact — purely visual.
 */
function buildScene(v) {
  const n = v.size;
  const turk = v.playable === 'all';
  const p = v.darkParity != null ? v.darkParity : 1;
  const S = (r, c) => r * n + c;
  const dark = (r, c) => turk || (r + c) % 2 === p;
  const b = new Int8Array(n * n);
  const sc = { n };
  if (turk) {
    for (let c = 0; c < n; c++) {
      b[S(1, c)] = -1;
      b[S(2, c)] = -1;
      b[S(5, c)] = 1;
      b[S(6, c)] = 1;
    }
    b[S(4, 1)] = -1;
    b[S(3, 2)] = -1;
    b[S(1, 3)] = 0;
    sc.capture = [S(5, 1), S(3, 1), S(3, 3), S(1, 3)];
    sc.victims = [S(4, 1), S(3, 2), S(2, 3)];
    b[S(1, 6)] = 1;
    b[S(0, 6)] = 0;
    sc.promo = [S(1, 6), S(0, 6)];
    b[S(4, 6)] = -2;
    b[S(3, 5)] = 2;
    b[S(5, 5)] = 0;
    sc.whiteQuiet = [S(5, 4), S(4, 4)];
    sc.blackQuiet = [S(2, 7), S(3, 7)];
    sc.selQuiet = S(5, 4);
    sc.selTargets = [S(4, 4), S(5, 5)];
    sc.selectable = [S(5, 0), S(5, 1), S(5, 2), S(5, 3), S(5, 4), S(5, 6), S(5, 7)];
    sc.kingSq = S(3, 5);
  } else {
    const k = n / 2 - 1;
    const rw = n - k;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!dark(r, c)) continue;
        if (r < k) b[S(r, c)] = -1;
        else if (r >= n - k) b[S(r, c)] = 1;
      }
    }
    const c0 = dark(rw, 0) ? 0 : 1;
    sc.capture = [S(rw, c0), S(k, c0 + 2), S(k - 2, c0 + 4), S(k, c0 + 6)];
    sc.victims = [S(k + 1, c0 + 1), S(k - 1, c0 + 3), S(k - 1, c0 + 5)];
    b[sc.victims[0]] = -1;
    b[S(k - 2, c0 + 4)] = 0;
    const pc = dark(1, n - 2) ? n - 2 : n - 3;
    b[S(1, pc)] = 1;
    b[S(0, pc + 1)] = 0;
    sc.promo = [S(1, pc), S(0, pc + 1)];
    const bk = dark(k + 1, n - 1) ? S(k + 1, n - 1) : S(k + 1, n - 2);
    b[bk] = -2;
    const avoid = new Set([S(k, c0 + 2), S(k, c0 + 6)]);
    let wk = -1;
    for (let c = n - 1; c >= 0; c--) {
      if (dark(k, c) && !avoid.has(S(k, c))) {
        wk = S(k, c);
        break;
      }
    }
    b[wk] = 2;
    sc.kingSq = wk;
    sc.whiteQuiet = [S(rw, c0 + 4), S(rw - 1, c0 + 3)];
    let cb = 0;
    while (!dark(k - 1, cb)) cb++;
    sc.blackQuiet = [S(k - 1, cb), cb - 1 >= 0 ? S(k, cb - 1) : S(k, cb + 1)];
    sc.selQuiet = S(rw, c0 + 4);
    sc.selTargets = [S(rw - 1, c0 + 3), S(rw - 1, c0 + 5)].filter((s) => b[s] === 0);
    sc.selectable = [];
    for (let c = 0; c < n; c++) {
      if (!dark(rw, c) || b[S(rw, c)] !== 1) continue;
      const free = [c - 1, c + 1].some((cc) => cc >= 0 && cc < n && b[S(rw - 1, cc)] === 0);
      if (free) sc.selectable.push(S(rw, c));
    }
  }
  sc.board = b;
  return sc;
}

function applyMoveToBoard(board, from, to) {
  board[to] = board[from];
  board[from] = 0;
}

// ------------------------------------------------------------------------------- main
const renderer = new Renderer(stage);
const variant = variantFor(P.variant);
let scene = buildScene(variant);
let looping = false;

function showHighlights(mode) {
  const H = renderer.highlights;
  H.clear(true);
  if (mode === 1) {
    H.setLastMove(scene.blackQuiet);
    H.setSelectable(scene.selectable);
    H.setSelected(scene.selQuiet);
    H.setTargets(scene.selTargets, { capture: false });
    H.setHint(scene.capture);
  } else if (mode === 2) {
    H.setLastMove(scene.blackQuiet);
    H.setSelectable([scene.capture[0]]);
    H.setSelected(scene.capture[0]);
    H.setPath(scene.capture.slice(0, 2));
    H.setTargets([scene.capture[2]], { capture: true });
  }
}

function staticBoard() {
  const b = scene.board.slice();
  applyMoveToBoard(b, scene.blackQuiet[0], scene.blackQuiet[1]);
  return b;
}

function reset(mode = P.hl) {
  renderer.camera.snap();
  renderer.clock.setScale(1);
  const board = mode ? staticBoard() : scene.board.slice();
  renderer.setPosition({ size: scene.n, board, turn: 1 });
  showHighlights(mode);
  renderer.setTurnGlow(1);
}

async function quiet() {
  renderer.highlights.clear(true);
  renderer.setTurnGlow(1);
  await renderer.movePiece(scene.whiteQuiet[0], scene.whiteQuiet[1], { arc: 0.3 });
  renderer.highlights.setLastMove(scene.whiteQuiet);
  renderer.camera.shake(0.1, 220);
  await wait(250);
  renderer.setTurnGlow(-1);
  await renderer.movePiece(scene.blackQuiet[0], scene.blackQuiet[1], { arc: 0.25 });
  renderer.highlights.setLastMove(scene.blackQuiet);
  renderer.camera.shake(0.1, 220);
  renderer.setTurnGlow(1);
}

async function capture({ slow = true } = {}) {
  const cam = renderer.camera;
  const path = scene.capture;
  const H = renderer.highlights;
  H.clear(true);
  renderer.setTurnGlow(1);
  if (slow) renderer.clock.setScale(0.55, 200);
  for (let i = 1; i < path.length; i++) {
    const to = renderer.squareCenter(path[i]);
    cam.focus(to.x, to.y, 1.35, 420, Ease.inOutCubic);
    const victim = scene.victims[i - 1];
    let hit = false;
    await renderer.movePiece(path[i - 1], path[i], {
      arc: 0.9,
      duration: 460,
      onUpdate: (e) => {
        if (!hit && e > 0.5) {
          hit = true;
          renderer.removePiece(victim);
          cam.punch(1.07, 240);
          cam.shake(0.45, 380);
          renderer.clock.hitStop(70);
        }
      },
    });
    H.setPath(path.slice(0, i + 1));
    await wait(120);
  }
  renderer.clock.setScale(1, 250);
  H.setPath(null);
  H.setLastMove(path);
  cam.shake(0.7, 520);
  await cam.reset(420);
}

async function promote() {
  renderer.highlights.clear(true);
  const [from, to] = scene.promo;
  await renderer.movePiece(from, to, { arc: 0.6, duration: 420 });
  renderer.camera.punch(1.05, 300);
  renderer.camera.shake(0.25, 300);
  renderer.highlights.setLastMove(scene.promo);
  await renderer.setPieceKing(to, true, { animate: true });
}

async function cameraTour() {
  const cam = renderer.camera;
  const c = renderer.squareCenter(scene.kingSq);
  await cam.focus(c.x, c.y, 1.6, 600, Ease.inOutCubic, { rotation: -0.06 });
  cam.shake(0.3, 400);
  await wait(500);
  await cam.reset(600);
}

async function loop() {
  if (looping) return;
  looping = true;
  while (looping) {
    reset(0);
    await wait(700);
    await quiet();
    await wait(300);
    await capture();
    await wait(400);
    await promote();
    await wait(500);
    await cameraTour();
    await wait(900);
  }
}

async function measureFps(ms = 2000) {
  return new Promise((resolve) => {
    let frames = 0;
    const t0 = performance.now();
    const f = () => {
      frames++;
      if (performance.now() - t0 < ms) requestAnimationFrame(f);
      else resolve(Math.round((frames * 1000) / (performance.now() - t0)));
    };
    requestAnimationFrame(f);
  });
}

(async () => {
  await renderer.init({ quality: P.quality });
  renderer.setTheme(P.theme);
  renderer.setVariant(variant, { flipped: P.flipped });
  renderer.setBoardRect(layoutSlot());
  window.addEventListener('resize', () => renderer.setBoardRect(layoutSlot()));
  reset(P.hl);
  renderer.onSquareTap((sq) => {
    console.log('square tap', sq);
    window.__demo.lastTap = sq;
  });
  renderer.onTap((e) => {
    window.__demo.lastAnyTap = e;
  });

  window.__demo = {
    renderer,
    tween,
    wait,
    Ease,
    scene,
    P,
    reset,
    quiet,
    capture,
    promote,
    cameraTour,
    loop,
    stop: () => (looping = false),
    hl: (m) => showHighlights(m),
    measureFps,
    setTheme: (t) => {
      renderer.setTheme(t);
      showHighlights(P.hl);
    },
    setVariant: (id, flipped = false) => {
      const v = variantFor(id);
      scene = buildScene(v);
      window.__demo.scene = scene;
      renderer.setVariant(v, { flipped });
      reset(P.hl);
    },
    info: () => ({
      squareSize: renderer.squareSize,
      layout: { ...renderer.layout, rect: undefined },
      res: renderer.resolution,
      pieces: renderer._live.length,
      tasks: renderer.clock.activeTasks,
    }),
    ready: true,
  };
  if (P.anim) loop();
})();
