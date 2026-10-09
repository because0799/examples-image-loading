// Overlay builders: pause menu, game over card (classic / epic bragging), confirm dialog.
// The UI class owns the overlay stack; these functions only build DOM + wire buttons.

import { h, rng } from './dom.js';
import { t, loc, pick } from './i18n.js';
import { icon } from './icons.js';
import { flagEl } from './flags.js';
import { button } from './components.js';
import { titleBadge } from './screens/stats.js';

// ------------------------------------------------------------------ pause

export function buildPause(ui, { onResume, onRules, onSettings, onDraw, onRestart, onResign, onMenu }) {
  const st = ui.hud.state;
  const mode = st.mode;
  const v = st.variant;
  const modeLabel = mode === 'pvp' ? t('pause.pvp') : mode === 'demo' ? t('pause.demo') : t('pause.vsAi');
  const info = [modeLabel];
  if (mode !== 'pvp') info.push(t((st.epic ? 'levelEpic.' : 'level.') + st.level));
  if (st.giveaway) info.push(t('hud.giveaway'));

  const small = (opts) => button({ size: 'md', kind: 'secondary', ...opts });
  const grid = [
    small({ label: t('pause.rules'), icon: 'rules', onClick: onRules, cls: 'span2' }),
    small({ label: t('pause.settings'), icon: 'settings', onClick: onSettings }),
    mode === 'pvp' ? small({ label: t('pause.offerDraw'), icon: 'handshake', onClick: onDraw }) : null,
    small({ label: t('pause.restart'), icon: 'restart', onClick: onRestart }),
    mode !== 'demo' ? small({ label: t('pause.resign'), icon: 'flag', kind: 'danger', onClick: onResign }) : null,
    small({ label: t('pause.toMenu'), icon: 'home', kind: 'ghost', onClick: onMenu }),
  ].filter(Boolean);

  return h(
    'div.pause',
    h('span.pause__kanji', { 'aria-hidden': 'true' }, '止'),
    h('h2.pause__title', { 'data-fit': '20' }, t('pause.title')),
    v
      ? h(
          'div.pause__info',
          flagEl(v.flag, 'pause__flag'),
          h('span.pause__variant', loc(v.name)),
          h('span.pause__meta', info.join(' · ')),
        )
      : null,
    button({ label: t('pause.resume'), icon: 'play', kind: 'primary', size: 'lg', cls: 'pause__resume', onClick: onResume }),
    h('div.pause__grid', { class: (grid.length - 1) % 2 ? 'is-odd' : '' }, grid),
  );
}

// ------------------------------------------------------------------ game over

function outcomeOf(result, humanColor, mode) {
  const winner = result && result.winner ? result.winner : 0;
  if (!winner) return { outcome: 'draw', winner: 0 };
  if (mode === 'ai' && (humanColor === 1 || humanColor === -1)) return { outcome: winner === humanColor ? 'win' : 'loss', winner };
  return { outcome: 'side', winner };
}

const sideName = (c) => (c > 0 ? t('common.white') : t('common.black'));

export function reasonText(result, outcome, giveaway) {
  const reason = result && result.reason;
  const winner = result && result.winner;
  const persp = outcome === 'win' ? 'win' : outcome === 'loss' ? 'loss' : 'side';
  const params = winner ? { winner: sideName(winner), loser: sideName(-winner) } : {};
  if (reason === 'no-pieces' || reason === 'no-moves') {
    if (!winner) return t(`go.r.${reason}.side`, params);
    return t(`${giveaway ? 'go.r.ga.' : 'go.r.'}${reason}.${persp}`, params);
  }
  if (reason === 'resign') return winner ? t(`go.r.resign.${persp}`, params) : '';
  if (reason) {
    const key = `go.r.${reason}`;
    const s = t(key, params);
    return s === key ? '' : s;
  }
  return '';
}

const num = (obj, c) => {
  if (!obj) return 0;
  const v = obj[c] ?? obj[String(c)];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

/**
 * opts: { result, humanColor, mode, stats, records, epic, players, giveaway?, durationSec? }
 * choose(choice) is called with 'rematch' | 'menu'.
 */
export function buildGameOver(ui, opts, choose) {
  const { result, humanColor, mode = 'ai', stats, records, epic, giveaway } = opts;
  const { outcome, winner } = outcomeOf(result, humanColor, mode);
  const me = outcome === 'win' || outcome === 'loss' ? humanColor : winner || 1;
  const s = {
    combo: num(stats && stats.maxCombo, me),
    lost: num(stats && stats.captures, -me),
    kings: num(stats && stats.kingsMade, me),
    captures: num(stats && stats.captures, me),
    moves: (stats && (stats.moveNumber || stats.moves)) || 0,
  };
  const flawless = (outcome === 'win' || outcome === 'side') && s.lost === 0 && s.captures > 0;
  const tone = outcome === 'side' ? (winner > 0 ? 'white' : 'black') : outcome;

  let headline;
  if (outcome === 'side') headline = t(`go.${winner > 0 ? 'white' : 'black'}Wins${epic ? 'Epic' : ''}`);
  else headline = t(`go.${outcome}${epic ? 'Epic' : ''}`);
  const reason = reasonText(result, outcome, giveaway);

  const newRecords = (records && records.newRecords) || [];
  const newTitles = (records && records.newTitles) || [];

  const recordEls = newRecords.slice(0, 3).map((r) =>
    h(
      'div.go-rec',
      h('span.go-rec__tag', t('go.newRecord')),
      h('span.go-rec__name', t(`record.${r.id}`)),
      h('span.go-rec__val', t(`record.value.${r.id}`, { n: r.value })),
    ),
  );
  const titleEls = newTitles.slice(0, 3).map((x) =>
    h('div.go-title', h('span.go-title__tag', t('go.newTitle')), titleBadge({ ...x, unlocked: true, progress: null }, { big: true })),
  );

  const btns = h(
    'div.go__btns',
    button({ label: t('go.rematch'), icon: 'restart', kind: 'primary', size: 'lg', onClick: () => choose('rematch') }),
    button({ label: t('go.menu'), icon: 'home', kind: 'ghost', size: 'lg', onClick: () => choose('menu') }),
  );
  btns.querySelectorAll('.btn__label').forEach((l) => (l.dataset.fit = '12'));

  if (!epic) {
    const cell = (k, v) => h('div.go-cell', h('span.go-cell__v', String(v)), h('span.go-cell__k', k));
    const sub = outcome === 'side' ? '' : t(`go.classic.${outcome}`);
    return h(
      'div.go.go--classic',
      { class: `go--${tone}` },
      h(
        'div.go__card.go__cols',
        h(
          'div.go__col.go__col--main',
          h('div.go__ornament', { 'aria-hidden': 'true' }, h('span.go__orn-line'), icon(outcome === 'loss' ? 'flag' : outcome === 'draw' ? 'handshake' : 'crown', 'go__orn-ico'), h('span.go__orn-line')),
          h('h2.go__headline', { 'data-fit': '22' }, headline),
          reason ? h('div.go__reason', reason) : null,
          sub ? h('div.go__sub', sub) : null,
          h(
            'div.go__table',
            cell(t('go.label.moves'), s.moves),
            cell(t('go.label.captured'), s.captures),
            cell(t('go.label.lost'), s.lost),
            cell(t('go.label.kings'), s.kings),
            cell(t('go.label.combo'), s.combo ? `×${s.combo}` : '—'),
          ),
        ),
        h(
          'div.go__col.go__col--side',
          recordEls.length ? h('div.go__records', recordEls) : null,
          titleEls.length ? h('div.go__titles', titleEls) : null,
          btns,
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- epic
  const kanji = outcome === 'loss' ? '敗北' : outcome === 'draw' ? '引分' : '勝利';
  const seed = Math.floor(Math.random() * 1000);
  const brag =
    outcome === 'draw'
      ? pick('go.brag.draw', seed)
      : outcome === 'loss'
        ? pick('go.brag.loss', seed)
        : outcome === 'side'
          ? pick('go.brag.side', seed)
          : flawless
            ? pick('go.brag.flawless', seed)
            : pick('go.brag.win', seed);

  const statBits = [t('go.stat.combo', { n: s.combo || 0 }), t('go.stat.lost', { n: s.lost }), t('go.stat.kings', { n: s.kings })];
  if (s.captures) statBits.splice(1, 0, t('go.stat.captures', { n: s.captures }));

  const particles = h('div.go__particles', { 'aria-hidden': 'true' });
  const r = rng(seed + 3);
  const nParticles = ui.settings.quality === 'low' ? 0 : ui.settings.quality === 'medium' ? 22 : 44;
  for (let i = 0; i < (outcome === 'draw' ? Math.round(nParticles / 2) : nParticles); i++) {
    particles.appendChild(
      h('i', {
        class: outcome === 'loss' ? 'rain' : i % 3 === 0 ? 'petal' : 'conf',
        style: {
          '--x': (r() * 100).toFixed(1) + '%',
          '--d': (outcome === 'loss' ? 0.6 + r() * 0.5 : 2.6 + r() * 2.4).toFixed(2) + 's',
          '--delay': (outcome === 'loss' ? -r() * 1.2 : 0.3 + r() * 2.2).toFixed(2) + 's',
          '--rot': Math.round(r() * 720 - 360) + 'deg',
          '--dx': Math.round((r() - 0.5) * 120) + 'px',
          '--hue': Math.round(r() * 360),
        },
      }),
    );
  }

  let delayIdx = 0;
  const stagger = (node, base) => {
    node.style.setProperty('--in', (base + delayIdx++ * 0.12).toFixed(2) + 's');
    return node;
  };

  return h(
    'div.go.go--epic',
    { class: `go--${tone} ${flawless ? 'is-flawless' : ''}` },
    h('div.go__rays', { 'aria-hidden': 'true' }),
    h('div.go__speed', { 'aria-hidden': 'true' }),
    h('div.go__kanji', { 'aria-hidden': 'true' }, kanji),
    particles,
    h(
      'div.go__content.go__cols',
      h(
        'div.go__col.go__col--main',
        h('div.go__head', h('h2.go__headline', { 'data-fit': '26', 'data-text': headline }, headline)),
        reason ? h('div.go__reason', reason) : null,
        h('div.go__brag', `«${brag}»`),
        flawless ? h('div.go__stamp', h('span', t('go.flawless')), h('small', 'PERFECT')) : null,
      ),
      h(
        'div.go__col.go__col--side',
        h(
          'div.go__stats',
          statBits.map((txt) => stagger(h('span.go-stat', txt), 0.75)),
        ),
        recordEls.length ? h('div.go__records', recordEls.map((n) => stagger(n, 0.95))) : null,
        titleEls.length ? h('div.go__titles', titleEls.map((n) => stagger(n, 1.1))) : null,
        stagger(btns, 1.25),
      ),
    ),
  );
}

// ------------------------------------------------------------------ confirm

export function buildConfirm(text, { ok, cancel, danger = false, title } = {}, done) {
  return h(
    'div.dlg',
    { role: 'alertdialog' },
    h('span.dlg__kanji', { 'aria-hidden': 'true' }, danger ? '警' : '問'),
    title ? h('div.dlg__title', title) : null,
    h('div.dlg__text', text),
    h(
      'div.dlg__btns',
      button({ label: cancel || t('common.cancel'), kind: 'ghost', size: 'md', onClick: () => done(false) }),
      button({ label: ok || t('common.yes'), kind: danger ? 'danger' : 'primary', size: 'md', onClick: () => done(true) }),
    ),
  );
}
