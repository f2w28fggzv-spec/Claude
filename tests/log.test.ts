import { describe, expect, it } from 'vitest';
import { addCorrective, easyWeekActive, formState, insights, loadStep, nextDayIndex, repeatedFaults, startEasyWeek, suggest, techniqueTrend } from '../src/log/coach';
import {
  e1rm,
  exerciseHistory,
  formatSet,
  formatSetShort,
  formatWeight,
  fromUnit,
  muscleSets,
  personalRecords,
  setLoad,
  toUnit,
  weekStart,
  weekStreak,
  workoutVolume,
  workoutsByDay,
} from '../src/log/stats';
import type { Routine, SetEntry, TechniqueSummary, Workout } from '../src/log/types';
import { addExercise, applyNextWeight, completeSet, emptyWorkout, finishWorkout, repeatWorkout, routineFromWorkout, startFromPlan, startRoutine } from '../src/log/session';
import { isBodyweight } from '../src/data/filters';
import { heatLevel, weekMuscles } from '../src/log/muscles';
import { getExercise } from '../src/data/exercises';
import { buildProgram, lifterNotes, personalPrescription, type ProgramItem } from '../src/program/builder';
import { ageOf, birthYearFromAge, figureOf, formatHeight, trainingSex } from '../src/profile';
import type { MuscleGroup } from '../src/data/types';

const day = (iso: string, h = 18) => new Date(`${iso}T${String(h).padStart(2, '0')}:00:00`).toISOString();
const sets = (weight: number | undefined, ...reps: number[]): SetEntry[] => reps.map((r) => ({ weight, reps: r, done: true }));
let n = 0;
const workout = (iso: string, entries: { id: string; sets: SetEntry[] }[], extra: Partial<Workout> = {}): Workout => ({
  id: `w${++n}`,
  startedAt: day(iso),
  finishedAt: day(iso, 19),
  entries: entries.map((e) => ({ exerciseId: e.id, sets: e.sets })),
  ...extra,
});
const item = (exerciseId: string, reps: [number, number] = [6, 10], setCount = 3): ProgramItem => ({
  exerciseId,
  sets: setCount,
  reps,
  unit: 'reps',
  restSec: 120,
  perSide: false,
});
const check = (exerciseId: string, iso: string, faults: Record<string, number>): TechniqueSummary => ({
  exerciseId,
  at: day(iso),
  reps: 5,
  faults,
  cleanReps: 5 - Math.max(0, ...Object.values(faults)),
});

describe('stats', () => {
  it('estimates one-rep max with Epley', () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(100, 10)).toBeCloseTo(133.33, 1);
    expect(e1rm(0, 5)).toBe(0);
  });

  it('formats weights in the chosen unit', () => {
    expect(formatWeight(60, 'kg')).toBe('60 kg');
    expect(formatWeight(61.25, 'kg')).toBe('61.25 kg');
    expect(formatWeight(100, 'lb')).toBe('220.5 lb');
    expect(formatWeight(fromUnit(135, 'lb'), 'lb')).toBe('135 lb');
    expect(formatWeight(undefined, 'kg')).toBe('–');
  });

  it('summarises exercise history, records and volume', () => {
    const log = [
      workout('2026-10-01', [{ id: 'back-squat', sets: sets(100, 5, 5, 5) }]),
      workout('2026-10-04', [{ id: 'back-squat', sets: [...sets(105, 5, 4), { weight: 120, reps: 3, done: false }] }]),
    ];
    const h = exerciseHistory(log, 'back-squat');
    expect(h.map((x) => x.date)).toEqual([day('2026-10-01'), day('2026-10-04')]);
    expect(h[1].sets).toHaveLength(2); // the unfinished set doesn't count
    expect(h[1].bestSet).toMatchObject({ weight: 105, reps: 5 });
    expect(personalRecords(h)).toEqual({ bestE1rm: e1rm(105, 5), heaviest: 105, mostReps: 5, mostAdded: 0, longestHold: 0 });
    expect(workoutVolume(log[0])).toBe(1500);
  });

  it('counts weekly sets per muscle with secondary muscles at half', () => {
    const log = [workout('2026-10-06', [{ id: 'bench-press', sets: sets(60, 8, 8, 8, 8) }])];
    const s = muscleSets(log, new Date('2026-10-05T00:00:00'), new Date('2026-10-12T00:00:00'));
    expect(s.chest).toBe(4);
    expect(s.triceps).toBe(2);
    expect(s.quads).toBe(0);
  });

  it('counts week streaks', () => {
    const now = new Date('2026-10-22T12:00:00'); // Thursday
    const log = [workout('2026-10-20', []), workout('2026-10-14', []), workout('2026-10-07', []), workout('2026-09-23', [])];
    expect(weekStreak(log, now)).toBe(3);
    expect(weekStreak(log.slice(1), now)).toBe(2); // nothing yet this week: count from last week
    expect(weekStreak([], now)).toBe(0);
    expect(weekStart(now).getDay()).toBe(1);
  });

  it('groups workouts by day for the calendar', () => {
    const log = [workout('2026-10-20', []), workout('2026-10-20', []), workout('2026-10-21', [])];
    const m = workoutsByDay(log);
    expect(m.get('2026-10-20')).toHaveLength(2);
    expect(m.get('2026-10-21')).toHaveLength(1);
  });
});

describe('coach: next weights', () => {
  const squat = item('back-squat', [6, 10], 3);
  const hist = (log: Workout[], id = 'back-squat') => exerciseHistory(log, id);

  it('starts light with no history', () => {
    expect(suggest(squat, [], [])).toMatchObject({ kind: 'start' });
  });

  it('adds weight once every set reaches the top of the range (after a clean check on full-analysis lifts)', () => {
    const log = [workout('2026-10-01', [{ id: 'back-squat', sets: sets(100, 10, 10, 10) }])];
    const s = suggest(squat, hist(log), [check('back-squat', '2026-10-01', {})], 'kg', new Date('2026-10-03T12:00:00'));
    expect(s).toMatchObject({ kind: 'increase', weight: 105, delta: 5, form: 'clean' });
    // Basic-analysis lifts aren't gated.
    const curl = suggest(item('dumbbell-curl', [8, 12]), hist([workout('2026-10-01', [{ id: 'dumbbell-curl', sets: sets(12, 12, 12, 12) }])], 'dumbbell-curl'), []);
    expect(curl).toMatchObject({ kind: 'increase', weight: 13 }); // 12 kg + 10% cap
    expect(curl.form).toBeUndefined();
  });

  it('holds the weight until a technique check is clean on full-analysis lifts', () => {
    const log = [workout('2026-10-01', [{ id: 'back-squat', sets: sets(100, 10, 10, 10) }])];
    const at = new Date('2026-10-03T12:00:00');
    // No recent check: keep the weight and ask for one.
    const none = suggest(squat, hist(log), [], 'kg', at);
    expect(none).toMatchObject({ kind: 'check', weight: 100, delta: 0, nextWeight: 105, form: 'unchecked' });
    // A check older than the window doesn't count.
    expect(suggest(squat, hist(log), [check('back-squat', '2026-09-01', {})], 'kg', at).kind).toBe('check');
    // Faults in the latest check (but not repeated): hold and name the fault.
    const faulty = suggest(squat, hist(log), [check('back-squat', '2026-10-02', { shallowDepth: 2 })], 'kg', at);
    expect(faulty).toMatchObject({ kind: 'repeat', weight: 100, form: 'faults' });
    expect(faulty.note).toMatch(/depth/i);
    // 4 of 5 clean reps is clean enough (80%).
    expect(suggest(squat, hist(log), [check('back-squat', '2026-10-02', { shallowDepth: 1 })], 'kg', at).kind).toBe('increase');
  });

  it('reads the form gate from the latest recent check', () => {
    const at = new Date('2026-10-10T12:00:00');
    expect(formState([], 'back-squat', at).state).toBe('unchecked');
    const tech = [check('back-squat', '2026-10-01', { shallowDepth: 3 }), check('back-squat', '2026-10-08', {})];
    expect(formState(tech, 'back-squat', at)).toMatchObject({ state: 'clean', latest: { at: day('2026-10-08') } });
    expect(formState(tech, 'back-squat', new Date('2026-10-05T12:00:00')).state).toBe('faults');
  });

  it('keeps the weight while reps are still climbing', () => {
    const s = suggest(squat, hist([workout('2026-10-01', [{ id: 'back-squat', sets: sets(100, 10, 9, 8) }])]), []);
    expect(s).toMatchObject({ kind: 'repeat', weight: 100, delta: 0 });
  });

  it('backs off after two sessions below the range', () => {
    const log = [
      workout('2026-10-01', [{ id: 'back-squat', sets: sets(100, 6, 5, 5) }]),
      workout('2026-10-04', [{ id: 'back-squat', sets: sets(100, 5, 5, 4) }]),
    ];
    expect(suggest(squat, hist(log), [])).toMatchObject({ kind: 'reduce', weight: 90 });
  });

  it('lowers the load and adds a corrective when a technique fault repeats', () => {
    const log = [workout('2026-10-01', [{ id: 'back-squat', sets: sets(100, 10, 10, 10) }])];
    const tech = [check('back-squat', '2026-10-01', { shallowDepth: 3 }), check('back-squat', '2026-09-28', { shallowDepth: 2 })];
    const s = suggest(squat, hist(log), tech);
    expect(s).toMatchObject({ kind: 'technique', weight: 90, corrective: 'box-squat' });
  });

  it('progresses bodyweight moves by reps or variation', () => {
    const s = suggest(item('push-up', [10, 20]), hist([workout('2026-10-01', [{ id: 'push-up', sets: sets(undefined, 20, 20, 21) }])], 'push-up'), []);
    expect(s.kind).toBe('increase');
    expect(s.weight).toBeUndefined();
  });

  it('uses smaller jumps for dumbbells, upper body and light loads', () => {
    expect(loadStep(getExercise('back-squat')!, 100)).toBe(5);
    expect(loadStep(getExercise('bench-press')!, 80)).toBe(2.5);
    expect(loadStep(getExercise('goblet-squat')!, 24)).toBe(2);
    expect(loadStep(getExercise('back-squat')!, 20)).toBe(2); // capped at 10% of the load
  });

  it('suggests plate-friendly pounds for lifters who log in pounds', () => {
    const lb = (n: number) => fromUnit(n, 'lb');
    const at = new Date('2026-10-02T12:00:00');
    const clean = [check('back-squat', '2026-10-01', {}), check('bench-press', '2026-10-01', {})];
    const up = suggest(squat, hist([workout('2026-10-01', [{ id: 'back-squat', sets: sets(lb(225), 10, 10, 10) }])]), clean, 'lb', at);
    expect(toUnit(up.weight!, 'lb')).toBeCloseTo(235, 6);
    const bench = suggest(item('bench-press', [6, 10]), hist([workout('2026-10-01', [{ id: 'bench-press', sets: sets(lb(135), 10, 10, 10) }])], 'bench-press'), clean, 'lb', at);
    expect(toUnit(bench.weight!, 'lb')).toBeCloseTo(140, 6);
    const back = suggest(squat, hist([workout('2026-10-01', [{ id: 'back-squat', sets: sets(lb(225), 10, 10, 10) }])]), [check('back-squat', '2026-10-01', { shallowDepth: 3 }), check('back-squat', '2026-09-28', { shallowDepth: 2 })], 'lb');
    expect(toUnit(back.weight!, 'lb')).toBeCloseTo(202.5, 6);
  });

  it('only counts faults seen in 2 of the last 3 checks', () => {
    const tech = [
      check('back-squat', '2026-10-05', { forwardLean: 1 }),
      check('back-squat', '2026-10-03', {}),
      check('back-squat', '2026-10-01', { forwardLean: 2 }),
      check('back-squat', '2026-09-01', { shallowDepth: 4 }),
    ];
    expect(repeatedFaults(tech, 'back-squat')).toEqual(['forwardLean']);
  });
});

describe('coach: plan and insights', () => {
  const program = buildProgram({ groups: ['chest', 'back', 'quads'], daysPerWeek: 3, level: 'beginner', equipment: 'fullGym' }, new Date('2026-10-01'));
  const firstId = program.days[0].items[0].exerciseId;

  it('rotates through the plan days', () => {
    expect(nextDayIndex(program, [])).toBe(0);
    const log = [workout('2026-10-01', [], { planId: program.id, dayIndex: 0 })];
    expect(nextDayIndex(program, log)).toBe(1);
    log.push(workout('2026-10-03', [], { planId: program.id, dayIndex: program.days.length - 1 }));
    expect(nextDayIndex(program, log)).toBe(0);
  });

  it('asks for a first workout when the log is empty', () => {
    expect(insights(program, [], []).map((i) => i.id)).toContain('first');
  });

  it('celebrates new records', () => {
    const log = [
      workout('2026-10-01', [{ id: firstId, sets: sets(100, 5, 5) }]),
      workout('2026-10-04', [{ id: firstId, sets: sets(105, 5, 5) }]),
    ];
    const pr = insights(program, log, [], 'kg', new Date('2026-10-05T12:00:00')).find((i) => i.id.startsWith('pr-'));
    expect(pr?.body).toMatch(/^105 kg × 5/);
    // A record from weeks ago is old news.
    expect(insights(program, log, [], 'kg', new Date('2026-10-30T12:00:00')).some((i) => i.id.startsWith('pr-'))).toBe(false);
  });

  it('groups several records from one workout into one note', () => {
    const otherId = program.days.flatMap((d) => d.items).find((i) => i.exerciseId !== firstId)!.exerciseId;
    const log = [
      workout('2026-10-01', [{ id: firstId, sets: sets(100, 5, 5) }, { id: otherId, sets: sets(40, 3, 10) }]),
      workout('2026-10-04', [{ id: firstId, sets: sets(105, 5, 5) }, { id: otherId, sets: sets(42.5, 3, 10) }]),
    ];
    const prs = insights(program, log, [], 'kg', new Date('2026-10-05T12:00:00')).filter((i) => i.id.startsWith('pr-'));
    expect(prs).toHaveLength(1);
    expect(prs[0].title).toBe('2 new bests last workout');
  });

  it('flags stalls', () => {
    const log = ['2026-10-01', '2026-10-04', '2026-10-07', '2026-10-10'].map((d) => workout(d, [{ id: firstId, sets: sets(100, 5, 5) }]));
    expect(insights(program, log, [], 'kg', new Date('2026-10-11T12:00:00')).some((i) => i.id === `stall-${firstId}`)).toBe(true);
  });

  it('offers to add a corrective for a repeated fault, then stops offering', () => {
    const tech = [check('back-squat', '2026-10-01', { shallowDepth: 3 }), check('back-squat', '2026-10-03', { shallowDepth: 1 })];
    const withSquat = { ...program, days: program.days.map((d, i) => (i === 0 ? { ...d, items: [item('back-squat'), ...d.items] } : d)) };
    const ins = insights(withSquat, [], tech).find((i) => i.id === 'fault-back-squat-shallowDepth')!;
    expect(ins.action).toMatchObject({ kind: 'addCorrective', correctiveId: 'box-squat' });
    const updated = addCorrective(withSquat, 'back-squat', 'box-squat');
    expect(updated.days[0].items.map((i) => i.exerciseId).slice(0, 2)).toEqual(['back-squat', 'box-squat']);
    expect(addCorrective(updated, 'back-squat', 'box-squat')).toEqual(updated); // no duplicates
    expect(insights(updated, [], tech).find((i) => i.id === 'fault-back-squat-shallowDepth')!.action).toBeUndefined();
  });

  it('notices a completed week and muscles behind plan', () => {
    const now = new Date('2026-10-23T12:00:00'); // Friday
    const chest = program.days.flatMap((d) => d.items).filter((i) => getExercise(i.exerciseId)!.primary.includes('chest'));
    const week = ['2026-10-19', '2026-10-20', '2026-10-21'].map((d, i) =>
      workout(d, chest.map((c) => ({ id: c.exerciseId, sets: sets(60, 8, 8, 8, 8, 8) })), { planId: program.id, dayIndex: i }),
    );
    const older = workout('2026-10-01', [{ id: 'bench-press', sets: sets(60, 8) }]);
    const ins = insights(program, [...week, older], [], 'kg', now);
    expect(ins.some((i) => i.id === 'week-done')).toBe(true);
    const behind = ins.find((i) => i.id === 'behind-plan');
    expect(behind?.title).toMatch(/^Behind plan: /);
    expect(behind?.title).toMatch(/back/);
    expect(behind?.title).toMatch(/quads/);
    expect(behind?.title).not.toMatch(/chest/);
    expect(behind?.body).toMatch(/back 0 of \d+ planned sets/);
  });

  it('says how much of the plan was done when every muscle is behind', () => {
    const now = new Date('2026-10-23T12:00:00');
    const log = [workout('2026-10-01', [{ id: 'bench-press', sets: sets(60, 8) }]), workout('2026-10-20', [{ id: 'bench-press', sets: sets(60, 8) }])];
    const behind = insights(program, log, [], 'kg', now).find((i) => i.id === 'behind-plan');
    expect(behind?.title).toMatch(/^About \d+% of your planned sets$/);
  });

  it('suggests an easier week when two plan lifts stall, and applies it to plan days', () => {
    const now = new Date('2026-10-12T12:00:00');
    const [a, b] = program.days[0].items.filter((i) => i.unit === 'reps');
    const log = ['2026-10-01', '2026-10-04', '2026-10-07', '2026-10-10'].map((d, i) =>
      workout(d, [{ id: a.exerciseId, sets: sets(50, 8, 8, 8) }, { id: b.exerciseId, sets: sets(40, 8, 8, 8) }], { planId: program.id, dayIndex: i % program.days.length }),
    );
    const ins = insights(program, log, [], 'kg', now);
    const easier = ins.find((i) => i.id === 'easier-week');
    expect(easier?.action).toMatchObject({ kind: 'easyWeek' });
    expect(ins.some((i) => i.id.startsWith('stall-'))).toBe(false);
    // Turned on: plan days get about half the sets and 10% less weight.
    const easy = startEasyWeek(now);
    expect(easyWeekActive(easy, new Date('2026-10-15T12:00:00'))).toBe(true);
    expect(easyWeekActive(easy, new Date('2026-10-20T12:00:00'))).toBe(false);
    const w = startFromPlan(program, 0, log, [], 'kg', now, true);
    const entry = w.entries.find((e) => e.exerciseId === a.exerciseId)!;
    expect(entry.sets.length).toBe(Math.max(1, Math.round(a.sets / 2)));
    expect(entry.sets[0].planned?.weight).toBe(45);
    expect(entry.coachNote).toMatch(/Easier week/);
    // While it's on, the coach says so and doesn't suggest another.
    const during = insights(program, log, [], 'kg', new Date('2026-10-14T12:00:00'), easy);
    expect(during.some((i) => i.id === 'easy-week-on')).toBe(true);
    expect(during.some((i) => i.id === 'easier-week')).toBe(false);
  });
});

describe('bodyweight sets', () => {
  const bwSets = (added: number | undefined, ...reps: number[]): SetEntry[] => reps.map((r) => ({ bw: true, weight: added, reps: r, done: true }));

  it('knows which exercises are bodyweight', () => {
    expect(isBodyweight(getExercise('pull-up')!)).toBe(true);
    expect(isBodyweight(getExercise('dip')!)).toBe(true);
    expect(isBodyweight(getExercise('bench-dip')!)).toBe(true);
    expect(isBodyweight(getExercise('bench-press')!)).toBe(false);
  });

  it('counts body weight plus added weight as the load, only when body weight is known', () => {
    expect(setLoad({ bw: true, weight: 10, reps: 5, done: true }, 80)).toBe(90);
    expect(setLoad({ bw: true, reps: 5, done: true }, 80)).toBe(80);
    expect(setLoad({ bw: true, weight: 10, reps: 5, done: true })).toBe(0);
    expect(setLoad({ weight: 60, reps: 5, done: true }, 80)).toBe(60);
  });

  it('formats bodyweight sets', () => {
    expect(formatSet({ bw: true, reps: 12, done: true }, 'kg')).toBe('BW × 12');
    expect(formatSet({ bw: true, weight: 10, reps: 6, done: true }, 'kg')).toBe('BW + 10 kg × 6');
    expect(formatSet({ weight: 60, reps: 8, done: true }, 'kg')).toBe('60 kg × 8');
    expect(formatSet({ bw: true, seconds: 45, done: true }, 'kg')).toBe('45 s');
    expect(formatSet({ reps: 10, done: true }, 'kg')).toBe('10 reps');
    expect(formatSetShort({ bw: true, weight: 10, reps: 6, done: true }, 'kg')).toBe('BW+10×6');
    expect(formatSetShort({ bw: true, reps: 12, done: true }, 'kg')).toBe('BW×12');
  });

  it('uses the logged body weight for volume, estimated max and records', () => {
    const w = workout('2026-10-01', [{ id: 'pull-up', sets: bwSets(10, 6, 5) }], { bodyweight: 80 });
    expect(workoutVolume(w)).toBe(90 * 11);
    const [h] = exerciseHistory([w], 'pull-up');
    expect(h.bestE1rm).toBeCloseTo(e1rm(90, 6));
    const rec = personalRecords([h]);
    expect(rec.mostAdded).toBe(10);
    expect(rec.heaviest).toBe(90);
    // Without a body weight the sets still count for reps, not for load.
    const noBw = workout('2026-10-02', [{ id: 'pull-up', sets: bwSets(undefined, 12) }]);
    expect(workoutVolume(noBw)).toBe(0);
    expect(exerciseHistory([noBw], 'pull-up')[0]).toMatchObject({ bestE1rm: 0, maxReps: 12 });
  });

  it('progresses bodyweight sets by added weight once reps are maxed', () => {
    const pull = item('pull-up', [6, 10]);
    const s = suggest(pull, exerciseHistory([workout('2026-10-01', [{ id: 'pull-up', sets: bwSets(10, 10, 10, 10) }])], 'pull-up'), []);
    expect(s).toMatchObject({ kind: 'increase', weight: 12.5 });
    expect(suggest(pull, [], []).note).toMatch(/body weight/);
  });

  it('celebrates rep records on bodyweight-only exercises', () => {
    const program = buildProgram({ groups: ['chest'], daysPerWeek: 2, level: 'beginner', equipment: 'bodyweight' });
    const log = [
      workout('2026-10-01', [{ id: 'push-up', sets: bwSets(undefined, 15, 12) }]),
      workout('2026-10-04', [{ id: 'push-up', sets: bwSets(undefined, 18, 14) }]),
    ];
    const pr = insights(program, log, [], 'kg', new Date('2026-10-05T12:00:00')).find((i) => i.id.startsWith('pr-'));
    expect(pr?.body).toBe('18 reps in a set, up from 15.');
  });
});

describe('logging your own workouts', () => {
  const history = [
    workout('2026-10-01', [{ id: 'bench-press', sets: sets(60, 8, 8, 7) }]),
    workout('2026-10-04', [{ id: 'bench-press', sets: sets(62.5, 8, 7) }]),
  ];

  it('pre-fills an added exercise with last time’s sets', () => {
    const w = addExercise(emptyWorkout(), 'bench-press', history);
    expect(w.entries[0].sets.map((s) => s.planned)).toEqual([
      { weight: 62.5, reps: 8, seconds: undefined },
      { weight: 62.5, reps: 7, seconds: undefined },
      { weight: 62.5, reps: 7, seconds: undefined },
    ]);
    expect(addExercise(emptyWorkout(), 'plank').entries[0].sets[0].planned).toEqual({ seconds: 30 });
  });

  it('starts routines and repeats workouts with your last numbers', () => {
    const routine: Routine = { id: 'r1', name: 'Push day', createdAt: day('2026-09-01'), items: [{ exerciseId: 'bench-press', sets: 4 }, { exerciseId: 'push-up', sets: 2 }] };
    const w = startRoutine(routine, history);
    expect(w).toMatchObject({ dayName: 'Push day', routineId: 'r1' });
    expect(w.entries.map((e) => e.sets.length)).toEqual([4, 2]);
    expect(w.entries[0].sets[0].planned?.weight).toBe(62.5);
    const again = repeatWorkout(history[0]);
    expect(again.entries[0].sets.map((s) => s.planned?.reps)).toEqual([8, 8, 7]);
    expect(again.finishedAt).toBeUndefined();
  });

  it('turns a workout into a routine', () => {
    const r = routineFromWorkout({ ...history[1], dayName: 'Bench' });
    expect(r).toMatchObject({ name: 'Bench', items: [{ exerciseId: 'bench-press', sets: 2 }] });
  });

  it('finishes a workout: marks bodyweight sets, keeps your body weight, names it after the muscles', () => {
    let w = addExercise(addExercise(emptyWorkout(), 'pull-up'), 'bench-press');
    w = {
      ...w,
      entries: w.entries.map((e) => ({ ...e, sets: e.sets.map((s, i) => (i < 2 ? { ...completeSet(s), reps: 8, weight: e.exerciseId === 'pull-up' ? 5 : 60 } : s)) })),
    };
    const done = finishWorkout(w, new Date('2026-10-05T19:00:00'), 82);
    expect(done.bodyweight).toBe(82);
    expect(done.entries[0].sets).toEqual([
      { done: true, reps: 8, weight: 5, seconds: undefined, bw: true },
      { done: true, reps: 8, weight: 5, seconds: undefined, bw: true },
    ]);
    expect(done.entries[1].sets.every((s) => !s.bw)).toBe(true);
    expect(done.dayName).toBe('Back & Chest');
    // Plan workouts keep their day name; no body weight is stored without bodyweight sets.
    const plan = finishWorkout({ ...history[0], finishedAt: undefined, dayName: 'Day 1' }, new Date(), 82);
    expect(plan.dayName).toBe('Day 1');
    expect(plan.bodyweight).toBeUndefined();
  });
});

describe('technique over time', () => {
  it('charts clean reps per check and finds the most common fault', () => {
    const tech = [
      check('back-squat', '2026-10-08', { forwardLean: 1 }),
      check('back-squat', '2026-10-01', { shallowDepth: 3 }),
      check('back-squat', '2026-10-04', { shallowDepth: 1, forwardLean: 1 }),
      check('bench-press', '2026-10-04', { flare: 4 }),
    ];
    const t = techniqueTrend(tech, 'back-squat');
    expect(t.points.map((p) => p.at)).toEqual([day('2026-10-01'), day('2026-10-04'), day('2026-10-08')]);
    expect(t.points.map((p) => p.share)).toEqual([0.4, 0.8, 0.8]);
    expect(t.top).toEqual({ fault: 'shallowDepth', reps: 4, checks: 2 });
    expect(techniqueTrend([], 'back-squat')).toEqual({ points: [], top: undefined });
  });

  it('moves the rest of the sets up after a clean check during the workout', () => {
    const program = buildProgram({ groups: ['quads'], daysPerWeek: 2, level: 'intermediate', equipment: 'fullGym' });
    const squatDay = program.days.findIndex((d) => d.items.some((i) => i.exerciseId === 'back-squat'));
    expect(squatDay).toBeGreaterThanOrEqual(0);
    const it = program.days[squatDay].items.find((i) => i.exerciseId === 'back-squat')!;
    const log = [workout('2026-10-01', [{ id: 'back-squat', sets: sets(100, ...Array(it.sets).fill(it.reps[1])) }], { planId: program.id, dayIndex: squatDay })];
    const w = startFromPlan(program, squatDay, log, [], 'kg', new Date('2026-10-03T12:00:00'));
    const ei = w.entries.findIndex((e) => e.exerciseId === 'back-squat');
    expect(w.entries[ei].nextWeight).toBe(105);
    expect(w.entries[ei].sets[0].planned?.weight).toBe(100);
    const done = { ...w, entries: w.entries.map((e, i) => (i === ei ? { ...e, sets: e.sets.map((s, j) => (j === 0 ? completeSet(s) : s)) } : e)) };
    const up = applyNextWeight(done, ei);
    expect(up.entries[ei].sets[0]).toMatchObject({ done: true, weight: 100 });
    expect(up.entries[ei].sets.slice(1).every((s) => s.planned?.weight === 105)).toBe(true);
    expect(up.entries[ei].nextWeight).toBeUndefined();
  });
});

describe('logging a workout afterwards', () => {
  it('keeps the date you give it and drops sets you left out', () => {
    let w = addExercise({ ...emptyWorkout(), startedAt: new Date('2026-10-20T18:00:00').toISOString() }, 'bench-press');
    w = { ...w, notes: 'Felt strong', entries: w.entries.map((e) => ({ ...e, sets: e.sets.map((s, i) => (i < 2 ? { ...s, weight: 60, reps: 8, done: true } : s)) })) };
    const done = finishWorkout(w, new Date('2026-10-20T19:05:00'));
    expect(done.startedAt).toBe(new Date('2026-10-20T18:00:00').toISOString());
    expect(done.finishedAt).toBe(new Date('2026-10-20T19:05:00').toISOString());
    expect(done.entries[0].sets).toHaveLength(2);
    expect(done.notes).toBe('Felt strong');
    expect(done.dayName).toBe('Chest');
  });
});

describe('weekly body map', () => {
  it('rates each muscle against its weekly target', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(2, 10)).toBe(1);
    expect(heatLevel(4, 10)).toBe(2);
    expect(heatLevel(7, 10)).toBe(3);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(12, 10)).toBe(4);
  });

  it("counts this week's sets per muscle, secondary half, against the plan or 10 sets", () => {
    const program = buildProgram({ groups: ['chest', 'back'], daysPerWeek: 2, level: 'intermediate', equipment: 'fullGym' });
    const log = [
      workout('2026-10-26', [{ id: 'bench-press', sets: sets(60, 8, 8, 8, 8) }]), // Monday
      workout('2026-10-28', [{ id: 'push-up', sets: sets(undefined, 15, 15) }]),
      workout('2026-10-20', [{ id: 'bench-press', sets: sets(60, 8, 8, 8, 8, 8, 8) }]), // last week
    ];
    const week = weekMuscles(log, program, new Date('2026-10-29T12:00:00'));
    const chest = week.find((m) => m.group === 'chest')!;
    expect(chest.sets).toBe(6);
    expect(chest.target).toBe(program.targets.chest);
    expect(chest.exercises).toEqual(['Barbell bench press', 'Push-up']);
    // Bench press and push-ups work the triceps as a secondary muscle: half sets.
    const triceps = week.find((m) => m.group === 'triceps')!;
    expect(triceps.sets).toBe(3);
    expect(triceps.target).toBe(14); // not in the plan: the plan level's target
    expect(week.find((m) => m.group === 'quads')!.level).toBe(0);
    // No plan: 10 sets a week.
    expect(weekMuscles(log, null, new Date('2026-10-29T12:00:00')).find((m) => m.group === 'chest')).toMatchObject({ target: 10, level: 2 });
  });
});

describe('profile and lifter adjustments', () => {
  it('keeps only valid profile fields and works out age and figure', () => {
    const now = new Date('2026-11-08T12:00:00');
    expect(ageOf({ birthYear: 1990 }, now)).toBe(36);
    expect(birthYearFromAge(36, now)).toBe(1990);
    expect(figureOf({ sex: 'female' })).toBe('female');
    expect(figureOf({ sex: 'female', figure: 'male' })).toBe('male');
    expect(figureOf({})).toBe('male');
    expect(trainingSex({ sex: 'unspecified' })).toBeUndefined();
    expect(formatHeight(180, false)).toBe('180 cm');
    expect(formatHeight(180, true)).toBe('5 ft 11 in');
  });

  it('shortens rest for women and keeps everything else the same', () => {
    const base = { groups: ['chest', 'quads'] as MuscleGroup[], daysPerWeek: 3, level: 'intermediate' as const, equipment: 'fullGym' as const };
    const men = buildProgram({ ...base, sex: 'male' }, new Date('2026-11-01'));
    const women = buildProgram({ ...base, sex: 'female' }, new Date('2026-11-01'));
    const items = (p: typeof men) => p.days.flatMap((d) => d.items);
    expect(items(women).map((i) => [i.exerciseId, i.sets, i.reps])).toEqual(items(men).map((i) => [i.exerciseId, i.sets, i.reps]));
    for (const [w, m] of items(women).map((i, k) => [i, items(men)[k]] as const)) {
      expect(w.restSec).toBeLessThanOrEqual(m.restSec);
      expect(w.restSec).toBeGreaterThanOrEqual(60);
    }
    expect(personalPrescription({ reps: [6, 10], restSec: 120 }, 'compound', { sex: 'female' }).restSec).toBe(90);
    expect(women.notes.some((n) => /Grgic & Schoenfeld/.test(n))).toBe(true);
    expect(men.notes.some((n) => /Grgic/.test(n))).toBe(false);
  });

  it('keeps youth and older lifters at 8 reps or more', () => {
    expect(personalPrescription({ reps: [5, 8], restSec: 180 }, 'compound', { age: 15 }).reps).toEqual([8, 12]);
    expect(personalPrescription({ reps: [6, 10], restSec: 120 }, 'compound', { age: 70 }).reps).toEqual([8, 12]);
    expect(personalPrescription({ reps: [8, 12], restSec: 90 }, 'compound', { age: 70 }).reps).toEqual([8, 12]);
    expect(personalPrescription({ reps: [6, 10], restSec: 120 }, 'compound', { age: 40 }).reps).toEqual([6, 10]);
    expect(personalPrescription({ reps: [30, 45], restSec: 60 }, 'hold', { age: 70 }).reps).toEqual([30, 45]);
    expect(lifterNotes({ age: 70 })[0]).toMatch(/Fragala/);
    expect(lifterNotes({ age: 16 })[0]).toMatch(/Lloyd/);
    const older = buildProgram({ groups: ['chest', 'back'], daysPerWeek: 3, level: 'advanced', equipment: 'fullGym', age: 70 });
    expect(older.days.flatMap((d) => d.items).every((i) => i.unit === 'seconds' || i.reps[0] >= 8)).toBe(true);
  });
});
