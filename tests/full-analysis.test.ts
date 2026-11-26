// The push-up and the reverse lunge (full analysis): every check passes the
// exercise's own demo, for both bodies; each check fails a faulty variant of
// the demo made for it while every other check still passes; and the reverse
// lunge reads the same with the other leg leading (legs alternate in a set).
import { describe, expect, it } from 'vitest';
import { getExercise } from '../src/data/exercises';
import { MUSCLE_GROUPS, type Exercise } from '../src/data/types';
import type { Levels } from '../src/demo/engagement';
import { L, along, legTo, solve, sub, type Figure, type Side, type Vec } from '../src/demo/figure';
import * as D from '../src/demo/patterns';
import { demoBounds, figureAt, frameMarkup } from '../src/demo/render';
import type { Demo } from '../src/demo/types';
import { analyze } from '../src/engine/analyze';
import { angleDeg } from '../src/engine/geometry';
import type { AnalysisResult, CheckResult, PoseSequence } from '../src/engine/types';
import { demoSequence, hipsOffLine, type DemoMoment, type DemoSequenceOptions } from './fixtures/demoSeq';

const ex = (id: string) => getExercise(id)!;
const REST = Object.fromEntries(MUSCLE_GROUPS.map((g) => [g, 0])) as Levels;

/** Every check on every rep, by check id. */
const byCheck = (r: AnalysisResult, id: string): CheckResult[] => r.reps.map((rep) => rep.checks.find((c) => c.checkId === id)!);

/** Three reps counted, no warnings; the checks in `failing` fail on every rep and every other check passes on every rep. */
function expectOnly(e: Exercise, r: AnalysisResult, failing: string[]) {
  expect(r.warnings, 'warnings').toEqual([]);
  expect(r.reps.length, 'reps counted').toBe(3);
  for (const c of e.checks) {
    const got = byCheck(r, c.id).map((x) => `${x.status} (${x.measured ?? x.reason})`);
    for (const g of got) expect(g, c.id).toMatch(failing.includes(c.id) ? /^fail / : /^pass /);
  }
}

/** The demo with its own movement remapped (progress s → `to(s)`). */
const remap = (d: Demo, to: (s: number) => number): Demo => ({ ...d, pose: (s) => d.pose(to(s)) });

/** The demo paced as if the exercise had no tempo check (which would slow a fast lowering down), lowering in `out` seconds. */
function lowering(e: Exercise, out: number, o: DemoSequenceOptions = {}) {
  return demoSequence({ ...e, checks: e.checks.filter((c) => c.type !== 'tempo'), demo: { ...e.demo, timing: { ...e.demo.timing, out } } }, o);
}

describe.each(['push-up', 'reverse-lunge'])('%s: full analysis', (id) => {
  const e = ex(id);

  it('is full analysis with the checks this file tests', () => {
    expect(e.analysis).toBe('full');
    expect(e.checks.map((c) => c.id)).toEqual(
      id === 'push-up' ? ['depth', 'lockout-elbow', 'angle-body-bottom', 'angle-body-top'] : ['depth', 'torso-bottom', 'lockout-knee', 'tempo-eccentric'],
    );
  });

  it.each(['male', 'female'] as const)('passes every check on the demo for the %s figure', (body) => {
    // Both bodies are drawn on the skeleton figureAt solves (it takes no body); only the drawing
    // differs. That skeleton is exactly what demoSequence turns into landmarks.
    const other = body === 'male' ? 'female' : 'male';
    const box = demoBounds(e.demo);
    for (const s of [0, 0.5, 1]) {
      expect(frameMarkup(e.demo, s, REST, box, { body })).not.toBe(frameMarkup(e.demo, s, REST, box, { body: other }));
      const drawn = figureAt(e.demo, s);
      const read = solve(e.demo.view, e.demo.pose(s));
      expect([drawn.a, drawn.b, drawn.nose, drawn.ear, drawn.ear2]).toEqual([read.a, read.b, read.nose, read.ear, read.ear2]);
    }
    expectOnly(e, analyze(e, demoSequence(e)), []);
  });
});

// ── Push-up ──────────────────────────────────────────────────────────────

describe('push-up: faulty variants fail only their own check', () => {
  const e = ex('push-up');

  it('depth: stopping with the chest about 12 cm off the floor (70% of the way down)', () => {
    const r = analyze(e, demoSequence({ ...e, demo: remap(e.demo, (s) => 0.7 * s) }));
    expectOnly(e, r, ['depth']);
    for (const c of byCheck(r, 'depth')) expect(c.value!).toBeLessThan(-0.1);
    // The demo itself, to full depth, is well inside the tolerance.
    for (const c of byCheck(analyze(e, demoSequence(e)), 'depth')) expect(c.value!).toBeGreaterThan(0);
  });

  it('lockout: turning around before the arms straighten', () => {
    expectOnly(e, analyze(e, demoSequence({ ...e, demo: remap(e.demo, (s) => 0.08 + 0.92 * s) })), ['lockout-elbow']);
  });

  it('body line at the bottom: hips sagging about 10 cm as the body lowers', () => {
    expectOnly(e, analyze(e, demoSequence(e, { edit: (f, at) => hipsOffLine(f, 0.06 * at.s) })), ['angle-body-bottom']);
  });

  it('body line at the top: hips piked about 10 cm at straight arms', () => {
    expectOnly(e, analyze(e, demoSequence(e, { edit: (f, at) => hipsOffLine(f, -0.06 * (1 - at.s)) })), ['angle-body-top']);
  });

  it('has no tempo check, so a brisk set passes', () => {
    expect(e.checks.some((c) => c.type === 'tempo')).toBe(false);
    expectOnly(e, analyze(e, lowering(e, 0.6)), []);
  });
});

// ── Reverse lunge ────────────────────────────────────────────────────────

const LEG = ['hip', 'knee', 'ankle', 'heel', 'ball', 'toe'] as const;
/** The figure with its legs swapped: the other leg leads, so the near leg is the one behind. */
function swapLegs(f: Figure): Figure {
  const a = { ...f.a };
  const b = { ...f.b };
  for (const k of LEG) [a[k], b[k]] = [f.b[k], f.a[k]];
  return { ...f, a, b };
}
/** The other leg leads on the second rep. */
const alternating = (f: Figure, at: DemoMoment) => (at.rep === 1 ? swapLegs(f) : f);

describe('reverse lunge: faulty variants fail only their own check', () => {
  const e = ex('reverse-lunge');

  it('depth: stopping 70% of the way down, the back knee well off the floor', () => {
    const r = analyze(e, demoSequence({ ...e, demo: remap(e.demo, (s) => 0.7 * s) }));
    expectOnly(e, r, ['depth']);
    for (const c of byCheck(r, 'depth')) expect(c.value!).toBeLessThan(-1.2);
  });

  it('torso: leaning 35° forward at the bottom', () => {
    expectOnly(e, analyze(e, demoSequence({ ...e, demo: D.lunge({ rear: 'floor', step: 'back', lean: 35 }) })), ['torso-bottom']);
  });

  it('lockout: staying in the split stance between reps instead of standing up', () => {
    expectOnly(e, analyze(e, demoSequence({ ...e, demo: remap(e.demo, (s) => 0.45 + 0.55 * s) })), ['lockout-knee']);
  });

  it('tempo: dropping into the lunge in half a second', () => {
    expectOnly(e, analyze(e, lowering(e, 0.5)), ['tempo-eccentric']);
  });
});

describe('reverse lunge: the leading leg', () => {
  const e = ex('reverse-lunge');

  it('reads the same with the other leg leading on the second rep', () => {
    const same = analyze(e, demoSequence(e));
    const alt = analyze(e, demoSequence(e, { edit: alternating }));
    expectOnly(e, alt, []);
    for (const c of e.checks) {
      const a = byCheck(same, c.id).map((x) => x.value!);
      const b = byCheck(alt, c.id).map((x) => x.value!);
      for (let i = 0; i < 3; i++) expect(Math.abs(b[i] - a[i]), `${c.id} rep ${i + 1}`).toBeLessThan(c.type === 'relativeHeight' ? 0.02 : 1);
    }
  });

  it('still catches each fault with the other leg leading', () => {
    expectOnly(e, analyze(e, demoSequence({ ...e, demo: remap(e.demo, (s) => 0.7 * s) }, { edit: alternating })), ['depth']);
    expectOnly(e, analyze(e, demoSequence({ ...e, demo: remap(e.demo, (s) => 0.45 + 0.55 * s) }, { edit: alternating })), ['lockout-knee']);
  });
});

/**
 * The way back with the stepping foot landing late: the front leg straightens first, so the hips reach
 * standing height `late` of the way-back time before the back foot, swung in off the floor with its knee
 * bent, lands beside the front one (the demo lands it as the hips arrive). Leg b steps.
 */
function lateLanding(d: Demo, late: number) {
  const stand = solve('side', d.pose(0));
  const lifted = { x: stand.b.ankle.x - 0.12, y: stand.b.ankle.y - 0.06 };
  return (f: Figure, at: DemoMoment): Figure => {
    if (!at.back) return f;
    const sh = Math.max(0, (at.s - late) / (1 - late));
    const hips = solve('side', d.pose(sh));
    let ankle: Vec;
    let foot: Side;
    if (at.s <= late) {
      const u = at.s / late; // 1 → 0: the foot comes in and down
      ankle = { x: stand.b.ankle.x + (lifted.x - stand.b.ankle.x) * u, y: stand.b.ankle.y + (lifted.y - stand.b.ankle.y) * Math.sin((Math.PI / 2) * u) };
      foot = stand.b;
    } else {
      const w = sh < 0.4 ? 1 - sh / 0.4 : 0; // from the demo's own path into the lifted swing
      const o = hips.b.ankle;
      ankle = { x: o.x + (lifted.x - o.x) * w, y: o.y + (lifted.y - o.y) * w };
      foot = hips.b;
    }
    const hip = hips.b.hip;
    const v = sub(ankle, hip);
    const leg = legTo(hip, ankle, { x: v.y, y: -v.x });
    const knee = along(hip, leg.thigh, L.thigh);
    const end = along(knee, leg.shin, L.shin);
    const mv = (p: Vec): Vec => ({ x: p.x - foot.ankle.x + end.x, y: p.y - foot.ankle.y + end.y });
    return { ...hips, b: { ...hips.b, knee, ankle: end, heel: mv(foot.heel), ball: mv(foot.ball), toe: mv(foot.toe) } };
  };
}

/** The near knee's angle (the leg the camera sees) in one frame. */
function nearKnee(seq: PoseSequence, i: number) {
  const [w, h] = [seq.width, seq.height];
  const p = (k: number) => ({ x: seq.frames[i].lm![k][0] * w, y: seq.frames[i].lm![k][1] * h });
  return angleDeg(p(24), p(26), p(28));
}

describe('reverse lunge: standing up', () => {
  const e = ex('reverse-lunge');

  it('counts a lockout reached as the stepping foot lands just after the hips top out', () => {
    // The near leg steps back (legs swapped through the set), so its knee is still bent when the hips
    // reach the top and straightens about 0.24 s later, as the foot lands.
    const late = lateLanding(e.demo, 0.2);
    const seq = demoSequence(e, { edit: (f, at) => (at.rep < 3 ? swapLegs(late(f, at)) : f) });
    const r = analyze(e, seq);
    expectOnly(e, r, []);
    for (const rep of r.reps) expect(nearKnee(seq, rep.endFrame)).toBeLessThan(160);
  });
});
