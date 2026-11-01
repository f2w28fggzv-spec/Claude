import { describe, expect, it } from 'vitest';
import { getExercise } from '../../src/data/exercises';
import type { Exercise } from '../../src/data/types';
import { analyze } from '../../src/engine/analyze';
import { OnlineRepCounter, segmentReps, trackedSignal } from '../../src/engine/reps';
import type { Reader } from '../../src/engine/landmarks';
import type { PoseSequence } from '../../src/engine/types';
import { Zigzag } from '../../src/engine/zigzag';
import { fixture } from '../fixtures/load';
import * as S from '../fixtures/synth';

const ex = (id: string) => getExercise(id)!;
const count = (id: string, seq: PoseSequence) => analyze(ex(id), seq).reps.length;
const reps = (e: Exercise) => e.tracking as Extract<Exercise['tracking'], { kind: 'reps' }>;

describe('Zigzag', () => {
  it('confirms alternating turning points and ignores moves smaller than h', () => {
    const zz = new Zigzag(10);
    const values = [0, 2, 20, 30, 25, 5, 0, 3, 1, 40, 38];
    values.forEach((v, i) => zz.push(i, v));
    const e = zz.finish();
    expect(e.map((x) => x.type)).toEqual(['top', 'bottom', 'top', 'bottom']);
    expect(e.map((x) => x.index)).toEqual([0, 3, 6, 9]);
  });

  it('reports nothing for a still signal', () => {
    const zz = new Zigzag(5);
    for (let i = 0; i < 50; i++) zz.push(i, 100 + (i % 2));
    expect(zz.finish()).toEqual([]);
  });

  it('skips missing samples', () => {
    const zz = new Zigzag(10);
    [0, NaN, 30, NaN, 0].forEach((v, i) => zz.push(i, v));
    expect(zz.finish().map((e) => e.index)).toEqual([0, 2, 4]);
  });
});

describe('rep counting (fixtures)', () => {
  it.each([
    ['squat-good', 'back-squat', 4],
    ['squat-shallow', 'back-squat', 4],
    ['squat-noisy', 'back-squat', 4],
    ['squat-front', 'back-squat', 4],
    ['bench-good', 'bench-press', 4],
    ['bench-partial', 'bench-press', 4],
    ['deadlift-good', 'deadlift', 4],
    ['rdl-good', 'romanian-deadlift', 4],
    ['ohp-good', 'overhead-press', 4],
    ['row-good', 'barbell-row', 4],
    ['lateral-raise-front', 'lateral-raise', 4],
    ['calf-raise', 'standing-calf-raise', 6],
  ])('%s counts %i reps as %s', (name, id, n) => {
    expect(count(id, fixture(name))).toBe(n);
  });

  it('does not count a rep the recording cuts off at the bottom', () => {
    expect(count('back-squat', fixture('squat-cut'))).toBe(2);
  });

  it('ignores small bounces between reps', () => {
    expect(count('back-squat', fixture('squat-bounces'))).toBe(2);
  });

  it('skips a rep already in progress when the recording starts or ends', () => {
    const seq = fixture('squat-good');
    const t0 = 2000; // mid-way down the first rep
    const late = { ...seq, frames: seq.frames.filter((f) => f.t >= t0).map((f) => ({ ...f, t: f.t - t0 })) };
    expect(count('back-squat', late)).toBe(3);
    const t1 = 15200; // mid-way up the last rep
    const early = { ...seq, frames: seq.frames.filter((f) => f.t <= t1) };
    expect(count('back-squat', early)).toBe(3);
  });

  it('bridges short tracking gaps but not long ones', () => {
    const short = S.squat({ seed: 9, absent: [{ fromMs: 2400, toMs: 2700 }] });
    expect(count('back-squat', short)).toBe(4);
    const hiddenHip = S.squat({ seed: 9, dropouts: [{ joints: ['hip'], fromMs: 1500, toMs: 4500, visibility: 0.1 }] });
    expect(count('back-squat', hiddenHip)).toBe(3);
  });

  it('does not depend on frame rate', () => {
    for (const fps of [10, 15, 30, 60]) expect(count('back-squat', S.squat({ fps, seed: fps })), `${fps} fps`).toBe(4);
  });

  it('counts nothing and says why when there is no movement', () => {
    const still = S.squat({ reps: [] });
    const r = analyze(ex('back-squat'), still);
    expect(r.reps).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/No reps detected/);
  });

  it('reports no person when nobody is in the frame', () => {
    const empty = { ...fixture('squat-good'), frames: fixture('squat-good').frames.map((f) => ({ ...f, lm: null })) };
    const r = analyze(ex('back-squat'), empty);
    expect(r.reps).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/No person/);
  });
});

describe('rep positions', () => {
  it('down-first: bottom is the turnaround, top is where the rep finishes', () => {
    for (const r of analyze(ex('back-squat'), fixture('squat-good')).reps) {
      expect(r.startFrame).toBeLessThan(r.turnFrame);
      expect(r.turnFrame).toBeLessThan(r.endFrame);
      expect(r.bottomFrame).toBe(r.turnFrame);
      expect(r.topFrame).toBe(r.endFrame);
    }
  });

  it('up-first: bottom is the set-up, top is the turnaround', () => {
    for (const r of analyze(ex('deadlift'), fixture('deadlift-good')).reps) {
      expect(r.bottomFrame).toBe(r.startFrame);
      expect(r.topFrame).toBe(r.turnFrame);
    }
  });

  it('places the squat bottom at the deepest frame', () => {
    const seq = fixture('squat-good');
    const reader: Reader = { width: seq.width, height: seq.height, view: 'side', side: 'right' };
    const y = trackedSignal(seq, reps(ex('back-squat')), reader);
    for (const r of segmentReps(seq, reps(ex('back-squat')), reader, 300)) {
      const window = y.slice(r.startFrame, r.endFrame + 1);
      expect(y[r.turnFrame]).toBeGreaterThanOrEqual(Math.max(...window) - 2);
    }
  });
});

describe('OnlineRepCounter', () => {
  it.each([
    ['squat-good', 'back-squat'],
    ['deadlift-good', 'deadlift'],
    ['calf-raise', 'standing-calf-raise'],
    ['squat-bounces', 'back-squat'],
  ])('matches the offline count live on %s', (name, id) => {
    const seq = fixture(name);
    const e = ex(id);
    const offline = analyze(e, seq);
    const reader: Reader = { width: seq.width, height: seq.height, view: e.placement.view, side: 'right' };
    const counter = new OnlineRepCounter(reps(e), offline.torsoPx);
    let candidates = 0;
    seq.frames.forEach((f, i) => {
      const j = { hip: 24, wrist: 16, heel: 30 }[reps(e).joint as 'hip' | 'wrist' | 'heel'];
      const lm = f.lm?.[j];
      const out = counter.push(i, lm && lm[3] >= 0.5 ? lm[1] * reader.height : NaN);
      if (out.candidate) candidates++;
    });
    expect(counter.count).toBe(offline.reps.length);
    expect(candidates).toBeGreaterThan(offline.reps.length);
  });
});
