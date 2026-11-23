// Movement patterns: planks, the hollow hold, dead bugs, crunches, hanging raises and the cable crunch. Conventions and helpers: ./shared.ts.
//
// Bodies rest on the floor by their skin (BODY): a plank on the forearms and
// the balls of the feet with the toes bent flat, a face-up body (head to the
// LEFT) on its glutes, back and head, a kneeling body on its knees and toes.
// Hanging, the fists close around the bar and the body stays balanced under
// it. The spine curls (pose.bend) only where the exercise curls it on
// purpose: crunches, the hollow hold's dish and the pelvis tucking under at
// the top of a hanging raise.
import { BODY, FRONT_SKIN } from '../body';
import { skinPoints } from '../contact';
import { GRIP, L, PALM, add, angleOf, dir, gripTo, legTo, lerp, mul, palmTo, solve, sub, type Arm, type DemoPose, type Leg, type Vec } from '../figure';
import type { Demo } from '../types';
import { O, FLOOR, HANG, STAND, UP, centreOfMass, mixArm, mixLeg, solveFor } from './shared';

const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
/** Eases in and out over u = 0..1. */
const smooth = (u: number) => {
  const c = clamp01(u);
  return c * c * (3 - 2 * c);
};

/** Ball of the foot from the ankle for a foot pointing `foot` degrees (see ../figure). */
const ballFrom = (foot: number): Vec => add(mul(dir(foot), L.ball), mul(dir(foot + 90), L.ankleHeight));

/** The lowest skin point (largest y) of the parts of a pose that match (see ../contact). */
function lowest(p: DemoPose, parts: RegExp): number {
  const ys = skinPoints({ view: 'side', pose: () => p }, 0)
    .filter((sp) => parts.test(sp.part))
    .map((sp) => sp.p.y);
  return Math.max(...ys);
}

// ── Planks ───────────────────────────────────────────────────────────────

/**
 * Forearm plank, head to the right: forearms flat on the floor, elbows under
 * the shoulders, palms down, fingers forward; on the balls of the feet with
 * the toes bent flat on the floor. One straight line from the head to the
 * heels, the neck long and the eyes on the floor just ahead of the hands.
 */
export function plank(): Demo {
  const ball: Vec = { x: 0, y: FLOOR };
  /** The body line at `deg` from the balls of the feet (90 = level); the feet about square to the shins, as in a push-up. */
  const build = (deg: number, arm: Arm): DemoPose => {
    const foot = 135 + 0.4 * deg;
    return { torso: deg, head: deg, leg: { thigh: deg + 180, shin: deg + 180, foot, toes: 90 }, arm, anchor: 'ankle', at: sub(ball, ballFrom(foot)) };
  };
  // The elbow on the floor (its bone line a forearm's thickness up) with the upper arm upright under the shoulder.
  const elbowY = FLOOR - BODY.forearm;
  const deg = solveFor(60, 100, (d) => solve('side', build(d, HANG)).a.shoulder.y, elbowY - L.upperArm);
  const elbow: Vec = { x: solve('side', build(deg, HANG)).a.shoulder.x, y: elbowY };
  // The forearm flat along the floor (it thins toward the wrist), the palm flat ahead of it.
  const wristY = FLOOR - BODY.forearm + 0.003;
  const wrist: Vec = { x: elbow.x + Math.sqrt(L.forearm ** 2 - (wristY - elbowY) ** 2), y: wristY };
  const palmY = FLOOR - BODY.hand / 2;
  const palm: Vec = { x: wrist.x + Math.sqrt(PALM ** 2 - (palmY - wristY) ** 2), y: palmY };
  const pose = build(deg, { upper: 180, fore: angleOf(sub(wrist, elbow)), hand: angleOf(sub(palm, wrist)), flat: true });
  return { view: 'side', floor: FLOOR, pose: () => pose };
}

/**
 * Side plank, front view, facing the camera: on the left forearm and the
 * outside edge of the left foot, head to the right. The elbow sits under the
 * shoulder with the forearm on the floor angled toward the camera (so it
 * looks a little short), the feet are stacked, and the body makes one
 * straight line from the head to the feet with the hips lifted. The top hand
 * rests on the hip, elbow up.
 */
export function sidePlank(): Demo {
  // Front view, bone to skin on the outer side (see FRONT_SKIN): the edge of the foot, the point of the elbow.
  const FOOT_SIDE = FRONT_SKIN.foot;
  const ELBOW_SIDE = 0.03;
  const legLen = L.thigh + L.shin;
  /** A point in the body's frame, from the middle of the hips: u toward the head along the body at `t`, v across toward the floor (the left side). */
  const frame = (t: number, u: number, v: number): Vec => add(mul(dir(t), u), mul(dir(t + 90), v));
  // Feet stacked: the top ankle rests on the bottom one, so the straight legs close in a little toward the feet.
  const ankleU = -Math.sqrt(legLen ** 2 - (L.hipHalf - FOOT_SIDE) ** 2);
  // The body rises from the feet until the bottom elbow, under its shoulder, and the bottom foot both reach the floor.
  const footFloor = (t: number) => frame(t, ankleU, FOOT_SIDE).y + FOOT_SIDE;
  const elbowFloor = (t: number) => frame(t, L.torso, L.shoulderHalf).y + L.upperArm + ELBOW_SIDE;
  const t = solveFor(40, 89, (deg) => elbowFloor(deg) - footFloor(deg), 0);
  const shift: Vec = { x: 0, y: FLOOR - footFloor(t) };
  const p = (u: number, v: number) => add(frame(t, u, v), shift);
  const legDir = (side: -1 | 1) => angleOf(sub(p(ankleU, side * FOOT_SIDE), p(0, side * L.hipHalf)));
  const top = legDir(-1);
  const bottom = legDir(1);
  // Bottom arm: upper arm upright; the forearm on the floor angles forward and toward the head (about 45°), so it
  // shows at about 70% of its length, the fist resting on the floor.
  const elbow = add(p(L.torso, L.shoulderHalf), { x: 0, y: L.upperArm });
  const fist: Vec = { x: elbow.x + 0.7 * (L.forearm + GRIP), y: FLOOR - BODY.hand };
  const fore = angleOf(sub(fist, elbow));
  const foreScale = Math.hypot(fist.x - elbow.x, fist.y - elbow.y) / (L.forearm + GRIP);
  // Top hand flat on the side of the pelvis at the iliac crest, lying along it toward the feet (turned a little off the
  // body, as the hip widens below the crest), elbow pointing up.
  const palm = p(0.06, -(L.hipHalf + FRONT_SKIN.crest + BODY.hand / 2));
  const topArm = palmTo(p(L.torso, -L.shoulderHalf), palm, t + 185, dir(t - 90));
  const pose: DemoPose = {
    torso: t,
    head: t, // neck in line with the body
    leg: { thigh: top, shin: top, foot: 0 },
    leg2: { thigh: bottom, shin: bottom, foot: 0 },
    arm: topArm,
    arm2: { upper: 180, fore, foreScale },
    anchor: 'hip',
    at: p(0, -L.hipHalf),
  };
  // The bottom (left) side holds the body up; the top arm and leg rest.
  return { view: 'front', floor: FLOOR, pose: () => pose, working: 'b' };
}

// ── Lying face up ────────────────────────────────────────────────────────

/** Lying flat on the back: the trunk tilts until the glutes and the upper back both rest on the floor. */
function flatOnBack(): { torso: number; hip: Vec; shoulder: Vec } {
  const trunk = (t: number): DemoPose => ({ torso: t, leg: STAND, arm: HANG, anchor: 'hip', at: O });
  const torso = solveFor(255, 285, (t) => lowest(trunk(t), /^glutes$/) - lowest(trunk(t), /^upper trunk \(back\)$/), 0);
  const hip: Vec = { x: 0, y: FLOOR - lowest(trunk(torso), /^glutes$/) };
  return { torso, hip, shoulder: solve('side', { ...trunk(torso), at: hip }).a.shoulder };
}

/** Direction from the shoulder to the head when the back of the head rests on the floor. */
function headOnFloor(shoulder: Vec): number {
  const dy = FLOOR - BODY.head - shoulder.y;
  return angleOf({ x: -Math.sqrt(L.neck ** 2 - dy ** 2), y: dy });
}

/**
 * Hollow body hold, face up: the pelvis tucked so the lower back presses
 * into the floor, the upper back curled up until the shoulder blades are off
 * it, chin slightly tucked; straight legs with pointed toes and the arms long
 * overhead by the ears, hands and feet a hand's width or two off the floor: a
 * shallow dish resting on the lower back.
 */
export function hollowHold(): Demo {
  const torso = 262; // lower trunk: the hips a little higher than the small of the back
  const bend = 30; // upper back curled up off the floor
  const upper = torso + bend;
  const legs = 78; // about 12° above the floor
  const arms = 282; // overhead, about 12° above the floor
  const p: DemoPose = {
    torso,
    bend,
    head: upper + 8,
    leg: { thigh: legs, shin: legs, foot: legs - 45 },
    arm: { upper: arms, fore: arms, hand: arms, flat: true },
    anchor: 'hip',
    at: O,
  };
  // Resting on the lower back.
  const pose: DemoPose = { ...p, at: { x: 0, y: FLOOR - lowest(p, /trunk \(back\)|^glutes$/) } };
  return { view: 'side', floor: FLOOR, pose: () => pose };
}

/**
 * Dead bug, face up: back flat on the floor, head down, arms straight up
 * over the shoulders, hips and knees at 90° with the shins level. The near
 * leg straightens out until the heel hovers just off the floor while the
 * opposite (far) arm reaches back overhead to hover above the floor; the
 * other two limbs and the back stay where they are.
 */
export function deadBug(): Demo {
  const { torso, hip, shoulder } = flatOnBack();
  const head = headOnFloor(shoulder);
  const up: Arm = { upper: 0, fore: 0, hand: 0, flat: true }; // straight up, fingers to the ceiling
  const table: Leg = { thigh: 0, shin: 90, foot: 0 }; // thighs upright, shins level, feet relaxed
  const pose = (leg: Leg, arm2: Arm): DemoPose => ({ torso, head, leg, leg2: table, arm: up, arm2, anchor: 'hip', at: hip });
  // Out: the near leg long (knee nearly straight), lowered until the heel is a few centimetres off the floor.
  const longLeg = (deg: number): Leg => ({ thigh: deg, shin: deg + 3, foot: deg + 3 - 90 });
  const hover = FLOOR - 0.022;
  const legDeg = solveFor(80, 100, (d) => lowest(pose(longLeg(d), up), /^near (shin|thigh|heel|ball|toe)/), hover);
  // Out: the far arm straight overhead, lowered until the hand is just off the floor.
  const reachArm = (deg: number): Arm => ({ upper: deg, fore: deg, hand: deg, flat: true });
  const armDeg = solveFor(255, 285, (d) => -lowest(pose(table, reachArm(d)), /^far (hand|forearm|upper arm)/), -hover);
  return {
    view: 'side',
    floor: FLOOR,
    pose: (s) => pose(mixLeg(table, longLeg(legDeg), s), mixArm(up, reachArm(armDeg), s)),
    // Slow and controlled both ways, a brief hold with the limbs long.
    timing: { out: 2, far: 0.5, back: 2 },
  };
}

/**
 * Crunch, face up: knees bent about 90° with the feet flat, arms crossed on
 * the chest, head and shoulders resting on the floor. The upper back curls
 * up until the shoulder blades leave the floor, the chin a fist's width from
 * the chest; the lower back and the feet stay down.
 */
export function crunch(): Demo {
  const { torso, hip, shoulder } = flatOnBack();
  // Feet flat on the floor, knees bent to about 90° (hip to ankle a little over a thigh's length apart).
  const ankleY = FLOOR - L.ankleHeight;
  const span = Math.sqrt(L.thigh ** 2 + L.shin ** 2);
  const leg = legTo(hip, { x: hip.x + Math.sqrt(span ** 2 - (ankleY - hip.y) ** 2), y: ankleY }, UP);
  // The head starts resting on the floor, the neck a little long; at the top it is tucked toward the chest.
  const headStart = ((headOnFloor(shoulder) - torso + 540) % 360) - 180;
  const curl = 34; // the upper back curls this far at the top
  return {
    view: 'side',
    floor: FLOOR,
    pose: (s) => {
      const bend = curl * s;
      const upper = torso + bend;
      return {
        torso,
        bend,
        head: upper + lerp(headStart, 14, s),
        leg,
        // Arms crossed on the chest: elbow over the lower ribs, fist at the opposite collarbone.
        arm: { upper: upper + 144, fore: upper - 6, scale: 0.9 },
        anchor: 'hip',
        at: hip,
      };
    },
    // A short squeeze at the top.
    timing: { far: 0.6 },
  };
}

// ── Hanging ──────────────────────────────────────────────────────────────

/**
 * Hanging knee raise (with `straight` legs, the hanging leg raise): a dead
 * hang from a bar, overhand grip, arms straight. The knees come up past hip
 * height with the shins hanging (straight legs: to level), and at the top
 * the pelvis tucks under; then the legs lower under control. No swing: as
 * the legs come up the hips move back, so the body stays balanced under the
 * bar.
 */
export function hangingRaise(o: { straight?: boolean }): Demo {
  const bar = O;
  // Straight arm: the shoulder this far from the middle of the fist.
  const reach = L.upperArm + L.forearm + GRIP;
  // At the top: hip and knee bend, and how far the pelvis tucks under (spine flexion).
  const top = o.straight ? { hip: 112, knee: 4, tuck: 16 } : { hip: 112, knee: 96, tuck: 20 };
  /** The body at progress s with the upper trunk at `upper` degrees (0 = upright under the shoulders). */
  const build = (s: number, upper: number): DemoPose => {
    const bend = top.tuck * smooth((s - 0.4) / 0.6); // the tuck comes in over the last part of the raise
    const torso = upper - bend;
    const thigh = torso + 180 - top.hip * s;
    // Knee raise: the shins hang straight down until the knees are bent to the top's angle.
    const knee = o.straight ? top.knee * s : Math.min(top.knee, Math.max(0, 180 - thigh));
    const shin = thigh + knee;
    // The arms tilt a little with the body (lats pressing the bar down), so the shoulders end slightly behind the bar.
    const arm = 0.3 * upper;
    return {
      torso,
      bend,
      head: upper * 0.4, // eyes forward
      leg: { thigh, shin, foot: shin - 45 }, // feet relaxed, toes pointed
      arm: { upper: arm, fore: arm },
      anchor: 'shoulder',
      at: sub(bar, mul(dir(arm), reach)),
    };
  };
  // The trunk tilts (hips back) until the centre of mass hangs under the bar.
  const pose = (s: number) => build(s, solveFor(-30, 60, (u) => -centreOfMass(solve('side', build(s, u))).x, -bar.x));
  // A wall-mounted bar: its bracket stands out from the wall behind the lifter, clear of the hips as they move back;
  // the floor a hand's width under the pointed toes.
  const skin = [0, 0.25, 0.5, 0.75, 1].flatMap((s) => skinPoints({ view: 'side', pose }, s));
  const floor = Math.max(...skin.map((sp) => sp.p.y)) + 0.08;
  const wall = Math.min(...skin.map((sp) => sp.p.x)) - 0.12;
  return {
    view: 'side',
    floor,
    pose,
    props: [
      { kind: 'wall', x: wall, top: bar.y - 0.12 },
      { kind: 'line', from: { x: wall, y: bar.y - 0.035 }, to: { x: wall, y: bar.y + 0.035 }, width: 0.014 },
      { kind: 'line', from: { x: wall, y: bar.y }, to: bar, width: 0.024 },
      { kind: 'bar', at: bar },
    ],
    // Up under control, a brief pause, a slow lowering with no swing.
    timing: { out: 1.4, far: 0.5, back: 2.2 },
  };
}

// ── Kneeling ─────────────────────────────────────────────────────────────

/** Kneeling: the knee joint this far above the floor, the kneecap on it. */
const KNEEL = 0.05;

/**
 * Cable crunch: kneeling facing a high pulley, toes tucked, hips high over
 * the knees, the rope held at the sides of the head. The spine curls,
 * bringing the ribs toward the hips and the elbows down toward the thighs;
 * the hips stay nearly still (no sitting back toward the heels) and the arms
 * only hold the rope.
 */
export function cableCrunch(): Demo {
  const knee: Vec = { x: 0, y: FLOOR - KNEEL };
  // Toes tucked: the ball of the foot on the floor behind the knee, toes flat, the shin rising a little to the ankle.
  const foot = 185;
  const rise = KNEEL - ballFrom(foot).y;
  const shin = angleOf({ x: -Math.sqrt(L.shin ** 2 - rise ** 2), y: rise });
  const body = (s: number): DemoPose => {
    const torso = lerp(16, 30, s); // the hips bend only a little
    const bend = 64 * s; // the spine curls
    const upper = torso + bend;
    return {
      torso,
      bend,
      head: upper + 8 + 10 * s, // chin tucks as the spine curls
      leg: { thigh: lerp(178, 172, s), shin, foot, toes: 90 },
      arm: HANG,
      anchor: 'knee',
      at: knee,
    };
  };
  // The fists hold the rope ends beside the head, a little in front of the ears; elbows down and in front.
  const pose = (s: number): DemoPose => {
    const p = body(s);
    const f = solve('side', p);
    const headDir = p.head ?? f.upper;
    const hand = add(add(f.head, mul(dir(headDir + 90), 0.02)), mul(dir(headDir + 180), 0.015));
    return { ...p, arm: gripTo(f.a.shoulder, hand, dir(f.upper + 140)) };
  };
  // The high pulley on an arm out over the lifter (as on a crossover or pulldown tower): the cable runs a little
  // forward of vertical at the start and about straight up at the bottom; the tower stands clear of the head.
  let ahead = -Infinity;
  for (let k = 0; k <= 10; k++) {
    const f = solve('side', pose(k / 10));
    ahead = Math.max(ahead, f.head.x + BODY.head, f.a.hand.x + BODY.hand, f.a.knee.x + BODY.thighFront);
  }
  const start = solve('side', pose(0)).a.hand;
  const pulleyY = FLOOR - 1.25;
  const pulley: Vec = { x: start.x + (start.y - pulleyY) * Math.tan((10 * Math.PI) / 180), y: pulleyY };
  const tower = Math.max(ahead + 0.06, pulley.x + 0.1);
  return {
    view: 'side',
    floor: FLOOR,
    pose,
    props: [
      // The tower's base plate on the floor.
      { kind: 'line', from: { x: tower - 0.08, y: FLOOR - 0.008 }, to: { x: tower + 0.08, y: FLOOR - 0.008 }, width: 0.016 },
      // The cable comes down behind the head to the rope's middle; the rope runs down beside the head into the fist.
      { kind: 'cable', from: pulley, at: 'wrist', rope: true, column: tower, behind: true },
    ],
    // A short squeeze at the bottom.
    timing: { far: 0.5 },
  };
}
