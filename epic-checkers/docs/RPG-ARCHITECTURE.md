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
