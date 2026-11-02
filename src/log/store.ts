// On-device training log (localStorage, numbers only).
import type { TechniqueSummary, Unit, Workout } from './types';

const KEY_WORKOUTS = 'formcheck.v1.workouts';
const KEY_ACTIVE = 'formcheck.v1.activeWorkout';
const KEY_TECHNIQUE = 'formcheck.v1.technique';
const KEY_UNIT = 'formcheck.v1.unit';

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
  for (const [k, v] of Object.entries(b.data)) {
    if (k.startsWith(ALL_KEYS_PREFIX) && write(k, v)) n++;
  }
  return n;
}

export function deleteAll(): void {
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
