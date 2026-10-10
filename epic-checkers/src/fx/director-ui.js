// Director overlays — screen-space pieces of choreography that are not generic FX primitives:
//   caption(fx, opts)     manga speech bubble (speaker tag + line) in the speaker's lane / board edge
//   turnBanner(fx, opts)  small slash banner «ТВОЙ ХОД» on the side of the player to move (epic)
//   versus(fx, opts)      VS screen: diagonal split, both fighters (kanji portraits), power levels, 対決
//   shorten(p, ms)        make a running caption / banner exit within `ms` (the lane is needed)
//   overlayHeight(...)    expected height of a caption / banner (lane planning)
//   hintComet(fx, path)   glowing comet tracing a hinted move along the board (world space)
//   godrays(fx, opts)     sky god-rays on the background for a while (high quality only)
//   ensureFonts(list)     load fonts before building lettering (bounded wait)
//
// Every overlay runs on the FX effect runner (fx._run), so fx.clear() removes it and the returned
// promise has .stop() (used by Director.skip). Overlays default to REAL time (UI-ish punctuation).

import { Container, Graphics, Sprite, Texture, TilingSprite, Text } from 'pixi.js';
import { Ease } from '../render/tween.js';
import { mixHex, shadeHex } from '../render/canvas.js';
import { EPIC, CLASSIC } from '../render/palette.js';
import { titleStyle, subStyle, kanjiStyle } from './anime.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const css = (hex) => `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;

function texRes(fx, boost = 1.35) {
  return Math.min(2.5, Math.max(1.5, (fx.renderer.resolution || 1) * boost));
}

function done() {
  const p = Promise.resolve(true);
  p.stop = () => {};
  return p;
}

/** Overlays need the FX effect runner; a stub / missing FX makes them no-ops. */
function usable(fx) {
  return !!(fx && typeof fx._run === 'function' && fx.c && fx.textures && fx.renderer);
}

/** Load font faces for `text` (bounded by timeoutMs). specs: CSS font shorthands. */
export function ensureFonts(specs, text = '', timeoutMs = 900) {
  const F = typeof document !== 'undefined' && document.fonts && document.fonts.load ? document.fonts : null;
  if (!F) return Promise.resolve();
  const missing = specs.filter((s) => {
    try {
      return !F.check(s, text || 'A');
    } catch {
      return false;
    }
  });
  if (!missing.length) return Promise.resolve();
  const all = Promise.all(missing.map((s) => F.load(s, text || 'A').catch(() => null)));
  return Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]);
}

/**
 * Let a running overlay finish early: its exit animation starts now and lasts ≤ `ms`. Works for
 * caption / turnBanner promises (also before their fonts loaded: then it just stops them).
 */
export function shorten(p, ms = 200) {
  if (!p) return false;
  const e = p.effect || (p.inner && p.inner.effect);
  if (!e) {
    if (typeof p.stop === 'function') p.stop();
    return true;
  }
  if (e.done) return false;
  const until = (e.t || 0) + Math.max(1, ms);
  if (!(e.duration > 0) || e.duration > until) e.duration = until;
  if (typeof e.onShorten === 'function') e.onShorten();
  return true;
}

/** Run fn once fonts are there; returns a promise with .stop() that also cancels a pending start. */
function afterFonts(fx, specs, text, fn) {
  const F = typeof document !== 'undefined' && document.fonts ? document.fonts : null;
  let ready = true;
  if (F && F.check) {
    for (const s of specs) {
      try {
        if (!F.check(s, text)) ready = false;
      } catch {
        /* ignore */
      }
    }
  }
  if (ready) return fn();
  let inner = null;
  let stopped = false;
  const gen = fx._gen;
  const p = ensureFonts(specs, text).then(() => {
    if (stopped || gen !== fx._gen) return false;
    inner = fn();
    p.inner = inner;
    return inner;
  });
  p.stop = () => {
    stopped = true;
    if (inner && inner.stop) inner.stop();
  };
  return p;
}

// ================================================================================ lettering styles
function captionStyle(fx, size, color, epic) {
  const res = texRes(fx, 1.3);
  if (!epic) {
    return {
      key: `dcap-c|${size}|${res}`,
      font: '"Oswald"',
      weight: 500,
      size,
      fill: '#f4eedd',
      glow: { color: 'rgba(0,0,0,0.7)', blur: size * 0.25, alpha: 0.9 },
      spacing: 0.03,
      res,
    };
  }
  return {
    key: `dcap|${size}|${color}|${res}`,
    font: '"Russo One"',
    size,
    fill: ['#ffffff', '#ffffff', css(mixHex(color, 0xffffff, 0.72))],
    stroke: { color: '#000000', width: size * 0.16 },
    glow: { color: css(color), blur: size * 0.35, alpha: 0.55 },
    spacing: 0.01,
    res,
  };
}

function tagStyle(fx, size, color, epic) {
  const res = texRes(fx, 1.3);
  if (!epic) {
    return {
      key: `dtag-c|${size}|${res}`,
      font: '"Oswald"',
      weight: 700,
      size,
      fill: ['#fff6dc', '#c9a04c'],
      spacing: 0.12,
      res,
    };
  }
  return {
    key: `dtag|${size}|${color}|${res}`,
    font: '"Dela Gothic One"',
    size,
    fill: '#05030c',
    spacing: 0.04,
    res,
  };
}

function turnStyle(fx, size, color) {
  const res = texRes(fx, 1.4);
  return {
    key: `dturn|${size}|${color}|${res}`,
    font: '"Dela Gothic One"',
    size,
    fill: ['#ffffff', css(mixHex(color, 0xffffff, 0.6)), css(color)],
    stroke: { color: '#000000', width: size * 0.12 },
    glow: { color: css(color), blur: size * 0.45, alpha: 0.85 },
    shadow: { dx: size * 0.04, dy: size * 0.06, color: '#000000' },
    shine: 0.7,
    spacing: 0.06,
    res,
  };
}

/** Break a line into two balanced halves at a space (or return [line]). */
function splitLine(text) {
  const words = text.split(' ');
  if (words.length < 2) return [text];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const d = Math.abs(a.length - b.length);
    if (!best || d < best.d) best = { d, lines: [a, b] };
  }
  return best.lines;
}

/** Parallelogram (skewed rect) centred on 0,0. */
function para(g, w, h, slant, color, alpha) {
  const s = slant;
  g.poly([-w / 2 + s, -h / 2, w / 2 + s, -h / 2, w / 2 - s, h / 2, -w / 2 - s, h / 2], true).fill({ color, alpha });
  return g;
}

// ================================================================================ caption
/** Caption font size for a screen width (bigger than a subtitle: a character is talking, EAD-21). */
export function captionSize(W) {
  return Math.round(clamp(W * 0.058, 18, 26));
}

/** Banner font size for a screen width. */
export function bannerSize(W) {
  return Math.round(clamp(W * 0.052, 16, 26));
}

/**
 * Expected height (px) of an overlay: kind 'banner' | 'caption' (lines = 1 | 2). Used by the
 * Director's lane planner before the overlay exists.
 */
export function overlayHeight(fx, kind, lines = 2) {
  const scr = fx && fx.renderer && fx.renderer.screen;
  const W = scr && scr.width > 0 ? scr.width : 390;
  if (kind === 'banner') return bannerSize(W) * 1.7 + 8;
  const size = captionSize(W);
  return size * 1.18 * lines + size * 0.75 + size * 0.62 * 1.55 * 0.85 + Math.max(7, size * 0.42) + 4;
}

/**
 * Manga speech bubble: dark slanted plate with the line, a coloured speaker tag and a tail that
 * points toward the speaker's HUD panel ('top' | 'bottom'), slightly tilted.
 * opts: { text, speaker, color, side, duration, epic, y (centre, screen px; default: the board
 * edge of the speaker), maxH (scale down to fit a lane) }.
 */
export function caption(fx, o = {}) {
  if (!o.text || !usable(fx)) return done();
  const epic = o.epic != null ? !!o.epic : fx.epic;
  const scr = fx.renderer.screen;
  const W = scr.width;
  // compact: no free lane (small phones) — the bubble straddles the board edge, so keep it small
  const size = Math.round(captionSize(W) * (o.compact ? 0.8 : 1));
  const color = o.color != null ? o.color : epic ? EPIC.gold : CLASSIC.gold;
  const st = captionStyle(fx, size, color, epic);
  const tg = tagStyle(fx, Math.round(size * 0.62), color, epic);
  const specs = [`${st.weight || 400} ${size}px ${st.font}`, `${tg.weight || 400} ${tg.size}px ${tg.font}`];
  return afterFonts(fx, specs, o.text + (o.speaker || ''), () => captionNow(fx, o, { epic, size, color, st, tg }));
}

function captionNow(fx, o, P) {
  const { epic, size, color, st, tg } = P;
  const scr = fx.renderer.screen;
  const W = scr.width;
  const H = scr.height;
  const fr = fx.renderer.frameBounds;
  const e = { cleanup: [], realtime: o.realtime !== false, duration: o.duration || 2100 };
  const root = fx._box(fx.c.screenUI, 'director-caption');
  const maxW = Math.min(W - (o.compact ? 16 : 28), 470);
  // lines (wrap to 2 when needed)
  let lines = [o.text];
  let sprites = lines.map((l) => fx._textSprite(l, st, null, e));
  let tw = Math.max(...sprites.map((sp) => sp.texture.fx.textWidth));
  if (tw > maxW - size * 1.6 && o.text.includes(' ')) {
    for (const sp of sprites) fx._free(sp);
    lines = splitLine(o.text);
    sprites = lines.map((l) => fx._textSprite(l, st, null, e));
    tw = Math.max(...sprites.map((sp) => sp.texture.fx.textWidth));
  }
  const tScale = Math.min(1, (maxW - size * 1.6) / tw);
  const lineH = size * 1.18 * tScale;
  const ph = lineH * lines.length + size * 0.75;
  const pw = Math.min(maxW, tw * tScale + size * 2.2);
  const slant = ph * 0.22;
  const side = o.side === 'top' ? 'top' : 'bottom';
  const sgn = side === 'bottom' ? 1 : -1; // bottom: enters from the left; top: from the right
  const toward = side === 'bottom' ? 1 : -1; // the tail points toward the speaker's HUD panel
  const tagH = o.speaker ? tg.size * 1.55 : 0;
  const tailH = epic ? Math.max(7, size * 0.42) : 0;
  const fullH = ph + tagH * 0.85 + tailH + 4;
  const k = o.maxH > 0 ? Math.min(1, o.maxH / fullH) : 1;
  let y;
  if (o.y != null) y = o.y;
  else if (fr.height > 0 && o.compact) y = side === 'bottom' ? fr.y + fr.height - fullH * 0.3 : fr.y + fullH * 0.3;
  else if (fr.height > 0) y = side === 'bottom' ? fr.y + fr.height + ph * 0.5 + 6 : fr.y - ph * 0.5 - 10;
  else y = side === 'bottom' ? H * 0.78 : H * 0.22;
  y = clamp(y, (fullH * k) / 2 + 4, H - (fullH * k) / 2 - 4);
  root.position.set(W / 2, y);
  root.scale.set(k);
  root.rotation = epic ? (side === 'bottom' ? -0.07 : 0.07) : 0;

  const body = fx._box(root, 'caption-body');
  // the plate sits a bit away from the tail so the whole bubble stays centred on y
  body.y = (-toward * (tailH - tagH * 0.85)) / 2;
  const plate = new Graphics();
  body.addChild(plate);
  const tailX = -pw / 2 + Math.min(pw * 0.2, size * 2.4);
  if (epic) {
    para(plate, pw + 6, ph + 6, slant, color, 0.6); // coloured rim
    // tail toward the HUD (rim, then body)
    const ty0 = toward * (ph / 2);
    plate.poly([tailX - size * 0.55, ty0, tailX + size * 0.25, ty0, tailX - size * 0.75, ty0 + toward * (tailH + 3)], true).fill({ color, alpha: 0.6 });
    para(plate, pw, ph, slant, 0x06040c, 0.93);
    plate.poly([tailX - size * 0.42, ty0 - toward * 1, tailX + size * 0.14, ty0 - toward * 1, tailX - size * 0.68, ty0 + toward * tailH], true).fill({ color: 0x06040c, alpha: 0.93 });
    // inner gradient sheen
    const sheen = new Graphics();
    para(sheen, pw, ph * 0.45, slant * 0.45, mixHex(color, 0x000000, 0.55), 0.35);
    sheen.y = -ph * 0.27;
    body.addChild(sheen);
    // accent bar on the speaker side
    const bar = new Graphics();
    para(bar, size * 0.42, ph, slant, color, 1);
    bar.x = sgn * (-pw / 2 + size * 0.22);
    body.addChild(bar);
  } else {
    para(plate, pw, ph, 0, 0x1a0f08, 0.92);
    const hair = new Graphics();
    hair.rect(-pw / 2, -ph / 2 + 3, pw, 1).fill({ color: CLASSIC.gold, alpha: 0.9 });
    hair.rect(-pw / 2, ph / 2 - 4, pw, 1).fill({ color: CLASSIC.gold, alpha: 0.9 });
    body.addChild(hair);
  }
  let flash = null;
  if (epic) {
    flash = new Graphics();
    para(flash, pw, ph, slant, 0xffffff, 1);
    flash.blendMode = 'add';
    body.addChild(flash);
  }
  const textBox = fx._box(body, 'caption-text');
  sprites.forEach((sp, i) => {
    textBox.addChild(sp);
    sp.scale.set(tScale);
    sp.position.set(sgn * size * 0.25, (i - (lines.length - 1) / 2) * lineH + size * 0.04);
  });
  // speaker tag on the edge facing away from the tail
  let tag = null;
  if (o.speaker) {
    tag = fx._box(body, 'caption-tag');
    const ts = fx._textSprite(o.speaker.toUpperCase(), tg, null, e);
    const tw2 = ts.texture.fx.textWidth;
    const th = tagH;
    const tgW = tw2 + tg.size * 1.6;
    const g = new Graphics();
    if (epic) para(g, tgW, th, th * 0.25, color, 1);
    else {
      para(g, tgW, th, 0, 0x2a1a10, 1);
      g.rect(-tgW / 2, th / 2 - 1.5, tgW, 1.5).fill({ color: CLASSIC.gold, alpha: 1 });
    }
    tag.addChild(g, ts);
    tag.position.set(sgn * (-pw / 2 + tgW / 2 + size * 0.3), -toward * (ph / 2 + th * 0.35));
    tag._w = tgW;
  }
  const inMs = epic ? 200 : 260;
  const outMs = 220;
  e.update = (dt, t) => {
    const dur = e.duration;
    const kin = clamp01(t / inMs);
    const ke = t > dur - outMs ? clamp01((t - (dur - outMs)) / outMs) : 0;
    if (epic) {
      body.scale.set(Ease.outBack(kin) * 0.25 + 0.75 * Ease.outCubic(kin), 1 - 0.7 * Ease.inQuad(ke));
      body.x = -sgn * (1 - Ease.outQuart(kin)) * W * 0.6 + sgn * Ease.inQuart(ke) * W * 0.4;
      body.skew.x = -0.18 * (1 - kin);
      if (flash) flash.alpha = Math.max(0, 0.9 - t / 160);
      textBox.alpha = clamp01((t - 70) / 120) * (1 - ke);
      textBox.x = -sgn * (1 - Ease.outCubic(clamp01((t - 70) / 220))) * size * 1.5;
    } else {
      body.alpha = Ease.outCubic(kin) * (1 - ke);
      body.y = (1 - Ease.outCubic(kin)) * 8;
      textBox.alpha = 1;
    }
    if (tag) {
      const k2 = clamp01((t - 90) / 200);
      tag.alpha = k2 * (1 - ke);
      tag.scale.set(epic ? 0.6 + 0.4 * Ease.outBack(k2) : 1);
    }
  };
  e.end = () => fx._dispose(root);
  const p = fx._run(e);
  p.height = fullH * k;
  return p;
}

// ================================================================================ turn banner
/**
 * Small slash banner for the side to move (epic). opts: { text, color, side: 'top'|'bottom',
 * duration, y (centre, screen px; default: the board edge of that side), maxH }.
 */
export function turnBanner(fx, o = {}) {
  if (!usable(fx) || !fx.epic || !o.text) return done();
  const scr = fx.renderer.screen;
  const size = bannerSize(scr.width);
  const color = o.color != null ? o.color : EPIC.white;
  const st = turnStyle(fx, size, color);
  return afterFonts(fx, [`${size}px "Dela Gothic One"`], o.text, () => turnNow(fx, o, { size, color, st }));
}

function turnNow(fx, o, P) {
  const { size, color, st } = P;
  const scr = fx.renderer.screen;
  const W = scr.width;
  const H = scr.height;
  const fr = fx.renderer.frameBounds;
  const e = { cleanup: [], realtime: o.realtime !== false, duration: o.duration || 1050 };
  const side = o.side === 'top' ? 'top' : 'bottom';
  const root = fx._box(fx.c.screenUI, 'director-turn');
  const ph = size * 1.7;
  const k = o.maxH > 0 ? Math.min(1, o.maxH / (ph + 8)) : 1;
  let y = o.y != null ? o.y : fr.height > 0 ? (side === 'bottom' ? fr.y + fr.height : fr.y) : side === 'bottom' ? H * 0.8 : H * 0.2;
  y = clamp(y, (ph * k) / 2 + 4, H - (ph * k) / 2 - 4);
  root.position.set(W / 2, y);
  root.scale.set(k);
  root.rotation = side === 'bottom' ? -0.035 : 0.035;
  const text = fx._textSprite(o.text, st, null, e);
  const tw = text.texture.fx.textWidth;
  const pw = tw + size * 3.2;
  // slash line (glow + core), sweeps left → right
  const line = new Container();
  const glowL = fx._sprite(Texture.WHITE, line);
  glowL.anchor.set(0, 0.5);
  glowL.tint = color;
  glowL.blendMode = 'add';
  const coreL = fx._sprite(Texture.WHITE, line);
  coreL.anchor.set(0, 0.5);
  coreL.blendMode = 'add';
  const L = (W * 1.25) / k;
  glowL.width = L;
  glowL.height = 7;
  glowL.alpha = 0.5;
  coreL.width = L;
  coreL.height = 2;
  line.x = -L / 2;
  root.addChild(line);
  // plate
  const plate = new Container();
  const g = new Graphics();
  para(g, pw + 8, ph + 8, ph * 0.3, color, 0.95);
  para(g, pw, ph, ph * 0.3, 0x05030c, 0.94);
  const band = new TilingSprite({ texture: fx.textures.bandStreaks(), width: pw, height: ph * 0.8 });
  band.anchor.set(0.5);
  band.tint = color;
  band.alpha = 0.35;
  band.blendMode = 'add';
  const bandMask = new Graphics();
  para(bandMask, pw, ph, ph * 0.3, 0xffffff, 1);
  band.mask = bandMask;
  plate.addChild(g, band, bandMask, text);
  root.addChild(plate);
  const flare = fx._sprite(fx.textures.frame('flare'), root);
  flare.blendMode = 'add';
  flare.tint = mixHex(color, 0xffffff, 0.5);
  flare.alpha = 0;
  e.update = (dt, t) => {
    const dur = e.duration;
    const lk = clamp01(t / 160);
    line.scale.x = Ease.outCubic(lk);
    const outStart = dur - 200;
    const ke = t > outStart ? clamp01((t - outStart) / 200) : 0;
    line.alpha = (t < 300 ? 1 : Math.max(0.35, 1 - (t - 300) / 500)) * (1 - ke);
    const pk = clamp01((t - 70) / 200);
    plate.scale.set(1 + 0.25 * (1 - Ease.outBack(pk)), ke > 0 ? 1 - Ease.inBack(ke) : Ease.outBack(pk));
    plate.alpha = pk > 0 ? 1 : 0;
    plate.skew.x = -0.2;
    band.tilePosition.x -= dt * 0.25;
    text.x = (1 - Ease.outQuart(clamp01((t - 110) / 240))) * -pw * 0.35;
    text.alpha = clamp01((t - 110) / 120);
    const fk = clamp01((t - 60) / 260);
    flare.alpha = fk > 0 && fk < 1 ? Math.sin(Math.PI * fk) * 0.9 : 0;
    flare.scale.set((W * 1.3) / k / 128, (ph * 0.55) / 24);
  };
  e.end = () => fx._dispose(root);
  const p = fx._run(e);
  p.height = (ph + 8) * k;
  return p;
}

// ================================================================================ versus
/**
 * VS screen. opts: { top: fighter, bottom: fighter, label (power label, e.g. 'УРОВЕНЬ СИЛЫ'),
 * holdMs, onClash(), onSplit() } with fighter = { name, sub, color, side (1|-1), power, king,
 * glyph (one kanji painted on the portrait, e.g. 侍 / 神 / 主) }.
 * Timeline (real ms): 0–260 panels slam in · 260 clash (line + 対決 via onClash) · hold ·
 * holdMs exit 300 ms. Resolves when the overlay is gone.
 */
export function versus(fx, o = {}) {
  if (!usable(fx)) {
    if (o.onClash) o.onClash();
    return done();
  }
  const scr = fx.renderer.screen;
  const W = scr.width;
  const nameSize = Math.round(clamp(W * 0.14, 36, 84));
  const subSize = Math.round(clamp(W * 0.043, 14, 24));
  const specs = [`${nameSize}px "Dela Gothic One"`, `${subSize}px "Russo One"`, `900 ${subSize}px "Unbounded"`];
  const txt = `${o.top.name}${o.bottom.name}${o.top.sub || ''}${o.bottom.sub || ''}${o.label || ''}${o.top.glyph || ''}${o.bottom.glyph || ''}0123456789`;
  return afterFonts(fx, specs, txt, () => versusNow(fx, o, { nameSize, subSize }));
}

function versusNow(fx, o, P) {
  const { nameSize, subSize } = P;
  const scr = fx.renderer.screen;
  const W = scr.width;
  const H = scr.height;
  const T = fx.textures;
  const hold = o.holdMs || 1350;
  const outMs = 300;
  const dur = hold + outMs;
  const e = { cleanup: [], realtime: true, duration: dur };
  const root = fx._box(fx.c.screenUI, 'director-versus');
  const dim = fx._sprite(Texture.WHITE, root);
  dim.anchor.set(0);
  dim.width = W + 4;
  dim.height = H + 4;
  dim.position.set(-2, -2);
  dim.tint = 0x000000;
  dim.alpha = 0;
  // split line through the board centre (the DOM HUD sits above / below the board), rising right
  const fr = fx.renderer.frameBounds;
  const cy0 = fr && fr.height > 0 ? fr.y + fr.height / 2 : H / 2;
  const cy = Math.max(H * 0.36, Math.min(H * 0.64, cy0));
  const yL = cy + W * 0.2;
  const yR = cy - W * 0.2;
  const ang = Math.atan2(yR - yL, W);
  const pad = Math.max(W, H);
  const fighters = [
    { f: o.top, poly: [-pad, -pad, W + pad, -pad, W + pad, yR + (yR - yL) * (pad / W), -pad, yL - (yR - yL) * (pad / W)], dir: -1 },
    { f: o.bottom, poly: [-pad, yL - (yR - yL) * (pad / W), W + pad, yR + (yR - yL) * (pad / W), W + pad, H + pad, -pad, H + pad], dir: 1 },
  ];
  const panels = [];
  for (const F of fighters) {
    const f = F.f;
    const col = f.color;
    const panel = fx._box(root, 'vs-panel');
    const content = fx._box(panel, 'vs-content');
    const mask = new Graphics();
    mask.poly(F.poly, true).fill(0xffffff);
    panel.addChild(mask);
    content.mask = mask;
    const bg = new Graphics();
    bg.poly(F.poly, true).fill({ color: shadeHex(col, 0.16), alpha: 0.97 });
    content.addChild(bg);
    // diagonal energy streaks
    const streaks = new TilingSprite({ texture: T.bandStreaks(), width: pad * 3, height: H * 0.7 });
    streaks.anchor.set(0.5);
    streaks.rotation = ang;
    streaks.position.set(W / 2, F.dir < 0 ? H * 0.28 : H * 0.72);
    streaks.tint = col;
    streaks.alpha = 0.42;
    streaks.blendMode = 'add';
    content.addChild(streaks);
    // big glow behind the portrait
    const px = F.dir < 0 ? W * 0.26 : W * 0.74;
    const py = F.dir < 0 ? cy - W * 0.5 : cy + W * 0.5;
    const glow = fx._sprite(T.frame('dot'), content);
    glow.blendMode = 'add';
    glow.tint = col;
    glow.alpha = 0.75;
    glow.position.set(px, py);
    glow.scale.set((W * 1.25) / 64);
    const rays = fx._sprite(T.rays(), content);
    rays.blendMode = 'add';
    rays.tint = col;
    rays.alpha = 0.5;
    rays.position.set(px, py);
    rays.scale.set((W * 1.5) / 256);
    const pSize = Math.round(Math.min(320, W * 0.82));
    // portrait: the fighter's disc with an ink-brush ensō and their kanji (侍 / 神 / 主…) painted
    // huge on it — a character, not a generic emblem (EAD-06). Without a glyph: the old emblem.
    const portrait = fx._box(content, 'vs-portrait');
    const disc = fx._sprite(T.emblem(f.side === -1 ? -1 : 1, { epic: true, king: !!f.king && !f.glyph, size: pSize }), portrait);
    disc.scale.set(1);
    if (f.glyph) {
      const brushSeed = f.side === -1 ? 3 : 8;
      const ink = fx._sprite(T.brush(brushSeed, pSize), portrait);
      ink.tint = 0x000000;
      ink.alpha = 0.8;
      ink.scale.set(1.26);
      ink.rotation = 0.3;
      const neon = fx._sprite(T.brush(brushSeed, pSize), portrait);
      neon.tint = mixHex(col, 0xffffff, 0.25);
      neon.alpha = 0.95;
      neon.rotation = 0.3;
      neon.scale.set(1.18);
      const gSize = Math.round(pSize * 0.37);
      const glyph = fx._textSprite(f.glyph, kanjiStyle(fx, gSize, col), portrait, e, f.side === -1 ? 11 : 5);
      glyph.position.set(-pSize * 0.01, pSize * 0.01);
      glyph.rotation = -0.06 * (f.side === -1 ? -1 : 1);
    }
    portrait.position.set(px, py);
    const pBase = (W * 0.8) / pSize;
    portrait.scale.set(pBase);
    // edge glow along the split
    const edge = new Graphics();
    const ex0 = -pad;
    const ey0 = yL - (yR - yL) * (pad / W);
    const ex1 = W + pad;
    const ey1 = yR + (yR - yL) * (pad / W);
    const off = F.dir * 7;
    edge.moveTo(ex0, ey0 + off).lineTo(ex1, ey1 + off).stroke({ width: 10, color: col, alpha: 0.55 });
    edge.blendMode = 'add';
    content.addChild(edge);
    // texts
    const textBox = fx._box(panel, 'vs-text');
    const ts = titleStyle(fx, nameSize, col, 'epic');
    const ss = subStyle(fx, subSize, col, 'epic');
    const nameS = fx._textSprite(f.name, ts, textBox, e);
    const nScale = Math.min(1, (W * 0.72) / nameS.texture.fx.textWidth);
    nameS.scale.set(nScale);
    const right = F.dir < 0; // top fighter text sits on the right, bottom fighter on the left
    nameS.anchor.set(right ? 1 : 0, 0.5);
    let subS = null;
    if (f.sub) {
      subS = fx._textSprite(f.sub, ss, textBox, e);
      subS.anchor.set(right ? 1 : 0, 0.5);
      subS.scale.set(Math.min(1, (W * 0.7) / subS.texture.fx.textWidth));
    }
    const power = new Text({
      text: `${o.label || 'POWER'}: 0`,
      style: {
        fontFamily: 'Unbounded',
        fontWeight: '900',
        fontSize: subSize,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: Math.max(3, subSize * 0.28), join: 'round' },
        dropShadow: { color: col, blur: subSize * 0.6, distance: 0, alpha: 0.95, angle: 0 },
        letterSpacing: 1,
      },
      resolution: Math.min(3, (fx.renderer.resolution || 1) * 1.4),
    });
    power.anchor.set(right ? 1 : 0, 0.5);
    textBox.addChild(power);
    const tx = right ? W - 16 : 16;
    const nameY = right ? yR - W * 0.3 : yL + W * 0.17;
    const blockY = nameY;
    panels.push({ F, panel, content, streaks, portrait, pBase, rays, glow, textBox, nameS, subS, power, tx, blockY, right, f });
  }
  // split line
  const split = new Graphics();
  const cx = W / 2;
  const half = Math.hypot(W, yL - yR) * 0.75;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  for (const [w, c, a] of [[22, EPIC.gold, 0.18], [9, 0xffffff, 0.45], [3.5, 0xffffff, 1]]) {
    split.moveTo(-half, 0).lineTo(half, 0).stroke({ width: w, color: c, alpha: a, cap: 'round' });
  }
  split.blendMode = 'add';
  split.position.set(cx, cy);
  split.rotation = ang;
  split.scale.set(0, 1);
  root.addChild(split);
  const clashFlare = fx._sprite(T.frame('flare'), root);
  clashFlare.blendMode = 'add';
  clashFlare.position.set(cx, cy);
  clashFlare.rotation = ang;
  clashFlare.alpha = 0;
  const IN = 260;
  let clashed = false;
  let split2 = false;
  let sparkAcc = 0;
  e.update = (dt, t) => {
    const kin = clamp01(t / IN);
    const ke = t > hold ? clamp01((t - hold) / outMs) : 0;
    dim.alpha = 0.6 * clamp01(t / 200) * (1 - ke);
    for (const p of panels) {
      const dir = p.F.dir; // top panel comes from the left, bottom from the right
      const slide = (1 - Ease.outQuart(kin)) * W * 1.15 + Ease.inQuart(ke) * W * 1.2;
      p.panel.x = dir < 0 ? -slide : slide;
      p.panel.y = (dir < 0 ? -1 : 1) * (1 - Ease.outQuart(kin)) * W * 0.25;
      p.streaks.tilePosition.x += dt * 0.9 * (dir < 0 ? 1 : -1);
      p.rays.rotation += dt * 0.0004 * dir;
      const hk = clamp01(t / hold);
      p.portrait.scale.set(p.pBase * (1.16 - 0.12 * Ease.outCubic(hk)));
      p.portrait.rotation = -0.06 * dir + 0.05 * hk * dir;
      p.glow.alpha = 0.6 + 0.2 * Math.sin(t * 0.012);
      // texts slam in after the clash
      const tk = clamp01((t - (IN + 40)) / 240);
      const tx = p.tx + (p.right ? 1 : -1) * (1 - Ease.outQuart(tk)) * W * 0.6;
      const lh = nameSizeOf(p);
      p.nameS.position.set(tx, p.blockY);
      p.nameS.alpha = tk > 0 ? 1 : 0;
      p.nameS.skew.x = -0.12;
      let yy = p.blockY + lh * 0.62;
      if (p.subS) {
        const sk = clamp01((t - (IN + 140)) / 220);
        p.subS.position.set(p.tx + (p.right ? 1 : -1) * (1 - Ease.outCubic(sk)) * W * 0.3, yy);
        p.subS.alpha = sk;
        p.subS.skew.x = -0.1;
        yy += subSize * 1.45;
      }
      const pk = clamp01((t - (IN + 220)) / 200);
      p.power.position.set(p.tx + (p.right ? 1 : -1) * (1 - Ease.outCubic(pk)) * W * 0.3, yy);
      p.power.alpha = pk;
      // power level counts up
      const ck = clamp01((t - (IN + 260)) / 700);
      const val = Math.round((p.f.power || 0) * Ease.outCubic(ck));
      const label = `${o.label || 'POWER'}: ${val}${ck >= 1 && p.f.powerSuffix ? p.f.powerSuffix : ''}`;
      if (p.power.text !== label) p.power.text = label;
      p.textBox.alpha = 1 - ke;
    }
    // clash
    if (!clashed && t >= IN) {
      clashed = true;
      if (o.onClash) o.onClash();
    }
    const sk = clamp01((t - IN) / 120);
    split.scale.set(Ease.outCubic(sk), 1 + 0.6 * Math.max(0, 1 - (t - IN) / 200));
    split.alpha = (sk > 0 ? 0.85 + 0.15 * Math.sin(t * 0.04) : 0) * (1 - ke);
    const fk = clamp01((t - IN) / 380);
    clashFlare.alpha = fk > 0 && fk < 1 ? Math.sin(Math.PI * fk) : 0;
    clashFlare.scale.set((W * 2.4 * (0.4 + 0.6 * fk)) / 128, (W * 0.12 * (1 - fk * 0.6)) / 24);
    if (clashed && ke <= 0) {
      sparkAcc += (dt / 1000) * 28 * fx.q.mul;
      while (sparkAcc >= 1) {
        sparkAcc -= 1;
        const u = (Math.random() - 0.5) * 2 * half * 0.8;
        fx.emit('spark', cx + ca * u, cy + sa * u, { screen: true, realtime: true, count: 1 / fx.q.mul, color: Math.random() < 0.5 ? o.top.color : o.bottom.color, speed: 0.7 });
      }
    }
    if (!split2 && t >= hold) {
      split2 = true;
      if (o.onSplit) o.onSplit();
    }
  };
  e.end = () => fx._dispose(root);
  function nameSizeOf(p) {
    return nameSize * p.nameS.scale.y;
  }
  return fx._run(e);
}

// ================================================================================ hint comet
/** A glowing comet tracing `path` (world space, real time). opts: { color, epic, hopMs }. */
export function hintComet(fx, path, o = {}) {
  if (!path || path.length < 2 || !usable(fx)) return done();
  const r = fx.renderer;
  const epic = o.epic != null ? !!o.epic : fx.epic;
  const color = o.color != null ? o.color : epic ? EPIC.hint : CLASSIC.goldLight;
  const hop = o.hopMs || 230;
  const pts = path.map((sq) => r.squareCenter(sq));
  const sq = r.squareSize;
  const travel = hop * (pts.length - 1);
  const dur = travel + 420;
  const e = { cleanup: [], realtime: true, duration: dur };
  const box = fx._box(fx.c.worldOver, 'director-hint');
  const glow = fx._sprite(fx.textures.frame('dot'), box);
  glow.blendMode = 'add';
  glow.tint = color;
  const core = fx._sprite(fx.textures.frame('core'), box);
  core.blendMode = 'add';
  core.tint = mixHex(color, 0xffffff, 0.6);
  const streak = fx._sprite(fx.textures.frame('flare'), box);
  streak.blendMode = 'add';
  streak.tint = color;
  const rings = [];
  let reached = 0;
  let acc = 0;
  e.update = (dt, t) => {
    const u = Math.min(1, t / travel) * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(u));
    const k = Ease.inOutSine(u - i);
    const a = pts[i];
    const b = pts[i + 1];
    const x = a.x + (b.x - a.x) * k;
    const y = a.y + (b.y - a.y) * k;
    const fade = t > travel ? Math.max(0, 1 - (t - travel) / 400) : Math.min(1, t / 80);
    glow.position.set(x, y);
    glow.scale.set((sq * 1.5) / 64);
    glow.alpha = (epic ? 0.85 : 0.55) * fade;
    core.position.set(x, y);
    core.scale.set((sq * 0.55) / 32);
    core.alpha = fade;
    streak.position.set(x, y);
    streak.rotation = Math.atan2(b.y - a.y, b.x - a.x);
    streak.scale.set((sq * 2.2 * (t < travel ? 1 : fade)) / 128, (sq * 0.28) / 24);
    streak.alpha = 0.8 * fade;
    // waypoint pulses
    const idx = Math.min(pts.length - 1, Math.floor(Math.min(1, t / travel) * (pts.length - 1) + 1e-6));
    while (reached < idx || (t >= travel && reached < pts.length - 1)) {
      reached++;
      const ring = fx._sprite(fx.textures.frame('ring'), box);
      ring.blendMode = 'add';
      ring.tint = color;
      ring.position.set(pts[reached].x, pts[reached].y);
      rings.push({ s: ring, t: 0 });
    }
    for (const rg of rings) {
      rg.t += dt;
      const rk = clamp01(rg.t / 380);
      rg.s.scale.set((sq * (0.3 + 0.55 * Ease.outCubic(rk))) / 56);
      rg.s.alpha = (1 - rk) * 0.9;
    }
    if (t < travel) {
      acc += (dt / 1000) * (epic ? 40 : 18);
      while (acc >= 1) {
        acc -= 1;
        fx.emit(epic ? 'spark' : 'stars', x, y, { count: 1, color, speed: 0.25, life: 0.7, size: epic ? 0.8 : 0.6, realtime: true });
      }
    }
  };
  e.end = () => fx._dispose(box);
  return fx._run(e);
}

// ================================================================================ god-rays
/** Sky god-rays on the background (high quality only, else no-op). opts: { duration, x, alpha }. */
export function godrays(fx, o = {}) {
  const h = usable(fx) && fx.filters && fx.filters.godray ? fx.filters.godray() : null;
  if (!h) return done();
  const dur = o.duration || 3000;
  const scr = fx.renderer.screen;
  const e = {
    cleanup: [],
    realtime: o.realtime !== false,
    duration: dur,
    update: (dt, t) => {
      const f = h.filter;
      f.time += dt / 1000;
      f.centerX = o.x != null ? o.x : scr.width / 2;
      f.centerY = -scr.height * 0.2;
      const a = Math.min(1, t / 400, (dur - t) / 500);
      f.alpha = (o.alpha != null ? o.alpha : 0.6) * clamp01(a);
      f.gain = 0.52;
    },
    end: () => h.release(),
  };
  return fx._run(e);
}

/**
 * Screen-space sword slash (a tapered light streak that sweeps across, then fades), drawn ABOVE
 * screen lettering — e.g. across the 完璧 kanji. opts: { length (px), color, width (px), duration }.
 */
export function screenSlash(fx, x, y, angle, o = {}) {
  if (!usable(fx)) return done();
  const len = o.length || fx.renderer.screen.width * 0.8;
  const color = o.color != null ? o.color : 0xffffff;
  const w = o.width || 14;
  const e = { cleanup: [], realtime: true, duration: o.duration || 360 };
  const box = fx._box(fx.c.screenUI, 'director-slash');
  box.position.set(x, y);
  box.rotation = angle;
  const glow = fx._sprite(fx.textures.frame('flare'), box);
  glow.blendMode = 'add';
  glow.tint = color;
  const core = fx._sprite(fx.textures.frame('flare'), box);
  core.blendMode = 'add';
  core.tint = 0xffffff;
  e.update = (dt, t, k) => {
    const sweep = Ease.outCubic(clamp01(k / 0.35));
    const fade = k < 0.35 ? 1 : Math.pow(1 - (k - 0.35) / 0.65, 1.4);
    const L = len * sweep;
    glow.position.set(-len / 2 + L / 2, 0);
    glow.scale.set(L / 128, (w * 2.2 * fade) / 24);
    glow.alpha = 0.9 * fade;
    core.position.copyFrom(glow.position);
    core.scale.set(L / 128, (w * 0.6 * fade) / 24);
    core.alpha = fade;
  };
  e.end = () => fx._dispose(box);
  return fx._run(e);
}

/** Expanding ring + sparks on a piece (selection feedback). */
export function pulse(fx, x, y, o = {}) {
  if (!usable(fx)) return done();
  const sq = fx.sq;
  const color = o.color != null ? o.color : EPIC.white;
  const e = { cleanup: [], realtime: true, duration: o.duration || 360 };
  const box = fx._box(fx.c.worldUnder, 'director-pulse');
  const ring = fx._sprite(fx.textures.frame('ring'), box);
  ring.blendMode = 'add';
  ring.tint = color;
  ring.position.set(x, y);
  const ring2 = fx._sprite(fx.textures.frame('ringSoft'), box);
  ring2.blendMode = 'add';
  ring2.tint = color;
  ring2.position.set(x, y);
  e.update = (dt, t, k) => {
    ring.scale.set((sq * (0.42 + 0.5 * Ease.outCubic(k))) / 56);
    ring.alpha = 0.9 * (1 - k);
    ring2.scale.set((sq * (0.3 + 0.35 * Ease.outCubic(k))) / 56);
    ring2.alpha = 0.6 * (1 - k) * (1 - k);
  };
  e.end = () => fx._dispose(box);
  return fx._run(e);
}

export { TAU };
