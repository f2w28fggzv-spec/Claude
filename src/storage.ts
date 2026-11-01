// On-device storage only (localStorage). Holds settings and programs; never
// video or images. Every access is wrapped because storage can be blocked
// (private browsing, full quota).
import type { Program } from './program/builder';
import { MUSCLE_GROUPS, type MuscleGroup } from './data/types';

const KEY_GROUPS = 'formcheck.v1.groups';
const KEY_PROGRAMS = 'formcheck.v1.programs';

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
