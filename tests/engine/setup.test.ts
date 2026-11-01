import { describe, expect, it } from 'vitest';
import { getExercise } from '../../src/data/exercises';
import { SetupStabilizer, checkSetup } from '../../src/engine/setup';
import type { PoseFrame, PoseSequence } from '../../src/engine/types';
import { fixture } from '../fixtures/load';

const ex = (id: string) => getExercise(id)!;
const first = (seq: PoseSequence) => seq.frames.find((f) => f.lm)!;
const check = (id: string, seq: PoseSequence, frame: PoseFrame = first(seq)) =>
  checkSetup(frame, ex(id), seq.width, seq.height);
/** Moves every landmark by (dx, dy) in normalized units. */
const shift = (f: PoseFrame, dx: number, dy: number): PoseFrame => ({
  ...f,
  lm: f.lm!.map(([x, y, z, v]) => (v ? [x + dx, y + dy, z, v] : [x, y, z, v])),
});

describe('setup check', () => {
  it('passes a side-on lifter fully in frame', () => {
    const s = check('back-squat', fixture('squat-good'));
    expect(s.ready).toBe(true);
    expect(s.nudge).toBeNull();
    expect(s.items.filter((i) => i.blocking).every((i) => i.ok)).toBe(true);
  });

  it('passes the matching placement for lying and front-view exercises', () => {
    expect(check('bench-press', fixture('bench-good')).ready).toBe(true);
    expect(check('plank', fixture('plank-good'), fixture('plank-good').frames.at(-1)!).ready).toBe(true);
    expect(check('lateral-raise', fixture('lateral-raise-front')).ready).toBe(true);
  });

  it('asks the lifter to turn side-on when facing the camera', () => {
    const s = check('back-squat', fixture('squat-front'));
    expect(s.ready).toBe(false);
    expect(s.items.find((i) => i.id === 'view')!.ok).toBe(false);
    expect(s.nudge).toBe('Turn side-on to the camera.');
  });

  it('asks the lifter to face the camera for front-view exercises', () => {
    const s = check('lateral-raise', fixture('squat-good'));
    expect(s.ready).toBe(false);
    expect(s.nudge).toBe('Turn to face the camera.');
  });

  it('says to step back when the feet are cut off', () => {
    const seq = fixture('squat-good');
    const s = check('back-squat', seq, shift(first(seq), 0, 0.1));
    expect(s.ready).toBe(false);
    expect(s.nudge).toBe('Step back: your feet are cut off.');
  });

  it('says to step back when the head is cut off', () => {
    const seq = fixture('squat-good');
    const s = check('back-squat', seq, shift(first(seq), 0, -0.2));
    expect(s.nudge).toBe('Step back: your head is cut off.');
  });

  it('says to move to the middle when off to one side', () => {
    const seq = fixture('squat-good');
    expect(check('back-squat', seq, shift(first(seq), 0.6, 0)).nudge).toBe('Move toward the middle of the frame.');
  });

  it('asks for clear visibility when landmarks are low-confidence', () => {
    const seq = fixture('squat-good');
    const f = first(seq);
    // Both knees: with only the near one dimmed the check rightly uses the far side.
    const dim: PoseFrame = { ...f, lm: f.lm!.map((l, i) => (i === 25 || i === 26 ? [l[0], l[1], l[2], 0.2] : l)) };
    const s = check('back-squat', seq, dim);
    expect(s.ready).toBe(false);
    expect(s.nudge).toMatch(/knees .*clearly visible/);
  });

  it('asks the lifter to step into view when nobody is detected', () => {
    const s = checkSetup(null, ex('back-squat'), 720, 1280);
    expect(s.ready).toBe(false);
    expect(s.nudge).toBe('Step into view of the camera.');
  });

  it('flags phone orientation without blocking recording', () => {
    const seq = fixture('squat-good');
    const s = checkSetup(first(seq), ex('back-squat'), 1280, 720); // landscape frame
    expect(s.items.find((i) => i.id === 'orientation')!.ok).toBe(false);
    expect(s.items.find((i) => i.id === 'orientation')!.blocking).toBe(false);
  });

  it('only checks the landmarks each exercise needs', () => {
    // A calf raise needs the feet but not the head.
    const seq = fixture('calf-raise');
    const f = first(seq);
    const noHead: PoseFrame = { ...f, lm: f.lm!.map((l, i) => (i <= 10 ? [l[0], l[1], l[2], 0] : l)) };
    expect(check('standing-calf-raise', seq, noHead).ready).toBe(true);
    expect(check('back-squat', seq, noHead).ready).toBe(false); // the squat config requires the nose
  });
});

describe('SetupStabilizer', () => {
  it('waits for a steady pass before reporting ready', () => {
    const s = new SetupStabilizer(800);
    expect(s.push(0, true)).toBe(false);
    expect(s.push(400, true)).toBe(false);
    expect(s.push(700, true)).toBe(true);
    expect(s.push(733, false)).toBe(false);
  });

  it('tolerates a single dropped frame but not repeated ones', () => {
    const s = new SetupStabilizer(800);
    let t = 0;
    for (; t <= 900; t += 33) s.push(t, t !== 300);
    expect(s.push(t, true)).toBe(true);
    for (let k = 0; k < 10; k++) s.push((t += 33), k % 3 === 0);
    expect(s.push((t += 33), true)).toBe(false);
  });
});
