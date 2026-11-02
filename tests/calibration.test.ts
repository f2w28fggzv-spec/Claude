import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyCalibration,
  exportFixtures,
  exportThresholds,
  samplesFor,
  scoreRecordings,
  suggestThreshold,
  thresholdFields,
  type CalibrationRecording,
  type LabelledFixtureBundle,
} from '../src/calibration/calibrate';
import { EXERCISES, getExercise } from '../src/data/exercises';
import { analyze } from '../src/engine/analyze';
import { fixture } from './fixtures/load';

const squat = getExercise('back-squat')!;
const depth = squat.checks.find((c) => c.id === 'depth')!;
const rec = (name: string, labels: Record<number, string[]>): CalibrationRecording => ({
  id: name,
  exerciseId: 'back-squat',
  createdAt: '2026-11-02T10:00:00.000Z',
  source: 'camera',
  seq: fixture(name),
  labels,
});
// squat-shallow: reps 2 and 4 are shallow.
const correct = rec('squat-shallow', { 0: [], 1: ['shallowDepth'], 2: [], 3: ['shallowDepth'] });

describe('calibration scoring', () => {
  it('agrees fully when labels match what happened', () => {
    const s = scoreRecordings(squat, [correct], {});
    const d = s.perCheck.find((p) => p.checkId === 'depth')!;
    expect(s.labelledReps).toBe(4);
    expect(d).toMatchObject({ truePos: 2, trueNeg: 2, falsePos: 0, falseNeg: 0, accuracy: 1 });
  });

  it('counts misses and false alarms', () => {
    const wrong = rec('squat-shallow', { 0: ['shallowDepth'], 1: [], 2: [], 3: ['shallowDepth'] });
    const d = scoreRecordings(squat, [wrong], {}).perCheck.find((p) => p.checkId === 'depth')!;
    expect(d).toMatchObject({ truePos: 1, falsePos: 1, falseNeg: 1, trueNeg: 1, accuracy: 0.5 });
  });

  it('ignores unlabelled reps', () => {
    const partial = rec('squat-shallow', { 1: ['shallowDepth'] });
    const s = scoreRecordings(squat, [partial], {});
    expect(s.labelledReps).toBe(1);
    expect(s.perCheck.find((p) => p.checkId === 'depth')!.truePos).toBe(1);
  });

  it('re-scores with tuned thresholds', () => {
    const lenient = { 'back-squat': { depth: { margin: -0.4 } } };
    const d = scoreRecordings(squat, [correct], lenient).perCheck.find((p) => p.checkId === 'depth')!;
    expect(d.falseNeg).toBe(2); // shallow reps now pass, so the faults are missed
  });
});

describe('threshold suggestions', () => {
  const field = thresholdFields(depth)[0];
  it('finds a cut-off that separates good and faulty reps', () => {
    const tooStrict = { 'back-squat': { depth: { margin: 0.3 } } };
    const s = scoreRecordings(squat, [correct], tooStrict);
    const sug = suggestThreshold(field, 0.3, samplesFor(depth, s))!;
    expect(sug.current).toBe(0.5);
    expect(sug.accuracy).toBe(1);
    expect(sug.value).toBeGreaterThan(-0.26);
    expect(sug.value).toBeLessThan(0.18);
  });
  it('suggests nothing when the current threshold is already best', () => {
    const s = scoreRecordings(squat, [correct], {});
    expect(suggestThreshold(field, 0, samplesFor(depth, s))).toBeNull();
  });
  it('handles max-type thresholds', () => {
    const f = { field: 'maxDeg', direction: 'max' as const, step: 1, unit: '°' };
    const sug = suggestThreshold(f, 80, [
      { value: 40, expectFail: false },
      { value: 42, expectFail: false },
      { value: 68, expectFail: true },
      { value: 70, expectFail: true },
    ])!;
    expect(sug.value).toBeGreaterThan(42);
    expect(sug.value).toBeLessThan(68);
  });
  it('exposes tunable fields for every check in the library', () => {
    for (const e of EXERCISES) for (const c of e.checks) expect(thresholdFields(c).length, `${e.id}/${c.id}`).toBeGreaterThan(0);
  });
});

describe('exports', () => {
  it('exports thresholds that apply back onto the library', () => {
    const overrides = { 'back-squat': { depth: { margin: 0.05 } } };
    const s = scoreRecordings(squat, [correct], overrides);
    const json = exportThresholds(squat, overrides, s, undefined, new Date('2026-11-02T00:00:00Z'));
    expect(json.exercises['back-squat'].depth).toMatchObject({ values: { margin: 0.05 }, labelledReps: 4 });
    const applied = applyCalibration(EXERCISES, json).find((e) => e.id === 'back-squat')!;
    const d = applied.checks.find((c) => c.id === 'depth')!;
    expect(d).toMatchObject({ margin: 0.05, status: 'calibrated' });
    expect(d.source).toMatch(/Calibrated on 4 labelled reps \(2026-11-02, \d+% agreement\)/);
    // Other exercises are untouched.
    expect(applyCalibration(EXERCISES, json).find((e) => e.id === 'deadlift')).toBe(EXERCISES.find((e) => e.id === 'deadlift'));
  });

  it('ignores unknown fields in a calibration file', () => {
    const applied = applyCalibration(EXERCISES, {
      exportedAt: '2026-11-02',
      exercises: { 'back-squat': { depth: { values: { margin: 0.02, bogus: 5 }, labelledReps: 3, accuracy: null } } },
    });
    const d = applied.find((e) => e.id === 'back-squat')!.checks.find((c) => c.id === 'depth')!;
    expect(d).toMatchObject({ margin: 0.02 });
    expect('bogus' in d).toBe(false);
  });

  it('exports labelled landmark fixtures that analyze the same way', () => {
    const bundle = exportFixtures(squat, [correct], new Date('2026-11-02T00:00:00Z'));
    expect(bundle.fixtures).toHaveLength(1);
    expect(bundle.fixtures[0].labels.map((l) => l.faults)).toEqual([[], ['shallowDepth'], [], ['shallowDepth']]);
    const roundTrip = JSON.parse(JSON.stringify(bundle)) as LabelledFixtureBundle;
    expect(analyze(squat, roundTrip.fixtures[0].sequence).reps).toHaveLength(4);
  });
});

// Real recordings exported from the calibration screen.
const realDir = join(__dirname, 'fixtures', 'real');
const bundles = readdirSync(realDir).filter((f) => f.endsWith('.json'));
describe.skipIf(bundles.length === 0)('real labelled fixtures', () => {
  for (const file of bundles) {
    const bundle = JSON.parse(readFileSync(join(realDir, file), 'utf8')) as LabelledFixtureBundle;
    const exercise = getExercise(bundle.exerciseId)!;
    for (const fx of bundle.fixtures) {
      it(`${file} / ${fx.name}: finds the labelled reps`, () => {
        const reps = analyze(exercise, fx.sequence).reps;
        for (const l of fx.labels) expect(reps.find((r) => r.index === l.rep)?.startFrame).toBe(l.startFrame);
      });
    }
  }
});
