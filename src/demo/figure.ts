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
  ankleHeight: 0.035,
  heel: 0.03,
  neck: 0.115,
  headRadius: 0.058,
  /** Front view: half the distance between shoulder joints / hip joints. */
  shoulderHalf: 0.115,
  hipHalf: 0.055,
};

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
  foot: number;
}
export interface Arm {
  upper: number;
  fore: number;
  /** Apparent length (1 = full). Below 1 when the arm points toward the camera. */
  scale?: number;
}

export type AnchorJoint = 'ankle' | 'toe' | 'knee' | 'hip' | 'shoulder' | 'wrist' | 'elbow';

export interface DemoPose {
  torso: number;
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
  hip: Vec;
  knee: Vec;
  ankle: Vec;
  heel: Vec;
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
  torso: number;
}

function limbs(view: 'side' | 'front', pose: DemoPose, hip: Vec, shoulder: Vec, leg: Leg, arm: Arm, sign: -1 | 1): Side {
  const knee = along(hip, leg.thigh, L.thigh);
  const ankle = along(knee, leg.shin, L.shin);
  let heel: Vec;
  let toe: Vec;
  if (view === 'side') {
    const f = dir(leg.foot);
    const n = dir(leg.foot + 90);
    heel = add(add(ankle, mul(f, -L.heel)), mul(n, L.ankleHeight));
    toe = add(add(ankle, mul(f, L.foot)), mul(n, L.ankleHeight));
  } else {
    // Feet point at the camera: draw them short, turned slightly out.
    const down = dir(pose.torso + 180);
    heel = add(ankle, mul(down, L.ankleHeight));
    toe = add(heel, mul(dir(pose.torso + 90), sign * 0.03));
  }
  const s = arm.scale ?? 1;
  const elbow = along(shoulder, arm.upper, L.upperArm * s);
  const wrist = along(elbow, arm.fore, L.forearm * s);
  return { shoulder, elbow, wrist, hip, knee, ankle, heel, toe };
}

/** Joint positions for a pose. */
export function solve(view: 'side' | 'front', pose: DemoPose): Figure {
  const hipC = { x: 0, y: 0 };
  const shC = along(hipC, pose.torso, L.torso * (pose.torsoScale ?? 1));
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
  const headDir = pose.head ?? pose.torso;
  const head = along(shC, headDir, L.neck);
  const nose = view === 'side' ? along(head, headDir + 90, L.headRadius * 0.95) : along(head, headDir + 180, 0.012);
  const ear = view === 'side' ? along(head, headDir - 90, 0.01) : along(head, headDir - 90, L.headRadius);
  const ear2 = view === 'side' ? ear : along(head, headDir + 90, L.headRadius);

  const fig: Figure = { view, a, b, head, nose, ear, ear2, torso: pose.torso };
  const shift = sub(pose.at, a[pose.anchor]);
  return translate(fig, shift);
}

function translate(f: Figure, d: Vec): Figure {
  const moveSide = (s: Side): Side =>
    Object.fromEntries(Object.entries(s).map(([k, v]) => [k, add(v, d)])) as unknown as Side;
  return { ...f, a: moveSide(f.a), b: moveSide(f.b), head: add(f.head, d), nose: add(f.nose, d), ear: add(f.ear, d), ear2: add(f.ear2, d) };
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
