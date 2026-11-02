// Training log data. Weights are always stored in kilograms and converted for
// display, so switching units never changes the history. Numbers only.

export type Unit = 'kg' | 'lb';

export interface SetEntry {
  /**
   * Kilograms. For bodyweight sets (`bw`) this is the weight added on top of
   * your body (vest, belt, dumbbell), and missing means body weight only.
   */
  weight?: number;
  /** Done with body weight (push-ups, pull-ups, dips…), plus `weight` if any. */
  bw?: boolean;
  reps?: number;
  /** For timed holds. */
  seconds?: number;
  done: boolean;
  /** What the coach planned for this set; used when a set is ticked without typing. */
  planned?: { weight?: number; reps?: number; seconds?: number };
}

/** Outcome of a technique check, kept as numbers only. */
export interface TechniqueSummary {
  exerciseId: string;
  at: string;
  reps: number;
  /** Fault id → number of reps with that fault. */
  faults: Record<string, number>;
  /** Reps where every check passed. */
  cleanReps: number;
}

export interface ExerciseEntry {
  exerciseId: string;
  sets: SetEntry[];
  /** Plan prescription when the workout came from a plan day. */
  target?: { sets: number; reps: [number, number]; unit: 'reps' | 'seconds'; restSec: number; weight?: number };
  /** The coach's note for this exercise in this workout. */
  coachNote?: string;
}

export interface Workout {
  id: string;
  startedAt: string;
  finishedAt?: string;
  planId?: string;
  /** Index of the plan day this workout followed. */
  dayIndex?: number;
  dayName?: string;
  /** The routine this workout was started from, if any. */
  routineId?: string;
  entries: ExerciseEntry[];
  notes?: string;
  /** Your body weight in kg when you logged it (from Settings, if set). */
  bodyweight?: number;
}

/** A workout you put together yourself and repeat ("My workouts" mode). */
export interface Routine {
  id: string;
  name: string;
  createdAt: string;
  items: { exerciseId: string; sets: number }[];
}

/** Personal trainer (the app builds the plan) or My workouts (you do). */
export type TrainMode = 'coach' | 'self';
