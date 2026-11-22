// Shared helpers for the movement patterns (see ./index.ts).
//
// Side view: the lifter faces right. Lying face-up: head to the LEFT (the
// front of the body faces up). Lying face-down: head to the right.
import { PAD_HALF, skinPoints } from '../contact';
import { L, add, along, lerp, lerpAngle, lerpV, mul, sub, type Arm, type DemoPose, type Figure, type Leg, type Vec } from '../figure';
import type { Demo, Prop } from '../types';

export const O: Vec = { x: 0, y: 0 };
/** Floor y when an ankle stands at y = 0. */
export const FLOOR = L.ankleHeight;
export const LEG_LEN = L.thigh + L.shin;
export const ARM_LEN = L.upperArm + L.forearm;
export const STAND: Leg = { thigh: 180, shin: 180, foot: 90 };
export const HANG: Arm = { upper: 180, fore: 180 };
export const UP: Vec = { x: 0, y: -1 };
export const DOWN: Vec = { x: 0, y: 1 };
export const FWD: Vec = { x: 1, y: 0 };
export const BACK: Vec = { x: -1, y: 0 };

/** Knee, hip and shoulder from an ankle and segment directions. */
export function chainUp(ankle: Vec, shin: number, thigh: number, torso: number) {
  const knee = along(ankle, shin + 180, L.shin);
  const hip = along(knee, thigh + 180, L.thigh);
  const shoulder = along(hip, torso, L.torso);
  return { knee, hip, shoulder };
}

export function mixLeg(a: Leg, b: Leg, s: number): Leg {
  const leg: Leg = { thigh: lerpAngle(a.thigh, b.thigh, s), shin: lerpAngle(a.shin, b.shin, s), foot: lerpAngle(a.foot, b.foot, s) };
  // Toes that bend in either pose blend too (unset = in line with the foot).
  if (a.toes !== undefined || b.toes !== undefined) leg.toes = lerpAngle(a.toes ?? a.foot, b.toes ?? b.foot, s);
  return leg;
}
export function mixArm(a: Arm, b: Arm, s: number): Arm {
  const arm: Arm = { upper: lerpAngle(a.upper, b.upper, s), fore: lerpAngle(a.fore, b.fore, s) };
  if ((a.scale ?? 1) !== 1 || (b.scale ?? 1) !== 1) arm.scale = lerp(a.scale ?? 1, b.scale ?? 1, s);
  if (a.foreScale !== undefined || b.foreScale !== undefined) arm.foreScale = lerp(a.foreScale ?? a.scale ?? 1, b.foreScale ?? b.scale ?? 1, s);
  if (a.hand !== undefined || b.hand !== undefined) arm.hand = lerpAngle(a.hand ?? a.fore, b.hand ?? b.fore, s);
  // An open hand stays open until the blend is past halfway.
  if (s < 0.5 ? a.flat : b.flat) arm.flat = true;
  return arm;
}
/** Interpolates two poses (angles, anchor position, scales). */
export function mix(a: DemoPose, b: DemoPose, s: number): DemoPose {
  return {
    torso: lerpAngle(a.torso, b.torso, s),
    bend: a.bend !== undefined || b.bend !== undefined ? lerp(a.bend ?? 0, b.bend ?? 0, s) : undefined,
    head: a.head !== undefined || b.head !== undefined ? lerpAngle(a.head ?? a.torso + (a.bend ?? 0), b.head ?? b.torso + (b.bend ?? 0), s) : undefined,
    torsoScale: lerp(a.torsoScale ?? 1, b.torsoScale ?? 1, s),
    leg: mixLeg(a.leg, b.leg, s),
    arm: mixArm(a.arm, b.arm, s),
    leg2: a.leg2 || b.leg2 ? mixLeg(a.leg2 ?? a.leg, b.leg2 ?? b.leg, s) : undefined,
    arm2: a.arm2 || b.arm2 ? mixArm(a.arm2 ?? a.arm, b.arm2 ?? b.arm, s) : undefined,
    anchor: a.anchor,
    at: lerpV(a.at, b.at, s),
  };
}

export const standing = (o: Partial<DemoPose> = {}): DemoPose => ({ torso: 0, leg: STAND, arm: HANG, anchor: 'ankle', at: O, ...o });
export const between = (a: DemoPose, b: DemoPose): ((s: number) => DemoPose) => (s) => mix(a, b, s);

export type Implement = 'barbell' | 'ezbar' | 'dumbbell' | 'kettlebell' | 'none';
/** What the hands hold; `lengthwise` dumbbells hang at the sides with a neutral grip. */
export const handProp = (imp: Implement, at: 'wrist' | 'wrists' = 'wrist', o: { lengthwise?: boolean } = {}): Prop[] =>
  imp === 'barbell'
    ? [{ kind: 'barbell', at }]
    : imp === 'ezbar'
      ? [{ kind: 'barbell', at, plate: 0.09 }]
      : imp === 'dumbbell'
        ? [{ kind: 'dumbbell', at, ...(o.lengthwise && { lengthwise: true }) }]
        : imp === 'kettlebell'
          ? [{ kind: 'kettlebell', at }]
          : [];

/** The same movement played from the other end (start ↔ turnaround). */
export function reversed(d: Demo): Demo {
  return { ...d, pose: (s) => d.pose(1 - s) };
}

// ── Balance and resting on equipment ───────────────────────────────────────

/** Segment masses as a share of body mass (Winter 2009). */
export const MASS = { head: 0.081, trunk: 0.497, upperArm: 0.028, forearm: 0.016, hand: 0.006, thigh: 0.1, shank: 0.0465, foot: 0.0145 };

/** Centre of mass of the body plus held loads (`share` = load mass / body mass). */
export function centreOfMass(f: Figure, loads: { at: Vec; share: number }[] = []): Vec {
  const parts: [number, Vec][] = [
    [MASS.head, f.head],
    [MASS.trunk, lerpV(lerpV(f.a.hip, f.b.hip, 0.5), lerpV(f.a.shoulder, f.b.shoulder, 0.5), 0.5)],
  ];
  for (const s of [f.a, f.b]) {
    parts.push(
      [MASS.upperArm, lerpV(s.shoulder, s.elbow, 0.436)],
      [MASS.forearm, lerpV(s.elbow, s.wrist, 0.43)],
      [MASS.hand, s.hand],
      [MASS.thigh, lerpV(s.hip, s.knee, 0.433)],
      [MASS.shank, lerpV(s.knee, s.ankle, 0.433)],
      [MASS.foot, lerpV(s.heel, s.toe, 0.5)],
    );
  }
  for (const l of loads) parts.push([l.share, l.at]);
  const m = parts.reduce((a, [w]) => a + w, 0);
  return { x: parts.reduce((a, [w, p]) => a + w * p.x, 0) / m, y: parts.reduce((a, [w, p]) => a + w * p.y, 0) / m };
}

/** The v in [lo, hi] where the increasing function f reaches target (bisection). */
export function solveFor(lo: number, hi: number, f: (v: number) => number, target: number): number {
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A pad (bench-prop points) along the line from a to b, moved along its
 * normal until the body just rests on it over the whole movement: no skin
 * point inside the pad, none hovering above it. `skip` names body parts that
 * pass beside the pad rather than over it (e.g. a hand on a side handle).
 */
export function restingPad(pose: (s: number) => DemoPose, a: Vec, b: Vec, skip?: RegExp): [Vec, Vec] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  // The pad's top side, as in ../contact: the normal pointing up the screen.
  const n = u.x >= 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
  let nearest = Infinity;
  for (let k = 0; k <= 10; k++) {
    for (const sp of skinPoints({ view: 'side', pose }, k / 10)) {
      if (skip?.test(sp.part)) continue;
      const d = sub(sp.p, a);
      const t = d.x * u.x + d.y * u.y;
      const h = d.x * n.x + d.y * n.y;
      if (t >= 0 && t <= len && h > -0.04) nearest = Math.min(nearest, h);
    }
  }
  if (!Number.isFinite(nearest)) return [a, b];
  const shift = mul(n, nearest - PAD_HALF - 0.002);
  return [add(a, shift), add(b, shift)];
}
