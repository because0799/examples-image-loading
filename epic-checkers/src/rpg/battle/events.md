# Battle events — «Валькирии доски»

`applyAction(state, action)` returns `{ state, events }`. `events` is a chronological array of plain
objects `{ type, ... }`. The renderer animates them in order; the UI logs them; anyone can always
re-sync with the final `state` (`view.setState(state)`). `createBattle()` stores its own events
(battle start, deployment rules, the first turn start) in `state.startEvents`.

Conventions: squares are `sq = row * 8 + col` (row 0 = top = side −1's home row). Unit ids are
`a0..a5` (side 1) and `b0..b5` (side −1); ward ids `w<n>`, zone ids `z<n>`. `source` / `by` may be
`null` for environment effects (lava, eruption, collapse). Elements: `flame tide frost storm gale terra
radiance umbra` (or `none`).

One `applyAction` call can contain several turns' worth of events: the action, the end of the turn,
the start of the next side's turn (cooldowns, burns, zones, passives…), skipped turns, and the result.

## Turn / activation flow

| type | fields | when |
|---|---|---|
| `battleStart` | `seed, first, mode, stage, roundLimit, units: [{id, heroId, side, sq, level, constellation, boss}]` | first event of `state.startEvents` |
| `turnStart` | `side, round, turn` | a side's turn begins (after round-start stage events) |
| `turnSkipped` | `side, reason: 'no-activatable' \| 'pass'` | nobody could act (all stunned / frozen / KO'd) |
| `activate` | `unit, extra` | first action of an activation (`extra: true` = Tsubame's Updraft / boss extra move) |
| `extraActivation` | `unit, boss?` | an extra activation was granted (shown as a banner) |
| `wait` | `unit` | the Wait action (followed by `energy` +10 and `status brace`) |
| `endActivation` | `unit, kind: 'move'` | move-only activation ended by `pass` |
| `pending` | `unit, kind: 'freeMove' \| 'blink' \| 'relocate', optional, squares: [sq]` | the active hero must / may pick a square (`legalActions` lists them) |
| `pendingSkip` | `unit, kind` | an optional free move was declined |
| `activationEnd` | `unit, kind` | the activation is complete (kind: `wait move basic skill ult quirk jump`) |
| `turnEnd` | `side` | after statuses / seals / wards / zones of that side ticked and turn-end passives fired |
| `roundEnd` | `round` | after the second side's turn |
| `victory` | `winner: 1 \| -1 \| 0, reason, round` | the battle ended (see `battleResult`) |

Victory reasons: `annihilation` (all heroes of a side KO'd; an unhatched Phoenix Egg keeps its side
alive), `round-limit` (HP-share tiebreak; `winner 0` = draw within 0.5 %), `resign`, `mutual-ko`,
`awakenings` (stage 1-5 rule), `escort` / `caravan-lost` (stage 2-5), `stalemate` (safety net).

## Movement

| type | fields | notes |
|---|---|---|
| `move` | `unit, from, to, path: [sq], kind, free?, reason?, with?` | `kind`: `step` (path may contain 2-square hops: leapfrog over an ally / a springboard pillar), `glide`, `flight` (Crown glide), `blink`, `swap` (swapMove; `with` = ally id, followed by its `displace`), `teleport` (relocation). `free: true` for pending free moves (`reason` = pending kind) |
| `displace` | `unit, from, to, kind` | involuntary or ability movement. `kind`: `push`, `pull`, `swap`, `toss` (Zlata's Friend Toss), `moveSelf` (Liora / Vermilia / Karasu / Shio dash), `retreat` (Reika), `gate` (star gate), `decoy` (Nocturna's Double swap), `teleport` (boss escape), `collapse` (board collapse) |
| `collision` | `unit, sq, at, blocker` | a push / pull was blocked (by the edge, `at` = blocked square or −1, or by `blocker`); `damage` events with `kind: 'collision'` follow |
| `chainStart` | `unit, path: [sq], element` | a jump-strike chain begins (precedes its `jump` events) |
| `jump` | `unit, from, to, over, victim, hop, spring` | one hop of a chain (`hop` = 1-based). `spring: true` = vaulted over an allied springboard pillar (no damage). A `damage` event follows each striking hop |

## Actions and damage

| type | fields | notes |
|---|---|---|
| `cast` | `unit, kind: 'basic' \| 'skill' \| 'ult' \| 'quirk', abilityId, element, target, targets?, path?, area: [sq], vfx?, heal?, quirk?` | an action starts. `abilityId` = `'basic'` or the ability id from heroes.js. `vfx` = ultimate cinematic key (`ult-<hero>`). `heal: true` = Oracle basic heal on an ally. Play the voice line on `skill` / `ult` |
| `damage` | `source, target, amount, crit, element, reaction?, absorbed, hp, shield, kind, ability?, ward?` | one damage instance. `amount` = full damage; `absorbed` = part eaten by the shield; `hp`/`shield` = target values after the hit. `kind`: `hit` (ability damage), `basic`, `jump`, `reaction` (Detonation / Arc / Vortex bonus damage), `burn`, `collision`, `lava`, `eruption`, `collapse`, `redirect` (Vera's Oath), `execute`, `fireRain`, `hatch`, `true`. `ward: true` when the target is a ward. `reaction` is set on the hit that triggered a reaction |
| `reaction` | `target, reaction, elements: [hitElement, sealElement], source` | emitted right after the triggering `damage`; label «ПАР! 蒸» etc. Its extra effects follow (bonus `damage`, `arc`, `displace`, `status`, `shield`) |
| `arc` | `from, to, target` | Arc reaction jumping to another enemy (followed by its damage) |
| `bounce` | `from, to, target, source` | a bouncing ultimate hit (Reika / Iskra) jumping to the next target |
| `redirect` | `unit, from, amount` | Vera takes part of the hit aimed at `from` |
| `execute` | `unit, source, hp` | an execute (Karasu's Midnight) KOs the target outright |
| `heal` | `source, target, amount, hp, reason?` | `amount` = HP actually restored (may be 0); `reason`: `regen`, `candle`, `awaken`… |
| `shield` | `target, amount, value, gained, source, turns` | shield set to `amount` (the larger shield stays); this is also the "Shield" status (no separate `status` event when it is gained). `amount: 0` = shield removed. A shield depleted by damage emits `status shield off (reason 'broken')` and the `damage` event carries `shield: 0` |
| `survive` | `unit, hp, rule: 'survive' \| 'decoyWard'` | lethal damage avoided (Vera's Stubborn / Nocturna's Double) |
| `ko` | `unit, sq, by, final?` | a hero is knocked out and removed. `final: true` = her Phoenix Egg was broken (no more revival) |
| `revive` | `unit, sq, hp, energy, by: 'revive' \| 'hatch', source` | Lucille's Litany or a Phoenix Egg hatching |
| `awaken` | `unit, sq, full, start?` | Crown gained (followed by `status crown on`). `full` = with the one-time heal + 50 energy; `start: true` = born crowned (Liora / boss) |
| `crownLost` | `unit` | the Crown fell off (startCrowned rule) |
| `rule` | `unit, rule, target?, stacks?` | a named rule fired: `cocoon`, `retreatOnAdjacent`, `chargeStacks` (stacks spent), `galeEscape` |
| `bossPhase` | `unit, phase` | 3-B boss entered phase 2 / 3 |

## State changes

| type | fields | notes |
|---|---|---|
| `energy` | `unit, value, max, delta, reason` | reasons: `action`, `hops`, `move`, `wait`, `hit`, `reaction`, `ko`, `awaken`, `ult` (spent, delta < 0), `drain`, `stolen`, `steal`, `effect`, `bond` (Oracle support), `leapfrog`, `toss`, `pawns` |
| `cooldown` | `unit, value, which` | `which` = `'skill'` or a quirk id |
| `status` | `target, status, turns, stacks, value?, on, source?, reason?` | `on: true` applied / refreshed; `on: false` removed (`reason`: `expired`, `cleansed`, `dispelled`, `consumed`, `shattered` (Frozen broke), `broken` (shield depleted), `lost` (crown)). Bosses: control turns into `stagger` stacks; 3 stacks → `break` |
| `seal` | `target, element, slot: 'natural' \| 'celestial', turns?, seals: [element], removed?, reason?` | `element: null` = the seal in `slot` was removed (`reason`: `reaction`, `expired`) |
| `ward` | `id, kind, sq, owner, side, hp, maxHp?, turns?, special?, on, reason?, by?` | ward spawned (`on: true`) or removed (`reason`: `destroyed`, `expired`, `hatched`, `decoy`, `collapse`). Kinds: `ice-wall`, `ball-lightning`, `stone-pillar`, `dusk-double` (special `decoy`), `phoenix-egg` (`egg`), `candle` (`candle`), `hollow-pawn` (`pawn`), `caravan` (`caravan`) |
| `wardAct` | `id, kind` | a ward behaviour fires at its owner's turn start (ball lightning zap) |
| `zone` | `id, kind, sqs, owner, side, turns, on, reason?` | floor zone on / off. Kinds: `phoenix-trail`, `sand-rune`, `feathers`, `dew`, `lava`, `gate`, `fire-rain` (warning marker) |
| `zoneTrigger` | `id, kind, unit, when: 'start' \| 'enter'` | a zone affects a unit (its effects follow) |

## Stage events (campaign)

| type | fields | notes |
|---|---|---|
| `warning` | `kind: 'eruption', row, sqs, round` / `kind: 'fireRain', centers, sqs, round` | telegraph one round / turn ahead |
| `eruption` | `row, sqs, round` | chapter 2 eruption (followed by `damage kind:'eruption'`) |
| `fireRain` | `centers, sqs, source` | 2-B boss fire rain strikes (followed by its damage) |
| `collapse` | `sqs, round, awakenRows` | chapter 3 board collapse; `awakenRows` = new awakening rows per side |
