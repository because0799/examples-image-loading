# EPIC ШАШКИ — architecture contract

Mobile checkers/draughts game for Android (APK) with many rule variants (Turkish, Russian,
International, English, …) and a special **EPIC BADASS MODE**: maximum anime-style effects and
bragging. The game is an HTML5/WebGL app (PixiJS v8 + pixi-filters) bundled with esbuild and
wrapped into a tiny native Android WebView shell. Everything is offline; no network access.

This file is the contract between modules. Each module has an owner; do not edit files you do
not own (except trivially fixing an import path) — if you need a change in another module, write
it in your final report. Public APIs below are binding; you may ADD functions/options, but do not
rename or remove the ones listed. If you must deviate, document it in your report.

## Toolchain (already set up)

- Node 22, npm deps in `package.json`: `pixi.js@8.22.0`, `pixi-filters@6.1.5`, fontsource fonts,
  `esbuild`, `playwright@1.56.1` (Chromium at /opt/pw-browsers — never run `playwright install`).
- Plain modern JavaScript (ES modules, no TypeScript, no framework). Target WebView = Chrome 87+.
- `node tools/build-web.mjs` → production bundle `dist/www/` (index.html, app.js, app.css,
  fonts.css, fonts/). Entry `src/main.js`. CSS is imported from JS (`import './styles.css'`) and
  esbuild emits `app.css`. `--dev` = unminified.
- `node tools/build-web.mjs --demo NAME` → bundles `src/dev/NAME.js` into `dist/dev/NAME/` (uses
  `src/dev/NAME.html` if present). Every module owner builds a demo page to see/test their work.
- AI worker: `src/ai/worker.js` is bundled separately and injected into app.js as the string
  constant `__AI_WORKER_SRC__` (start it with a Blob URL). `__DEV__` is a boolean constant.
- `node tools/shot.mjs --path dev/NAME/index.html?x=1 --out DIR [--viewport 390x844] [--wait ms]
  [--steps-inline '[...]']` — headless Chromium (WebGL via SwiftShader works) screenshots;
  serves `dist/` itself. You can look at PNGs with the Read tool. See the header of the file for
  step syntax (click, eval, waitFor, shot, burst).
- `node --test tests/` — unit tests (node:test). Test files: `tests/<module>/*.test.js`.
- Android packaging (no Android SDK; Debian tools): `aapt` (v14), `dalvik-exchange` (dx),
  `zipalign`, `apksigner`, platform jars in `/opt/android-jars/android-34-reginer.jar` (compile
  + link). Java must be compiled with `-source 8 -target 8` and **no lambdas** (dx limitation).
- Fonts available in CSS / Pixi (`document.fonts.load(...)` before using in Pixi Text):
  `"Dela Gothic One"` (heavy display; Latin + Cyrillic + Japanese kana/kanji — use for anime
  text), `"Russo One"` (Latin+Cyrillic display), `"Oswald"` 400/500/700 (condensed UI text),
  `"Unbounded"` 400/700/900 (wide numbers/titles), `"Rubik Mono One"`.
  Pixi text stroke: use `stroke: { color, width, join: 'round' }` (miter joins create spikes).
- Do NOT run git commands that change state (commit, checkout, stash, reset). The coordinator
  commits. Do not touch files outside `epic-checkers/`.

## Directory / ownership map

| Path | Owner | Purpose |
|---|---|---|
| `src/engine/*`, `tests/engine/*` | engine | rules of all variants, game state, notation |
| `src/ai/*`, `tests/ai/*` | ai | search, evaluation, worker, client |
| `src/render/*` | render | Pixi app, layers, camera, clock/tween, board, pieces, highlights, input |
| `src/fx/*` | fx | effects library, particles, anime FX, Director (move choreography), brag texts |
| `src/audio/*` | audio | procedural WebAudio SFX + music |
| `src/ui/*` | ui | DOM screens, HUD, CSS, i18n, settings & stats storage |
| `src/platform/*`, `android/*`, `tools/build-apk.sh`, `tools/make-icon.mjs` | platform | Android shell, JS bridge, icons, APK build |
| `src/main.js`, `src/controller.js`, `web/index.html` | integration | bootstrap, game loop, wiring |
| `src/dev/<module>-*.js/.html` | each module | demo pages (prefix with your module name) |

## Coordinates and conventions (everyone)

- Board is `size × size` (8, 10 or 12). Square index `sq = row * size + col`.
  `row 0` is the TOP of the board as seen by WHITE (= BLACK's home side), `col 0` is the left
  column as seen by WHITE. White's men move "up" (row decreasing), black's men move "down".
- Colors: `WHITE = 1`, `BLACK = -1`. Cell codes: `0` empty, `1` white man, `2` white king,
  `-1` black man, `-2` black king. `sign(code)` = color, `abs(code) === 2` → king.
- Player-facing names: WHITE = «Белые» (light pieces), BLACK = «Чёрные» (dark pieces), even in
  variants where dark moves first (English) — `variant.first` says who starts.
- Renderer may display the board flipped (BLACK at the bottom) when the human plays black; the
  engine coordinates never change.
- Language: Russian is the default UI language; English is the second language. All
  user-visible strings exist in both (`{ ru, en }` objects or the i18n table).

## 1. Engine (`src/engine/`) — public API via `src/engine/index.js`

```js
export const WHITE = 1, BLACK = -1;
export const VARIANTS;                 // ordered array of Variant objects (menu order)
export function getVariant(id): Variant;

export function createInitialState(variantId, options = { giveaway: false }): State;
export function cloneState(state): State;
export function legalMoves(state): Move[];      // fully legal (mandatory capture, maximum
                                                // capture / priority rules, dedup), deterministic order
export function applyMove(state, move): State;  // returns a NEW state, never mutates the input
export function positionResult(state, moves?): null | Result; // no pieces / no moves (with giveaway
                                                // inversion) + counter-based draw rules
export function hashState(state): string;       // position hash (board + turn) for repetition/TT
export function serializeState(state): object;  // JSON-safe (for worker postMessage / storage)
export function deserializeState(obj): State;
export function stateToString(state): string;   // compact text position, see below
export function stateFromString(variantId, str, options?): State;
export function squareName(variantId, sq): string;   // 'e3' (8x8 etc.) or '23' (10x10 numeric)
export function moveToString(variantId, move): string; // 'c3-d4', 'c3:e5:g3'
export function rcToSq(r, c, size), sqToRc(sq, size) -> [r, c];
export function isPlayableSquare(variant, r, c): boolean;
export class Game { ... }   // see below
```

**Variant** (plain object; the engine owns all rule flags, the UI only reads metadata):
```js
{
  id: 'russian', size: 8, playable: 'dark' | 'all', piecesPerSide: 12, first: 1 | -1,
  flag: '🇷🇺',
  name:  { ru: 'Русские шашки', en: 'Russian draughts' },
  short: { ru: 'one-line tagline', en: '...' },
  badges:{ ru: ['Дамка летает', 'Бой назад', ...], en: [...] },   // 2-4 key rule facts
  rules: { ru: ['paragraph', ...], en: [...] },                   // full rules for the rules screen
  ...engine-internal rule flags
}
```

**State**: `{ variantId, size, board: Int8Array(size*size), turn: 1|-1, ply, counters: {...}, options: { giveaway } }`.
Repetition history is NOT part of State (kept by `Game`).

**Move**:
```js
{
  from, to,            // squares
  path: [from, ..., to], // every landing square incl. from; quiet move = [from, to]
  captures: [sq, ...],   // captured squares in capture order ([] for quiet moves)
  captured: [code, ...], // piece codes of the captured pieces (same order)
  piece,               // code of the moving piece before the move
  promotion,           // boolean: man before, king after
  promotionAt,         // index into path where it became a king (-1 if none); may be < path.length-1
                       // in variants where a man promotes mid-capture and continues as a king
}
```
`path` uniquely identifies a move within `legalMoves(state)`; other modules match moves by path.

**Result**: `{ winner: 1 | -1 | 0, reason }`, reasons: `'no-pieces' | 'no-moves' | 'repetition' |
'move-limit' | 'resign' | 'agreement' | 'insufficient'`.

**Game** (history + undo + repetition):
```js
const g = new Game(variantId, options = { giveaway: false }, startState?);
g.variant; g.state; g.moves /* legal moves of g.state (cached) */; g.history /* [{ move, before }] */;
g.play(moveOrPath) -> Move   // throws on illegal
g.undo() -> boolean; g.canUndo;
g.result -> null | Result     // positionResult + threefold repetition etc.
g.resign(color); g.agreeDraw();
g.lastMove; g.toJSON(); Game.fromJSON(obj);
```

**Text position format** (`stateToString`): `"<w|b>:<row0>/<row1>/.../<rowN-1>"` where each row is
`size` chars: `.` empty/unplayable, `w` white man, `W` white king, `b` black man, `B` black king.
Example (Russian start): `w:.b.b.b.b/b.b.b.b./.b.b.b.b/......../......../w.w.w.w./.w.w.w.w/w.w.w.w.`
Optional `|giveaway` suffix.

Variants (menu order). Required: `russian`, `turkish`, `international`, `english`, `brazilian`,
`pool`, `italian`, `canadian`. Optional extras only if the rules are researched with confidence
(e.g. `armenian`, `spanish`, `czech`, `thai`). Option `giveaway` (поддавки) works with any
variant: the side that cannot move (no pieces or blocked) WINS.

## 2. AI (`src/ai/`)

```js
// src/ai/ai-client.js
export const AI_LEVELS = [ { id: 1..5, name: { ru, en }, epicName: { ru, en }, desc: { ru, en } } ];
export class AIClient {
  constructor({ useWorker = true } = {});         // Worker from Blob(__AI_WORKER_SRC__), fallback in-thread
  think(state, { level = 3, timeMs, historyHashes = [] } = {}) -> Promise<{ path, score, depth, nodes, timeMs }>;
  hint(state, opts?) -> Promise<{ path, ... }>;    // strong move suggestion for the human
  cancel();                                        // abort current search; its promise resolves null
  dispose();
}
// src/ai/worker.js — worker entry (bundled separately)
// src/ai/search.js  — export function search(state, opts) -> { path, score, depth, nodes } (pure, usable in Node)
```
Levels: 1 Новичок (very weak, random-ish), 2 Любитель, 3 Боец, 4 Мастер, 5 Гроссмейстер (strongest,
~2.5 s). Giveaway-aware. Must always return a legal path. Never blocks the main thread when the
worker is available.

## 3. Render (`src/render/`)

```js
// src/render/renderer.js
export class Renderer {
  constructor(hostElement);                  // creates the Pixi Application; canvas fills host
  async init({ quality = 'high' });          // 'high' | 'medium' | 'low' (resolution cap, AA)
  app;                                       // PIXI.Application
  clock;                                     // Clock (game time, slow-mo aware)
  camera;                                    // Camera (see below)
  layers: {
    background,   // screen space, behind everything (theme backdrop, animated in epic)
    world,        // camera-transformed root containing ↓ (in world coords = CSS px at zoom 1)
      board, boardFx /*decals/glows under pieces*/, highlights, pieces, worldFx /*over pieces*/,
    screenFx,     // screen space, above world (speed lines, banners, cut-ins, flashes)
    overlay,      // top-most screen space (impact frames, fades)
  };
  setTheme('classic' | 'epic');
  setVariant(variant, { flipped = false });   // builds board for the variant
  setBoardRect({ x, y, width, height });      // CSS px rect (from the DOM #board-slot)
  setPosition(state);                         // place all pieces instantly (re-sync)
  squareCenter(sq) -> { x, y };               // world coords
  squareSize;                                 // px
  squareAt(screenX, screenY) -> sq | -1;
  worldToScreen(x, y), screenToWorld(x, y);
  pieceAt(sq) -> PieceView | null;
  highlights: { setSelectable(sqs), setSelected(sq|-1), setTargets(sqs, { capture }),
                setLastMove(path), setHint(path|null), setPath(path) /*partial multi-jump*/, clear() };
  onSquareTap(fn(sq));                        // tap on a board square
  onTap(fn({ x, y, sq }));                    // any tap on the canvas (used to skip cinematics)
  // animation primitives (used by the Director):
  movePiece(fromSq, toSq, { duration, ease, arc = 0, onUpdate }) -> Promise;  // updates piece map
  removePiece(sq, { animate = true }) -> Promise;
  setPieceKing(sq, isKing, { animate = false });
  screen -> { width, height };
  destroy();
}
// src/render/tween.js
export class Clock { scale; now; realNow; setScale(v, transitionMs = 0); }   // driven by the app ticker
export function tween(target, props, { duration, ease, delay, clock, realtime, onUpdate }) -> Promise (.cancel())
export function wait(ms, { clock, realtime } = {}) -> Promise;   // game-time aware
export const Ease = { linear, inQuad, outQuad, inOutQuad, inCubic, outCubic, inOutCubic,
                      outBack, inBack, outElastic, inExpo, outExpo, inOutExpo, outBounce };
// src/render/camera.js
export class Camera { focus(x, y, zoom, ms, ease) -> Promise; reset(ms) -> Promise;
                      shake(intensity, ms); punch(zoom, ms); rotation; zoom; }
// src/render/piece-view.js
export class PieceView extends Container { color; isKing; sq; auraLayer /*Container under the piece*/;
                      setKing(bool, animate); setSelected(bool); setDim(bool); }
```
All animations in world/screen FX must run on `renderer.clock` (so slow-mo / hit-stop work), unless
explicitly real-time (UI-ish banners may opt into realtime).

## 4. FX + Director (`src/fx/`)

```js
// src/fx/fx.js — effect primitives. Positions are WORLD coords unless the option says screen.
export class FX {
  constructor({ renderer, quality = 'high' }); setMode('classic' | 'epic'); setQuality(q);
  burst(x, y, { kind, color, count, speed, life });        // 'spark'|'dust'|'shards'|'embers'|'energy'|'petals'|'confetti'|'smoke'
  shockwave(x, y, { strength, radius, duration });
  flash(color, { duration, alpha });
  impactFrame({ duration, focus });                         // inverted B/W manga frame + radial lines
  speedLines({ focus, duration, density, color });          // radial manga speed lines (screen)
  shake(intensity, duration); slowMo(scale, duration); hitStop(ms);
  chromatic(strength, duration); zoomBlur(x, y, strength, duration); bloomPulse(strength, duration);
  lightning(x1, y1, x2, y2, { color, duration, branches });
  slash(x, y, angle, { color, length, duration });
  kanji(text, x, y, { size, color, duration, screen });     // onomatopoeia / kanji pop
  banner(text, { sub, color, style, duration });            // big text banner
  cutIn({ title, subtitle, color, side, duration, pieceColor }); // anime cut-in band
  comboCounter(n, { color });                               // fighting-game "N HIT COMBO"
  pillar(x, y, { color, duration });                        // light beam
  aura(pieceView, { color, intensity }) -> { stop() };      // persistent flame aura
  afterimages(pieceView, { duration, color });
  crack(x, y, { size }); menacing(x, y);                    // ground crack decal, 「ゴゴゴ」
  clear();                                                  // stop/remove everything
}
// src/fx/director.js — choreographs every visible game event, per mode
export class Director {
  constructor({ renderer, fx, audio, native, settings });   // settings: live object (see §6)
  setMode('classic' | 'epic');
  busy;                                                     // true while a cinematic plays
  skip();                                                   // speed up the current cinematic
  playMove({ move, before, after, mover, moverIsHuman, names, stats }) -> Promise;
      // animates the move (pieces, captures, promotion) + effects + sounds + vibration.
      // When it resolves, the renderer's pieces MUST match `after`.
  playGameStart({ variant, players, epic }) -> Promise;
  playTurn({ color, isHuman, players }) -> Promise;
  playGameOver({ result, humanColor, stats, players }) -> Promise;
  playSelect(sq); playDeselect(); playIllegal(sq); playHint(path) -> Promise;
}
// src/fx/brag.js — bragging / taunt phrase generator (ru/en)
export function bragLine(event, ctx, lang): string;   // events: 'capture','combo','promote','win','flawless','lose','draw','taunt','start', ...
export function attackName(ctx, lang): string;        // anime special-move names
export function kanjiFor(event): string;
```
`stats` passed to the Director: `{ captures: {1: n, -1: n}, maxCombo: {1,-1}, kingsMade: {1,-1},
moveNumber, hype: {1: 0..1, -1: 0..1} }`. `names`/`players`: `{ 1: { name, isHuman, title }, -1: {...} }`.

## 5. Audio (`src/audio/`)

```js
// src/audio/audio.js
export class AudioEngine {
  unlock();                                  // call on the first user gesture
  setSfxVolume(v); setMusicVolume(v); setMuted(bool);
  play(name, { intensity = 1, pitch = 1, pan = 0, delay = 0 } = {});   // fire-and-forget
  music(track /* 'menu'|'classic'|'epic'|'victory'|'defeat'|null */, { fade = 1000 } = {});
  setIntensity(x /* 0..1, epic music layers */);
  duck(amount, ms);
}
```
Required SFX names: `click, select, deselect, move, land, capture, combo, promote, illegal, turn,
win, lose, draw, start, hint, undo, whoosh, dash, impact, bigImpact, slash, thunder, charge,
explosion, shatter, gong, taiko, riser, swell, power, glitch, heartbeat, zap, boom, sparkle,
menacing`. Unknown names must be ignored silently.

## 6. UI (`src/ui/`)

DOM UI on top of the Pixi canvas. `web/index.html` provides `<div id="stage">` (canvas host,
z 0) and `<div id="ui">` (DOM root, z 10). `#ui` has `pointer-events: none`; every interactive
element sets `pointer-events: auto`. The game screen contains an empty `<div id="board-slot">`
(pointer-events none) whose rect is passed to `renderer.setBoardRect`.

```js
// src/ui/ui.js
export class UI {
  constructor(root, { settings, stats, audio, native });
  on(event, fn);   // 'play'(GameConfig) 'undo' 'hint' 'resign' 'offer-draw' 'pause' 'resume'
                   // 'menu' 'rematch' 'settings'(settings) 'skip'
  showScreen(name /* 'title'|'menu'|'setup'|'settings'|'rules'|'stats'|'game' */, params?);
  hud: { setup({ variant, players, bottomColor, epic, mode }), setTurn(color), setCounts(counts),
         setThinking(color, bool), setHype(color, 0..1), toast(text, { epic }), setCanUndo(bool),
         setCanHint(bool), setStatus(text) };
  boardSlotRect() -> DOMRect;
  showGameOver({ result, humanColor, mode, stats, records, epic, players }) -> Promise<'rematch'|'menu'>;
  confirm(text) -> Promise<boolean>;
  handleBack() -> boolean;   // Android back button; true if handled
}
// src/ui/i18n.js: t(key, params), setLang(lang), getLang()
// src/ui/storage.js: loadSettings(), saveSettings(s), DEFAULT_SETTINGS, StatsStore
```
**GameConfig**: `{ variantId, mode: 'ai'|'pvp'|'demo', humanColor: 1|-1|0 /*random*/, level: 1..5,
epic: boolean, giveaway: boolean }`.
**Settings** (live object shared by all modules): `{ lang: 'ru'|'en', sfxVolume, musicVolume,
vibration: bool, announcer: bool /*TTS announcer in epic*/, quality: 'high'|'medium'|'low',
showMoves: bool, animSpeed: 1|1.5|2, lastConfig: GameConfig }`.
**StatsStore**: `record(summary) -> { newRecords: [...], newTitles: [...] }`, `get()`; summary =
`{ variantId, mode, epic, result: 'win'|'loss'|'draw', level, moves, captures, maxCombo,
kingsMade, piecesLost, durationSec }`. Titles/achievements are bragging material.

## 7. Platform (`src/platform/native.js`, `android/`)

```js
export const native = {
  isAndroid,                                     // true when window.AndroidBridge exists
  vibrate(pattern /* ms | ms[] */), speak(text, { lang = 'en-US', pitch = 1, rate = 1 }),
  stopSpeaking(), hasTTS(), exitApp(), keepScreenOn(bool),
  setBackHandler(fn /* () => boolean handled */), onPause(fn), onResume(fn),
};
```
Android side: `MainActivity` (Java, no AndroidX) hosts a full-screen immersive WebView that loads
`https://appassets.androidplatform.net/index.html`, served from `assets/www/` via
`shouldInterceptRequest` (correct MIME types). JS interface `window.AndroidBridge` with
`vibrate(String jsonPattern)`, `speak(String text, String lang, float pitch, float rate)`,
`stopSpeaking()`, `hasTts()`, `exitApp()`, `keepScreenOn(boolean)`. Back button →
`window.__androidBack()` (returns true if handled, else the activity finishes).
Pause/resume → `window.__androidPause()` / `window.__androidResume()`.
`tools/build-apk.sh` → `dist/EpicCheckers.apk` (signed v2+v3, zipaligned).

## 8. Integration (`src/main.js`, `src/controller.js`)

Bootstrap: load settings → UI → Renderer → FX → Director → Audio → AI. The controller owns the
`Game`, input (tap → select → multi-step path entry), AI turns, undo/hint, results, stats.
URL params for testing: `?debug=1` exposes `window.__app`; `?screen=game&variant=turkish&mode=pvp&epic=1&pos=<stateString>&color=1&level=3`
jumps straight into a game; `?lang=en`.

---

# Art direction

## Classic mode («Классика»)
Premium, calm and tactile. Polished walnut + maple board with subtle procedural grain, dark
frame with thin gold inlay and coordinates. Glossy lacquered pieces: ivory (white) and ebony
(black) with soft shadow, rim highlight and concentric grooves; kings get a gold crown emblem.
Moves glide with a small lift/arc, landing puff of dust, captured pieces fade and sink with a few
sparkles, promotion = gold shimmer. Restrained, smooth 60 fps.

Palette: maple `#E8D5B0`, walnut `#6B3F22`, frame `#2A1A10`, gold `#C9A04C`, ivory `#F4EEDD`,
ebony `#1E1A1A`, move dots `#3DDC97`, capture rings `#FF4D4D`, last move `#FFB547` @ 30%.

## EPIC BADASS MODE
Anime battle. Every move is a fight scene; every capture is a finishing move; the game brags.
- World: animated storm/void background (drifting nebula clouds, distant lightning, embers),
  obsidian board with glowing energy seams and runes on the frame, edge glow in the colour of
  the side to move. Pieces are energy-forged discs with glowing cores; kings burn with a
  permanent aura.
- Energy colours: WHITE side = electric cyan `#29E6FF` (white core), BLACK side = crimson/magenta
  `#FF2E63`, kings/promotion gold `#FFD23F`, manga ink `#000`, impact white `#FFF`,
  background `#05030C → #120A2A`, neon grid `#7A5CFF`.
- Quiet move: dash with speed lines and afterimages, impact ring + dust + micro-shake on landing.
- Capture: camera punch-in, hit-stop (~100 ms), 2–3 frame impact frame (inverted B/W + radial
  lines), slash streak, target shatters into shards + explosion + shockwave distortion, shake,
  big onomatopoeia (ドン! 斬! БАХ!), boastful caption.
- Multi-capture: slow-motion cinematic, camera follows each hop, fighting-game combo counter
  escalating per hit, lightning chaining the victims, ending with a cut-in band (attack name,
  e.g. «ТЫСЯЧА РАЗЯЩИХ ПРЫЖКОВ!»), mega explosion, white flash, chromatic aberration, bloom.
- Promotion «ПРОБУЖДЕНИЕ»: pillar of light from the sky, gold energy spiral, giant 覚醒, crown
  forms, permanent flame aura on the king.
- Game start: VS screen (diagonal split, both sides with titles/power levels, 対決).
- Victory: 勝利 + rays + sakura/confetti + bragging stats (combo, flawless, titles). Defeat:
  dramatic rain/desaturation, «Я вернусь сильнее…».
- Opponent (AI) taunts and player brags as cut-in captions; optional TTS announcer
  ("COMBO!", "PERFECT!", "K.O.!"); strong haptics; taiko/epic music intensifying with combos.
- A hype meter («ЯРОСТЬ») fills with captures; at full, the next capture plays the ULTIMATE.
- Cinematics are skippable by tapping (Director.skip) and must never block the game for long:
  quiet move ≤ 0.6 s, single capture ≤ 1.6 s, each extra hop ≤ 1.0 s (+ ≤ 1.5 s finale),
  promotion ≤ 2.2 s, game start ≤ 2.5 s, victory ≤ 4 s.
- Performance: quality `high` (bloom, all filters, ~1500 particles max), `medium` (~600, cheap
  filters only), `low` (~200, no full-screen filters). Full-screen filters are attached only while
  an effect runs and removed afterwards. Renderer resolution ≤ 2.
