// Movement patterns: hinges, deadlifts, hamstring curls and back extensions. Conventions and helpers: ./shared.ts.
import { add, solve, along, armTo, lerp, lerpV, type Arm, type DemoPose, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { O, FLOOR, ARM_LEN, BACK, chainUp, handProp, type Implement, mixArm } from './shared';

/** Hip hinge from standing (s = 0) to the bottom (s = 1). */
export function hinge(o: {
  implement: Implement | 'backBar' | 'cable';
  torso: number;
  /** Thigh tilt back from vertical at the bottom (hips back). */
  hipsBack: number;
  /** Knee forward travel at the bottom, degrees of shin tilt. */
  knee: number;
  /** Bar height at the bottom: fraction from knee (0) to ankle (1). */
  reach?: number;
  singleLeg?: boolean;
}): Demo {
  const at = (s: number) => {
    const torso = o.torso * s;
    const shin = 180 + o.knee * s;
    const thigh = 180 - o.hipsBack * s;
    const { knee, shoulder } = chainUp(O, shin, thigh, torso);
    return { torso, shin, thigh, knee, shoulder };
  };
  const pose = (s: number): DemoPose => {
    const { torso, shin, thigh, knee, shoulder } = at(s);
    let arm: Arm;
    if (o.implement === 'backBar') arm = { upper: torso + 200, fore: torso + 345 };
    else if (o.implement === 'cable') {
      const top = { x: shoulder.x + 0.03, y: shoulder.y + ARM_LEN * 0.97 };
      arm = armTo(shoulder, lerpV(top, { x: knee.x - 0.05, y: knee.y + 0.03 }, s), BACK);
    } else {
      // The weight slides down the front of the legs; arms hang as long as they can.
      const x = lerp(0.03, knee.x + 0.03, s);
      const reach = ARM_LEN * 0.97;
      const y = shoulder.y + Math.sqrt(Math.max(0, reach ** 2 - (x - shoulder.x) ** 2));
      arm = armTo(shoulder, { x, y: Math.min(y, lerp(knee.y, FLOOR, o.reach ?? 0.3)) }, BACK);
    }
    return {
      torso,
      head: torso * 0.6,
      leg: { thigh, shin, foot: 90 },
      leg2: o.singleLeg ? { thigh: lerp(178, torso + 180, s), shin: lerp(178, torso + 180, s), foot: lerp(90, torso + 90, s) } : undefined,
      arm,
      anchor: 'ankle',
      at: O,
    };
  };
  const props: Prop[] =
    o.implement === 'backBar'
      ? [{ kind: 'barbell', at: 'backRack' }]
      : o.implement === 'cable'
        ? [{ kind: 'cable', from: { x: -0.75, y: -0.02 }, at: 'wrist' }]
        : handProp(o.implement);
  return { view: 'side', pose, props };
}

/** Conventional / sumo deadlift: s = 0 at the floor, s = 1 at lockout. */
export function deadlift(o: { thigh: number; shin: number; torso: number }): Demo {
  const plate = 0.125;
  const bottomBar: Vec = { x: 0.04, y: FLOOR - plate };
  const pose = (s: number): DemoPose => {
    const torso = lerp(o.torso, 0, s);
    const thigh = lerp(o.thigh, 180, s);
    const shin = lerp(o.shin, 180, s);
    const { shoulder } = chainUp(O, shin, thigh, torso);
    const lockBar = { x: 0.03, y: shoulder.y + ARM_LEN * 0.97 };
    const bar = s < 1 ? { x: lerp(bottomBar.x, lockBar.x, s), y: lerp(bottomBar.y, lockBar.y, s) } : lockBar;
    return { torso, head: torso * 0.4, leg: { thigh, shin, foot: 90 }, arm: armTo(shoulder, bar, BACK), anchor: 'ankle', at: O };
  };
  return { view: 'side', pose, props: [{ kind: 'barbell', at: 'wrist', plate }] };
}

export function swing(): Demo {
  const hingeAt = (s: number) => chainUp(O, 180 + 10 * s, 180 - 22 * s, 68 * s);
  return {
    view: 'side',
    pose: (s) => {
      // s = 0: bell swung back between the legs; s = 1: standing, bell at chest height.
      const k = 1 - s;
      const { knee, shoulder } = hingeAt(k);
      const back = armTo(shoulder, { x: knee.x - 0.08, y: knee.y + 0.02 }, BACK);
      const front: Arm = { upper: 92, fore: 92 };
      return {
        torso: 68 * k,
        head: 40 * k,
        leg: { thigh: 180 - 22 * k, shin: 180 + 10 * k, foot: 90 },
        arm: mixArm(back, front, s),
        anchor: 'ankle',
        at: O,
      };
    },
    props: [{ kind: 'kettlebell', at: 'wrist' }],
  };
}

export function nordic(): Demo {
  const knee: Vec = { x: 0, y: FLOOR - 0.05 };
  return {
    view: 'side',
    floor: FLOOR,
    pose: (s) => {
      const thigh = lerp(180, 232, s);
      const torso = thigh - 180;
      return {
        torso,
        head: torso,
        leg: { thigh, shin: 270, foot: 180 },
        arm: { upper: torso + 150, fore: torso + 120 },
        anchor: 'knee',
        at: knee,
      };
    },
    props: [{ kind: 'pad', at: 'ankle', offset: { x: 0, y: -0.04 } }],
  };
}

/** Face down on a bench, head right; heels curl up toward the glutes. */
export function lyingLegCurl(): Demo {
  return {
    view: 'side',
    floor: 0.5,
    pose: (s) => {
      const shin = lerp(272, 375, s);
      return { torso: 92, head: 80, leg: { thigh: 270, shin, foot: shin - 90 }, arm: { upper: 172, fore: 92 }, anchor: 'hip', at: O };
    },
    props: [
      { kind: 'bench', points: [{ x: -0.32, y: 0.06 }, { x: 0.42, y: 0.06 }], legs: true },
      { kind: 'pad', at: 'ankle', offset: { x: 0.0, y: -0.045 } },
    ],
  };
}

/** Seated, legs straight out in front; heels curl down and back. */
export function seatedLegCurl(): Demo {
  const torso = -10;
  return {
    view: 'side',
    floor: 0.4,
    pose: (s) => {
      const shin = lerp(92, 200, s);
      return { torso, leg: { thigh: 90, shin, foot: shin - 90 }, arm: { upper: 172, fore: 172 }, anchor: 'hip', at: O };
    },
    props: [
      { kind: 'bench', points: [along({ x: -0.05, y: 0.06 }, torso, 0.42), { x: -0.05, y: 0.06 }, { x: 0.24, y: 0.06 }], legs: true },
      { kind: 'pad', at: 'ankle', offset: { x: 0.0, y: -0.045 } },
    ],
  };
}

export function backExtension(): Demo {
  const ankle: Vec = { x: 0, y: -0.22 };
  const pose = (s: number): DemoPose => {
    const torso = lerp(48, 158, s);
    return {
      torso,
      head: torso,
      leg: { thigh: 228, shin: 228, foot: 138 },
      arm: { upper: torso + 160, fore: torso + 30 },
      anchor: 'ankle',
      at: ankle,
    };
  };
  // Pad under the thighs, parallel to the legs, on a post.
  const f = solve('side', pose(0));
  const under = along(O, 228 - 90, 0.05);
  const padA = add(f.a.knee, under);
  const padB = add(along(f.a.hip, 48, 0.02), under);
  return {
    view: 'side',
    pose,
    props: [
      { kind: 'pad', at: 'ankle', offset: { x: -0.035, y: 0.035 } },
      { kind: 'line', from: padA, to: padB, width: 0.05 },
      { kind: 'line', from: lerpV(padA, padB, 0.5), to: { x: lerpV(padA, padB, 0.5).x, y: FLOOR } },
    ],
  };
}
