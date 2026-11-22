// The researched muscle-engagement data behind the demo colours: every
// exercise has an entry, it names exactly the muscles the library lists for
// it, and roles, peaks and curves stay in range.
import { describe, expect, it } from 'vitest';
import { ENGAGEMENT, engagementFor } from '../src/data/engagement';
import { EXERCISES } from '../src/data/exercises';
import { PEAK_RANGE } from '../src/demo/engagement';

const inUnit = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
const step = (v: number) => Math.abs(v * 20 - Math.round(v * 20)) < 1e-9;

describe('muscle engagement data', () => {
  // Skipped only while the researched data is being filled in.
  it.skipIf(Object.keys(ENGAGEMENT).length === 0)('covers every exercise in the library, and nothing else', () => {
    const ids = new Set(EXERCISES.map((e) => e.id));
    expect(Object.keys(ENGAGEMENT).filter((id) => !ids.has(id))).toEqual([]);
    expect(EXERCISES.filter((e) => !ENGAGEMENT[e.id]).map((e) => e.id)).toEqual([]);
  });

  it.each(EXERCISES.map((e) => [e.id, e] as const))('%s: the library muscles, with sensible roles and levels', (_, e) => {
    const spec = engagementFor(e);
    const groups = spec.muscles.map((m) => m.group);
    expect(new Set(groups).size, 'no muscle twice').toBe(groups.length);
    expect([...groups].sort()).toEqual([...e.primary, ...e.secondary].sort());
    for (const m of spec.muscles) {
      if (e.primary.includes(m.group)) expect(m.role, `${m.group} is a primary muscle`).toBe('main');
      else expect(['assist', 'stabilize'], `${m.group} is a secondary muscle`).toContain(m.role);
      const [lo, hi] = PEAK_RANGE[m.role];
      expect(m.peak, `${m.group} peak`).toBeGreaterThanOrEqual(lo);
      expect(m.peak, `${m.group} peak`).toBeLessThanOrEqual(hi);
      expect(step(m.peak), `${m.group} peak in steps of 0.05`).toBe(true);
      if (m.profile) expect(m.profile.every(inUnit), `${m.group} profile`).toBe(true);
    }
    expect(spec.profile.every(inUnit), 'profile within 0..1').toBe(true);
    if (e.tracking.kind === 'hold') expect(spec.profile).toEqual([1, 1, 1]);
    // The profile is relative to the hardest point of the rep, which is 1.
    else expect(Math.max(...spec.profile)).toBe(1);
  });
});
