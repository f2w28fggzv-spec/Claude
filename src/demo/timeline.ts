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
  let ecc = ECCENTRIC;
  let con = CONCENTRIC;
  // Demos show controlled tempo: always slower than any tempo check needs.
  for (const c of exercise.checks) {
    if (c.type !== 'tempo') continue;
    if (c.phase === 'eccentric' && c.minSec) ecc = Math.max(ecc, c.minSec / MEASURED_SHARE + 0.2);
    if (c.phase === 'concentric' && c.minSec) con = Math.max(con, c.minSec / MEASURED_SHARE + 0.2);
  }
  const first = exercise.tracking.firstPhase === 'eccentric' ? ecc : con;
  const second = exercise.tracking.firstPhase === 'eccentric' ? con : ecc;
  const segments: Timeline['segments'] = [0.7, first, 0.35 + pauseFar, second];
  return { segments, total: segments.reduce((a, b) => a + b, 0) };
}

const ease = (u: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;

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
