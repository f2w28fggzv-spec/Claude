// Movement patterns: overhead presses, pike and handstand push-ups, raises. Conventions and helpers: ./shared.ts.
import { add, along, armTo, dir, GRIP, gripTo, L, legTo, lerp, lerpV, mul, PALM, palmTo, type Leg, type Vec } from '../figure';
import { BODY } from '../body';
import type { Demo, Prop } from '../types';
import { O, FLOOR, LEG_LEN, ARM_LEN, BACK, between, handProp, standing, type Implement } from './shared';

/** 0 → 1 smoothly as s goes from a to b. */
const ramp = (s: number, a: number, b: number) => {
  const u = Math.min(1, Math.max(0, (s - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
/** 0 → 1 → 0 as s goes from a to b (half a sine). */
const bump = (s: number, a: number, b: number) => (s <= a || s >= b ? 0 : Math.sin((Math.PI * (s - a)) / (b - a)));

/**
 * A smooth curve through keyframes [s, value] (cubic Hermite with
 * Catmull-Rom tangents, flat at both ends), for body angles that move in
 * stages through a rep.
 */
function curve(keys: readonly (readonly [number, number])[]): (s: number) => number {
  const n = keys.length;
  const slope = keys.map((_, i) => (i === 0 || i === n - 1 ? 0 : (keys[i + 1][1] - keys[i - 1][1]) / (keys[i + 1][0] - keys[i - 1][0])));
  return (s) => {
    if (s <= keys[0][0]) return keys[0][1];
    if (s >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (s > keys[i + 1][0]) i++;
    const [s0, v0] = keys[i];
    const [s1, v1] = keys[i + 1];
    const h = s1 - s0;
    const t = (s - s0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * slope[i] + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * slope[i + 1];
  };
}

/** The point `fwd` in front of and `up` above p, for a trunk leaning `torso` degrees. */
const local = (p: Vec, torso: number, fwd: number, up: number): Vec => add(along(p, torso + 90, fwd), mul(dir(torso), up));

/** Shoulder to bar (or handle) with the elbow locked out: 174° at the elbow. */
const LOCKED = Math.sqrt(L.upperArm ** 2 + (L.forearm + GRIP) ** 2 + 2 * L.upperArm * (L.forearm + GRIP) * Math.cos((6 * Math.PI) / 180));

/**
 * Standing figure (side view, ankle at the origin, feet flat): hips `hipX`
 * ahead of the ankle and `dip` below standing height, knees forward.
 */
function stance(hipX: number, dip = 0): { hip: Vec; leg: Leg } {
  const hip = { x: hipX, y: -Math.sqrt(LEG_LEN ** 2 - hipX ** 2) + dip };
  return { hip, leg: legTo(hip, O, { x: 1, y: 0 }) };
}

export function overheadPress(o: { implement: Implement; seated?: boolean; dip?: boolean; machine?: boolean; arnold?: boolean }): Demo {
  if (o.seated) return machinePress();
  if (o.implement === 'barbell' || o.implement === 'ezbar') return barbellPress(!!o.dip);
  return dumbbellPress(o.implement, !!o.arnold);
}

/**
 * Standing barbell press, side view: s = 0 with the bar resting on the front
 * delts (forearms near vertical, elbows a little in front of the bar), s = 1
 * locked out with the bar over the shoulders and mid-foot. The bar travels
 * straight up: the lifter leans back slightly and pulls the head back while it
 * passes the face, then moves the head and chest through under it.
 * With `dip` (push press): a short knee dip with the bar still on the
 * shoulders, then the legs drive it off and the arms finish the press.
 */
function barbellPress(dip: boolean): Demo {
  // When the bar leaves the shoulders, and how far the knees dip before that.
  const leave = dip ? 0.16 : 0;
  const dipDepth = (s: number) => (dip ? 0.045 * bump(s, 0, 2 * leave) : 0);
  // Press progress: 0 on the shoulders, 1 locked out.
  const press = (s: number) => (s <= leave ? 0 : (s - leave) / (1 - leave));
  const hipX = curve([[0, 0.004], [0.3, 0.01], [0.7, 0.026], [1, 0.03]]);
  const lean = curve(dip ? [[0, 0], [0.3, -4], [0.7, -1], [1, 1]] : [[0, -3], [0.3, -6], [0.7, -1], [1, 1]]);
  const neck = curve([[0, 0], [0.12, -4], [0.32, -9], [0.55, -3], [0.75, 5], [1, 5]]);
  const body = (s: number) => {
    const { hip, leg } = stance(hipX(s), dipDepth(s));
    const torso = lean(s);
    return { hip, leg, torso, shoulder: along(hip, torso, L.torso) };
  };
  // Bar on the front delts, just in front of the throat.
  const rack = (s: number) => {
    const b = body(s);
    return local(b.shoulder, b.torso, 0.062, 0.016);
  };
  const start = rack(leave);
  const end = add(body(1).shoulder, { x: 0.004, y: -LOCKED });
  const bar = (s: number): Vec => {
    if (s <= leave) return rack(s);
    const p = press(s);
    // Straight up; it settles over the shoulders once past the head.
    return { x: lerp(start.x, end.x, ramp(p, 0.45, 1)), y: lerp(start.y, end.y, p) };
  };
  return {
    view: 'side',
    pose: (s) => {
      const b = body(s);
      // The elbows swing out toward the camera mid-press, so the arm looks a little shorter.
      const scale = 1 - 0.1 * bump(press(s), 0.05, 0.9);
      return {
        torso: b.torso,
        head: b.torso + neck(s),
        leg: b.leg,
        arm: gripTo(b.shoulder, bar(s), { x: 1, y: 0.4 }, scale),
        anchor: 'ankle',
        at: O,
      };
    },
    props: handProp('barbell'),
  };
}

/**
 * Standing dumbbell press, side view: s = 0 with the dumbbells at the sides of
 * the head, just above the shoulders (elbows out and a little forward, under
 * the hands), s = 1 locked out over the shoulders. The head stays still: the
 * dumbbells pass beside it.
 * `arnold`: starts lower and in front, palms facing the lifter and elbows
 * together in front of the chest; the elbows open out to the sides on the way up.
 */
function dumbbellPress(implement: Implement, arnold: boolean): Demo {
  const { hip, leg } = stance(0.004);
  const torso = 0;
  const shoulder = along(hip, torso, L.torso);
  const bottom = arnold ? local(shoulder, torso, 0.1, 0.05) : local(shoulder, torso, 0.075, 0.06);
  const top = local(shoulder, torso, 0.008, LOCKED);
  // Apparent arm length: elbows out to the sides look shorter from the side.
  const scale = arnold ? curve([[0, 1], [0.45, 0.78], [1, 1]]) : curve([[0, 0.82], [1, 1]]);
  return {
    view: 'side',
    pose: (s) => {
      const hand = { x: lerp(bottom.x, top.x, ramp(s, 0, 0.85)), y: lerp(bottom.y, top.y, s) };
      return { torso, leg, arm: gripTo(shoulder, hand, { x: 1, y: 0.6 }, scale(s)), anchor: 'ankle', at: O };
    },
    props: handProp(implement),
  };
}

/**
 * Seated shoulder press machine, side view: back on the pad, feet flat, hands
 * on the handles just in front of the shoulders, pressed up to nearly straight arms.
 */
function machinePress(): Demo {
  const torso = -8;
  const shoulder = along(O, torso, L.torso);
  const bottom = local(shoulder, torso, 0.075, 0.03);
  const top = local(shoulder, torso, 0.03, LOCKED - 0.004);
  const scale = curve([[0, 0.85], [1, 1]]);
  const leg: Leg = { thigh: 90, shin: 180, foot: 90 };
  const floor = L.shin + L.ankleHeight;
  // Seat pad under the thighs; back pad behind the back, from the waist to the head.
  const seatY = BODY.thighBack + 0.023;
  const back = (t: number) => local(O, torso, -(BODY.torsoBack + 0.025), t);
  const props: Prop[] = [
    { kind: 'line', from: { x: back(0).x - 0.05, y: floor }, to: { x: back(0).x - 0.05, y: back(0.46).y - 0.02 }, width: 0.03 },
    { kind: 'line', from: { x: 0.02, y: seatY }, to: { x: 0.02, y: floor }, width: 0.03 },
    { kind: 'line', from: { x: back(0).x - 0.1, y: floor - 0.008 }, to: { x: 0.2, y: floor - 0.008 }, width: 0.016 },
    { kind: 'bench', points: [back(0.07), back(0.46)], legs: false },
    { kind: 'bench', points: [{ x: -0.1, y: seatY }, { x: 0.17, y: seatY }], legs: false },
    { kind: 'attached', at: 'wrist', from: { x: 0, y: -0.035 }, to: { x: 0, y: 0.035 }, width: 0.022 },
  ];
  return {
    view: 'side',
    floor,
    pose: (s) => {
      const hand = { x: lerp(bottom.x, top.x, ramp(s, 0, 0.85)), y: lerp(bottom.y, top.y, s) };
      return { torso, leg, arm: gripTo(shoulder, hand, { x: 1, y: 0.6 }, scale(s)), anchor: 'hip', at: O };
    },
    props,
  };
}

/** Pike push-up: hips high; the head lowers toward the floor just in front of the hands. */
export function pikePushUp(): Demo {
  const toe: Vec = { x: -0.04, y: 0 };
  const palm: Vec = { x: 0.62 + PALM, y: FLOOR - BODY.hand / 2 };
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
        arm: palmTo(shoulder, palm, 90, BACK),
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
