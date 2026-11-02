import { describe, expect, it } from 'vitest';
import { EXERCISES, EXERCISES_BY_ID } from '../src/data/exercises';
import { jointsOf } from '../src/data/helpers';
import { BASIC_CHECKS, FRONT_ONLY_CHECKS, JOINTS, LEVELS, MUSCLE_GROUPS } from '../src/data/types';
import { availableExercises } from '../src/program/builder';

const FULL_ANALYSIS = ['back-squat', 'bench-press', 'deadlift', 'overhead-press', 'barbell-row', 'romanian-deadlift'];

describe('exercise library', () => {
  it('has unique ids', () => {
    expect(EXERCISES_BY_ID.size).toBe(EXERCISES.length);
  });

  it.each(MUSCLE_GROUPS)('has at least 3 exercises with %s as a primary muscle', (g) => {
    expect(EXERCISES.filter((e) => e.primary.includes(g)).length).toBeGreaterThanOrEqual(3);
  });

  it.each(MUSCLE_GROUPS)('offers %s with dumbbells only and with bodyweight only', (g) => {
    for (const setting of ['dumbbells', 'bodyweight'] as const) {
      const n = availableExercises(setting, 'advanced').filter((e) => e.primary.includes(g)).length;
      expect(n, `${g} / ${setting}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives full analysis to exactly the six priority lifts', () => {
    expect(EXERCISES.filter((e) => e.analysis === 'full').map((e) => e.id).sort()).toEqual([...FULL_ANALYSIS].sort());
  });

  for (const e of EXERCISES) {
    describe(e.id, () => {
      it('is internally consistent', () => {
        expect(e.name).toBeTruthy();
        expect(e.summary).toBeTruthy();
        expect(e.primary.length).toBeGreaterThan(0);
        expect(e.equipment.length).toBeGreaterThan(0);
        for (const g of e.secondary) expect(e.primary).not.toContain(g);
        for (const j of e.requiredLandmarks) expect(JOINTS).toContain(j);
        if (e.maxLevel) expect(LEVELS.indexOf(e.maxLevel)).toBeGreaterThanOrEqual(LEVELS.indexOf(e.minLevel));
        expect(e.faults.length).toBeGreaterThan(0);
      });

      it('only uses landmarks it declares', () => {
        if (e.tracking.kind === 'reps') expect(e.requiredLandmarks).toContain(e.tracking.joint);
        for (const c of e.checks) for (const j of jointsOf(c)) expect(e.requiredLandmarks, c.id).toContain(j);
      });

      it('has checks the camera view can support', () => {
        for (const c of e.checks) {
          if (FRONT_ONLY_CHECKS.includes(c.type)) expect(e.placement.view, c.id).toBe('front');
          if (e.analysis === 'basic') expect(BASIC_CHECKS, c.id).toContain(c.type);
          if (e.tracking.kind === 'hold') expect(c.type).toBe('holdAlignment');
          else expect(c.type).not.toBe('holdAlignment');
        }
      });

      it('has unique check ids, each linked to a listed fault', () => {
        const ids = e.checks.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        const faults = new Set(e.faults.map((f) => f.id));
        expect(faults.size).toBe(e.faults.length);
        for (const c of e.checks) {
          expect(faults, c.id).toContain(c.fault);
          expect(['unvalidated', 'calibrated']).toContain(c.status);
          if (c.status === 'calibrated') expect(c.source).toMatch(/Calibrated on \d+ labelled reps/);
        }
      });

      it('cites a source for every threshold', () => {
        for (const c of e.checks) {
          expect(c.source, c.id).toBeTruthy();
          // Full-analysis lifts use written standards, never the draft placeholder.
          if (e.analysis === 'full') expect(c.source, c.id).not.toMatch(/^Draft minimum/);
        }
      });

      it('points every fault at a different exercise in the library', () => {
        for (const f of e.faults) {
          expect(f.cue).toBeTruthy();
          expect(EXERCISES_BY_ID.has(f.corrective), `${f.id} -> ${f.corrective}`).toBe(true);
          expect(f.corrective).not.toBe(e.id);
        }
      });

      it('has a sensible camera placement', () => {
        const [min, max] = e.placement.distanceM;
        expect(min).toBeGreaterThan(0);
        expect(max).toBeGreaterThan(min);
      });
    });
  }
});
