// Every exercise has an animated demo, and the demo shows form the engine's
// own checks accept: run as a recording, it counts its reps and passes.
import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../src/data/exercises';
import { L, dist, solve } from '../src/demo/figure';
import { analyze } from '../src/engine/analyze';
import { demoSequence } from './fixtures/demoSeq';

describe('exercise demos', () => {
  it.each(EXERCISES.map((e) => [e.id, e] as const))('%s: demo matches the camera view and stays well-formed', (_, e) => {
    expect(e.demo.view).toBe(e.placement.view);
    for (let k = 0; k <= 10; k++) {
      const f = solve(e.demo.view, e.demo.pose(k / 10));
      for (const side of [f.a, f.b]) {
        for (const p of Object.values(side)) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        }
        expect(dist(side.hip, side.knee)).toBeCloseTo(L.thigh, 6);
        expect(dist(side.knee, side.ankle)).toBeCloseTo(L.shin, 6);
      }
    }
  });

  it.each(EXERCISES.map((e) => [e.id, e] as const))('%s: demo passes its own checks', (_, e) => {
    const r = analyze(e, demoSequence(e));
    expect(r.warnings, 'warnings').toEqual([]);
    if (e.tracking.kind === 'hold') {
      expect(r.hold, 'hold found').toBeDefined();
      for (const c of r.hold!.checks) expect(`${c.checkId}: ${c.status} ${c.measured ?? c.reason}`).toMatch(/: pass /);
      return;
    }
    expect(r.reps.length, 'reps counted').toBe(3);
    const failures = r.reps.flatMap((rep) =>
      rep.checks.filter((c) => c.status !== 'pass').map((c) => `rep ${rep.index + 1} ${c.checkId}: ${c.status} (${c.measured ?? c.reason}; target ${c.target})`),
    );
    expect(failures).toEqual([]);
  });
});
