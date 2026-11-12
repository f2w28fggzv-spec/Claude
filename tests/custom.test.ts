import { beforeAll, describe, expect, it, vi } from 'vitest';
import { exerciseInfo, exerciseName, newCustomExercise, sameName } from '../src/log/exercises';
import { addExercise, emptyWorkout, completeSet, finishWorkout, startRoutine } from '../src/log/session';
import { exerciseHistory, muscleSets, workoutVolume } from '../src/log/stats';
import { exportAll, importAll, loadCustomExercises, saveCustomExercise } from '../src/log/store';
import type { Workout } from '../src/log/types';

// A tiny in-memory localStorage so the store works under Node.
const mem = new Map<string, string>();
beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  });
});

const tick = (w: Workout, values: { weight?: number; reps: number }[]): Workout => ({
  ...w,
  entries: w.entries.map((e, ei) => ({ ...e, sets: e.sets.map((s, i) => (i < values.length && ei === 0 ? { ...completeSet(s), ...values[i] } : s)) })),
});

describe('your own exercises', () => {
  it('creates exercises with a load type and optional muscles', () => {
    const c = newCustomExercise('  Sled   push ', 'weighted', ['quads', 'glutes'], new Date('2026-11-01T10:00:00Z'));
    expect(c).toMatchObject({ name: 'Sled push', kind: 'weighted', muscles: ['quads', 'glutes'] });
    expect(c.id).toMatch(/^custom-/);
  });

  it('looks up library and own exercises the same way', () => {
    const ring = newCustomExercise('Ring dip', 'bodyweight', ['triceps']);
    expect(exerciseInfo(ring.id, [ring])).toMatchObject({ name: 'Ring dip', bodyweight: true, hold: false, primary: ['triceps'] });
    expect(exerciseInfo(ring.id, [ring])?.library).toBeUndefined();
    expect(exerciseInfo('push-up', [])).toMatchObject({ name: 'Push-up', bodyweight: true });
    expect(exerciseInfo('nope', [])).toBeUndefined();
  });

  it('spots names that already exist, ignoring case and spaces', () => {
    const own = newCustomExercise('Sled push', 'weighted', []);
    expect(sameName('push-UP', [own])?.id).toBe('push-up');
    expect(sameName(' sled  push', [own])?.id).toBe(own.id);
    expect(sameName('sled push', [own], own.id)).toBeUndefined(); // editing itself
    expect(sameName('sled push', [{ ...own, archived: true }])).toBeUndefined();
    expect(sameName('Farmer carry', [own])).toBeUndefined();
  });

  it('logs a bodyweight exercise of your own as BW + added weight', () => {
    const c = newCustomExercise('Ring dip', 'bodyweight', ['triceps', 'chest']);
    saveCustomExercise(c);
    // Fixed start date: the week counted below must contain it, whatever today is.
    const w = tick(addExercise(emptyWorkout(new Date('2026-11-02T18:00:00')), c.id), [{ reps: 10 }, { weight: 10, reps: 6 }]);
    const done = finishWorkout(w, new Date('2026-11-02T19:00:00'), 75);
    expect(done.entries[0].sets.every((s) => s.bw)).toBe(true);
    expect(done.bodyweight).toBe(75);
    expect(done.dayName).toBe('Triceps & Chest');
    expect(workoutVolume(done)).toBe(75 * 10 + 85 * 6);
    const week = muscleSets([done], new Date('2026-11-02T00:00:00'), new Date('2026-11-09T00:00:00'));
    expect(week.triceps).toBe(2);
    expect(exerciseName(c.id)).toBe('Ring dip');
  });

  it('logs an added-weight exercise of your own as weight × reps, and keeps it in routines', () => {
    const c = newCustomExercise('Sled push', 'weighted', []);
    saveCustomExercise(c);
    const done = finishWorkout(tick(addExercise(emptyWorkout(), c.id), [{ weight: 100, reps: 8 }]), new Date('2026-11-03T19:00:00'), 75);
    expect(done.entries[0].sets[0]).toMatchObject({ weight: 100, reps: 8 });
    expect(done.entries[0].sets[0].bw).toBeUndefined();
    expect(done.bodyweight).toBeUndefined();
    expect(done.dayName).toBe('Workout'); // no muscles picked
    expect(exerciseHistory([done], c.id)[0].bestLoad).toBe(100);
    const w = startRoutine({ id: 'r', name: 'Conditioning', createdAt: '', items: [{ exerciseId: c.id, sets: 2 }] }, [done]);
    expect(w.entries[0].sets.map((s) => s.planned?.weight)).toEqual([100, 100]);
  });

  it('keeps removed exercises so old workouts still show their name, and backs them up', () => {
    const c = newCustomExercise('Battle ropes', 'weighted', []);
    saveCustomExercise(c);
    saveCustomExercise({ ...c, archived: true });
    expect(exerciseName(c.id)).toBe('Battle ropes');
    const backup = exportAll();
    expect(Object.keys((backup as { data: object }).data)).toContain('formcheck.v1.customExercises');
    importAll(backup);
    expect(loadCustomExercises().some((x) => x.id === c.id && x.archived)).toBe(true);
  });
});
