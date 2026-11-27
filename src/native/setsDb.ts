// What src/sets/sets.ts gets in place of src/db.ts in the iPhone app (NATIVE_SWAPS in scripts/native-build.ts):
// saved sets are files in Library/Application Support/fitee/sets/, which the app asks iOS to leave out of backups
// (src/native/bridge.ts). The index and each replay are JSON files; a video is uploaded in chunks (setFiles.ts) and
// plays from its file's URL (videoUrl). sets.ts itself is unchanged: its pruning, deletion order and tests hold.
// Calibration recordings (src/calibration/store.ts) keep src/db.ts.
//
// The launch's reconcile runs before any other call, so it never runs between saveSet's replay write and its index
// write (which would take the new replay for an orphan). It drops index entries whose replay is gone, clears `video`
// on entries whose video file is gone (sets/ isn't restored from iPhone backups), and deletes files no entry names
// (leftovers of an interrupted delete). An index that exists but can't be read deletes nothing: it is set aside as
// index.unreadable-<ms>.json, the entries are rebuilt from the replay files, and while any such file exists the
// reconcile deletes no file as an orphan.
import { faultReps } from '../log/form';
import type { SavedSetMeta } from '../sets/sets';
import type { SetFile } from './bridge';
import { native } from './bridge';
import {
  extFor,
  INDEX_FILE,
  replayFile,
  setFileFor,
  SET_ID,
  typeForExt,
  UNREADABLE_INDEX,
  uploadVideo,
  VIDEO_EXTS,
  videoFile,
  type VideoExt,
} from './setFiles';

/** An index file's entries, or undefined when the text isn't an index (it doesn't parse, or isn't a list of sets). */
export function parseIndex(text: string): SavedSetMeta[] | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) return undefined;
    return value.every((m) => !!m && typeof m === 'object' && typeof (m as SavedSetMeta).id === 'string') ? (value as SavedSetMeta[]) : undefined;
  } catch {
    return undefined;
  }
}

/** The time newSetId() (src/sets/sets.ts) wrote into a set's id ("s" and the milliseconds in base 36), if it has one. */
export function timeFromId(id: string, now = Date.now()): string | undefined {
  const m = /^s([0-9a-z]{8})[0-9a-z]{0,3}$/.exec(id);
  const ms = m ? parseInt(m[1], 36) : NaN;
  return ms >= Date.UTC(2020, 0, 1) && ms <= now + 86_400_000 ? new Date(ms).toISOString() : undefined;
}

/**
 * An index entry rebuilt from a set's replay file, as src/screens/Results.tsx would have written it, or undefined when
 * the replay doesn't hold what one needs. What a replay can't tell is filled in plainly: not mirrored, and a video
 * (if its file is there) whose frame time 0 is its start.
 */
export function entryFromReplay(id: string, replay: unknown, video?: { ext: VideoExt; bytes: number }, now = Date.now()): SavedSetMeta | undefined {
  try {
    const { seq, result } = replay as { seq: { source?: string; frames: { t: number }[] }; result: { exerciseId: unknown; reps: { checks: { status: string; fault?: string }[] }[]; hold?: { durationSec: number; checks: { status: string; fault?: string }[] } } };
    const at = timeFromId(id, now);
    if (!at || typeof result.exerciseId !== 'string' || !Array.isArray(seq.frames) || !Array.isArray(result.reps)) return undefined;
    const clean = (checks: { status: string }[]) => checks.every((c) => c.status !== 'fail');
    return {
      id,
      exerciseId: result.exerciseId,
      at,
      source: seq.source === 'file' ? 'file' : 'camera',
      durationSec: Math.round((seq.frames.at(-1)?.t ?? 0) / 100) / 10,
      reps: result.reps.length,
      cleanReps: result.hold ? Number(clean(result.hold.checks)) : result.reps.filter((r) => clean(r.checks)).length,
      holdSec: result.hold ? Math.round(result.hold.durationSec * 10) / 10 : undefined,
      faults: faultReps(result.hold ? [result.hold.checks] : result.reps.map((r) => r.checks)),
      mirrored: false,
      video: video ? { bytes: video.bytes, type: typeForExt(video.ext), offsetMs: 0 } : undefined,
    };
  } catch {
    return undefined;
  }
}

/** The video file an entry names, if it has a video. */
const videoOf = (m: SavedSetMeta) => (m.video ? videoFile(m.id, extFor(m.video.type)) : undefined);

/** Rebuilds the index from the replay files in `files` (an index that couldn't be read was set aside). */
async function rebuild(files: Map<string, SetFile>): Promise<SavedSetMeta[]> {
  const out: SavedSetMeta[] = [];
  for (const name of files.keys()) {
    const id = /^([A-Za-z0-9_-]{1,64})\.replay\.json$/.exec(name)?.[1];
    if (!id) continue;
    let replay: unknown;
    try {
      replay = JSON.parse((await native().readSetFile({ name })).text ?? '');
    } catch {
      continue; // kept as it is: nothing is deleted while an unreadable index is set aside
    }
    const ext = VIDEO_EXTS.find((e) => files.has(videoFile(id, e)));
    const entry = entryFromReplay(id, replay, ext ? { ext, bytes: files.get(videoFile(id, ext))?.bytes ?? 0 } : undefined);
    if (entry) out.push(entry);
  }
  return out;
}

/** The launch's reconcile of the index with the files (see the header). */
async function reconcile(now = Date.now()): Promise<void> {
  const n = native();
  const files = new Map((await n.listSetFiles()).files.map((f) => [f.name, f]));
  const { text } = await n.readSetFile({ name: INDEX_FILE });
  let index: SavedSetMeta[] = [];
  let changed = false;
  if (text !== undefined) {
    const parsed = parseIndex(text);
    if (parsed) index = parsed;
    else {
      const aside = `index.unreadable-${now}.json`;
      await n.renameSetFile({ from: INDEX_FILE, to: aside });
      files.delete(INDEX_FILE);
      files.set(aside, { name: aside, bytes: text.length, excluded: true });
      index = await rebuild(files);
      changed = true;
    }
  }
  const kept: SavedSetMeta[] = [];
  for (const m of index) {
    if (!SET_ID.test(m.id) || !files.has(replayFile(m.id))) {
      changed = true;
      continue;
    }
    const video = videoOf(m);
    if (video && !files.has(video)) {
      kept.push({ ...m, video: undefined });
      changed = true;
    } else kept.push(m);
  }
  if (changed) await n.writeSetFile({ name: INDEX_FILE, text: JSON.stringify(kept) });
  // After the index, as sets.ts deletes: a crash in between leaves only orphans, which the next launch removes.
  if ([...files.keys()].some((name) => UNREADABLE_INDEX.test(name))) return;
  const named = new Set<string>([INDEX_FILE]);
  for (const m of kept) {
    named.add(replayFile(m.id));
    const video = videoOf(m);
    if (video) named.add(video);
  }
  const orphans = [...files.keys()].filter((name) => !named.has(name));
  if (orphans.length) await n.removeSetFiles({ names: orphans });
}

let reconciling: Promise<void> | undefined;

/**
 * The launch's reconcile, started by the first call of any kind and awaited by every call. If it fails (the folder
 * couldn't be read), calls still go ahead: it only tidies up, and it runs again at the next launch.
 */
export function reconciled(): Promise<void> {
  reconciling ??= reconcile().catch(() => undefined);
  return reconciling;
}

/** Video uploads still reading their Blob (a picked file is a temporary copy clearPickedFiles() deletes). */
const uploading = new Set<Promise<unknown>>();

export async function dbGet<T>(key: string): Promise<T | undefined> {
  const file = setFileFor(key);
  if (file.kind === 'video') throw new Error('In the app a saved video plays from its file: use videoUrl()');
  await reconciled();
  const { text } = await native().readSetFile({ name: file.name });
  if (text === undefined) return undefined;
  if (file.kind === 'index') {
    // An index that can't be read is never taken for an empty one: saving would write over every entry. The next
    // launch's reconcile sets it aside and rebuilds it.
    const index = parseIndex(text);
    if (!index) throw new Error('The saved sets’ index couldn’t be read');
    return index as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined; // the set page then says it isn't saved any more
  }
}

export function dbSet(key: string, value: unknown): Promise<void> {
  const file = setFileFor(key);
  if (file.kind !== 'video') return reconciled().then(async () => void (await native().writeSetFile({ name: file.name, text: JSON.stringify(value) })));
  // Counted as reading its Blob from the moment it's asked for, so clearPickedFiles() can't come in between. A failure
  // rejects, so src/screens/Results.tsx says the video couldn't be saved.
  const upload = reconciled().then(() => uploadVideo(native(), file.id, value as Blob));
  uploading.add(upload);
  return upload.finally(() => uploading.delete(upload));
}

export async function dbDelete(key: string): Promise<void> {
  const file = setFileFor(key);
  await reconciled();
  // A video's extension follows its type, which this call doesn't know: every one goes (missing files are fine).
  const names = file.kind === 'video' ? VIDEO_EXTS.map((ext) => videoFile(file.id, ext)) : [file.name];
  await native().removeSetFiles({ names });
}

/**
 * A saved video's URL, for src/screens/SetScreen.tsx's native branch: capacitor://localhost/_capacitor_file_/…,
 * asked for each time (the app's folder moves between app versions), so never stored.
 */
export async function videoUrl(id: string, type: string): Promise<string> {
  await reconciled();
  return (await native().videoUrl({ name: videoFile(id, extFor(type)) })).url;
}

/**
 * Deletes the temporary copies iOS made of a video picked for a check (or filmed with Take Video): the native
 * branches of src/screens/Results.tsx and src/screens/Analyze.tsx call it when that check ends. A video still being
 * saved from such a copy is waited for first. Never rejects (what stays is deleted at the next launch).
 */
export async function clearPickedFiles(): Promise<void> {
  await Promise.allSettled([...uploading]);
  try {
    await native().clearPickedFiles();
  } catch {
    // The app empties the folder at its next launch.
  }
}
