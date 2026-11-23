// Movement patterns: hinges, deadlifts, hamstring curls and back extensions. Conventions and helpers: ./shared.ts.
//
// What the hands hold rests against the body instead of passing through it: a
// bar or dumbbells slide down the front of the thighs and shins (skin from
// BODY) on straight arms, and bodies lie on their pads.
import { BODY } from '../body';
import { PLATE_R } from '../equipment';
import { L, GRIP, add, along, dir, gripTo, lerp, lerpV, mul, palmTo, solve, sub, twoLink, type Arm, type DemoPose, type Leg, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { O, FLOOR, BACK, DOWN, centreOfMass, chainUp, solveFor } from './shared';

/** Shoulder to the middle of the fist, arm straight. */
const REACH = L.upperArm + L.forearm + GRIP;
/** Sizes as ../equipment draws them: a bar's end, a dumbbell's head, a pad's half-thickness, a roller pad. */
const BAR_R = 0.02;
/** A good-morning bar, as a share of body weight. */
const BACK_BAR = 0.4;
const DB_R = 0.04;
const PAD = 0.023;
const ROLLER = 0.035;
/**
 * The skin as ../body draws it (outline included), from the bone line, where the body rests on a pad or a roller
 * presses on it; BODY holds the thickest points. Trunk front by the groin (0.02 from the hip joint) and at the chest
 * (0.21); thigh front 0.06 and 0.19 from the hip; the back of the lower calf 0.03 to 0.05 above the ankle, just above
 * the heel; the front of the shin where a bar on the floor touches it.
 */
const SKIN = { groin: 0.0546, chest: 0.0858, thighHigh: 0.0599, thighLow: 0.0505, calfLow: 0.027, shinFront: 0.025 };

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

/** How far p is outside the near leg's front (thigh and shin skin, the shin as drawn); negative inside. */
function offLegs(p: Vec, hip: Vec, knee: Vec, ankle: Vec): number {
  return Math.min(segDist(p, hip, knee) - BODY.thighFront, segDist(p, knee, ankle) - SKIN.shinFront);
}

/**
 * Where straight arms from `shoulder` hold a weight of radius r against the
 * front of the legs: the lats sweep the arms back until the weight touches
 * the thighs or shins. Hangs straight down when the legs are out of reach.
 */
function onLegs(shoulder: Vec, hip: Vec, knee: Vec, ankle: Vec, r: number): Vec {
  const held = (deg: number) => along(shoulder, deg, REACH);
  const clear = (deg: number) => offLegs(held(deg), hip, knee, ankle) - r;
  // Sweep from arms straight forward (90°) back in 2° steps to the first contact, then refine.
  let lo = 90;
  if (clear(lo) <= 0) return held(lo);
  let hi = lo + 2;
  while (clear(hi) > 0) {
    if (hi >= 270) return held(180);
    lo = hi;
    hi += 2;
  }
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (clear(m) > 0) lo = m;
    else hi = m;
  }
  return held(lo);
}

/** The point on the line through l[0] and l[1] at x. */
function onLine(l: readonly [Vec, Vec], x: number): Vec {
  return lerpV(l[0], l[1], (x - l[0].x) / (l[1].x - l[0].x));
}

/** Where the lines through a and b cross. */
function crossing(a: readonly [Vec, Vec], b: readonly [Vec, Vec]): Vec {
  const r = sub(a[1], a[0]);
  const q = sub(b[1], b[0]);
  const t = ((b[0].x - a[0].x) * q.y - (b[0].y - a[0].y) * q.x) / (r.x * q.y - r.y * q.x);
  return add(a[0], mul(r, t));
}

/** A bench prop's points for a pad whose top surface runs through `top`: each side moved down by the pad's half-thickness, corners where they meet. */
function padUnder(top: Vec[]): Vec[] {
  const sides = top.slice(1).map((b, i): [Vec, Vec] => {
    const a = top[i];
    const u = mul(sub(b, a), 1 / Math.hypot(b.x - a.x, b.y - a.y));
    const down = u.x >= 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
    return [add(a, mul(down, PAD)), add(b, mul(down, PAD))];
  });
  return [sides[0][0], ...sides.slice(1).map((side, i) => crossing(sides[i], side)), sides[sides.length - 1][1]];
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
  // Standing tall with soft knees: shin and thigh a few degrees off vertical. `lean` tips the whole body at the ankles.
  const top = { shin: 2, thigh: 4 };
  const posed = (s: number, lean: number): DemoPose => {
    const torso = o.torso * s + lean;
    const shin = 180 + lerp(top.shin, o.knee, s) + lean;
    const thigh = 180 - lerp(top.thigh, o.hipsBack, s) + lean;
    const { knee, hip, shoulder } = chainUp(O, shin, thigh, torso);
    let arm: Arm;
    if (o.implement === 'backBar') {
      // Bar resting on the upper back just above the shoulder joints; hands on it outside the shoulders, elbows
      // down and back (the arm runs out to the side, so it looks short).
      const bar = add(along(shoulder, torso - 90, BODY.torsoBack + BAR_R - 0.004), mul(dir(torso), 0.02));
      arm = gripTo(shoulder, bar, dir(torso + 200), 0.75);
    } else if (o.implement === 'cable') {
      // Straight arms hanging a little forward: standing tall the fists hold the rope in front of the groin (the rope
      // runs back between the legs); at the bottom the cable draws them back between the thighs.
      arm = gripTo(shoulder, along(shoulder, lerp(165, 216, s), REACH), BACK);
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
  // A bar on the back sits behind the shoulders, which would put body plus bar behind the heels when standing
  // tall: the whole body tips forward at the ankles just enough to keep them over mid-foot.
  const midfoot = (L.foot - L.heel) / 2;
  const massX = (p: DemoPose) => {
    const f = solve('side', p);
    return centreOfMass(f, [{ at: f.a.hand, share: BACK_BAR }]).x;
  };
  const balanced = (s: number) => solveFor(-15, 20, (lean) => massX(posed(s, lean)), midfoot);
  const pose = (s: number): DemoPose => posed(s, o.implement === 'backBar' ? balanced(s) : 0);
  const props: Prop[] =
    o.implement === 'cable'
      ? // Low pulley behind the lifter; the rope runs between the legs.
        [{ kind: 'cable', from: { x: -0.6, y: FLOOR - 0.06 }, at: 'wrist', rope: true }]
      : o.implement === 'dumbbell'
        ? // On one leg: a single dumbbell in the hand opposite the standing leg (the far hand from this camera).
          [{ kind: 'dumbbell', at: o.singleLeg ? 'wrist2' : 'wrists' }]
        : [{ kind: 'barbell', at: 'wrist' }];
  // On one leg, the near (standing) leg does the work.
  return { view: 'side', pose, props, armBehindLegs: o.implement === 'cable', working: o.singleLeg ? 'a' : undefined };
}

/** Single-leg hinge: the free leg in line with the trunk, its knee bend and relaxed foot fading out as it rises. */
function freeLeg(torso: number, s: number): Leg {
  const thigh = 180 + torso + 2 * (1 - s);
  const shin = thigh + 30 * (1 - s) ** 2;
  return { thigh, shin, foot: shin - 90 - 22 * (1 - s) };
}

/**
 * The bar's centre on the floor, touching the front of shins tilted `shin` degrees forward (the shin as drawn). The
 * drawn shin and bar are thicker than real ones, so only near-vertical shins keep the bar over the middle of the foot.
 */
function barOnShins(shin: number): Vec {
  const h = PLATE_R - FLOOR; // bar height above the ankle joint
  const r = (shin * Math.PI) / 180;
  return { x: (SKIN.shinFront + BAR_R + h * Math.sin(r)) / Math.cos(r), y: FLOOR - PLATE_R };
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
  /** Sumo stance: the hands grip inside the knees. */
  sumo?: boolean;
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
  return { view: 'side', pose, props: [{ kind: 'barbell', at: 'wrist' }], armBehindLegs: o.sumo };
}

/** Hardstyle kettlebell swing: s = 0 hiked back between the legs, s = 1 standing tall with the bell at chest height. */
export function swing(): Demo {
  const hike = { shin: 4, thigh: 30, torso: 64 };
  return {
    view: 'side',
    // Both hands on the handle between the legs.
    armBehindLegs: true,
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
    props: [{ kind: 'kettlebell', at: 'wrist', swing: true }],
    // Ballistic: a quick snap up and a free drop back into the hike, no long pauses.
    timing: { start: 0.15, out: 0.55, far: 0.15, back: 0.6 },
  };
}

/** Kneeling on a pad, ankles held down: the straight body lowers forward from the knees, hands ready to catch. */
export function nordic(): Demo {
  // Shins flat on the pad (their front on it), feet pointed back.
  const padTop = FLOOR - 2 * PAD;
  const knee: Vec = { x: 0, y: padTop - BODY.shinFront };
  const ankle = along(knee, 270, L.shin);
  // The roller sits in the dip between the heel and the calf, touching both (as drawn).
  const roller = add(ankle, { x: 0.061, y: -0.066 });
  const padEnd = knee.x - L.shin - 0.13;
  const post = padEnd - 0.03;
  const lowest = 66; // body lean at the turnaround
  return {
    view: 'side',
    floor: FLOOR,
    pose: (s) => {
      const lean = lowest * s;
      const shoulder = along(knee, lean, L.thigh + L.torso);
      // Hands up in front of the chest, then reaching for the floor in front.
      const chest = add(along(shoulder, lean + 180, 0.06), along(O, lean + 90, 0.2));
      // Palms a few centimetres off the floor at the bottom, ahead of the shoulders.
      const catchAt: Vec = { x: shoulder.x + 0.1, y: FLOOR - BODY.hand / 2 - 0.03 };
      const reach = smooth((s - 0.35) / 0.65);
      const palm = add(mul(chest, 1 - reach), mul(catchAt, reach));
      return {
        torso: lean,
        // Neck neutral; eyes come up a little toward the floor ahead at the bottom.
        head: lean - 6 * s,
        leg: { thigh: 180 + lean, shin: 270, foot: 262 },
        arm: palmTo(shoulder, palm, lerp(lean + 10, 90, reach), DOWN),
        anchor: 'knee',
        at: knee,
      };
    },
    props: [
      { kind: 'bench', points: [{ x: padEnd, y: FLOOR - PAD }, { x: knee.x + 0.06, y: FLOOR - PAD }], legs: false },
      // The ankle hold: a roller pressing on the lower calves just above the heels, on an arm from a post at the pad's end.
      { kind: 'line', from: { x: post, y: FLOOR - 0.01 }, to: { x: post, y: roller.y - 0.03 }, width: 0.03 },
      { kind: 'line', from: { x: post - 0.05, y: FLOOR - 0.008 }, to: { x: post + 0.04, y: FLOOR - 0.008 }, width: 0.016 },
      { kind: 'line', from: { x: post, y: roller.y }, to: roller, width: 0.022 },
      { kind: 'pad', at: 'ankle', offset: sub(roller, ankle) },
    ],
  };
}

/**
 * Face down on an angled machine, head right, knees just past the pad: the heels curl up toward the glutes. The pad
 * has a ridge under the hips: its chest part slopes down toward the handles and its thigh part toward the knees, so
 * the hips stay a little flexed. The body rests on it by the drawn skin: the chest, the lower belly and the fronts of
 * the thighs.
 */
export function lyingLegCurl(): Demo {
  const thigh = 264; // hips flexed 6°: the thighs slope down a little to the knees
  // Trunk level, the chest resting on the pad at y = 0.
  const hip: Vec = { x: 0, y: -SKIN.chest };
  const knee = along(hip, thigh, L.thigh);
  const shoulder = along(hip, 90, L.torso);
  const onThigh = (t: number, d: number) => along(along(hip, thigh, t), thigh - 90, d);
  // The pad's top surface: the chest part under the groin and the chest, the thigh part under the thighs, meeting in
  // the ridge; from just above the knees to under the chest. The hands hold handles low in front of it.
  const chestPart: [Vec, Vec] = [{ x: hip.x + 0.02, y: hip.y + SKIN.groin }, { x: hip.x + 0.21, y: hip.y + SKIN.chest }];
  const thighPart: [Vec, Vec] = [onThigh(0.06, SKIN.thighHigh), onThigh(0.19, SKIN.thighLow)];
  const top = [onLine(thighPart, knee.x + 0.05), crossing(thighPart, chestPart), onLine(chestPart, shoulder.x - 0.07)];
  const handle: Vec = { x: shoulder.x + 0.05, y: 0.24 };
  const shin0 = thigh + 10; // knees just unlocked at the start
  return {
    view: 'side',
    floor: 0.4,
    pose: (s) => {
      const shin = shin0 + 105 * s;
      return { torso: 90, head: 84, leg: { thigh, shin, foot: shin - 90 }, arm: gripTo(shoulder, handle, BACK), anchor: 'hip', at: hip };
    },
    props: [
      { kind: 'bench', points: padUnder(top), beside: /arm|hand/ },
      { kind: 'line', from: { x: top[2].x, y: handle.y }, to: handle, width: 0.016 },
      { kind: 'bar', at: handle },
      // Roller on the back of the lower calves, just above the heels; it turns with the shin.
      { kind: 'pad', at: 'ankle', frame: 'shin', offset: { x: -0.04, y: SKIN.calfLow + ROLLER } },
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
  // The thigh pad presses across the thighs just above the knees, on an arm from the machine's upright in front of the knees.
  const knee = along(hip, 90, L.thigh);
  const thighPad = along(along(hip, 90, 0.19), 0, SKIN.thighLow + ROLLER);
  const upright = knee.x + 0.06;
  const armTop: Vec = { x: upright, y: thighPad.y - 0.06 };
  return {
    view: 'side',
    floor: 0.4,
    pose: (s) => {
      const shin = lerp(shin0, 200, s);
      return { torso, head: torso + 4, leg: { thigh: 90, shin, foot: shin - 90 }, arm: gripTo(shoulder, handle, BACK), anchor: 'hip', at: hip };
    },
    props: [
      // Backrest and seat, on a pedestal; the upright on the same base.
      { kind: 'bench', points: [behind(0.4), behind(0.06), { x: behind(0.06).x, y: PAD }, { x: hip.x + 0.16, y: PAD }], legs: false },
      { kind: 'line', from: { x: hip.x - 0.02, y: 0.05 }, to: { x: hip.x - 0.02, y: 0.4 }, width: 0.03 },
      { kind: 'line', from: { x: hip.x - 0.14, y: 0.392 }, to: { x: upright + 0.05, y: 0.392 }, width: 0.016 },
      { kind: 'line', from: { x: upright, y: 0.39 }, to: armTop, width: 0.03 },
      { kind: 'line', from: armTop, to: thighPad, width: 0.02 },
      { kind: 'bar', at: handle },
      { kind: 'pad', at: 'knee', offset: sub(thighPad, add(knee, { x: 0, y: -0.06 })) },
      // Roller on the back of the lower calves, just above the heels, turning with the shin.
      { kind: 'pad', at: 'ankle', frame: 'shin', offset: { x: -0.04, y: SKIN.calfLow + ROLLER } },
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
  // Ankle roller in the dip between the heels and the lower calves, touching both (as drawn), on a bracket rising from
  // the back of the foot plate.
  const roller = add(along(ankle, legDeg - 180, 0.05), along(O, legDeg + 90, 0.064));
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
      { kind: 'line', from: plateBack, to: roller, width: 0.02 },
      { kind: 'pad', at: 'ankle', offset: sub(roller, ankle) },
    ],
  };
}
