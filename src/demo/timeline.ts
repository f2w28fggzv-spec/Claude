// Timing for demo animations, shared by the renderer and the tests that run
// demos through the engine. A rep: pause at the start, move out, pause at the
// turnaround, move back.
import type { Exercise } from '../data/types';

export interface Timeline {
  /** Seconds per segment: [pause at start, out, pause at turnaround, back]. */
  segments: [number, number, number, number];
  total: number;
}

const ECCENTRIC = 2.0;
const CONCENTRIC = 1.2;
/** Share of a phase the engine counts as moving (it trims the slow ends). */
const MEASURED_SHARE = 0.65;

export function timeline(exercise: Exercise, pauseFar = 0): Timeline {
  if (exercise.tracking.kind === 'hold') return { segments: [1, 0, 0, 0], total: 1 };
  // The slowest a tempo check needs each phase to be (0 = no check), and the demo's default pace:
  // controlled, and always slower than any tempo check needs.
  const need = { eccentric: 0, concentric: 0 };
  for (const c of exercise.checks) {
    if (c.type === 'tempo' && c.minSec) need[c.phase] = Math.max(need[c.phase], c.minSec / MEASURED_SHARE + 0.2);
  }
  const ecc = Math.max(ECCENTRIC, need.eccentric);
  const con = Math.max(CONCENTRIC, need.concentric);
  const eccFirst = exercise.tracking.firstPhase === 'eccentric';
  // A demo can set its own pace (a ballistic swing), but never faster than a tempo check allows.
  const t = exercise.demo?.timing ?? {};
  const minFirst = eccFirst ? ecc : con;
  const minSecond = eccFirst ? con : ecc;
  const pace = (own: number | undefined, fallback: number, phase: 'eccentric' | 'concentric') => (own === undefined ? fallback : Math.max(own, need[phase]));
  const first = pace(t.out, minFirst, eccFirst ? 'eccentric' : 'concentric');
  const second = pace(t.back, minSecond, eccFirst ? 'concentric' : 'eccentric');
  const segments: Timeline['segments'] = [t.start ?? 0.7, first, (t.far ?? 0.35) + pauseFar, second];
  return { segments, total: segments.reduce((a, b) => a + b, 0) };
}

const ease = (u: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;

/** Whether time t falls on the way back from the turnaround (s running from 1 to 0). */
export function returningAt(tl: Timeline, t: number): boolean {
  const [p0, out, p1] = tl.segments;
  const x = ((t % tl.total) + tl.total) % tl.total;
  return x >= p0 + out + p1;
}

/** Movement progress s (0 = start, 1 = turnaround) at time t within one rep. */
export function progressAt(tl: Timeline, t: number): number {
  const [p0, out, p1, back] = tl.segments;
  let x = ((t % tl.total) + tl.total) % tl.total;
  if (x < p0) return 0;
  x -= p0;
  if (x < out) return ease(x / out);
  x -= out;
  if (x < p1) return 1;
  x -= p1;
  return 1 - ease(x / back);
}
