import { describe, expect, it } from 'vitest';
import { addCorrective, insights, loadStep, nextDayIndex, repeatedFaults, suggest } from '../src/log/coach';
import {
  e1rm,
  exerciseHistory,
  formatWeight,
  fromUnit,
  muscleSets,
  personalRecords,
  toUnit,
  weekStart,
  weekStreak,
  workoutVolume,
  workoutsByDay,
} from '../src/log/stats';
import type { SetEntry, TechniqueSummary, Workout } from '../src/log/types';
import { getExercise } from '../src/data/exercises';
import { buildProgram, type ProgramItem } from '../src/program/builder';

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
    expect(personalRecords(h)).toEqual({ bestE1rm: e1rm(105, 5), heaviest: 105, mostReps: 5 });
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

  it('adds weight once every set reaches the top of the range', () => {
    const s = suggest(squat, hist([workout('2026-10-01', [{ id: 'back-squat', sets: sets(100, 10, 10, 10) }])]), []);
    expect(s).toMatchObject({ kind: 'increase', weight: 105, delta: 5 });
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
    const up = suggest(squat, hist([workout('2026-10-01', [{ id: 'back-squat', sets: sets(lb(225), 10, 10, 10) }])]), [], 'lb');
    expect(toUnit(up.weight!, 'lb')).toBeCloseTo(235, 6);
    const bench = suggest(item('bench-press', [6, 10]), hist([workout('2026-10-01', [{ id: 'bench-press', sets: sets(lb(135), 10, 10, 10) }])], 'bench-press'), [], 'lb');
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

  it('notices a completed week and missed muscles', () => {
    const now = new Date('2026-10-23T12:00:00'); // Friday
    const week = ['2026-10-19', '2026-10-20', '2026-10-21'].map((d, i) =>
      workout(d, [{ id: 'bench-press', sets: sets(60, 8, 8) }], { planId: program.id, dayIndex: i }),
    );
    const older = workout('2026-10-01', [{ id: 'bench-press', sets: sets(60, 8) }]);
    const ins = insights(program, [...week, older], [], 'kg', now);
    expect(ins.some((i) => i.id === 'week-done')).toBe(true);
    const missed = ins.find((i) => i.id === 'missed-groups');
    expect(missed?.body).toMatch(/back/);
    expect(missed?.body).toMatch(/quads/);
  });
});
