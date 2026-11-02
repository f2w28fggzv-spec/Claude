// On-device coach: reads the training log and technique checks and adapts the
// plan. Rule-based and deterministic (no AI service; nothing leaves the
// phone), so every suggestion can be explained.
//
// Progression is "double progression": keep the weight and add reps until
// every set reaches the top of the rep range, then add weight. ACSM (2009)
// recommends a 2–10% load increase when the current load can be done for one
// to two reps over the target. Repeated technique faults lower the load and
// add the fault's corrective exercise (the Phase 5 rule in CLAUDE.md).
//
// Form gate (Phase 5): on full-analysis lifts, weight only goes up when the
// latest technique check (within FORM_WINDOW_DAYS) was clean on at least
// CLEAN_SHARE of its reps. No recent check: keep the weight and ask for one.
// Faults: keep the weight until a check comes back clean.
//
// Easier week: Bell et al. (2023, Delphi consensus, Sports Med Open 9:87)
// define a deload as a period of reduced training stress to manage fatigue,
// help recovery and improve readiness. The app offers one when two or more
// plan lifts stall; the amounts (one week, about half the sets, about 10%
// lighter) are this app's choice, not numbers from that paper.
import { getExercise } from '../data/exercises';
import { isBodyweight } from '../data/filters';
import { exerciseName } from './exercises';
import { MUSCLE_LABELS, type Exercise, type MuscleGroup } from '../data/types';
import type { Program, ProgramItem } from '../program/builder';
import { exerciseHistory, finished, formatSet, fromUnit, muscleSets, toUnit, weekStart, type SessionSummary } from './stats';
import type { EasyWeek, TechniqueSummary, Unit, Workout } from './types';

export type SuggestionKind = 'start' | 'increase' | 'repeat' | 'reduce' | 'technique' | 'check';

export interface Suggestion {
  kind: SuggestionKind;
  /** Kilograms; undefined for bodyweight or when there is no history yet. */
  weight?: number;
  /** Change from last time in kilograms (positive = heavier). */
  delta?: number;
  note: string;
  /** Corrective exercise to add, for technique suggestions. */
  corrective?: string;
  /** Form gate result on full-analysis lifts that are ready for more weight. */
  form?: FormState;
  /** The weight the coach will move to once the form gate passes (kg). */
  nextWeight?: number;
}

/** How long a technique check counts as recent, in days. */
export const FORM_WINDOW_DAYS = 21;
/** Share of a check's reps that must be clean for the form gate. */
export const CLEAN_SHARE = 0.8;

export type FormState = 'clean' | 'faults' | 'unchecked';

/** The latest recent technique check of an exercise, and whether it was clean enough. */
export function formState(technique: TechniqueSummary[], exerciseId: string, now = new Date()): { state: FormState; latest?: TechniqueSummary } {
  const since = now.getTime() - FORM_WINDOW_DAYS * 86400000;
  const latest = technique
    .filter((t) => t.exerciseId === exerciseId && t.reps > 0 && new Date(t.at).getTime() >= since && new Date(t.at).getTime() <= now.getTime())
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!latest) return { state: 'unchecked' };
  return { state: latest.cleanReps / latest.reps >= CLEAN_SHARE ? 'clean' : 'faults', latest };
}

const LOWER = new Set<MuscleGroup>(['quads', 'hamstrings', 'glutes']);
const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

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
  // Bodyweight moves: the added weight is a small part of the load (your body
  // is most of it), so the 10% cap below doesn't apply to it.
  if (isBodyweight(e)) return fromUnit(s.other, unit);
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
export function suggest(item: ProgramItem, history: SessionSummary[], technique: TechniqueSummary[], weightUnit: Unit = 'kg', now = new Date()): Suggestion {
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
          : ex && isBodyweight(ex)
            ? `Start with your body weight: ${lo}–${hi} reps with good form. Add weight once every set reaches ${hi}.`
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
    if (ex.analysis === 'full') {
      // Consistent form progresses load; otherwise hold until a clean check.
      const { state, latest } = formState(technique, item.exerciseId, now);
      if (state === 'clean') {
        return {
          kind: 'increase',
          weight,
          delta: weight - top,
          form: state,
          note: `Every set hit ${hi} ${unit} and your last technique check was clean (${latest!.cleanReps}/${latest!.reps} reps): add weight.`,
        };
      }
      if (state === 'faults') {
        const worst = Object.entries(latest!.faults).sort((a, b) => b[1] - a[1])[0]?.[0];
        const label = ex.faults.find((f) => f.id === worst)?.label.toLowerCase();
        return {
          kind: 'repeat',
          weight: top,
          delta: 0,
          form: state,
          nextWeight: weight,
          note: `Every set hit ${hi} ${unit}, but your last technique check had faults${label ? ` (${label})` : ''}. Keep this weight until a check comes back clean.`,
        };
      }
      return {
        kind: 'check',
        weight: top,
        delta: 0,
        form: state,
        nextWeight: weight,
        note: `Every set hit ${hi} ${unit}: you're ready for more weight. Check your technique on one set first; once it's clean, the coach adds weight.`,
      };
    }
    return { kind: 'increase', weight, delta: weight - top, note: `Every set hit ${hi} ${unit} last time: add weight.` };
  }
  return {
    kind: 'repeat',
    weight: weighted ? top : undefined,
    delta: 0,
    note: `Same ${weighted ? 'weight' : 'variation'}; aim for one more ${item.unit === 'seconds' ? 'few seconds' : 'rep'} per set, up to ${hi}.`,
  };
}

export interface TechniqueTrend {
  /** One point per check, oldest first: share of reps with no fault (0–1). */
  points: { at: string; share: number; clean: number; reps: number }[];
  /** The fault seen on the most reps, with how many checks it showed up in. */
  top?: { fault: string; reps: number; checks: number };
}

/** Technique checks of one exercise over time, and its most common fault. */
export function techniqueTrend(technique: TechniqueSummary[], exerciseId: string): TechniqueTrend {
  const checks = technique.filter((t) => t.exerciseId === exerciseId && t.reps > 0).sort((a, b) => a.at.localeCompare(b.at));
  const reps = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const t of checks) {
    for (const [f, n] of Object.entries(t.faults)) {
      if (n <= 0) continue;
      reps.set(f, (reps.get(f) ?? 0) + n);
      seen.set(f, (seen.get(f) ?? 0) + 1);
    }
  }
  const worst = [...reps].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return {
    points: checks.map((t) => ({ at: t.at, share: t.cleanReps / t.reps, clean: t.cleanReps, reps: t.reps })),
    top: worst ? { fault: worst[0], reps: worst[1], checks: seen.get(worst[0]) ?? 0 } : undefined,
  };
}

/** Easier week: about half the sets and about 10% lighter, for 7 days. */
export const EASY_WEEK = { setShare: 0.5, load: 0.9, days: 7 } as const;

export const easyWeekActive = (easy: EasyWeek | null | undefined, now = new Date()) =>
  !!easy && new Date(easy.startedAt).getTime() <= now.getTime() && now.getTime() < new Date(easy.until).getTime();

export function startEasyWeek(now = new Date()): EasyWeek {
  return { startedAt: now.toISOString(), until: new Date(now.getTime() + EASY_WEEK.days * 86400000).toISOString() };
}

/** The suggestion for a plan item plus its set count, adjusted during an easier week. */
export function planSuggestion(
  item: ProgramItem,
  history: SessionSummary[],
  technique: TechniqueSummary[],
  unit: Unit = 'kg',
  now = new Date(),
  easy = false,
): Suggestion & { sets: number } {
  const s = suggest(item, history, technique, unit, now);
  if (!easy) return { ...s, sets: item.sets };
  const sets = Math.max(1, Math.round(item.sets * EASY_WEEK.setShare));
  const last = history[history.length - 1];
  const lastTop = last ? Math.max(0, ...last.sets.map((x) => x.weight ?? 0)) : 0;
  const base = s.weight ?? (lastTop > 0 ? lastTop : undefined);
  const weight = base !== undefined && base > 0 ? roundLoad(base * EASY_WEEK.load, unit) : undefined;
  return {
    ...s,
    kind: weight !== undefined ? 'reduce' : s.kind,
    weight,
    delta: weight !== undefined && lastTop > 0 ? weight - lastTop : s.delta,
    nextWeight: undefined,
    sets,
    note: `Easier week: ${sets} set${sets === 1 ? '' : 's'}${weight !== undefined ? ', about 10% lighter' : ''}. Keep every rep smooth; normal training resumes next week.`,
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
  action?:
    | { label: string; kind: 'addCorrective'; exerciseId: string; correctiveId: string }
    | { label: string; kind: 'easyWeek' }
    | { label: string; kind: 'endEasyWeek' };
}

/** Coaching notes for the Plan tab, most important first. */
export function insights(
  program: Program | null,
  workouts: Workout[],
  technique: TechniqueSummary[],
  unit: Unit = 'kg',
  now = new Date(),
  easy: EasyWeek | null = null,
): Insight[] {
  const out: Insight[] = [];
  if (program && easyWeekActive(easy, now)) {
    out.push({
      id: 'easy-week-on',
      tone: 'good',
      title: `Easier week until ${new Date(easy!.until).toLocaleDateString(undefined, { weekday: 'long' })}`,
      body: 'About half the sets and 10% lighter on every plan day. Normal weights come back after.',
      action: { label: 'End it now', kind: 'endEasyWeek' },
    });
  }
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
      if (!cur || before.length === 0) continue;
      const name = exerciseName(e.exerciseId).toLowerCase();
      const prevBest = Math.max(...before.map((h) => h.bestE1rm));
      let note = '';
      if (cur.bestE1rm > 0 && prevBest > 0 && cur.bestSet) {
        // Loaded sets: compare estimated one-rep max.
        if (cur.bestE1rm > prevBest * 1.001) {
          const gain = Math.round(((cur.bestE1rm - prevBest) / prevBest) * 100);
          note = `${formatSet(cur.bestSet, unit)}: estimated one-rep max up ${gain || '<1'}%.`;
        }
      } else if (cur.bestE1rm === 0 && prevBest === 0) {
        // Body weight only (or holds): compare the best set.
        const prevReps = Math.max(...before.map((h) => h.maxReps));
        const prevHold = Math.max(...before.map((h) => h.maxSeconds));
        if (cur.maxSeconds > prevHold && cur.maxSeconds > 0) note = `${cur.maxSeconds} s hold, up from ${prevHold} s.`;
        else if (cur.maxReps > prevReps && cur.maxReps > 0) note = `${cur.maxReps} reps in a set, up from ${prevReps}.`;
      }
      if (note) {
        records.push(name);
        if (!first) first = note;
      }
    }
    if (records.length === 1) {
      out.push({ id: `pr-${latest.id}`, tone: 'good', title: `New best on ${records[0]}`, body: first });
    } else if (records.length > 1) {
      out.push({
        id: `pr-${latest.id}`,
        tone: 'good',
        title: `${records.length} new bests last workout`,
        body: `${capitalize(records.slice(0, -1).join(', '))} and ${records[records.length - 1]}. The coach raises those weights next time.`,
      });
    }
  }

  // Stalls: no e1RM improvement over the last three sessions. Two or more
  // stalled lifts suggest an easier week rather than one note per lift.
  if (program) {
    const ids = [...new Set(program.days.flatMap((d) => d.items.map((i) => i.exerciseId)))];
    const stalled = ids.filter((id) => {
      const h = exerciseHistory(done, id).filter((x) => x.bestE1rm > 0);
      if (h.length < 4) return false;
      return Math.max(...h.slice(-3).map((x) => x.bestE1rm)) <= Math.max(...h.slice(0, -3).map((x) => x.bestE1rm));
    });
    const recentEasy = !!easy && now.getTime() - new Date(easy.startedAt).getTime() < 28 * 86400000;
    const names = stalled.map((id) => exerciseName(id).toLowerCase());
    const list = names.length > 1 ? `${capitalize(names.slice(0, -1).join(', '))} and ${names[names.length - 1]}` : '';
    if (stalled.length >= 2 && recentEasy) {
      if (!easyWeekActive(easy, now)) {
        out.push({
          id: 'stalls',
          tone: 'info',
          title: `${stalled.length} lifts have stalled`,
          body: `${list} haven't improved in three sessions, and you had an easier week recently. Try swapping one of them for a variation for a few weeks, and look at your sleep and recovery.`,
        });
      }
    } else if (stalled.length >= 2) {
      out.push({
        id: 'easier-week',
        tone: 'info',
        title: 'Time for an easier week',
        body: `${list} haven't improved in three sessions. Take an easier week: the same exercises with about half the sets and 10% less weight, then build back up.`,
        action: { label: 'Make this week easier', kind: 'easyWeek' },
      });
    } else {
      for (const id of stalled) {
        out.push({
          id: `stall-${id}`,
          tone: 'info',
          title: `${exerciseName(id)} has stalled`,
          body: 'No progress in three sessions. Try one lighter session (about 10% less) and build back up, and look at your sleep and recovery.',
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
    // Muscles well behind the plan's weekly sets over the last two weeks,
    // once you've been training that long.
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
    if (new Date(done[0].startedAt) <= twoWeeksAgo) {
      const actual = muscleSets(done, twoWeeksAgo, to);
      const rows = program.inputs.groups
        .map((g) => ({ g, planned: 2 * (program.weeklySets[g] ?? 0), got: actual[g] }))
        .filter((r) => r.planned > 0);
      const behind = rows.filter((r) => r.got < r.planned * 0.5);
      const fmt = (n: number) => String(Math.round(n * 10) / 10);
      if (behind.length && behind.length === rows.length) {
        const share = rows.reduce((n, r) => n + r.got, 0) / rows.reduce((n, r) => n + r.planned, 0);
        out.push({
          id: 'behind-plan',
          tone: 'info',
          title: `About ${Math.round(share * 100)}% of your planned sets`,
          body: 'That’s over the last two weeks, for every muscle in your plan. Fit in the plan days you can; the coach keeps the order.',
        });
      } else if (behind.length) {
        out.push({
          id: 'behind-plan',
          tone: 'info',
          title: `Behind plan: ${behind.map((r) => MUSCLE_LABELS[r.g].toLowerCase()).join(', ')}`,
          body: `Last two weeks: ${behind.map((r) => `${MUSCLE_LABELS[r.g].toLowerCase()} ${fmt(r.got)} of ${fmt(r.planned)} planned sets`).join(', ')}. Finishing every exercise on your plan days closes the gap.`,
        });
      }
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

