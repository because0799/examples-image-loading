// Engine playground: play any variant (and giveaway) with tap-by-tap path entry, random moves,
// undo, position load/save. URL params: ?variant=turkish&giveaway=1&pos=<stateString>&auto=1
import * as E from '../engine/index.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const ui = {
  variant: $('variant'),
  giveaway: $('giveaway'),
  flip: $('flip'),
  board: $('board'),
  status: $('status'),
  moves: $('moves'),
  pos: $('pos'),
  info: $('info'),
  rules: $('rules'),
};

let game = null;
let prefix = []; // squares entered so far for the human move
let autoTimer = null;

for (const v of E.VARIANTS) {
  const o = document.createElement('option');
  o.value = v.id;
  o.textContent = `${v.flag} ${v.name.ru}`;
  ui.variant.appendChild(o);
}

function newGame(startString) {
  stopAuto();
  const variantId = ui.variant.value;
  const giveaway = ui.giveaway.checked;
  let start;
  let error = null;
  if (startString) {
    try {
      start = E.stateFromString(variantId, startString, { giveaway });
    } catch (e) {
      error = `Ошибка позиции: ${e.message}`;
    }
  }
  game = new E.Game(variantId, { giveaway }, start);
  prefix = [];
  render();
  if (error) ui.status.textContent = error;
}

function sideName(c) {
  return c === 1 ? 'Белые' : 'Чёрные';
}

function resultText(r) {
  const reasons = {
    'no-pieces': 'нет шашек',
    'no-moves': 'нет ходов',
    repetition: 'троекратное повторение',
    'move-limit': 'лимит ходов',
    resign: 'сдача',
    agreement: 'соглашение',
    insufficient: 'по одной шашке',
  };
  return r.winner === 0 ? `Ничья (${reasons[r.reason]})` : `Победа: ${sideName(r.winner)} (${reasons[r.reason]})`;
}

function render() {
  const v = game.variant;
  const n = v.size;
  const s = game.state;
  const flipped = ui.flip.checked;
  const moves = game.moves;
  const candidates = prefix.length ? E.movesWithPrefix(moves, prefix) : [];
  const targets = new Set();
  for (const c of candidates) if (c.path.length > prefix.length) targets.add(c.path[prefix.length]);
  const selectable = new Set(moves.map((m) => m.from));
  const last = game.lastMove;
  const lastSet = new Set(last ? last.path : []);
  const capturing = moves.length > 0 && moves[0].captures.length > 0;
  const pending = new Set();
  for (const c of candidates) {
    // pieces already jumped by the entered prefix
    const steps = prefix.length - 1;
    for (let i = 0; i < steps; i++) pending.add(c.move.captures[i]);
  }

  ui.board.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  ui.board.style.gridTemplateRows = `repeat(${n}, 1fr)`;
  ui.board.innerHTML = '';
  for (let vr = 0; vr < n; vr++) {
    for (let vc = 0; vc < n; vc++) {
      const r = flipped ? n - 1 - vr : vr;
      const c = flipped ? n - 1 - vc : vc;
      const sq = E.rcToSq(r, c, n);
      const cell = document.createElement('div');
      cell.className = 'cell';
      const playable = E.isPlayableSquare(v, r, c);
      if (playable && v.playable !== 'all') cell.classList.add('dark');
      if (v.playable === 'all' && (r + c) % 2 === 1) cell.classList.add('dark');
      if (lastSet.has(sq)) cell.classList.add('last');
      if (prefix.length && prefix[prefix.length - 1] === sq) cell.classList.add('sel');
      if (playable) {
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = E.squareName(v.id, sq);
        cell.appendChild(name);
      }
      // while a path is being entered the moving piece is shown on the last entered square
      let code = s.board[sq];
      if (prefix.length && sq === prefix[0]) code = 0;
      if (prefix.length && sq === prefix[prefix.length - 1]) code = s.board[prefix[0]];
      if (code !== 0) {
        const pc = document.createElement('div');
        pc.className = `pc ${code > 0 ? 'w' : 'b'}${Math.abs(code) === 2 ? ' k' : ''}${pending.has(sq) ? ' cap' : ''}`;
        cell.appendChild(pc);
      }
      if (targets.has(sq)) {
        if (capturing) cell.classList.add('capt');
        const dot = document.createElement('div');
        dot.className = 'dot';
        cell.appendChild(dot);
      } else if (!prefix.length && selectable.has(sq)) {
        cell.style.cursor = 'pointer';
      }
      cell.addEventListener('click', () => onTap(sq));
      ui.board.appendChild(cell);
    }
  }

  const r = game.result;
  ui.status.textContent = r
    ? resultText(r)
    : `Ход: ${sideName(s.turn)} · ходов: ${moves.length}${capturing ? ' · бить обязательно!' : ''}`;
  ui.moves.textContent = game.history
    .map((h, i) => `${i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}${E.moveToString(v.id, h.move)}${h.move.promotion ? '♛' : ''}`)
    .join('  ');
  ui.pos.value = E.stateToString(s);
  const m = E.materialCount(s);
  ui.info.textContent = `ply ${s.ply} · без прогресса ${s.counters.quiet} · белые ${m.wm}+${m.wk}♛ · чёрные ${m.bm}+${m.bk}♛ · ${v.short.ru}`;
  ui.rules.innerHTML = '';
  for (const p of v.rules.ru) {
    const el = document.createElement('p');
    el.textContent = p;
    ui.rules.appendChild(el);
  }
}

function onTap(sq) {
  if (game.result) return;
  const moves = game.moves;
  if (!prefix.length) {
    if (moves.some((m) => m.from === sq)) prefix = [sq];
    render();
    return;
  }
  const next = [...prefix, sq];
  const cands = E.movesWithPrefix(moves, next);
  if (!cands.length) {
    // re-select another piece or cancel
    prefix = moves.some((m) => m.from === sq) && sq !== prefix[0] ? [sq] : [];
    render();
    return;
  }
  // play as soon as the entered path is a complete move and no longer move shares the prefix
  const complete = cands.find((c) => c.path.length === next.length);
  if (complete && cands.every((c) => c.path.length === next.length)) {
    game.play(complete.path);
    prefix = [];
  } else {
    prefix = next;
  }
  render();
}

function randomMove() {
  if (game.result) return false;
  const ms = game.moves;
  game.play(ms[Math.floor(Math.random() * ms.length)]);
  prefix = [];
  render();
  return true;
}

function stopAuto() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
  $('auto').textContent = 'Авто ▶';
}

$('reset').onclick = () => newGame();
$('undo').onclick = () => {
  stopAuto();
  game.undo();
  prefix = [];
  render();
};
$('random').onclick = () => randomMove();
$('auto').onclick = () => {
  if (autoTimer) return stopAuto();
  $('auto').textContent = 'Стоп ■';
  autoTimer = setInterval(() => {
    if (!randomMove()) stopAuto();
  }, 120);
};
$('load').onclick = () => newGame(ui.pos.value);
ui.variant.onchange = () => newGame();
ui.giveaway.onchange = () => newGame();
ui.flip.onchange = () => render();

ui.variant.value = E.VARIANTS.some((v) => v.id === params.get('variant')) ? params.get('variant') : 'russian';
ui.giveaway.checked = params.get('giveaway') === '1';
newGame(params.get('pos') || undefined);
if (params.get('auto') === '1') $('auto').click();
window.__engineDemo = { E, get game() { return game; }, newGame, randomMove };
