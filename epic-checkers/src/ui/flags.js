// Crisp SVG flags for the variant cards (consistent on every device, no emoji font needed).
// flagEl(variant.flag) understands emoji flags ('🇷🇺') and the globe '🌍'; unknown flags fall back
// to the emoji text itself.

function star(cx, cy, r, rot = -90) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.4 : r;
    const a = ((rot + i * 36) * Math.PI) / 180;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
}

const LEAF = [
  [0, -4.6], [0.9, -2.8], [1.9, -3.2], [1.5, -0.9], [3.2, -2.3], [2.9, -1.3], [4.2, -1.1], [3.4, 0.1],
  [3.9, 0.6], [1.3, 1.9], [1.6, 2.6], [0.25, 2.4], [0.25, 4.3], [-0.25, 4.3], [-0.25, 2.4], [-1.6, 2.6],
  [-1.3, 1.9], [-3.9, 0.6], [-3.4, 0.1], [-4.2, -1.1], [-2.9, -1.3], [-3.2, -2.3], [-1.5, -0.9],
  [-1.9, -3.2], [-0.9, -2.8],
]
  .map(([x, y]) => `${(15 + x * 1.35).toFixed(2)},${(10 + y * 1.35).toFixed(2)}`)
  .join(' ');

const hstripes = (colors, weights = colors.map(() => 1)) => {
  const total = weights.reduce((a, b) => a + b, 0);
  let y = 0;
  return colors
    .map((c, i) => {
      const hgt = (20 * weights[i]) / total;
      const r = `<rect x="0" y="${y.toFixed(2)}" width="30" height="${(hgt + 0.05).toFixed(2)}" fill="${c}"/>`;
      y += hgt;
      return r;
    })
    .join('');
};

const usStripes = () => {
  let s = '';
  for (let i = 0; i < 13; i++) s += `<rect x="0" y="${((20 / 13) * i).toFixed(2)}" width="30" height="${(20 / 13 + 0.05).toFixed(2)}" fill="${i % 2 ? '#fff' : '#B22234'}"/>`;
  s += '<rect x="0" y="0" width="13" height="10.77" fill="#3C3B6E"/>';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) s += `<circle cx="${1.5 + c * 2.5 + (r % 2) * 1.2}" cy="${1.5 + r * 2.6}" r="0.55" fill="#fff"/>`;
  return s;
};

const FLAGS = {
  RU: hstripes(['#FFFFFF', '#0039A6', '#D52B1E']),
  TR: `<rect width="30" height="20" fill="#E30A17"/><circle cx="11.5" cy="10" r="5" fill="#fff"/><circle cx="12.75" cy="10" r="4" fill="#E30A17"/><g fill="#fff">${star(18.2, 10, 2.5, 180)}</g>`,
  WORLD: `<rect width="30" height="20" fill="#0B2A6F"/><circle cx="15" cy="10" r="7.6" fill="#2F7DE1"/><path d="M11.6 5.2c1.6-.4 2.6.6 2.2 1.9-.4 1.1-1.9 1-2.1 2.4-.2 1.3 1.3 1.6 1.1 3-.1 1.2-1.3 2-2.4 1.7-1.3-1.2-2-2.9-2-4.7 0-1.7 1.3-3.6 3.2-4.3zM17.4 4.1c1.9.7 3.4 2.2 4.2 4-.9.6-2.1.1-2.6 1-.6 1 .7 2 .1 3.2-.5 1-1.8 1.2-2.4 2.3-.4.7-.2 1.6-.7 2.1-.8.1-1.4-.6-1.2-1.4.3-1.2 1.3-2 1-3.3-.3-1.2-1.8-1.4-1.9-2.7-.1-1.6 1.6-2.1 2.4-3.1.4-.6.5-1.4 1.1-2.1z" fill="#3DDC97"/><circle cx="15" cy="10" r="7.6" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".6"/><ellipse cx="15" cy="10" rx="3.2" ry="7.6" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".5"/><path d="M7.4 10h15.2" stroke="#fff" stroke-opacity=".35" stroke-width=".5"/>`,
  GB: `<rect width="30" height="20" fill="#012169"/><path d="M0 0L30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0L30 20M30 0L0 20" stroke="#C8102E" stroke-width="1.4"/><path d="M15 0v20M0 10h30" stroke="#fff" stroke-width="6"/><path d="M15 0v20M0 10h30" stroke="#C8102E" stroke-width="3.4"/>`,
  BR: `<rect width="30" height="20" fill="#009C3B"/><polygon points="15,2.2 27.6,10 15,17.8 2.4,10" fill="#FFDF00"/><circle cx="15" cy="10" r="4.6" fill="#002776"/><path d="M10.6 9.1c3-.9 6.2-.5 8.8 1.1" stroke="#fff" stroke-width=".9" fill="none"/>`,
  US: usStripes(),
  IT: `<rect width="10" height="20" fill="#009246"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#CE2B37"/>`,
  CA: `<rect width="30" height="20" fill="#fff"/><rect width="7.5" height="20" fill="#D52B1E"/><rect x="22.5" width="7.5" height="20" fill="#D52B1E"/><polygon points="${LEAF}" fill="#D52B1E"/>`,
  AM: hstripes(['#D90012', '#0033A0', '#F2A800']),
  ES: hstripes(['#AA151B', '#F1BF00', '#AA151B'], [1, 2, 1]),
  CZ: `<rect width="30" height="10" fill="#fff"/><rect y="10" width="30" height="10" fill="#D7141A"/><polygon points="0,0 15,10 0,20" fill="#11457E"/>`,
  TH: hstripes(['#A51931', '#F4F5F8', '#2D2A4A', '#F4F5F8', '#A51931'], [1, 1, 2, 1, 1]),
  DE: hstripes(['#000000', '#DD0000', '#FFCE00']),
  FR: `<rect width="10" height="20" fill="#0055A4"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#EF4135"/>`,
  NL: hstripes(['#AE1C28', '#FFFFFF', '#21468B']),
  UA: hstripes(['#0057B7', '#FFD700']),
  PT: `<rect width="12" height="20" fill="#046A38"/><rect x="12" width="18" height="20" fill="#DA291C"/><circle cx="12" cy="10" r="3.6" fill="#FFE900"/>`,
};

/** '🇷🇺' -> 'RU', '🌍' / '🌎' / '🌏' -> 'WORLD', otherwise null. */
export function flagCode(flag) {
  if (!flag) return null;
  const cps = Array.from(flag).map((c) => c.codePointAt(0));
  if (cps.length === 1 && cps[0] >= 0x1f30d && cps[0] <= 0x1f310) return 'WORLD';
  if (cps.length === 2 && cps.every((c) => c >= 0x1f1e6 && c <= 0x1f1ff)) {
    return cps.map((c) => String.fromCharCode(c - 0x1f1e6 + 65)).join('');
  }
  return null;
}

export function flagEl(flag, cls = '') {
  const el = document.createElement('span');
  el.className = 'flag' + (cls ? ' ' + cls : '');
  const code = flagCode(flag);
  const body = code && FLAGS[code === 'UK' ? 'GB' : code];
  if (body) {
    el.innerHTML = `<svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${body}</svg>`;
  } else {
    el.classList.add('flag--emoji');
    el.textContent = flag || '♟';
  }
  return el;
}
