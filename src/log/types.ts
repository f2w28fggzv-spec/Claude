// Training log data. Weights are always stored in kilograms and converted for
// display, so switching units never changes the history. Numbers only.

export type Unit = 'kg' | 'lb';

export interface SetEntry {
  /** Kilograms. Missing for bodyweight sets. */
  weight?: number;
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
  entries: ExerciseEntry[];
  notes?: string;
}
