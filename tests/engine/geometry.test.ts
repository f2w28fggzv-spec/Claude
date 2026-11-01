import { describe, expect, it } from 'vitest';
import { angleDeg, fromVerticalDeg } from '../../src/engine/geometry';
import { point, type Reader } from '../../src/engine/landmarks';
import { fillGaps, percentile, smooth } from '../../src/engine/signal';
import type { PoseFrame } from '../../src/engine/types';

describe('geometry', () => {
  it('measures joint angles', () => {
    expect(angleDeg({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(180);
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(angleDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeNaN();
  });
  it('measures lean from vertical regardless of facing direction', () => {
    expect(fromVerticalDeg({ x: 0, y: 0 }, { x: 0, y: -1 })).toBeCloseTo(0);
    expect(fromVerticalDeg({ x: 0, y: 0 }, { x: 1, y: -1 })).toBeCloseTo(45);
    expect(fromVerticalDeg({ x: 0, y: 0 }, { x: -1, y: -1 })).toBeCloseTo(45);
    expect(fromVerticalDeg({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90);
  });
  it('scales normalized landmarks by the frame size so angles are true', () => {
    // A 45° line in a 1280×720 frame is not 45° in normalized units.
    const lm = Array.from({ length: 33 }, () => [0, 0, 0, 0] as [number, number, number, number]);
    lm[24] = [0.5, 0.5, 0, 1]; // right hip
    lm[12] = [0.5 + 100 / 1280, 0.5 - 100 / 720, 0, 1]; // right shoulder, 100px right and up
    const f: PoseFrame = { t: 0, lm };
    const r: Reader = { width: 1280, height: 720, view: 'side', side: 'right' };
    expect(fromVerticalDeg(point(f, 'hip', r)!, point(f, 'shoulder', r)!)).toBeCloseTo(45);
  });
});

describe('signal helpers', () => {
  it('interpolates short gaps only', () => {
    const t = [0, 100, 200, 300, 400, 900, 1000];
    expect(fillGaps([0, NaN, NaN, 3, 4, NaN, 6], t, 300).slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(fillGaps([0, 1, 2, 3, NaN, NaN, 6], [0, 100, 200, 300, 400, 900, 1000], 300)[4]).toBeNaN();
  });
  it('smooths without shifting a symmetric peak', () => {
    const t = Array.from({ length: 21 }, (_, i) => i * 50);
    const v = t.map((x) => -Math.abs(x - 500));
    const s = smooth(v, t, 200);
    expect(s.indexOf(Math.max(...s))).toBe(10);
  });
  it('computes percentiles ignoring NaN', () => {
    expect(percentile([3, NaN, 1, 2], 0.5)).toBe(2);
    expect(percentile([], 0.5)).toBeNaN();
  });
});
