// src/ui/download.ts's stand-in in the iPhone app (NATIVE_SWAPS in scripts/native-build.ts). A web view can't
// download (Capacitor cancels a download link's navigation), so the file goes to iOS's Save to Files panel, where the
// person picks the place, as with a download: a file saved on the device, never an upload (FiteeNative.exportFile).
// "Back up my data" (src/screens/SettingsScreen.tsx) is the app's only export.
import { showToast } from '../ui/toast';
import { native } from './bridge';

export const EXPORT_FAILED_TOAST = 'Couldn’t open Save to Files. Try again.';

/** Saves data as a JSON file on the device (no upload), through Save to Files. Cancelling the panel is fine: nothing to say. */
export function downloadJson(filename: string, data: unknown): void {
  void Promise.resolve()
    .then(() => native().exportFile({ name: filename, text: JSON.stringify(data, null, 2) }))
    .catch(() => showToast(EXPORT_FAILED_TOAST));
}
