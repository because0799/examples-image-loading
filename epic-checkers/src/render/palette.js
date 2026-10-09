// Theme palettes (ART DIRECTION in ARCHITECTURE.md). FX code can read renderer.palette to match.

export const CLASSIC = {
  id: 'classic',
  maple: 0xe8d5b0,
  walnut: 0x6b3f22,
  frame: 0x2a1a10,
  gold: 0xc9a04c,
  goldLight: 0xf3d98a,
  ivory: 0xf4eedd,
  ebony: 0x1e1a1a,
  moveDot: 0x3ddc97,
  capture: 0xff4d4d,
  lastMove: 0xffb547,
  lastMoveAlpha: 0.3,
  hint: 0x38d9ff,
  path: 0xffd27a,
  selectable: 0xfff1c9,
  selected: 0xffcf5a,
  turkishWood: 0xe3c79b,
  turkishLine: 0x3b2414,
  side: { 1: 0xf4eedd, [-1]: 0x1e1a1a },
  /** Accent per side (for FX that want a colour per player in classic mode). */
  accent: { 1: 0xfff4d6, [-1]: 0xc9a04c },
  bg: 0x120a06,
};

export const EPIC = {
  id: 'epic',
  white: 0x29e6ff,
  black: 0xff2e63,
  gold: 0xffd23f,
  ink: 0x000000,
  impact: 0xffffff,
  bgTop: 0x05030c,
  bgBottom: 0x120a2a,
  grid: 0x7a5cff,
  gridHot: 0xb9a6ff,
  obsidian: 0x0b0815,
  slate: 0x1d1733,
  moveDot: 0x3ddc97,
  capture: 0xff3b5c,
  lastMove: 0xffb547,
  lastMoveAlpha: 0.32,
  hint: 0x29e6ff,
  path: 0xffd23f,
  selectable: 0xc8b8ff,
  selected: 0xffd23f,
  side: { 1: 0x29e6ff, [-1]: 0xff2e63 },
  accent: { 1: 0x29e6ff, [-1]: 0xff2e63 },
  bg: 0x05030c,
};

export const PALETTES = { classic: CLASSIC, epic: EPIC };
