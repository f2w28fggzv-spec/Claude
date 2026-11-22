// Movement patterns: bridges and hip thrusts, side-lying hip abduction, calf raises. Conventions and helpers: ./shared.ts.
import { BODY } from '../body';
import { PAD_HALF } from '../contact';
import { L, add, along, angleOf, dir, gripTo, legTo, lerp, mul, palmTo, sub, type Arm, type DemoPose, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { FLOOR, HANG, UP, DOWN, BACK, handProp, type Implement } from './shared';

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

// ── Bridges and hip thrusts ──────────────────────────────────────────────
// Face up, head to the left. `tilt` is how far the line from the shoulders to
// the hips rises toward the hips; the lower trunk then points 270 - tilt
// (hip → shoulder) and the body line 90 - tilt (shoulder → hip).

/** The drawn bar's radius, and a dumbbell handle's. */
const BAR_R = 0.02;
const HANDLE_R = 0.015;

/** Shoulder joint with the upper back on the floor while the trunk tilts up toward the hips. */
const floorShoulder = (floor: number, tilt: number): Vec => ({ x: 0, y: floor - BODY.torsoBack * Math.cos(rad(tilt)) });

/** Tilt that lifts the point `reach` along the body line from the shoulder to `height` above the floor. */
function tiltFor(height: number, reach: number): number {
  // torsoBack·cos t + reach·sin t = height
  return deg(Math.asin(height / Math.hypot(BODY.torsoBack, reach)) - Math.atan2(BODY.torsoBack, reach));
}

/** Direction from the shoulder to the head when the back of the head rests on the floor. */
function headOnFloor(shoulder: Vec, floor: number): number {
  const dy = floor - BODY.head - shoulder.y;
  return angleOf({ x: -Math.sqrt(L.neck ** 2 - dy ** 2), y: dy });
}

/**
 * Where a bar or a dumbbell handle of radius `r` rests in the hip crease:
 * on the bisector of the hip angle, touching the front of the hips and thighs.
 */
function inCrease(hip: Vec, torso: number, thigh: number, r: number): Vec {
  const angle = (((thigh - torso) % 360) + 360) % 360;
  const skin = (BODY.torsoFront + BODY.thighFront) / 2;
  return along(hip, torso + angle / 2, (skin + r) / Math.sin(rad(angle / 2)));
}

/** Hands on the load in the hip crease (elbows up and out), or palms flat on the floor by the hips. */
function bridgeArm(shoulder: Vec, hip: Vec, torso: number, thigh: number, implement: Implement, palm: Vec): Arm {
  if (implement === 'none') return palmTo(shoulder, palm, 90, UP);
  return gripTo(shoulder, inCrease(hip, torso, thigh, implement === 'barbell' ? BAR_R : HANDLE_R), UP);
}

/** The load in the hands; a barbell's plate is drawn behind the lifter. */
const loadProps = (implement: Implement): Prop[] =>
  implement === 'barbell' ? [{ kind: 'barbell', at: 'wrist' }] : implement === 'dumbbell' || implement === 'kettlebell' ? [{ kind: 'dumbbell', at: 'wrist' }] : [];

export function bridge(o: { onBench: boolean; implement?: Implement; singleLeg?: boolean; slider?: boolean }): Demo {
  if (o.slider) return sliderLegCurl();
  if (o.onBench) return hipThrust(o.implement ?? 'none');
  return floorBridge(o.implement ?? 'none', !!o.singleLeg);
}

/**
 * Glute bridge: shoulders, head and feet stay on the floor; the hips rise from
 * resting on the floor until shoulders, hips and knees form a straight line,
 * shins about vertical. Single leg: the free leg straight, its thigh level
 * with the working one.
 */
function floorBridge(implement: Implement, singleLeg: boolean): Demo {
  const floor = FLOOR;
  // Top: knees on the body line, feet flat a little ahead of the knees.
  const shinLean = 5;
  const top = tiltFor(L.ankleHeight + L.shin * Math.cos(rad(shinLean)), L.torso + L.thigh);
  const knee = along(floorShoulder(floor, top), 90 - top, L.torso + L.thigh);
  const ankle: Vec = { x: knee.x + L.shin * Math.sin(rad(shinLean)), y: floor - L.ankleHeight };
  // Bottom: hips resting on the floor, the glutes just touching it.
  const bottom = deg(Math.atan2(BODY.glute - BODY.torsoBack, L.torso));
  // Palms flat on the floor beside the hips.
  const palm: Vec = { x: 0.36, y: floor - BODY.hand / 2 };
  const pose = (s: number): DemoPose => {
    const tilt = lerp(bottom, top, s);
    const shoulder = floorShoulder(floor, tilt);
    const hip = along(shoulder, 90 - tilt, L.torso);
    const leg = legTo(hip, ankle, UP);
    return {
      torso: 270 - tilt,
      head: headOnFloor(shoulder, floor),
      leg,
      leg2: singleLeg ? { thigh: leg.thigh, shin: leg.thigh, foot: leg.thigh - 95 } : undefined,
      arm: bridgeArm(shoulder, hip, 270 - tilt, leg.thigh, implement, palm),
      anchor: 'shoulder',
      at: shoulder,
    };
  };
  return { view: 'side', floor, pose, props: loadProps(implement), pauseFar: 0.3 };
}

/**
 * Slider leg curl: hips held off the floor, heels on sliders, toes up. From
 * legs nearly straight, pull the heels in until the knees are bent and the
 * hips fully extended (the top of a bridge), then slide them back out.
 */
function sliderLegCurl(): Demo {
  const floor = FLOOR;
  // Heel on the floor with the toes up: how high the ankle sits for a foot direction.
  const ankleUp = (foot: number) => L.heel * Math.cos(rad(foot)) + L.ankleHeight * Math.sin(rad(foot));
  // Start: hips just off the floor, knees almost straight (172°), toes pointing up.
  const tilt0 = 7;
  const foot0 = 10;
  const hip0 = along(floorShoulder(floor, tilt0), 90 - tilt0, L.torso);
  const reach = Math.sqrt(L.thigh ** 2 + L.shin ** 2 - 2 * L.thigh * L.shin * Math.cos(rad(172)));
  const y0 = floor - ankleUp(foot0);
  const x0 = hip0.x + Math.sqrt(reach ** 2 - (y0 - hip0.y) ** 2);
  // Turnaround: knees on the body line, shins about vertical, toes pulled up.
  const foot1 = 62;
  const shinLean = 5;
  const tilt1 = tiltFor(ankleUp(foot1) + L.shin * Math.cos(rad(shinLean)), L.torso + L.thigh);
  const x1 = along(floorShoulder(floor, tilt1), 90 - tilt1, L.torso + L.thigh).x + L.shin * Math.sin(rad(shinLean));
  const palm: Vec = { x: 0.36, y: floor - BODY.hand / 2 };
  return {
    view: 'side',
    floor,
    pose: (s) => {
      const tilt = lerp(tilt0, tilt1, s);
      const foot = lerp(foot0, foot1, s);
      const shoulder = floorShoulder(floor, tilt);
      const hip = along(shoulder, 90 - tilt, L.torso);
      const ankle: Vec = { x: lerp(x0, x1, s), y: floor - ankleUp(foot) };
      return {
        torso: 270 - tilt,
        head: headOnFloor(shoulder, floor),
        leg: legTo(hip, ankle, UP, foot),
        arm: palmTo(shoulder, palm, 90, UP),
        anchor: 'shoulder',
        at: shoulder,
      };
    },
  };
}

/**
 * Hip thrust: the upper back across the side of a bench (seen end-on, its
 * length running away from the camera), feet flat, the load in the hip crease.
 * The trunk rolls over the bench edge from hips low (hip angle about 95°) to a
 * straight line from the shoulders to the knees, level with the floor, shins
 * about vertical. Chin tucked, eyes forward.
 */
function hipThrust(implement: Implement): Demo {
  const floor = FLOOR;
  const shinLean = 4;
  // At the top the trunk lies level at the height of the knees.
  const level = floor - L.ankleHeight - L.shin * Math.cos(rad(shinLean));
  // The pad's rounded edge on the lifter's side; the back rolls over it.
  const touch = BODY.torsoBack + PAD_HALF;
  const edge: Vec = { x: 0, y: level + touch };
  // The edge meets the back just under the shoulder blades, this far below the shoulder joint.
  const blades = 0.075;
  /** Trunk with the hips `drop` degrees below the shoulders, its back on the bench edge. */
  const trunk = (drop: number) => {
    const torso = 270 + drop;
    const onLine = sub(edge, mul(dir(torso - 90), touch));
    return { torso, shoulder: along(onLine, torso, blades), hip: along(onLine, torso + 180, L.torso - blades) };
  };
  const knee = along(trunk(0).hip, 90, L.thigh);
  const ankle = along(knee, 180 - shinLean, L.shin);
  const pose = (s: number): DemoPose => {
    const { torso, shoulder, hip } = trunk(lerp(42, 0, s));
    const leg = legTo(hip, ankle, UP);
    return {
      torso,
      head: torso + 28,
      leg,
      arm: bridgeArm(shoulder, hip, torso, leg.thigh, implement, { x: 0, y: 0 }),
      anchor: 'shoulder',
      at: shoulder,
    };
  };
  // A flat bench from its end: the pad on an upright with a foot on the floor.
  const post = edge.x - 0.065;
  const bench: Prop[] = [
    { kind: 'bench', points: [{ x: edge.x - 0.13, y: edge.y }, edge], legs: false },
    { kind: 'line', from: { x: post, y: edge.y + PAD_HALF }, to: { x: post, y: floor - 0.01 }, width: 0.03 },
    { kind: 'line', from: { x: post - 0.11, y: floor - 0.008 }, to: { x: post + 0.11, y: floor - 0.008 }, width: 0.016 },
  ];
  return { view: 'side', floor, pose, props: [...bench, ...loadProps(implement)], pauseFar: 0.3 };
}

// ── Side-lying hip abduction ─────────────────────────────────────────────

/**
 * Front view, lying on the left side, head to the right, body in one line.
 * The bottom arm stretches overhead along the floor as a pillow; the top hand
 * rests on the hip. The top leg lifts straight from resting on the bottom leg
 * to about 40° above level.
 */
export function sideLyingAbduction(): Demo {
  // The shoulders are wider than the hips: the trunk rises a little toward them.
  const torso = 81;
  const across = dir(torso + 90); // from the top side to the bottom side
  // Bone to the floor (front view): hip, shoulder and ankle on their outer side, the arm.
  const HIP_SIDE = 0.05;
  const ANKLE_SIDE = 0.035;
  const ARM_SIDE = 0.035;
  const hipC: Vec = { x: 0, y: 0 };
  const hipTop = sub(hipC, mul(across, L.hipHalf));
  const hipBottom = add(hipC, mul(across, L.hipHalf));
  const shC = along(hipC, torso, L.torso);
  const shTop = sub(shC, mul(across, L.shoulderHalf));
  const shBottom = add(shC, mul(across, L.shoulderHalf));
  const floor = hipBottom.y + HIP_SIDE;
  const legLen = L.thigh + L.shin;
  /** Straight leg from `hip` toward the feet (image left), its ankle at height y. */
  const toward = (hip: Vec, y: number) => 270 - deg(Math.asin((y - hip.y) / legLen));
  const bottomLeg = toward(hipBottom, floor - ANKLE_SIDE);
  // Top leg at rest: its ankle on the bottom ankle.
  const rest = toward(hipTop, floor - 3 * ANKLE_SIDE);
  // Head resting on the bottom arm's upper arm.
  const headY = floor - 2 * ARM_SIDE - BODY.head;
  const head = angleOf({ x: Math.sqrt(L.neck ** 2 - (headY - shC.y) ** 2), y: headY - shC.y });
  const pillow = 90 + deg(Math.asin((floor - ARM_SIDE - shBottom.y) / L.upperArm));
  // Top hand flat on the side of the pelvis, fingers toward the feet, elbow up.
  const palm = sub(along(hipTop, torso, 0.06), mul(across, HIP_SIDE + BODY.hand / 2));
  const topArm = palmTo(shTop, palm, torso + 180, mul(across, -1));
  // Place the figure so the floor is at FLOOR.
  const at = add(hipTop, { x: 0, y: FLOOR - floor });
  return {
    view: 'front',
    floor: FLOOR,
    pose: (s) => {
      const lift = rest + 45 * s;
      return {
        torso,
        head,
        leg: { thigh: lift, shin: lift, foot: 0 },
        leg2: { thigh: bottomLeg, shin: bottomLeg, foot: 0 },
        arm: topArm,
        arm2: { upper: pillow, fore: 90, hand: 90, flat: true },
        anchor: 'hip',
        at,
      };
    },
  };
}

// ── Calf raises ──────────────────────────────────────────────────────────
// The foot is one rigid piece from heel to toe tip. Rising onto the balls of
// the feet turns it about the toe tip on the floor, or about the ball of the
// foot on a platform's edge.

/** Ankle of a foot pointing `foot` degrees whose sole passes through `pivot`, `ahead` of the ankle along the sole. */
const ankleFrom = (pivot: Vec, foot: number, ahead: number): Vec => sub(sub(pivot, mul(dir(foot), ahead)), mul(dir(foot + 90), L.ankleHeight));

/** Arms hanging relaxed at the sides, elbows soft. */
const RELAXED: Arm = { upper: 183, fore: 175 };
const STANDING = L.shin + L.thigh + L.torso;

export function calfRaise(o: { implement?: Implement; single?: boolean; seated?: boolean; machine?: boolean }): Demo {
  if (o.seated) return seatedCalfRaise();
  if (o.machine) return machineCalfRaise();
  return standingCalfRaise(o.implement ?? 'none', !!o.single);
}

/**
 * Standing calf raise on the floor: tall, knees straight, rise onto the balls
 * of the feet (heels about 30° up), pause, lower the heels to the floor. The
 * body rides up and a little forward, staying balanced over the forefoot.
 * Single leg: the free knee bent with the foot behind, one hand on a wall.
 */
function standingCalfRaise(implement: Implement, single: boolean): Demo {
  const toe: Vec = { x: L.foot, y: FLOOR }; // toe tip on the floor; the ankle starts at the origin
  // Single leg: one hand flat on a wall at chest height, fingers up.
  const palm: Vec = { x: 0.29, y: -STANDING + 0.06 };
  return {
    view: 'side',
    pose: (s) => {
      const foot = lerp(90, 122, s);
      const ankle = ankleFrom(toe, foot, L.foot);
      const shoulder: Vec = { x: ankle.x, y: ankle.y - STANDING };
      return {
        torso: 0,
        leg: { thigh: 180, shin: 180, foot },
        leg2: single ? { thigh: 172, shin: 245, foot: 165 } : undefined,
        arm: single ? palmTo(shoulder, palm, 0, DOWN) : implement === 'none' ? RELAXED : HANG,
        arm2: single ? RELAXED : undefined,
        anchor: 'toe',
        at: toe,
      };
    },
    props: single ? [{ kind: 'wall', x: palm.x + BODY.hand / 2 + 0.05, top: -STANDING - 0.3 }] : handProp(implement),
    pauseFar: 0.5,
  };
}

/**
 * Seated calf raise: on a bench, thighs level and shins vertical, a dumbbell
 * stood on end on each lower thigh and steadied by the hands. Rise onto the
 * balls of the feet (the knees and dumbbells lift), pause, lower.
 */
function seatedCalfRaise(): Demo {
  const hip: Vec = { x: 0, y: FLOOR - L.ankleHeight - L.shin };
  const toe: Vec = { x: L.thigh + L.foot, y: FLOOR }; // the ankle starts under the knee
  const torso = 12;
  const shoulder = along(hip, torso, L.torso);
  // The bench pad's centre line: its top just under the back of the thighs.
  const seat = hip.y + BODY.thighBack + PAD_HALF;
  /** Half the height of a dumbbell stood on end (see ../equipment). */
  const DB_HALF = 0.062;
  return {
    view: 'side',
    pose: (s) => {
      const foot = lerp(90, 122, s);
      const leg = legTo(hip, ankleFrom(toe, foot, L.foot), UP, foot);
      // Its lower head sits on the thigh just above the knee; the hand holds the handle.
      const base = along(along(hip, leg.thigh, L.thigh * 0.78), leg.thigh - 90, BODY.thighFront);
      const db: Vec = { x: base.x, y: base.y - DB_HALF };
      return { torso, head: 6, leg, arm: gripTo(shoulder, db, BACK), anchor: 'hip', at: hip };
    },
    props: [
      { kind: 'bench', points: [{ x: -0.42, y: seat }, { x: 0.1, y: seat }] },
      { kind: 'dumbbell', at: 'wrist', upright: true },
    ],
    pauseFar: 0.5,
  };
}

/**
 * Standing calf machine: shoulders under the pads, hands on the handles, the
 * balls of the feet on the platform's edge. Lower the heels below the platform
 * for a stretch, then rise as high as possible. The pads ride a carriage on
 * the machine's column, so the shoulders move straight up.
 */
function machineCalfRaise(): Demo {
  const step = 0.06; // platform height
  const edge: Vec = { x: 0, y: FLOOR - step }; // the ball of the foot pivots on the platform's back edge
  const ball = 0.02; // the pivot is this far behind the toe tip
  const ankleAt = (foot: number) => ankleFrom(edge, foot, L.foot - ball);
  const low = 75; // heels 15° below the platform
  const high = 120; // heels 30° above it
  const shoulderX = (ankleAt(low).x + ankleAt(high).x) / 2;
  const column = edge.x + 0.24;
  const handle: Vec = { x: 0.11, y: -0.04 }; // on the carriage, in front of the shoulder
  const pose = (s: number): DemoPose => {
    const foot = lerp(low, high, s);
    const ankle = ankleAt(foot);
    // Body straight from ankle to shoulder, the shoulders kept under the pads.
    const lean = deg(Math.asin((shoulderX - ankle.x) / STANDING));
    const shoulder = along(ankle, lean, STANDING);
    return {
      torso: lean,
      head: 0,
      leg: { thigh: 180 + lean, shin: 180 + lean, foot },
      arm: gripTo(shoulder, add(shoulder, handle), { x: 0.2, y: 1 }),
      anchor: 'ankle',
      at: ankle,
    };
  };
  const top = along(ankleAt(high), 0, STANDING);
  return {
    view: 'side',
    pose,
    props: [
      { kind: 'box', x: edge.x, y: edge.y, w: column - edge.x, h: step },
      { kind: 'line', from: { x: column, y: FLOOR - 0.01 }, to: { x: column, y: top.y - 0.25 }, width: 0.04 },
      { kind: 'attached', at: 'shoulder', from: { x: -0.01, y: handle.y }, to: { x: column - shoulderX, y: handle.y }, width: 0.024 },
      { kind: 'pad', at: 'shoulder', offset: { x: -0.012, y: -0.075 } },
    ],
    pauseFar: 0.5,
  };
}
