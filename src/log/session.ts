// Creating and finishing workouts.
import { getExercise } from '../data/exercises';
import { isBodyweight } from '../data/filters';
import { MUSCLE_LABELS, type MuscleGroup } from '../data/types';
import type { Program } from '../program/builder';
import { suggest } from './coach';
import { doneSets, exerciseHistory } from './stats';
import type { ExerciseEntry, Routine, SetEntry, TechniqueSummary, Unit, Workout } from './types';

const id = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A workout for one plan day, pre-filled with the coach's suggestions. */
export function startFromPlan(
  program: Program,
  dayIndex: number,
  workouts: Workout[],
  technique: TechniqueSummary[],
  unit: Unit = 'kg',
  now = new Date(),
): Workout {
  const day = program.days[dayIndex];
  const entries: ExerciseEntry[] = [];
  for (const item of day.items) {
    const history = exerciseHistory(workouts, item.exerciseId);
    const s = suggest(item, history, technique, unit);
    const last = history[history.length - 1];
    const planned = (i: number): SetEntry['planned'] => {
      if (item.unit === 'seconds') return { seconds: item.reps[0] };
      const prev = last?.sets[i]?.reps;
      // Aim one rep above last time (double progression), within the range.
      const reps = s.kind === 'increase' || s.kind === 'technique' || s.kind === 'reduce' || prev === undefined
        ? item.reps[0]
        : Math.min(item.reps[1], prev + 1);
      return { weight: s.weight, reps };
    };
    entries.push({
      exerciseId: item.exerciseId,
      target: { sets: item.sets, reps: item.reps, unit: item.unit, restSec: item.restSec, weight: s.weight },
      coachNote: s.note,
      sets: Array.from({ length: item.sets }, (_, i) => ({ done: false, planned: planned(i) })),
    });
    // Repeated technique fault: add its corrective right after (2 easy sets).
    if (s.corrective && !day.items.some((i) => i.exerciseId === s.corrective) && !entries.some((e) => e.exerciseId === s.corrective)) {
      const c = getExercise(s.corrective);
      const hold = c?.tracking.kind === 'hold';
      entries.push({
        exerciseId: s.corrective,
        target: { sets: 2, reps: hold ? [20, 30] : [8, 12], unit: hold ? 'seconds' : 'reps', restSec: 60 },
        coachNote: `Added by the coach to work on ${getExercise(item.exerciseId)?.name.toLowerCase() ?? 'your technique'}.`,
        sets: Array.from({ length: 2 }, () => ({ done: false, planned: hold ? { seconds: 20 } : { reps: 10 } })),
      });
    }
  }
  return { id: id(), startedAt: now.toISOString(), planId: program.id, dayIndex, dayName: day.name, entries };
}

/** A workout you build as you go. Named after the muscles you trained when you finish. */
export function emptyWorkout(now = new Date()): Workout {
  return { id: id(), startedAt: now.toISOString(), entries: [] };
}

/** What to pre-fill for set `i`: the same set last time, else the last set, else a default hold. */
function plannedFromLast(exerciseId: string, workouts: Workout[], i: number): SetEntry['planned'] {
  const last = exerciseHistory(workouts, exerciseId).at(-1);
  const prev = last?.sets[i] ?? last?.sets[last.sets.length - 1];
  if (prev) return { weight: prev.weight, reps: prev.reps, seconds: prev.seconds };
  return getExercise(exerciseId)?.tracking.kind === 'hold' ? { seconds: 30 } : {};
}

/** Adds an exercise with 3 sets, pre-filled with what you did last time. */
export function addExercise(w: Workout, exerciseId: string, workouts: Workout[] = []): Workout {
  return {
    ...w,
    entries: [...w.entries, { exerciseId, sets: Array.from({ length: 3 }, (_, i) => ({ done: false, planned: plannedFromLast(exerciseId, workouts, i) })) }],
  };
}

/** Starts one of your routines, pre-filled with last time's numbers. */
export function startRoutine(routine: Routine, workouts: Workout[], now = new Date()): Workout {
  return {
    id: id(),
    startedAt: now.toISOString(),
    dayName: routine.name,
    routineId: routine.id,
    entries: routine.items
      .filter((it) => getExercise(it.exerciseId))
      .map((it) => ({
        exerciseId: it.exerciseId,
        sets: Array.from({ length: Math.max(1, it.sets) }, (_, i) => ({ done: false, planned: plannedFromLast(it.exerciseId, workouts, i) })),
      })),
  };
}

/** Starts a copy of an earlier workout with the same exercises and numbers. */
export function repeatWorkout(src: Workout, now = new Date()): Workout {
  return {
    id: id(),
    startedAt: now.toISOString(),
    dayName: src.dayName,
    routineId: src.routineId,
    entries: src.entries.map((e) => ({
      exerciseId: e.exerciseId,
      sets: e.sets.map((x) => ({ done: false, planned: { weight: x.weight, reps: x.reps, seconds: x.seconds } })),
    })),
  };
}

/** A routine with the exercises and set counts of a workout. */
export function routineFromWorkout(w: Workout, now = new Date()): Routine {
  return {
    id: `r${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: w.dayName ?? 'My routine',
    createdAt: now.toISOString(),
    items: w.entries.map((e) => ({ exerciseId: e.exerciseId, sets: Math.max(1, doneSets(e.sets).length || e.sets.length) })),
  };
}

/** "Chest & Triceps": the one or two muscle groups with the most sets. */
export function nameFromMuscles(entries: ExerciseEntry[]): string | undefined {
  const sets = new Map<MuscleGroup, number>();
  for (const e of entries) {
    const ex = getExercise(e.exerciseId);
    const n = e.sets.filter((x) => x.done).length;
    for (const g of ex?.primary ?? []) sets.set(g, (sets.get(g) ?? 0) + n);
  }
  const top = [...sets].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return top.length ? top.map(([g]) => MUSCLE_LABELS[g]).join(' & ') : undefined;
}

/** Marks a set done, filling in planned values for anything left blank. */
export function completeSet(set: SetEntry): SetEntry {
  if (set.done) return { ...set, done: false };
  return {
    ...set,
    weight: set.weight ?? set.planned?.weight,
    reps: set.reps ?? set.planned?.reps,
    seconds: set.seconds ?? set.planned?.seconds,
    done: true,
  };
}

/**
 * Drops unfinished sets and empty exercises, marks bodyweight sets, records
 * your body weight (if set) and the finish time, and names a workout you
 * built yourself after the muscles you trained.
 */
export function finishWorkout(w: Workout, now = new Date(), bodyweight?: number): Workout {
  const entries = w.entries
    .map((e) => {
      const ex = getExercise(e.exerciseId);
      const bw = ex ? isBodyweight(ex) : false;
      return {
        ...e,
        sets: e.sets
          .filter((s) => s.done)
          .map(({ planned: _planned, ...rest }) => (bw ? { ...rest, bw: true } : rest)),
      };
    })
    .filter((e) => e.sets.length > 0);
  const hasBw = entries.some((e) => e.sets.some((s) => s.bw));
  return {
    ...w,
    dayName: w.dayName ?? nameFromMuscles(entries) ?? 'Workout',
    entries,
    finishedAt: now.toISOString(),
    ...(hasBw && bodyweight !== undefined ? { bodyweight } : {}),
  };
}
