// What iOS draws over the page follows the app's theme. The web view runs under the status bar (contentInset
// "never"), behind a strip in the page colour (native.css), so the bar's text must suit the page: light text on the
// dark theme, dark text on the light one (Capacitor's built-in SystemBars plugin: DARK = light text). And alerts,
// Save to Files and the file picker follow the Appearance setting (FiteeNative.setAppearance), which can pin light or
// dark against the phone's own setting. Both follow html[data-theme] (src/theme.ts sets it; none = follow the phone).
import type { Appearance } from './bridge';
import { native, systemBars } from './bridge';

/** The Appearance setting as the page shows it: html[data-theme], or 'system' without one. */
export function pinnedAppearance(root: HTMLElement = document.documentElement): Appearance {
  const theme = root.dataset.theme;
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

/** Whether the page shows its dark theme. */
export function isDark(root: HTMLElement = document.documentElement, systemDark = matchMedia('(prefers-color-scheme: dark)').matches): boolean {
  const pinned = pinnedAppearance(root);
  return pinned === 'system' ? systemDark : pinned === 'dark';
}

let following = false;

/** Sets the status bar and the Appearance natively now and whenever the theme or the phone's setting changes. */
export function followTheme(): void {
  if (following) return;
  following = true;
  const root = document.documentElement;
  const query = matchMedia('(prefers-color-scheme: dark)');
  let style: 'DARK' | 'LIGHT' | undefined;
  let appearance: Appearance | undefined;
  const update = () => {
    const nextStyle = isDark(root, query.matches) ? 'DARK' : 'LIGHT';
    if (nextStyle !== style) {
      style = nextStyle;
      void systemBars()?.setStyle({ style }).catch(() => undefined);
    }
    const nextAppearance = pinnedAppearance(root);
    if (nextAppearance !== appearance) {
      appearance = nextAppearance;
      void Promise.resolve()
        .then(() => native().setAppearance({ style: nextAppearance }))
        .catch(() => undefined); // a nicety: alerts then follow the phone
    }
  };
  query.addEventListener('change', update);
  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  update();
}
