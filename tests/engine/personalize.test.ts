import { describe, expect, it } from 'vitest';
import { getExercise } from '../../src/data/exercises';
import { analyze } from '../../src/engine/analyze';
import type { Reader } from '../../src/engine/landmarks';
import {
  MAX_ADJUSTMENT_DEG,
  ProportionMeter,
  REFERENCE_PROPORTIONS,
  adjustmentDeg,
  mergeProportions,
  squatLeanDeg,
} from '../../src/engine/personalize';
import type { PoseSequence } from '../../src/engine/types';
import { fixture } from '../fixtures/load';
import * as S from '../fixtures/synth';

const measure = (seq: PoseSequence) => {
  const m = new ProportionMeter();
  const reader: Reader = { width: seq.width, height: seq.height, view: 'side', side: 'right' };
  for (const f of seq.frames) m.push(f, reader);
  return m;
};
const at = '2026-11-01T00:00:00.000Z';

describe('squat lean model', () => {
  it('needs more lean for longer thighs and less for longer shins', () => {
    expect(squatLeanDeg(1.0, 0.85)).toBeGreaterThan(squatLeanDeg(0.85, 0.85));
    expect(squatLeanDeg(0.85, 1.0)).toBeLessThan(squatLeanDeg(0.85, 0.85));
  });
  it('gives no adjustment for average proportions', () => {
    expect(adjustmentDeg('squatTorsoLean', { ...REFERENCE_PROPORTIONS, measuredAt: at })).toBeCloseTo(0, 6);
  });
  it('is capped and needs both leg lengths', () => {
    expect(adjustmentDeg('squatTorsoLean', { thigh: 2, shin: 0.5, measuredAt: at })).toBe(MAX_ADJUSTMENT_DEG);
    expect(adjustmentDeg('squatTorsoLean', { thigh: 0.4, shin: 1.5, measuredAt: at })).toBe(-MAX_ADJUSTMENT_DEG);
    expect(adjustmentDeg('squatTorsoLean', { thigh: 1, measuredAt: at })).toBeNull();
    expect(adjustmentDeg('squatTorsoLean', undefined)).toBeNull();
  });
});

describe('ProportionMeter', () => {
  it('measures leg lengths while standing side-on', () => {
    const p = measure(fixture('squat-good')).result()!;
    expect(p.thigh!).toBeCloseTo(S.SEG.thigh / S.SEG.torso, 1);
    expect(p.shin!).toBeCloseTo(S.SEG.shin / S.SEG.torso, 1);
    // Arms hold the bar on the back, so they aren't straight: not measured.
    expect(p.upperArm).toBeUndefined();
  });
  it('measures arm lengths when the arms hang straight', () => {
    const p = measure(fixture('calf-raise')).result()!;
    expect(p.upperArm!).toBeCloseTo(S.SEG.upperArm / S.SEG.torso, 1);
    expect(p.forearm!).toBeCloseTo(S.SEG.forearm / S.SEG.torso, 1);
  });
  it('measures nothing while lying down or from the front', () => {
    expect(measure(fixture('bench-good')).result()).toBeNull();
    const m = new ProportionMeter();
    const seq = fixture('lateral-raise-front');
    for (const f of seq.frames) m.push(f, { width: seq.width, height: seq.height, view: 'front', side: 'left' });
    expect(m.result()).toBeNull();
  });
  it('keeps earlier measurements for segments not measured this time', () => {
    const merged = mergeProportions({ upperArm: 0.6, thigh: 0.9, measuredAt: 'old' }, { thigh: 1, measuredAt: at });
    expect(merged).toEqual({ upperArm: 0.6, thigh: 1, measuredAt: at });
  });
});

describe('personalized torso check', () => {
  const squat = getExercise('back-squat')!;
  // Leans 56° at the bottom: over the 50° limit for average proportions.
  const seq = S.squat({ seed: 12, lean: 56 });
  const lean = (r: ReturnType<typeof analyze>) => r.reps.map((rep) => rep.checks.find((c) => c.checkId === 'torso-bottom')!);

  it('fails without proportions', () => {
    expect(lean(analyze(squat, seq)).map((c) => c.status)).toEqual(Array(4).fill('fail'));
  });
  it('allows more lean for long thighs and says so', () => {
    const r = analyze(squat, seq, { proportions: { thigh: 1.1, shin: 0.85, measuredAt: at } });
    const checks = lean(r);
    expect(checks.map((c) => c.status)).toEqual(Array(4).fill('pass'));
    expect(checks[0].adjustment).toMatch(/^Allows \d+° more lean/);
    expect(checks[0].target).toMatch(/at most 6\d° from vertical/);
  });
  it('expects less lean for short thighs', () => {
    const r = analyze(squat, fixture('squat-good'), { proportions: { thigh: 0.65, shin: 0.95, measuredAt: at } });
    const c = lean(r)[0];
    expect(c.adjustment).toMatch(/^Expects \d+° less lean/);
  });
  it('leaves checks without a personalization rule alone', () => {
    const r = analyze(squat, seq, { proportions: { thigh: 1.1, shin: 0.85, measuredAt: at } });
    expect(r.reps[0].checks.filter((c) => c.adjustment).map((c) => c.checkId)).toEqual(['torso-bottom']);
  });
});
