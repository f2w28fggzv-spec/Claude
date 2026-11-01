// Rule-based program builder. No AI calls, no randomness: the same inputs
// always give the same program.
//
// Evidence behind the numbers:
// - Weekly sets per muscle: Schoenfeld, Ogborn & Krieger (2017), "Dose-response
//   relationship between weekly resistance training volume and increases in
//   muscle mass", J Sports Sci 35(11):1073-1082: 10+ weekly sets per muscle
//   beat fewer. Baz-Valle et al. (2022), J Hum Kinet 81:199-210, support
//   roughly 12-20 weekly sets for trained lifters.
// - Frequency: Schoenfeld, Ogborn & Krieger (2016), "Effects of resistance
//   training frequency on measures of muscle hypertrophy", Sports Med
//   46(11):1689-1697: training each muscle at least twice a week beat once.
// - Reps and rest: ACSM position stand (2009), "Progression models in
//   resistance training for healthy adults", Med Sci Sports Exerc
//   41(3):687-708: 8-12 reps for novice/intermediate hypertrophy, an emphasis
//   on 6-12 for advanced; 1-2 min rest, 2-3 min for heavy multi-joint lifts.
// - Unloaded bodyweight moves use higher reps: hypertrophy is similar across
//   low and high loads when sets go close to failure; Schoenfeld et al.
//   (2017), "Strength and hypertrophy adaptations between low- vs. high-load
//   resistance training", J Strength Cond Res 31(12):3508-3523.
// - Order: multi-joint before single-joint; Simão et al. (2012), "Exercise
//   order in resistance training", Sports Med 42(3):251-265.
// - Secondary muscles count as half a set (fractional counting), as in
//   Pelland et al. (2024), "The resistance training dose-response" (SportRxiv
//   preprint).
// Values marked HEURISTIC below are practical limits, not from a study.
import { EXERCISES } from '../data/exercises';
import {
  LEVELS,
  MUSCLE_GROUPS,
  MUSCLE_LABELS,
  type Equipment,
  type Exercise,
  type Level,
  type MuscleGroup,
} from '../data/types';

export type EquipmentSetting = 'fullGym' | 'dumbbells' | 'bodyweight';

export const EQUIPMENT_SETTING_LABELS: Record<EquipmentSetting, string> = {
  fullGym: 'Full gym',
  dumbbells: 'Dumbbells only',
  bodyweight: 'Bodyweight',
};

/** A pull-up bar is assumed everywhere. "Dumbbells only" assumes no bench. */
export const AVAILABLE_EQUIPMENT: Record<EquipmentSetting, ReadonlySet<Equipment>> = {
  fullGym: new Set<Equipment>([
    'barbell',
    'dumbbell',
    'kettlebell',
    'bodyweight',
    'pullupBar',
    'bench',
    'rack',
    'cable',
    'machine',
    'band',
    'dipBars',
    'ezBar',
  ]),
  dumbbells: new Set<Equipment>(['dumbbell', 'bodyweight', 'pullupBar']),
  bodyweight: new Set<Equipment>(['bodyweight', 'pullupBar']),
};

export interface ProgramInputs {
  groups: MuscleGroup[];
  daysPerWeek: number;
  level: Level;
  equipment: EquipmentSetting;
}

export interface ProgramItem {
  exerciseId: string;
  sets: number;
  reps: [number, number];
  unit: 'reps' | 'seconds';
  restSec: number;
  perSide: boolean;
}

export interface ProgramDay {
  name: string;
  groups: MuscleGroup[];
  items: ProgramItem[];
}

export interface Program {
  id: string;
  name: string;
  createdAt: string;
  inputs: ProgramInputs;
  days: ProgramDay[];
  /** Planned weekly sets per selected group (secondary work counts half). */
  weeklySets: Partial<Record<MuscleGroup, number>>;
  /** Weekly set target per selected group after any scaling. */
  targets: Partial<Record<MuscleGroup, number>>;
  notes: string[];
}

export const MIN_DAYS = 1;
export const MAX_DAYS = 6;

/** Weekly sets per muscle group (Schoenfeld 2017; Baz-Valle 2022). */
export const WEEKLY_SET_TARGET: Record<Level, number> = {
  beginner: 10,
  intermediate: 14,
  advanced: 18,
};

/** HEURISTIC: total working sets per session before it gets too long. */
export const MAX_SETS_PER_SESSION: Record<Level, number> = {
  beginner: 16,
  intermediate: 22,
  advanced: 26,
};

/** HEURISTIC: sets of one exercise in a session. */
const SETS_PER_EXERCISE: Record<Level, [number, number]> = {
  beginner: [2, 3],
  intermediate: [2, 4],
  advanced: [2, 4],
};

export type PrescriptionKind = 'compound' | 'isolation' | 'hold' | 'bodyweight';

/** Equipment that adds no load; pull-ups are excluded since they are hard enough as is. */
const UNLOADED = new Set<Equipment>(['bodyweight', 'bench', 'dipBars']);

export function prescriptionKind(e: Exercise): PrescriptionKind {
  if (e.tracking.kind === 'hold') return 'hold';
  if (e.equipment.every((q) => UNLOADED.has(q))) return 'bodyweight';
  return e.role;
}

/**
 * Reps (or seconds for holds) and rest. Loaded lifts follow ACSM 2009;
 * bodyweight follows Schoenfeld 2017 (take sets close to failure).
 * Hold durations are HEURISTIC.
 */
export const PRESCRIPTION: Record<
  Level,
  Record<PrescriptionKind, { reps: [number, number]; restSec: number }>
> = {
  beginner: {
    bodyweight: { reps: [5, 15], restSec: 90 },
    compound: { reps: [8, 12], restSec: 90 },
    isolation: { reps: [10, 15], restSec: 60 },
    hold: { reps: [20, 30], restSec: 60 },
  },
  intermediate: {
    bodyweight: { reps: [10, 20], restSec: 90 },
    compound: { reps: [6, 10], restSec: 120 },
    isolation: { reps: [10, 15], restSec: 75 },
    hold: { reps: [30, 45], restSec: 60 },
  },
  advanced: {
    bodyweight: { reps: [15, 25], restSec: 90 },
    compound: { reps: [5, 8], restSec: 180 },
    isolation: { reps: [8, 12], restSec: 90 },
    hold: { reps: [45, 60], restSec: 60 },
  },
};

/** Sessions per week for each muscle (Schoenfeld 2016: at least twice). */
function frequency(days: number): number {
  if (days <= 1) return 1;
  if (days >= 5) return 3;
  return 2;
}

/** Bigger muscles are scheduled first so they get the best day spread. */
const SCHEDULE_ORDER: MuscleGroup[] = [
  'quads',
  'back',
  'chest',
  'hamstrings',
  'glutes',
  'shoulders',
  'biceps',
  'triceps',
  'calves',
  'core',
];

export function availableExercises(equipment: EquipmentSetting, level: Level): Exercise[] {
  const have = AVAILABLE_EQUIPMENT[equipment];
  const rank = LEVELS.indexOf(level);
  return EXERCISES.filter(
    (e) =>
      e.equipment.every((q) => have.has(q)) &&
      LEVELS.indexOf(e.minLevel) <= rank &&
      (!e.maxLevel || LEVELS.indexOf(e.maxLevel) >= rank),
  );
}

const isMachine = (e: Exercise) => e.equipment.includes('machine') || e.equipment.includes('cable');

export function buildProgram(inputs: ProgramInputs, now = new Date()): Program {
  const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(inputs.daysPerWeek)));
  const groups = SCHEDULE_ORDER.filter((g) => inputs.groups.includes(g));
  const { level } = inputs;
  const notes: string[] = [];
  if (groups.length === 0) throw new Error('Select at least one muscle group.');

  // Weekly targets, scaled down if they would overflow the session cap.
  const capacity = MAX_SETS_PER_SESSION[level] * days;
  let perGroup = WEEKLY_SET_TARGET[level];
  if (perGroup * groups.length > capacity) {
    perGroup = Math.max(2, Math.floor(capacity / groups.length));
    notes.push(
      `Weekly sets per muscle were reduced from ${WEEKLY_SET_TARGET[level]} to ${perGroup} so each session stays a manageable length. Add training days to raise them.`,
    );
  }
  const targets: Partial<Record<MuscleGroup, number>> = {};
  for (const g of groups) targets[g] = perGroup;

  // Assign each group to evenly spaced days, balancing sets across days.
  const f = Math.min(frequency(days), days);
  const dayLoad = new Array<number>(days).fill(0);
  const dayGroups: MuscleGroup[][] = Array.from({ length: days }, () => []);
  for (const g of groups) {
    let bestDays: number[] = [];
    let bestCost = Infinity;
    for (let offset = 0; offset < days; offset++) {
      const chosen = [...new Set(Array.from({ length: f }, (_, k) => (offset + Math.floor((k * days) / f)) % days))];
      const cost = Math.max(...chosen.map((d) => dayLoad[d])) * 1000 + chosen.reduce((s, d) => s + dayLoad[d], 0);
      if (cost < bestCost) {
        bestCost = cost;
        bestDays = chosen;
      }
    }
    const share = perGroup / bestDays.length;
    for (const d of bestDays) {
      dayGroups[d].push(g);
      dayLoad[d] += share;
    }
  }

  const pool = availableExercises(inputs.equipment, level);
  const weekly: Partial<Record<MuscleGroup, number>> = {};
  for (const g of groups) weekly[g] = 0;
  const usedBefore = new Map<string, number>(); // exerciseId -> times used this week
  const [minSets, maxSets] = SETS_PER_EXERCISE[level];
  const missing = new Set<MuscleGroup>();
  const sessionCap = MAX_SETS_PER_SESSION[level];

  const programDays: ProgramDay[] = dayGroups.map((todays) => {
    const remaining = new Map<MuscleGroup, number>();
    for (const g of todays) {
      const sessions = dayGroups.filter((dg) => dg.includes(g)).length;
      remaining.set(g, perGroup / sessions);
    }
    const items: { item: ProgramItem; exercise: Exercise }[] = [];
    const usedToday = new Set<string>();
    const hasCompound = new Set<MuscleGroup>();

    let dayTotal = 0;
    for (let guard = 0; guard < 40; guard++) {
      if (dayTotal + minSets > sessionCap) break;
      // Group with the most sets still to place today.
      const next = [...remaining.entries()]
        .filter(([, r]) => r >= 1)
        .sort((a, b) => b[1] - a[1] || SCHEDULE_ORDER.indexOf(a[0]) - SCHEDULE_ORDER.indexOf(b[0]))[0];
      if (!next) break;
      const [g, need] = next;
      const candidates = pool.filter((e) => e.primary.includes(g) && !usedToday.has(e.id));
      if (candidates.length === 0) {
        if (!pool.some((e) => e.primary.includes(g))) missing.add(g);
        remaining.set(g, 0);
        continue;
      }
      const wantCompound = !hasCompound.has(g);
      const score = (e: Exercise) => {
        let s = 0;
        if (e.role === 'compound') s += wantCompound ? 6 : -1;
        else s += wantCompound ? 0 : 2;
        // Credit for other groups still needing work today.
        for (const p of e.primary) if (p !== g && (remaining.get(p) ?? 0) >= 1) s += 2;
        for (const p of e.secondary) if ((remaining.get(p) ?? 0) >= 1) s += 0.5;
        // Unselected primary groups add fatigue without counting toward goals.
        for (const p of e.primary) if (!groups.includes(p)) s -= 1.5;
        if (isMachine(e)) s -= 1; // free weights keep joints visible to the camera
        if (e.unilateral) s -= 0.5; // takes twice as long
        s -= (usedBefore.get(e.id) ?? 0) * 3; // rotate exercises across days
        return s;
      };
      const pick = candidates
        .map((e) => ({ e, s: score(e) }))
        .sort((a, b) => b.s - a.s || EXERCISES.indexOf(a.e) - EXERCISES.indexOf(b.e))[0].e;

      const sets = Math.max(minSets, Math.min(maxSets, Math.round(need), sessionCap - dayTotal));
      dayTotal += sets;
      const kind = prescriptionKind(pick);
      const rx = PRESCRIPTION[level][kind];
      items.push({
        exercise: pick,
        item: {
          exerciseId: pick.id,
          sets,
          reps: rx.reps,
          unit: kind === 'hold' ? 'seconds' : 'reps',
          restSec: rx.restSec,
          perSide: !!pick.unilateral,
        },
      });
      usedToday.add(pick.id);
      usedBefore.set(pick.id, (usedBefore.get(pick.id) ?? 0) + 1);
      // Once a group has had its first exercise today, later picks lean isolation.
      for (const p of pick.primary) {
        if (!remaining.has(p)) continue;
        hasCompound.add(p);
        remaining.set(p, remaining.get(p)! - sets);
      }
      for (const p of pick.secondary) {
        if (remaining.has(p)) remaining.set(p, remaining.get(p)! - sets * 0.5);
      }
    }

    // Weekly tally over all selected groups, scheduled today or not.
    for (const { item, exercise } of items) {
      for (const p of exercise.primary) if (p in weekly) weekly[p]! += item.sets;
      for (const p of exercise.secondary) if (p in weekly) weekly[p]! += item.sets * 0.5;
    }

    // Multi-joint first, holds last (Simão et al. 2012).
    const order = (e: Exercise) => (e.tracking.kind === 'hold' ? 2 : e.role === 'compound' ? 0 : 1);
    items.sort((a, b) => order(a.exercise) - order(b.exercise));

    return { name: '', groups: todays, items: items.map((i) => i.item) };
  });
  const trainingDays = programDays.filter((d) => d.items.length > 0);
  trainingDays.forEach((d, i) => (d.name = `Day ${i + 1}`));
  if (trainingDays.length < days) {
    notes.push(
      `Your selection fits in ${trainingDays.length} day${trainingDays.length === 1 ? '' : 's'} a week at the recommended frequency, so the other days are rest days.`,
    );
  }

  const untrained = groups.filter((g) => !missing.has(g) && (weekly[g] ?? 0) === 0);
  if (untrained.length > 0) {
    notes.push(
      `Not enough room for ${untrained.map((g) => MUSCLE_LABELS[g].toLowerCase()).join(', ')} this week. Add training days or select fewer muscle groups.`,
    );
  }
  const short = groups.filter((g) => {
    const sets = weekly[g] ?? 0;
    return sets > 0 && sets < 0.75 * (targets[g] ?? 0);
  });
  if (short.length > 0) {
    notes.push(
      `${short.map((g) => MUSCLE_LABELS[g]).join(', ')} get${short.length === 1 ? 's' : ''} fewer sets than the ${perGroup}-set weekly target because sessions are full. Add training days to fix this.`,
    );
  }
  for (const g of missing) {
    notes.push(`No ${MUSCLE_LABELS[g].toLowerCase()} exercises match your equipment, so ${MUSCLE_LABELS[g].toLowerCase()} is not trained directly.`);
  }

  const label = groups.length === MUSCLE_GROUPS.length ? 'Full body' : groups.map((g) => MUSCLE_LABELS[g]).join(', ');
  return {
    id: `p${now.getTime().toString(36)}`,
    name: `${label} · ${days}×/week`,
    createdAt: now.toISOString(),
    inputs: { ...inputs, daysPerWeek: days, groups },
    days: trainingDays,
    weeklySets: weekly,
    targets,
    notes,
  };
}
