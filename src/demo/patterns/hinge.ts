// Movement patterns: hinges, deadlifts, hamstring curls and back extensions. Conventions and helpers: ./shared.ts.
//
// What the hands hold rests against the body instead of passing through it: a
// bar or dumbbells slide down the front of the thighs and shins (skin from
// BODY) on straight arms, and bodies lie on their pads.
import { BODY } from '../body';
import { PLATE_R } from '../equipment';
import { L, GRIP, add, along, dir, gripTo, lerp, mul, palmTo, sub, twoLink, type Arm, type DemoPose, type Leg, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { O, FLOOR, BACK, DOWN, chainUp } from './shared';

/** Shoulder to the middle of the fist, arm straight. */
const REACH = L.upperArm + L.forearm + GRIP;
/** Sizes as ../equipment draws them: a bar's end, a dumbbell's head, a pad's half-thickness, a roller pad. */
const BAR_R = 0.02;
const DB_R = 0.04;
const PAD = 0.023;
const ROLLER = 0.035;

const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
/** Eases in and out over u = 0..1. */
const smooth = (u: number) => {
  const c = clamp01(u);
  return c * c * (3 - 2 * c);
};
/** Neck in line with the back, eyes a little ahead: the head lifts slightly from the trunk line as it tips forward. */
const headFor = (trunk: number) => trunk - Math.min(12, Math.max(0, trunk) * 0.2);

function segDist(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const t = clamp01(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x ** 2 + ab.y ** 2));
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t));
}

/** How far p is outside the near leg's front (thigh and shin skin); negative inside. */
function offLegs(p: Vec, hip: Vec, knee: Vec, ankle: Vec): number {
  return Math.min(segDist(p, hip, knee) - BODY.thighFront, segDist(p, knee, ankle) - BODY.shinFront);
}

/**
 * Where straight arms from `shoulder` hold a weight of radius r against the
 * front of the legs: the lats sweep the arms back until the weight touches
 * the thighs or shins. Hangs straight down when the legs are out of reach.
 */
function onLegs(shoulder: Vec, hip: Vec, knee: Vec, ankle: Vec, r: number): Vec {
  const held = (deg: number) => along(shoulder, deg, REACH);
  const clear = (deg: number) => offLegs(held(deg), hip, knee, ankle) - r;
  let lo = 90;
  let hi = 90;
  while (hi < 270 && clear(hi) > 0) {
    lo = hi;
    hi += 2;
  }
  if (hi >= 270 || hi === 90) return held(180);
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (clear(m) > 0) lo = m;
    else hi = m;
  }
  return held(lo);
}

/** Smooth path through a (s = 0), b (s = m) and c (s = 1) without overshooting b. */
function through(a: number, b: number, c: number, m: number, s: number): number {
  const slope = (b - a) * (c - b) > 0 ? c - a : 0;
  const hermite = (p0: number, p1: number, m0: number, m1: number, h: number, u: number) => {
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * m1;
  };
  return s <= m ? hermite(a, b, (b - a) / m, slope, m, s / m) : hermite(b, c, slope, (c - b) / (1 - m), 1 - m, (s - m) / (1 - m));
}

/**
 * Hip hinge from standing (s = 0) to the bottom (s = 1): hips back, soft
 * knees, flat back. A bar or dumbbells slide down the front of the legs; on
 * one leg the dumbbells hang straight down and the free leg reaches back in
 * line with the trunk; a back bar sits on the upper back, hands on it.
 */
export function hinge(o: {
  implement: 'barbell' | 'dumbbell' | 'backBar' | 'cable';
  /** Trunk lean from vertical at the bottom. */
  torso: number;
  /** Thigh tilt back from vertical at the bottom (hips back). */
  hipsBack: number;
  /** Shin tilt forward at the bottom. */
  knee: number;
  singleLeg?: boolean;
}): Demo {
  // Standing tall with soft knees: shin and thigh a few degrees off vertical.
  const top = { shin: 2, thigh: 4 };
  const pose = (s: number): DemoPose => {
    const torso = o.torso * s;
    const shin = 180 + lerp(top.shin, o.knee, s);
    const thigh = 180 - lerp(top.thigh, o.hipsBack, s);
    const { knee, hip, shoulder } = chainUp(O, shin, thigh, torso);
    let arm: Arm;
    if (o.implement === 'backBar') {
      // Bar resting on the upper back just above the shoulder joints; hands on it outside the shoulders, elbows
      // down and back (the arm runs out to the side, so it looks short).
      const bar = add(along(shoulder, torso - 90, BODY.torsoBack + BAR_R - 0.004), mul(dir(torso), 0.02));
      arm = gripTo(shoulder, bar, dir(torso + 200), 0.75);
    } else if (o.implement === 'cable') {
      // Straight arms, hands on the rope between the legs; at the bottom the cable pulls them back through.
      arm = gripTo(shoulder, along(shoulder, lerp(178, 216, s), REACH), BACK);
    } else {
      const r = o.implement === 'dumbbell' ? DB_R : BAR_R;
      const hang = along(shoulder, 180, REACH);
      arm = gripTo(shoulder, o.singleLeg && offLegs(hang, hip, knee, O) > r ? hang : onLegs(shoulder, hip, knee, O, r), BACK);
    }
    // Free leg (single-leg): swings back with the trunk like a seesaw, from just off the floor (knee bent, foot
    // relaxed) to straight back in line with the trunk, toes pointing at the floor.
    const free: Leg | undefined = o.singleLeg ? freeLeg(torso, s) : undefined;
    return { torso, head: headFor(torso), leg: { thigh, shin, foot: 90 }, leg2: free, arm, anchor: 'ankle', at: O };
  };
  const props: Prop[] =
    o.implement === 'cable'
      ? // Low pulley behind the lifter; the rope runs between the legs.
        [{ kind: 'cable', from: { x: -0.6, y: FLOOR - 0.06 }, at: 'wrist' }]
      : o.implement === 'dumbbell'
        ? [{ kind: 'dumbbell', at: 'wrists' }]
        : [{ kind: 'barbell', at: 'wrist' }];
  return { view: 'side', pose, props };
}

/** Single-leg hinge: the free leg in line with the trunk, its knee bend and relaxed foot fading out as it rises. */
function freeLeg(torso: number, s: number): Leg {
  const thigh = 180 + torso + 2 * (1 - s);
  const shin = thigh + 30 * (1 - s) ** 2;
  return { thigh, shin, foot: shin - 90 - 22 * (1 - s) };
}

/** The bar's centre on the floor, touching the front of shins tilted `shin` degrees forward. */
function barOnShins(shin: number): Vec {
  const h = PLATE_R - FLOOR; // bar height above the ankle joint
  const r = (shin * Math.PI) / 180;
  return { x: (BODY.shinFront + BAR_R + h * Math.sin(r)) / Math.cos(r), y: FLOOR - PLATE_R };
}

/** Trunk lean at which straight arms hold the bar at height y against legs with these angles. */
function leanForBar(shin: number, thigh: number, y: number): number {
  let lo = 0;
  let hi = 89;
  for (let i = 0; i < 30; i++) {
    const t = (lo + hi) / 2;
    const { knee, hip, shoulder } = chainUp(O, shin, thigh, t);
    if (onLegs(shoulder, hip, knee, O, BAR_R).y < y) lo = t;
    else hi = t;
  }
  return (lo + hi) / 2;
}

/**
 * Conventional or sumo deadlift: s = 0 with the plates on the floor, s = 1 at
 * lockout. The start is built from the bar: over the foot against the shins,
 * arms straight, shoulders a little in front of it, hips between knees and
 * shoulders. The knees move back as the bar leaves the floor, hips and
 * shoulders rise together, and the hips come through once the bar passes the
 * knees; the bar rides up the shins and thighs.
 */
export function deadlift(o: {
  /** Shin tilt forward at the start. */
  shin: number;
  /** Shoulders in front of the bar at the start (body heights). */
  ahead: number;
  /** Knee bend (thigh tilt back, shins vertical) as the bar passes the knees. */
  pastKnees: number;
}): Demo {
  const bar0 = barOnShins(o.shin);
  const knee0 = along(O, o.shin, L.shin);
  const shoulder0 = { x: bar0.x + o.ahead, y: bar0.y - Math.sqrt(REACH ** 2 - o.ahead ** 2) };
  const [up, lean0] = twoLink(knee0, shoulder0, L.thigh, L.torso, BACK);
  const start = { shin: 180 + o.shin, thigh: up + 180, torso: lean0 };
  const knees = { shin: 180, thigh: 180 - o.pastKnees, torso: leanForBar(180, 180 - o.pastKnees, -L.shin) };
  const lockout = { shin: 180, thigh: 180, torso: 0 };
  // Share of the movement spent getting the bar to the knees.
  const m = 0.5;
  const pose = (s: number): DemoPose => {
    const shin = through(start.shin, knees.shin, lockout.shin, m, s);
    const thigh = through(start.thigh, knees.thigh, lockout.thigh, m, s);
    const torso = through(start.torso, knees.torso, lockout.torso, m, s);
    const { knee, hip, shoulder } = chainUp(O, shin, thigh, torso);
    const bar = onLegs(shoulder, hip, knee, O, BAR_R);
    return { torso, head: headFor(torso), leg: { thigh, shin, foot: 90 }, arm: gripTo(shoulder, bar, BACK), anchor: 'ankle', at: O };
  };
  return { view: 'side', pose, props: [{ kind: 'barbell', at: 'wrist' }] };
}

/** Hardstyle kettlebell swing: s = 0 hiked back between the legs, s = 1 standing tall with the bell at chest height. */
export function swing(): Demo {
  const hike = { shin: 4, thigh: 30, torso: 64 };
  return {
    view: 'side',
    pose: (s) => {
      // The hips snap through first (standing by s = 0.6); the arms just follow and the bell floats up.
      const k = 1 - smooth(s / 0.6);
      const torso = hike.torso * k;
      const shin = 180 + hike.shin * k;
      const thigh = 180 - hike.thigh * k;
      const { shoulder } = chainUp(O, shin, thigh, torso);
      // Straight arms: back between the thighs at the hike, a little under horizontal at the top.
      const armDeg = lerp(226, 96, smooth(s));
      return {
        torso,
        head: headFor(torso),
        leg: { thigh, shin, foot: 90 },
        arm: gripTo(shoulder, along(shoulder, armDeg, REACH), BACK),
        anchor: 'ankle',
        at: O,
      };
    },
    props: [{ kind: 'kettlebell', at: 'wrist' }],
  };
}

/** Kneeling on a pad, ankles held down: the straight body lowers forward from the knees, hands ready to catch. */
export function nordic(): Demo {
  // Shins flat on the pad (their front on it), feet pointed back.
  const padTop = FLOOR - 2 * PAD;
  const knee: Vec = { x: 0, y: padTop - BODY.shinFront };
  const lowest = 66; // body lean at the turnaround
  return {
    view: 'side',
    floor: FLOOR,
    pose: (s) => {
      const lean = lowest * s;
      const shoulder = along(knee, lean, L.thigh + L.torso);
      // Hands up in front of the chest, then reaching for the floor in front.
      const chest = add(along(shoulder, lean + 180, 0.06), along(O, lean + 90, 0.2));
      const catchAt: Vec = { x: shoulder.x + 0.1, y: FLOOR - BODY.hand / 2 - 0.03 };
      const reach = smooth((s - 0.35) / 0.65);
      const palm = add(mul(chest, 1 - reach), mul(catchAt, reach));
      return {
        torso: lean,
        head: lean - 6,
        leg: { thigh: 180 + lean, shin: 270, foot: 262 },
        arm: palmTo(shoulder, palm, lerp(lean + 10, 90, reach), DOWN),
        anchor: 'knee',
        at: knee,
      };
    },
    props: [
      { kind: 'bench', points: [{ x: knee.x - L.shin - 0.13, y: FLOOR - PAD }, { x: knee.x + 0.06, y: FLOOR - PAD }], legs: false },
      // Roller over the lower calves, just above the heels.
      { kind: 'pad', at: 'ankle', offset: { x: 0.03, y: -(0.045 + ROLLER) } },
    ],
  };
}

/** Face down on the machine, head right, knees just past the pad: the heels curl up toward the glutes. */
export function lyingLegCurl(): Demo {
  // Pad top at y = 0; pelvis and chest rest on it, the thighs too (so they slope down a little to the knees).
  const hip: Vec = { x: 0, y: -BODY.torsoFront };
  const thigh = 270 - (Math.asin((BODY.torsoFront - BODY.thighFront) / L.thigh) * 180) / Math.PI;
  const knee = along(hip, thigh, L.thigh);
  const shoulder = along(hip, 90, L.torso);
  const shin0 = thigh + 10; // knees just unlocked at the start
  // The pad runs from just above the knees to the chest; the hands hold handles low in front of it.
  const padFront = shoulder.x - 0.1;
  const handle: Vec = { x: shoulder.x + 0.05, y: 0.24 };
  return {
    view: 'side',
    floor: 0.4,
    pose: (s) => {
      const shin = shin0 + 105 * s;
      return { torso: 90, head: 84, leg: { thigh, shin, foot: shin - 90 }, arm: gripTo(shoulder, handle, BACK), anchor: 'hip', at: hip };
    },
    props: [
      { kind: 'bench', points: [{ x: knee.x + 0.05, y: PAD }, { x: padFront, y: PAD }] },
      { kind: 'line', from: { x: padFront, y: handle.y }, to: handle, width: 0.016 },
      { kind: 'bar', at: handle },
      // Roller on the backs of the ankles (placed for the start: a pad can't turn with the shin).
      { kind: 'pad', at: 'ankle', offset: add(along(O, shin0 + 180, 0.04), along(O, shin0 + 90, 0.045 + ROLLER)) },
    ],
  };
}

/** Seated, legs out in front under a thigh pad: the heels curl down and back under the seat. */
export function seatedLegCurl(): Demo {
  const torso = -12; // leaning back on the backrest
  // Seat top at y = 0: the thighs rest on it; the glutes touch the backrest, the knees are past the seat.
  const hip: Vec = { x: 0, y: -BODY.thighBack };
  const shoulder = along(hip, torso, L.torso);
  const behind = (t: number) => add(along(hip, torso, t), along(O, torso - 90, BODY.glute + PAD));
  const handle: Vec = { x: hip.x + 0.1, y: -0.035 };
  const shin0 = 94; // legs out straight at the start
  return {
    view: 'side',
    floor: 0.4,
    pose: (s) => {
      const shin = lerp(shin0, 200, s);
      return { torso, head: torso + 4, leg: { thigh: 90, shin, foot: shin - 90 }, arm: gripTo(shoulder, handle, BACK), anchor: 'hip', at: hip };
    },
    props: [
      // Backrest and seat, on a pedestal.
      { kind: 'bench', points: [behind(0.4), behind(0.06), { x: behind(0.06).x, y: PAD }, { x: hip.x + 0.16, y: PAD }], legs: false },
      { kind: 'line', from: { x: hip.x - 0.02, y: 0.05 }, to: { x: hip.x - 0.02, y: 0.4 }, width: 0.03 },
      { kind: 'line', from: { x: hip.x - 0.14, y: 0.392 }, to: { x: hip.x + 0.1, y: 0.392 }, width: 0.016 },
      { kind: 'bar', at: handle },
      // Thigh pad over the knees; roller under the backs of the ankles (placed for the start: a pad can't turn with the shin).
      { kind: 'pad', at: 'knee', offset: { x: -0.07, y: 0.06 - (BODY.thighFront + ROLLER) } },
      { kind: 'pad', at: 'ankle', offset: add(along(O, shin0 + 180, 0.04), along(O, shin0 + 90, 0.045 + ROLLER)) },
    ],
  };
}

/** 45° back extension: legs fixed between the foot plate, ankle roller and thigh pad; the trunk lowers from the hips and rises to a straight line. */
export function backExtension(): Demo {
  const legDeg = 225; // hip → ankle: the body line is at 45°
  const ankle: Vec = { x: 0, y: -0.24 };
  const pose = (s: number): DemoPose => {
    // From a straight line down to 88° of hip bend, back flat.
    const torso = lerp(legDeg - 180, legDeg - 180 + 88, s);
    // Arms crossed on the chest.
    return { torso, head: torso, leg: { thigh: legDeg, shin: legDeg, foot: legDeg - 90 }, arm: { upper: torso + 146, fore: torso + 356 }, anchor: 'ankle', at: ankle };
  };
  const hip = along(ankle, legDeg - 180, L.shin + L.thigh);
  const front = legDeg - 90; // the way the front of the legs faces
  const onThigh = (fromHip: number, out: number) => along(along(hip, legDeg, fromHip), front, out);
  // Thigh pad under the front of the thighs, from the knees to a hand's width below the hip crease (the hips bend freely).
  const padTop = onThigh(0.1, BODY.thighFront + PAD);
  const padLow = onThigh(L.thigh, BODY.thighFront + PAD);
  // Foot plate under the soles.
  const sole = along(ankle, legDeg, L.ankleHeight + 0.01);
  const plateBack = along(sole, front + 180, 0.05);
  const plateFront = along(sole, front, 0.15);
  // Frame: a beam parallel to the legs from the foot plate to under the pad, on two posts.
  const beamHigh = onThigh(0.17, 0.15);
  return {
    view: 'side',
    pose,
    props: [
      { kind: 'line', from: plateFront, to: beamHigh, width: 0.03 },
      { kind: 'line', from: beamHigh, to: { x: beamHigh.x, y: FLOOR }, width: 0.03 },
      { kind: 'line', from: plateFront, to: { x: plateFront.x, y: FLOOR }, width: 0.03 },
      { kind: 'line', from: { x: plateFront.x - 0.06, y: FLOOR - 0.008 }, to: { x: beamHigh.x + 0.06, y: FLOOR - 0.008 }, width: 0.016 },
      { kind: 'line', from: plateBack, to: plateFront, width: 0.02 },
      { kind: 'line', from: onThigh(0.17, BODY.thighFront + PAD), to: beamHigh, width: 0.02 },
      { kind: 'bench', points: [padLow, padTop], legs: false },
      // Ankle roller behind the lower calves, just above the heels.
      { kind: 'pad', at: 'ankle', offset: add(along(O, legDeg - 180, 0.045), along(O, legDeg + 90, 0.04 + ROLLER)) },
    ],
  };
}
