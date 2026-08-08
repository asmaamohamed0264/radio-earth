const STORAGE_KEY = 'radio.theme';

const listeners = new Set();

let current = 'light';

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function stored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

function apply(theme) {
  current = theme;
  document.documentElement.setAttribute('data-theme', theme);
  for (const listener of listeners) listener(theme);
}

/**
 * Resolve the starting theme: an explicit choice wins, otherwise follow
 * the operating system.
 */
export function initTheme() {
  apply(stored() || (systemPrefersDark() ? 'dark' : 'light'));

  // Track the system only while the user has not chosen for themselves.
  if (window.matchMedia) {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => {
      if (!stored()) apply(e.matches ? 'dark' : 'light');
    };
    if (query.addEventListener) query.addEventListener('change', onChange);
  }

  return current;
}

export function getTheme() {
  return current;
}

export function toggleTheme() {
  const next = current === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Preference just will not survive a reload.
  }
  apply(next);
  return next;
}

/**
 * Called on every theme change, including the initial resolution.
 * Used by the map and globe, which paint colours outside CSS.
 */
export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Read one of the theme's CSS custom properties. Lets canvas and
 * Leaflet share the single source of truth in style.css.
 */
export function themeColor(name, fallback = '#000') {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}
