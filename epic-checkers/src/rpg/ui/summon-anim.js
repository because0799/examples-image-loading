// «Валькирии доски» — summon animation (GDD §12): a crystal checker races along the a1–h8
// diagonal of a starlit board, the trail takes the colour of the best rarity in the batch, the
// crystal shatters into shards at the far edge (Epic: lightning double flash + 煌; Legendary: a
// suspense stop halfway, a pillar of light + 伝説; Mythic: gold turns rainbow, the board flips into
// the night sky, two crowns collide + 神話). Then every hero is revealed one by one (splash, name
// RU/JP, title, stars, NEW / +1 Constellation / +dust, the summon voice line for Epic+), and the
// batch ends on a results grid whose cards flip in turn, the best last.
//
//   const run = playSummonAnimation(ui, results);  run.done -> Promise<'done' | 'again1' | 'again10'>
//   run.skipAll()   run.back()   (tap = next step; «Пропустить» jumps to the grid)
// Uses the Web Animations API (Chrome 87+) so every step can be finished instantly on skip.

import { h, heroSplash, heroCard, rarityStars, elementBadge, roleBadge, rvButton, starfield, assetUrl } from './components.js';
import { rvIcon } from './icons.js';
import { rt, L, fmt } from './i18n.js';
import { getHero, heroLevel, revealOrder, bestRarity, refundDust, RARITY_RANK, KANJI, isVoiced, voiceLines, crystalsOf, canSummonCount } from './model.js';

const COLORS = {
  rare: { a: '#4fa3ff', b: '#bfe0ff' },
  epic: { a: '#b65cff', b: '#f0d8ff' },
  legendary: { a: '#ffb830', b: '#fff1c2' },
  mythic: { a: '#ff4fd8', b: '#6af0ff' },
};
const HIT_SOUND = { rare: 'sparkle', epic: 'thunder', legendary: 'gong', mythic: 'boom' };

export function playSummonAnimation(ui, rawResults) {
  const results = revealOrder(rawResults);
  const best = bestRarity(results);
  const anims = new Set();
  const timers = new Set();
  let phase = 'pull'; // pull -> reveal -> grid -> closed
  let skipPhase = null; // resolves the current waits early
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const reduced = ui.effectiveQuality === 'low' || ui.settings.battery;

  // warm the image cache while the crystal runs, so every reveal opens on finished art
  const preload = [];
  for (const r of results) {
    for (const kind of ['splash', 'card']) {
      const url = assetUrl(ui, kind, r.heroId);
      if (!url || typeof Image !== 'function') continue;
      const im = new Image();
      im.decoding = 'async';
      im.src = url;
      preload.push(im);
    }
  }

  // ---------------------------------------------------------------- DOM
  const stage = h('div.rv-sum__stage');
  const skipBtn = h('button.rv-sum__skip', { type: 'button', on: { click: (e) => (e.stopPropagation(), ui.sound('click'), skipToGrid()) } }, h('span', rt('common.skip')), rvIcon('speed'));
  const root = h(
    'div.rv-sum',
    { class: `rv-sum--${best}`, style: { '--ra': COLORS[best].a, '--rb': COLORS[best].b } },
    h('div.rv-sum__sky', starfield(77, 70)),
    stage,
    skipBtn,
  );
  let tapGuardUntil = 0; // a reveal stays at least this long (no accidental double-tap skips)
  root.addEventListener('click', () => {
    if (Date.now() < tapGuardUntil) return;
    ui.haptic(6);
    if (skipPhase) skipPhase();
  });
  ui._overlaysEl.appendChild(root);
  requestAnimationFrame(() => root.classList.add('is-open'));

  // ---------------------------------------------------------------- timing helpers
  const animate = (el, frames, opts) => {
    if (!el || typeof el.animate !== 'function') return { finished: Promise.resolve(), finish() {}, cancel() {} };
    const a = el.animate(frames, { fill: 'forwards', easing: 'ease-out', ...opts });
    anims.add(a);
    a.finished.then(
      () => anims.delete(a),
      () => anims.delete(a),
    );
    return a;
  };
  const wait = (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, ms);
      timers.add(t);
    });
  const finishAll = () => {
    for (const a of [...anims]) {
      try {
        a.finish();
      } catch (e) {
        /* infinite or cancelled */
      }
    }
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
  /** Runs `fn` (async) as a skippable phase: a tap / skip finishes every animation and resolves. */
  const skippable = (fn) =>
    new Promise((resolve) => {
      let over = false;
      const finish = () => {
        if (over) return;
        over = true;
        skipPhase = null;
        finishAll();
        resolve();
      };
      skipPhase = finish;
      Promise.resolve()
        .then(fn)
        .then(finish, (e) => {
          console.error('[rpg-ui] summon animation step failed', e);
          finish();
        });
    });

  // ---------------------------------------------------------------- phase 1: the pull
  async function pull() {
    const board = h('div.rv-sum__board');
    const cells = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = h('i', { class: (r + c) % 2 ? 'is-dark' : '' });
        cells.push(cell);
        board.appendChild(cell);
      }
    }
    const boardWrap = h('div.rv-sum__boardwrap', board, h('div.rv-sum__boardback', starfield(41, 40)));
    const orb = h('div.rv-sum__orb', h('i.rv-sum__core'), h('i.rv-sum__facet'));
    const flash = h('div.rv-sum__flash');
    const kanji = h('div.rv-sum__kanji', KANJI[best]);
    const caption = h('div.rv-sum__caption', rt('summon.charging'));
    stage.append(boardWrap, orb, flash, kanji, caption);
    ui.sound('charge', { intensity: 0.8 });

    animate(boardWrap, [{ opacity: 0, transform: 'translateY(40px) scale(0.9)' }, { opacity: 1, transform: 'none' }], { duration: 420 });
    animate(caption, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 2000 });
    await wait(440);

    // diagonal a1 (row 7, col 0) -> h8 (row 0, col 7) in screen space (the board is tilted in 3D)
    const sRect = stage.getBoundingClientRect();
    const pts = [];
    for (let k = 0; k < 8; k++) {
      const r = cells[(7 - k) * 8 + k].getBoundingClientRect();
      pts.push({ x: r.left + r.width / 2 - sRect.left, y: r.top + r.height / 2 - sRect.top, s: r.width });
    }
    const s0 = pts[0].s || 40;
    orb.style.setProperty('--sz', Math.round(s0 * 0.9) + 'px');
    const at = (p, extra = '') => `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${(p.s / s0).toFixed(3)})${extra}`;
    animate(orb, [{ opacity: 0, transform: at(pts[0], ' scale(0.3)') }, { opacity: 1, transform: at(pts[0]) }], { duration: 260, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    await wait(300);
    ui.sound('whoosh', { intensity: 0.7 });

    const iris = (k) => `hsl(${(k * 47 + 300) % 360} 100% 66%)`;
    const light = (k, color) => {
      const cell = cells[(7 - k) * 8 + k];
      cell.style.setProperty('--tc', root.classList.contains('is-iris') ? iris(k) : color);
      cell.classList.add('is-trail');
    };
    const stepMs = best === 'rare' ? 120 : 135;
    const pauseAt = best === 'legendary' || best === 'mythic' ? 4 : -1;
    const trail = best === 'mythic' ? COLORS.legendary.a : COLORS[best].a;
    for (let k = 1; k < 8; k++) {
      animate(orb, [{ transform: at(pts[k - 1]) }, { transform: at(pts[k]) }], { duration: stepMs, easing: 'linear' });
      light(k - 1, trail);
      await wait(stepMs);
      if (k === pauseAt) {
        // suspense: the crystal stops halfway…
        ui.sound('heartbeat', { intensity: 0.8 });
        ui.haptic(30);
        animate(orb, [{ transform: at(pts[k]) }, { transform: at(pts[k], ' scale(1.25)') }, { transform: at(pts[k]) }], { duration: 400 });
        await wait(420);
        if (best === 'mythic') {
          // …and the gold trail turns rainbow-crimson
          root.classList.add('is-iris');
          for (let j = 0; j < k; j++) cells[(7 - j) * 8 + j].style.setProperty('--tc', iris(j));
          ui.sound('glitch', { intensity: 0.8 });
        }
      }
    }
    light(7, trail);

    // coronation at the far edge
    ui.sound('riser', { intensity: 0.8 });
    animate(orb, [{ transform: at(pts[7]) }, { transform: at(pts[7], ' translateY(-30%) scale(1.6)') }], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (best === 'legendary') stage.appendChild(pillar());
    if (best === 'mythic') {
      animate(boardWrap, [{ transform: 'none' }, { transform: 'rotateX(180deg) scale(0.92)' }], { duration: 700, easing: 'cubic-bezier(.5,0,.3,1)' });
      root.classList.add('is-flipped');
      stage.appendChild(crowns());
    }
    await wait(best === 'mythic' ? 760 : 380);

    // shatter
    const p = pts[7];
    shards(p, best);
    ui.sound('shatter', { intensity: 1 });
    ui.sound(HIT_SOUND[best], { intensity: best === 'rare' ? 0.6 : 1 });
    ui.haptic(best === 'mythic' ? [60, 40, 120, 40, 220] : best === 'legendary' ? [40, 30, 90] : [24, 20, 40]);
    animate(orb, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 });
    if (!reduced && ui.settings.fx?.flashes !== false) {
      const flashFrames =
        best === 'epic'
          ? [{ opacity: 0 }, { opacity: 0.95, offset: 0.12 }, { opacity: 0.1, offset: 0.3 }, { opacity: 0.85, offset: 0.45 }, { opacity: 0 }]
          : [{ opacity: 0 }, { opacity: 0.95, offset: 0.15 }, { opacity: 0 }];
      animate(flash, flashFrames, { duration: best === 'epic' ? 700 : 520 });
    }
    if (best === 'epic') stage.appendChild(bolts());
    animate(kanji, [{ opacity: 0, transform: 'translate(-50%, -50%) scale(2.4)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.25 }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1.05)', offset: 0.8 }, { opacity: 0, transform: 'translate(-50%, -50%) scale(1.15)' }], {
      duration: best === 'mythic' ? 1400 : 1100,
    });
    await wait(best === 'mythic' ? 1300 : best === 'rare' ? 700 : 1000);
  }

  function shards(p, rarity) {
    const box = h('div.rv-sum__shards', { style: { left: p.x + 'px', top: p.y + 'px' } });
    const n = reduced ? 8 : rarity === 'rare' ? 12 : 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 3) * 0.2;
      const d = 90 + ((i * 37) % 70) * (rarity === 'mythic' ? 2.2 : 1.4);
      const sh = h('i', { style: { '--rot': `${(i * 53) % 360}deg`, background: rarity === 'mythic' ? `hsl(${(i * 31) % 360} 100% 70%)` : i % 2 ? COLORS[rarity].a : COLORS[rarity].b } });
      box.appendChild(sh);
      animate(sh, [{ transform: `rotate(${(i * 53) % 360}deg) scale(0.4)`, opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) rotate(${(i * 53 + 220) % 360}deg) scale(1)`, opacity: 0 }], {
        duration: 900 + (i % 4) * 120,
        easing: 'cubic-bezier(.1,.7,.2,1)',
      });
    }
    const ring = h('i.rv-sum__ring');
    box.appendChild(ring);
    animate(ring, [{ transform: 'translate(-50%,-50%) scale(0.2)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(5)', opacity: 0 }], { duration: 700 });
    stage.appendChild(box);
  }

  function pillar() {
    const el = h('div.rv-sum__pillar');
    animate(el, [{ opacity: 0, transform: 'translateX(-50%) scaleX(0.1)' }, { opacity: 1, transform: 'translateX(-50%) scaleX(1)', offset: 0.3 }, { opacity: 0, transform: 'translateX(-50%) scaleX(1.4)' }], { duration: 1500 });
    return el;
  }

  function bolts() {
    const el = h('div.rv-sum__bolts', {
      html: '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M48 0 L40 30 L52 34 L38 70 L50 72 L44 100"/><path d="M80 0 L70 22 L78 26 L64 54"/><path d="M18 8 L28 30 L20 34 L32 60"/></svg>',
    });
    animate(el, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 0.2, offset: 0.3 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration: 700 });
    return el;
  }

  function crowns() {
    const box = h('div.rv-sum__crowns');
    const a = h('span.rv-sum__crown.is-a', rvIcon('crown'));
    const b = h('span.rv-sum__crown.is-b', rvIcon('crown'));
    // the coming heroine as a dark silhouette in the starry sky (her own art, crushed to shadow)
    const top = results[results.length - 1];
    const sil = h('div.rv-sum__silhouette', top ? heroSplash(ui, top.heroId, { cls: 'rv-sum__shadow' }) : null);
    box.append(sil, a, b);
    animate(a, [{ transform: 'translate(-180px, -40px) rotate(-30deg)', opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: 'translate(-14px, 0) rotate(0deg)', opacity: 1 }], { duration: 760, easing: 'cubic-bezier(.6,0,.4,1)' });
    animate(b, [{ transform: 'translate(180px, -40px) rotate(30deg)', opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: 'translate(14px, 0) rotate(0deg)', opacity: 1 }], { duration: 760, easing: 'cubic-bezier(.6,0,.4,1)' });
    animate(sil, [{ opacity: 0, transform: 'translateX(-50%) scale(0.9)' }, { opacity: 0.9, transform: 'translateX(-50%) scale(1)' }], { duration: 900, delay: 300 });
    return box;
  }

  // ---------------------------------------------------------------- phase 2: reveals
  function resultTag(r, hero) {
    if (r.isNew) return h('span.rv-rev__new', hero.gender === 'm' ? rt('summon.newHeroM') : rt('summon.newHero'));
    const dust = refundDust(r);
    if (dust) return h('span.rv-rev__dup', rvIcon('dust'), rt('summon.dupDust', { n: fmt(dust) }));
    if (r.constellation) return h('span.rv-rev__dup', rvIcon('star'), rt('summon.dupConst', { c: r.constellation }));
    return null;
  }

  async function reveal(r, i, n) {
    const hero = getHero(r.heroId);
    if (!hero) return;
    const col = COLORS[r.rarity] || COLORS.rare;
    const line = voiceLines(r.heroId).find((v) => v.event === 'summon');
    stage.textContent = '';
    const quick = !r.isNew && r.rarity === 'rare' && n > 1;
    tapGuardUntil = Date.now() + (quick ? 250 : 450);
    const el = h(
      'div.rv-rev',
      { class: `rv-rev--${r.rarity} ${quick ? 'is-quick' : ''}`, style: { '--ra': col.a, '--rb': col.b } },
      h('div.rv-rev__rays'),
      h('div.rv-rev__art', heroSplash(ui, r.heroId, { cls: 'rv-rev__splash' })),
      h('div.rv-rev__shade'),
      h('div.rv-rev__jp', { 'aria-hidden': 'true' }, hero.name.jp),
      h(
        'div.rv-rev__info',
        h('div.rv-rev__rar', rarityStars(r.rarity), h('span', rt(`rarity.${r.rarity}`))),
        h('div.rv-rev__name', { 'data-fit': '22' }, L(hero.name)),
        h('div.rv-rev__title', L(hero.title)),
        h('div.rv-rev__badges', elementBadge(hero.element, { label: true }), roleBadge(hero.role, { label: true }), resultTag(r, hero)),
        line && isVoiced(r.heroId) ? h('div.rv-rev__line', h('span.rv-rev__linejp', line.jp), h('span.rv-rev__linesub', ui.lang === 'en' ? line.en : line.ru)) : null,
      ),
      h('div.rv-rev__count', `${i + 1}/${n}`),
      h('div.rv-rev__tap', rt('common.tapToContinue')),
    );
    stage.appendChild(el);
    ui.refit(el);
    ui.sound(RARITY_RANK[r.rarity] >= RARITY_RANK.legendary ? 'gong' : RARITY_RANK[r.rarity] >= RARITY_RANK.epic ? 'power' : 'sparkle', { intensity: 0.7 });
    if (RARITY_RANK[r.rarity] >= RARITY_RANK.epic) ui.haptic([20, 30, 40]);
    animate(el.querySelector('.rv-rev__art'), [{ opacity: 0, transform: 'scale(1.18) translateX(8%)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
    animate(el.querySelector('.rv-rev__info'), [{ opacity: 0, transform: 'translateX(-30px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 180 });
    animate(el.querySelector('.rv-rev__jp'), [{ opacity: 0, transform: 'translateY(30px)' }, { opacity: 0.9, transform: 'none' }], { duration: 600, delay: 120 });
    el.querySelectorAll('.rv-rev__rar .rv-stars__s').forEach((s, k) => animate(s, [{ opacity: 0, transform: 'scale(2.2)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 260, delay: 360 + k * 90, easing: 'cubic-bezier(.34,1.56,.64,1)' }));
    if (line && isVoiced(r.heroId)) setTimeout(() => phase === 'reveal' && ui.voice(r.heroId, 'summon', { force: true }), 380);
    if (quick) await wait(1100);
    else await new Promise(() => {}); // waits for the tap (skippable resolves it)
  }

  // ---------------------------------------------------------------- phase 3: the grid
  function grid() {
    phase = 'grid';
    skipPhase = null;
    finishAll();
    skipBtn.hidden = true;
    stage.textContent = '';
    root.classList.add('is-grid');
    const profile = ui.profile;
    const cards = results.map((r, i) => {
      const hero = getHero(r.heroId);
      const dust = refundDust(r);
      const tag = r.isNew ? (hero.gender === 'm' ? rt('summon.newHeroM') : rt('summon.newHero')) : dust ? `+${dust}` : r.constellation ? `C${r.constellation}` : null;
      const tagKind = r.isNew ? '' : dust ? 'dust' : 'const';
      const c = heroCard(ui, r.heroId, { owned: true, level: heroLevel(profile, r.heroId), constellation: r.constellation || 0, compact: true, tag, tagKind, cls: `rv-sum__card ${r.isNew ? 'is-new' : ''}` });
      const wrap = h('div.rv-sum__cell', { style: { '--i': i } }, h('div.rv-sum__cardback', h('span', '✦')), c);
      animate(wrap, [{ transform: 'rotateY(180deg) scale(0.8)', opacity: 0.4 }, { transform: 'rotateY(0deg) scale(1)', opacity: 1 }], { duration: 360, delay: 150 * i, easing: 'cubic-bezier(.2,.8,.2,1)' });
      return wrap;
    });
    const again = (count) => {
      close(count === 1 ? 'again1' : 'again10');
      ui.emit('summon', count);
    };
    const can1 = canSummonCount(profile, 1, ui.meta);
    const can10 = canSummonCount(profile, 10, ui.meta);
    const panel = h(
      'div.rv-sum__grid',
      h('h2.rv-sum__gridtitle', rt('summon.results')),
      h('div.rv-sum__cards', { class: cards.length > 5 ? 'is-ten' : '' }, ...cards),
      h('div.rv-sum__cur', rvIcon('crystal'), fmt(crystalsOf(profile))),
      h(
        'div.rv-sum__btns',
        results.length > 1
          ? rvButton(ui, { label: rt('summon.again10'), kind: 'crystal', size: 'sm', cls: 'rv-btn--center', disabled: !can10, onClick: () => again(10) })
          : rvButton(ui, { label: rt('summon.again1'), kind: 'glass', size: 'sm', cls: 'rv-btn--center', disabled: !can1, onClick: () => again(1) }),
        rvButton(ui, { label: rt('summon.done'), kind: 'gold', size: 'sm', cls: 'rv-btn--center', onClick: () => close('done') }),
      ),
    );
    stage.appendChild(panel);
    ui.refit(panel);
    ui.sound('sparkle', { intensity: 0.6 });
  }

  function close(value = 'done') {
    if (phase === 'closed') return;
    phase = 'closed';
    skipPhase = null;
    finishAll();
    root.classList.remove('is-open');
    root.classList.add('is-closing');
    setTimeout(() => root.remove(), 320);
    resolveDone(value);
  }

  let toGrid = false;
  function skipToGrid() {
    if (phase === 'grid' || phase === 'closed') return;
    toGrid = true;
    if (skipPhase) skipPhase();
  }

  // ---------------------------------------------------------------- run
  (async () => {
    if (!results.length) {
      close('done');
      return;
    }
    await skippable(pull);
    if (phase === 'closed') return;
    phase = 'reveal';
    stage.textContent = '';
    root.classList.add('is-reveal');
    for (let i = 0; i < results.length && !toGrid && phase === 'reveal'; i++) {
      await skippable(() => reveal(results[i], i, results.length));
    }
    if (phase === 'closed') return;
    grid();
  })();

  return {
    done,
    skipAll() {
      close('done');
    },
    back() {
      if (phase === 'grid') close('done');
      else skipToGrid();
    },
  };
}
