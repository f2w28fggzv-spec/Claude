// Evaluates config checks on a segmented rep. One function per check TYPE;
// nothing here knows about specific exercises.
import type {
  Check,
  Exercise,
  HoldAlignmentCheck,
  JointAngle,
  RepPosition,
  RepTracking,
} from '../data/types';
import { TEMPO_UNTIMED } from '../data/describe';
import { angleDeg, fromVerticalDeg } from './geometry';
import { JUDGE_VISIBILITY, point, sidedPoint, type Reader } from './landmarks';
import { adjustmentDeg } from './personalize';
import { median, percentile } from './signal';
import type { RepSegment } from './reps';
import type { BodyProportions, CheckResult, PoseSequence } from './types';

export interface CheckContext {
  exercise: Exercise;
  seq: PoseSequence;
  reader: Reader;
  torsoPx: number;
  /** Smoothed tracked-joint y per frame (reps only). */
  tracked: number[];
  /** Smoothed tracked-joint x per frame (reps only). */
  trackedX: number[];
  proportions?: BodyProportions;
  /** False when the camera wasn't at the configured angle for this rep. */
  viewOk: boolean;
  /**
   * Front view, one-sided exercise: the side doing the work this rep. Angles
   * are read from that side instead of averaging both (which would halve
   * the movement).
   */
  workingSide?: 'left' | 'right';
}

/** Share of a rep's frames that must be readable for whole-rep checks. */
const MIN_COVERAGE = 0.6;
/** Frames on each side of a key position used to steady a reading. */
const WINDOW = 2;

const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const label = (j: string) => j[0].toUpperCase() + j.slice(1);

function rangeText(min?: number, max?: number, unit = '°'): string {
  if (min !== undefined && max !== undefined) return `${min}–${max}${unit}`;
  if (max !== undefined) return `at most ${max}${unit}`;
  return `at least ${min}${unit}`;
}

const inRange = (v: number, min?: number, max?: number) =>
  (min === undefined || v >= min) && (max === undefined || v <= max);

/** Angle in one frame: near side for side views, mean of both sides for front views. */
function angleIn(ctx: CheckContext, frameIndex: number, a: JointAngle): number {
  const f = ctx.seq.frames[frameIndex];
  if (ctx.reader.view === 'front') {
    if (ctx.workingSide) return sidedAngle(ctx, frameIndex, a, ctx.workingSide);
    const both = (['left', 'right'] as const).map((side) => sidedAngle(ctx, frameIndex, a, side));
    return both.every(Number.isFinite) ? (both[0] + both[1]) / 2 : NaN;
  }
  const p = [point(f, a.a, ctx.reader), point(f, a.vertex, ctx.reader), point(f, a.c, ctx.reader)];
  if (p.some((x) => !x || x.v < JUDGE_VISIBILITY)) return NaN;
  return angleDeg(p[0]!, p[1]!, p[2]!);
}

function sidedAngle(ctx: CheckContext, frameIndex: number, a: JointAngle, side: 'left' | 'right'): number {
  const f = ctx.seq.frames[frameIndex];
  const get = (j: JointAngle['a']) => (j === 'nose' ? point(f, j, ctx.reader) : sidedPoint(f, j, side, ctx.reader));
  const p = [get(a.a), get(a.vertex), get(a.c)];
  if (p.some((x) => !x || x.v < JUDGE_VISIBILITY)) return NaN;
  return angleDeg(p[0]!, p[1]!, p[2]!);
}

function positionFrame(rep: RepSegment, at: RepPosition) {
  return at === 'top' ? rep.topFrame : rep.bottomFrame;
}

/**
 * How far the tracked joint may move from where it was at the top, in torso
 * lengths (smoothed as the tracked signal is), for a frame after a rep's end
 * to count toward that rep's top (see around()).
 */
const STILL_AT_TOP = 0.07;

/**
 * Frame indices within `k` of the rep position `at`, kept inside the rep,
 * except at the top of a lift whose first move is down: there the top is the
 * rep's last frame (standing tall after a squat), so the window runs on past
 * it into the frames after the rep and sees both sides of the turning point,
 * as it does at every other position. Only while the tracked joint stays
 * where it was at the top, though: in the start position (or the next rep
 * just beginning), not what comes after a set (racking the bar, turning to
 * walk away), where a joint that straightens would pass for the last rep's
 * lockout. Up-first lifts judge their start at the rep's first frame and stay
 * inside the rep.
 */
function around(ctx: CheckContext, rep: RepSegment, at: RepPosition, k = WINDOW): number[] {
  const center = positionFrame(rep, at);
  const out: number[] = [];
  for (let i = Math.max(rep.startFrame, center - k); i <= Math.min(rep.endFrame, center + k); i++) out.push(i);
  const tracking = ctx.exercise.tracking;
  if (at !== 'top' || tracking.kind !== 'reps' || tracking.firstMove !== 'down') return out;
  const x0 = ctx.trackedX[center];
  const y0 = ctx.tracked[center];
  const reach = STILL_AT_TOP * ctx.torsoPx;
  for (let i = rep.endFrame + 1; i <= center + k && i < ctx.seq.frames.length; i++) {
    // Stops at the first frame that has moved away, or where the joint isn't tracked.
    if (!(Math.hypot(ctx.trackedX[i] - x0, ctx.tracked[i] - y0) <= reach)) break;
    out.push(i);
  }
  return out;
}

function repFrames(rep: RepSegment): number[] {
  const out: number[] = [];
  for (let i = rep.startFrame; i <= rep.endFrame; i++) out.push(i);
  return out;
}

function unknown(check: Check, target: string, reason: string): CheckResult {
  return { checkId: check.id, label: check.label, status: 'unknown', target, reason };
}

function verdict(check: Check, ok: boolean, value: number, measured: string, target: string): CheckResult {
  return {
    checkId: check.id,
    label: check.label,
    status: ok ? 'pass' : 'fail',
    value,
    measured,
    target,
    ...(ok ? {} : { fault: check.fault }),
  };
}

const NOT_VISIBLE = 'The joints for this check weren’t clearly visible.';

function phaseSeconds(ctx: CheckContext, from: number, to: number): number {
  // Time spent moving: from the last frame still near `from` to the first
  // frame near `to`. Pauses at either end don't count.
  const s = ctx.tracked;
  const t = ctx.seq.frames;
  const a = s[from];
  const b = s[to];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  const tol = Math.abs(b - a) * 0.05;
  let leave = from;
  for (let i = from; i <= to; i++) if (Math.abs(s[i] - a) <= tol) leave = i;
  let arrive = to;
  for (let i = to; i >= leave; i--) if (Math.abs(s[i] - b) <= tol) arrive = i;
  return (t[arrive].t - t[leave].t) / 1000;
}

export function evaluateRepCheck(check: Check, rep: RepSegment, ctx: CheckContext): CheckResult {
  const view = ctx.exercise.placement.view;
  // Tempo only needs the tracked joint, so it survives a wrong camera angle.
  if (!ctx.viewOk && check.type !== 'tempo') {
    return unknown(
      check,
      '',
      view === 'side' ? 'The camera wasn’t side-on during this rep.' : 'You weren’t facing the camera during this rep.',
    );
  }

  switch (check.type) {
    case 'jointAngle': {
      const target = rangeText(check.min, check.max);
      const values = around(ctx, rep, check.at).map((i) => angleIn(ctx, i, check.angle));
      const v = median(values);
      if (values.filter(Number.isFinite).length < 2 || !Number.isFinite(v)) return unknown(check, target, NOT_VISIBLE);
      return verdict(check, inRange(v, check.min, check.max), v, `${round(v)}°`, target);
    }

    case 'rangeOfMotion': {
      const target = `at least ${check.minDeg}°`;
      const values = repFrames(rep).map((i) => angleIn(ctx, i, check.angle));
      const ok = values.filter(Number.isFinite);
      if (ok.length < values.length * MIN_COVERAGE) return unknown(check, target, NOT_VISIBLE);
      const v = percentile(ok, 0.95) - percentile(ok, 0.05);
      return verdict(check, v >= check.minDeg, v, `${round(v)}° of movement`, target);
    }

    case 'relativeHeight': {
      const below = check.relation === 'atOrBelow';
      const word = below ? 'below' : 'above';
      const target =
        check.margin === 0
          ? `${below ? 'at or below' : 'at or above'} ${check.reference}`
          : check.margin > 0
            ? `at least ${pct(check.margin)} of torso ${word} ${check.reference}`
            : `at most ${pct(-check.margin)} of torso ${below ? 'above' : 'below'} ${check.reference}`;
      // How far `point` is past `reference` in the required direction, as a
      // fraction of torso length; the best frame near the position counts.
      const values = around(ctx, rep, check.at).map((i) => {
        const f = ctx.seq.frames[i];
        const p = point(f, check.point, ctx.reader);
        const r = point(f, check.reference, ctx.reader);
        if (!p || !r || p.v < JUDGE_VISIBILITY || r.v < JUDGE_VISIBILITY) return NaN;
        return ((below ? p.y - r.y : r.y - p.y) / ctx.torsoPx) as number;
      });
      const ok = values.filter(Number.isFinite);
      if (ok.length < 2) return unknown(check, target, NOT_VISIBLE);
      const v = Math.max(...ok);
      const measured =
        Math.abs(v) < 0.005
          ? `${label(check.point)} level with ${check.reference}`
          : `${label(check.point)} ${pct(Math.abs(v))} of torso ${v > 0 ? word : below ? 'above' : 'below'} ${check.reference}`;
      return verdict(check, v >= check.margin, v, measured, target);
    }

    case 'torsoAngle': {
      let { minDeg, maxDeg } = check;
      let adjustment: string | undefined;
      if (check.personalize) {
        const d = adjustmentDeg(check.personalize, ctx.proportions);
        if (d !== null && Math.round(d) !== 0) {
          const r = Math.round(d);
          if (minDeg !== undefined) minDeg += r;
          if (maxDeg !== undefined) maxDeg += r;
          adjustment = `${r > 0 ? 'Allows' : 'Expects'} ${Math.abs(r)}° ${r > 0 ? 'more' : 'less'} lean for your limb proportions.`;
        }
      }
      const target = `${rangeText(minDeg, maxDeg)} from vertical`;
      const values = around(ctx, rep, check.at).map((i) => {
        const f = ctx.seq.frames[i];
        const sh = point(f, 'shoulder', ctx.reader);
        const hip = point(f, 'hip', ctx.reader);
        if (!sh || !hip || sh.v < JUDGE_VISIBILITY || hip.v < JUDGE_VISIBILITY) return NaN;
        return fromVerticalDeg(hip, sh);
      });
      const v = median(values);
      if (values.filter(Number.isFinite).length < 2) return unknown(check, target, NOT_VISIBLE);
      const r = verdict(check, inRange(v, minDeg, maxDeg), v, `${round(v)}° from vertical`, target);
      return adjustment ? { ...r, adjustment } : r;
    }

    case 'path': {
      const target = `at most ${pct(check.maxDrift)} of torso length`;
      const xs = repFrames(rep).map((i) => {
        const p = point(ctx.seq.frames[i], check.point, ctx.reader);
        return p && p.v >= JUDGE_VISIBILITY ? p.x : NaN;
      });
      const ok = xs.filter(Number.isFinite);
      if (ok.length < xs.length * MIN_COVERAGE) return unknown(check, target, NOT_VISIBLE);
      const v = (percentile(ok, 0.95) - percentile(ok, 0.05)) / ctx.torsoPx;
      return verdict(check, v <= check.maxDrift, v, `Moved ${pct(v)} of torso length sideways`, target);
    }

    case 'symmetry': {
      const target = `within ${check.maxDiffDeg}°`;
      if (view !== 'front') return unknown(check, target, 'Left/right balance needs a front-on camera.');
      const diffs = around(ctx, rep, check.at).map((i) =>
        Math.abs(sidedAngle(ctx, i, check.angle, 'left') - sidedAngle(ctx, i, check.angle, 'right')),
      );
      const ok = diffs.filter(Number.isFinite);
      if (ok.length < 2) return unknown(check, target, NOT_VISIBLE);
      const v = median(ok);
      return verdict(check, v <= check.maxDiffDeg, v, `${round(v)}° difference`, target);
    }

    case 'tempo': {
      // phaseSeconds leaves out the slow ends, so the reading is shorter than the whole lowering: say so.
      const target = `${rangeText(check.minSec, check.maxSec, ' s')}, ${TEMPO_UNTIMED}`;
      const tracking = ctx.exercise.tracking as Extract<RepTracking, { kind: 'reps' }>;
      const first = phaseSeconds(ctx, rep.startFrame, rep.turnFrame);
      const second = phaseSeconds(ctx, rep.turnFrame, rep.endFrame);
      const v = (tracking.firstPhase === check.phase) ? first : second;
      if (!Number.isFinite(v)) return unknown(check, target, 'The rep wasn’t tracked clearly enough to time it.');
      return verdict(check, inRange(v, check.minSec, check.maxSec), v, `${round(v, 1)} s`, target);
    }

    case 'lockout': {
      const target = `at least ${check.minDeg}°`;
      // Lockout may peak a moment before or after the turning point: the
      // largest angle within 0.3 s of it counts (on a down-first lift, up to
      // 0.3 s past the rep's end while the tracked joint stays at the top;
      // see around()).
      const fps = framesPerSecond(ctx);
      const values = around(ctx, rep, check.at, Math.max(WINDOW, Math.round(fps * 0.3))).map((i) => angleIn(ctx, i, check.angle));
      const ok = values.filter(Number.isFinite);
      if (ok.length < 2) return unknown(check, target, NOT_VISIBLE);
      const v = Math.max(...ok);
      return verdict(check, v >= check.minDeg, v, `${round(v)}°`, target);
    }

    case 'holdAlignment':
      return unknown(check, '', 'Hold checks apply to timed holds, not reps.');
  }
}

function framesPerSecond(ctx: CheckContext): number {
  const f = ctx.seq.frames;
  if (f.length < 2) return 30;
  return ((f.length - 1) * 1000) / Math.max(1, f[f.length - 1].t - f[0].t);
}

/** Share of the hold that must be inside the target range to pass. */
export const HOLD_PASS_SHARE = 0.8;

export function evaluateHoldCheck(
  check: HoldAlignmentCheck,
  frames: number[],
  ctx: CheckContext,
): CheckResult {
  const target = `${check.min}–${check.max}° for ${pct(HOLD_PASS_SHARE)} of the hold`;
  if (!ctx.viewOk) return unknown(check, target, 'The camera wasn’t at the right angle during the hold.');
  const values = frames.map((i) => angleIn(ctx, i, check.angle)).filter(Number.isFinite);
  if (values.length < frames.length * MIN_COVERAGE || values.length === 0) return unknown(check, target, NOT_VISIBLE);
  const share = values.filter((v) => inRange(v, check.min, check.max)).length / values.length;
  return verdict(check, share >= HOLD_PASS_SHARE, share, `In range for ${pct(share)} of the hold`, target);
}

export { angleIn };
