// Renderer settings (SETTINGS CONTRACT): applySettings (showCoords, showLastMove, fx.backdrop,
// battery), resolution caps per quality, side colours (setSideColors / sideColor / epicSideColor),
// piece-skin keys / colours / oversampling. Headless (no init(), no WebGL).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer, resolutionFor, QUALITY_LEVELS } from '../../src/render/renderer.js';
import { Highlights } from '../../src/render/highlights.js';
import { skinKey, skinColors, skinOversample } from '../../src/render/piece-skin.js';
import { EPIC, CLASSIC } from '../../src/render/palette.js';

const GOLD = 0xffd23f;
const CYAN = 0x29e6ff;
const CRIMSON = 0xff2e63;

function make(size = 8) {
  const r = new Renderer({ clientWidth: 390, clientHeight: 844 });
  r.variant = { size, playable: 'dark' };
  r._rect = { x: 0, y: 150, width: 390, height: 390 };
  return r;
}

test('resolution caps: high 1.75, medium 1.25, low 1, battery 1 — never above the DPR', () => {
  assert.equal(resolutionFor('high', 3), 1.75);
  assert.equal(resolutionFor('high', 2.625), 1.75);
  assert.equal(resolutionFor('medium', 3), 1.25);
  assert.equal(resolutionFor('low', 3), 1);
  assert.equal(resolutionFor('high', 3, true), 1);
  assert.equal(resolutionFor('high', 1.5), 1.5);
  assert.equal(resolutionFor('medium', 1), 1);
  assert.equal(resolutionFor('nonsense', 3), 1.75);
  assert.equal(QUALITY_LEVELS.high.antialias, true);
  assert.equal(QUALITY_LEVELS.medium.antialias, false);
  assert.equal(QUALITY_LEVELS.low.antialias, false);
});

test('applySettings: showCoords toggles the 8×8 labels; 10×10 never has labels', () => {
  const r = make(8);
  assert.equal(r._computeLayout().labels, true);
  r.applySettings({ showCoords: false });
  assert.equal(r.showCoords, false);
  assert.equal(r._computeLayout().labels, false);
  r.applySettings({ showCoords: true });
  assert.equal(r._computeLayout().labels, true);
  const r10 = make(10);
  r10.applySettings({ showCoords: true });
  assert.equal(r10._computeLayout().labels, false);
});

test('applySettings: battery → resolution 1, 30 fps, static backdrop; fx.backdrop off → static only', () => {
  const r = make();
  r.quality = 'high';
  r.resolution = 1.75;
  r.applySettings({ battery: true, fx: { backdrop: true } });
  assert.equal(r.battery, true);
  assert.equal(r.resolution, 1);
  assert.equal(r.fpsCap, 30);
  assert.equal(r.staticBackdrop, true);
  assert.equal(r.quality, 'high', 'the quality level is the controller\'s');
  r.applySettings({ battery: false, fx: { backdrop: false } });
  assert.equal(r.battery, false);
  assert.equal(r.staticBackdrop, true);
  assert.equal(r.fpsCap, 60);
  r.applySettings({ battery: false, fx: { backdrop: true } });
  assert.equal(r.staticBackdrop, false);
});

test('applySettings ignores settings.quality (no double ownership with the controller)', () => {
  const r = make();
  r.setQuality('medium');
  r.applySettings({ quality: 'high' });
  assert.equal(r.quality, 'medium');
  r.applySettings({ quality: 'auto' });
  assert.equal(r.quality, 'medium');
});

test('applySettings is null-safe and idempotent', () => {
  const r = make();
  r.applySettings(null);
  r.applySettings(undefined);
  r.applySettings('x');
  r.applySettings({});
  r.applySettings({});
  assert.equal(r.showCoords, true);
  assert.equal(r.staticBackdrop, false);
  assert.equal(r.battery, false);
});

test('showLastMove hides the last-move layer but keeps the path', () => {
  const r = make();
  r.highlights = new Highlights(r);
  r.highlights.state.lastMove = [9, 18];
  r.applySettings({ showLastMove: false });
  assert.equal(r.highlights.gLast.visible, false);
  assert.deepEqual(r.highlights.state.lastMove, [9, 18]);
  r.applySettings({ showLastMove: true });
  assert.equal(r.highlights.gLast.visible, true);
  // set before the highlights exist (before init) → applied when they are created
  const r2 = make();
  r2.applySettings({ showLastMove: false });
  assert.equal(r2._showLastMove, false);
});

test('sideColor: epic energy colours (custom or default), classic accents, hex pass-through', () => {
  const r = make();
  r.theme = 'epic';
  assert.equal(r.sideColor(1), CYAN);
  assert.equal(r.sideColor(-1), CRIMSON);
  assert.equal(r.sideColor(0x123456), 0x123456);
  r.setSideColors({ 1: GOLD, '-1': CYAN }); // keys as the controller builds them
  assert.equal(r.sideColor(1), GOLD);
  assert.equal(r.sideColor(-1), CYAN);
  assert.deepEqual(r.sideColors, { 1: GOLD, [-1]: CYAN });
  r.theme = 'classic';
  assert.equal(r.sideColor(1), CLASSIC.accent[1]);
  assert.equal(r.sideColor(-1), CLASSIC.accent[-1]);
  assert.equal(r.epicSideColor(1), GOLD, 'epicSideColor ignores the theme');
  r.setSideColors(null);
  assert.equal(r.sideColors, null);
  assert.equal(r.epicSideColor(1), EPIC.side[1]);
});

test('setSideColors: partial / invalid colours fall back to the defaults; defaults = null', () => {
  const r = make();
  r.theme = 'epic';
  r.setSideColors({ 1: 0x3dff8f });
  assert.equal(r.epicSideColor(1), 0x3dff8f);
  assert.equal(r.epicSideColor(-1), CRIMSON);
  r.setSideColors({ 1: 'red', '-1': -5 });
  assert.equal(r.sideColors, null, 'nothing valid → defaults');
  r.setSideColors({ 1: CYAN, '-1': CRIMSON });
  assert.equal(r.sideColors, null, 'the default pair is stored as null');
  r.setSideColors({});
  assert.equal(r.sideColors, null);
});

test('skin helpers: colours, cache keys and oversampling', () => {
  assert.deepEqual(skinColors(null), { 1: CYAN, [-1]: CRIMSON });
  assert.deepEqual(skinColors({ '-1': GOLD }), { 1: CYAN, [-1]: GOLD });
  const a = skinKey('epic', 45, 1.75, { oversample: 1.3, colors: null });
  const b = skinKey('epic', 45, 1.75, { oversample: 1.3, colors: { 1: GOLD } });
  const c = skinKey('epic', 45, 1.75, { oversample: 1.3, colors: { 1: CYAN, '-1': CRIMSON } });
  assert.notEqual(a, b);
  assert.equal(a, c, 'explicit defaults share the default skin');
  assert.equal(skinKey('classic', 45, 1.75, { oversample: 1.3, colors: { 1: GOLD } }), skinKey('classic', 45, 1.75, { oversample: 1.3 }), 'classic ignores colours');
  assert.notEqual(skinKey('epic', 45, 1.75, { oversample: 1.3 }), skinKey('epic', 45, 1.25, { oversample: 1.3 }));
  assert.equal(skinOversample(45, 'low'), 1);
  assert.ok(Math.abs(skinOversample(45, 'high') - 58 / 45) < 1e-9);
  assert.equal(skinOversample(20, 'high'), 1.5);
  assert.equal(skinOversample(80, 'medium'), 1.1);
});

test('highlights use the renderer\'s side colours for the epic last-move neon and rings', () => {
  const r = make();
  r.theme = 'epic';
  r.highlights = new Highlights(r);
  r._pieces = new Array(64).fill(null);
  r._pieces[18] = { color: 1 };
  const def = r.highlights.lastMoveColor([9, 18]);
  r.setSideColors({ 1: GOLD });
  const gold = r.highlights.lastMoveColor([9, 18]);
  assert.notEqual(def, gold);
  // still neon: the mix toward the grid violet keeps it bright
  const lum = (c) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
  assert.ok(lum(gold) > 150, `bright neon, got #${gold.toString(16)}`);
});
