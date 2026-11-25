// The "Adjust depth strictness" slider on the results screen (src/screens/Results.tsx) and the
// wording of relative-height targets: the slider is centred on each check's own margin and names
// the check's reference point; and the plain-words targets of "How we judge it".
import { describe, expect, it } from 'vitest';
import { EXERCISES, getExercise } from '../src/data/exercises';
import { MARGIN_SPAN, describeMargin, describeTarget, marginRange } from '../src/data/describe';
import type { Exercise, RelativeHeightCheck } from '../src/data/types';
import { analyze } from '../src/engine/analyze';
import { demoSequence } from './fixtures/demoSeq';

const heightCheck = (id: string, checkId = 'depth') =>
  getExercise(id)!.checks.find((c): c is RelativeHeightCheck => c.type === 'relativeHeight' && c.id === checkId)!;

/** The check's status on every rep of the exercise's own demo, with the margin set to `margin`. */
const demoWith = (e: Exercise, c: RelativeHeightCheck, margin: number) =>
  analyze(e, demoSequence(e), { overrides: { [e.id]: { [c.id]: { margin } } } }).reps.map((r) => r.checks.find((x) => x.checkId === c.id)!.status);

describe('"Adjust depth strictness" slider', () => {
  it('centres its range on the check’s own margin', () => {
    expect(marginRange(heightCheck('back-squat'))).toEqual({ min: -0.2, max: 0.2, step: 0.01 });
    expect(marginRange(heightCheck('bench-press'))).toEqual({ min: -0.3, max: 0.1, step: 0.01 });
    expect(marginRange(heightCheck('push-up'))).toEqual({ min: -0.3, max: 0.1, step: 0.01 });
    expect(marginRange(heightCheck('reverse-lunge'))).toEqual({ min: -1.4, max: -1, step: 0.01 });
  });

  it('takes in a margin saved outside that range, so the thumb shows the margin in use', () => {
    expect(marginRange(heightCheck('back-squat'), 0.35)).toEqual({ min: -0.2, max: 0.35, step: 0.01 });
    expect(marginRange(heightCheck('reverse-lunge'), -0.2)).toEqual({ min: -1.4, max: -0.2, step: 0.01 });
    expect(marginRange(heightCheck('reverse-lunge'), -1.25)).toEqual(marginRange(heightCheck('reverse-lunge')));
  });

  const all = EXERCISES.flatMap((e) => e.checks.filter((c): c is RelativeHeightCheck => c.type === 'relativeHeight').map((c) => [`${e.id} ${c.id}`, e, c] as const));
  it.each(all)('%s: a first touch only nudges the margin, so the demo still passes', (_, e, c) => {
    const { min, max, step } = marginRange(c);
    expect(min).toBeLessThan(c.margin);
    expect(max).toBeGreaterThan(c.margin);
    expect(max - min).toBeCloseTo(2 * MARGIN_SPAN, 9);
    for (const margin of [c.margin - step, c.margin + step]) expect(demoWith(e, c, margin)).toEqual(['pass', 'pass', 'pass']);
  });

  it('would have failed every rep of the reverse lunge on a range fixed at −0.2 to 0.2', () => {
    // The old slider's thumb sat clamped at −0.2 for the lunge's −1.2, and a first touch saved about that.
    const e = getExercise('reverse-lunge')!;
    expect(demoWith(e, heightCheck('reverse-lunge'), -0.2)).toEqual(['fail', 'fail', 'fail']);
  });

  it('names the check’s point and reference in what a margin asks', () => {
    expect(describeMargin(0, heightCheck('back-squat'))).toBe('hip level with or below the knee');
    expect(describeMargin(0.1, heightCheck('back-squat'))).toBe('hip at least 10% of torso below the knee');
    expect(describeMargin(-0.1, heightCheck('back-squat'))).toBe('hip may stay up to 10% of torso above the knee');
    expect(describeMargin(-0.1, heightCheck('push-up'))).toBe('shoulder may stay up to 10% of torso above the elbow');
    expect(describeMargin(-1.2, heightCheck('reverse-lunge'))).toBe('hip may stay up to 120% of torso above the toe');
    const chin: RelativeHeightCheck = { ...heightCheck('back-squat'), point: 'nose', reference: 'wrist', relation: 'atOrAbove', margin: -0.05 };
    expect(describeMargin(-0.05, chin)).toBe('nose may stay up to 5% of torso below the wrist');
    expect(describeMargin(0.2, chin)).toBe('nose at least 20% of torso above the wrist');
  });
});

describe('relative-height targets', () => {
  it('say how far short of the reference the point may stay, in plain words', () => {
    expect(describeTarget(heightCheck('back-squat'))).toBe('Hip level with or below the knee');
    expect(describeTarget(heightCheck('bench-press'))).toBe('Elbow at most 10% of torso length above the shoulder');
    expect(describeTarget(heightCheck('push-up'))).toBe('Shoulder at most 10% of torso length above the elbow');
    expect(describeTarget(heightCheck('reverse-lunge'))).toBe('Hip at most 120% of torso length above the toe');
  });

  it('match the engine’s per-rep target', () => {
    const e = getExercise('reverse-lunge')!;
    const depth = analyze(e, demoSequence(e)).reps[0].checks.find((c) => c.checkId === 'depth')!;
    expect(depth.target).toBe('at most 120% of torso above toe');
    expect(depth.measured).toBe('Hip 102% of torso above toe');
  });
});

describe('tempo targets', () => {
  it('say what a minimum asks in all, since the engine doesn’t time a movement’s slow start and finish', () => {
    for (const id of ['back-squat', 'bench-press', 'reverse-lunge']) {
      const tempo = getExercise(id)!.checks.find((c) => c.type === 'tempo')!;
      // MIN_ECCENTRIC_SEC 0.65 measured ≈ ACSM's 1 s lower bound for a smooth lowering (src/data/sources.ts).
      expect(describeTarget(tempo)).toBe('Lowering takes at least 0.65 s, not counting its slow start and finish (about 1 s in all)');
    }
  });
});
