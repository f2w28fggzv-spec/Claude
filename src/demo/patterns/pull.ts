// Movement patterns: rows, pull-ups and pulldowns. Conventions and helpers: ./shared.ts.
import { L, add, along, armTo, lerp, lerpV, type DemoPose, type Leg, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { O, FLOOR, LEG_LEN, ARM_LEN, DOWN, FWD, BACK, chainUp, standing, handProp, type Implement } from './shared';

export function row(o: { implement: Implement; torso: number; oneArm?: boolean; chestSupported?: boolean }): Demo {
  const torso = o.torso;
  const leg: Leg = o.chestSupported ? { thigh: 196, shin: 176, foot: 90 } : o.oneArm ? { thigh: 172, shin: 186, foot: 90 } : { thigh: 165, shin: 196, foot: 90 };
  const { hip, shoulder } = chainUp(O, leg.shin, leg.thigh, torso);
  const hang = { x: shoulder.x + 0.02, y: shoulder.y + ARM_LEN * 0.96 };
  const ribs = { x: hip.x + 0.1, y: hip.y - 0.02 };
  // One-arm row: the far knee and hand rest on a bench beside the standing leg.
  const knee2 = { x: hip.x, y: hip.y + L.thigh };
  const benchTop = knee2.y + 0.035;
  const hand2 = { x: shoulder.x + 0.04, y: benchTop - 0.012 };
  const pose = (s: number): DemoPose => ({
    torso,
    head: torso * 0.55,
    leg,
    leg2: o.oneArm ? { thigh: 180, shin: 270, foot: 180 } : undefined,
    arm: armTo(shoulder, lerpV(hang, ribs, s), { x: -1, y: -1 }),
    arm2: o.oneArm ? armTo(shoulder, hand2, BACK) : undefined,
    anchor: 'ankle',
    at: O,
  });
  const props: Prop[] = handProp(o.implement);
  if (o.oneArm) props.unshift({ kind: 'bench', points: [{ x: knee2.x - 0.3, y: benchTop }, { x: hand2.x + 0.08, y: benchTop }] });
  if (o.chestSupported) {
    // Incline pad under the chest, parallel to the torso.
    const off = along(O, torso + 90, 0.075);
    props.unshift({ kind: 'bench', points: [add(along(hip, torso, -0.02), off), add(along(hip, torso, 0.3), off)] });
  }
  return { view: 'side', pose, props };
}

/** Hanging from a bar at the origin. */
export function pullUp(o: { startTop?: boolean; scapular?: boolean; chin?: boolean }): Demo {
  const bar: Vec = { x: 0, y: 0 };
  const hangShoulder = { x: -0.02, y: ARM_LEN * 0.985 };
  const topShoulder = o.scapular ? { x: -0.03, y: ARM_LEN * 0.985 - 0.06 } : { x: -0.06, y: 0.075 };
  const pose = (s0: number): DemoPose => {
    const s = o.startTop ? 1 - s0 : s0;
    const shoulder = lerpV(hangShoulder, topShoulder, s);
    const torso = o.scapular ? lerp(-4, -16, s) : lerp(-6, -18, s);
    return {
      torso,
      head: torso + (o.scapular ? 0 : 10 * s),
      leg: { thigh: 185 + torso * 0.3, shin: 205, foot: 150 },
      arm: armTo(shoulder, bar, o.chin ? FWD : { x: 0.6, y: 0.3 }),
      anchor: 'shoulder',
      at: shoulder,
    };
  };
  return { view: 'side', floor: null, pose, props: [{ kind: 'bar', at: { x: 0.005, y: -0.012 } }] };
}

export function invertedRow(): Demo {
  const ankle: Vec = { x: 0, y: FLOOR - L.ankleHeight - 0.02 };
  const bar: Vec = { x: 0.7, y: FLOOR - 0.5 };
  const bodyLen = LEG_LEN + L.torso;
  // Angle of the straight body from the heels, for a given shoulder-to-bar distance.
  // Raise the body from horizontal until the shoulder is within reach.
  const solveBody = (reach: number) => {
    for (let lift = 0; lift < 89; lift += 0.25) {
      const sh = along(ankle, 90 - lift, bodyLen);
      if (Math.hypot(sh.x - bar.x, sh.y - bar.y) <= reach) return 90 - lift;
    }
    return 1;
  };
  return {
    view: 'side',
    pose: (s) => {
      const body = solveBody(lerp(ARM_LEN * 0.97, 0.1, s)); // direction ankle → shoulder
      const shoulder = along(ankle, body, bodyLen);
      return {
        torso: body,
        head: body,
        leg: { thigh: body + 180, shin: body + 180, foot: body + 90 - 180 },
        arm: armTo(shoulder, bar, DOWN),
        anchor: 'ankle',
        at: ankle,
      };
    },
    props: [{ kind: 'bar', at: { x: bar.x + 0.005, y: bar.y - 0.012 } }],
  };
}

export function pulldown(o: { straightArm?: boolean }): Demo {
  if (o.straightArm) {
    const torso = 18;
    return {
      view: 'side',
      pose: (s) =>
        standing({
          torso,
          head: 8,
          leg: { thigh: 172, shin: 186, foot: 90 },
          arm: { upper: lerp(40, 168, s), fore: lerp(42, 170, s) },
        }),
      props: [{ kind: 'cable', from: { x: 0.85, y: -1.1 }, at: 'wrist' }],
    };
  }
  const hip: Vec = { x: 0, y: 0 };
  const torso = -14;
  const shoulder = along(hip, torso, L.torso);
  return {
    view: 'side',
    floor: 0.3,
    pose: (s) => ({
      torso,
      leg: { thigh: 95, shin: 180, foot: 90 },
      arm: armTo(shoulder, lerpV(add(shoulder, { x: 0.06, y: -ARM_LEN * 0.98 }), add(shoulder, { x: 0.1, y: -0.02 }), s), { x: 0.4, y: 1 }),
      anchor: 'hip',
      at: hip,
    }),
    props: [
      { kind: 'cable', from: { x: shoulder.x + 0.08, y: shoulder.y - 0.6 }, at: 'wrist' },
      { kind: 'bench', points: [{ x: -0.08, y: 0.06 }, { x: 0.22, y: 0.06 }], legs: true },
      { kind: 'pad', at: 'knee', offset: { x: 0.02, y: -0.05 } },
    ],
  };
}
