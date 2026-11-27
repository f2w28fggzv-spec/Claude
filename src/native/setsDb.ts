// Placeholder: stage 2 replaces this.
// What src/sets/sets.ts gets in place of src/db.ts in the native build (NATIVE_SWAPS in scripts/native-build.ts):
// stage 2 keeps saved sets as files through the bridge (src/native/bridge.ts). Until then it passes through to
// IndexedDB, so the native build runs.
import { native } from './bridge';

export { dbDelete, dbGet, dbSet } from '../db';

/** A saved video's URL, for src/screens/SetScreen.tsx's native branch (stage 2: from its file). */
export async function videoUrl(id: string, type: string): Promise<string> {
  throw new Error(`Placeholder: no video file for ${id} (${type}) until stage 2`);
}

/**
 * Deletes the temporary copies iOS made of a video picked for a check (or filmed with Take Video): the native
 * branches of src/screens/Results.tsx and src/screens/Analyze.tsx call it when that check ends. Never rejects (what
 * stays is deleted at the next launch). Stage 2: first wait for a video save still reading the picked file.
 */
export async function clearPickedFiles(): Promise<void> {
  try {
    await native().clearPickedFiles();
  } catch {
    // The app empties the folder at its next launch.
  }
}
