// Weekly sets per muscle group against a target, for the body map.
//
// Sets are counted like the program builder does: primary muscles count a
// full set, secondary muscles half (fractional set counting). The target is
// the plan's weekly set target for that group; without a plan (or for groups
// the plan doesn't train) it is the beginner target from the program builder
// (10 sets a week, from the weekly-volume evidence cited there).
import { MUSCLE_GROUPS, type MuscleGroup } from '../data/types';
import { WEEKLY_SET_TARGET, type Program } from '../program/builder';
import { exerciseInfo } from './exercises';
import { doneSets, finished, muscleSets, weekStart } from './stats';
import type { Workout } from './types';

/** 0 = not trained, 1 = under a third of the target, 2 = under two thirds, 3 = under the target, 4 = target met. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface MuscleWeek {
  group: MuscleGroup;
  /** Sets this week (secondary work counts half). */
  sets: number;
  target: number;
  /** sets ÷ target. */
  share: number;
  level: HeatLevel;
  /** Exercises that trained this group as a main muscle this week, most sets first. */
  exercises: string[];
}

export const HEAT_LABELS: Record<HeatLevel, string> = {
  0: 'Not trained',
  1: 'Started',
  2: 'About halfway',
  3: 'Nearly there',
  4: 'Target met',
};

export function heatLevel(sets: number, target: number): HeatLevel {
  if (sets <= 0) return 0;
  const share = target > 0 ? sets / target : 1;
  return share >= 1 ? 4 : share >= 2 / 3 ? 3 : share >= 1 / 3 ? 2 : 1;
}

export function weeklyTarget(program: Program | null, group: MuscleGroup): number {
  return program?.targets[group] ?? program?.weeklySets[group] ?? WEEKLY_SET_TARGET[program?.inputs.level ?? 'beginner'];
}

/** Every muscle group's sets in the week (Monday to Sunday) containing `day`. */
export function weekMuscles(workouts: Workout[], program: Program | null, day = new Date()): MuscleWeek[] {
  const from = weekStart(day);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
  const sets = muscleSets(workouts, from, to);
  const byExercise = new Map<string, Map<string, number>>();
  for (const w of finished(workouts)) {
    const t = new Date(w.startedAt);
    if (t < from || t >= to) continue;
    for (const e of w.entries) {
      const info = exerciseInfo(e.exerciseId);
      const n = doneSets(e.sets).length;
      if (!info || !n) continue;
      for (const g of info.primary) {
        const m = byExercise.get(g) ?? new Map<string, number>();
        m.set(info.name, (m.get(info.name) ?? 0) + n);
        byExercise.set(g, m);
      }
    }
  }
  return MUSCLE_GROUPS.map((group) => {
    const target = weeklyTarget(program, group);
    const s = Math.round(sets[group] * 2) / 2;
    return {
      group,
      sets: s,
      target,
      share: target > 0 ? s / target : 0,
      level: heatLevel(s, target),
      exercises: [...(byExercise.get(group) ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name),
    };
  });
}
