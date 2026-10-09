# QA-замечания (ревью перед финальной доработкой)

Ревью проведено независимыми ревьюерами; 5 из 6 успели закончить: RO — правила остальных вариантов, RTR — правила турецких/русских, EAD — арт-директор EPIC-режима, MUX — мобильный UX, F — код и надёжность.
Ревью производительности было остановлено по просьбе пользователя — его нужно перезапустить.
Ни одно замечание ниже ещё НЕ исправлено. Ошибок в правилах ходов не найдено ни в одном варианте.

## Ревьюер RO

Reviewer rules-others. I checked the rules of International, Brazilian, Canadian, English, Pool, Italian, Spanish and Czech draughts in src/engine (mirrored in src/ai/board.js) against outside sources: Wikipedia articles on Italian draughts, American Pool Checkers and Czech draughts; PlayStrategy and Jocly pages on Spanish draughts; Spanish-language rules pages; lidraughts' Brazilian page; Brazilian 20-move draw sources; and a PlayStrategy forum thread that quotes a 1947 pool-checkers rulebook. I also probed the engine with adversarial positions (scripts in /tmp/claude-0/-home-user-examples-image-loading/86371ced-f6f3-5277-95ce-5576743f43e5/scratchpad/review/rules-others/), ran the 179 engine tests (all pass), stress-tested move generation on 12×12 (worst case found: 22 ms, 3262 merged alternative paths), and took real-app screenshots of the Italian and International boards.

Verdict: move generation is correct for all eight variants. Who moves first (Black in English and Pool, White elsewhere), the initial setups, the board orientation (Italian and Spanish: playing square in each player's bottom-right corner, double corner on the left, confirmed on screen), backward captures, flying vs short kings, the Turkish strike (captured pieces stay on the board as blockers), the majority rule, Italian's 4 priorities, the Spanish quantity-then-quality laws, Czech's 'a king must capture' rule, men passing through the last row staying men (International/Brazilian/Canadian/Pool), promotion ending the move (English/Italian/Spanish/Czech), Italian men not capturing kings, and the numeric square numbering for 10×10 and 12×12 all match the researched rules.

The only verified rules error is in Pool. Three kings against a lone king must win within 13 moves; the engine allows 15 (copied from Russian/PlayStrategy rules), and the rules text says 15 too. The other findings are about how rules are presented: illegal-tap feedback under the majority/priority rules, the draw-reason text for endgame move limits, draw offers that work only in two-player mode, the coordinates promised for 10×10/12×12 boards, Spanish square colour, and Russian wording in badges, taglines and rules texts.

### RO-1 [major] (engine) Pool checkers: 3 kings vs lone king draw limit is 15 moves; the real rule is 13

Pool uses the Russian endgame tracker r3v1 (draw when the strong side has made 15 own moves). The American Pool Checkers rules say: 'if one player has three kings and the other has just one king, the player with the three kings must win within thirteen moves (even if the fourteenth move is a capture)'. Sources: Wikipedia 'American Pool Checkers'; the gambiter / Wikipedia draughts-variants table entry for Pool ('must win in thirteen moves'); and the PlayStrategy forum thread 'on pool craughts rule should be corrected', which quotes a 1947 pool rulebook ('before the long king counts to thirteen') and says PlayStrategy copied the Russian rule. variants.js names PlayStrategy as its Pool source, so this error was inherited. The player sees the wrong number: rules-text.js:127 (ru) and :137 (en) both say 15. The pool '15 king-only moves each' no-progress limit also comes only from the Russian copy; I found no pool source for it, so it should be labelled as an app rule (as the Czech text does).

**Доказательства:** Script /tmp/claude-0/-home-user-examples-image-loading/86371ced-f6f3-5277-95ce-5576743f43e5/scratchpad/review/rules-others/pool13b.mjs. Position 'w:......../......../......../......../......../......../......../W.W.W...' with B on h8 (W a1,c1,e1 vs B h8), eg tracker set to n plies: plies=27/28 (14 strong moves) -> null; plies=29 (15 strong moves) -> {winner:0, reason:'move-limit'}. Code: src/engine/variants.js:310 draw.rules ['r3v1']; src/engine/rules.js:404-410 `draw: (k, n, f) => strongMoves(k, n, f) >= 15`; src/ai/board.js:52 + egDraw EG_R3V1 (>=15); tests/engine/draws.test.js:189 asserts 15. Rules text ru: 'три дамки (и больше) против одинокой дамки не взяли её за 15 ходов'.

**Как исправить:** src/engine/rules.js EG_RULES: add `p3v1: { key: same as r3v1, draw: (k, n, f) => strongMoves(k, n, f) >= 13 }`. src/ai/board.js: add `const EG_P3V1 = 7`, map `p3v1: EG_P3V1` in EG_IDS, and add `case EG_P3V1` in egKey (same as EG_R3V1) and in egDraw (`strongMoves(key, n, f) >= 13`). src/engine/variants.js pool: `draw.rules: ['p3v1']`. Update tests/engine/draws.test.js:189 to 13 moves (no draw after 12 strong moves, draw after 13). Texts at rules-text.js:127: 'Ничья: троекратное повторение позиции; соглашение; если три дамки против одинокой дамки не выиграли за 13 своих ходов; (правило приложения) 15 ходов подряд каждой стороны только дамками без взятий и ходов простыми.' Make the same change in en (line 137).

### RO-2 [minor] (controller) Majority/priority rules: tapping a piece that can capture only says 'Обязательный бой!'; Italian man-vs-king tap gets no explanation

In International, Brazilian, Canadian, Spanish, Italian and Czech, a piece that physically can capture is often not allowed to: another sequence takes more pieces, a king must capture (Czech; Italian priority 2), or Italian men cannot take kings. The controller treats such a tap like any other illegal tap. If any capture exists, the HUD shows 'Обязательный бой!'. That is confusing, because the player is trying to capture. In the Italian man-next-to-a-king case nothing is shown at all. A Russian player used to free choice of capture will meet this constantly in the majority variants and won't understand why their capture is refused.

**Доказательства:** Engine outputs (scratch ux.mjs). International 'w:.b.......W/........../........../......b.../........../....b...../...w....../...' gives only 32x23x14: the king on 5 can capture one piece but is not selectable. Czech c3 man + h2 king vs d4,f6,g3 gives only h2:e5:g7 / h2:e5:h8: the man c3 could take 2. Italian w c4 vs B d5 gives only c4-b5. Code: src/controller.js:565-566 (_mustCapture/_selectable), 798-803 (tap on non-selectable own piece -> _illegal), 877-885 (_illegal shows only t('hud.mustCapture')); src/ui/i18n.js:287 'Обязательный бой!'.

**Как исправить:** Export a helper from src/engine/rules.js, e.g. `rawCaptures(state)`: run the capture generation in legalMoves but return the list before finalizeCaptures. In Controller._illegal(sq), if the tapped own piece appears in rawCaptures but not in this._selectable, choose the reason from variant.capture. 'max'/'max-kings': 'Нужно бить максимум шашек — есть серия длиннее'. 'king-first', or 'italian' when a king capture exists: 'Бить обязана дамка'. 'italian' with a man adjacent to a king and an empty landing square: 'Простая не может бить дамку'. Add these keys to i18n.js in ru and en, and show them via hud.setStatus(..., { tone: 'alert' }).

### RO-3 [minor] (ui) Endgame move-limit draws (FMJD 5/16-move, Brazilian main-diagonal, Pool 3v1) are reported as 'Слишком долго без взятий'

positionResult returns reason 'move-limit' both for the long no-progress rule and for the short endgame limits (f5, f16, bRoad, r3v1). In International, 2 kings vs a lone king is declared drawn after just 5 moves each. The game-over screen then says 'Слишком долго без взятий' ('Too long without a capture'), which makes no sense after 10 plies and doesn't tell the player which rule ended the game. These limits are unfamiliar to most players (FMJD 16/5 moves, Brazilian main diagonal 5 moves), and nothing in the game warns that the count is running.

**Доказательства:** Scratch f5.mjs. International 'w:.B......../........../.../..W.....W.' (W 47, 50 vs B 1), shuffle moves 47-41 1-6 41-36 6-1 36-31 1-6 31-26 6-1 26-21 1-6 -> 'ended after plies: 10 result: {"winner":0,"reason":"move-limit"}'. src/ui/overlays.js:70-71 maps it to t('go.r.move-limit'); src/ui/i18n.js:343 'Слишком долго без взятий', :696 'Too long without a capture'.

**Как исправить:** In src/engine/rules.js positionResult, return `{ winner: 0, reason: 'move-limit', rule: rules[i] }` for EG_RULES hits and `rule: 'quiet'` for the no-progress counter. In src/ui/overlays.js reasonText, use `go.r.limit.<rule>` when present. Add ru strings: f5 'Ничья: дамка против одинокой дамки — 5 ходов без победы', f16 'Ничья: три фигуры против одинокой дамки не выиграли за 16 ходов', bRoad 'Ничья: одинокая дамка на главной диагонали — 5 ходов', r3v1/p3v1 'Ничья: три дамки не поймали одинокую дамку', quiet 'Ничья: долго ходили только дамками'. Optional polish: when an eg tracker is active, show a HUD countdown ('До ничьей: 3 хода').

### RO-4 [minor] (ui) A draw can be offered only in 2-player mode, though the rules texts promise draw by agreement and the controller has AI accept/decline logic

The pause menu shows 'Предложить ничью' only when mode === 'pvp'. Controller.offerDraw has a full AI branch: it accepts after move 20 in a balanced position, otherwise shows the toasts 'ИИ отказывается от ничьей — бьёмся дальше!' / 'ИИ принимает ничью'. No UI can reach that branch. The rules texts of every variant list 'соглашение' / 'Ничью можно предложить сопернику' (International: 'Ничью можно предложить.'), but against the AI, which is the main mode, the player cannot offer one.

**Доказательства:** src/ui/overlays.js:26 `mode === 'pvp' ? small({ label: t('pause.offerDraw'), ... onClick: onDraw }) : null`; src/controller.js:1026-1049 offerDraw with the `this.mode === 'ai'` branch and strings drawDeclinedAi/drawAcceptedAi (lines 25-26); src/main.js:162 ui.on('offer-draw'). grep shows no other entry point for offer-draw.

**Как исправить:** In src/ui/overlays.js:26, change the condition to `mode !== 'demo'`. In src/ui/ui.js onDraw (line ~415), skip the PvP confirmation dialog when mode === 'ai' and emit 'offer-draw' directly; the controller already shows the accept/decline toast.

### RO-5 [polish] (engine) Badges: Czech 'Дамка бьёт первой' misstates the rule; 'Бой только вперёд' wrongly suggests kings can't capture backwards

The Czech rule is a priority: if a king can capture, a king must capture. 'Дамка бьёт первой' / 'King captures first' reads as if the king strikes first within a sequence or before the men in time. The English, Spanish and Czech badges say 'Бой только вперёд' / 'Forward capture', but in these variants kings capture backwards too (in Spanish and Czech, flying). Only men are limited. Badges are the first thing the player reads on the setup and rules screens.

**Доказательства:** src/engine/variants.js:409-410 czech badges ['8×8','Дамка летает','Дамка бьёт первой','Бой только вперёд'] / en 'King captures first','Forward capture'; english badges (variants.js ~245) 'Бой только вперёд'; spanish badges (~385) 'Бой только вперёд'. Rules text czech[3] states the real rule: 'если бить может дамка, то бить обязана дамка'.

**Как исправить:** Czech badges: ru ['8×8','Дамка летает','Бить обязана дамка','Простые бьют вперёд'], en ['8×8','Flying kings','King must capture','Men capture forward']. English and Spanish: replace 'Бой только вперёд' with 'Простые бьют вперёд' (en 'Men capture forward').

### RO-6 [polish] (engine) Russian wording in rules texts and taglines: unnatural phrases, a missing 'каждой стороны', and app-only draw limits presented as official

Specific spots: (1) English rules[2]: 'бьёт тоже на ближней дистанции' is a calque; Russian rules say 'бьёт только соседнюю шашку'. (2) International tagline 'Стоклеточные 10×10: 20 шашек, …' is a fragment with no noun. (3) Brazilian tagline 'обязательный бой максимума' is not idiomatic. (4) Pool rules[7] puts a full clause ('три дамки … не взяли её за 15 ходов') inside a list of noun phrases, and its '15 ходов подряд только дамками' lacks 'каждой стороны', while the engine counts 15 per side (30 plies) and all other variants' texts say 'каждой стороны'. (5) The Italian 40-move (rules-text.js:150) and Spanish 20-move (:196) limits read as official rules. variants.js's own research note calls the Italian one an app rule ('sources disagree'), and Czech already marks its limit '(правило приложения)'.

**Доказательства:** src/engine/rules-text.js:78 'Дамка «короткая»: … бьёт тоже на ближней дистанции, вперёд и назад.'; src/engine/variants.js:220 'Стоклеточные 10×10: 20 шашек, летающие дамки, бить максимум.'; variants.js:273 '… летающие дамки и обязательный бой максимума.'; rules-text.js:127 Pool draw paragraph; rules-text.js:150 (italian) and :196 (spanish) vs variants.js research comment 'ITALIAN … app rule — 40 moves each'.

**Как исправить:** rules-text.js:78 → 'Дамка «короткая»: ходит на одно поле по диагонали в любую сторону и бьёт только соседнюю шашку — вперёд и назад.' variants.js:220 → 'Стоклеточные шашки: доска 10×10, по 20 шашек, летающие дамки, бить максимум.' variants.js:273 → 'Международные правила на доске 8×8: летающие дамки, бить нужно максимум шашек.' Pool rules[7]: see RO-1. Italian and Spanish draw paragraphs: add '(правило приложения)' before the move limit, as the Czech text does.

### RO-7 [polish] (render) 10×10 and 12×12 rules say squares are numbered 1–50 / 1–72, but those boards show no coordinates at all

The International and Canadian rules texts tell the player 'Поля обозначаются номерами от 1 до 50/72'. The renderer draws coordinate labels only for boards up to 8×8, and no move list exists anywhere in the UI. On 10×10 and 12×12 the player never sees a number, so the sentence refers to nothing. The engine already has correct FMJD numbering (square 1 = top-left dark square from White's side, 46 = a1).

**Доказательства:** src/render/renderer.js:307 `labels: n <= 8 && fw >= 11`; screenshot /tmp/claude-0/-home-user-examples-image-loading/86371ced-f6f3-5277-95ce-5576743f43e5/scratchpad/review/rules-others/shots/international.png (10×10 board, no numbers or labels); src/engine/rules-text.js:53 and :166.

**Как исправить:** Option A: in src/render/board-textures.js, for n >= 10 (classic theme), draw E.squareName numbers small (~sq*0.22 px, 35% alpha) in the top-left corner of each playable square, ideally behind a 'Показывать координаты' setting. Option B: delete the sentence 'Поля обозначаются номерами …' from rules-text.js:53 and :166 (and the en versions).

### RO-8 [polish] (render) Spanish draughts is shown on dark squares and the rules screen says 'Поля: Тёмные'; the traditional Spanish board uses the light squares

The geometry is right: the playing square sits in each player's bottom-right corner, with parity 0 as in Italian. However, PlayStrategy's Spanish page says: 'The traditional setup for Spanish Draughts has checkers on the light squares and a light square in the bottom right hand corner. An alternative setup with the checkers on the dark squares and a dark square in the bottom right hand corner is known as Portuguese Draughts.' So the app's Spanish board looks like Portuguese draughts, and the rules screen states the wrong square colour. Gameplay is unaffected.

**Доказательства:** src/ui/screens/rules.js:97 `[t('rules.squares'), v.playable === 'all' ? t('rules.squaresAll') : t('rules.squaresDark')]`. src/engine/variants.js spanish: `playable: 'dark', darkParity: 0`. The renderer always paints playable squares in the dark tone (renderer.js:294-306 passes only parity).

**Как исправить:** Add the metadata flag `squareTone: 'light'` to the spanish variant. In rules.js:97 show t('rules.squaresLight') ('Светлые') when it is set. Optionally, in src/render/board-textures.js, swap the light and dark square fills when `L.squareTone === 'light'` (pass it through renderer._computeLayout), so the playing squares are the light ones as on a real Spanish board. Mention it in rules-text spanish[0]: 'играют на светлых полях'.

## Ревьюер RTR

I found no wrong-rule bugs in Turkish, Russian or giveaway move generation. The engine matches both an independent move generator I wrote and the AI's own generator. The defects I found are in AI behaviour (demo games ending early in repetition draws, accepting draw offers while winning, giving away a king in endings already drawn by rule), one draw rule that stops applying above 7 pieces, and the result/rules texts.

How the engine checks out:
- Reference generator: I wrote a separate Russian+Turkish move generator from the rules, not from the engine's code. On 30,000 random king-heavy positions per variant it agrees with legalMoves exactly (same moves, captured pieces and promotion flags, 0 mismatches).
- AI generator: SearchBoard.generate matches the engine on 240,000 random positions (Turkish and Russian, normal and giveaway, 0 mismatches). Turkish captures went up to 17 pieces.
- Hand-built Turkish positions all correct: men move/capture forward or sideways only; kings fly along ranks and files, land on any square beyond and must land where the capture continues; captured pieces removed at once (king passed back through d3 after taking it: d1:d5:g5:g3:a3); no 180-degree turn between jumps; maximum capture counts kings and men the same; a man reaching the last row mid-capture keeps capturing sideways as a man and is crowned at the end (d6:d8:f8); one piece each is a draw, switched off in giveaway.
- Hand-built Russian positions all correct: men capture backward; free choice of capture sequence but it must be finished; captured pieces stay until the move ends and block; a man promoted mid-capture continues as a long-range king (f6:d8:a5); counters for the 15/5/30/60-move draw rules work as intended.
- Promotion in the real app: entering both promotions by tapping in the built app gives a crowned piece in the renderer.
- Unit tests: all 179 engine tests pass.

Research: the web-fetch tool could not reach any site (DNS failure), so I worked from web-search summaries only.
- Turkish (TUDAF Turk_Damasi_Kurallari_Tudaf_v3): a draw when each side has one piece left, even king vs man; a man that reaches the dama row by capturing keeps capturing as a man ('yoz tas ... almaya devam eder'). The engine follows this. Other sources disagree on mid-capture promotion (Skich/Tabletopia: continues as a king), so I did not report it as a bug.
- Russian (Minsport rules 2019/2022, section 6.1.8): the engine's 15/5/30/60-move draw rules match.
- Turkish 2 kings vs 1 king: under the immediate one-piece-each draw, my retrograde solve shows it is practically a draw (only 196 of 124,992 black-to-move positions are lost).

AI strength:
- Clear ladder in Node games (Russian and Turkish): level 2 beat level 1 in 12 of 12 games, level 3 beat level 2 in 8 of 8, level 5 beat level 1 in 4 of 4.
- Level 1 beats a random mover in 38 of 40 games, so it is weak but not boring.
- Levels 4 and 5 play sound games. In the one game level 5 lost to level 4 (Russian), a 2.5 s analysis of every position agreed with nearly all of level 5's moves; it slowly lost ground rather than blundering.
- Turkish 3 kings vs 1 is won in 3 moves, and the Russian 15-move ending with 3 kings vs a lone king off the main diagonal is won in time.

Scripts and outputs are in /tmp/claude-0/-home-user-examples-image-loading/86371ced-f6f3-5277-95ce-5576743f43e5/scratchpad/review/rules-turkish-russian/ (ref.mjs, fuzz.mjs, fuzz2.mjs, play.mjs, demo.mjs, drawoffer.mjs, kinggive.mjs, retro.mjs, bal.mjs, r3v1.mjs, e2e_promo.mjs, shots/turk2.png).

### RTR-01 [major] (ai) Turkish AI-vs-AI (demo) games often end in an early threefold-repetition draw with almost all pieces still on the board

search.js scores a repetition as exactly 0 (negamax line 252: if (b.isRepetition()) return 0) and has no contempt. In demo mode both sides get the same level: controller.js line 353 (level = cfg.level for both players) and line 590 (opts.level). In the closed Turkish opening both engines see roughly 0 and are content to shuffle men sideways (g3-h3 / h3-g3), which never resets the counters. Result: the demo screen shows 'Ничья: троекратное повторение' after about 20-35 moves per side with 12-16 pieces each, which looks broken. A human who shuffles is not affected: in my test the level 3-5 AI played on. Russian equal-level demos did not show this (0 of 14).

**Доказательства:** Node script demo.mjs / play.mjs. Same search() and historyHashes as the app; seed undefined means Math.random, as in the app.
- Level 5 (white) vs level 4: 42 plies, 16 v 16 pieces. Tail: ... g3-g4 f5-g5 h3-g3 g5-h5 g3-h3 h5-g5 h3-g3 g5-h5 g3-h3 h5-g5.
- Level 4 vs level 4: 68 plies, 14 v 14. Tail: g3-h3 d5-c5 h3-g3 c5-d5 g3-h3 d5-c5.
- Level 3 vs level 3: ply 74 (15 v 15), ply 96 (12 v 12), ply 74 (16 v 16, tail b4-a4 a7-b7 a4-b4 b7-a7).
Total: 5 of 22 Turkish equal-level games ended this way. Outputs: review/rules-turkish-russian/demo_turkish_3.txt, demo_turkish_4.txt, dt3_*.txt, t54.txt.

**Как исправить:** Add a contempt factor in src/ai/search.js:
1. In attach(), set S.rootTurn = state.turn and S.contempt = giveaway ? 0 : 20 (0.2 man). Optionally make it a LEVEL_PARAMS field, and apply it only while total pieces >= 1/3 of the start.
2. In negamax, replace 'if (b.isRepetition()) return 0;' with 'if (b.isRepetition()) return b.turn === S.rootTurn ? -S.contempt : S.contempt;'.
3. Use the same value for drawByRule() draws when the side to move has moves.
Each search then treats an early repetition as slightly bad for its own side, so both demo sides avoid it. Add a test: Turkish level 3 vs level 3 from the start must not end by repetition with more than 20 pieces in about 10 seeded games.

### RTR-02 [minor] (controller) The AI accepts a draw offer in positions where it is clearly winning (decision uses static eval only)

Controller.offerDraw (controller.js lines 1028-1034) accepts when g.history.length >= 40 and |evaluateState(state)| <= 60. evaluateState is a static evaluation with no search. It misses a man about to promote or a pending combination, so a player who is losing can offer a draw and get it. This happens at every level, including 'Бог шашек'.

**Доказательства:** Turkish position, white (human) to move, ply 58 of a simulated human (level 2) vs AI (level 4) game:
w:......../.......b/bbb..bb./.bbbbb../ww...ww./wwww.ww./.w...w.b/........
- Material is 12 v 12 and evaluateState = -42, so the controller accepts.
- search(level 5, 4 s) = -284 for white (PV b2-a2 h2-h1 ...): the AI is about to crown h2-h1 and is about 2.8 men up.
In drawoffer.mjs, 3 of 9 offers accepted by the static rule in Turkish were in positions where a 1 s search showed the AI up 1.5 men or more.

**Как исправить:** In controller.offerDraw, run a short search instead of the static eval: const r = await this.ai.think(g.state, { level: 3, timeMs: 400, historyHashes: g.hashes }). Convert r.score to the AI's point of view (it is from the side to move) and accept only if aiScore <= 30 and g.history.length >= 40. Otherwise show the drawDeclinedAi toast. When r is null, decline.

### RTR-03 [minor] (ai) Level 3-5 AI gives away a king in endings already drawn by rule because 2-vs-1 'drawish' endings score above 0

evaluate.js lines 207-232 only divide the score in drawish endings: /16 for a flying-king 2-vs-1, /4 for Turkish 2K vs 1K. They never make it 0. Search scores a draw by rule as exactly 0. When the move-limit rule is about to end the game, a move that lets the lone king take one of three kings (leaving 2K vs 1K, about +20) looks better than 0. The engines play it, and with epic effects the AI's 'Гроссмейстер' visibly hangs a king.
Same cause in Turkish: 2K vs 1K scores about +80. My retrograde solve under the engine's rules (one piece each = draw) shows it is practically a draw: only 196 of 124,992 black-to-move positions are lost. Level 5 shuffled for 100 plies into a move-limit draw.

**Доказательства:** Russian, start W kings c1 e1 g1, B king a1 (lone king on the main road, so the 5-move rule applies). Moves: c1-f4 a1-b2 e1-h4 b2-g7 h4-d8 g7-h8, giving w:...W...B/......../......../......../.....W../......../......../......W. (main-road tracker n=6).
- search(allScores) at levels 3/4/5 all play f4-e5, scores +20/+26/+25. Every other move scores 0.
- After f4-e5, h8 must capture e5 (kinggive.mjs).
In a full level 5 game from this start, white played g1-d4?? and black replied h8:b2.
Turkish W kings a1 h1 vs B king d5: 100 plies, draw by move limit (endgame.mjs). Retrograde solve: retro.mjs.

**Как исправить:** In evaluate.js, drawish block:
- Flying diagonal kings (Russian/pool/Brazilian/International): when wp === 1 && sp <= 2 && wkk >= 1, return 0 instead of div = 16.
- Turkish (ortho): when wp === 1 && sp <= 2 && wkk >= 1, return 0, because one piece each is an immediate draw.
Also, in search, return a tiny material tie-breaker for draws by rule (e.g. (ownPieces - oppPieces) * 2), so that among equal draws the AI keeps its material.

### RTR-04 [minor] (engine) Russian rule '3 kings or more vs a lone king: 15 moves' is not tracked when more than 7 pieces are on the board

updateEg returns empty trackers as soon as total material is above 7: src/engine/rules.js line 492 'if (total > 7) return emptyEg(len);', mirrored in src/ai/board.js line 1134. The 7-piece limit belongs to the balance rule (2-7 pieces) only. Minsport rules 6.1.8.4 apply the 15-move limit to 'три дамки и более шашек (простых и дамок) против одной дамки' with any number of extra men. With 3 kings + 4 or more men against a lone king, the strong side can play on indefinitely by moving a man now and then. That resets the 15-kings-only counter, while the 3-kings rule never starts.

**Доказательства:** stateFromString('russian','w:......../B......./......../......../......../......../...W.W.W/w.w.....').counters.eg = ['w',0,1,...]: the tracker is active with 3 kings + 2 men.
The same with 2 more men (w:......../B......./......../......../......../......../...W.W.W/w.w.w.w.) gives ['',0,0,'',0,0,'',0,0]: no tracker (r3v1.mjs).

**Как исправить:** In rules.js updateEg (and SearchBoard.updateEg), skip the 'total > 7' early return for the r3v1 rule: compute r3v1's key for any material and keep the cutoff for rRoad/rBalance/f16/f5/bRoad. Add a draws.test.js case: 3 kings + 4 men vs a lone king; the strong side makes 15 moves including man moves without capturing, and the result must be a draw ('move-limit').

### RTR-05 [minor] (ui) Draw reasons are lumped into 'Слишком долго без взятий' and there is no countdown; Russian 5-move endgame draws feel random

positionResult reports every counter rule as reason 'move-limit'. That covers the 15 kings-only moves, 3 kings vs 1 (15 moves), the main road (5 moves) and the 2-3/4-5/6-7-piece balance rule (5/30/60 moves). The UI shows 'Слишком долго без взятий' (i18n.js line 343) for all of them. In the 3-piece balance rule the game ends after only 5 moves each, often while a man is walking to promotion. The player gets no warning and the stated reason ('too long without a capture') does not explain it. Russian endgames hit these rules all the time: 4 of 6 level 3 vs level 3 Russian demos ended this way.

**Доказательства:** Russian K a1 + man g3 vs K b8 (bal.mjs). Moves g3-h4 b8-a7 h4-g5 a7-b8 g5-h6 b8-a7 a1-b2 a7-b8 b2-a1 b8-a7 end in {winner:0, reason:'move-limit'} after 10 plies. The white man stands on h6, two steps from crowning. The UI text would be 'Слишком долго без взятий'. There is no 'counters' or countdown usage anywhere in src/ui or controller.js (grep).

**Как исправить:** 1. In rules.js positionResult, add a field naming the rule: { winner:0, reason:'move-limit', rule: 'quiet' | 'r3v1' | 'rRoad' | 'rBalance' | 'f16' | 'f5' | 'bRoad' }.
2. Add i18n keys go.r.rule.<id>:
- r3v1: 'Три дамки не поймали одинокую за 15 ходов'
- rRoad: 'Одинокая дамка продержалась на большой дороге 5 ходов'
- rBalance: 'Соотношение сил не менялось {n} ходов'
- quiet (Russian): '15 ходов только дамками без взятий'
- quiet (Turkish): '50 ходов без взятий и ходов простыми вперёд'
3. Export drawCountdown(state) -> { rule, movesLeft } | null, using the EG_RULES and quiet counters. Have the HUD toast 'До ничьей: N хода' when movesLeft <= 3.

### RTR-06 [minor] (ui) Giveaway section of the rules pages does not say that the variant's draw rules change, and the engine's GIVEAWAY_RULES text is unused and wrong for Turkish

Every variant page ends with the generic 'Поддавки' card (rules.js line 121, i18n 'rules.giveaway': 'Правила ходов и боя те же...'). The card directly above it, on the Turkish page, says 'Если у обоих игроков осталось ровно по одной шашке — ничья'. In giveaway the engine switches that rule off (rules.js positionResult: !gw && v.draw.oneEach), together with all Russian endgame limits. The player is told nothing.
The engine already has GIVEAWAY_RULES (rules-text.js) with a draw paragraph, but no module imports it. Its draw sentence 'по правилу ходов только дамками выбранного варианта' is false for Turkish, whose limit is 50 moves without captures or forward man moves. The English version has the same error ('the variant's king-moves limit').

**Доказательства:** grep GIVEAWAY_RULES src: only defined/re-exported in src/engine. rules-text.js line 239: 'Ничья — при троекратном повторении позиции и по правилу ходов только дамками выбранного варианта.' i18n.js line 156 has no draw information. Engine: Turkish one man vs one man in giveaway is not a draw; a level 3 vs level 2 giveaway game went on to a repetition at ply 106.

**Как исправить:** Show GIVEAWAY_RULES[lang] in the giveaway card of rules.js variantPage instead of the single t('rules.giveaway'). Fix the draw paragraph to: 'Ничья — при троекратном повторении позиции и по правилу «долго без продвижения» выбранного варианта (в русских — 15 ходов только дамками, в турецких — 50 ходов без взятий и ходов простыми вперёд). Ничейные правила эндшпиля (например, «по одной шашке» в турецких) в поддавках не действуют.' Mirror it in English.

### RTR-07 [polish] (ui) Turkish 1v1 draw reason 'Ни у кого нет сил на победу' is misleading

Turkish one-piece-each draws use reason 'insufficient', shown as 'Ни у кого нет сил на победу' / 'Neither side can force a win' (i18n.js lines 345, 698). The draw is a TÜDAF rule that applies immediately, even king vs man, or when the side to move could take the last piece. A player with a king against a lone man reads 'nobody can win' and thinks the app is wrong.

**Доказательства:** Engine: P('turkish','w',{W:'d4',b:'d6'}) gives positionResult {winner:0, reason:'insufficient'}, although the white king could capture the black man at once (d4:d7). Level 3 vs level 3 Turkish demo game 2 ended this way at 88 plies (wm 1 vs bk 1).

**Как исправить:** Change go.r.insufficient (ru) to 'По одной шашке у каждого — ничья по правилам турецких шашек' and (en) to 'One piece each — a draw under Turkish rules'. If other variants later use 'insufficient', use a variant-specific key.

### RTR-08 [polish] (ui) Rules texts: ambiguous pronoun, a misplaced main-road clause, an unclear capture line and em dashes at line starts

1. Turkish rule 7 (rules-text.js line 36): 'лишил их возможности ходить' — 'их' refers to 'шашки' and reads clumsily. Better: 'лишил его возможности сделать ход' (as the Russian text says).
2. Russian rule 8 (rules-text.js line 14): one 70-word run-on sentence. The clause '(а против одинокой дамки на большой дороге при трёх фигурах — за 5 ходов)' is placed inside the 3-kings clause, but the engine applies it to any 3 pieces, men included (rRoad key wm+wk===3). Split into a bulleted list: repetition; 15 kings-only moves; 3+ kings vs a lone king, 15 moves; any 3 pieces vs a lone king on the main road, 5 moves; both sides have kings, 5/30/60.
3. Turkish rule 4 does not say the king can jump only one piece and the path up to it must be empty; the Russian text says so ('если на пути нет других фигур').
4. Em dashes break onto a new line ('— ничья.' starts a line). Use a non-breaking space before every em dash in RULES_TEXT (' —').

**Доказательства:** Screenshot review/rules-turkish-russian/shots/turk2.png (rules page, Turkish, 390x844): paragraph 07 ends with a line starting with '— ничья.'. Texts printed from RULES_TEXT.russian.ru[7] and RULES_TEXT.turkish.ru[3], [6].

**Как исправить:** Edit src/engine/rules-text.js:
- turkish.ru[6]: 'Побеждает тот, кто взял все шашки соперника или лишил его возможности сделать ход. Если у обоих игроков осталось ровно по одной шашке — ничья.'
- turkish.ru[3]: add 'через одну шашку соперника, если путь до неё свободен,'.
- russian.ru[7]: rewrite as short clauses and move the main-road part to its own clause: 'если у одной стороны три шашки (любые) против одинокой дамки, стоящей на большой дороге, — 5 ходов'.
- Replace ' — ' with ' — ' throughout, or do it at render time in rules.js.

## Ревьюер EAD

I reviewed the real app (my own copy of dist/www, rebuilt 18:25) in EPIC and classic mode at 390x844, 360x640, 768x1024 and 412x915. To get honest timing I wrote a frame-stepping driver: it stops the Pixi ticker, steps the game at 60 fps, and also replaces setTimeout and performance.now so the controller's AI delays run on the same clock. It also logs every Director call with a timestamp.

Scenes staged: quiet move, single capture, Russian ×2 and ×3, Turkish orthogonal ×3, International flying king ×5, promotion, Russian promotion in the middle of a capture, ULTIMATE (hype set to 1), AI capture, VS intro, flawless victory, defeat, draw, selection/hint, classic capture and promotion.

Measured timings are all within budget:
- quiet move 433 ms
- single capture 1.35 s
- double 3.18 s
- triple 3.97 s (Turkish 3.93 s)
- International ×5 6.0 s
- promotion 2.1 s
- ULTIMATE single capture 3.45 s
- victory 3.3 s, defeat 3.75 s, draw 3.0 s

No page errors in any run.

Verdict: the individual set pieces already feel like anime — the manga impact frame, the slash, the 覚醒 pillar, 必殺, the cut-in with attack names, 何?!, the VS 対決 and 勝利/敗北. The brag texts are natural, varied Russian. Classic mode is calm and premium.

What breaks the anime feel is ORCHESTRATION between beats:
1. Text piles up after every combo: «ХОД ПРОТИВНИКА» + ×N КОМБО + finale kanji + caption at the same moment.
2. The turn banner lands right on top of the player's own brag caption (same anchor point).
3. The combo counter collides with the hit kanji and 何?!.
4. The climax frame of every multi-capture and of the ULTIMATE is an unreadable white/black smear: impact frame, chromatic, zoom blur, bloom and flash are all stacked at once.
5. The amber last-move tint is muddy walnut-brown on the neon board.
6. The VS screen is boxed in by the HUD.

The ~93 px (390x844) and ~117 px (412x915) of empty space above and below the board is the single best fix: turn it into "lanes" for banners, captions, the combo counter and a captured-pieces trophy rack.

Evidence lives under /tmp/claude-0/-home-user-examples-image-loading/86371ced-f6f3-5277-95ce-5576743f43e5/scratchpad/review/epic-art-director/ (S below). Each scenario folder has m-NN.png frames, m-sheet.png contact sheets labelled with game-clock ms, and k*.png full-size picks. Driver: S/cap.mjs plus the S/*.json scenarios; logs are S/*.log.

### EAD-01 [major] (director) After every combo, the «ХОД ПРОТИВНИКА» banner, ×N КОМБО, the finale kanji and the caption are all on screen together

In vs-AI the controller calls director.playTurn() for the AI the instant playMove resolves (controller.js:597). Several things from the human's combo are still on screen at that moment:
- the combo counter, held 2600 ms after the last hit (director.js:901)
- the finale kanji (爆!/ドン!/轟!), about 1 s plus its shatter
- the brag caption, 1900 ms

The new turn banner slams in at the top edge of the board, right where the combo counter sits, so the counter, banner and kanji overlap for about 0.7–1 s after every multi-capture.

The same thing happens at game start: «ТВОЙ ХОД» appears under the still-visible «ДА НАЧНЁТСЯ БИТВА!» banner. Nothing in the Director checks what overlays are already active.

**Доказательства:** Event log, Russian 3-capture (s3.log, game-clock ms):
- playMove 1200→5167
- combo3@3200
- playTurn(ai)@5167

Frames:
- S/s3/m-27.png (t=5500): «ХОД ПРОТИВНИКА» + «×3 КОМБО!» + 爆! + «Прыг-прыг — и тишина.» + amber squares, all at once. Full-size: S/s3/k4.png, 3rd panel.
- S/s8/k.png, 4th panel (Turkish, t=4950): the same pile-up.
- S/s7/k.png, 4th panel (International ×5, t=7100): the same.
- S/s4/m-22.png (VS intro): turn banner overlaps «ДА НАЧНЁТСЯ БИТВА!».

**Как исправить:** src/fx/director.js:
1. At the end of _epicFinale, just after cam.reset in step 6, call fx.hideCombo(). Also cut `hold: 2600` (line 901) to 1400.
2. At the start of playTurn (line 1316), add `if (this.fx && this.fx.combo) this.fx.hideCombo();`.
3. Keep `this._overlayUntil = clock.realNow + remaining` whenever a finale kanji, banner or caption starts. In playTurn, delay the turnBanner by `max(0, _overlayUntil - realNow)`, or skip it when the previous move was a capture (the status chip and setTurnGlow flare already show the turn).
4. playGameStart: set _overlayUntil to cover the 'fight' banner (duration _t(1150)), so the first «ТВОЙ ХОД» waits for it.

### EAD-02 [major] (director) The «ТВОЙ ХОД» banner is drawn on top of the player's own brag caption

Both overlays anchor to the bottom edge of the board frame:
- caption: y = fr.y + fr.height + ph/2 + 6 (director-ui.js:217)
- turn banner: y = fr.y + fr.height (director-ui.js:325)

The AI answers a combo with a quiet move after about 650 + 433 ms, so «ТВОЙ ХОД» arrives about 1.1 s after the human's move ends. The human's 1900 ms caption is still visible, and the banner covers it for about 0.8 s, making the brag unreadable. The mirror case is an AI caption (top) under «ХОД ПРОТИВНИКА» (top).

At 768x1024 the bottom banner also covers the «ВАШ ХОД» status chip.

**Доказательства:** - S/s3/m-34.png (t=6550): «ТВОЙ ХОД» plate over «Прыг-прыг — и тишина.»; text unreadable. Also S/s3/k4.png, 4th panel.
- S/s8/m-sheet.png, frame t=6000: «Это называется — искусство!» under «ТВОЙ ХОД».
- S/s7/m-sheet.png, frame t=7900: same.
- S/st3/game.png (768x1024): banner overlaps the status chip.

**Как исправить:** src/fx/director.js:
- _maybeCaption: store the caption as `this._captionFx = { side, p, until: realNow + 1900 }`.
- playTurn: if `_captionFx.side === side` and it is still alive, either call `p.stop()` first (effects from fx._run expose .stop()), or move the banner off the caption: bottom → `fr.y + fr.height + captionH + 14`, top → `fr.y - captionH - 14`.

Better: move both into the empty lanes (see EAD-15), with caption and banner on separate rows: banner at lane centre −20 px, caption at lane centre +22 px.

### EAD-03 [major] (fx) The combo counter collides with the per-hit kanji and with 何?! in every multi-capture

comboNow places the counter inside the top-left or top-right corner of the board frame (anime.js:1176-1177: x0 = fr.x+4, y0 = fr.y + min(0.16·fr.h, 90)). This is in screen space, while the camera is zoomed in on the action.

The Director places per-hit kanji at V.x ± 0.55·sz, V.y − 0.75·sz, alternating sides (director.js:794-797), and places 何?! at the centroid of the doomed pieces. None of them avoid the counter's rectangle. Whenever the action is in the upper half of the board, gold «×2/×3 КОМБО!» sits right on top of 斬!/撃!/何?!. That is text over text and illegible.

**Доказательства:** - S/s2/k1.png panels 1, 2, 4: «×2 КОМБО!» over 破!, «×3 КОМБО!» over 斬!, «×3 КОМБО!» over red 何?! and ゴゴゴ.
- S/s6/k.png, 4th panel: ×2 + 何?!.
- S/s7/k.png, 2nd panel: ×5 + 何?! + ゴゴゴ.
- The same in S/s3/m-sheet.png (t=2650–3700).

**Как исправить:** Do both:
1. src/fx/anime.js comboNow: when there is room, put the counter OUTSIDE the board, in the empty top lane: `y0 = fr.y - numSize*0.55` when `fr.y - safeTop > numSize*1.3`. Otherwise keep the current spot.
2. src/fx/director.js:
   - _strike: put the multi-hit kanji on the side away from the counter (`side = m.comboSide === 'left' ? 1 : -1`) instead of `i % 2`.
   - _epicFinale step 3: offset 何?! horizontally by `+/- sz*1.2` away from comboSide.
   - Optionally, before spawning text, test overlap against `fx.combo.root.getBounds()` and nudge the text.

### EAD-04 [major] (fx) The climax frame of every multi-capture and of the ULTIMATE is an unreadable white/black smear

_epicFinale fires all of these on the same frame (director.js:996-1004):
- impactFrame (3 frames)
- chromatic 1.4
- bloomPulse 0.95
- zoomBlur 0.24
- flash 0.32 at +120 ms
- every victim's explosion at once

The result is about 150–300 ms that is either a chromatic-smeared negative full of black blobs or a pure white screen. You cannot see the attacker, the victims or the chain. This is the money shot of every combo, and right now it reads as a rendering glitch rather than a manga impact frame.

The ULTIMATE strike (_epicSingle, the m.ultimate block) does the same: the follow-up ドン! is washed out inside a white bloom sphere. Single captures, which use only impactFrame + chromatic 1, stay readable. Compare S/s1/m1.png.

**Доказательства:** - S/s3/m-23.png (t=4900): screen fully white except the HUD.
- S/s8/k.png panels 1–2 (t=4200, 4350): smeared black blobs with RGB fringes, then a white-out.
- S/s7/k.png, 3rd panel (t=6300): giant blurred black ink blots.
- S/s9/k.png panels 3–4: the ULTIMATE white-out; ドン! unreadable in the bloom.

**Как исправить:** Change _epicFinale step 5 in src/fx/director.js:
- Use a crisp `impactFrame({ frames: 2, duration: 100 })` with NO chromatic or zoom blur during it.
- After 110 ms realtime, fire `chromatic(0.6, 360)`, `zoomBlur(cxs, cys, 0.1, 300)` and `bloomPulse(0.5, 600)`.
- Flash alpha 0.32 → 0.18.
- Detonate the corpses one by one along the lightning chain, 70 ms apart (`wait(k*70)`), each with its own small shake. This reads as an anime chain reaction and keeps silhouettes visible.
- Start the finale kanji 60 ms after the LAST detonation.

In the _epicSingle ULTIMATE block: zoomBlur 0.3 → 0.15 and bloomPulse 0.55 → 0.35, both started after the impact frame.

### EAD-05 [major] (render) The amber last-move tint looks like muddy walnut-brown on the neon epic board

Both themes use lastMove 0xffb547: EPIC in palette.js:43, CLASSIC on line 14. Epic draws it with a normal blend at alpha 0.32×0.7 (highlights.js:401-412), plus an amber frame.

Over obsidian tiles (≈ rgb 36-54, 15-32, 47-82) this gives a dull brown square, measured at rgb(107-119, 55-64, 51-57): exactly a classic wood colour. It appears on every move of the game and clashes with the cyan/crimson/violet neon palette. It also looks almost the same as the gold 'selected' square, so the two are easy to confuse.

**Доказательства:** - S/s13/m-16.png: pixels at (135,355) = (107,55,57) and (120,345) = (119,64,51); an empty tile at (178,395) = (36,15,47).
- Also visible in S/s1/m2.png (c3/e5), S/s3/m-34.png and S/s7/k.png, 4th panel.

**Как исправить:** src/render/highlights.js _drawLast, epic branch:
- Tint with the mover's side colour: `const v = this.r.pieceAt(path[path.length-1]); const col = EPIC.side[v ? v.color : 1];`.
- Fill with 'add' blend: alpha 0.10 on the from-square, 0.16 on the to-square.
- Frame (add): alpha 0.35 on the from-square, 0.8 on the to-square.
- For intermediate path squares, draw a frame only at alpha 0.2.

Alternative: set EPIC.lastMove = 0xb9a6ff (gridHot) and switch the epic fill to 'add'. Keep the classic palette as is; it fits the wood.

### EAD-06 [major] (director) The VS intro is boxed in by the DOM HUD; the portraits are generic and the hero is called «ВЫ»

During playGameStart the opponent panel, the player panel, the «ВАШ ХОД» chip, the «ПРОПУСТИТЬ» chip and the action buttons are all at full opacity.

The VS split only shows in the middle ~560 px:
- The top HUD covers part of the crimson portrait.
- The skip chip and status chip sit on the cyan portrait ring.

The portraits themselves are a crown, or a plain cyan disc with a white dot. There is no character. The player's fighter name is «ВЫ» (controller.js:351, t('hud.you')), which reads oddly as a fighter name next to «БОГ ШАШЕК».

**Доказательства:** - S/s4/k.png panels 1–3 (VS at t=233/833/1133): HUD bars and chips over the split; cyan portrait = empty disc; «ВЫ / БЕЛЫЕ / УРОВЕНЬ СИЛЫ: 7484».
- S/s4/m-sheet.png: the full sequence.

**Как исправить:** 1. src/controller.js, before playGameStart in epic: add class 'is-intro' to .screen--game, and remove it once the Director resolves.
   In src/ui/hud.css: `.screen--game.is-intro .hp, .screen--game.is-intro .status, .screen--game.is-intro .actions { opacity: 0; transform: translateY(±130%) }`. This reuses the existing is-entering transition, so the HUD slides in after the drop.
2. src/fx/director-ui.js versusNow: draw the fighter's kanji (players[c].kanji for the AI — 侍/神…, 主 for the human, matching the HUD watermark) huge inside the portrait ring with a brush-stroke backdrop, instead of T.emblem.
3. Name the human fighter «ИГРОК» or use the earned title (players[c].title) as the big name, with «БЕЛЫЕ» as the sub-line.

### EAD-07 [minor] (ui) The same turn is announced in two registers at once: «ТВОЙ ХОД» vs «ВАШ ХОД», «ХОД ПРОТИВНИКА» vs «ХОД СОПЕРНИКА»

The Director banner uses STR.ru.yourTurn 'ТВОЙ ХОД' and oppTurn 'ХОД ПРОТИВНИКА' (director.js:43-44). The HUD chip, visible at the same time, says 'Ваш ход' / 'Ход соперника' (i18n.js:285-286).

On top of that, the player is «Вы» in the HUD, the caption speaker tag reads «ВЫ» above «Прыг-прыг — и тишина.», and the brag lines themselves use «ты». A Russian speaker notices the mixed ты/вы and the two different words for the opponent immediately.

**Доказательства:** - S/base1/shot-00.png: «ТВОЙ ХОД» banner + «ВАШ ХОД» chip.
- S/s1/m2.png, 3rd panel: «ХОД ПРОТИВНИКА» banner + «ХОД СОПЕРНИКА» chip.
- S/s3/k4.png, 3rd panel: caption tag «ВЫ».

**Как исправить:** Pick one voice for EPIC: informal «ты».
- i18n.js: add epic variants 'hud.yourTurnEpic': 'Твой ход' and 'hud.opponentTurnEpic': 'Ход соперника', and use them in hud.js when epic.
- director.js STR.ru: oppTurn 'ХОД СОПЕРНИКА'.
- Caption speaker: pass «ИГРОК» or the player's title instead of t('hud.you') for the human (controller.js:351 → name: t('hud.player'), or a new 'hud.hero': 'Герой').

### EAD-08 [minor] (director) Kanji placement ignores the screen edges and the DOM HUD: 破! is cut off, 覚醒 hides under the opponent panel

_strike puts the single-capture kanji at V.x, sized by _kanjiSize to about 74% of the screen width, but never clamps its position (director.js:793-800). On an a- or h-file capture under camera zoom, half the glyph is off-screen.

In _epicPromote, 'roomAbove' only checks `ps.y - ... > 4` (director.js:1109-1111). It ignores the ~91 px opponent HUD, so for a mid-capture promotion near rank 8 the 覚醒 kanji is drawn under the DOM panel and clipped at the right edge.

**Доказательства:** - S/s13/k.png, 1st panel (AI capture into a3, t=2583): «破!» cut off at x=0.
- S/s6/k.png, 1st panel (Russian promotion in the middle of a capture, t=1783): 覚醒 partly behind the «Ученик / ЯРОСТЬ» panel and clipped at the right edge.

**Как исправить:** Add a renderer.safeRect, set from main.js on 'board-rect' (the .board-area rect: top 97, bottom 648 at 390x844).

In director.js, add a helper `_clampText(wx, wy, wPx, hPx)`:
- worldToScreen
- clamp x to [wPx/2+8, W-wPx/2-8] and y to [safe.top+hPx/2+4, safe.bottom-hPx/2-4]
- screenToWorld back

Use it in _strike, _epicPromote (replacing the `> 4` test with `> safe.top`), _ko and _epicFinale for 何?! and the finale kanji. Width ≈ size·len·0.9·zoom, height ≈ size·1.1·zoom.

### EAD-09 [minor] (fx) The kanji 'shatter' exit breaks into flat grey rectangles that drift into the next turn

The shatter exit cuts the glyph texture into a 2×(3–7) grid of rectangles (anime.js:615-633). The glow/disc layers disappear at that moment, so what remains are dull grey or pink rectangular blocks. They tumble across the board like cardboard for 260 ms, often while the next turn banner or AI selection is already on screen.

It is most visible with the VS 対決: big yellow slabs over the power level text. It also hits every 撃!/破!/ドン! exit.

**Доказательства:** - S/s4/k.png, 3rd panel: 対決 slabs.
- S/s1/m2.png panels 1–3: grey 撃! blocks under «ХОД ПРОТИВНИКА».
- S/s13/k.png, 3rd panel: pink 破! blocks.
- S/s8/k.png, 4th panel: ドン! fragments over the turn banner.

**Как исправить:** In src/fx/anime.js startExit 'shatter':
- Build 7–10 irregular triangular shards with the existing meshFromPoly/clipHalf helpers, using random cut lines through the glyph centre, instead of the rectangular grid.
- Give each shard an additive duplicate tinted with the kanji colour, at alpha 0.6 fading to 0.
- Add a one-frame white flash plus 12 'spark' particles at the break.
- Use exitDur 180 ms, with gravity 9 → 14.

In director.js, make the finale and single-capture kanji finish before playMove resolves: duration ≤ remaining cinematic time.

### EAD-10 [minor] (director) The ULTIMATE cut-in subtitle is unreadably small (≈7–8 px)

The ULTIMATE subtitle is `${bragLine('ultimate')} · ${this._s('ultimate')}` (director.js:1068), for example «Сила, превосходящая небеса! · УЛЬТИМЕЙТ · ЯРОСТЬ 100%». At 390 px the cut-in band height is 156 px, so the nominal subtitle size is 20 px. The long line is then scaled down to fit, to about 7–8 CSS px.

The title also wraps to 3 lines («Секретный стиль: Штормовой Самурайский Ураган»), so the band is crowded right at the most important bragging beat.

**Доказательства:** S/s9/k.png, 2nd panel (t=1767): the subtitle line under the 3-line title is a barely visible strip.

**Как исправить:** director.js:1068: subtitle = bragLine('ultimate') only. Show 'УЛЬТИМЕЙТ · ЯРОСТЬ 100%' as the sub-text of the 必殺 kanji or as a small gold tag above the band.

anime.js cutIn: wrap the subtitle to 2 lines before scaling, and never scale below 13 px (`Math.max(13/sSize, fit)`).

brag.js attackName: when ctx.ultimate is set, drop the adjective in pattern 0/2 so the name with its prefix stays at 2 lines or fewer.

### EAD-11 [minor] (render) Epic board: playable and non-playable squares are nearly the same (~1.2:1 contrast), so diagonals are hard to read

The obsidian (playable) and slate (non-playable) tiles differ by about 15 luminance levels on a near-black base. Empty diagonals, which you need for planning moves and following AI captures, barely show. It is worse on a 360 px phone (37 px squares). Classic is fine.

**Доказательства:** Mean luma of tile centres in S/st3/game.png (768x1024, Russian, epic):
- non-playable: 32.7–38.7
- playable: 15.3–23.8
- relative-luminance contrast ≈ 1.2:1

At phone size: S/st2/game.png (360x640).

**Как исправить:** In src/render/board-textures.js, either:
- (a) Make the playable squares the lit 'pads': lift the obsidian base about +14 luma with a faint violet inner glow, and drop the slate about −6 luma. Target ≥ 1.6:1.
- (b) Keep the colours and add a 1 px inner neon edge (EPIC.grid #7A5CFF, alpha 0.35) on every playable square.

Check it on Russian and International at 360x640.

### EAD-12 [minor] (director) Flawless victory looks almost like a normal win (完璧 is defined but never used), and capture streaks are tracked but never bragged about

_epicVictory always slams kanjiFor('win') = 勝利 (director.js:1388). Only the banner text changes to «БЕЗУПРЕЧНО!».

brag.js KANJI.flawless = ['完璧'] and KANJI.combo = ['連撃','連斬'] are only preloaded and never shown. Director._streak (consecutive capturing turns, director.js:566) is computed and never used. These are free bragging beats being thrown away.

**Доказательства:** - grep: kanjiFor( is used only for capture/hit/nani/finale/ultimate/promote/ko/start/win/lose/draw.
- S/s10/k.png, 2nd panel: a flawless win shows 勝利, identical to a normal win.

**Как исправить:** director.js _epicVictory:
- Use `kanjiFor(flawless ? 'flawless' : 'win')`.
- For flawless also: gold rays at 1.3× size, a second slash across the kanji, and the announcer saying 'PERFECT!' (it already does).

_maybeCaption: when `this._streak[mover] >= 3`, use a new 'streak' event («Серия ×{n}! Кто следующий?») and flash 連撃 next to the caption.

### EAD-13 [minor] (ui) The game-over card brags about zeros: «Комбо ×0», «Комбо ×1», «Дамок: 0»

overlays.js:176 always builds statBits with combo, lost and kings, even when the value is 0 (or a combo of 1). A victory card saying «Комбо ×1 · Дамок: 0», or a defeat or draw card full of zeros, undercuts the bragging.

**Доказательства:** - S/s10/k.png, 4th panel (flawless victory): «Комбо ×1», «Дамок: 0».
- S/s11/m-sheet.png, frames t≥7000 (defeat): «Комбо ×0 · Потери: 1 · Дамок: 0».
- S/s12/m-sheet.png (draw): «Комбо ×0 · Потери: 0 · Дамок: 0».

**Как исправить:** src/ui/overlays.js:176-177:
- Include combo only if s.combo ≥ 2.
- Include kings only if s.kings ≥ 1.
- For a win, show «Потерь: 0» as a gold highlight instead of a grey chip.
- If nothing remains, show moves («Ходов: N»).

### EAD-14 [minor] (fx) The ULTIMATE-only «Тайная техника:» prefix also appears on ordinary ×5 combos

attackName adds a RU_PREFIX/EN_PREFIX ('Тайная техника', 'Запретное искусство'…) whenever `ctx.ultimate || (n >= 5 && rnd() < 0.5)` (brag.js:633 and :617). The ULTIMATE intro also uses this prefix, so a plain 5-capture looks like the ULTIMATE and the rage payoff loses its exclusivity.

**Доказательства:** S/s7/k.png, 1st panel: International ×5 with hype 0 (fresh position) gets the cut-in «Тайная техника: Казнь Пяти Драконов».

**Как исправить:** brag.js lines 617/633: apply the prefix only when ctx.ultimate is set. For n ≥ 5, use a different flourish, e.g. append «— Финал» or pick from RU_GEN, so the ULTIMATE wording stays unique.

### EAD-15 [polish] (ui) Use the empty space above and below the board (93 px at 390x844, 117 px at 412x915) as epic 'lanes' and a trophy rack

Measured layout (S/rects.mjs):
- 390x844: .board-area is 374×551 but #board-slot is only 366×366 (y 190–556), leaving 93 px above and 92 px below.
- 412x915 (typical 20:9 Android): 388×388 in a 622 px area, leaving 117 px on each side.
- 360x640: only 23 px.

The board also gets just 366 of 390 px in width (8 px .game padding + 4 px inset each side).

Right now every overlay (turn banner, caption, combo counter, kanji) is crammed onto the board edges while that space sits empty. Using it would fix EAD-01, EAD-02 and EAD-03 at once and add bragging flair.

**Доказательства:** rects.mjs output:
- 390x844 slot [12,190,366,366], area [8,97,374,551]
- 412x915 slot [12,214,388,388], area [8,97,396,622]

Screenshots: S/base1/shot-00.png, S/st3/game.png.

**Как исправить:** 1. Full-bleed board: in hud.css for the game screen, set `.board-area { margin: 0 calc(-8px - var(--sal)) 0 calc(-8px - var(--sar)) }`. The board becomes 390 px wide instead of 366 (+6.6%) and the HUD keeps its padding.
2. Expose `renderer.lanes = { top: {y: area.top, h: slot.top-area.top}, bottom: {...} }` from main.js on board-rect.
3. Epic, when lane height ≥ 60 px:
   - turnBanner and caption live in the lane of their side (rows: banner at centre −20 px, caption at +22 px)
   - comboCounter sits in the top lane
   - add a 'trophy rack': captured enemy discs (mini PieceView snapshots, 18 px) line up in each side's lane; on every capture one shard flies from the victim into the rack and lands with a spark.
4. Classic: centre the board as now, or use the lanes for the captured-piece rows only.

### EAD-16 [polish] (director) Pacing: every double capture plays the full 3.2 s finale (cut-in + 何?! + white-out), which will feel repetitive over a 60-move game

_epicMove sends anything that is not a single one-hop capture to _epicMulti + _epicFinale (director.js:640-643). Measured with virtual time:
- double capture 3.18 s, against 1.35 s for a single capture
- triple 3.97 s
- ×5 6.0 s

Double captures are common in Russian and International, and each one plays the identical beat sequence: slow-mo → cut-in band → 何?! → simultaneous detonation → finale kanji. By the fifth double it stops being special.

**Доказательства:** - S/tm2.log: playMove@300 → done@3483 for path [40,26,12].
- S/tm.log: single 300 → 1650.
- s3/s8/s7 logs for ×3 and ×5.
- Identical structure in S/s3, S/s6 and S/s8 sheets.

**Как исправить:** Tier the finale in director.js:
- n=2: no cut-in and no 何?!. Double slash, both marked victims detonate 70 ms apart, kanji 連斬. Target ≤ 2.0 s.
- n=3: cut-in, but alternate between 3 finale templates (current one; 'back-turned pose' where the attacker lands and the victims explode after a 400 ms beat; 'one-frame cut' where the screen splits along a slash line) and remember the last template.
- n≥4: the full current treatment.
- First double of the game: allow the full version once.

### EAD-17 [polish] (director) The turn banner fires on every single turn (60+ times a game) and duplicates the HUD chip

playTurn shows a turn banner with a slash line and the 'turn' SFX for every turn, both human and AI (director.js:1316-1333). The HUD status chip and the board edge glow (setTurnGlow flare) already show whose turn it is.

After a few minutes the banner becomes visual noise rather than a hype beat, and it is the main source of collisions in EAD-01 and EAD-02.

**Доказательства:** Event logs: one playTurn per ply (e.g. S/s3.log, S/s13.log). The banner is visible in nearly every sheet (S/s5/m-sheet.png t=2883–3817, S/s13/m-sheet.png).

**Как исправить:** In playTurn, show the banner only when it adds something:
- first turn of the game
- after the opponent captured or promoted
- when the side to move must capture (text «ОБЯЗАТЕЛЬНЫЙ БОЙ!»)
- when the human has been idle for more than 6 s
- when the mover's hype is full (text «УЛЬТА ГОТОВА!», gold)

Otherwise keep only setTurnGlow({flare:true}) plus the 'turn' sound.

### EAD-18 [polish] (fx) The manga impact frame stops at the DOM HUD, so the inverted frame looks boxed in

impactFrame applies colour-matrix filters to the Pixi layers only. The DOM HUD (top/bottom panels, chips, buttons; about 40% of the screen at 390x844) stays in full colour, so the B/W negative frame is framed by colourful UI. A real anime impact frame inverts the whole screen.

**Доказательства:** S/s1/m1.png panels 1–2 (single capture, t=1250/1300): an inverted board between the normal red and cyan HUD panels. Same in S/s3/m-sheet.png t=1750.

**Как исправить:** Add an `fx.onImpact(ms)` hook, or have the Director toggle the class directly: `document.getElementById('ui').classList.add('fx-impact')` for the impact duration (90–130 ms), alternating per frame with 'fx-impact-b'.

CSS in epic.css:
- `.fx-impact { filter: invert(1) grayscale(1) contrast(1.8); }`
- `.fx-impact-b { filter: grayscale(1) contrast(3) brightness(0.6); }`

This is a cheap, short-lived filter on DOM only; skip it on quality 'low'.

### EAD-19 [polish] (director) The camera never uses dutch angles; all camera work is zoom and pan

The Camera supports rotation (focus(..., { rotation }), rotateTo, per the render report), but director.js never passes a rotation. A tilted lock-on and alternating tilts per hop are basic anime fight-scene grammar and would add a lot of energy for almost no cost.

**Доказательства:** grep 'rotation|rotateTo' in src/fx/director.js returns no camera usage. Every captured frame (e.g. S/s3/m-sheet.png, S/s7/m-sheet.png) shows a level board during the zooms.

**Как исправить:** director.js:
- _epicSingle lock-on: `_focus(..., { rotation: (h.ang > 0 ? 1 : -1) * 0.07 })`.
- _epicMulti per hop: rotation `(i % 2 ? 1 : -1) * 0.05`.
- _epicFinale pose: rotation 0.09 toward the attacker, then cam.reset() (already called) brings it back.
- ULTIMATE intro: rotation −0.1.
- Keep 0 in classic.

### EAD-20 [polish] (director) «ЯРОСТЬ 100%» has no on-board moment; ULTIMATE readiness only shows as small HUD text

When hype reaches 1 (after a big combo, or slowly through losses and promotions), the only feedback is the HUD 'rage-burst' pulse and the tiny «УЛЬТА ГОТОВА!» label (hud.js:336). That is the biggest hype milestone in the game, and nothing in the anime layer marks it. The next capture becomes the ULTIMATE with no build-up visible on the board.

**Доказательства:** S/s7/k.png, 4th panel (after the ×5 combo, hype full): only «УЛЬТА ГОТОВА!» in 9 px text in the bottom panel. No Director call fires (S/s7.log).

**Как исправить:** Add `director.playRageFull(color)`, called by the controller in _applyStats when hype crosses 1:
- 怒 kanji (gold, 0.9 s, in the side's lane)
- a 600 ms red-gold aura flicker on all of that side's pieces: fx.aura(view, { color: gold, intensity: 0.6 }), stopped later
- announcer 'ULTIMATE READY'
- 'power' SFX

While hype stays full, keep a subtle ember stream on that side's board edge: setTurnGlow with flare, or fx.weather('embers') limited to the lane.

### EAD-21 [polish] (director) Brag captions are small (≈18 px) and rate-limited, so most single captures get no trash talk

_maybeCaption shows a 1900 ms caption in an 18 px plate under the board, and only:
- after a 2.6 s global cooldown
- with chance 0.6 (human) or 0.5 (AI) on captures
- with a gap of 2–3 moves
- quiet moves at 4–9%

Roughly 1 capture in 3 gets a line. The client asked for maximum хвастовство. The lines are good, but you rarely see them, and they read like subtitles rather than a character talking.

**Доказательства:** - Captions seen: «Ты открылся. Ошибка.» (S/s10/k.png), «Хочешь, дам фору?» (S/s11/m-sheet.png).
- No caption on the AI capture in S/s13/m-sheet.png or the human single capture in S/s1.
- Code: director.js:1148-1181.

**Как исправить:** - Render captions as manga speech bubbles coming from the speaker's HUD avatar, in that side's lane (see EAD-15): 22–24 px Russo One, a tail pointing at the avatar, a 4° tilt, and the avatar kanji flashing.
- Raise capture chance: human 0.8, AI 0.65. Gap 1 move. Global cooldown 1800 ms.
- On a quiet move right after the opponent's capture, the AI answers 30% of the time with a 'taunt' or 'comeback'.
- Keep the no-repeat logic in brag.js.

### EAD-22 [polish] (controller) Classic mode: the combo counter covers the a8–b8 squares, and the «ПРОПУСТИТЬ» chip flashes on sub-second animations

In classic mode the combo counter uses the same in-frame corner placement as epic, so «×3 КОМБО!» sits on the top-left squares and covers a piece for about 0.9 s.

The skip chip appears whenever a cinematic runs longer than 400 ms (controller.js:281), so in classic it pops in for a few hundred ms during a 933 ms triple capture or a 950 ms promotion. That twitchy UI hurts the calm, premium feel.

**Доказательства:** - S/s14/m-sheet.png (classic triple capture): t=2066–2766 counter over b7/a8 with a black piece under it; skip chip visible t≈1666–1966.
- S/s15/m-sheet.png (classic promotion): skip chip t≈1533–1833.

**Как исправить:** - controller.js:281: `hud.setSkippable(busy && now() - t0 > (this.epic ? 400 : 1500))`.
- anime.js comboNow, classic: place the counter outside the frame (above the top-left corner, y0 = fr.y − numSize·0.6) or in the top lane, and use a 600 ms hold.

## Ревьюер MUX

I played the real app (dist/www, copied to my scratchpad) with real touch taps at 390x844 and 360x640, and briefly at 768x1024 and 844x390. Coverage:
- Full games vs AI: Russian classic twice (1 loss, 1 win), Turkish epic (81 plies, win), Turkish classic at 360x640 (draw by threefold repetition at ply 86). Plus scripted positions for single, triple, promotion and ULTIMATE captures in epic.
- PvP, the AI-vs-AI demo, undo, hint, pause, resign, the game-over cards, and stats and titles updating after games.
- Settings: language switch mid-game with no Cyrillic left in English, volumes, vibration (verified by spying on native.vibrate: 4 calls on, 0 off), animation speed, quality.
- Rules screens, the Android back button on every screen, and __androidPause/__androidResume during AI thinking.

No crashes, page errors or board mismatches occurred. Classic is fast and polished: quiet move about 0.3 s, capture about 0.42 s. Epic stays mostly within its budgets: quiet move 0.48 s, single capture 1.35 s, triple 4.2 s, promotion 2.23 s. Animation speed 2x halves these (epic single 1.35 to 0.75 s, triple 4.18 to 2.18 s), and tap-to-skip works (a triple drops to 0.45 s).

Pacing caveat: headless SwiftShader ran at 0.3 to 5 fps under heavy load, so all durations above were measured on renderer.clock.realNow (frames capped at 50 ms), which equals what a phone shows at 20 fps or more. Wall-clock times were not used.

Main problems:
1. Tapping each landing square of a multi-capture, as the rules tell you to, skips your own combo or ULTIMATE cinematic: 4.2 s becomes 0.55 s.
2. In max-capture variants (Turkish), tapping a piece that can capture fewer pieces shows a misleading «Обязательный бой!».
3. The epic banner «ТВОЙ ХОД» appears right above the HUD pill «ВАШ ХОД», and other terms are inconsistent the same way.
4. You cannot offer a draw against the AI, even though the rules say you can; the controller logic exists but no button reaches it.
5. Back on the main menu closes the app instantly.
6. Several Russian text errors: «Резня на 4 персон», «N шашки за один прыжок», the Turkish card's «Дама: ходы по прямой вперёд и вбок…» which reads as a statement about the king, and «Отмена» used both for undo and for cancel.

Screenshots and scripts are in /tmp/claude-0/-home-user-examples-image-loading/86371ced-f6f3-5277-95ce-5576743f43e5/scratchpad/review/mobile-ux/ (screenshots in s/; play2.mjs, cine.mjs, instr.js and t*.mjs are the reproductions; trE-timings.json holds the full epic-game timings).

### MUX-01 [major] (controller) Tapping each landing square of a multi-capture (as the rules instruct) skips the player's own combo/ULTIMATE cinematic

In Russian/International/etc. the controller commits the move as soon as the tapped prefix identifies a unique move (controller.js _extend, line 862: distinct.length === 1 -> _commitHuman). The player is told by the rules (i18n.js:161 «При взятии нескольких шашек отмечайте поля прыжков по очереди») to keep tapping the next landing squares. Those extra taps land on the canvas while director.busy is true, and controller._onTap (line 776) calls director.skip() on ANY tap during a cinematic, with no grace period. Result: the most spectacular moments of EPIC mode (your own multi-capture combo, the ULTIMATE when ЯРОСТЬ is full) are skipped by the player's own input, every time they follow the instructions. The AI's combos are not affected, so the AI gets the full show and the human gets a 0.5 s snap.

**Доказательства:** cine.mjs (scratchpad/review/mobile-ux), Russian epic, pos 'w:.b.....b/......../.....b../......../.....b../......../...b..../..w...w.', human triple c1:e3:g5:e7 (path 58,44,30,12):
- TAPS=2 (tap c1, e3 only): playMove device time 4183 ms (full cinematic)
- TAPS=4 GAP=400 ms (tap all four squares like a human following the rules): 550 ms (skipped)
Full Turkish epic game (trE-timings.json): the human's double capture with hype=1 (it was the ULTIMATE) lasted 500 ms; the human triple+promotion lasted 767 ms; meanwhile AI ultimates lasted 3533 ms and 6083 ms.

**Как исправить:** controller.js: in _commitHuman() store this._skipGuard = { until: now() + 900, squares: new Set(display.path) }. Change _onTap() to _onTap(e) (renderer.onTap already passes {x,y,sq}). Return without skipping when now() < this._skipGuard.until, or when e.sq is in this._skipGuard.squares and now() < until + 800. Optionally, for the human's own captures, require the «Пропустить» chip or a second tap to skip. Also update rules.howToText[3] to say that the move completes automatically once it is unambiguous.

### MUX-02 [major] (controller) Max-capture variants: tapping a piece that CAN capture (but fewer pieces) shows the misleading «ОБЯЗАТЕЛЬНЫЙ БОЙ!»

In Turkish (the client's main variant), International, Brazilian, Canadian, Spanish (capture:'max'/'max-kings'), Italian (priorities) and Czech (king-first), only the moves allowed by the priority rule are legal. When the player taps another own piece that also has a capture, _handleSquare -> _illegal() shows the generic hud.mustCapture «Обязательный бой!» (controller.js:877-886). The player is capturing, so the message reads as a bug: «I AM capturing, why can't I?». The real reason (you must take the MAXIMUM, or the king must capture in Czech) is never shown. The status stays on that message.

**Доказательства:** t4.mjs: Turkish pvp, pos 'w:......../......../.....b../......../.b...b../.w...w../......../........'. Legal = [[45,29,13]] (f3 must take 2). Tapping b3 (sq 41), which can capture b4, gives status «ОБЯЗАТЕЛЬНЫЙ БОЙ!», still shown 4 s later. Screenshot: scratchpad/review/mobile-ux/s/tk-max-1.png

**Как исправить:** controller._illegal(sq): when this._mustCapture and the tapped square is an own piece, pick the text by game.variant.capture. 'max' / 'max-kings' -> new i18n key hud.mustCaptureMax «Бить нужно максимум шашек!» (EN 'You must capture the maximum!'). 'king-first' -> «Бить обязана дамка!». 'italian' -> «Действуют приоритеты взятия — бейте подсвеченной шашкой». Otherwise keep hud.mustCapture. Also briefly pulse the selectable capture pieces (renderer.highlights.setSelectable) so the player sees which piece to use.

### MUX-03 [minor] (director) Mixed «ты/вы» and inconsistent terms: «ТВОЙ ХОД» banner directly above the «ВАШ ХОД» pill, ХОД ПРОТИВНИКА vs Ход соперника, УЛЬТИМЕЙТ vs УЛЬТА, СБИТО vs Взято, RAGE vs FURY

Every human turn in EPIC shows the Director banner «ТВОЙ ХОД» (director.js:43) while the HUD pill below it says «ВАШ ХОД» (i18n hud.yourTurn). A native speaker notices the register switch immediately. More inconsistencies:
- director.js:44 oppTurn «ХОД ПРОТИВНИКА» vs HUD «Ход соперника»
- director.js:71 ultimate «УЛЬТИМЕЙТ · ЯРОСТЬ 100%» vs HUD hud.rageFull «УЛЬТА ГОТОВА!» and the rules text «станет УЛЬТОЙ»
- director.js:66 «СБИТО: {n}» vs «Взято» everywhere else
- director.js:70 you «Ты» vs HUD «Вы»
- English: director.js:104 'ULTIMATE · FURY 100%' vs HUD 'RAGE'
- i18n epic.offHint «Сейчас спокойная классика. Включай!» uses «ты» while every other UI string uses «вы».

**Доказательства:** Screenshot scratchpad/review/mobile-ux/s/turnbanner-1.png (Russian epic, playing black): «ТВОЙ ХОД» banner directly above the «ВАШ ХОД» pill. Also s/trE-m024.png and s/intl-360-epic.png. Text sources: src/fx/director.js:43-73 and src/ui/i18n.js:60, 281-285.

**Как исправить:** src/fx/director.js STR.ru: yourTurn 'ВАШ ХОД', oppTurn 'ХОД СОПЕРНИКА', captures 'ВЗЯТО: {n}', ultimate 'УЛЬТА · ЯРОСТЬ 100%', you 'Вы'. STR.en: ultimate 'ULTIMATE · RAGE 100%'. i18n.js:60 'Сейчас спокойная классика. Включите!'. Rule of thumb: UI chrome always uses «вы»; «ты» only inside quoted character speech (brag captions).

### MUX-04 [minor] (ui) No way to offer a draw against the AI, although the rules screens promise it (AI accept/decline logic is unreachable)

The pause menu shows «Предложить ничью» only in pvp (overlays.js:26). The Russian rules page says «Ничью можно и предложить сопернику», and International says «Ничью можно предложить». Controller.offerDraw already has a full AI branch (controller.js:1029-1042: the AI accepts after move 20 in an equal position, with toasts drawDeclinedAi/drawAcceptedAi), but no button reaches it. In long king endgames against the AI, the only options are waiting for the move-limit rule or resigning.

**Доказательства:** t8.mjs, vs AI pause menu text: «ПАУЗА | Русские шашки | с ИИ · Боец | ПРОДОЛЖИТЬ | ПРАВИЛА ЭТОГО ВАРИАНТА | НАСТРОЙКИ | НАЧАТЬ ЗАНОВО | СДАТЬСЯ | В МЕНЮ». No draw offer. Screenshot s/ctl-pause.png. Rules text: src/engine/rules-text.js russian[7], international[7].

**Как исправить:** overlays.js:26: show the offer-draw button when mode === 'pvp' || mode === 'ai'. In ui.js onDraw (line ~415): if st.mode === 'ai', skip the two-player confirm, call resume() and emit('offer-draw', { color: st.bottomColor }). controller.offerDraw already shows the accept/decline toast.

### MUX-05 [minor] (ui) Android Back on the main menu (and title) exits the app instantly, with no confirmation or double-press

ui.back() returns false for 'title' and 'menu' (ui.js:323), and MainActivity.onBackPressed then calls finish(). With Android gesture navigation, an accidental edge swipe on the menu closes the game immediately. That is very easy to trigger, because the menu is where players return between games. Mobile games usually show «Нажмите «Назад» ещё раз, чтобы выйти» or a confirm dialog.

**Доказательства:** t17.mjs: on the title, window.__androidBack() -> false. After tapping into the menu, __androidBack() -> false and no toast. MainActivity.java:175-176: if (!handled) finish();

**Как исправить:** ui.js back(): for s.name === 'menu' (and 'title'): if Date.now() - this._lastBackAt < 2000, return false. Otherwise set this._lastBackAt = Date.now(), call this.toast(t('common.backAgain')) and return true. Add i18n common.backAgain «Нажмите «Назад» ещё раз, чтобы выйти» / 'Press Back again to exit'.

### MUX-06 [minor] (fx) Brag captions with Russian grammar/meaning errors: «Резня на 4 персон!», «4 шашки за один прыжок!», «Один прыжок — 2 павших.»

The comboBig bank is used for n ≥ 4 (brag.js:493), so n=4 produces «Резня на 4 персон!»; the correct form is «на 4 персоны» (genitive singular after 2–4). The combo lines «{n} {pieces} за один прыжок!» (brag.js:50) and «Один прыжок — {n} павших.» (brag.js:55) are shown for multi-jump captures, and a multi-capture is several jumps in ONE MOVE, so «за один прыжок» is factually wrong and jars a native speaker. These captions are shown big on screen during the most hyped moments.

**Доказательства:** node -e on src/fx/brag.js: bragLine('combo',{n:4},'ru') produced 'Резня на 4 персон!', '4 шашки за один прыжок!', 'Один прыжок — 4 павших.'; with n=2: '2 шашки за один прыжок!', 'Один прыжок — 2 павших.'. A caption is also visible in s/trE-m036.png («3 шашки за один прыжок!» during an AI triple).

**Как исправить:** src/fx/brag.js. Line 50: '{n} {pieces} за один ход!' (or 'Одним ходом — {n} {pieces}!'). Line 55: 'Один ход — {n} {pieces} в пыль.'. Line 69: replace with a plural-safe line such as 'Резня: {n} {pieces} за раз!', or add a {persons} placeholder in fill() using pluralRu(n, ['персону','персоны','персон']).

### MUX-07 [minor] (ui) Turkish variant card says «Дама: ходы по прямой вперёд и вбок…», which a Russian reads as a statement about the KING (wrong); «дама» vs «дамка» mixed

«Дама» is the Turkish name of the game, but in Russian «дама/дамка» means a king. The tagline «Дама: ходы по прямой вперёд и вбок, 16 шашек…» therefore reads as 'the king moves straight forward and sideways', which contradicts the rules (kings move in all four directions; men move forward and sideways). The badge «Летающая дама» and the Turkish rules text («Дама (дамка)…», «становится дамой») use «дама», while every other variant, title and HUD string uses «дамка». It appears on the setup card, the rules list and the rules hero.

**Доказательства:** Screenshots s/card-turkish.png and s/rules-turkish.png. Source: src/engine/variants.js:188 ru: 'Дама: ходы по прямой вперёд и вбок, 16 шашек, бить максимум — обязательно.', :192 badge 'Летающая дама'; src/engine/rules-text.js turkish ru[3], ru[5].

**Как исправить:** variants.js:188 → 'Турецкая «дама»: шашки ходят по прямой вперёд и вбок, 16 шашек, бить максимум обязательно.'. Line 192: badge 'Дамка летает'. rules-text.js turkish: write «Дамка (по-турецки «дама»)…» once and «дамка/дамкой» afterwards. The engine owns these files.

### MUX-08 [minor] (ui) HUD «Отмена» (undo) uses the same word as the dialogs' «Отмена» (cancel)

In Russian «Отмена» means 'Cancel'. The undo-move button is labelled «ОТМЕНА» (i18n hud.undo), and the confirm dialogs' cancel button is also «ОТМЕНА» (common.cancel). The rules even have to explain it («Отмена» — вернуть ход). A player can read the HUD button as 'cancel selection'.

**Доказательства:** s/ctl-undo.png (HUD buttons МЕНЮ / ОТМЕНА / ПОДСКАЗКА). The t8.mjs resign confirm dialog text was «Сдаться? Партия будет засчитана как поражение. | ОТМЕНА | СДАТЬСЯ». Source: src/ui/i18n.js:289 and :25.

**Как исправить:** i18n.js:289 'hud.undo': 'Ход назад' (9 characters, same as «ПОДСКАЗКА», so it fits at 360 px), or 'Вернуть'. Update rules.howToText[4] (i18n.js:162) to «Ход назад» — вернуть ход.

### MUX-09 [minor] (controller) Mandatory capture is not announced at the start of the turn; the status says «ВАШ ХОД» and the capture rings are barely visible in classic

When only captures are legal, _humanTurn (controller.js:559-576) keeps the normal «ВАШ ХОД» status. «Обязательный бой!» appears only AFTER a wrong tap (the piece shakes). In classic, the selectable rings on the pieces that must capture are a thin translucent outline that is hard to see on maple/walnut. A beginner who does not know the rule tries a normal move first and gets an 'error'. The rule is not shown before the mistake.

**Доказательства:** t22.mjs: Russian classic, pos 'w:.b.b.b.b/b.b.b.b./......../......../...b..../..w.w.../.w.w.w.w/w.w.w.w.', legal = only captures [[42,28],[44,26]], status = «ВАШ ХОД». Zoomed crop s/mandatory-classic.png: c3/e3 rings are faint outlines barely distinguishable from the other pieces.

**Как исправить:** controller._humanTurn: after computing this._mustCapture, call this.hud.setStatus(t('hud.captureNow'), { tone: 'alert' }) with a new i18n key «Ваш ход — бейте!» / 'Your move — capture!'. In render highlights.setSelectable, accept { capture: true } and draw the capture-ring colour (#FF4D4D, as used for capture targets) with a gentle pulse for forced capturers.

### MUX-10 [minor] (ui) Settings: the announcer is described as shouting «КОМБО!» and «НОКАУТ!», but it speaks English ('COMBO!', 'K.O.!')

settings.announcerDesc (i18n.js:124) promises Russian calls. Director._announce (director.js:333-343) always calls native.speak(text, { lang: 'en-US' }) with English lines: COMBO!, ULTIMATE!, AWAKENING!, K.O.!, FIGHT!, YOU WIN!, WHITE WINS!. The Russian user enables the voice expecting Russian and hears English TTS.

**Доказательства:** src/ui/i18n.js:124 'Кричит «КОМБО!» и «НОКАУТ!» в EPIC режиме'. src/fx/director.js:342 n.speak(text, { lang: 'en-US', pitch: 0.55, rate: 0.92 }); calls at lines 967, 1037, 1103, 1143, 1254, 1381, 1412, 1447. Screenshot s/set-0.png.

**Как исправить:** Either change i18n.js:124 to 'Кричит «COMBO!» и «K.O.!» — по-английски, как в файтингах', or add a Russian line table to Director (КОМБО!, УЛЬТА!, ПРОБУЖДЕНИЕ!, НОКАУТ!, В БОЙ!, ПОБЕДА!) and speak it with lang 'ru-RU' when settings.lang === 'ru'.

### MUX-11 [minor] (render) 10×10 and 12×12 boards: 26–30 px squares and no tap tolerance; a slightly missed tap does nothing

renderer.squareAt (renderer.js:392-405) maps a tap to the exact cell. On phones, International squares are 30 px (360 wide) and Canadian squares are 26 px (360) or 28 px (390), well below the ~48 dp touch-target guideline. A finger tap 0.6 of a square off the intended dark target lands on a neighbouring light square and is ignored or treated as illegal. On 12×12 this makes mis-taps frequent.

**Доказательства:** t19.mjs: Canadian pvp at 360x640: squareSize 26. Selecting a piece, then tapping 0.6 × square right of its legal target: move not played (ply stays 0). At 390x844: squareSize 28, same result. International at 360x640: squareSize 30 (t18.mjs, s/intl-360-epic.png). Screenshot s/canadian-360.png.

**Как исправить:** controller.js: use renderer.onTap(e) for input (it already provides x, y, sq). When e.sq is not a current candidate (_selectable when nothing is selected; next targets or finals when something is), choose the candidate whose screen centre (renderer.worldToScreen(renderer.squareCenter(c))) is nearest to (e.x, e.y) within 0.75 × squareSize × camera.zoom, and treat that as the tapped square. Also consider shrinking the board frame/coordinate margin on 12×12 to win a few px per square.

### MUX-12 [minor] (ui) EPIC toggle hint «КАЖДЫЙ ХОД — АНИМЕ-БИТВА!» is low-contrast cyan 12 px over orange flames

When EPIC is on, .et__hint becomes #29e6ff (screens.css:762) and sits over the bright animated fire background of the toggle card. Estimated contrast against the flame colours is about 1.3:1. It is hard to read on the setup screen and the menu, especially outdoors.

**Доказательства:** t13.mjs element screenshot at DPR 2: s/epic-toggle-1.png (cyan uppercase line over yellow-orange flames). Computed style: color rgb(41,230,255), font-size 12px, text-shadow none. Also visible in s/setup-390-1.png and s/demo-setup-2.png.

**Как исправить:** src/ui/screens.css:762 .epic-toggle.is-on .et__hint: add text-shadow: 0 1px 2px #000, 0 0 8px rgba(0,0,0,.9). Alternatively use #fff text with a cyan glow, or put the hint on a dark translucent pill (background: rgba(5,3,12,.55); padding: 2px 6px; border-radius: 4px).

### MUX-13 [minor] (ui) Russian typos and awkward wording in UI strings

- i18n.js:248 title.lightning.desc «Победите быстрее чем за 30 ходов»: missing comma, should be «быстрее, чем за 30 ходов». Shown on the game-over card and stats.
- i18n.js:128 settings.q.medium «Средне» is an adverb ('so-so') next to the nouns «Максимум/Минимум»; use «Среднее».
- settings.js:66 «1.5×»: Russian decimals use a comma, «1,5×».
- i18n.js:345 go.r.insufficient «Ни у кого нет сил на победу» is unidiomatic; use «Победить не сможет никто».
- i18n.js:158 rules.howToText «по тёмным клеткам» while every other text says «поля».

**Доказательства:** s/ruC2-over2.png (game-over card «Победите быстрее чем за 30 ходов»); s/set-1.png (Максимум / Средне / Минимум; 1× / 1.5× / 2×); s/rules-howto.png («по тёмным клеткам»).

**Как исправить:** Edit the strings in src/ui/i18n.js as listed. In src/ui/screens/settings.js:66 use label: getLang()==='ru' ? '1,5×' : '1.5×'.

### MUX-14 [minor] (ui) «Пропустить» chip overlaps the board's bottom-right squares on 360x640

The skip chip is absolutely positioned inside .board-area (hud.css:512-541: right 6px, bottom 6px, 44 px tall), and the board area coincides with the board. At 360x640 the chip (y 419–463) covers the bottom-right of the board (slot bottom at 445), i.e. squares g1/h1, plus the epic turn banner. Captures landing there are partly hidden during the very cinematic the chip appears in.

**Доказательства:** t24.mjs at 360x640 during an epic triple capture: chip rect [214,419,132,44], board slot [12,109,336,336]. Screenshot s/skipchip-360.png shows the chip on top of the board edge and the «ТВОЙ ХОД» banner.

**Как исправить:** hud.css .skip-chip: place it outside the board, e.g. in the status row (append to .status, right-aligned) or at top: calc(100% + 4px) of .board-area. On @media (max-height: 680px) make it icon-only (44×44, the label hidden) and anchor it to the top-right corner outside the frame.

### MUX-15 [polish] (ui) Game-over card details: «×1/×0 КОМБО», «1 ХОДОВ», «НОВЫЙ РЕКОРД» after a defeat, «Вы сдались — Не сдавайтесь…»

- The combo tile shows «×1» in classic, and the epic chip shows «Комбо ×0» on a defeat; a combo of 1 or 0 is not a combo.
- Stat tiles put the number above a fixed genitive-plural label, so it reads «1 ХОДОВ», «2 ХОДОВ».
- The very first game always produces «НОВЫЙ РЕКОРД! Взятий за партию N», even on a loss or a draw (storage.js:264-286 bumps records for any result, RECORD_MIN mostCaptures = 1). The brag feels cheap.
- After resigning, the classic card shows «Вы сдались» and then «Не сдавайтесь — следующая партия будет вашей.», an unintended pun.

**Доказательства:** - s/ruC-over2.png: defeat with «×1 КОМБО» and «НОВЫЙ РЕКОРД! Взятий за партию 5».
- s/trC-over2.png: draw with a new record.
- s/loss-card.png: epic «Комбо ×0».
- t21.mjs giveaway card text «1 | ХОДОВ».
- s/ctl-back-on-go.png: «Вы сдались / Не сдавайтесь…».
- Source: overlays.js:145-149 and :176, i18n.js:348 and :366.

**Как исправить:** - overlays.js:149: show '—' when s.combo < 2. Line 176: drop the combo chip when s.combo < 2.
- Tile labels in nominative: go.label.moves 'Ходы', go.label.lost 'Потери', go.label.kings 'Дамки'.
- overlays.js recordEls: hide records when outcome === 'loss', and in storage.record skip bump() when prev === 0 (first game).
- For reason 'resign' use a new key go.classic.lossResign «Отдохните — и возьмите реванш.».

### MUX-16 [polish] (ui) Tapping an own piece that has no moves gives no explanation

With no capture pending, tapping a blocked own piece (e.g. b2 at the start) only triggers playIllegal (a shake). The status stays «ВАШ ХОД», so beginners do not learn why. controller._handleSquare: 'else if (own || this._mustCapture) this._illegal(sq)'.

**Доказательства:** t8.mjs: Russian classic start, tap b2 (sq 49): status after tap = «ВАШ ХОД» (s/ctl-blocked.png).

**Как исправить:** controller._illegal(sq): if !this._mustCapture and the tapped square holds an own piece not in _selectable, call this.hud.setStatus(t('hud.pieceBlocked'), { tone: 'info' }) with i18n «Этой шашке некуда ходить» / 'This piece has no moves'.

### MUX-17 [polish] (ui) Stats screen empty state shows the same sentence twice

With no games, the hero card description (stats.js:52) and the red notice below it (stats.js:136) both render t('stats.empty') «Сыграйте первую партию с ИИ — и здесь появятся ваши подвиги.».

**Доказательства:** s/stats-empty.png: the sentence appears under «Новобранец» and again in the notice box.

**Как исправить:** stats.js:52: when no title is unlocked, use a different line, e.g. a new key stats.noTitle «Победите ИИ, чтобы получить первый титул». Or drop the note at stats.js:136.

### MUX-18 [polish] (ui) AI-vs-AI demo: both fighters have the same level and the same name («Самурай» vs «Самурай»)

Setup offers a single «Сила бойцов» level for both sides, so the HUD, the VS screen and the caption tags show identical names. Watching is less interesting, and it is unclear who is bragging (only the colour differs). A demo is the natural place for mismatches such as Ученик vs Бог шашек.

**Доказательства:** s/demo-1.png: top «Самурай · Чёрные · ИИ · уровень 3», bottom «Самурай · Белые · ИИ · уровень 3». Setup s/demo-setup-2.png shows one level picker.

**Как исправить:** setup.js (mode 'demo'): two level pickers («Белые» / «Чёрные») stored as cfg.levelWhite / cfg.levelBlack; the controller uses players[c].level. At minimum, give same-level AIs distinct names in controller._makePlayers, e.g. append the colour: «Самурай белых» / «Самурай чёрных».

### MUX-19 [polish] (director) AI ULTIMATE combos keep the player waiting up to 6 s

In the full Turkish epic game, the opponent's cinematics were the longest waits. An AI triple-capture ULTIMATE took 6083 ms of device time, an AI double capture with promotion 5167 ms, and AI ultimate single captures about 3.5 s. That exceeds the architecture budget for 3 hops (1.6 + 2×1.0 + 1.5 = 5.1 s), and it happens on the opponent's move, when the player is just waiting. Taps skip it, but the player must learn that.

**Доказательства:** scratchpad/review/mobile-ux/trE-timings.json (play2.mjs, Turkish epic, AI level 2): {caps:3, human:false, hype:1, dev:6083}, {caps:2, promo:true, human:false, dev:5167}, {caps:1, human:false, hype:1, dev:3533}.

**Как исправить:** director.js playMove: when !moverIsHuman, scale hop/finale/ultimate holds by about 0.7 (use this._t(ms * 0.7)) or skip the cut-in band for the AI's ULTIMATE. Keep the full show for the human's own moves (together with MUX-01).

### MUX-20 [polish] (controller) Threefold repetition ends the game with no warning

The Turkish classic game ended abruptly at ply 86 with «Троекратное повторение позиции». Nothing on screen warned that the position had already occurred twice. Players who shuffle pieces in an endgame are surprised by the sudden draw.

**Доказательства:** trC.log (play2.mjs Turkish classic 360x640): final over {winner:0, reason:'repetition'} at ply 86. Game-over card in s/trC-over2.png.

**Как исправить:** controller.js after each move (_playMove): count occurrences of the current position hash in game.hashes. When it reaches 2, call hud.toast(«Позиция повторилась — ещё раз, и ничья»). Same for the variant move-limit counters when they get within 5 moves of the limit.

### MUX-21 [polish] (ui) English variant cards mix 'Dark starts' / 'Dark moves first' with 'Black moves first'

The architecture says the player-facing name is Black. The English card meta line says 'Black moves first', while the tagline and badge on the same card say 'Dark moves first' and 'Dark starts' (English and Pool). The same card shows both terms.

**Доказательства:** t6.mjs English setup text: «English draughts (checkers) | 12 pieces each · Black moves first | Checkers: … Dark moves first. | Short kings | Forward capture | Dark starts» and Pool «… Dark starts.». Source: src/engine/variants.js:247, 251, 299.

**Как исправить:** variants.js:247 'Black moves first.', :251 'Black starts', :299 'Black starts.'.

## Ревьюер F1

Code-robustness review of the integrated EPIC ШАШКИ app. I read main.js, controller.js, the Director, the renderer (renderer, tween, camera), ui.js, hud.js, overlays.js, ai-client.js, native.js, all Android Java, the manifest and build-apk.sh. I also rebuilt dist/www and ran headless Playwright scripts. All scratch scripts, logs and screenshots are in /tmp/claude-0/-home-user-examples-image-loading/86371ced-f6f3-5277-95ce-5576743f43e5/scratchpad/review/code-robustness/.

Overall the async design is solid. Each game has a token, the Director runs on a generation counter, and cinematics have a watchdog. Undo, menu, restart, back, pause and hint races are handled correctly. Promises that are cancelled resolve instead of hanging. I found no listener, timer or texture leaks.

What I verified works:
- **Long session (leak2.mjs):** 10 consecutive AI-vs-AI games with fast=1, autoskip=1 and speed=2, alternating EPIC and classic, over 10 variants including 10x10 and 12x12.
  - Live GPU textures stay between 70 and 111, about 5–6 MPx.
  - window/document listeners stay at 24. DOM nodes return to 155 in the menu. Exactly one setInterval runs in menus (the audio scheduler).
  - FX sprite pool caps at about 235. The renderer's PieceView pool is bounded by the largest board (60 for Canadian).
  - JS heap with forced GC went from 29.8 MB to 35 MB, which looks like normal fluctuation rather than a leak.
  - Clock tasks drain to 0 after about 10 s idle in the menu (idle.mjs).
  - No board mismatches and no controller errors.
  - A note for other testers: in Pixi 8.22, `renderer.texture.managedTextures` keeps null entries for every texture ever uploaded. My first run counted those (127 → 537) and looked like a leak, but it isn't. Count `.filter(Boolean)` instead.
- **WebGL context loss and restore** (ctxloss.mjs): the game recovers fully, the nebula render texture included, and moves still play.
- **WebGL1-only GPU** (webgl1.mjs, with `getContext('webgl2')` forced to null): runs fine, filters and the triple-capture combo included.
- **Chrome 87 compatibility:** the built app.js has no `.at(`, structuredClone, Object.hasOwn, findLast, `??=` / `||=` or class static blocks. Intl.Segmenter is feature-checked. app.css has no :has, container queries, aspect-ratio, :is/:where or dvh, and keeps the -webkit- prefixes for background-clip:text and mask.
- **Offline:** no network access. The only fetch is Pixi's unused DOMAdapter; fonts and icon are local.
- **Storage:** localStorage failures fall back to an in-memory store.
- **Android Java:**
  - Bridge methods post UI work to the UI thread (exitApp, keepScreenOn) and TTS work to the main looper.
  - TTS is shut down in onDestroy. The WebView is destroyed properly.
  - Renderer-gone handling has a crash-loop guard. The back callback parses the JSON value correctly.
  - Every API above 24 is behind an SDK_INT check, and the manifest is valid for API 24–34.
- **Known Clock bug:** confirmed exactly (finding F4). It is latent because no production code calls Clock.slowMo or Clock.hitStop; the Director only uses FX's own time controller.

Findings, in brief:
- **Pause menu at game end (F1):** the game can finish while the pause menu and a confirm dialog are open. The confirm survives onto the game-over card and then appears over the main menu.
- **Render loop (F2):** one exception inside a tween, clock task or renderer tick stops the Pixi ticker for good.
- **Old WebView (F3):** if app.js fails to parse, the splash spins forever with no message.
- **Clock bug (F4):** the slowMo + hitStop overlap leaves the time scale stuck, as described above.
- **APK build (F5):** the APK is older than the latest Director sources and ships about 530 KB of unused files.
- **Polish:**
  - Back on the main menu closes the app immediately.
  - Keep-screen-on stays active while paused.
  - The game in progress is lost if Android kills the WebView or the app.
  - Notches are not handled.
  - The crack-texture cache goes past its intended limit of 8.

### F1 [minor] (controller) Game can end under the pause menu; a pending confirm dialog survives onto the game-over card and then appears over the main menu

The AI waits for the pause menu before moving (_aiTurn → _waitUnpaused), but _finish() (controller.js:1101) does not. If the human makes the final move and then opens the pause menu during that move's cinematic, three things happen. Opening the menu skips the cinematic. _advance() → _finish() then plays the whole victory cinematic behind the open pause menu. Finally UI.showGameOver closes the pause menu itself. UI.showGameOver (ui.js:481) closes only 'pause', 'sheet' and 'gameover' overlays, not 'confirm'. If the player had tapped «Сдаться», «В меню» or «Начать заново», that confirm dialog is left open. Its z-order puts it on top of the victory card, so the player sees «ПОБЕДА!» with «Сдаться? Партия будет засчитана как поражение.» over it. The card's «В меню» calls showScreen('menu'), whose _closeOverlays (ui.js:270) deliberately skips confirms. The same dialog then sits on the main menu. Confirming it emits resume plus resign or menu for a game that no longer exists. Any game-ending move works the same way: a capture of the last piece, a block, or a draw by repetition or move limit. It also happens in 2-player mode.

**Доказательства:** stale-confirm.mjs uses Russian pos `w:......../......../......../......../...b..../..w...../......../........` with ai, color 1 and epic. It calls __app.playPath([42,28]) and immediately ui.openPause(), then taps «Сдаться». Output: STALE {"afterResignTap":["pause","confirm"],"atGameOver":["confirm","gameover"],"inMenu":["confirm"],"screen":"menu","errors":[]}. Screenshots in the scratchpad: stale-confirm-1-gameover.png shows the resign dialog on top of the «ПОБЕДА!» card; stale-confirm-2-menu.png shows the same dialog over the main menu.

**Как исправить:** (1) controller.js _finish(): record the stats as soon as `result` is known, before playGameOver, so a later exit cannot lose them. Then add `await this._waitUnpaused(); if (token !== this.token) return;` before starting playGameOver. The ending then waits for the pause menu the way AI moves already do. (2) ui.js showGameOver(): use `this._closeOverlays()`, which closes everything and resolves pending confirms with false. Or add `|| o.kind === 'confirm'` to the filter on line 481. (3) ui.js showScreen(): when leaving the game screen, also close confirms opened from the pause menu. For example, tag them with `entry.scope = 'game'` in openPause's handlers and close `o.kind !== 'confirm' || o.scope === 'game'`.

### F2 [minor] (render) Render loop is not exception-safe: one throw in a tween callback, clock listener or Renderer._tick stops the Pixi ticker for good

Clock.update (tween.js:241-252) loops over task.step() with no try/finally. If any onUpdate or animate callback throws, the error escapes, `_iterating` stays true and task compaction (`tasks.length = w`) never runs. The error then propagates through Renderer._tick (renderer.js:684-697) into Pixi's Ticker._tick (node_modules/pixi.js/lib/ticker/Ticker.mjs:123-131). That function only calls requestAnimationFrame again after update() returns, so no next frame is ever requested. Every game-time promise then stalls: movePiece, Director waits, playMove. The controller sits in phase 'animating' and the screen freezes until the app is backgrounded and resumed. The Renderer's direct per-frame calls are also unguarded: backdrop.update, boardView.update, highlights.update and PieceView.update. FX only guards each effect's update call (fx.js:230-236); its particles.update, _updateAuras, filters.update and _applyTime are not guarded. I found no code path that currently throws, so this is hardening. But with this much effect code, one bad effect (for example a callback touching a destroyed object) turns into a full game freeze.

**Доказательства:** freeze.mjs / freeze2.mjs open a pvp EPIC game and add one task to renderer.clock whose step() throws once. Result: TICKER {... "after":{"iterating":true,"started":true,"rafId":null}, "moved":{"r":"still pending after 6 s","phase":"animating","ply":1}}. The ticker reports started, but no animation frame is requested (rafId null), Clock._iterating is stuck at true, and a playPath() move never finishes. Page error stack: Object.step ← nc.update (Clock.update) ← Md._tick (Renderer._tick) ← Ticker.update ← _tick.

**Как исправить:** tween.js Clock.update: wrap each step in `try { t.step(...) } catch (e) { console.error('[clock] task failed', e); t.cancel(false); }`, and set `_iterating = false` in a finally. Wrap each listener call `l.fn.call(...)` the same way. renderer.js _tick: wrap the body in try/catch and log at most once per second. fx.js _tick: wrap particles.update, _updateAuras, filters.update and _applyTime. As a backstop, controller._logError could restart the ticker with `renderer.resume()` when it sees that the clock frame has not advanced for more than 1 s while the app is visible.

### F3 [minor] (platform) No boot fallback for an old WebView: if app.js fails to parse, the splash animates forever with no message

bootError() (main.js:60-72) is the only code that shows «Не удалось запустить графику…», and it lives inside app.js. The bundle targets Chrome 87; it has 99 `?.` and 314 `??` occurrences, so engines older than Chrome 80 throw a SyntaxError. An Android 7 phone whose Android System WebView was never updated (no Play Store, updates disabled, some OEM ROMs) therefore gets an endlessly animating «EPIC ШАШКИ» splash and no explanation. The same happens if renderer.init() or waitFonts() never resolves. Neither web/index.html nor MainActivity checks the WebView version, even though the Java side already has an R.string.webview_missing message and showFatal() for the missing-WebView case.

**Доказательства:** freeze.mjs part 2 serves a syntactically broken app.js via page.route. After 8 s: BOOT {"boot":{"exists":true,"cls":"","msg":""},"pageErrors":["Unexpected identifier 'error'"]}. Screenshot boot-parse-failure.png shows the spinning splash and an empty message. web/index.html has a single <script src="app.js"> and no inline error handler. `grep -o -F '?.' dist/www/app.js | wc -l` returns 99.

**Как исправить:** (1) In web/index.html, add an inline classic script before app.js. It should set `window.onerror` and a `setTimeout(…, 15000)` that, unless main.js has set `window.__booted = true` (set it in hideSplash), adds `is-error` to #boot and writes a Russian/English message: «Обновите Android System WebView (Google Play) и перезапустите игру». (2) In MainActivity.createWebView, on API 26+, read `WebView.getCurrentWebViewPackage().versionName`; on API 24-25, read PackageManager info for com.google.android.webview or com.android.chrome. If the major version is below 87, call showFatal(getString(R.string.webview_outdated)) instead of loading the page.

### F4 [minor] (render) Known Clock bug confirmed: Clock.slowMo + Clock.hitStop overlap leaves the game-time scale stuck at the slow-mo value

Clock.hitStop (tween.js:174-181) captures `restore = this._scaleTo`. That is the slow-mo scale (0.3) while a slowMo is easing in or holding. When the freeze ends it calls setScale(restore), which bumps _scaleToken. When the slowMo's hold ends (tween.js:190-191), it sees `_scaleToken !== token` and returns without easing back to 1. The clock then runs at 0.3× forever: every tween, wait, camera focus and piece move is 3.3× slower until something else calls setScale. Also, a hitStop during the slowMo's ease-in jumps straight to the slow-mo scale and cuts the transition short. The opposite order (hitStop first, then slowMo) is fine. Production code is not affected today: no caller uses Clock.slowMo or Clock.hitStop (grep finds them only in tween.js). The Director only uses fx.slowMo and fx.hitStop, which have their own working composition controller (fx.js:494-551). But tween.js's header and the render report still advertise clock.hitStop and clock.slowMo as the API to use, so the next caller will hit this.

**Доказательства:** clock-bug.mjs drives `new Clock()` with update(10) steps in node:
- A: slowMo(0.3,600), then hitStop(100) at +200 ms → final scale 0.300
- B: hitStop during the ease-in (+50 ms) → 0.300
- E: a hitStop that outlives the slowMo → 0.300
- C: hitStop then slowMo → 1.000 (correct)
- D: slowMo alone → 1.000 (correct)

**Как исправить:** Move FX's composition model into Clock and make FX delegate to it. Keep the two parts separate on the Clock: slow-mo state (`_slow = {from, scale, t0, inMs, holdEnd, outMs}`) and a hit-stop deadline (`_hitUntil`). In update(), compute `scale = hitActive ? freezeScale : slowValue(realNow)`, the way fx.js _slowValue and _applyTime already do. Treat an explicit setScale() as an override that clears both. At minimum, give hitStop and slowMo their own tokens so a hit-stop restore does not cancel the slow-mo's ease back to 1.

### F5 [minor] (build) dist/EpicCheckers.apk is older than the latest Director sources and ships ~530 KB of unused assets (debug worker copy and a 407 KB favicon)

The APK was built at 18:11. src/fx/director.js, src/fx/director-ui.js and src/dev/director-game.* were modified after that, so the APK the client would install does not contain the current Director code. The packaged app.js is 1,440,588 B; a fresh build is 1,441,352 B. Separately, tools/build-web.mjs:101 always writes the 122 KB 'ai-worker.js' debug copy into dist/www, even though the worker is already embedded in app.js as __AI_WORKER_SRC__. build-apk.sh:100 then copies all of dist/www into the APK. web/static/icon-512.png (407 KB) is shipped only as a <link rel=icon> favicon, which a WebView never shows. Together that is about 16% of the 3.2 MB APK. A second risk: running build-web --dev followed by build-apk --skip-web would ship an inline-sourcemap bundle with __DEV__=true. That turns debug on (main.js:32) and exposes window.__app; the *.map cleanup in build-apk.sh:102 does not catch inline maps.

**Доказательства:** `find src android web tools -newer dist/EpicCheckers.apk -type f` lists src/fx/director-ui.js, src/fx/director.js and src/dev/director-game.{html,js}. `unzip -l dist/EpicCheckers.apk` shows assets/www/ai-worker.js at 122378 B, assets/www/icon-512.png at 407189 B and assets/www/app.js at 1440588 B; the fresh dist/www/app.js is 1441352 B.

**Как исправить:** Rebuild with `npm run build` after every module owner has handed off, and check the result with `unzip -p dist/EpicCheckers.apk assets/www/app.js | cmp - dist/www/app.js`. In build-web.mjs, write ai-worker.js only with --dev or --demo. In build-apk.sh, after staging, delete assets/www/ai-worker.js and icon-512.png, remove the <link rel=icon> line from the staged index.html, and fail if the staged app.js contains 'sourceMappingURL=data:'.

### F6 [polish] (ui) Android back on the main menu closes the app immediately (no confirmation or press-again-to-exit)

UI.back() returns false for the 'title' and 'menu' screens (ui.js:323). __androidBack() then returns false, and MainActivity.onBackPressed calls finish() (MainActivity.java:175-176). The typical path is setup → back → menu → one more accidental back, which kills the activity. The next launch goes through the boot splash, font loading and WebGL init again. Mobile games normally ask for a second press within 2 s.

**Доказательства:** back.mjs results: on ?screen=menu, __androidBack() returns false. On the title screen it returns false. From setup, the first back returns true and lands on 'menu'; the second returns false, which means MainActivity finishes.

**Как исправить:** In ui.js handleBack(), on the 'menu' screen: if a `_backArmedAt` timestamp is within the last 2000 ms, return false (exit). Otherwise set it, show `this.toast(t('common.pressBackAgain'))` («Нажмите «Назад» ещё раз для выхода» / «Press back again to exit»), and return true. Add the i18n key in both languages.

### F7 [polish] (controller) Keep-screen-on stays active while the game is paused (pause menu or idle human turn); controller.appPaused is written but never read

keepScreenOn(true) is set at game start (controller.js:463). It is released only in stopGame (520) and _finish (1124). Neither Controller.onPause (1052) nor main.js's native.onPause handler (188-203) releases it. If the player leaves the phone on the pause menu, or puts it down on their own turn, FLAG_KEEP_SCREEN_ON keeps the display on indefinitely. That drains the battery, and on OLED panels a static HUD risks burn-in. controller.appPaused is set in main.js:189/205 but nothing reads it.

**Доказательства:** Source check: `grep -n keepScreenOn src/controller.js src/main.js` shows only lines 463, 520 and 1124. `grep -rn appPaused src` shows only the assignments at controller.js:154 and main.js:189/205.

**Как исправить:** In Controller.onPause(), call `this.native.keepScreenOn(false)`. In onResume(), call `keepScreenOn(true)` if `this.active && this.phase !== 'over'`. Optionally, during phase 'human', start a 3-minute inactivity timer from the last tap that releases the flag, and re-acquire it in _onSquareTap or _onTap. Remove appPaused or use it to guard these calls.

### F8 [polish] (platform) A game in progress is lost whenever Android kills the WebView renderer or the app process in the background

When the renderer process is killed in the background, MainActivity.onRendererGone (283-316) recreates the WebView in onStart and loads START_URL, which shows the title screen. After process death the activity restarts from scratch. Nothing in controller.js or main.js saves the game: there is no Game.toJSON/fromJSON use and no 'continue' entry in the menu. Low-RAM Android 7 phones kill background WebView renderers often, for example during a phone call or a quick switch to another app. The player then loses a long game, such as a 12x12 Canadian game or a winning EPIC combo position.

**Доказательства:** `grep -rn 'toJSON\|fromJSON\|savedGame' src/controller.js src/main.js src/ui/*.js` finds nothing. ARCHITECTURE §1 provides Game.toJSON()/Game.fromJSON(). MainActivity.onRendererGone → createWebView() → wv.loadUrl(AssetWebViewClient.START_URL).

**Как исправить:** In Controller._playMove (after _applyStats) and in onPause, write `{ v: 1, cfg: this.baseCfg, humanColor: this.humanColor, game: g.toJSON(), stats: this.stats, statsHist: this._statsHist }` to localStorage key 'epic-checkers.current' inside try/catch. Remove the key in _finish and stopGame. In main.js boot, if the key exists and parses, show a «Продолжить партию» button on the menu (or a confirm). It should call a new controller.resumeGame(saved) that does what startGame does but uses Game.fromJSON(saved.game) and intro:false.

### F9 [polish] (platform) Display cutouts are not handled: no windowLayoutInDisplayCutoutMode, so on notched phones the immersive window is letterboxed and the CSS safe-area insets are never used

MainActivity.applyImmersive hides the status and navigation bars (lines 321-340), and index.html declares viewport-fit=cover. app.css has 4 env(safe-area-inset-*) rules. But neither android/res/values/styles.xml nor values-v31/styles.xml sets android:windowLayoutInDisplayCutoutMode, and there is no values-v28 folder. With the default mode and the status bar hidden, Android keeps the window out of the cutout area. Portrait notch and punch-hole phones get a black band at the top instead of the game background, and the HUD loses that height. This is the Android-documented default behaviour; I could not check it on a device because none is available.

**Доказательства:** android/res/values/styles.xml and values-v31/styles.xml have no windowLayoutInDisplayCutoutMode item; `ls android/res` shows no values-v28. `grep -o 'env(' dist/www/app.css | wc -l` returns 4.

**Как исправить:** Add android/res/values-v28/styles.xml containing the EpicTheme items plus `<item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>`, and add the same item to values-v31/styles.xml. Or set `getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES` behind `Build.VERSION.SDK_INT >= 28` in onCreate. Then check that the HUD's top panel respects env(safe-area-inset-top).

### F10 [polish] (fx) Crack decal texture cache goes past its intended bound of 8: eviction only tries the oldest key

FxTextures.crack (textures.js:897-909) is commented 'keep at most 8 crack variants alive'. After adding a new entry it looks only at keys[0], and evicts it only if `old.refs === 0`. If the oldest crack is still on screen (refs > 0), or once the map is already above 8, nothing is evicted and the cache keeps growing. Size is bounded only by the combinations of seed (6) × epic × colour × size bucket, and the bucket changes with board size and with the 2.0, 2.6 and 3.4 square crack sizes. Each entry holds two canvas textures at up to 2× resolution. In practice this is a memory increase of a few MB, not an unbounded leak.

**Доказательства:** leak2.log groups live GPU textures by label. After game 1 there are already "fx-crack": 14 and "fx-crack-glow": 14; after the 10x10 game, 15 and 15. That is nearly twice the documented maximum of 8.

**Как исправить:** After inserting, loop: `const keys = [...this._misc.keys()].filter(k => k.startsWith('crack|')); for (const k of keys) { if (keys.length <= 8) break; const r = this._misc.get(k); if (r && r !== rec && !r.refs) { r.base.destroy(true); r.glow && r.glow.destroy(true); r.destroyed = true; this._misc.delete(k); keys.length--; } }`. That evicts any unreferenced old entry, not just the first. Optionally quantise the size bucket more coarsely, for example to multiples of 32 px, to cut down the number of variants.
