// «Валькирии доски» — inline SVG icons (24×24): the 8 elements (GDD §5 icon briefs), the 6 roles and
// mode glyphs. Everything else reuses src/ui/icons.js. rvIcon(name) -> <span class="ico rv-ico">.

import { ICONS } from '../../ui/icons.js';

const S = (body, { fill = false, sw = 1.9 } = {}) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="${fill ? 'currentColor' : 'none'}" stroke="${
    fill ? 'none' : 'currentColor'
  }" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Element icons — filled glyphs, drawn in currentColor. */
export const ELEMENT_ICONS = {
  // flame-shaped feather inside a rhombus
  flame: S(
    '<path d="M12 1.8l10.2 10.2L12 22.2 1.8 12z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12.3 5.6c.5 2.4 3.6 3.9 3.6 7.3a3.9 3.9 0 0 1-7.8 0c0-1.8 1-2.8 1.6-4.2.9.7 1.4 1.7 1.5 2.8.9-1.7 1.4-3.6 1.1-5.9z" fill="currentColor" stroke="none"/>',
  ),
  // droplet with a wave inside
  tide: S(
    '<path d="M12 2.6c3.9 4.9 6.6 8.3 6.6 12a6.6 6.6 0 0 1-13.2 0c0-3.7 2.7-7.1 6.6-12z" fill="currentColor" stroke="none"/><path d="M7.6 15.2c1.4-1.1 2.9-1.1 4.4 0s3 1.1 4.4 0" stroke="#0b1430" stroke-width="1.7" fill="none"/>',
  ),
  // six-pointed crystal snowflake
  frost: S(
    '<path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10"/><path d="M9.6 3.8L12 6.2l2.4-2.4M9.6 20.2L12 17.8l2.4 2.4M4.1 10.4l3.3-.9-.9-3.3M19.9 13.6l-3.3.9.9 3.3M4.1 13.6l3.3.9-.9 3.3M19.9 10.4l-3.3-.9.9-3.3"/>',
    { sw: 1.7 },
  ),
  // jagged bolt in a circle
  storm: S(
    '<circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13.4 4.6L7.6 13h4l-1.2 6.4 6-8.6h-4.1z" fill="currentColor" stroke="none"/>',
  ),
  // spiral of three feathers
  gale: S(
    '<path d="M12 12c0-3.6 2.4-6.6 6.4-7.2-1.3 2.4-1.8 4.6-1.4 7.2" /><path d="M12 12c3.1 1.8 4.5 5.4 3 9.1-1.4-2.3-3.1-3.9-5.6-4.8"/><path d="M12 12c-3.1 1.8-6.9 1.2-9.4-1.9 2.7 0 4.9-.6 7-2.4"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    { sw: 1.8 },
  ),
  // hexagonal amber crystal
  terra: S(
    '<path d="M12 2.2l8.5 4.9v9.8L12 21.8l-8.5-4.9V7.1z" fill="currentColor" stroke="none" opacity=".9"/><path d="M12 2.2v19.6M3.5 7.1l8.5 4.9 8.5-4.9" stroke="#2a1806" stroke-width="1.3" fill="none" opacity=".55"/>',
  ),
  // eight-pointed star with a halo
  radiance: S(
    '<circle cx="12" cy="12" r="9.8" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".75"/><path d="M12 3.2l1.6 5.3 4.6-2.9-2.9 4.6 5.3 1.8-5.3 1.6 2.9 4.6-4.6-2.9L12 20.8l-1.6-5.5-4.6 2.9 2.9-4.6L3.2 12l5.5-1.8-2.9-4.6 4.6 2.9z" fill="currentColor" stroke="none"/>',
  ),
  // crescent swallowing a star
  umbra: S(
    '<path d="M15.8 3.4A9 9 0 1 0 20.6 15 7.2 7.2 0 1 1 15.8 3.4z" fill="currentColor" stroke="none"/><path d="M17.6 7.4l.7 1.6 1.7.2-1.3 1.1.4 1.7-1.5-.9-1.5.9.4-1.7-1.3-1.1 1.7-.2z" fill="currentColor" stroke="none"/>',
  ),
};

/** Role icons (stroke). */
export const ROLE_ICONS = {
  guardian: S('<path d="M12 2.5l8 3v6.2c0 4.7-3.3 8.4-8 9.8-4.7-1.4-8-5.1-8-9.8V5.5z"/><path d="M12 6.5v11M7.5 10.5h9"/>'),
  blade: S('<path d="M14.5 3.5L20.5 3.5 20.5 9.5 9 21 3 15z" /><path d="M6.5 12.5l5 5M3.5 20.5l2-2"/>'),
  ranger: S('<path d="M5 3c6 2.5 9.5 7 9.5 13.5"/><path d="M5 3l-.5 16"/><path d="M4.5 19C11 19 16 16.5 18.5 12"/><path d="M8 12l12-7.5M20 4.5l-1.2 3.3M20 4.5l-3.4.7"/>'),
  mystic: S('<circle cx="12" cy="10" r="6.3"/><path d="M9.2 8.2a3.2 3.2 0 0 1 3-1.8"/><path d="M7 19.5h10M9 16.5l-1 3M15 16.5l1 3"/>'),
  oracle: S('<path d="M12 21V8"/><circle cx="12" cy="5.5" r="2.6"/><path d="M7.5 9c1.4 1.6 3 2.3 4.5 2.3S15.1 10.6 16.5 9"/><path d="M9 21h6"/>'),
  shadow: S('<path d="M19.5 4.5L9.5 14.5"/><path d="M19.5 4.5l-1.2 5.3-6 6-2.8-2.8 6-6z"/><path d="M8 13l3 3M8.8 15.2l-4.3 4.3"/>'),
};

/** Mode glyphs. */
export const RV_ICONS = {
  crystal: S('<path d="M12 2.5l6.5 7-6.5 12-6.5-12z" fill="currentColor" stroke="none"/><path d="M5.5 9.5h13M12 2.5l-2.4 7L12 21.5l2.4-12z" stroke="#0b0820" stroke-width="1.1" fill="none" opacity=".45"/>'),
  dust: S('<path d="M8 4.5l1.2 3.1 3.1 1.2-3.1 1.2L8 13.1l-1.2-3.1-3.1-1.2 3.1-1.2z" fill="currentColor" stroke="none"/><path d="M16.5 11l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" fill="currentColor" stroke="none"/><circle cx="9.5" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="17.5" cy="5.5" r="1" fill="currentColor" stroke="none"/>'),
  scroll: S('<path d="M7 4h11a2 2 0 0 1 2 2v1h-4"/><path d="M16 7v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h10"/><path d="M7 4a2 2 0 0 0-2 2v11M9 9h4M9 12.5h4"/>'),
  star: S('<path d="M12 2.6l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="currentColor" stroke="none"/>'),
  starOutline: S('<path d="M12 2.6l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/>', { sw: 1.6 }),
  summon: S('<circle cx="12" cy="11" r="6.5"/><path d="M12 6.5l1.3 3.2 3.2 1.3-3.2 1.3L12 15.5l-1.3-3.2-3.2-1.3 3.2-1.3z" fill="currentColor" stroke="none"/><path d="M6 20.5h12M8.5 17.5l-1 3M15.5 17.5l1 3"/>'),
  campaign: S('<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  collection: S('<rect x="3.5" y="5" width="11" height="15" rx="2"/><path d="M8 3h10.5a2 2 0 0 1 2 2v12.5"/><path d="M6.5 15.5l2.5-4 2 2.5 1-1.5 1.5 3"/>'),
  squad: ICONS.users,
  training: ICONS.target,
  duel: ICONS.swords,
  energy: S('<path d="M13.5 1.5L3.5 13.5h7.5l-1.5 9 10-12.5h-7.5z" fill="currentColor" stroke="none"/>'),
  cooldown: S('<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>'),
  move: S('<path d="M12 3v18M3 12h18"/><path d="M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>'),
  attack: S('<path d="M14.5 3.5h6v6L9 21l-6-6z"/><path d="M6.5 12.5l5 5"/>'),
  skill: S('<path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z" fill="currentColor" stroke="none"/><path d="M19 17l.8 2.2 2.2.8-2.2.8L19 23l-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor" stroke="none"/>'),
  ult: S('<path d="M13.5 1.5L3.5 13.5h7.5l-1.5 9 10-12.5h-7.5z" fill="currentColor" stroke="none"/>'),
  wait: S('<path d="M12 2.5l8 3v6.2c0 4.7-3.3 8.4-8 9.8-4.7-1.4-8-5.1-8-9.8V5.5z"/><path d="M12 7.5v5l3 2"/>'),
  end: ICONS.check,
  quirk: S('<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3.5 2"/><path d="M17 3l4 0 0 4"/>'),
  heart: S('<path d="M12 20.5s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8c0 6.2-8 11-8 11z" fill="currentColor" stroke="none"/>'),
  shieldFill: S('<path d="M12 2.5l8 3v6.2c0 4.7-3.3 8.4-8 9.8-4.7-1.4-8-5.1-8-9.8V5.5z" fill="currentColor" stroke="none"/>'),
  auto: S('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4.5h-4.5"/><path d="M9.5 9l5 3-5 3z" fill="currentColor" stroke="none"/>'),
  voice: ICONS.sound,
  exit: S('<path d="M9.5 20.5H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h4.5"/><path d="M15 16.5l4.5-4.5L15 7.5M19.5 12H9"/>'),
  stairs: S('<path d="M3 20h5v-5h5v-5h5V5h3"/>'),
  sword: S('<path d="M14.5 3.5h6v6L9 21l-6-6z"/>'),
};

const ALL = { ...ICONS, ...RV_ICONS };

export function rvSvg(name) {
  return ELEMENT_ICONS[name] || ROLE_ICONS[name] || ALL[name] || '';
}

export function rvIcon(name, cls = '') {
  const el = document.createElement('span');
  el.className = 'ico rv-ico' + (cls ? ' ' + cls : '');
  el.innerHTML = rvSvg(name);
  return el;
}

/** Status glyphs (kanji) used in the compact battle chips; names come from rules.js STATUSES. */
export const STATUS_GLYPHS = {
  burn: '燃',
  frozen: '凍',
  stun: '暈',
  root: '縛',
  slow: '遅',
  silence: '黙',
  taunt: '挑',
  mark: '印',
  brittle: '脆',
  weaken: '弱',
  blight: '蝕',
  inspire: '鼓',
  brace: '構',
  regen: '癒',
  shield: '盾',
  untargetable: '隠',
  charge: '電',
  crown: '冠',
  stagger: '揺',
  break: '砕',
};
