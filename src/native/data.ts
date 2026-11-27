// Settings → Delete all my data in the iPhone app (src/screens/SettingsScreen.tsx's native branch hands off here).
// The native side deletes the app's folder (the copy of the log, every saved set and video), its temporary files and
// the web view's own stores (localStorage, IndexedDB and the rest: WKWebsiteDataStore), then the page reloads to the
// Welcome screen. The copy writer is paused first, so nothing writes the data back on the way out.
import { deleteAll } from '../log/store';
import { showToast } from '../ui/toast';
import { native } from './bridge';
import { pauseWriter, resumeWriter } from './snapshot';

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

export async function deleteEverything(): Promise<void> {
  if (!confirm(DELETE_CONFIRM)) return;
  pauseWriter();
  try {
    await native().deleteAllData();
  } catch {
    resumeWriter();
    showToast(DELETE_FAILED_TOAST);
    return;
  }
  // The web view's stores are already gone; this only makes sure no key of the user's is left in this page's
  // localStorage for anything to copy back (the writer stays paused until the reload).
  deleteAll();
  history.replaceState(null, '', DELETED_HASH);
  location.reload();
}
