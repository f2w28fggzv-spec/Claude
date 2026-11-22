// Movement patterns: overhead presses, pike and handstand push-ups, raises. Conventions and helpers: ./shared.ts.
import { L, add, along, armTo, lerp, lerpV, type DemoPose, type Leg, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { O, FLOOR, ARM_LEN, HANG, BACK, standing, between, handProp, type Implement } from './shared';

/** Standing overhead press; s = 0 at the shoulders, s = 1 locked out. */
export function overheadPress(o: { implement: Implement; seated?: boolean; dip?: boolean; machine?: boolean }): Demo {
  const seatHip: Vec = { x: 0, y: 0 };
  const pose = (s: number): DemoPose => {
    const base: DemoPose = o.seated
      ? { torso: -6, leg: { thigh: 90, shin: 180, foot: 90 }, arm: HANG, anchor: 'hip', at: seatHip }
      : standing(o.dip ? { leg: { thigh: 180 - 14 * Math.sin(Math.PI * Math.min(1, s * 3)), shin: 180 + 12 * Math.sin(Math.PI * Math.min(1, s * 3)), foot: 90 } } : {});
    const torso = base.torso;
    const shoulderRel = along({ x: 0, y: 0 }, torso, L.torso);
    const rack = add(shoulderRel, { x: 0.07, y: -0.01 });
    const lock = add(shoulderRel, { x: 0.015, y: -ARM_LEN * 0.992 });
    // Arm angles from relative positions (the anchor doesn't change them).
    return { ...base, arm: armTo(shoulderRel, lerpV(rack, lock, s), { x: 1, y: 0.3 }) };
  };
  const props: Prop[] = handProp(o.implement);
  if (o.seated) props.unshift({ kind: 'bench', points: [along({ x: -0.06, y: 0.06 }, -6, 0.45), { x: -0.06, y: 0.06 }, { x: 0.2, y: 0.06 }], legs: true });
  return { view: 'side', floor: o.seated ? L.shin + L.ankleHeight : undefined, pose, props };
}

/** Pike push-up: hips high; the head lowers toward the floor just in front of the hands. */
export function pikePushUp(): Demo {
  const toe: Vec = { x: -0.04, y: 0 };
  const wrist: Vec = { x: 0.62, y: FLOOR - 0.01 };
  return {
    view: 'side',
    pose: (s) => {
      const hip = lerpV({ x: 0.284, y: -0.445 }, { x: 0.36, y: -0.4 }, s);
      const torso = lerp(125, 158, s);
      const shoulder = along(hip, torso, L.torso);
      const legDir = Math.atan2(toe.x - hip.x, -(toe.y - hip.y)) * (180 / Math.PI);
      return {
        torso,
        head: torso + 20,
        leg: { thigh: legDir, shin: legDir, foot: legDir - 80 },
        arm: armTo(shoulder, wrist, BACK),
        anchor: 'hip',
        at: hip,
      };
    },
  };
}

export function handstandPushUp(): Demo {
  const wrist: Vec = { x: 0, y: FLOOR - 0.01 };
  return {
    view: 'side',
    pose: (s) => {
      const shoulder = { x: lerp(0.005, 0.07, s), y: wrist.y - lerp(ARM_LEN * 0.985, 0.14, s) };
      return {
        torso: 178,
        head: 178,
        leg: { thigh: 0, shin: 0, foot: 270 },
        arm: armTo(shoulder, wrist, { x: 1, y: 0 }),
        anchor: 'shoulder',
        at: shoulder,
      };
    },
    props: [{ kind: 'wall', x: -0.1, top: -1.1 }],
  };
}

export function lateralRaise(o: { oneArm?: boolean; cable?: boolean; bentOver?: boolean }): Demo {
  const torsoScale = o.bentOver ? 0.42 : 1;
  const leg: Leg = o.bentOver ? { thigh: 186, shin: 178, foot: 0 } : { thigh: 184, shin: 180, foot: 0 };
  const leg2: Leg = o.bentOver ? { thigh: 174, shin: 182, foot: 0 } : { thigh: 176, shin: 180, foot: 0 };
  return {
    view: 'front',
    pose: (s) => ({
      torso: 0,
      torsoScale,
      leg,
      leg2,
      // The lifter's right arm is on the image left (270 = out to the side).
      arm: { upper: lerp(188, 268, s), fore: lerp(185, 262, s) },
      arm2: o.oneArm ? { upper: 172, fore: 175 } : { upper: lerp(172, 92, s), fore: lerp(175, 98, s) },
      anchor: 'ankle',
      at: O,
    }),
    props: o.cable
      ? [{ kind: 'cable', from: { x: 0.25, y: -0.02 }, at: 'wrist' }]
      : [{ kind: 'dumbbell', at: o.oneArm ? 'wrist' : 'wrists' }],
  };
}

export function frontRaise(): Demo {
  return {
    view: 'side',
    pose: between(standing({ arm: { upper: 172, fore: 172 } }), standing({ arm: { upper: 92, fore: 95 } })),
    props: [{ kind: 'dumbbell', at: 'wrist' }],
  };
}
