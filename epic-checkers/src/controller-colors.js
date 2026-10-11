// Epic energy colours of the two sides from settings.playerColor (settings contract).
//
//   sideColors({ playerColor, mode, humanColor }) -> { 1: 0xRRGGBB, '-1': 0xRRGGBB } | null
//
// The player's side gets the chosen colour (in two-player and AI-vs-AI games: WHITE). The other
// side keeps its default (WHITE cyan, BLACK crimson) unless that is too close to the chosen one
// (pink / orange next to crimson, cyan next to cyan, or generally hues < 30° apart): then it
// switches to the other default (crimson ↔ cyan). 'auto' (or unknown) → null = renderer defaults.

export const ENERGY_COLORS = Object.freeze({
  cyan: 0x29e6ff,
  gold: 0xffd23f,
  green: 0x3dff8f,
  violet: 0xa06cff,
  orange: 0xff8a2a,
  pink: 0xff4fd8,
});

export const DEFAULT_SIDE_COLORS = Object.freeze({ 1: 0x29e6ff, '-1': 0xff2e63 });
const CYAN = 0x29e6ff;
const CRIMSON = 0xff2e63;

/** Pairs the contract names as too close, whatever their hue distance. */
const CLOSE = { [CRIMSON]: ['pink', 'orange'], [CYAN]: ['cyan'] };

/** Hue (degrees) of a 0xRRGGBB colour. */
export function hue(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

export function hueDistance(a, b) {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/** Which side the player's colour goes to: the human in a game vs the AI, else WHITE. */
export function playerSide(mode, humanColor) {
  return mode === 'ai' && humanColor === -1 ? -1 : 1;
}

export function sideColors({ playerColor = 'auto', mode = 'ai', humanColor = 1 } = {}) {
  const mine = ENERGY_COLORS[playerColor];
  if (mine == null) return null;
  const me = playerSide(mode, humanColor);
  let other = DEFAULT_SIDE_COLORS[-me];
  const close = (CLOSE[other] || []).includes(playerColor) || hueDistance(mine, other) < 30;
  if (close) other = other === CRIMSON ? CYAN : CRIMSON;
  return { [me]: mine, [-me]: other };
}

/** '#29E6FF' for a 0xRRGGBB number (logs, CSS). */
export function hexString(n) {
  return `#${(n >>> 0).toString(16).padStart(6, '0').toUpperCase()}`;
}
