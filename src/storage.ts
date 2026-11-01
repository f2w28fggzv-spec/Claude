// On-device storage only (localStorage). Holds settings and programs; never
// video or images. Every access is wrapped because storage can be blocked
// (private browsing, full quota).
import type { Program } from './program/builder';
import type { BodyProportions, ThresholdOverrides } from './engine/types';
import { MUSCLE_GROUPS, type MuscleGroup } from './data/types';

const KEY_GROUPS = 'formcheck.v1.groups';
const KEY_PROGRAMS = 'formcheck.v1.programs';
const KEY_BODY = 'formcheck.v1.body';
const KEY_OVERRIDES = 'formcheck.v1.overrides';
const KEY_HANDS_FREE = 'formcheck.v1.handsFree';

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
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadGroups(): MuscleGroup[] {
  const raw = read<unknown>(KEY_GROUPS, []);
  return Array.isArray(raw) ? MUSCLE_GROUPS.filter((g) => raw.includes(g)) : [];
}

export const saveGroups = (groups: MuscleGroup[]) => write(KEY_GROUPS, groups);

export function loadPrograms(): Program[] {
  const raw = read<unknown>(KEY_PROGRAMS, []);
  return Array.isArray(raw) ? (raw as Program[]).filter((p) => p && typeof p.id === 'string' && Array.isArray(p.days)) : [];
}

/** Returns false if the device refused to save. */
export function saveProgram(program: Program): boolean {
  const others = loadPrograms().filter((p) => p.id !== program.id);
  return write(KEY_PROGRAMS, [program, ...others]);
}

export function deleteProgram(id: string): void {
  write(KEY_PROGRAMS, loadPrograms().filter((p) => p.id !== id));
}

/** Limb proportions (ratios only, no images), measured during setup. */
export function loadProportions(): BodyProportions | null {
  const raw = read<BodyProportions | null>(KEY_BODY, null);
  return raw && typeof raw.measuredAt === 'string' ? raw : null;
}

export const saveProportions = (p: BodyProportions) => write(KEY_BODY, p);

export function loadOverrides(): ThresholdOverrides {
  const raw = read<unknown>(KEY_OVERRIDES, {});
  return raw && typeof raw === 'object' ? (raw as ThresholdOverrides) : {};
}

/** Sets one tuned threshold value; `null` removes it. */
export function saveOverride(exerciseId: string, checkId: string, field: string, value: number | null): ThresholdOverrides {
  const all = loadOverrides();
  const ex = { ...(all[exerciseId] ?? {}) };
  const check = { ...(ex[checkId] ?? {}) };
  if (value === null) delete check[field];
  else check[field] = value;
  if (Object.keys(check).length) ex[checkId] = check;
  else delete ex[checkId];
  if (Object.keys(ex).length) all[exerciseId] = ex;
  else delete all[exerciseId];
  write(KEY_OVERRIDES, all);
  return all;
}

export const loadHandsFree = () => read<boolean>(KEY_HANDS_FREE, true) !== false;
export const saveHandsFree = (on: boolean) => write(KEY_HANDS_FREE, on);
