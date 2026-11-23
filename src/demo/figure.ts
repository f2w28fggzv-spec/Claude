// A 2D figure for exercise demos. Pure geometry, no DOM, so tests can turn a
// demo into landmarks and run it through the analysis engine.
//
// Units are body heights; y grows downward. Segment directions are degrees:
// 0 = up, 90 = the way the lifter faces (side view) or image right (front
// view), 180 = down, 270 = behind / image left.

export interface Vec {
  x: number;
  y: number;
}

/** Segment lengths as a share of height (Winter 2009, as in the engine). */
export const L = {
  thigh: 0.245,
  shin: 0.246,
  torso: 0.288,
  upperArm: 0.186,
  forearm: 0.146,
  /** Ankle to toe along the foot, and ankle height above the floor. */
  foot: 0.11,
  /** Ankle to the ball of the foot, where the toes bend (about 73% of the foot from the heel). */
  ball: 0.072,
  ankleHeight: 0.035,
  heel: 0.03,
  neck: 0.115,
  headRadius: 0.058,
  /** Front view: half the distance between shoulder joints / hip joints. */
  shoulderHalf: 0.115,
  hipHalf: 0.055,
};

/** Share of the torso from the hip joint to the waist; the rest runs from the waist to the shoulder. */
export const WAIST = 0.4;
/** A gripped bar or handle sits this far past the wrist, in the palm. */
export const GRIP = 0.035;
/** An open hand pressing on a surface: palm centre this far past the wrist. */
export const PALM = 0.04;

export const dir = (deg: number): Vec => {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
};
export const angleOf = (v: Vec): number => (Math.atan2(v.x, -v.y) * 180) / Math.PI;
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const along = (p: Vec, deg: number, len: number): Vec => add(p, mul(dir(deg), len));
export const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
export const lerpV = (a: Vec, b: Vec, s: number): Vec => ({ x: lerp(a.x, b.x, s), y: lerp(a.y, b.y, s) });
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

export interface Leg {
  thigh: number;
  shin: number;
  /** Heel to the ball of the foot. */
  foot: number;
  /** Ball of the foot to the toe tip. Default: in line with the foot. Keeps the toes flat while the heel rises (calf raise, the back foot of a lunge). */
  toes?: number;
}
export interface Arm {
  upper: number;
  fore: number;
  /** Apparent length (1 = full). Below 1 when the arm points toward the camera. */
  scale?: number;
  /** Apparent forearm length when it differs from the upper arm's (a wide grip foreshortens mostly the forearm). */
  foreScale?: number;
  /** Direction from the wrist to the fingers. Default: in line with the forearm (a fist around a bar). */
  hand?: number;
  /** An open hand pressing on a surface (push-up, plank) instead of a fist. */
  flat?: boolean;
}

export type AnchorJoint = 'ankle' | 'toe' | 'knee' | 'hip' | 'shoulder' | 'wrist' | 'elbow';

export interface DemoPose {
  /** Lower trunk direction (hip joint to waist); without a bend, the whole trunk. */
  torso: number;
  /**
   * Spine flexion at the waist, side view only: the upper trunk (waist to
   * shoulder) turns this many degrees from the lower trunk, toward the front of
   * the body (a crunch) when positive, backward when negative.
   */
  bend?: number;
  head?: number;
  /** Apparent torso length (1 = full), e.g. a hinged torso seen from the front. */
  torsoScale?: number;
  /** Side view: near leg/arm. Front view: the lifter's right (image left). */
  leg: Leg;
  arm: Arm;
  /** Side view: far side. Front view: the lifter's left. Defaults to leg/arm. */
  leg2?: Leg;
  arm2?: Arm;
  /** This joint (of the near / right side) is placed at `at`. */
  anchor: AnchorJoint;
  at: Vec;
}

export interface Side {
  shoulder: Vec;
  elbow: Vec;
  wrist: Vec;
  /** Where the hand holds things: the middle of the fist, or of the palm when the hand is flat. */
  hand: Vec;
  hip: Vec;
  knee: Vec;
  ankle: Vec;
  heel: Vec;
  /** Ball of the foot, on the sole, where the toes bend. */
  ball: Vec;
  toe: Vec;
}

export interface Figure {
  view: 'side' | 'front';
  /** Side view: near. Front view: lifter's right. */
  a: Side;
  /** Side view: far. Front view: lifter's left. */
  b: Side;
  head: Vec;
  nose: Vec;
  ear: Vec;
  ear2: Vec;
  /** Where the lower and upper trunk meet (on the hip-shoulder line unless the spine bends). */
  waist: Vec;
  /** Lower trunk direction. */
  torso: number;
  /** Upper trunk direction (torso + bend). */
  upper: number;
}

function limbs(view: 'side' | 'front', pose: DemoPose, hip: Vec, shoulder: Vec, leg: Leg, arm: Arm, sign: -1 | 1): Side {
  const knee = along(hip, leg.thigh, L.thigh);
  const ankle = along(knee, leg.shin, L.shin);
  let heel: Vec;
  let ball: Vec;
  let toe: Vec;
  if (view === 'side') {
    // The sole runs ankleHeight below the ankle: heel, ball of the foot, then the toes (which may bend at the ball).
    const f = dir(leg.foot);
    const n = dir(leg.foot + 90);
    heel = add(add(ankle, mul(f, -L.heel)), mul(n, L.ankleHeight));
    ball = add(add(ankle, mul(f, L.ball)), mul(n, L.ankleHeight));
    toe = along(ball, leg.toes ?? leg.foot, L.foot - L.ball);
  } else {
    // Feet point at the camera: draw them short, turned slightly out.
    const down = dir(pose.torso + 180);
    heel = add(ankle, mul(down, L.ankleHeight));
    toe = add(heel, mul(dir(pose.torso + 90), sign * 0.03));
    ball = lerpV(heel, toe, 0.7);
  }
  const s = arm.scale ?? 1;
  const elbow = along(shoulder, arm.upper, L.upperArm * s);
  const wrist = along(elbow, arm.fore, L.forearm * (arm.foreScale ?? s));
  const hand = along(wrist, arm.hand ?? arm.fore, (arm.flat ? PALM : GRIP) * (arm.foreScale ?? s));
  return { shoulder, elbow, wrist, hand, hip, knee, ankle, heel, ball, toe };
}

/** Joint positions for a pose. */
export function solve(view: 'side' | 'front', pose: DemoPose): Figure {
  const hipC = { x: 0, y: 0 };
  const bend = view === 'side' ? (pose.bend ?? 0) : 0;
  const trunk = L.torso * (pose.torsoScale ?? 1);
  const waist = along(hipC, pose.torso, trunk * WAIST);
  const upperDir = pose.torso + bend;
  const shC = along(waist, upperDir, trunk * (1 - WAIST));
  const across = dir(pose.torso + 90);
  const w = (half: number, sign: -1 | 1) => (view === 'front' ? mul(across, half * sign) : { x: 0, y: 0 });
  const a = limbs(view, pose, add(hipC, w(L.hipHalf, -1)), add(shC, w(L.shoulderHalf, -1)), pose.leg, pose.arm, -1);
  const b = limbs(
    view,
    pose,
    add(hipC, w(L.hipHalf, 1)),
    add(shC, w(L.shoulderHalf, 1)),
    pose.leg2 ?? pose.leg,
    pose.arm2 ?? pose.arm,
    1,
  );
  const headDir = pose.head ?? upperDir;
  // Front view: a trunk tipped toward the camera (torsoScale < 1) tips the neck with it, so the neck foreshortens too.
  const head = along(shC, headDir, L.neck * (view === 'front' ? (pose.torsoScale ?? 1) : 1));
  const nose = view === 'side' ? along(head, headDir + 90, L.headRadius * 0.95) : along(head, headDir + 180, 0.012);
  const ear = view === 'side' ? along(head, headDir - 90, 0.01) : along(head, headDir - 90, L.headRadius);
  const ear2 = view === 'side' ? ear : along(head, headDir + 90, L.headRadius);

  const fig: Figure = { view, a, b, head, nose, ear, ear2, waist, torso: pose.torso, upper: upperDir };
  const shift = sub(pose.at, a[pose.anchor]);
  return translate(fig, shift);
}

function translate(f: Figure, d: Vec): Figure {
  const moveSide = (s: Side): Side =>
    Object.fromEntries(Object.entries(s).map(([k, v]) => [k, add(v, d)])) as unknown as Side;
  return {
    ...f,
    a: moveSide(f.a),
    b: moveSide(f.b),
    head: add(f.head, d),
    nose: add(f.nose, d),
    ear: add(f.ear, d),
    ear2: add(f.ear2, d),
    waist: add(f.waist, d),
  };
}

/**
 * Two-segment chain from `base` to `target` (e.g. shoulder → wrist). Returns
 * the directions of both segments; the middle joint bends toward `toward`.
 * Out-of-reach targets are reached as far as possible.
 */
export function twoLink(base: Vec, target: Vec, l1: number, l2: number, toward: Vec): [number, number] {
  const v = sub(target, base);
  const d = Math.min(l1 + l2 - 1e-6, Math.max(Math.abs(l1 - l2) + 1e-6, Math.hypot(v.x, v.y)));
  const theta = angleOf(v);
  const alpha = (Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))) * 180) / Math.PI;
  const options = [theta + alpha, theta - alpha].map((a1) => {
    const mid = along(base, a1, l1);
    const end = along(base, theta, d);
    return { a1, a2: angleOf(sub(end, mid)), mid };
  });
  const score = (m: Vec) => (m.x - base.x) * toward.x + (m.y - base.y) * toward.y;
  const best = score(options[0].mid) >= score(options[1].mid) ? options[0] : options[1];
  return [best.a1, best.a2];
}

/** Arm reaching from `shoulder` to `wrist`, elbow toward `toward`. */
export function armTo(shoulder: Vec, wrist: Vec, toward: Vec, scale = 1): Arm {
  const [upper, fore] = twoLink(shoulder, wrist, L.upperArm * scale, L.forearm * scale, toward);
  return { upper, fore, ...(scale !== 1 && { scale }) };
}

/**
 * Arm whose fist closes around `grip` (a bar, a handle), elbow toward
 * `toward`: the wrist stops short of the bar by GRIP, in line with the forearm.
 */
export function gripTo(shoulder: Vec, grip: Vec, toward: Vec, scale = 1): Arm {
  const [upper, fore] = twoLink(shoulder, grip, L.upperArm * scale, (L.forearm + GRIP) * scale, toward);
  return { upper, fore, ...(scale !== 1 && { scale }) };
}

/**
 * Arm pressing an open hand on a surface: the palm centre lands on `palm`
 * with the fingers pointing `hand` (degrees), elbow toward `toward`.
 */
export function palmTo(shoulder: Vec, palm: Vec, hand: number, toward: Vec): Arm {
  const wrist = along(palm, hand + 180, PALM);
  return { ...armTo(shoulder, wrist, toward), hand, flat: true };
}

/** Leg reaching from `hip` to `ankle`, knee toward `toward`. */
export function legTo(hip: Vec, ankle: Vec, toward: Vec, foot = 90): Leg {
  const [thigh, shin] = twoLink(hip, ankle, L.thigh, L.shin, toward);
  return { thigh, shin, foot };
}

/** Shortest-path interpolation between two angles. */
export function lerpAngle(a: number, b: number, s: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * s;
}
