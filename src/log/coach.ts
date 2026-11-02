// On-device coach: reads the training log and technique checks and adapts the
// plan. Rule-based and deterministic (no AI service; nothing leaves the
// phone), so every suggestion can be explained.
//
// Progression is "double progression": keep the weight and add reps until
// every set reaches the top of the rep range, then add weight. ACSM (2009)
// recommends a 2–10% load increase when the current load can be done for one
// to two reps over the target. Repeated technique faults lower the load and
// add the fault's corrective exercise (the Phase 5 rule in CLAUDE.md).
import { getExercise } from '../data/exercises';
import { MUSCLE_LABELS, type Exercise, type MuscleGroup } from '../data/types';
import type { Program, ProgramItem } from '../program/builder';
import { e1rm, exerciseHistory, finished, formatWeight, fromUnit, muscleSets, toUnit, weekStart, type SessionSummary } from './stats';
import type { TechniqueSummary, Unit, Workout } from './types';

export type SuggestionKind = 'start' | 'increase' | 'repeat' | 'reduce' | 'technique';

export interface Suggestion {
  kind: SuggestionKind;
  /** Kilograms; undefined for bodyweight or when there is no history yet. */
  weight?: number;
  /** Change from last time in kilograms (positive = heavier). */
  delta?: number;
  note: string;
  /** Corrective exercise to add, for technique suggestions. */
  corrective?: string;
}

const LOWER = new Set<MuscleGroup>(['quads', 'hamstrings', 'glutes']);
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/** Load jumps per unit: dumbbells, lower-body compounds, everything else, and the smallest step. */
const STEPS: Record<Unit, { handheld: number; lower: number; other: number; min: number }> = {
  kg: { handheld: 2, lower: 5, other: 2.5, min: 0.5 },
  lb: { handheld: 5, lower: 10, other: 5, min: 2.5 },
};

/** Smallest sensible load jump for an exercise, in kg (plate-friendly in the user's unit). */
export function loadStep(e: Exercise, current: number, unit: Unit = 'kg'): number {
  const s = STEPS[unit];
  const handheld = e.equipment.includes('dumbbell') || e.equipment.includes('kettlebell');
  const base = handheld ? s.handheld : e.role === 'compound' && e.primary.some((g) => LOWER.has(g)) ? s.lower : s.other;
  // Never more than 10% of the current load (ACSM 2009: 2–10%), at least the smallest step.
  return fromUnit(Math.max(s.min, Math.min(base, roundTo(toUnit(current, unit) * 0.1, s.min))), unit);
}

/** A load in kg rounded to the smallest step of the user's unit. */
const roundLoad = (kg: number, unit: Unit) => fromUnit(roundTo(toUnit(kg, unit), STEPS[unit].min), unit);

/** Technique faults seen in at least 2 of the last 3 checks of an exercise. */
export function repeatedFaults(technique: TechniqueSummary[], exerciseId: string): string[] {
  const recent = technique
    .filter((t) => t.exerciseId === exerciseId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 3);
  const counts = new Map<string, number>();
  for (const t of recent) for (const [f, n] of Object.entries(t.faults)) if (n > 0) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts].filter(([, n]) => n >= 2).map(([f]) => f);
}

/** The next weight / reps to aim for on one planned exercise. */
export function suggest(item: ProgramItem, history: SessionSummary[], technique: TechniqueSummary[], weightUnit: Unit = 'kg'): Suggestion {
  const ex = getExercise(item.exerciseId);
  const [lo, hi] = item.reps;
  const last = history[history.length - 1];
  const unit = item.unit === 'seconds' ? 's' : 'reps';
  if (!ex || !last) {
    return {
      kind: 'start',
      note:
        item.unit === 'seconds'
          ? `Hold for ${lo}–${hi} s with good form.`
          : `Start light: a weight you could lift for ${hi + 2} reps with good form.`,
    };
  }

  const weighted = last.sets.some((s) => (s.weight ?? 0) > 0);
  const top = Math.max(0, ...last.sets.map((s) => s.weight ?? 0));
  const atTop = weighted ? last.sets.filter((s) => (s.weight ?? 0) === top) : last.sets;
  const amount = (s: (typeof atTop)[number]) => (item.unit === 'seconds' ? (s.seconds ?? 0) : (s.reps ?? 0));
  const allTop = atTop.length >= item.sets && atTop.every((s) => amount(s) >= hi);

  // Repeated technique faults come first: lighter load, plus the corrective.
  const faults = repeatedFaults(technique, item.exerciseId);
  if (faults.length) {
    const fault = ex.faults.find((f) => f.id === faults[0]);
    const weight = weighted ? roundLoad(top * 0.9, weightUnit) : undefined;
    return {
      kind: 'technique',
      weight,
      delta: weight !== undefined ? weight - top : undefined,
      note: `${fault?.label ?? 'A fault'} showed up in your recent technique checks. ${weighted ? 'About 10% lighter' : 'Fewer reps'} until the form is consistent.`,
      corrective: fault?.corrective,
    };
  }

  // Two sessions in a row below the bottom of the range at the same load: back off.
  const prev = history[history.length - 2];
  const below = (h: SessionSummary | undefined) =>
    !!h && h.sets.length > 0 && Math.max(0, ...h.sets.map((s) => s.weight ?? 0)) === top && Math.min(...h.sets.map(amount)) < lo;
  if (weighted && below(last) && below(prev)) {
    const weight = roundLoad(top * 0.9, weightUnit);
    return { kind: 'reduce', weight, delta: weight - top, note: `Below ${lo} ${unit} two sessions running: about 10% lighter to build back up.` };
  }

  if (allTop) {
    if (!weighted) {
      return { kind: 'increase', note: item.unit === 'seconds' ? 'Every set hit the target: add 5–10 s.' : `Every set hit ${hi} reps: add reps or move to a harder variation.` };
    }
    const weight = roundLoad(top + loadStep(ex, top, weightUnit), weightUnit);
    return { kind: 'increase', weight, delta: weight - top, note: `Every set hit ${hi} ${unit} last time: add weight.` };
  }
  return {
    kind: 'repeat',
    weight: weighted ? top : undefined,
    delta: 0,
    note: `Same ${weighted ? 'weight' : 'variation'}; aim for one more ${item.unit === 'seconds' ? 'few seconds' : 'rep'} per set, up to ${hi}.`,
  };
}

/** Which plan day comes next: the one after the last day you trained from this plan. */
export function nextDayIndex(program: Program, workouts: Workout[]): number {
  const last = finished(workouts)
    .filter((w) => w.planId === program.id && w.dayIndex !== undefined)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return last ? (last.dayIndex! + 1) % program.days.length : 0;
}

export interface Insight {
  id: string;
  tone: 'good' | 'warn' | 'info';
  title: string;
  body: string;
  action?: { label: string; kind: 'addCorrective'; exerciseId: string; correctiveId: string };
}

/** Coaching notes for the Plan tab, most important first. */
export function insights(
  program: Program | null,
  workouts: Workout[],
  technique: TechniqueSummary[],
  unit: Unit = 'kg',
  now = new Date(),
): Insight[] {
  const out: Insight[] = [];
  const done = finished(workouts).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (done.length === 0) {
    out.push({
      id: 'first',
      tone: 'info',
      title: 'Log your first workout',
      body: 'Tap Start workout and log your sets. The coach adjusts your weights and plan from there.',
    });
  }

  // Repeated technique faults → corrective exercise.
  const exercisesChecked = [...new Set(technique.map((t) => t.exerciseId))];
  for (const id of exercisesChecked) {
    const ex = getExercise(id);
    for (const f of repeatedFaults(technique, id)) {
      const fault = ex?.faults.find((x) => x.id === f);
      if (!ex || !fault) continue;
      const corrective = getExercise(fault.corrective);
      const inPlan = program?.days.some((d) => d.items.some((i) => i.exerciseId === fault.corrective));
      out.push({
        id: `fault-${id}-${f}`,
        tone: 'warn',
        title: `${fault.label} on ${ex.name.toLowerCase()}`,
        body: `Seen in 2 of your last 3 technique checks. ${fault.cue}${corrective && !inPlan ? ` Adding ${corrective.name.toLowerCase()} helps.` : ''}`,
        action:
          corrective && program && !inPlan
            ? { label: `Add ${corrective.name} to my plan`, kind: 'addCorrective', exerciseId: id, correctiveId: corrective.id }
            : undefined,
      });
    }
  }

  // New personal records in the latest workout (if it was this past week),
  // grouped into one note so a good day doesn't flood the coach.
  const latest = done[done.length - 1];
  if (latest && now.getTime() - new Date(latest.startedAt).getTime() < 7 * 86400000) {
    const records: string[] = [];
    let first = '';
    for (const e of latest.entries) {
      const hist = exerciseHistory(done, e.exerciseId);
      const cur = hist.find((h) => h.workoutId === latest.id);
      const before = hist.filter((h) => h.date < latest.startedAt);
      if (!cur || before.length === 0 || !cur.bestSet) continue;
      const prevBest = Math.max(...before.map((h) => h.bestE1rm));
      if (cur.bestE1rm > prevBest * 1.001) {
        const name = getExercise(e.exerciseId)?.name.toLowerCase() ?? e.exerciseId;
        const gain = Math.round(((cur.bestE1rm - prevBest) / prevBest) * 100);
        records.push(name);
        if (!first) first = `${formatWeight(cur.bestSet.weight, unit)} × ${cur.bestSet.reps}: estimated one-rep max up ${gain || '<1'}%.`;
      }
    }
    if (records.length === 1) {
      out.push({ id: `pr-${latest.id}`, tone: 'good', title: `New best on ${records[0]}`, body: first });
    } else if (records.length > 1) {
      out.push({
        id: `pr-${latest.id}`,
        tone: 'good',
        title: `${records.length} new bests last workout`,
        body: `${records.slice(0, -1).join(', ')} and ${records[records.length - 1]}. The coach raises those weights next time.`,
      });
    }
  }

  // Stalls: no e1RM improvement over the last three sessions.
  if (program) {
    const ids = [...new Set(program.days.flatMap((d) => d.items.map((i) => i.exerciseId)))];
    for (const id of ids) {
      const h = exerciseHistory(done, id).filter((s) => s.bestE1rm > 0);
      if (h.length < 4) continue;
      const recent = Math.max(...h.slice(-3).map((s) => s.bestE1rm));
      const earlier = Math.max(...h.slice(0, -3).map((s) => s.bestE1rm));
      if (recent <= earlier) {
        out.push({
          id: `stall-${id}`,
          tone: 'info',
          title: `${getExercise(id)?.name ?? id} has stalled`,
          body: 'No progress in three sessions. Try one lighter week (about 10% less) and build back up, and check your sleep and recovery.',
        });
      }
    }
  }

  // This week against the plan.
  if (program && done.length > 0) {
    const from = weekStart(now);
    const to = new Date(from.getTime() + 7 * 86400000);
    const thisWeek = done.filter((w) => new Date(w.startedAt) >= from).length;
    const planned = program.days.length;
    const daysLeft = 7 - ((now.getDay() + 6) % 7) - 1;
    if (thisWeek >= planned) {
      out.push({ id: 'week-done', tone: 'good', title: 'Week complete', body: `All ${planned} planned workouts done this week. Nice consistency.` });
    } else if (planned - thisWeek > daysLeft + 1) {
      out.push({
        id: 'week-behind',
        tone: 'info',
        title: `${thisWeek} of ${planned} workouts this week`,
        body: 'You won’t fit every planned day this week. Do the next day in your plan; the coach keeps the order.',
      });
    }
    // Muscles not trained in the last 10 days, once you've been training that long.
    const tenDaysAgo = new Date(now.getTime() - 10 * 86400000);
    const recentSets = muscleSets(done, tenDaysAgo, to);
    const missed = program.inputs.groups.filter((g) => recentSets[g] === 0);
    if (missed.length && new Date(done[0].startedAt) <= tenDaysAgo) {
      out.push({
        id: 'missed-groups',
        tone: 'info',
        title: 'Some muscles are missing out',
        body: `No ${missed.map((g) => MUSCLE_LABELS[g].toLowerCase()).join(', ')} sets in the last 10 days.`,
      });
    }
  }
  return out;
}

/** Adds a corrective exercise to the plan day that has the faulted exercise. */
export function addCorrective(program: Program, exerciseId: string, correctiveId: string): Program {
  const days = program.days.map((d) => {
    const at = d.items.findIndex((i) => i.exerciseId === exerciseId);
    if (at < 0 || d.items.some((i) => i.exerciseId === correctiveId)) return d;
    const corrective = getExercise(correctiveId);
    const item: ProgramItem = {
      exerciseId: correctiveId,
      sets: 2,
      reps: corrective?.tracking.kind === 'hold' ? [20, 30] : [8, 12],
      unit: corrective?.tracking.kind === 'hold' ? 'seconds' : 'reps',
      restSec: 60,
      perSide: !!corrective?.unilateral,
    };
    return { ...d, items: [...d.items.slice(0, at + 1), item, ...d.items.slice(at + 1)] };
  });
  return { ...program, days };
}

export { e1rm };
