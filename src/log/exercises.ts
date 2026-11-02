// Exercises as the training log sees them: the library plus exercises you
// add yourself. Your own exercises have a name, a load type and muscles only
// (no demo or technique check).
import { EXERCISES, getExercise } from '../data/exercises';
import { isBodyweight } from '../data/filters';
import type { Exercise, MuscleGroup } from '../data/types';
import { loadCustomExercises } from './store';
import type { CustomExercise } from './types';

export interface ExerciseInfo {
  id: string;
  name: string;
  primary: MuscleGroup[];
  secondary: MuscleGroup[];
  /** Logged as body weight plus any added weight. */
  bodyweight: boolean;
  /** Logged in seconds (planks and other holds). */
  hold: boolean;
  /** The library entry (demo, technique check); missing for your own exercises. */
  library?: Exercise;
  custom?: CustomExercise;
}

export function exerciseInfo(id: string, custom: CustomExercise[] = loadCustomExercises()): ExerciseInfo | undefined {
  const ex = getExercise(id);
  if (ex) {
    return { id, name: ex.name, primary: ex.primary, secondary: ex.secondary, bodyweight: isBodyweight(ex), hold: ex.tracking.kind === 'hold', library: ex };
  }
  const c = custom.find((x) => x.id === id);
  if (c) return { id, name: c.name, primary: c.muscles, secondary: [], bodyweight: c.kind === 'bodyweight', hold: false, custom: c };
  return undefined;
}

export const exerciseName = (id: string) => exerciseInfo(id)?.name ?? 'Removed exercise';

export function newCustomExercise(name: string, kind: CustomExercise['kind'], muscles: MuscleGroup[], now = new Date()): CustomExercise {
  return {
    id: `custom-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().replace(/\s+/g, ' ').slice(0, 40),
    kind,
    muscles,
    createdAt: now.toISOString(),
  };
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** A library or own exercise that already has this name (ignoring case), if any. */
export function sameName(name: string, custom: CustomExercise[] = loadCustomExercises(), exceptId?: string): ExerciseInfo | undefined {
  const n = norm(name);
  if (!n) return undefined;
  const lib = EXERCISES.find((e) => norm(e.name) === n);
  if (lib) return exerciseInfo(lib.id, custom);
  const own = custom.find((c) => !c.archived && c.id !== exceptId && norm(c.name) === n);
  return own ? exerciseInfo(own.id, custom) : undefined;
}
