// Creating and finishing workouts.
import { getExercise } from '../data/exercises';
import type { Program } from '../program/builder';
import { suggest } from './coach';
import { exerciseHistory } from './stats';
import type { ExerciseEntry, SetEntry, TechniqueSummary, Unit, Workout } from './types';

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

export function emptyWorkout(now = new Date()): Workout {
  return { id: id(), startedAt: now.toISOString(), dayName: 'Workout', entries: [] };
}

export function addExercise(w: Workout, exerciseId: string): Workout {
  const hold = getExercise(exerciseId)?.tracking.kind === 'hold';
  return {
    ...w,
    entries: [...w.entries, { exerciseId, sets: Array.from({ length: 3 }, () => ({ done: false, planned: hold ? { seconds: 30 } : {} })) }],
  };
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

/** Drops unfinished sets and empty exercises; stamps the finish time. */
export function finishWorkout(w: Workout, now = new Date()): Workout {
  const entries = w.entries
    .map((e) => ({ ...e, sets: e.sets.filter((s) => s.done).map(({ planned: _planned, ...rest }) => rest) }))
    .filter((e) => e.sets.length > 0);
  return { ...w, entries, finishedAt: now.toISOString() };
}
