// Training statistics from the log. Pure functions.
import { exerciseInfo } from './exercises';
import { MUSCLE_GROUPS, type MuscleGroup } from '../data/types';
import type { SetEntry, Unit, Workout } from './types';

export const KG_PER_LB = 0.45359237;

export const toUnit = (kg: number, unit: Unit) => (unit === 'kg' ? kg : kg / KG_PER_LB);
export const fromUnit = (v: number, unit: Unit) => (unit === 'kg' ? v : v * KG_PER_LB);

/** Weight shown in the user's unit, rounded to a sensible step (0.25 kg / 0.5 lb). */
/** Weights round to 0.25 kg / 0.5 lb; pass step 1 for estimates. */
export function formatWeight(kg: number | undefined, unit: Unit, step = unit === 'kg' ? 0.25 : 0.5): string {
  if (kg === undefined || !Number.isFinite(kg)) return '–';
  const r = Math.round(toUnit(kg, unit) / step) * step;
  return `${Number(r.toFixed(2))} ${unit}`;
}

/**
 * Estimated one-rep max (Epley 1985: weight × (1 + reps / 30)). Only used to
 * compare sets of different weights and reps; meaningful up to about 12 reps.
 */
export function e1rm(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/**
 * Load of one set in kg: the weight, or for bodyweight sets your body weight
 * plus any added weight. 0 when the body weight isn't known (not counted).
 */
export function setLoad(s: SetEntry, bodyweight?: number): number {
  if (s.bw) return bodyweight === undefined ? 0 : bodyweight + (s.weight ?? 0);
  return s.weight ?? 0;
}

/** "60 kg × 8", "BW × 12", "BW + 10 kg × 6", "45 s". */
export function formatSet(s: SetEntry, unit: Unit): string {
  const load = s.bw ? (s.weight ? `BW + ${formatWeight(s.weight, unit)}` : 'BW') : s.weight ? formatWeight(s.weight, unit) : '';
  if (s.seconds !== undefined) return load && load !== 'BW' ? `${load} · ${s.seconds} s` : `${s.seconds} s`;
  return load ? `${load} × ${s.reps ?? 0}` : `${s.reps ?? 0} reps`;
}

/** Compact form for tables: "60×8", "BW×12", "BW+10×6", "45s". */
export function formatSetShort(s: SetEntry, unit: Unit): string {
  const n = (kg: number) => String(Number(toUnit(kg, unit).toFixed(1)));
  if (s.seconds !== undefined) return s.bw && s.weight ? `BW+${n(s.weight)}·${s.seconds}s` : `${s.seconds}s`;
  const load = s.bw ? (s.weight ? `BW+${n(s.weight)}` : 'BW') : s.weight ? n(s.weight) : '';
  return load ? `${load}×${s.reps ?? 0}` : `${s.reps ?? 0}`;
}

export const doneSets = (sets: SetEntry[]) => sets.filter((s) => s.done && ((s.reps ?? 0) > 0 || (s.seconds ?? 0) > 0));

export const finished = (workouts: Workout[]) => workouts.filter((w) => w.finishedAt);

/**
 * Total kilograms lifted (load × reps over completed sets). Bodyweight sets
 * count only when the workout has your body weight.
 */
export function workoutVolume(w: Workout): number {
  return w.entries.reduce((sum, e) => sum + doneSets(e.sets).reduce((s, set) => s + setLoad(set, w.bodyweight) * (set.reps ?? 0), 0), 0);
}

export function workoutSets(w: Workout): number {
  return w.entries.reduce((n, e) => n + doneSets(e.sets).length, 0);
}

export interface SessionSummary {
  workoutId: string;
  date: string;
  sets: SetEntry[];
  /** Best estimated one-rep max (kg) of the session; 0 if no load is known. */
  bestE1rm: number;
  bestSet?: SetEntry;
  /** Load (kg) of the best set, including body weight for bodyweight sets. */
  bestLoad: number;
  volume: number;
  maxReps: number;
  maxSeconds: number;
  /** Body weight (kg) logged with the workout, if any. */
  bodyweight?: number;
}

/** One summary per workout that included the exercise, oldest first. */
export function exerciseHistory(workouts: Workout[], exerciseId: string): SessionSummary[] {
  return finished(workouts)
    .filter((w) => w.entries.some((e) => e.exerciseId === exerciseId))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((w) => {
      const sets = w.entries.filter((e) => e.exerciseId === exerciseId).flatMap((e) => doneSets(e.sets));
      let bestE1rm = 0;
      let bestSet: SetEntry | undefined;
      let bestLoad = 0;
      for (const s of sets) {
        const load = setLoad(s, w.bodyweight);
        const v = e1rm(load, s.reps ?? 0);
        if (v > bestE1rm) {
          bestE1rm = v;
          bestSet = s;
          bestLoad = load;
        }
      }
      return {
        workoutId: w.id,
        date: w.startedAt,
        sets,
        bestE1rm,
        bestSet,
        bestLoad,
        volume: sets.reduce((s, x) => s + setLoad(x, w.bodyweight) * (x.reps ?? 0), 0),
        maxReps: Math.max(0, ...sets.map((s) => s.reps ?? 0)),
        maxSeconds: Math.max(0, ...sets.map((s) => s.seconds ?? 0)),
        bodyweight: w.bodyweight,
      };
    })
    .filter((s) => s.sets.length > 0);
}

export interface Records {
  bestE1rm: number;
  /** Heaviest load (kg), body weight included for bodyweight sets when known. */
  heaviest: number;
  mostReps: number;
  /** Most weight added to a bodyweight set (kg). */
  mostAdded: number;
  longestHold: number;
}

export function personalRecords(history: SessionSummary[]): Records {
  return {
    bestE1rm: Math.max(0, ...history.map((h) => h.bestE1rm)),
    heaviest: Math.max(0, ...history.flatMap((h) => h.sets.map((s) => setLoad(s, h.bodyweight)))),
    mostReps: Math.max(0, ...history.map((h) => h.maxReps)),
    mostAdded: Math.max(0, ...history.flatMap((h) => h.sets.filter((s) => s.bw).map((s) => s.weight ?? 0))),
    longestHold: Math.max(0, ...history.map((h) => h.maxSeconds)),
  };
}

/** Start of the week (Monday 00:00 local) containing `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
}

export const dayKey = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/**
 * Completed sets per muscle group in [from, to). Secondary muscles count
 * half, as in the program builder (fractional set counting).
 */
export function muscleSets(workouts: Workout[], from: Date, to: Date): Record<MuscleGroup, number> {
  const out = Object.fromEntries(MUSCLE_GROUPS.map((g) => [g, 0])) as Record<MuscleGroup, number>;
  for (const w of finished(workouts)) {
    const t = new Date(w.startedAt);
    if (t < from || t >= to) continue;
    for (const e of w.entries) {
      const ex = exerciseInfo(e.exerciseId);
      if (!ex) continue;
      const n = doneSets(e.sets).length;
      for (const g of ex.primary) out[g] += n;
      for (const g of ex.secondary) out[g] += n / 2;
    }
  }
  return out;
}

/** Consecutive weeks (ending this week or last week) with at least one workout. */
export function weekStreak(workouts: Workout[], now = new Date()): number {
  const weeks = new Set(finished(workouts).map((w) => weekStart(new Date(w.startedAt)).getTime()));
  let cursor = weekStart(now);
  // This week counts only once a workout is logged; otherwise start from last week.
  if (!weeks.has(cursor.getTime())) cursor = new Date(cursor.getTime() - 7 * 86400000);
  let n = 0;
  while (weeks.has(cursor.getTime())) {
    n++;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7);
  }
  return n;
}

/** Workouts grouped by local day key, for the calendar. */
export function workoutsByDay(workouts: Workout[]): Map<string, Workout[]> {
  const m = new Map<string, Workout[]>();
  for (const w of finished(workouts)) {
    const k = dayKey(w.startedAt);
    m.set(k, [...(m.get(k) ?? []), w]);
  }
  return m;
}

export const workoutMinutes = (w: Workout) =>
  w.finishedAt ? Math.max(1, Math.round((new Date(w.finishedAt).getTime() - new Date(w.startedAt).getTime()) / 60000)) : 0;
