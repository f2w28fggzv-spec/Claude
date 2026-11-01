// Rep segmentation from the vertical movement of the joint named in the
// exercise config (tracking.joint). No exercise-specific logic.
import { DEFAULT_MIN_AMPLITUDE, type RepTracking } from '../data/types';
import { MIN_VISIBILITY, point, type Reader } from './landmarks';
import { fillGaps, percentile, smooth } from './signal';
import type { PoseSequence } from './types';
import { Zigzag, type Extreme, type ExtremeType } from './zigzag';

type Reps = Extract<RepTracking, { kind: 'reps' }>;

/** Gaps in tracking shorter than this are bridged by interpolation. */
export const MAX_GAP_MS = 400;
/** Smoothing window for the tracked joint. */
export const SMOOTH_MS = 150;
/**
 * Turning points must stand out by this share of the movement range. Small
 * bounces are rejected separately by the exercise's minAmplitude, so this
 * only needs to beat noise; partial reps (about 30%+ of a full rep) still
 * count and then fail their range-of-motion checks.
 */
const RANGE_FRACTION = 0.25;

export interface RepSegment {
  startFrame: number;
  turnFrame: number;
  endFrame: number;
  /** Frame where the tracked joint is highest / lowest in this rep. */
  topFrame: number;
  bottomFrame: number;
}

export const minAmplitudePx = (tracking: Reps, torsoPx: number) =>
  (tracking.minAmplitude ?? DEFAULT_MIN_AMPLITUDE) * torsoPx;

/** Smoothed screen-y of the tracked joint; NaN where it isn't visible. */
export function trackedSignal(seq: PoseSequence, tracking: Reps, reader: Reader): number[] {
  const times = seq.frames.map((f) => f.t);
  const y = seq.frames.map((f) => {
    const p = point(f, tracking.joint, reader);
    return p && p.v >= MIN_VISIBILITY ? p.y : NaN;
  });
  return smooth(fillGaps(y, times, MAX_GAP_MS), times, SMOOTH_MS);
}

/** Builds reps (home → far → home) from alternating turning points. */
export function repsFromExtremes(extremes: Extreme[], tracking: Reps, minAmp: number): RepSegment[] {
  const home: ExtremeType = tracking.firstMove === 'down' ? 'top' : 'bottom';
  const reps: RepSegment[] = [];
  let i = 0;
  while (i + 2 < extremes.length) {
    const [a, b, c] = [extremes[i], extremes[i + 1], extremes[i + 2]];
    if (a.type !== home) {
      i++; // recording started mid-rep
      continue;
    }
    if (Math.abs(b.value - a.value) >= minAmp && Math.abs(b.value - c.value) >= minAmp / 2) {
      reps.push({
        startFrame: a.index,
        turnFrame: b.index,
        endFrame: c.index,
        // The start position is judged where the rep finishes for down-first
        // lifts (standing tall after a squat) and where it begins for
        // up-first lifts (the deadlift set-up).
        topFrame: home === 'top' ? c.index : b.index,
        bottomFrame: home === 'top' ? b.index : a.index,
      });
    }
    i += 2;
  }
  return reps;
}

/** How long the joint must have been still for an edge frame to count as a turning point. */
const EDGE_STILL_MS = 300;

/**
 * Drops turning points at the very start or end of the recording when the
 * joint was still moving there: the recording began or ended mid-rep, so
 * that frame isn't a real top or bottom.
 */
function dropMovingEdges(extremes: Extreme[], s: number[], times: number[]): Extreme[] {
  const valid = s.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
  if (extremes.length < 2 || valid.length === 0) return extremes;
  const moving = (e: Extreme, other: Extreme, dir: 1 | -1) => {
    const limit = Math.abs(other.value - e.value) * 0.1;
    for (let k = e.index + dir; k >= 0 && k < s.length && Math.abs(times[k] - times[e.index]) <= EDGE_STILL_MS; k += dir) {
      if (Math.abs(s[k] - e.value) > limit) return true;
    }
    return false;
  };
  let out = extremes;
  if (out[0].index === valid[0] && moving(out[0], out[1], 1)) out = out.slice(1);
  const n = out.length;
  if (n >= 2 && out[n - 1].index === valid[valid.length - 1] && moving(out[n - 1], out[n - 2], -1)) out = out.slice(0, -1);
  return out;
}

export function segmentReps(seq: PoseSequence, tracking: Reps, reader: Reader, torsoPx: number): RepSegment[] {
  const s = trackedSignal(seq, tracking, reader);
  const times = seq.frames.map((f) => f.t);
  const minAmp = minAmplitudePx(tracking, torsoPx);
  const range = percentile(s, 0.98) - percentile(s, 0.02);
  if (!(range >= minAmp)) return [];
  const zz = new Zigzag(Math.max(minAmp / 2, RANGE_FRACTION * range));
  s.forEach((v, i) => zz.push(i, v));
  return repsFromExtremes(dropMovingEdges(zz.finish(), s, times), tracking, minAmp);
}

/**
 * Live rep counter for the recording screen (the final count comes from
 * segmentReps on the whole recording). Also reports when a frame is the most
 * extreme point so far, so the screen can keep a picture of it.
 */
export class OnlineRepCounter {
  count = 0;
  private zz: Zigzag;
  private smoothed = NaN;
  private minAmp: number;
  private biggest = 0;
  private home: ExtremeType;
  private lastHome: Extreme | null = null;
  private lastFar: Extreme | null = null;

  constructor(tracking: Reps, torsoPx: number) {
    this.minAmp = minAmplitudePx(tracking, torsoPx);
    this.zz = new Zigzag(this.minAmp * 0.6);
    this.home = tracking.firstMove === 'down' ? 'top' : 'bottom';
  }

  /** Returns the confirmed turning point (if any) and whether `i` is the new candidate. */
  push(i: number, y: number): { confirmed: Extreme | null; candidate: Extreme | null } {
    if (!Number.isFinite(y)) return { confirmed: null, candidate: null };
    this.smoothed = Number.isFinite(this.smoothed) ? this.smoothed * 0.5 + y * 0.5 : y;
    const confirmed = this.zz.push(i, this.smoothed);
    if (confirmed) {
      if (confirmed.type === this.home) {
        this.lastHome = confirmed;
      } else if (this.lastHome && Math.abs(confirmed.value - this.lastHome.value) >= this.minAmp) {
        this.count++;
        this.lastFar = confirmed;
        this.biggest = Math.max(this.biggest, Math.abs(confirmed.value - this.lastHome.value));
        this.zz.h = Math.max(this.minAmp * 0.6, this.biggest * 0.35);
      }
    }
    const c = this.zz.candidate();
    return { confirmed, candidate: c && c.index === i ? c : null };
  }

  /** True when the tracked joint is back near the start position after a rep. */
  nearHome(y: number): boolean {
    if (!this.lastHome || !this.lastFar) return false;
    return Math.abs(y - this.lastHome.value) < Math.abs(this.lastFar.value - this.lastHome.value) * 0.25;
  }
}
