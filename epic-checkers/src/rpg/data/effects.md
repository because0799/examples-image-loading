# Effect vocabulary — «Валькирии доски»

Every ability in `heroes.js` uses only the shapes, effect ops, conditions, triggers, mods, patches
and named rules listed here, so the battle engine can run all of them through one generic
interpreter. Numbers and status definitions are in `rules.js`, and the design reasoning is in
`docs/RPG-DESIGN.md`.

Geometry: 8×8 board, dark squares only ((row + col) odd), `sq = row * 8 + col`. **Distance** is
Chebyshev distance `max(|dr|, |dc|)`. The 4 **directions** are the diagonals `(-1,-1) (-1,+1) (+1,-1) (+1,+1)`.
"Adjacent" means diagonally adjacent (distance 1, 4 squares). **Forward** means toward the enemy's back row.

---

## 1. Ability object

```js
{
  id: 'dawn-verdict',                     // kebab-case, unique within the hero
  name: { ru, en, jp }, desc: { ru, en },
  cooldown: 3,                            // skills only (own turns, see §7)
  cost: 90,                               // ultimates only (energy)
  target: { shape: 'line', length: 3, pierce: true, side: 'enemy' },   // §2
  effects: [ { op: 'damage', mult: 1.6 }, { op: 'moveSelf', to: 'lineEnd' } ],  // §3, run in order
  vfx: 'ult-liora',                       // ultimates: key of the cinematic (GDD §18)
}
```

Passives and quirks use `triggers`, `mods`, `aura` and `rules` (§5, §6). Constellations use `patches` (§8).

A **hero** (`heroes.js`) has: `id`, `name`, `title`, `gender`, `rarity`, `element`, `role`, `base` + `growth` (stats),
`move` / `basic` / `jump` (role defaults, rules.js ROLES), `skill`, `passive`, `ultimate`, `quirks[1..2]`,
`constellations[6]`, `lore`, `personality`, `palette`, `voice` and `art { prompt, focal }`. The engine treats `move`,
`basic` and `jump` as data too: `move.type` is `step` | `glide` | `blink`, and `basic.los` follows the `single` shape.

---

## 2. Target shapes (`target`)

All shapes cover dark squares only. `side` filters which units the default receiver set
(`targets`) contains: `'enemy' | 'ally' | 'allyOrSelf' | 'any'`. Wards count as units of their
owner's side, but `heal`, `status` and `seal` skip them.

| shape | params (defaults) | what the player picks | covered squares |
|---|---|---|---|
| `self` | – | – | the caster's square |
| `single` | `range=1`, `los='adjacent'\|'diag'\|'free'`, `includeSelf=false` | one unit | the unit. `diag`: the unit must lie on a diagonal from the caster with every square between them empty. `free`: any unit within `range`. |
| `line` | `length`, `pierce=false` | one of 4 directions | squares 1..`length` along that direction. `pierce:false` stops at the first unit (it is the target if it matches `side`; an ally blocks the line). `pierce:true` hits every unit of `side` on the covered squares, passes allies and stops at the board edge. |
| `lines` | `length`, `pierce=false`, `dirs` (count) | `dirs` distinct directions | union of `line` for each chosen direction |
| `diagonals` | `length`, `center='caster'\|'target'`, `range` | the center unit or square if `center:'target'` | the four rays from the center, each up to `length` (rays are not blocked) |
| `cross` | `length`, `center='target'`, `range`, `includeCenter=true` | a square within `range` (free) | center plus `(±2k, 0)` and `(0, ±2k)` for k = 1..`length` (orthogonal plus, jumping light squares) |
| `radius` | `r`, `center='caster'\|'target'\|'square'`, `range`, `includeCenter=true` | the center (unit or square) within `range` | every dark square within distance `r` of the center (r=1 → 5 squares, r=2 → 13) |
| `row` | `rows=1` | one row that has at least one enemy | every dark square of that row (plus the next `rows-1` rows toward the caster) |
| `all` | `side` | – | every unit of `side` |
| `auto` | `side`, `pick='lowestHpPct'\|'lowestEnergy'\|'nearest'\|'highestAtk'`, `count=1`, `range` (from caster) | – | the chosen units (ties are broken by distance, then sq) |
| `square` | `range`, `count=1`, `empty=true`, `adjacentOnly=false` | `count` empty dark squares within `range` | the chosen squares (used by `ward`, `zone`, `moveSelf`) |
| `jump` | jump params, see `jumpStrike` | a legal jump chain | the chain's victims |

`untargetable` units can't be picked by `single`, `line`, `lines` or `jump`, and they don't block lines. They are still covered by `radius`, `diagonals`, `cross`, `row` and `all`.

---

## 3. Effect ops (`effects[]`)

Effects run top to bottom. Each one acts on its **receivers**, set by the optional `who`
(default `'targets'`):
`'targets'` (units of `side` in the shape) · `'self'` · `'center'` (the picked unit) · `'firstInLine'` ·
`'alliesInShape'` · `'enemiesInShape'` · `'allAllies'` · `'allEnemies'` · `'adjacentAllies'` · `'adjacentEnemies'`
(around the caster) · `'enemiesAroundCenter'` (radius 1 around the picked unit's square, the unit itself excluded) ·
`'lowestHpAlly'` · `'lowestEnergyAlly'` · `'nearestEnemy'`. The last three take optional `range`
(from the hero, default: whole board) and `count` (default 1); for a ward behavior they are measured from the ward.
In triggers you can also use `'eventSource'` / `'eventTarget'` (§5).

Every op accepts `if` (§4). Any op may also carry its own `area` (a shape object as in §2). That shape replaces
the receivers for that op only and is evaluated when the op runs, after earlier displacements. For
`radius`, `center: 'chosenSquares'` means "around every square picked by a `square` target". A unit is hit only
once even when areas overlap.

| op | params (defaults) | semantics |
|---|---|---|
| `damage` | `mult`, `stat='atk'\|'def'\|'maxHp'`, `element='self'` (hero element; `'none'` = no seal/reaction), `critBonus=0` (pp), `dmgBonus=0`, `hits=1` | standard damage (rules.js DAMAGE). Applies the element's seal or triggers a reaction (§9). `hits` > 1 = separate instances. |
| `trueDamage` | `mult`, `stat` | ignores DEF, element, reactions and crit |
| `heal` | `mult`, `stat='atk'` or `pctMaxHp` (of the receiver) | restores HP (capped at max HP, ×(1 − Порча)); Oracle heals grant +5 energy |
| `shield` | `mult`+`stat` or `pctMaxHp` (receiver) or `pctCasterMaxHp`, `turns=2` | status `shield` with that value. Shields don't stack: the larger value stays. |
| `status` | `id`, `turns`, `value`, `stacks` | applies a status from rules.js STATUSES. Bosses turn CC into Stagger (rules.js BOSS). |
| `cleanse` | `count=1\|'all'`, `ids` (optional list) | removes negative statuses (CLEANSABLE), most recent first; with `ids`, only those statuses |
| `dispel` | `count=1\|'all'`, `steal=false` | removes positive statuses (DISPELLABLE); `steal` copies them onto the caster |
| `seal` | `element` | applies an element seal without damage (no reaction is triggered) |
| `energy` | `amount` (negative = drain), `stealTo='none'\|'self'` | changes energy (0..cost). Frozen and Stunned units gain none. |
| `cooldown` | `delta`, `which='skill'` | changes the remaining skill cooldown (min 0) |
| `push` | `dist=1`, `from='caster'\|'center'` | moves the receiver away along the diagonal from the source; if the source isn't diagonal to it, toward the receiver's own back row, on the diagonal farther from the source (ties: smaller col) → collision (§10) |
| `pull` | `dist=1`, `toward='caster'\|'center'` | moves the receiver toward the source along the diagonal; it stops when the next square is occupied |
| `swap` | – | the caster and the receiver exchange squares |
| `moveSelf` | `to='lineEnd'\|'square'\|'adjacentToTarget'\|'anyWithin'`, `range` | relocates the caster without provoking. `lineEnd` = the farthest empty square of the chosen line (stays if none). Landing on the enemy back row awakens her (§7). |
| `jumpStrike` | `mult`, `chainMax`, `approachMax=1`, `landMax=1`, `thenRole=true` | performs a jump-strike. `approachMax` > 1 = "flying" first hop (empty squares between). Later hops use the hero's normal jump rules when `thenRole`. |
| `bounce` | `count`, `range=2`, `mult`, `from='previous'` | after the main hit, `count` extra hits; each goes to the nearest enemy within `range` of the previous victim that hasn't been hit yet (ties: lowest HP %). Stops early when no enemy qualifies. |
| `volley` | `hits`, `mult`, `maxPerTarget` | `hits` instances spread over the receivers round-robin, starting with the lowest HP % (deterministic) |
| `ward` | `id`, `hpPct` (of caster max HP) or `hp`, `turns` (`null` = permanent), `blocks=true`, `jumpable=true`, `behavior`, `aura` | spawns a ward on each chosen square (§10) |
| `zone` | `id`, `turns`, `onTurnStart=[...]`, `onEnter=[...]`, `side='enemy'` | floor effect on the covered squares (§10) |
| `revive` | `hpPct`, `pick='lastKo'`, `place='ownBackRows'` | returns a KO'd ally (max once per ally per battle) to the empty square of her own back 2 rows nearest to the caster |
| `execute` | `hpPct` | if the receiver's HP ≤ `hpPct` × max HP after the previous damage, it is KO'd. Bosses take +1.0 × ATK damage instead. |
| `freeMove` | `steps=1` (step) or `glide` | the caster may move again right away (optional, no energy) |
| `extraActivation` | – | the caster gets another full activation right away (quirk triggers only) |
| `awaken` | `bonuses=true` | grants the Crown as if she had reached the back row |
| `consumeStacks` | `status`, `dmgBonusPerStack` | removes all stacks; the current action gets `+bonus × stacks` damage |
| `survive` | `hp=1` | lethal damage leaves the receiver at `hp` (`lethalDamage` trigger only) |
| `redirect` | `pct` | `allyHit` trigger only: `pct` of the incoming damage goes to the hero instead (her shield and DEF apply, no reaction) |

**Displacement order:** within an effect, damage and statuses resolve for every receiver first. Push and pull come next, in receiver order. KOs from that effect are removed after it finishes, except inside jump chains, where they are removed immediately.

---

## 4. Conditions (`if`)

An `if` object is true when **all** of its keys hold.

| key | meaning |
|---|---|
| `targetHasSeal: 'flame'\|…\|'any'` | the receiver carries that seal (checked before this hit) |
| `targetHasStatus: 'burn'` | the receiver has that status |
| `targetHpBelow: 0.3` / `selfHpBelow` | HP fraction below the value |
| `targetIsolated: true` | no ally of the receiver is adjacent to it |
| `distanceAtLeast: 3` | distance between caster and receiver |
| `selfMoved: true\|false` | the caster moved during this activation |
| `selfAwakened: true` | the caster has the Crown |
| `ko: true` | the receiver was KO'd by the previous effect of this ability |
| `round: 'odd'\|'even'` | battle round parity (round 1 is odd) |
| `anyAllyKo: true\|false` | some KO'd ally can still be revived (each ally can be revived once per battle) |
| `movedAtLeast: 3` | squares the caster travelled during this activation |
| `crit: true` | the triggering hit was a critical hit (triggers only) |
| `reaction: 'arc'` or `['arc', …]` | the triggering reaction id(s) (`reaction` / `allyReaction` triggers) |
| `targetHasStatus: ['slow', 'root']` | an array means: has any of them |
| `source: 'basic'\|'jump'\|'skill'\|'ult'\|'melee'` | kind of the triggering action (triggers only) |

---

## 5. Passives and quirks: `triggers`, `mods`, `aura`

```js
passive: {
  id, name: { ru, en }, desc: { ru, en },
  triggers: [ { on: 'kill', effects: [ { op: 'energy', amount: 10, who: 'allAllies' } ] } ],
  mods: [ { stat: 'critChance', value: 20, if: { distanceAtLeast: 3 } } ],
  aura: { range: 1, side: 'ally', mods: [ { stat: 'defPct', value: 0.2 } ] },
}
```

**Trigger events** (`on`), with optional `if`, `oncePerTurn`, `maxPerTurn`, `oncePerBattle`, `effects`:
`battleStart` · `turnStart` (own side) · `turnEnd` · `turnEndNotActivated` (own turn ended and
she was not the activated hero) · `afterAction` · `hitDealt` · `hitTaken` · `meleeHitTaken`
(basic or jump-strike from an adjacent unit) · `kill` · `allyKo` · `selfKo` · `lethalDamage`
(before HP drops to 0; `survive` may cancel it) · `reaction` (she triggered one; `if: { reaction: 'arc' }`) ·
`allyReaction` (any reaction triggered by her side, herself included) · `allyUlt` · `enemyUlt` · `jumpHop`
(after each hop she lands) · `awaken` · `enemyEndsAdjacent` · `allyHit` (an adjacent ally is about to take damage) ·
`healGiven` (she healed a unit). `oncePerTurn` counts per side turn (for `hitTaken` that means per enemy turn). Trigger effects use `who` relative to the event: `'eventSource'`,
`'eventTarget'`, plus the receivers in §3.

**Mods** are static modifiers, recomputed whenever they're read:
`atkPct · defPct · hpPct · critChance (pp) · critDmg · dmgPct · damageTakenPct · healPct · aff ·
basicRange · glideLength · chainMax · ultCost · skillCooldown · energyGainPct · reactionPct ·
overhealToShieldPct` (overheal turns into a shield capped at value × receiver max HP, 2 turns).
Optional fields: `if` (§4), `scale` (`'rowsAdvanced'` · `'stacks:charge'` · `'markedEnemies'`),
`perUnit` (the value per unit of scale) and `max`.
`rowsAdvanced` = rows between the hero and her own back row (0 on the back row, 7 on the enemy's).

**Aura**: `range`, `side`, `mods`. It is suppressed while its owner is Stunned or Frozen.

---

## 6. Named rules (`rules`)

A quirk may also define an `action`: an ability-like object (`target`, `effects`, `usesPerBattle` or `cooldown`)
that the hero can use **instead of** her normal action.

The rules below change core rules and can't be built from ops, so each one needs a small hook in the engine.
Keep the list closed: add a new rule only when an op can't express the effect.

| rule | params | semantics |
|---|---|---|
| `startCrowned` | `lossThresholdPct` | Starts the battle with the Crown (no heal or energy). Loses it if she takes ≥ threshold × max HP during one enemy turn. The first time she reaches the enemy back row in a battle she gets the full Awakening (heal + energy). That happens even if she still has the Crown, and it also restores a lost one. |
| `forwardOnly` | – | Can't move toward her own back row (jump-strikes may go any direction). Lifted by the Crown. |
| `displaceImmune` | – | Can't be pushed, pulled, swapped or tossed (collision damage still applies). |
| `jumpProof` | `except: ['shadow']` | Only Crowned enemies and the listed roles can jump-strike her. |
| `blinkMove` | `range` | Her move is `blink` (teleport within `range`). Awakened: range +1. |
| `passThroughAllies` | – | Glides may pass over allies (not land on them). |
| `leapfrog` | `energy` | A step may jump over an adjacent ally onto the empty square behind it. The ally gains `energy`. |
| `springboardWards` | – | Allies may hop over this hero's wards in moves and jump chains. A hop deals no damage, counts toward chain length and doesn't raise the combo step. |
| `retreatOnAdjacent` | `steps=1` | Once per enemy turn, when an enemy ends adjacent to her, she steps away (toward her own back row if possible). Not while Rooted, Stunned or Frozen. |
| `decoyWard` | `hpPct`, `place='ownBackRow'`, `reviveHpPct`, `veil` | At battleStart, spawn the decoy. Once per battle on `lethalDamage`, if the decoy stands: swap with it, destroy it, set HP to `reviveHpPct`, apply Veiled. |
| `eggRevive` | `eggHpPct`, `hatchAfterTurns`, `hatchHpPct`, `hatchEnergy`, `hatchBlastMult=0` | Once per battle on `selfKo`: she becomes an egg ward on her square. If the egg survives to the start of her side's `hatchAfterTurns`-th turn, she returns with those values. If `hatchBlastMult` > 0, she also deals that × ATK (her element) to enemies within radius 1. |
| `tossAlly` | `range`, `energy`, `cooldown` | Quirk action instead of her action: an adjacent ally flies along the same diagonal over units onto the farthest empty square within `range`. |
| `swapMove` | `range`, `usesPerBattle` | Her move may instead swap squares with an ally within `range`. |
| `rangedVeil` | `minDistance` | `single`/`line`/`lines` attacks from ≥ `minDistance` can't target her. |
| `blinkAfterAction` | `range` | After her action she must blink to an empty dark square within `range` (player choice; the AI picks the safest). |
| `chargeStacks` | `max`, `dmgPerStack`, `pierceWhenCharged` | `turnEndNotActivated` → +1 `charge`. Her next damaging action consumes them all. |
| `candleOnKo` | `turns`, `healPctMaxHp` | On `selfKo` leaves a 1-HP ward. At each own `turnStart` it heals adjacent allies. |
| `cocoon` | `hpBelow`, `range`, `uses` | When an ally within range drops below the threshold, apply Veiled 1 and Stun 1 to that ally (`uses` per battle). |

---

## 7. Turn timing (summary; full rules in the GDD)

1. **Turn start (side X):** skill cooldowns −1 (not for Stunned or Frozen units), Burn/Regen ticks, zone `onTurnStart`, `turnStart` triggers, ward behaviors.
2. **Activation:** choose one hero that can act. Then do one of: (a) move, then an optional action (basic / skill / ult / quirk action); (b) a jump-strike chain; (c) wait (+10 energy, Brace).
3. **Turn end (side X):** statuses and seals of side X lose 1 turn, `turnEnd` / `turnEndNotActivated` triggers fire, then the victory check.

A skill with `cooldown: N` that is used on turn t becomes usable again on turn t + N.
Awakening happens the moment a hero ends a move, a `moveSelf`, a hop or a landing on the enemy back row.

---

## 8. Constellations (`patches`)

```js
{ c: 3, desc: { ru, en }, patches: [ { path: 'skill.mult', mul: 1.2 } ] }
```

| patch | meaning |
|---|---|
| `{ path, add \| mul \| set }` | edits a field of the hero object. `path` is dotted, e.g. `skill.cooldown`, `ultimate.cost`, `skill.target.length`, `skill.effects.0.turns`, `quirks.0.rules.0.params.max`, `passive.triggers.0.effects.0.amount`. `set` may create a missing leaf or array index. |
| `path: 'skill.mult'` / `'ultimate.mult'` | shorthand: multiplies every `mult` field in that ability's effects, including nested ward behaviors (percent-of-HP fields are left alone) |
| `{ mod: {...} }` | adds a mod (§5) to the hero |
| `{ trigger: {...} }` | adds a trigger to the hero (as an extra passive trigger) |
| `{ aura: {...} }` | adds an aura (§5) to the hero |
| `{ effect: {...}, to }` | appends an effect; `to` = `'skill'` · `'ultimate'` · `'passive.triggers.N'` · `'quirks.N.triggers.M'` |
| `{ path, unset: true }` | deletes a field (e.g. an `if`) |

Patches stack in order C1 → C6.

---

## 9. Seals and reactions (resolution of one damage instance)

1. **Look up the reaction.** If the hit carries an element (not `'none'`), check the receiver's seal in the
   same slot (natural or celestial): `reaction = reactionFor(hitEl, seal)`.
2. **Compute the damage** (rules.js `DAMAGE`). An amplifying reaction (Пар, Затмение) adds its multiplier to this
   hit. A Frozen receiver takes ×1.4 (constellations may raise it), then the ice breaks. Shields absorb first, then HP.
3. **Apply the seal outcome:**
   - a reaction → resolve its extra effects (rules.js `REACTIONS`: splash, arcs, freeze, shield, statuses), consume
     the seal, and do **not** apply the hit's element; the triggering hero gains +10 energy;
   - the same element → refresh it to 2 turns;
   - no seal → apply the hit's element if it `leavesSeal`;
   - a different element with no reaction → replace the seal (only if the new element `leavesSeal`).
4. Damage from reactions (Detonation splash, Arc chains, Vortex spread) never triggers further reactions. Spread and
   chain seals are only applied to units that have no natural seal.

---

## 10. Wards, zones, collisions

- **Ward:** an object on a dark square with HP and DEF 0. It blocks movement and landing. If `jumpable`, enemies can jump-strike it (that hop damages it) and allies can't hop over it, unless the `springboardWards` rule applies. `behavior` = trigger list (e.g. `turnStart` → damage) that uses the **owner's** stats. Wards take no seals, statuses or reactions. They don't count toward victory or HP %. They expire after `turns` of the owner's side.
- **Zone:** a marker on squares (several zones may overlap; same id refreshes). `onEnter` fires when a unit of `side` ends a move/hop/displacement there (once per activation). `onTurnStart` fires for units of `side` standing there at the start of their turn.
- **Collision:** a push or pull that is blocked by the edge, a unit or a ward deals `0.3 × source ATK` true damage to the moved unit. A blocking unit takes half of that.
- **Boss:** CC and displacement turn into Stagger stacks; 3 stacks → Break (rules.js `BOSS`).

---

## 11. Example (Мидзуха, skill)

```js
skill: {
  id: 'tidal-bell', cooldown: 3,
  target: { shape: 'radius', r: 1, center: 'caster', side: 'any' },
  effects: [
    { op: 'heal', mult: 1.4, who: 'alliesInShape' },
    { op: 'cleanse', count: 1, who: 'alliesInShape' },
    { op: 'seal', element: 'tide', who: 'enemiesInShape' },
    { op: 'push', dist: 1, from: 'caster', who: 'enemiesInShape' },
  ],
}
```
