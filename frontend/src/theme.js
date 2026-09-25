const THEME_STORAGE_KEY = 'ampbet-theme';
export const THEME_CHANGE_EVENT = 'ampbet:themechange';

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
  }
};

export const DEFAULT_THEME = 'default';

function readTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return Object.prototype.hasOwnProperty.call(THEMES, stored) ? stored : DEFAULT_THEME;
  } catch (_) {
    return DEFAULT_THEME;
  }
}

export function getTheme() {
  return THEMES[readTheme()] || THEMES[DEFAULT_THEME];
}

export function applyTheme(themeId, persist = true) {
  const id = Object.prototype.hasOwnProperty.call(THEMES, themeId) ? themeId : DEFAULT_THEME;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = id;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', id === 'pitch-dark' ? '#030305' : id === 'verity' ? '#100c04' : id === 'mikayla' ? '#120817' : '#060910');
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
  if (typeof window !== 'undefined' && !window.__ampbetThemeStorageBound) {
    window.__ampbetThemeStorageBound = true;
    window.addEventListener('storage', (event) => {
      if (event.key === THEME_STORAGE_KEY) applyTheme(readTheme(), false);
    });
  }
  return themeId;
}
