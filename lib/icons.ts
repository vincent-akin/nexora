/**
 * Playful inline SVG icons, shared by the React app and the standalone
 * prototype (the build script inlines this file). Trusted static strings only.
 */
const S = 'stroke-linecap="round" stroke-linejoin="round"';

export const ICON_PATHS: Record<string, string> = {
  coin:
    `<circle cx="12" cy="12" r="10" fill="#FFD23F" stroke="#E09A00" stroke-width="2"/>` +
    `<circle cx="12" cy="12" r="6.4" fill="none" stroke="#E09A00" stroke-width="1.6"/>` +
    `<path d="M9.5 8.2c1-.9 2.4-1.2 3.6-.6" fill="none" stroke="#FFF3B0" stroke-width="1.6" ${S}/>`,
  star:
    `<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" fill="#7CF0FF" stroke="#12B5D9" stroke-width="1.8" ${S}/>` +
    `<path d="M10.2 8.6l1.2-2.4" fill="none" stroke="#fff" stroke-width="1.6" ${S}/>`,
  gem:
    `<path d="M6 3h12l4 6-10 12L2 9z" fill="#FF7AB8" stroke="#E0287E" stroke-width="1.8" ${S}/>` +
    `<path d="M2 9h20M9 3L7 9l5 12M15 3l2 6-5 12" fill="none" stroke="#FFD1E6" stroke-width="1.2" ${S}/>`,
  bolt: `<path d="M13.500 2L4 14h6l-1.200 8L19 10h-6.200z" fill="#FFD23F" stroke="#F08A00" stroke-width="1.8" ${S}/>`,
  heart:
    `<path d="M12 21s-7.500-4.600-9.600-9.200C.9 8.400 3 5 6.400 5c2 0 3.600 1.100 5.600 3.200C14 6.100 15.600 5 17.600 5 21 5 23.100 8.400 21.600 11.800 19.500 16.400 12 21 12 21z" fill="#FF4D6D" stroke="#C9184A" stroke-width="1.8" ${S}/>` +
    `<path d="M6.500 8.500c.6-.8 1.500-1.200 2.400-1" fill="none" stroke="#FFB3C1" stroke-width="1.6" ${S}/>`,
  gift:
    `<rect x="3" y="10" width="18" height="11" rx="2" fill="#FF4D9D" stroke="#C0176F" stroke-width="1.8"/>` +
    `<rect x="2" y="6.500" width="20" height="4.500" rx="1.500" fill="#FF7AB8" stroke="#C0176F" stroke-width="1.8"/>` +
    `<path d="M12 6.500V21" stroke="#FFE066" stroke-width="3" ${S}/>` +
    `<path d="M12 6.500C10 2.500 6 3.500 7.200 5.800 8.200 7.200 12 6.500 12 6.500zm0 0c2-4 6-3 4.800-.7C15.800 7.200 12 6.500 12 6.500z" fill="#FFE066" stroke="#E09A00" stroke-width="1.4" ${S}/>`,
  trophy:
    `<path d="M7 3h10v5.500a5 5 0 0 1-10 0z" fill="#FFD23F" stroke="#E09A00" stroke-width="1.8" ${S}/>` +
    `<path d="M7 5H3.500c0 4 1.800 6 3.800 6.200M17 5h3.500c0 4-1.800 6-3.800 6.200" fill="none" stroke="#E09A00" stroke-width="1.8" ${S}/>` +
    `<rect x="10" y="13.500" width="4" height="4" fill="#FFB02E" stroke="#E09A00" stroke-width="1.4"/>` +
    `<rect x="7" y="17.500" width="10" height="3.500" rx="1.200" fill="#FFD23F" stroke="#E09A00" stroke-width="1.8"/>`,
  play: `<path d="M8 4.500l12 7.500-12 7.500z" fill="#B6F23A" stroke="#6FA800" stroke-width="2" ${S}/>`,
  note:
    `<path d="M9 17.500V5.500l11-2.200v12" fill="none" stroke="#fff" stroke-width="2.200" ${S}/>` +
    `<circle cx="6.500" cy="17.500" r="3" fill="#fff"/><circle cx="17.500" cy="15.500" r="3" fill="#fff"/>`,
  flame:
    `<path d="M12 2c1 4 5 5.500 5 10.200A5 5 0 0 1 7 12.200c0-2 1-3.200 2.200-4.200 0 2 1 3 2 3C11 7 10 5 12 2z" fill="#FF8A2B" stroke="#E5500F" stroke-width="1.6" ${S}/>` +
    `<path d="M12 12.500c1.500 1.300 2.200 2 2.200 3.200a2.200 2.200 0 0 1-4.400 0c0-.8.500-1.600 1.200-2.200.2.600.6 1 1 1z" fill="#FFD23F"/>`,
  house:
    `<path d="M3 11.500L12 4l9 7.500V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="#7CF0FF" stroke="#12B5D9" stroke-width="1.8" ${S}/>`,
  target:
    `<circle cx="12" cy="12" r="9.500" fill="#fff" stroke="#E0287E" stroke-width="1.8"/>` +
    `<circle cx="12" cy="12" r="6" fill="#FF7AB8" stroke="#E0287E" stroke-width="1.4"/>` +
    `<circle cx="12" cy="12" r="2.500" fill="#E0287E"/>`,
  users:
    `<circle cx="9" cy="8" r="3.500" fill="#B6F23A" stroke="#6FA800" stroke-width="1.8"/>` +
    `<path d="M2.500 20c0-3.600 2.900-6 6.500-6s6.500 2.400 6.500 6z" fill="#B6F23A" stroke="#6FA800" stroke-width="1.8" ${S}/>` +
    `<circle cx="17" cy="9" r="2.800" fill="#D4FF6B" stroke="#6FA800" stroke-width="1.6"/>` +
    `<path d="M16 14.200c3.200-.3 5.500 1.600 5.500 4.800H17" fill="#D4FF6B" stroke="#6FA800" stroke-width="1.6" ${S}/>`,
  shield:
    `<path d="M12 2.500l8 3v6.200c0 4.800-3.300 8.600-8 9.800-4.700-1.200-8-5-8-9.800V5.500z" fill="#B28CFF" stroke="#7A3FE0" stroke-width="1.8" ${S}/>` +
    `<path d="M8.500 12l2.600 2.600L16 9.500" fill="none" stroke="#fff" stroke-width="2" ${S}/>`,
  key:
    `<circle cx="7.500" cy="12" r="5" fill="#F2C14E" stroke="#9A6F12" stroke-width="1.800"/>` +
    `<circle cx="7.500" cy="12" r="1.700" fill="#9A6F12"/>` +
    `<path d="M12.500 12H22.500M18.500 12v4M21.500 12v3" fill="none" stroke="#9A6F12" stroke-width="2.400" ${S}/>`,
  sparkle:
    `<path d="M12 2l2.200 7.800L22 12l-7.800 2.200L12 22l-2.200-7.800L2 12l7.800-2.200z" fill="#FFF3B0" stroke="#FFD23F" stroke-width="1.4" ${S}/>`,
};

export function icon(name: string, size = 20): string {
  const body = ICON_PATHS[name] ?? '';
  return `<svg class="ic ic-${name}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** The Nexora mascot: a bouncy note-blob. Eyes carry the "eye" class so CSS can make them blink. */
export const MASCOT_SVG =
  `<svg class="mascot" viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
  `<defs><linearGradient id="mascot-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF9CCB"/><stop offset="1" stop-color="#FF4D9D"/></linearGradient></defs>` +
  `<path d="M50 27C50 15 58 10 67 12" fill="none" stroke="#2A0B5E" stroke-width="4" stroke-linecap="round"/>` +
  `<circle cx="69" cy="12" r="6.500" fill="#FFD23F" stroke="#2A0B5E" stroke-width="3"/>` +
  `<rect x="13" y="26" width="74" height="64" rx="31" fill="url(#mascot-body)" stroke="#2A0B5E" stroke-width="4"/>` +
  `<path d="M26 38c4-5 11-7 17-6" fill="none" stroke="#FFE0EF" stroke-width="4" stroke-linecap="round" opacity=".8"/>` +
  `<g class="eye"><ellipse cx="37" cy="54" rx="9" ry="11" fill="#fff" stroke="#2A0B5E" stroke-width="3"/><circle cx="39" cy="56" r="4.500" fill="#2A0B5E"/></g>` +
  `<g class="eye"><ellipse cx="63" cy="54" rx="9" ry="11" fill="#fff" stroke="#2A0B5E" stroke-width="3"/><circle cx="65" cy="56" r="4.500" fill="#2A0B5E"/></g>` +
  `<path d="M41 71Q50 84 59 71Z" fill="#7A0F44" stroke="#2A0B5E" stroke-width="3" stroke-linejoin="round"/>` +
  `<circle cx="25" cy="69" r="5" fill="#FFB3D4"/><circle cx="75" cy="69" r="5" fill="#FFB3D4"/>` +
  `</svg>`;

/** Refined single-colour line icons for the platform shell (they inherit the text colour). */
export const LINE_PATHS: Record<string, string> = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  gamepad: '<path d="M6 8.500h12a4 4 0 0 1 4 4v1.500a3 3 0 0 1-5.400 1.800L15 14H9l-1.600 1.800A3 3 0 0 1 2 14v-1.500a4 4 0 0 1 4-4z"/><path d="M8 11v3M6.500 12.500h3"/><path d="M16 11.500h.01M18.500 13.500h.01"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.200"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4"/><path d="M12 13v4M8 21h8M10 17h4"/>',
  users: '<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20c0-3.500 3-6 6.500-6s6.500 2.500 6.500 6"/><path d="M16 4.800a3.500 3.500 0 0 1 0 6.400M18 14.500c2.200.8 3.500 2.800 3.500 5.500"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  shield: '<path d="M12 3l8 3v6c0 4.500-3.200 8-8 9-4.800-1-8-4.500-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  logout: '<path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gift: '<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M12 9v12M3 13.500h18"/><path d="M12 9C10 4.500 6 5 7 7.500 8 9 12 9 12 9zm0 0c2-4.500 6-4 5-1.500C16 9 12 9 12 9z"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6.500" cy="18" r="2.500"/><circle cx="17.500" cy="16" r="2.500"/>',
  cards: '<rect x="3" y="5" width="11" height="15" rx="2"/><path d="M17 8l3.500 1-3 11-3.500-1"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.500 14h9"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 15l3-4 3 2 5-6"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  speaker: '<path d="M4 10v4h4l5 4V6l-5 4z"/><path d="M16 9.500a4 4 0 0 1 0 5M18.500 7a7.500 7.500 0 0 1 0 10"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.200 0 1.800-.8 1.800-1.700 0-.500-.200-.900-.500-1.300-.300-.400-.500-.800-.500-1.300 0-1 .800-1.700 1.800-1.700H17a4 4 0 0 0 4-4C21 6.500 17 3 12 3z"/><circle cx="7.500" cy="11" r="1"/><circle cx="10" cy="7.500" r="1"/><circle cx="14.500" cy="7.500" r="1"/>',
};

export function lineIcon(name: string, size = 18): string {
  const body = LINE_PATHS[name] ?? '';
  return `<svg class="li li-${name}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** The Card Clash emblem: a vault door. The wheel carries class "wheel" so CSS can turn it. */
export const VAULT_DOOR_SVG =
  `<svg class="vdoor" viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
  `<defs><radialGradient id="vd-face" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#1B7686"/><stop offset="1" stop-color="#072A33"/></radialGradient>` +
  `<linearGradient id="vd-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE08A"/><stop offset="1" stop-color="#B98418"/></linearGradient></defs>` +
  `<circle cx="50" cy="50" r="46" fill="url(#vd-gold)"/><circle cx="50" cy="50" r="40" fill="url(#vd-face)" stroke="#7A5A12" stroke-width="2"/>` +
  `<g fill="#F2C14E" stroke="#7A5A12" stroke-width="1.200"><circle cx="50" cy="14" r="2.600"/><circle cx="86" cy="50" r="2.600"/><circle cx="50" cy="86" r="2.600"/><circle cx="14" cy="50" r="2.600"/></g>` +
  `<g class="wheel"><circle cx="50" cy="50" r="19" fill="none" stroke="url(#vd-gold)" stroke-width="4"/>` +
  `<path d="M50 24v14M50 62v14M24 50h14M62 50h14M32 32l10 10M58 58l10 10M68 32L58 42M42 58L32 68" stroke="url(#vd-gold)" stroke-width="4" stroke-linecap="round"/>` +
  `<circle cx="50" cy="50" r="7" fill="#F2C14E" stroke="#7A5A12" stroke-width="2"/></g></svg>`;
