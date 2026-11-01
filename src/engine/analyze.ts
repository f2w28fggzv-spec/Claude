// Entry point: runs an exercise's config on a recorded pose sequence.
import type { Check, Exercise, HoldAlignmentCheck, Joint } from '../data/types';
import { dist } from './geometry';
import { JUDGE_VISIBILITY, MIN_VISIBILITY, nearSide, point, sidedPoint, type Reader } from './landmarks';
import { evaluateHoldCheck, evaluateRepCheck, angleIn, type CheckContext } from './checks';
import { segmentReps, trackedSignal, type RepSegment } from './reps';
import { median } from './signal';
import type { AnalysisResult, BodyProportions, PoseSequence, ThresholdOverrides } from './types';

export interface AnalyzeOptions {
  proportions?: BodyProportions;
  overrides?: ThresholdOverrides;
}

/**
 * Left/right shoulder and hip separation as a share of torso length:
 * near 0 when side-on, around 0.5–0.7 when facing the camera.
 */
export function bodyWidthRatio(seq: PoseSequence, frameIndex: number, torsoPx: number): number {
  const f = seq.frames[frameIndex];
  const r: Reader = { width: seq.width, height: seq.height, view: 'side', side: 'left' };
  const pairs = (['shoulder', 'hip'] as const).map((j) => {
    const a = sidedPoint(f, j, 'left', r);
    const b = sidedPoint(f, j, 'right', r);
    return a && b && a.v >= MIN_VISIBILITY && b.v >= MIN_VISIBILITY ? dist(a, b) / torsoPx : NaN;
  });
  const ok = pairs.filter(Number.isFinite);
  return ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length : NaN;
}

/** Ratio limits for accepting the camera angle in a recording. */
export const SIDE_MAX_RATIO = 0.35;
export const FRONT_MIN_RATIO = 0.3;

export function viewMatches(view: Exercise['placement']['view'], ratio: number): boolean {
  if (!Number.isFinite(ratio)) return false;
  return view === 'side' ? ratio < SIDE_MAX_RATIO : ratio > FRONT_MIN_RATIO;
}

/** Applies user-tuned threshold values on top of the config. */
export function withOverrides(exercise: Exercise, overrides?: ThresholdOverrides): Check[] {
  const mine = overrides?.[exercise.id];
  if (!mine) return exercise.checks;
  return exercise.checks.map((c) => (mine[c.id] ? ({ ...c, ...mine[c.id] } as Check) : c));
}

/** Median torso length in pixels over frames where it's clearly visible. */
export function torsoLength(seq: PoseSequence, reader: Reader): number {
  const lengths = seq.frames.map((f) => {
    const sh = point(f, 'shoulder', reader);
    const hip = point(f, 'hip', reader);
    return sh && hip && sh.v >= JUDGE_VISIBILITY && hip.v >= JUDGE_VISIBILITY ? dist(sh, hip) : NaN;
  });
  return median(lengths);
}

/** The side whose tracked joint travels further during the rep. */
function workingSide(seq: PoseSequence, joint: Joint, frames: number[], reader: Reader): 'left' | 'right' {
  const travel = (side: 'left' | 'right') => {
    const ys = frames
      .map((i) => sidedPoint(seq.frames[i], joint, side, reader))
      .filter((p) => p && p.v >= MIN_VISIBILITY)
      .map((p) => p!.y);
    return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  };
  return travel('left') >= travel('right') ? 'left' : 'right';
}

/** Longest stretch in position for a hold, allowing short tracking gaps. */
function findHold(ctx: CheckContext, check: HoldAlignmentCheck | undefined): number[] | null {
  const frames = ctx.seq.frames;
  const slack = 25; // degrees outside the target range that still count as "in position"
  const inPosition = (i: number) => {
    if (!frames[i].lm) return false;
    if (!check) return true;
    const a = angleIn(ctx, i, check.angle);
    return Number.isFinite(a) && a >= check.min - slack && a <= check.max + slack;
  };
  let best: [number, number] | null = null;
  let start = -1;
  let lastIn = -1;
  for (let i = 0; i <= frames.length; i++) {
    const ok = i < frames.length && inPosition(i);
    const gapTooLong = lastIn >= 0 && (i === frames.length || frames[i].t - frames[lastIn].t > 500);
    if (start >= 0 && !ok && gapTooLong) {
      if (!best || frames[lastIn].t - frames[start].t > frames[best[1]].t - frames[best[0]].t) best = [start, lastIn];
      start = -1;
    }
    if (ok) {
      if (start < 0) start = i;
      lastIn = i;
    }
  }
  if (!best || frames[best[1]].t - frames[best[0]].t < 1000) return null;
  const out: number[] = [];
  for (let i = best[0]; i <= best[1]; i++) out.push(i);
  return out;
}

export function analyze(exercise: Exercise, seq: PoseSequence, opts: AnalyzeOptions = {}): AnalysisResult {
  const view = exercise.placement.view;
  const side = nearSide(seq, exercise.requiredLandmarks);
  const reader: Reader = { width: seq.width, height: seq.height, view, side };
  const checks = withOverrides(exercise, opts.overrides);
  const warnings: string[] = [];
  const base = {
    exerciseId: exercise.id,
    kind: exercise.tracking.kind,
    side: view === 'side' ? side : ('both' as const),
    reps: [],
    warnings,
  };

  const seen = seq.frames.filter((f) => f.lm).length;
  if (seen === 0) {
    warnings.push('No person was detected in the recording.');
    return { ...base, torsoPx: NaN };
  }
  const torsoPx = torsoLength(seq, reader);
  if (!Number.isFinite(torsoPx) || torsoPx <= 0) {
    warnings.push('Your shoulders and hips weren’t clearly visible, so nothing could be measured.');
    return { ...base, torsoPx: NaN };
  }
  if (seen < seq.frames.length * 0.7) warnings.push('You were out of view for part of the recording.');

  const ctx = (tracked: number[], frames: number[]): CheckContext => {
    const ratios = frames.map((i) => bodyWidthRatio(seq, i, torsoPx));
    return {
      exercise: { ...exercise, checks },
      seq,
      reader,
      torsoPx,
      tracked,
      proportions: opts.proportions,
      viewOk: viewMatches(view, median(ratios)),
    };
  };

  if (exercise.tracking.kind === 'hold') {
    const holdCheck = checks.find((c): c is HoldAlignmentCheck => c.type === 'holdAlignment');
    const probe = ctx([], seq.frames.map((_, i) => i));
    const frames = findHold(probe, holdCheck);
    if (!frames) {
      warnings.push('Couldn’t find a steady hold of at least one second.');
      return { ...base, torsoPx };
    }
    const c = ctx([], frames);
    if (!c.viewOk) warnings.push(view === 'side' ? 'The camera wasn’t side-on.' : 'You weren’t facing the camera.');
    const start = frames[0];
    const end = frames[frames.length - 1];
    return {
      ...base,
      torsoPx,
      hold: {
        startFrame: start,
        endFrame: end,
        durationSec: (seq.frames[end].t - seq.frames[start].t) / 1000,
        checks: checks
          .filter((k): k is HoldAlignmentCheck => k.type === 'holdAlignment')
          .map((k) => evaluateHoldCheck(k, frames, c)),
      },
    };
  }

  const tracked = trackedSignal(seq, exercise.tracking, reader);
  const segments = segmentReps(seq, exercise.tracking, reader, torsoPx);
  if (segments.length === 0) {
    warnings.push(
      `No reps detected. Make sure your ${exercise.tracking.joint} stays in view and moves through full reps.`,
    );
  }
  const reps = segments.map((rep: RepSegment, index) => {
    const frames: number[] = [];
    for (let i = rep.startFrame; i <= rep.endFrame; i++) frames.push(i);
    const c = ctx(tracked, frames);
    if (view === 'front' && exercise.unilateral && exercise.tracking.kind === 'reps') {
      c.workingSide = workingSide(seq, exercise.tracking.joint, frames, reader);
    }
    return {
      ...rep,
      index,
      durationSec: (seq.frames[rep.endFrame].t - seq.frames[rep.startFrame].t) / 1000,
      checks: checks.map((k) => evaluateRepCheck(k, rep, c)),
    };
  });
  return { ...base, torsoPx, reps };
}
