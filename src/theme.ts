// Light ("Paper") and dark ("Molten") themes. "system" follows the phone's
// setting; light or dark pins one. The choice is a setting on this device
// (localStorage), like the weight unit. CSS reads `html[data-theme]`; with
// no attribute it follows `prefers-color-scheme`.

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'formcheck.v1.theme';
/** Browser bar colour per theme: the page background. */
export const THEME_COLOR: Record<Theme, string> = { light: '#F4ECE2', dark: '#141518' };

export function loadTheme(): ThemePref {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const darkQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

/** The theme actually shown for a preference. */
export function resolveTheme(pref: ThemePref, systemDark = darkQuery()?.matches ?? false): Theme {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

/**
 * Sets the attribute CSS reads, and the browser bar colour: index.html has
 * one theme-color meta per colour scheme; a pinned theme sets both.
 */
export function applyTheme(pref: ThemePref = loadTheme()): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][media]')) {
    const scheme: Theme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = THEME_COLOR[pref === 'system' ? scheme : pref];
  }
}

export function saveTheme(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(pref));
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
  applyTheme(pref);
}
