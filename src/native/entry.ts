// The iPhone app's entry: the native index.html loads it instead of src/main.tsx (nativeIndexHtml in
// scripts/native-build.ts). Before the app starts it asks the native side for its facts and puts back the copy of the
// log if WebKit's storage lost it (src/native/snapshot.ts); then it starts copying every change and loads src/main.tsx,
// which renders the app as in a browser. If the copy can't be read, the app doesn't start: starting empty could later
// write over a good copy.
import '../privacy'; // first, as in main.tsx: blocks any request that would leave the device
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '../style.css'; // so the start-error screen is styled (main imports the same CSS)
import './native.css';
import { applyTheme } from '../theme';
import { showToast } from '../ui/toast';
import { native, type AppInfo } from './bridge';
import { DELETED_TOAST, takeDeletedFlag } from './data';
import { restoreBeforeStart, startWriter, type StartResult } from './snapshot';
import { followTheme } from './statusBar';

/**
 * Resolves once the app's first render has run its effects, so ToastHost (src/ui/toast.tsx) is listening: Preact
 * runs effects after the next frame (or 35 ms without one), so this waits two frames, or 100 ms if frames don't come.
 */
function afterFirstRender(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      setTimeout(resolve, 0);
    };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 100);
  });
}

/** Plain DOM (the app never renders): the bridge is missing, or the copy of the data couldn't be read. */
function showStartError(): void {
  applyTheme();
  const main = document.createElement('main');
  const title = document.createElement('h1');
  title.textContent = 'fitee couldn’t open your data';
  const text = document.createElement('p');
  text.textContent =
    'It keeps a copy of your data on this iPhone and couldn’t read it just now, so it hasn’t started: starting without it could replace your data. Try again; if this keeps happening, restart your iPhone.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'big';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => location.reload());
  main.append(title, text, retry);
  document.getElementById('app')?.replaceChildren(main);
}

async function start(): Promise<void> {
  const root = document.documentElement;
  root.classList.add('native');
  const strip = document.createElement('div');
  strip.className = 'status-strip';
  strip.setAttribute('aria-hidden', 'true');
  document.body.prepend(strip);
  const deleted = takeDeletedFlag();

  let info: AppInfo;
  let restored: StartResult;
  try {
    info = await native().appInfo();
    restored = await restoreBeforeStart(native(), localStorage);
  } catch {
    return showStartError();
  }
  root.dataset.appVersion = `${info.version} (${info.build})`;
  if (info.debug) (await import('./ready')).watch(); // before the app, to catch its start-up errors
  startWriter(native(), restored); // from here on every change of the user's data is copied
  applyTheme(); // the theme as restored, so the status bar starts right (main applies it again)
  followTheme();
  await import('../main'); // renders the app (Preact's render is synchronous; its effects run after a frame)
  await afterFirstRender();
  const toast = deleted ? DELETED_TOAST : restored.toast;
  if (toast) showToast(toast);
  if (info.debug) void import('./ready').then((m) => m.report(info));
  if (info.selfTest) void import('./selftest').then((m) => m.run(info));
}

void start();
