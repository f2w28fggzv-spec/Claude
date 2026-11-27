// Settings → Delete all my data in the iPhone app (src/screens/SettingsScreen.tsx's native branch hands off here).
// The native side deletes the app's folder (the copy of the log, every saved set and video), its temporary files and
// the web view's own stores (localStorage, IndexedDB and the rest: WKWebsiteDataStore), then the page reloads to the
// Welcome screen. The copy writer is paused first, so nothing writes the data back on the way out.
//
// A delete the app didn't finish (it, or its page, stopped part way: AppInfo.deleting) is finished at the next launch,
// before anything reads the data (openData): starting on what it left, the user's keys still in localStorage and no
// copy, would copy the deleted data back. A delete that fails says which it is by its marker (src/native/bridge.ts):
// gone, nothing of the web view's was touched, so the data stays (the copy written again at once, the failure said);
// still there, the delete isn't over, so the page reloads and the launch finishes it.
import { ALL_KEYS_PREFIX, deleteAll } from '../log/store';
import { showToast } from '../ui/toast';
import type { AppInfo, FiteeNative } from './bridge';
import { native } from './bridge';
import { pauseWriter, resumeWriter, restoreBeforeStart, type StartResult } from './snapshot';

export const DELETE_CONFIRM =
  'Delete your plans, workout log, profile, saved sets and videos, and settings from this iPhone? This can’t be undone. Copies in your iPhone’s backups stay until those backups are replaced.';
export const DELETE_FAILED_TOAST = 'Couldn’t delete your data. Try again.';
export const DELETED_TOAST = 'All data deleted';

/** The route the page reloads to after Delete all, which src/native/entry.ts reads (and removes) to say it's done. */
export const DELETED_HASH = '#/?deleted';

/** Whether this page load follows Delete all my data. Puts the plain Train route back before the app reads it. */
export function takeDeletedFlag(loc: Pick<Location, 'hash'> = location, hist: Pick<History, 'replaceState'> = history): boolean {
  if (loc.hash !== DELETED_HASH) return false;
  hist.replaceState(null, '', '#/');
  return true;
}

/** The page's location and history, as openData uses them (tests pass stand-ins). */
export interface PageNav {
  location: Pick<Location, 'reload'>;
  history: Pick<History, 'replaceState'>;
}

/** What deleteEverything uses of the page: its location and history, the confirm and the toast (tests pass stand-ins). */
export interface DeletePage extends PageNav {
  confirm(message: string): boolean;
  toast(message: string): void;
}

const thisPage = (): DeletePage => ({ location, history, confirm: (message) => confirm(message), toast: (message) => showToast(message) });

export async function deleteEverything(page: DeletePage = thisPage()): Promise<void> {
  if (!page.confirm(DELETE_CONFIRM)) return;
  pauseWriter();
  try {
    await native().deleteAllData();
  } catch {
    if (await stillDeleting()) {
      // The marker is still there (it couldn't be removed, after the web view's stores went or after the folder
      // failed): the delete isn't over, so nothing goes on with the data here. The reload's launch finishes it
      // (openData), or says it couldn't.
      page.location.reload();
      return;
    }
    // Nothing of the web view's was touched and the marker is gone: the data stays. fitee/ may be partly gone, the
    // copy with it, so it's written again at once.
    resumeWriter(true);
    page.toast(DELETE_FAILED_TOAST);
    return;
  }
  // The web view's stores are already gone; this only makes sure no key of the user's is left in this page's
  // localStorage for anything to copy back (the writer stays paused until the reload).
  deleteAll();
  page.history.replaceState(null, '', DELETED_HASH);
  page.location.reload();
}

/** After a deleteAllData that failed: whether its marker is still there (AppInfo.deleting); true if that can't be told, since the reload's launch reads the marker itself. */
async function stillDeleting(): Promise<boolean> {
  try {
    return (await native().appInfo()).deleting;
  } catch {
    return true;
  }
}

/**
 * The launch's first step with the data (src/native/entry.ts, after appInfo, before the app or the copy writer
 * starts). A Delete all my data that didn't finish (`info.deleting`) is finished now: deleteAllData again, every
 * formcheck.v1. key left in this page's localStorage removed, and the page reloads to Welcome with "All data deleted",
 * as after any Delete all; resolves undefined then. Otherwise the copy of the log is put back (restoreBeforeStart) and
 * its result returned. Rejects if either fails: the app then doesn't start.
 */
export async function openData(n: Pick<FiteeNative, 'deleteAllData' | 'readSnapshot' | 'dropSnapshot'>, info: Pick<AppInfo, 'deleting'>, storage: Storage, page: PageNav): Promise<StartResult | undefined> {
  if (!info.deleting) return restoreBeforeStart(n, storage);
  await n.deleteAllData();
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(ALL_KEYS_PREFIX)) keys.push(k);
  }
  for (const k of keys) storage.removeItem(k);
  page.history.replaceState(null, '', DELETED_HASH);
  page.location.reload();
  return undefined;
}
