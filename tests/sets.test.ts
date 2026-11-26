import { describe, expect, it } from 'vitest';
import type { PoseSequence } from '../src/engine/types';
import { getExercise } from '../src/data/exercises';
import { analyze } from '../src/engine/analyze';
import { faultReps, formRating, formText } from '../src/log/form';
import { compactSequence, MAX_REPLAYS, pruneIds, type SavedSetMeta } from '../src/sets/sets';
import { nearestFrame } from '../src/screens/SetPlayer';
import { demoSequence, hipsOffLine } from './fixtures/demoSeq';

const meta = (i: number, video = false): SavedSetMeta => ({
  id: `s${i}`,
  exerciseId: 'back-squat',
  at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
  source: 'camera',
  durationSec: 10,
  reps: 5,
  cleanReps: 4,
  faults: {},
  mirrored: false,
  ...(video ? { video: { bytes: 1000, type: 'video/mp4', offsetMs: 0 } } : {}),
});

describe('saved sets', () => {
  it('rounds landmarks to save room without moving them noticeably', () => {
    const seq: PoseSequence = { version: 1, width: 640, height: 480, source: 'camera', frames: [{ t: 0, lm: [[0.123456789, 0.987654321, -0.1234567, 0.99999]] }, { t: 50, lm: null }] };
    const c = compactSequence(seq);
    expect(c.frames[0].lm?.[0]).toEqual([0.1235, 0.9877, -0.123, 1]);
    expect(c.frames[1]).toEqual({ t: 50, lm: null });
    expect(c.width).toBe(640);
  });

  it('keeps the newest replays and every set with a saved video', () => {
    const index = [...Array.from({ length: MAX_REPLAYS + 5 }, (_, i) => meta(i)), meta(-1, true)];
    const drop = pruneIds(index);
    expect(drop).toHaveLength(5);
    expect(drop).toEqual(['s4', 's3', 's2', 's1', 's0']);
    expect(drop).not.toContain('s-1');
    expect(pruneIds(index.slice(0, 10))).toEqual([]);
  });

  it('rates form by the share of clean reps', () => {
    expect(formRating(5, 5)).toMatchObject({ pct: 100, label: 'Excellent', tone: 'good' });
    expect(formRating(4, 5)).toMatchObject({ pct: 80, label: 'Good' });
    expect(formRating(3, 5)).toMatchObject({ pct: 60, label: 'Fair', tone: 'ok' });
    expect(formRating(1, 5)).toMatchObject({ label: 'Needs work', tone: 'bad' });
    expect(formRating(0, 0)).toBeNull();
    expect(formText(4, 5)).toBe('4/5 clean reps · Good');
  });

  it('counts each fault once per rep, even when two of its checks report it', () => {
    // A push-up sagging through the whole set fails both body-line checks on every rep.
    const pushUp = getExercise('push-up')!;
    const r = analyze(pushUp, demoSequence(pushUp, { edit: (f) => hipsOffLine(f, 0.06) }));
    expect(r.reps.map((rep) => rep.checks.filter((c) => c.fault === 'bodyLine').map((c) => c.status))).toEqual(Array(3).fill(['fail', 'fail']));
    expect(faultReps(r.reps.map((rep) => rep.checks))).toEqual({ bodyLine: 3 });
    expect(faultReps([[{ status: 'fail', fault: 'a' }, { status: 'pass' }], [{ status: 'unknown', fault: 'a' }], [{ status: 'fail', fault: 'b' }, { status: 'fail', fault: 'a' }]])).toEqual({ a: 2, b: 1 });
  });

  it('finds the frame nearest to a time for replays', () => {
    const frames = [0, 33, 66, 100, 133].map((t) => ({ t, lm: null }));
    expect(nearestFrame(frames, 0)).toBe(0);
    expect(nearestFrame(frames, 40)).toBe(1);
    expect(nearestFrame(frames, 60)).toBe(2);
    expect(nearestFrame(frames, 1000)).toBe(4);
    expect(nearestFrame(frames, -5)).toBe(0);
  });
});
