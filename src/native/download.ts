// Placeholder: stage 2 replaces this.
// src/ui/download.ts's stand-in in the native build (NATIVE_SWAPS in scripts/native-build.ts): a web view can't
// download, so the file goes to iOS's Save to Files panel, where the person picks the place (exportFile).
import { showToast } from '../ui/toast';
import { native } from './bridge';

/** Saves data as a JSON file on the device (no upload), through Save to Files. */
export function downloadJson(filename: string, data: unknown): void {
  void Promise.resolve()
    .then(() => native().exportFile({ name: filename, text: JSON.stringify(data, null, 2) }))
    .catch(() => showToast('Couldn’t open Save to Files. Try again.'));
}
