# «Валькирии доски» — module contract

The RPG mode (design: `docs/RPG-DESIGN.md`, data: `src/rpg/data/*`, effect vocabulary: `src/rpg/data/effects.md`)
is a separate mode of the existing app (ARCHITECTURE.md). Classic checkers stays untouched. All code is plain
ES modules in `src/rpg/**`, bundled into the same `app.js`. Every module may ADD APIs; the ones below are binding.
Data files in `src/rpg/data/` were written by the designer; engineers may fix data bugs (list them in reports).

## Ownership
| Path | Owner |
|---|---|
| `src/rpg/battle/**`, `src/rpg/ai/**`, `tests/rpg/battle/**` | battle |
| `src/rpg/meta/**`, `tests/rpg/meta/**` | meta |
| `src/rpg/assets.js`, `src/rpg/voice.js`, `web/static/rpg/**`, `tools/rpg-assets.py`, `assets/rpg/crops.json` | assets |
| `src/rpg/render/**`, `src/dev/rpg-render-demo.*` | render |
| `src/rpg/ui/**`, `src/dev/rpg-ui-demo.*`, `tests/rpg/ui/**` | ui |
| `src/rpg/controller.js`, `src/rpg/index.js`, hooks in `src/main.js` | integration (later) |

## Assets (owner: assets)
Sources: `assets/rpg/heroes/<id>.png`, `assets/rpg/bg/<bg-id>.png`, `assets/rpg/keyart/valkyries-keyart.png` (1280×720 PNG,
NOT shipped, git-ignored), voice `assets/rpg/voice/<heroId>-<event>.mp3` (events: summon, skill, ultimate, victory; only
Epic+ heroes). Shipped (committed) outputs, copied by `tools/build-web.mjs` from `web/static/` into `dist/www/`:
- `web/static/rpg/splash/<id>.webp` 1280×720 (q≈80), `web/static/rpg/card/<id>.webp` 480×640 portrait crop around the
  hero, `web/static/rpg/token/<id>.webp` 256×256 face crop (circle mask applied at render time), `web/static/rpg/bg/<bg>.webp`,
  `web/static/rpg/keyart.webp`, `web/static/rpg/voice/<heroId>-<event>.mp3`.
- `src/rpg/assets.js`: `export const RPG_ASSETS = { splash(id), card(id), token(id), bg(bgId), keyart, voice(heroId, event) /* url|null */,
  focal(id) /* {x,y} 0..1 in splash */ }` (relative URLs like `rpg/token/liora.webp`).
- `src/rpg/voice.js`: `playVoice(heroId, event, { settings }) -> Promise` (respects `settings.rpgVoice` (bool, default true) and
  `settings.voiceVolume` (0..1, default 0.9) and sfx mute; one voice at a time; preloads on demand; safe if missing).

## Battle engine (owner: battle) — pure, deterministic with a seeded RNG, Node-testable
```js
// src/rpg/battle/index.js
createBattle({ sides: { 1: Squad, [-1]: Squad }, mode: 'campaign'|'training'|'duel', stage /*optional StageDef*/, seed, first = 1 }) -> BattleState
// Squad = [{ heroId, level, constellation, sq? }]  (≤ 6; positions default per GDD deployment)
unitActions(state, unitId) -> { moves: [sq], jumps: [[sq...] paths], basic: [targetSq], skill: { ok, reason, targets: [sq], area(targetSq) }, ult: { ok, reason, targets, area(targetSq) } }
legalActions(state) -> Action[]        // every legal action of the side to act
applyAction(state, action) -> { state, events }     // returns a NEW state; never mutates the input
battleResult(state) -> null | { winner: 1|-1|0, reason, rounds, stats }
serializeBattle(state) / deserializeBattle(obj)
// src/rpg/ai/index.js
chooseAction(state, { difficulty: 'easy'|'normal'|'hard'|'boss', seed }) -> Action   // ≤ ~150 ms on a phone; GDD §10
```
`Action = { type: 'move'|'jump'|'basic'|'skill'|'ult'|'pass', unit, to?, path?, target? }` (engine documents exact fields and
the turn structure from the GDD, e.g. move-then-act within one activation).
`Unit` (in `state.units`): `{ id, heroId, side, sq, hp, maxHp, atk, def, crit, energy, maxEnergy, cd: { skill }, statuses: [{ id,
turns, stacks, source }], seal /*element|null*/, shield, awakened, alive, level, constellation }`. `state.side`, `state.round`.
**Events** (array returned by applyAction, in chronological order; the renderer animates them, the UI logs them):
`turnStart{side,round}`, `move{unit,from,to,path}`, `jump{unit,from,to,over}`, `cast{unit,kind:'basic'|'skill'|'ult',abilityId,
element,target,area}`, `damage{source,target,amount,crit,element,reaction?,absorbed,hp}`, `heal{source,target,amount,hp}`,
`shield{target,amount}`, `status{target,status,turns,on:boolean}`, `seal{target,element|null}`, `reaction{target,reaction,
elements:[a,b]}`, `energy{unit,value,max}`, `ko{unit}`, `awaken{unit}`, `displace{unit,from,to,kind:'push'|'pull'|'teleport'}`,
`zone{id,kind,sqs,owner,turns,on:boolean}`, `cooldown{unit,value}`, `turnEnd{side}`, `roundEnd{round}`, `victory{winner,reason}`.
The engine may add event types; document all in `src/rpg/battle/events.md`.

## Meta (owner: meta) — profile, collection, gacha, progression, campaign, economy (GDD §11–16)
```js
// src/rpg/meta/index.js
loadProfile(storage = localStorage) -> Profile; saveProfile(profile, storage)
// Profile: { v, crystals, heroes: { [id]: { level, xp, constellation, copies } }, squad: [heroId×≤6], campaign: { [stageId]: { stars, cleared } },
//            pity: {...}, daily: {...}, stats: {...}, firstRun: boolean }
summon(profile, count /*1|10*/, seed?) -> { results: [{ heroId, rarity, isNew, constellation, refund? }], profile }
canSummon(profile, count); SUMMON_COST
STAGES; stageById(id); enemySquad(stage) -> Squad; isUnlocked(profile, stageId)
applyBattleResult(profile, { stageId?, mode, result, squad, stats }) -> { profile, rewards: { crystals, xp: {heroId: n}, levelUps: [...], firstClear, stars } }
heroPower(profile, heroId); setSquad(profile, ids); claimDaily(profile, now)
```
Starter flow: first launch grants the starter squad + crystals per GDD.

## Battle view (owner: render) — Pixi, reuses the app's Pixi Application and FX library
```js
// src/rpg/render/index.js
new BattleView({ renderer /*main Renderer: app, clock, camera, layers*/, fx /*FX*/, audio, native, settings, assets: RPG_ASSETS, voice /*playVoice*/ })
await view.init(); view.show(); view.hide();            // hide() restores the classic renderer layers untouched
view.setBoardRect(rect); view.setBackground(bgId);
view.setState(state);                                    // instant sync of tokens/HP/statuses
await view.play(events, { state });                      // animates events (move, jump-strike chain, attacks, skills, element VFX,
                                                         // reactions, floating damage numbers, ult = splash cut-in + voice + big VFX, KO, awaken)
view.highlight({ selectable: [unitId], selected, moves: [sq], jumps: [[sq]], targets: [sq], area: [sq] }); view.clearHighlight();
view.onTap(fn({ sq, unitId }));  view.skip();  view.busy;
```
Tokens: circular portrait (token webp) with rarity frame (Rare blue, Epic violet, Legendary gold, Mythic iridescent),
element badge, HP bar, shield, status icons, energy ring, side tint. Timings and look per GDD §18.

## UI (owner: ui) — DOM screens over the canvas, same conventions/themes as `src/ui` (pointer-events, i18n ru/en)
```js
// src/rpg/ui/index.js
new RpgUI(root /* the existing #ui element or a child */, { settings, audio, native, assets: RPG_ASSETS, voice })
ui.showScreen('hub'|'collection'|'hero'|'squad'|'summon'|'campaign'|'training'|'duel'|'battle'|'results', params)
ui.on(event, fn)  // 'start-battle'({mode, stageId?, squads, difficulty?}), 'summon'(count), 'set-squad'(ids), 'exit', 'battle-action'(...), ...
ui.setProfile(profile)            // re-render data
ui.hud: { setup(state, opts), update(state), select(unitId, unitActions), clear(), log(events), setBusy(bool) }
ui.playSummon(results) -> Promise  // pull animation by rarity (Mythic special), then results grid
ui.showResults({ result, rewards }) -> Promise<'again'|'next'|'hub'>
ui.boardSlotRect() -> DOMRect;  ui.handleBack() -> boolean
```

## Integration (owner: integration) — done in 1.2.0
```js
// src/rpg/index.js → src/rpg/controller.js
const rpg = new RpgController({ root /* #ui */, classicUi, renderer, fx, audio, native, settings, perf, opts: { debug, fast, autoSkip } });
rpg.open({ screen? });  rpg.close();  rpg.visible;  rpg.handleBack();  rpg.onAppPause(bool);  rpg.applySettings(s);
rpg.snapshot();  rpg.battle   // tests / debug (window.__app.rpg with ?debug=1)
```
- **Entry:** the classic menu tile «Валькирии доски» (`src/ui/screens/menu.js`, key-art thumbnail, «Новое!» badge)
  emits `ui.emit('open-rpg')`; `main.js` opens the hub. `?screen=rpg[&rpgScreen=…]` opens it directly.
  RpgUI mounts inside `#ui` (the classic screens are `display: none` while it is up); «К шашкам» / Android back on
  the hub → `rpg.close()` → the classic menu. While a non-battle RPG screen covers the canvas the renderer is
  `setOccluded(true)`.
- **Session:** `meta.loadProfile` + `claimDaily` on open (first run: starter squad, 3 200 ✦, 5 scrolls + a welcome
  sheet; `completeFirstRun`), `saveProfile` after every mutation (summon is saved *before* its animation).
- **Battles:** campaign = `meta.campaignSetup` (boss stages with AI 'hard' use the AI's 'boss' level), training /
  duel = the RpgUI payload (training enemies marked `reflection`, duel first move = engine coin toss).
  `createBattle({ sides, mode, stage, seed, first })`; BattleView is shown on the app's Renderer (world layer made
  visible, classic layers restored by `view.hide()`); HUD ↔ view: `board-rect` → `setBoardRect`, the free area
  between the HUD panels → `setSafeRect` (full screen during Ultimates), `onCinematic` → `hud.setCinematic`.
- **Turn loop:** step-level, exactly the engine's structure: select → `unitActions` → `view.highlight` (+
  `previewAction` forecast labels via `view.preview`) → move / basic / jump chain (landing squares tapped hop by
  hop; a tap on the last landing stops) / skill / ult / quirk (self-centred: area + forecast, tap the board to
  confirm; `single`: tap; line / row / cross / radius / diagonals: tap → forecast → tap again; `lines`: one tap per
  direction; `square`: pick squares, tap a picked one to confirm) / Wait / End → `applyAction` →
  `view.play(events, { state })` → `hud.update` + `hud.log`. Pending relocations and extra activations keep the
  heroine selected. Enemy (and «Авто») turns: `RpgAIClient` on a Web Worker built from `src/rpg/ai/worker.js`
  (injected by `tools/build-web.mjs` as `__RPG_AI_WORKER_SRC__`), 6 s watchdog → in-thread fallback.
  «Авто» is offered in campaign and training from the first battle (constant `AUTO_ANYWHERE`; GDD §16 wanted it
  after a manual clear), never in duels. Duel: the board / HUD turn to the player to move, «Передай телефон»
  between turns when enabled.
- **End:** `battleResult` → `meta.applyBattleResult({ stageId, mode, result, squad, state, events, enemyLevel,
  battleId: seed })` → profile saved at once → `ui.showResults({ …, mvp })` (MVP victory line by the results
  screen) → next (stage sheet of the next unlocked stage) / again / squad / hub. Music: `epic` in battle (intensity
  from HP shares, ready Ultimates, bosses), `victory` / `defeat` on results, `menu` elsewhere.
- **Mid-battle save:** `localStorage['ec.rpg.battle.v1'] = { v: 1, setup, state: serializeBattle(state), auto,
  speed }` after every completed action and on app pause; opening the hub offers «Продолжить» / «Бросить»;
  cleared when the battle ends (rewards were already applied) or is abandoned.
- **Settings** (shared live object, persisted by `src/ui/storage.js`): `rpgVoice` (true), `voiceVolume` (0.9),
  `rpgUltCinematic` ('full' | 'short' | 'first'), `rpgDamageNumbers` (true) — controls in the RPG «Валькирии»
  sheet (hub gear / battle pause).
- **e2e:** `tests/e2e/rpg-flow.mjs`, `rpg-play.mjs`, `rpg-mechanics.mjs` (helpers `rpg-lib.mjs`), in `run-all.mjs`.

## Playtest pass (1.2.0) — what changed after playing the build like a new player
- **First battles teach the game.** 1-1 runs a coach bubble (`hud.coach(text, { onOff })`, driven by
  `RpgController._coachUpdate()` from the current selection / phase / energy / enemy turn; ✕ = no more tips).
  Stages with a `tutorial` id (1-2 reactions, 1-3 chains, 1-4 taunt, 1-5 awakening, 3-2 portals) open a short card
  (`src/rpg/ui/tutorial.js`, `ui.openTutorial(id)`) before the first turn. Seen flags: `profile.flags['tut.<id>']`.
  The pause menu has «Как играть» (`ui.openHowTo()`).
- **Why can't I?** A tap on a disabled action button explains it (cooldown turns, energy x/y, no targets, already
  moved, not your turn) together with the ability text; while a skill / Ultimate / quirk is being targeted the unit
  card shows what it does.
- **Full squad:** adding a heroine opens «Кого заменить?» (`pickReplacement` in `ui/components.js`) instead of a toast.
- **After 2 losses in a row** on a campaign stage the results screen shows `meta.stageAdvice` (power vs recommended,
  counter / same elements) and a «Тренировка на ур. N» button (GDD §14.4).
- **Bosses were unbeatable** (0 % in simulations, even 10 levels over the stage): a turn-1 flying jump onto the back
  row crowned the boss (heal, +50 energy, flight, Ultimate on turn 2), on-kill extra activations stacked on the
  boss's own extra activation, and HP ×5–6 came at full ATK. Now bosses never crown themselves by moving and get no
  on-kill extra activations (`battle/combat.js landed`, `battle/effects.js extraActivation`), and stages carry
  `atkMult` next to `hpMult` (1-B 3.5 / 0.75, 2-B 2.5 / 0.45, 3-B 3.5 / 0.6, 3-B escorts level 25). See the note
  above `CAMPAIGN` in `data/rules.js` for the measured win rates.
- **Shader warm-up:** the first Ultimate stalled a frame for up to 1 s while Pixi compiled the particle / FX filter
  programs. `render/warmup.js warmShaders()` compiles them in 60 ms slices ~1 s after the hub opens.
- Battle log lines no longer squeeze into empty pills on short lanes, and hide during cinematics; the last blow's
  numbers / KO labels / VFX are cleared when the view hides (they used to reappear at the next battle start); the
  stage sheet's «В бой!» sticks to the bottom of the sheet; ability areas are drawn at 58 % instead of 32 %.
- **Adaptive quality** ('auto') now also measures RPG battles (`main.js` perf `isActive`: an unpaused RPG battle on the
  battle screen counts like a classic game), so a slow phone steps high → medium → low during RPG fights too.
