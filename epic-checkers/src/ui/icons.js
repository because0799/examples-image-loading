// Inline SVG icons (24×24, stroke = currentColor). icon(name) -> <span class="ico">.

const S = (body, { fill = false, sw = 2 } = {}) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="${fill ? 'currentColor' : 'none'}" stroke="${
    fill ? 'none' : 'currentColor'
  }" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  user: S('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'),
  palette: S(
    '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.3"/><circle cx="10.5" cy="7" r="1.3"/><circle cx="15.5" cy="7.5" r="1.3"/>',
  ),
  text: S('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>', { sw: 2.2 }),
  clock: S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  battery: S('<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M22 11v2M6.5 10.5v3M9.5 10.5v3"/>'),
  image: S('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.6"/>'),
  grid: S('<path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>', { sw: 1.8 }),
  move: S('<path d="M5 19L19 5M19 5h-7M19 5v7"/><circle cx="5" cy="19" r="1.6"/>'),
  film: S('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 5v5M12 5v5M17 5v5"/>'),
  reset: S('<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/>', { sw: 2.2 }),
  back: S('<path d="M15 4l-8 8 8 8"/>', { sw: 2.6 }),
  chevron: S('<path d="M9 5l7 7-7 7"/>', { sw: 2.4 }),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>', { sw: 2.6 }),
  menu: S('<path d="M4 7h16M4 12h16M4 17h16"/>', { sw: 2.4 }),
  pause: S('<path d="M8 5v14M16 5v14"/>', { sw: 3 }),
  undo: S('<path d="M9 15L4 10l5-5"/><path d="M4 10h10.5a5.5 5.5 0 0 1 0 11H11"/>', { sw: 2.4 }),
  hint: S(
    '<path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-4 11.6c.7.6 1 1.3 1 2.2V16h6v-.3c0-.9.3-1.6 1-2.2A6.5 6.5 0 0 0 12 2.5z"/>',
    { sw: 2 },
  ),
  settings: S(
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    { sw: 1.8 },
  ),
  rules: S(
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/>',
  ),
  stats: S(
    '<path d="M8 21h8M12 17v4"/><path d="M7 3h10v6a5 5 0 0 1-10 0V3z"/><path d="M7 5H4.5a3 3 0 0 0 3 5M17 5h2.5a3 3 0 0 1-3 5"/>',
  ),
  cpu: S(
    '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  ),
  users: S(
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  ),
  swords: S(
    '<path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5L18 3h3v3l-3.5 3.5"/><path d="M5 14l4 4M7 17l-3 3M3 19l2 2"/>',
  ),
  lock: S('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  check: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>', { sw: 3 }),
  flame: S(
    '<path d="M12 2.5c.8 3.6 5.5 5.9 5.5 11a5.5 5.5 0 0 1-11 0c0-2.6 1.5-4 2.3-6.1 1.3 1 2.1 2.4 2.2 4 1.3-2.4 1.6-5.5 1-8.9z"/>',
    { fill: true },
  ),
  bolt: S('<path d="M13.5 1.5L3.5 13.5h7.5l-1.5 9 10-12.5h-7.5z"/>', { fill: true }),
  crown: S('<path d="M3 8l4.5 4L12 4l4.5 8L21 8l-2 11H5L3 8z"/>', { fill: true }),
  sound: S('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  music: S('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  vibration: S('<rect x="7.5" y="3" width="9" height="18" rx="2"/><path d="M3.5 8v8M20.5 8v8"/>'),
  mic: S('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>'),
  sparkle: S('<path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z"/>', { fill: true }),
  eye: S('<path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  speed: S('<path d="M12.5 19l9-7-9-7v14zM2.5 19l9-7-9-7v14z"/>', { fill: true }),
  globe: S(
    '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.8 3.8 6 3.8 9.5s-1.2 6.7-3.8 9.5c-2.6-2.8-3.8-6-3.8-9.5S9.4 5.3 12 2.5z"/>',
    { sw: 1.8 },
  ),
  flag: S('<path d="M5 22V3.5"/><path d="M5 4h12.5l-2.5 4.5 2.5 4.5H5"/>'),
  handshake: S('<circle cx="12" cy="12" r="9.5"/><path d="M8 10h8M8 14h8"/>'),
  restart: S('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>'),
  home: S('<path d="M3 11l9-8 9 8"/><path d="M5.5 9.5V21h13V9.5"/><path d="M10 21v-6h4v6"/>'),
  play: S('<path d="M7 4.5v15l12.5-7.5z"/>', { fill: true }),
  trash: S('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  info: S('<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5v.5"/>', { sw: 2.2 }),
  target: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" />'),
  piece: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>'),
  skull: S(
    '<path d="M12 2.5a8 8 0 0 0-8 8c0 2.6 1.2 4.4 3 5.6V20h10v-3.9c1.8-1.2 3-3 3-5.6a8 8 0 0 0-8-8z"/><circle cx="9" cy="11" r="1.6" fill="currentColor"/><circle cx="15" cy="11" r="1.6" fill="currentColor"/><path d="M10.5 20v-2.5M13.5 20v-2.5"/>',
  ),
  dice: S(
    '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  ),
};

export function iconSvg(name) {
  return ICONS[name] || '';
}

export function icon(name, cls = '') {
  const el = document.createElement('span');
  el.className = 'ico' + (cls ? ' ' + cls : '');
  el.innerHTML = ICONS[name] || '';
  return el;
}
