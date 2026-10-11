const THEME_STORAGE_KEY = 'ampcoin-theme';
const LEGACY_THEME_STORAGE_KEY = 'ampbet-theme';
export const THEME_CHANGE_EVENT = 'ampcoin:themechange';

export const THEMES = {
  default: {
    id: 'default',
    name: 'Default',
    description: 'Blue + dark blue',
    swatches: ['#4c8dff', '#0d1420', '#e6ad3c']
  },
  mikayla: {
    id: 'mikayla',
    name: 'Mikayla',
    description: 'Pink + purple',
    swatches: ['#e879f9', '#321345', '#ff9bd2']
  },
  'pitch-dark': {
    id: 'pitch-dark',
    name: 'Pitch Dark',
    description: 'Midnight black',
    swatches: ['#c4b5fd', '#09090b', '#f4f4f5']
  },
  verity: {
    id: 'verity',
    name: 'Verity',
    description: 'Yellow + orange',
    swatches: ['#f59e0b', '#2b1d05', '#fbbf24']
  },
  haetae: {
    id: 'haetae',
    name: 'Haetae',
    description: 'Orange + teal + white',
    swatches: ['#f97316', '#0f2e2e', '#14b8a6'],
    dark: true
  },
  // V2: the first light theme, and a high-contrast one.
  aurora: {
    id: 'aurora',
    name: 'Aurora',
    description: 'Light paper + violet',
    swatches: ['#6d4aff', '#ffffff', '#3884ff'],
    dark: false
  },
  inferno: {
    id: 'inferno',
    name: 'Inferno',
    description: 'High contrast + ember',
    swatches: ['#ff4438', '#000000', '#ff9d5c'],
    dark: true
  }
};

export const DEFAULT_THEME = 'default';

function readTheme() {
  try {
    let stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!Object.prototype.hasOwnProperty.call(THEMES, stored)) {
      const legacyStored = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
      if (Object.prototype.hasOwnProperty.call(THEMES, legacyStored)) {
        stored = legacyStored;
        window.localStorage.setItem(THEME_STORAGE_KEY, legacyStored);
      }
    }
    return Object.prototype.hasOwnProperty.call(THEMES, stored) ? stored : DEFAULT_THEME;
  } catch (_) {
    return DEFAULT_THEME;
  }
}

export function getTheme() {
  return THEMES[readTheme()] || THEMES[DEFAULT_THEME];
}

export function listThemes() {
  return Object.values(THEMES);
}

export function nextThemeId(current) {
  const ids = Object.keys(THEMES);
  const i = ids.indexOf(current);
  return ids[(i + 1 + ids.length) % ids.length];
}

export function applyTheme(themeId, persist = true) {
  const id = Object.prototype.hasOwnProperty.call(THEMES, themeId) ? themeId : DEFAULT_THEME;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = id;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      // The browser chrome has to match the ground, or the address bar reads as
      // a separate bar sitting above the page.
      const THEME_COLORS = {
        'pitch-dark': '#030305',
        verity: '#100c04',
        mikayla: '#120817',
        haetae: '#07100f',
        aurora: '#f4f6fb',
        inferno: '#000000'
      };
      metaTheme.setAttribute('content', THEME_COLORS[id] || '#060910');
    }
    // Lets CSS react to a light theme: a few surfaces hardcode a dark scrim or
    // a dark scrollbar thumb and are unreadable on white.
    if (document.documentElement) {
      const isDark = THEMES[id]?.dark !== false;
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    }
  }
  if (persist && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch (_) { /* private browsing can deny storage */ }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: id } }));
  }
  return id;
}

export function initializeTheme() {
  const themeId = applyTheme(readTheme(), false);
  if (typeof window !== 'undefined' && !window.__ampcoinThemeStorageBound) {
    window.__ampcoinThemeStorageBound = true;
    window.addEventListener('storage', (event) => {
      if (event.key === THEME_STORAGE_KEY || event.key === LEGACY_THEME_STORAGE_KEY) {
        applyTheme(readTheme(), false);
      }
    });
  }
  return themeId;
}
