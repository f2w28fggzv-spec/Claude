// The muscle-engagement model behind the demo colours: the curve through a
// profile, where a moment falls in the rep, and the level each role shows.
import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../src/data/exercises';
import { LIMB_GROUPS, RESTING_SIDE, defaultEngagement, demandAt, engageColour, levelOf, levelsAt, momentAt, peakLevels, restingSide, type Engagement, type Moment } from '../src/demo/engagement';
import { progressAt, timeline } from '../src/demo/timeline';

const byId = (id: string) => EXERCISES.find((e) => e.id === id)!;

describe('demand curve', () => {
  it('passes through the three profile points and never overshoots them', () => {
    const p = [0.3, 1, 0.5] as const;
    expect(demandAt(p, 0)).toBeCloseTo(0.3);
    expect(demandAt(p, 0.5)).toBeCloseTo(1);
    expect(demandAt(p, 1)).toBeCloseTo(0.5);
    for (let k = 0; k <= 100; k++) {
      const d = demandAt(p, k / 100);
      expect(d).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(d).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(demandAt(p, -1)).toBeCloseTo(0.3);
    expect(demandAt(p, 2)).toBeCloseTo(0.5);
  });

  it('rises steadily between rising points', () => {
    const p = [0.2, 0.6, 1] as const;
    let prev = -1;
    for (let k = 0; k <= 50; k++) {
      const d = demandAt(p, k / 50);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
  });
});

describe('moment in the rep', () => {
  it('agrees with the animation timeline about the movement progress', () => {
    for (const id of ['back-squat', 'deadlift', 'pause-squat', 'dumbbell-curl']) {
      const e = byId(id);
      const tl = timeline(e, e.demo.pauseFar);
      for (let k = 0; k <= 200; k++) {
        const t = (k / 200) * tl.total * 2;
        expect(momentAt(e, tl, t).s).toBeCloseTo(progressAt(tl, t), 9);
      }
    }
  });

  it('names lowering and lifting from which phase comes first', () => {
    const squat = byId('back-squat'); // lowers first
    const tlS = timeline(squat);
    const [p0, out, p1] = tlS.segments;
    expect(momentAt(squat, tlS, p0 / 2)).toMatchObject({ phase: 'start', action: 'holding' });
    expect(momentAt(squat, tlS, p0 + out / 2)).toMatchObject({ phase: 'out', action: 'lowering' });
    expect(momentAt(squat, tlS, p0 + out + p1 / 2)).toMatchObject({ phase: 'far', action: 'holding', s: 1 });
    expect(momentAt(squat, tlS, tlS.total - 0.2)).toMatchObject({ phase: 'back', action: 'lifting' });

    const curl = byId('dumbbell-curl'); // lifts first
    const tlC = timeline(curl);
    expect(momentAt(curl, tlC, tlC.segments[0] + tlC.segments[1] / 2).action).toBe('lifting');
    expect(momentAt(curl, tlC, tlC.total - 0.2).action).toBe('lowering');
  });

  it('treats holds as one steady phase', () => {
    const plank = byId('plank');
    expect(momentAt(plank, timeline(plank), 12.3)).toMatchObject({ phase: 'hold', action: 'holding' });
  });
});

describe('levels', () => {
  const spec: Engagement = {
    profile: [0.3, 0.7, 1],
    muscles: [
      { group: 'quads', role: 'main', peak: 1 },
      { group: 'hamstrings', role: 'assist', peak: 0.6 },
      { group: 'core', role: 'stabilize', peak: 0.4 },
    ],
  };
  const at = (m: Partial<Moment>): Moment => ({ phase: 'far', s: 1, u: 0, action: 'holding', ...m });

  it('shows each mover at its peak at the hardest point and lower at rest', () => {
    const far = levelsAt(spec, at({}));
    expect(far.quads).toBeCloseTo(1);
    expect(far.hamstrings).toBeCloseTo(0.6);
    const start = levelsAt(spec, at({ phase: 'start', s: 0 }));
    expect(start.quads).toBeCloseTo(0.3);
    expect(start.hamstrings).toBeCloseTo(0.18);
    expect(far.chest).toBe(0);
  });

  it('keeps stabilisers nearly steady', () => {
    const lo = levelsAt(spec, at({ phase: 'start', s: 0 })).core;
    const hi = levelsAt(spec, at({})).core;
    expect(hi).toBeCloseTo(0.4);
    expect(lo).toBeGreaterThan(0.4 * 0.7);
    expect(lo).toBeLessThan(hi);
  });

  it('shows less work while lowering than while lifting through the same position', () => {
    const lifting = levelOf(spec.muscles[0], spec, at({ phase: 'back', s: 0.5, u: 0.5, action: 'lifting' }));
    const lowering = levelOf(spec.muscles[0], spec, at({ phase: 'out', s: 0.5, u: 0.5, action: 'lowering' }));
    expect(lowering).toBeCloseTo(lifting * 0.8);
    // No dip at the ends of the lowering phase, so nothing jumps at a pause.
    expect(levelOf(spec.muscles[0], spec, at({ phase: 'out', s: 1, u: 1, action: 'lowering' }))).toBeCloseTo(1);
  });

  it('keeps muscles off while the load rests at the start, then brings them on as it leaves', () => {
    const lift: Engagement = { profile: [1, 0.7, 0.4], restAtStart: true, muscles: [{ group: 'glutes', role: 'main', peak: 1 }, { group: 'core', role: 'stabilize', peak: 0.4 }] };
    expect(levelsAt(lift, at({ phase: 'start', s: 0 })).glutes).toBeCloseTo(0.1);
    expect(levelsAt(lift, at({ phase: 'start', s: 0 })).core).toBeLessThan(0.2);
    expect(levelsAt(lift, at({ phase: 'out', s: 0.12, u: 0.2, action: 'lifting' })).glutes).toBeGreaterThan(0.9);
  });

  it('gives a muscle its own curve when it has one', () => {
    const press: Engagement = { profile: [0.5, 1, 0.5], muscles: [{ group: 'shoulders', role: 'main', peak: 1 }, { group: 'quads', role: 'assist', peak: 0.6, profile: [1, 0.2, 0.1] }] };
    const mid = levelsAt(press, at({ phase: 'out', s: 0.5, u: 0.5, action: 'lifting' }));
    expect(mid.shoulders).toBeCloseTo(1);
    expect(mid.quads).toBeCloseTo(0.12);
  });

  it('reports peaks for still pictures', () => {
    expect(peakLevels(spec)).toMatchObject({ quads: 1, hamstrings: 0.6, core: 0.4, back: 0 });
  });

  it('derives a fallback from the library lists', () => {
    const e = byId('back-squat');
    const d = defaultEngagement(e);
    expect(d.muscles.filter((m) => m.role === 'main').map((m) => m.group)).toEqual(e.primary);
    expect(d.muscles.filter((m) => m.role === 'assist').map((m) => m.group)).toEqual(e.secondary);
    expect(defaultEngagement(byId('plank')).profile).toEqual([1, 1, 1]);
  });
});

describe('engagement colour', () => {
  it('runs from the resting grey through the heat ramp to red', () => {
    expect(engageColour(0)).toBe('var(--an-muscle)');
    expect(engageColour(0.14)).toBe('var(--amber)');
    expect(engageColour(0.45)).toBe('var(--orange)');
    expect(engageColour(0.75)).toBe('var(--flame)');
    expect(engageColour(1)).toBe('var(--red)');
    expect(engageColour(5)).toBe('var(--red)');
    expect(engageColour(0.6)).toBe('color-mix(in oklab, var(--flame) 50%, var(--orange))');
    expect(engageColour(0.07)).toBe('color-mix(in oklab, var(--amber) 50%, var(--an-muscle))');
  });
});

describe('one-sided exercises', () => {
  it('keep the resting arm and leg near rest and share the trunk', () => {
    const levels = peakLevels(defaultEngagement(byId('one-arm-dumbbell-row')));
    const rest = restingSide(levels);
    for (const g of LIMB_GROUPS) expect(rest[g]).toBeCloseTo(levels[g] * RESTING_SIDE);
    for (const g of ['chest', 'back', 'core'] as const) expect(rest[g]).toBe(levels[g]);
    expect(levels.back).toBeGreaterThan(0);
  });
});
