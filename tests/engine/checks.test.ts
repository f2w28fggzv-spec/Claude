// One block per check type: pass, fail and "couldn't judge", all from
// landmark fixtures.
import { describe, expect, it } from 'vitest';
import { getExercise, EXERCISES } from '../../src/data/exercises';
import { ANGLES, C } from '../../src/data/helpers';
import type { Check, Exercise } from '../../src/data/types';
import { analyze, withOverrides } from '../../src/engine/analyze';
import type { AnalysisResult, CheckStatus, PoseSequence, RawLandmark } from '../../src/engine/types';
import { fixture } from '../fixtures/load';
import * as S from '../fixtures/synth';
import { demoSequence } from '../fixtures/demoSeq';

const ex = (id: string) => getExercise(id)!;
/** Status of one check across all reps. */
const statuses = (r: AnalysisResult, checkId: string): CheckStatus[] =>
  r.reps.map((rep) => rep.checks.find((c) => c.checkId === checkId)!.status);
const run = (id: string, name: string) => analyze(ex(id), fixture(name));
/** A library exercise with its checks replaced, to test one check type in isolation. */
const withChecks = (id: string, checks: Check[], over: Partial<Exercise> = {}): Exercise => ({
  ...ex(id),
  ...over,
  checks,
  faults: [{ id: 'f', label: 'f', cue: 'cue', corrective: 'plank' }],
});

describe('relativeHeight (squat depth)', () => {
  it('passes reps at depth and fails shallow ones', () => {
    expect(statuses(run('back-squat', 'squat-good'), 'depth')).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(statuses(run('back-squat', 'squat-shallow'), 'depth')).toEqual(['pass', 'fail', 'pass', 'fail']);
  });

  it('reports the fault and a readable measurement', () => {
    const rep = run('back-squat', 'squat-shallow').reps[1];
    const depth = rep.checks.find((c) => c.checkId === 'depth')!;
    expect(depth.fault).toBe('shallowDepth');
    expect(depth.measured).toMatch(/^Hip \d+% of torso above knee$/);
    expect(depth.target).toBe('at or below knee');
  });

  it('honours a tuned margin', () => {
    const strict = { 'back-squat': { depth: { margin: 0.3 } } };
    const lenient = { 'back-squat': { depth: { margin: -0.3 } } };
    expect(statuses(analyze(ex('back-squat'), fixture('squat-good'), { overrides: strict }), 'depth')).toEqual(Array(4).fill('fail'));
    expect(statuses(analyze(ex('back-squat'), fixture('squat-shallow'), { overrides: lenient }), 'depth')).toEqual(Array(4).fill('pass'));
    expect(withOverrides(ex('back-squat'), strict).find((c) => c.id === 'depth')).toMatchObject({ margin: 0.3 });
  });

  it("can't judge a rep where the knee is hidden at the bottom", () => {
    const r = run('back-squat', 'squat-noisy');
    expect(statuses(r, 'depth')).toEqual(['pass', 'pass', 'unknown', 'pass']);
    expect(r.reps[2].checks.find((c) => c.checkId === 'depth')!.reason).toMatch(/visible/);
  });
});

describe('torsoAngle', () => {
  it('fails too much forward lean in a squat', () => {
    expect(statuses(run('back-squat', 'squat-lean'), 'torso-bottom')).toEqual(['pass', 'fail', 'pass', 'fail']);
  });
  it('fails a deadlift set-up with the hips above the shoulders', () => {
    expect(statuses(run('deadlift', 'deadlift-good'), 'hips-start')).toEqual(Array(4).fill('pass'));
    expect(statuses(run('deadlift', 'deadlift-hips-high'), 'hips-start')).toEqual(Array(3).fill('fail'));
  });
  it('fails a row where the torso swings up', () => {
    expect(statuses(run('barbell-row', 'row-swinging'), 'torso-top')).toEqual(['pass', 'pass', 'fail', 'fail']);
    expect(statuses(run('barbell-row', 'row-good'), 'torso-bottom')).toEqual(Array(4).fill('pass'));
  });
  it('fails leaning back on an overhead press', () => {
    expect(statuses(run('overhead-press', 'ohp-lean-back'), 'torso-top')).toEqual(['pass', 'pass', 'fail', 'fail']);
  });
});

describe('relativeHeight (bench depth: elbows to shoulder level)', () => {
  it('fails bench reps that stop short of the chest', () => {
    expect(statuses(run('bench-press', 'bench-good'), 'depth')).toEqual(Array(4).fill('pass'));
    expect(statuses(run('bench-press', 'bench-partial'), 'depth')).toEqual(['pass', 'fail', 'pass', 'fail']);
  });
});

describe('jointAngle', () => {
  it('fails a Romanian deadlift that turns into a squat', () => {
    expect(statuses(run('romanian-deadlift', 'rdl-squatting'), 'angle-knee-bottom')).toEqual(['pass', 'pass', 'fail', 'fail']);
  });
});

describe('rangeOfMotion', () => {
  it('passes full reps and fails reduced ones', () => {
    const e = withChecks('lateral-raise', [C.rom('shoulder', 80, 'f')]);
    expect(statuses(analyze(e, fixture('lateral-raise-front')), 'rom-shoulder')).toEqual(['pass', 'pass', 'fail', 'fail']);
  });
  it("can't judge when the joints are hidden for most of the rep", () => {
    const seq = S.squat({ seed: 3, dropouts: [{ joints: ['ankle'], fromMs: 0, toMs: 60000 }] });
    expect(statuses(analyze(ex('goblet-squat'), seq), 'rom-knee')).toEqual(Array(4).fill('unknown'));
  });
});

describe('front view, one-sided exercises', () => {
  it('reads angles from the working side instead of averaging both', () => {
    // Cable lateral raise: one arm moves, the other hangs still.
    const e = ex('cable-lateral-raise');
    const r = analyze(e, demoSequence(e));
    const rom = r.reps.map((rep) => rep.checks.find((c) => c.checkId === 'rom-shoulder')!);
    for (const c of rom) {
      expect(c.status).toBe('pass');
      expect(c.value!).toBeGreaterThan(70); // averaging both arms would give about half
    }
  });
});

/**
 * Three reps, side-on, the hip (tracked) moving 0.9 torso lengths and back, 30 fps: a rest at the start
 * position, 1.2 s out, 0.3 s at the turnaround, 1.2 s back, and a rest after the last rep. Down first,
 * the start position is the top; up first, the bottom. `knee(rested)` gives the knee angle from the
 * seconds the hip has been back at the start position (Infinity before the first rep, null while it moves).
 */
function legSeq(firstMove: 'down' | 'up', knee: (rested: number | null) => number): PoseSequence {
  const [rest, out, far, back] = [0.8, 1.2, 0.3, 1.2];
  const rep = rest + out + far + back;
  const ease = (u: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;
  const frames = [];
  for (let k = 0; k <= Math.round((3 * rep + 1.2) * 30); k++) {
    const t = k / 30;
    const r = Math.min(2, Math.floor(t / rep));
    const x = t - r * rep;
    // Share of the way from the start position to the turnaround.
    const p = t >= 3 * rep || x < rest ? 0 : x < rest + out ? ease((x - rest) / out) : x < rest + out + far ? 1 : 1 - ease((x - rest - out - far) / back);
    const rested = t >= 3 * rep ? t - 3 * rep : x >= rest ? null : r === 0 ? Infinity : x;
    const hipY = firstMove === 'down' ? 450 + 270 * p : 720 - 270 * p;
    const a = ((180 - knee(rested)) / 2) * (Math.PI / 180);
    const pt = { shoulder: [360, hipY - 300], elbow: [370, hipY - 150], wrist: [380, hipY - 40], hip: [360, hipY] } as Record<string, [number, number]>;
    pt.knee = [360 + 255 * Math.sin(a), hipY + 255 * Math.cos(a)];
    pt.ankle = [pt.knee[0] - 256 * Math.sin(a), pt.knee[1] + 256 * Math.cos(a)];
    pt.heel = [pt.ankle[0] - 25, pt.ankle[1] + 15];
    pt.toe = [pt.ankle[0] + 70, pt.ankle[1] + 20];
    const lm: RawLandmark[] = Array.from({ length: 33 }, () => [0, 0, 0, 0]);
    const at = ([x, y]: [number, number], v: number, dx = 0): RawLandmark => [(x + dx) / 720, y / 1280, 0, v];
    const index: Record<string, [number, number]> = { shoulder: [12, 11], elbow: [14, 13], wrist: [16, 15], hip: [24, 23], knee: [26, 25], ankle: [28, 27], heel: [30, 29], toe: [32, 31] };
    for (const [j, [near, farSide]] of Object.entries(index)) {
      lm[near] = at(pt[j], 0.98);
      lm[farSide] = at(pt[j], 0.8, 3);
    }
    lm[0] = at([400, hipY - 420], 0.98);
    lm[8] = at([370, hipY - 425], 0.95);
    lm[7] = at([372, hipY - 425], 0.7);
    frames.push({ t: Math.round(t * 1000), lm });
  }
  return { version: 1, width: 720, height: 1280, source: 'synthetic', frames };
}

describe('lockout', () => {
  describe('at the top of a lift that moves down first (the top is the rep’s last frame)', () => {
    const e = withChecks('back-squat', [C.lockout('knee', 165)]);
    // Knee bent through the rep and until `late` seconds after the hips are back at the top, as when
    // the stepping foot of a lunge lands just after the hips reach standing height.
    const lateLockout = (late: number) => legSeq('down', (rested) => (rested !== null && rested >= late ? 180 : 150));
    it('looks past the rep’s end: a knee that straightens 0.15 s after the hips reach the top counts', () => {
      expect(statuses(analyze(e, lateLockout(0.15)), 'lockout-knee')).toEqual(['pass', 'pass', 'pass']);
    });
    it('but no further than 0.3 s from the top', () => {
      expect(statuses(analyze(e, lateLockout(0.6)), 'lockout-knee')).toEqual(['fail', 'fail', 'fail']);
    });
  });

  it('judges the start of a lift that moves up first from the rep’s own frames, not the ones before it', () => {
    // Knees straight through each rep until just after the hips are back at the bottom, then bent for
    // the next rep's start (and bent from the beginning for the first rep).
    const e = withChecks('deadlift', [C.lockout('knee', 165, 'bottom')]);
    const seq = legSeq('up', (rested) => (rested === null || rested < 0.04 ? 180 : 150));
    expect(statuses(analyze(e, seq), 'lockout-knee')).toEqual(['fail', 'fail', 'fail']);
  });

  it('passes full lockouts', () => {
    expect(statuses(run('deadlift', 'deadlift-good'), 'lockout-hip')).toEqual(Array(4).fill('pass'));
    expect(statuses(run('bench-press', 'bench-good'), 'lockout-elbow')).toEqual(Array(4).fill('pass'));
  });
  it('fails soft lockouts', () => {
    expect(statuses(run('deadlift', 'deadlift-soft-lockout'), 'lockout-hip')).toEqual(Array(4).fill('fail'));
    expect(statuses(run('overhead-press', 'ohp-short-lockout'), 'lockout-elbow')).toEqual(Array(4).fill('fail'));
  });
});

describe('path (wrist path standing in for bar path)', () => {
  it('passes a vertical bar path and fails a drifting one', () => {
    expect(statuses(run('bench-press', 'bench-good'), 'path-wrist')).toEqual(Array(4).fill('pass'));
    expect(statuses(run('bench-press', 'bench-drift'), 'path-wrist')).toEqual(Array(4).fill('fail'));
    expect(statuses(run('deadlift', 'deadlift-good'), 'path-wrist')).toEqual(Array(4).fill('pass'));
  });
});

describe('symmetry', () => {
  const sym = C.symmetry('shoulder', 'top', 15, 'f');
  it('passes even reps and fails when one arm lags (front view)', () => {
    const e = withChecks('lateral-raise', [sym]);
    expect(statuses(analyze(e, fixture('lateral-raise-front')), 'symmetry-shoulder')).toEqual(['pass', 'pass', 'fail', 'fail']);
  });
  it("can't judge from a side-on camera", () => {
    const e = withChecks('back-squat', [C.symmetry('knee', 'bottom', 10, 'f')]);
    const r = analyze(e, fixture('squat-good'));
    expect(statuses(r, 'symmetry-knee')).toEqual(Array(4).fill('unknown'));
    expect(r.reps[0].checks[0].reason).toMatch(/front-on/);
  });
});

describe('tempo', () => {
  it('fails a rushed lowering phase', () => {
    expect(statuses(run('back-squat', 'squat-fast'), 'tempo-eccentric')).toEqual(['pass', 'fail', 'pass']);
    const fast = run('back-squat', 'squat-fast').reps[1].checks.find((c) => c.checkId === 'tempo-eccentric')!;
    expect(fast.value!).toBeLessThan(0.6);
  });
  it('times the right phase when the first move is the lift', () => {
    // Deadlift moves up first and that is the concentric phase (1.2 s out,
    // 1.2 s back in the fixture); a squat's first move is the eccentric.
    const concentric: Check = { id: 'tempo-c', type: 'tempo', label: 't', phase: 'concentric', maxSec: 0.5, fault: 'f', status: 'unvalidated' };
    const eccentric: Check = { ...concentric, id: 'tempo-e', phase: 'eccentric' };
    const dl = analyze(withChecks('deadlift', [concentric, eccentric]), fixture('deadlift-good')).reps[0].checks;
    expect(dl[0].value!).toBeGreaterThan(0.7);
    expect(dl[0].value!).toBeLessThan(1.2);
    const sq = analyze(withChecks('back-squat', [concentric, eccentric]), fixture('squat-good')).reps[0].checks;
    expect(sq[1].value!).toBeGreaterThan(sq[0].value!); // 1.8 s down vs 1.1 s up
  });
  it('is still judged when the camera angle is wrong', () => {
    const r = run('back-squat', 'squat-front');
    expect(statuses(r, 'tempo-eccentric').every((s) => s !== 'unknown')).toBe(true);
  });
});

describe('holdAlignment', () => {
  it('passes a straight plank and fails a sagging one', () => {
    const good = run('plank', 'plank-good');
    expect(good.hold!.durationSec).toBeGreaterThan(11);
    expect(good.hold!.checks[0].status).toBe('pass');
    expect(run('plank', 'plank-sag').hold!.checks[0].status).toBe('fail');
  });
  it('times the longest continuous hold', () => {
    const broken = S.plank({ seconds: 12, absent: [{ fromMs: 5000, toMs: 7000 }] });
    const r = analyze(ex('plank'), broken);
    expect(r.hold!.durationSec).toBeGreaterThan(5);
    expect(r.hold!.durationSec).toBeLessThan(6.5);
  });
  it('warns when no hold is found', () => {
    const r = analyze(ex('plank'), S.plank({ seconds: 0.5 }));
    expect(r.hold).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/hold/);
  });
});

describe('camera angle', () => {
  it("can't judge geometry checks when a side-view lift is filmed from the front", () => {
    const r = run('back-squat', 'squat-front');
    expect(r.reps).toHaveLength(4);
    for (const id of ['depth', 'torso-bottom', 'lockout-knee', 'lockout-hip']) {
      expect(statuses(r, id), id).toEqual(Array(4).fill('unknown'));
    }
    expect(r.reps[0].checks[0].reason).toMatch(/side-on/);
  });
});

describe('every library exercise', () => {
  const seqs = ['squat-good', 'bench-good', 'lateral-raise-front', 'plank-good'].map(fixture);
  it.each(EXERCISES.map((e) => [e.id, e] as const))('%s analyzes without errors', (_, e) => {
    for (const seq of seqs) {
      const r = analyze(e, seq);
      for (const rep of r.reps) {
        expect(rep.checks).toHaveLength(e.checks.length);
        for (const c of rep.checks) {
          expect(['pass', 'fail', 'unknown']).toContain(c.status);
          if (c.status === 'unknown') expect(c.reason).toBeTruthy();
          if (c.status === 'fail') expect(e.faults.map((f) => f.id)).toContain(c.fault);
        }
      }
    }
  });
  it('uses only angle definitions the engine knows', () => {
    const known = new Set(Object.values(ANGLES).map((a) => `${a.a}-${a.vertex}-${a.c}`));
    for (const e of EXERCISES)
      for (const c of e.checks)
        if ('angle' in c) expect(known, `${e.id}/${c.id}`).toContain(`${c.angle.a}-${c.angle.vertex}-${c.angle.c}`);
  });
});
