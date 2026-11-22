// Shared helpers for the movement patterns (see ./index.ts).
//
// Side view: the lifter faces right. Lying face-up: head to the LEFT (the
// front of the body faces up). Lying face-down: head to the right.
import { L, along, lerp, lerpAngle, lerpV, type Arm, type DemoPose, type Leg, type Vec } from '../figure';
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
  return { thigh: lerpAngle(a.thigh, b.thigh, s), shin: lerpAngle(a.shin, b.shin, s), foot: lerpAngle(a.foot, b.foot, s) };
}
export function mixArm(a: Arm, b: Arm, s: number): Arm {
  return {
    upper: lerpAngle(a.upper, b.upper, s),
    fore: lerpAngle(a.fore, b.fore, s),
    ...((a.scale ?? 1) !== 1 || (b.scale ?? 1) !== 1 ? { scale: lerp(a.scale ?? 1, b.scale ?? 1, s) } : {}),
  };
}
/** Interpolates two poses (angles, anchor position, scales). */
export function mix(a: DemoPose, b: DemoPose, s: number): DemoPose {
  return {
    torso: lerpAngle(a.torso, b.torso, s),
    head: a.head !== undefined || b.head !== undefined ? lerpAngle(a.head ?? a.torso, b.head ?? b.torso, s) : undefined,
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
export const handProp = (imp: Implement, at: 'wrist' | 'wrists' = 'wrist'): Prop[] =>
  imp === 'barbell'
    ? [{ kind: 'barbell', at }]
    : imp === 'ezbar'
      ? [{ kind: 'barbell', at, plate: 0.09 }]
      : imp === 'dumbbell'
        ? [{ kind: 'dumbbell', at }]
        : imp === 'kettlebell'
          ? [{ kind: 'kettlebell', at }]
          : [];

/** The same movement played from the other end (start ↔ turnaround). */
export function reversed(d: Demo): Demo {
  return { ...d, pose: (s) => d.pose(1 - s) };
}
