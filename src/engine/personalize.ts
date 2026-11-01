// Limb proportions measured during the setup check, and the threshold
// adjustments they justify. Only rules with a clear mechanical basis live
// here; exercise configs opt in by name (TorsoAngleCheck.personalize).
import type { PersonalizationRule } from '../data/types';
import { angleDeg, dist, fromVerticalDeg } from './geometry';
import { JUDGE_VISIBILITY, point, type Reader } from './landmarks';
import { median } from './signal';
import type { BodyProportions, PoseFrame } from './types';

/**
 * Average segment lengths as multiples of torso length (shoulder joint to hip
 * joint). From the segment-length table in Winter, "Biomechanics and Motor
 * Control of Human Movement" (4th ed., 2009), as fractions of height:
 * thigh 0.245, shank 0.246, upper arm 0.186, forearm 0.146, and
 * shoulder (0.818) minus greater trochanter (0.530) = 0.288 for the torso.
 */
export const REFERENCE_PROPORTIONS = {
  thigh: 0.245 / 0.288,
  shin: 0.246 / 0.288,
  upperArm: 0.186 / 0.288,
  forearm: 0.146 / 0.288,
};

/**
 * Torso lean (degrees from vertical) needed to keep the shoulders over the
 * mid-foot at parallel depth, from a 2D model: ankle at the mid-foot, shin
 * tilted forward by `shinDeg`, thigh horizontal, shoulders back over the
 * ankle. Longer thighs relative to the torso need more lean. Fry, Smith &
 * Schilling (2003), J Strength Cond Res 17(4):629-633, show the same trade-off
 * between knee travel and trunk lean experimentally.
 */
export function squatLeanDeg(thigh: number, shin: number, shinDeg = 30): number {
  const s = thigh - shin * Math.sin((shinDeg * Math.PI) / 180);
  return (Math.asin(Math.min(1, Math.max(-1, s))) * 180) / Math.PI;
}

/** Largest adjustment allowed in either direction, in degrees. */
export const MAX_ADJUSTMENT_DEG = 12;

/** Degrees to add to the check's limits, or null if the rule can't apply. */
export function adjustmentDeg(rule: PersonalizationRule, p: BodyProportions | undefined): number | null {
  switch (rule) {
    case 'squatTorsoLean': {
      if (!p?.thigh || !p?.shin) return null;
      const ref = squatLeanDeg(REFERENCE_PROPORTIONS.thigh, REFERENCE_PROPORTIONS.shin);
      const delta = squatLeanDeg(p.thigh, p.shin) - ref;
      return Math.max(-MAX_ADJUSTMENT_DEG, Math.min(MAX_ADJUSTMENT_DEG, delta));
    }
  }
}

/** Frames needed before a segment length is trusted. */
export const MIN_MEASURE_FRAMES = 12;

/**
 * Collects segment lengths while the user stands tall, side-on, during the
 * setup check. Each segment is only measured when it's straight and upright
 * enough for its 2D length to match its real length.
 */
export class ProportionMeter {
  private samples: Record<'thigh' | 'shin' | 'upperArm' | 'forearm', number[]> = {
    thigh: [],
    shin: [],
    upperArm: [],
    forearm: [],
  };

  push(frame: PoseFrame, reader: Reader): void {
    if (reader.view !== 'side') return;
    const get = (j: Parameters<typeof point>[1]) => {
      const p = point(frame, j, reader);
      return p && p.v >= JUDGE_VISIBILITY ? p : null;
    };
    const sh = get('shoulder');
    const hip = get('hip');
    if (!sh || !hip || fromVerticalDeg(hip, sh) > 12) return;
    const torso = dist(sh, hip);
    if (torso <= 0) return;
    const knee = get('knee');
    const ankle = get('ankle');
    if (knee && ankle && angleDeg(hip, knee, ankle) > 168 && fromVerticalDeg(ankle, hip) < 12) {
      this.samples.thigh.push(dist(hip, knee) / torso);
      this.samples.shin.push(dist(knee, ankle) / torso);
    }
    const elbow = get('elbow');
    const wrist = get('wrist');
    if (elbow && wrist && angleDeg(sh, elbow, wrist) > 165 && fromVerticalDeg(wrist, sh) < 20) {
      this.samples.upperArm.push(dist(sh, elbow) / torso);
      this.samples.forearm.push(dist(elbow, wrist) / torso);
    }
  }

  /** True once the leg lengths (which the squat rule needs) are measured. */
  get legsReady(): boolean {
    return this.samples.thigh.length >= MIN_MEASURE_FRAMES;
  }

  result(now = new Date()): BodyProportions | null {
    const out: BodyProportions = { measuredAt: now.toISOString() };
    let any = false;
    for (const key of ['thigh', 'shin', 'upperArm', 'forearm'] as const) {
      if (this.samples[key].length >= MIN_MEASURE_FRAMES) {
        out[key] = Math.round(median(this.samples[key]) * 1000) / 1000;
        any = true;
      }
    }
    return any ? out : null;
  }
}

/** Keeps earlier measurements for segments this session couldn't measure. */
export function mergeProportions(old: BodyProportions | null, next: BodyProportions): BodyProportions {
  return { ...(old ?? {}), ...next };
}
