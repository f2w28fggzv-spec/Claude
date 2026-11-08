// Saved sets: every analysed set keeps a skeleton replay (pose landmarks and
// the analysis, numbers only) and, if the lifter taps "Save video", the video
// too. Everything is stored in IndexedDB on this device and never uploaded.
import { dbDelete, dbGet, dbSet } from '../db';
import type { AnalysisResult, PoseSequence, RawLandmark } from '../engine/types';

export interface SavedSetMeta {
  id: string;
  exerciseId: string;
  at: string;
  source: 'camera' | 'file';
  durationSec: number;
  /** Reps counted (0 for holds). */
  reps: number;
  /** Reps with no failed check. */
  cleanReps: number;
  /** Seconds held, for holds. */
  holdSec?: number;
  /** Fault id → reps with that fault. */
  faults: Record<string, number>;
  /** Front-camera recordings are shown mirrored, as they were filmed. */
  mirrored: boolean;
  /** A saved video: size, type and where frame time 0 sits in it (ms). */
  video?: { bytes: number; type: string; offsetMs: number };
}

export interface SavedSetData {
  seq: PoseSequence;
  result: AnalysisResult;
}

/** Replays kept without a video; older ones are removed (sets with a video are kept until you delete them). */
export const MAX_REPLAYS = 60;

const INDEX = 'sets.index.v1';
const dataKey = (id: string) => `sets.data.v1.${id}`;
const videoKey = (id: string) => `sets.video.v1.${id}`;

export const newSetId = (now = new Date()) => `s${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Rounds landmarks so a replay takes less room (x, y to 1/10,000 of the image). */
export function compactSequence(seq: PoseSequence): PoseSequence {
  const r = (v: number, d: number) => Math.round(v * d) / d;
  return {
    ...seq,
    frames: seq.frames.map((f) => ({ t: f.t, lm: f.lm ? f.lm.map(([x, y, z, v]): RawLandmark => [r(x, 1e4), r(y, 1e4), r(z, 1e3), r(v, 1e3)]) : null })),
  };
}

/** Ids to remove so at most `max` sets without a video remain (oldest go first). */
export function pruneIds(index: SavedSetMeta[], max = MAX_REPLAYS): string[] {
  const plain = index.filter((m) => !m.video).sort((a, b) => b.at.localeCompare(a.at));
  return plain.slice(max).map((m) => m.id);
}

/** Saved sets, newest first. */
export async function loadSets(): Promise<SavedSetMeta[]> {
  const index = (await dbGet<SavedSetMeta[]>(INDEX)) ?? [];
  return [...index].sort((a, b) => b.at.localeCompare(a.at));
}

async function writeIndex(index: SavedSetMeta[]) {
  await dbSet(INDEX, index);
}

export async function saveSet(meta: SavedSetMeta, data: SavedSetData): Promise<void> {
  await dbSet(dataKey(meta.id), { seq: compactSequence(data.seq), result: data.result });
  const index = [meta, ...(await loadSets()).filter((m) => m.id !== meta.id)];
  const drop = new Set(pruneIds(index));
  for (const id of drop) await dbDelete(dataKey(id));
  await writeIndex(index.filter((m) => !drop.has(m.id)));
}

export const loadSetData = (id: string) => dbGet<SavedSetData>(dataKey(id));

/** Keeps the video of a saved set on this device. Asks the browser not to clear the app's storage. */
export async function saveSetVideo(id: string, video: Blob, offsetMs: number): Promise<void> {
  await dbSet(videoKey(id), video);
  const index = await loadSets();
  await writeIndex(index.map((m) => (m.id === id ? { ...m, video: { bytes: video.size, type: video.type || 'video/mp4', offsetMs } } : m)));
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Persistence is a request; the browser may say no.
  }
}

export const loadSetVideo = (id: string) => dbGet<Blob>(videoKey(id));

export async function deleteSetVideo(id: string): Promise<void> {
  await dbDelete(videoKey(id));
  const index = await loadSets();
  await writeIndex(index.map((m) => (m.id === id ? { ...m, video: undefined } : m)));
}

export async function deleteSet(id: string): Promise<void> {
  await dbDelete(videoKey(id));
  await dbDelete(dataKey(id));
  await writeIndex((await loadSets()).filter((m) => m.id !== id));
}

/** Removes every saved video, keeping the replays. */
export async function deleteAllVideos(): Promise<void> {
  const index = await loadSets();
  for (const m of index) if (m.video) await dbDelete(videoKey(m.id));
  await writeIndex(index.map((m) => ({ ...m, video: undefined })));
}

/** Removes every saved set, replays and videos. */
export async function deleteAllSets(): Promise<void> {
  const index = await loadSets();
  for (const m of index) {
    await dbDelete(videoKey(m.id));
    await dbDelete(dataKey(m.id));
  }
  await dbDelete(INDEX);
}
