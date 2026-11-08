// On-device training log (localStorage, numbers only).
import { resetProfileCache } from '../profile';
import type { CustomExercise, EasyWeek, Routine, TechniqueSummary, TrainMode, Unit, Workout } from './types';

const KEY_WORKOUTS = 'formcheck.v1.workouts';
const KEY_ACTIVE = 'formcheck.v1.activeWorkout';
const KEY_TECHNIQUE = 'formcheck.v1.technique';
const KEY_UNIT = 'formcheck.v1.unit';
const KEY_BODYWEIGHT = 'formcheck.v1.bodyweight';
const KEY_ROUTINES = 'formcheck.v1.routines';
const KEY_MODE = 'formcheck.v1.trainMode';
const KEY_CUSTOM = 'formcheck.v1.customExercises';
const KEY_EASY = 'formcheck.v1.easyWeek';

/** The latest easier week you turned on (kept after it ends, so the coach doesn't suggest another straight away). */
export function loadEasyWeek(): EasyWeek | null {
  const e = read<unknown>(KEY_EASY, null) as EasyWeek | null;
  return e && typeof e.startedAt === 'string' && typeof e.until === 'string' ? e : null;
}
export const saveEasyWeek = (e: EasyWeek | null) => write(KEY_EASY, e);

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const isWorkout = (w: unknown): w is Workout =>
  !!w && typeof (w as Workout).id === 'string' && typeof (w as Workout).startedAt === 'string' && Array.isArray((w as Workout).entries);

/** Finished workouts, newest first. */
export function loadWorkouts(): Workout[] {
  const raw = read<unknown>(KEY_WORKOUTS, []);
  return (Array.isArray(raw) ? raw.filter(isWorkout) : []).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function saveWorkout(w: Workout): boolean {
  return write(KEY_WORKOUTS, [w, ...loadWorkouts().filter((x) => x.id !== w.id)]);
}

export function deleteWorkout(id: string): void {
  write(KEY_WORKOUTS, loadWorkouts().filter((w) => w.id !== id));
}

export const loadActiveWorkout = (): Workout | null => {
  const w = read<unknown>(KEY_ACTIVE, null);
  return isWorkout(w) ? w : null;
};
export const saveActiveWorkout = (w: Workout | null) => write(KEY_ACTIVE, w);

export function loadTechnique(): TechniqueSummary[] {
  const raw = read<unknown>(KEY_TECHNIQUE, []);
  return Array.isArray(raw) ? (raw as TechniqueSummary[]).filter((t) => t && typeof t.exerciseId === 'string') : [];
}
export function saveTechnique(t: TechniqueSummary): void {
  // Keep the most recent 500 checks.
  write(KEY_TECHNIQUE, [t, ...loadTechnique()].slice(0, 500));
}

export const loadUnit = (): Unit => (read<string>(KEY_UNIT, 'kg') === 'lb' ? 'lb' : 'kg');
export const saveUnit = (u: Unit) => write(KEY_UNIT, u);

/** Your body weight in kg (optional, set in Settings). */
export function loadBodyweight(): number | undefined {
  const v = read<unknown>(KEY_BODYWEIGHT, null);
  return typeof v === 'number' && v > 0 && v < 400 ? v : undefined;
}
export const saveBodyweight = (kg: number | null) => write(KEY_BODYWEIGHT, kg);

/** Personal trainer or My workouts; null until you pick one. */
export function loadMode(): TrainMode | null {
  const m = read<unknown>(KEY_MODE, null);
  return m === 'coach' || m === 'self' ? m : null;
}
export const saveMode = (m: TrainMode) => write(KEY_MODE, m);

const isRoutine = (r: unknown): r is Routine =>
  !!r && typeof (r as Routine).id === 'string' && typeof (r as Routine).name === 'string' && Array.isArray((r as Routine).items);

/** Your saved routines, oldest first. */
export function loadRoutines(): Routine[] {
  const raw = read<unknown>(KEY_ROUTINES, []);
  return Array.isArray(raw) ? raw.filter(isRoutine) : [];
}
export function saveRoutine(r: Routine): boolean {
  const all = loadRoutines();
  const i = all.findIndex((x) => x.id === r.id);
  return write(KEY_ROUTINES, i < 0 ? [...all, r] : all.map((x) => (x.id === r.id ? r : x)));
}
export function deleteRoutine(id: string): void {
  write(KEY_ROUTINES, loadRoutines().filter((r) => r.id !== id));
}

const isCustom = (c: unknown): c is CustomExercise =>
  !!c &&
  typeof (c as CustomExercise).id === 'string' &&
  typeof (c as CustomExercise).name === 'string' &&
  ((c as CustomExercise).kind === 'bodyweight' || (c as CustomExercise).kind === 'weighted');

// Read on almost every render (exercise names), so kept in memory.
let customCache: CustomExercise[] | null = null;

/** Exercises you added yourself, including removed ones (for old workouts). */
export function loadCustomExercises(): CustomExercise[] {
  if (!customCache) {
    const raw = read<unknown>(KEY_CUSTOM, []);
    customCache = Array.isArray(raw) ? raw.filter(isCustom).map((c) => ({ ...c, muscles: Array.isArray(c.muscles) ? c.muscles : [] })) : [];
  }
  return customCache;
}
export function saveCustomExercise(c: CustomExercise): boolean {
  const all = loadCustomExercises();
  customCache = all.some((x) => x.id === c.id) ? all.map((x) => (x.id === c.id ? c : x)) : [...all, c];
  return write(KEY_CUSTOM, customCache);
}

/** Every key this app stores, for backup / restore / delete-all. */
export const ALL_KEYS_PREFIX = 'formcheck.v1.';

export function exportAll(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(ALL_KEYS_PREFIX)) out[k] = JSON.parse(localStorage.getItem(k) ?? 'null');
    }
  } catch {
    // Storage blocked: nothing to export.
  }
  return { app: 'form-check', version: 1, exportedAt: new Date().toISOString(), data: out };
}

/** Restores a backup made by exportAll. Returns the number of keys restored. */
export function importAll(backup: unknown): number {
  const b = backup as { app?: string; data?: Record<string, unknown> };
  if (b?.app !== 'form-check' || !b.data || typeof b.data !== 'object') throw new Error('This isn’t a Form Check backup file.');
  let n = 0;
  customCache = null;
  resetProfileCache();
  for (const [k, v] of Object.entries(b.data)) {
    if (k.startsWith(ALL_KEYS_PREFIX) && write(k, v)) n++;
  }
  return n;
}

export function deleteAll(): void {
  customCache = null;
  resetProfileCache();
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(ALL_KEYS_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Nothing to delete.
  }
}
