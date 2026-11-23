// Movement patterns: bridges and hip thrusts, side-lying hip abduction, calf raises. Conventions and helpers: ./shared.ts.
//
// Bodies rest on the floor and the bench with the skin from BODY, hands close
// around what they hold or lie flat, and planted feet stay put: calf raises
// turn each foot about the ball with the toes flat.
import { BODY, FRONT_SKIN } from '../body';
import { PAD_HALF } from '../contact';
import { GRIP, L, PALM, add, along, angleOf, dir, dist, gripTo, legTo, lerp, mul, palmTo, solve, sub, type Arm, type DemoPose, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { FLOOR, HANG, UP, DOWN, BACK, centreOfMass, solveFor, type Implement } from './shared';

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

// ── Arms ─────────────────────────────────────────────────────────────────

/**
 * An arm lying on the floor beside the body, palm down: the upper arm and the
 * forearm rest on the floor and the hand lies flat by the hips. Worked out
 * from the shoulder at rest; the palm then stays planted.
 */
function armOnFloor(shoulder: Vec, floor: number): { palm: Vec; hand: number } {
  const elbowY = floor - BODY.upperArm;
  const elbow: Vec = { x: shoulder.x + Math.sqrt(L.upperArm ** 2 - (elbowY - shoulder.y) ** 2), y: elbowY };
  // The forearm thins toward the wrist, so its bone line dips a little there.
  const wristY = floor - BODY.forearm + 0.003;
  const wrist: Vec = { x: elbow.x + Math.sqrt(L.forearm ** 2 - (wristY - elbowY) ** 2), y: wristY };
  const palmY = floor - BODY.hand / 2;
  const palm: Vec = { x: wrist.x + Math.sqrt(PALM ** 2 - (palmY - wristY) ** 2), y: palmY };
  return { palm, hand: angleOf(sub(palm, wrist)) };
}

/**
 * A fist around `grip` with the elbow bent out to the side, `flare` degrees
 * from the picture toward the camera (0 = in the picture, toward `toward`).
 * Seen from the side such an arm looks shorter, as it does in a photo.
 */
function flaredGrip(shoulder: Vec, grip: Vec, toward: Vec, flare: number): Arm {
  const a = L.upperArm;
  const b = L.forearm + GRIP;
  const d = Math.min(a + b - 1e-6, dist(shoulder, grip));
  const u = mul(sub(grip, shoulder), 1 / dist(shoulder, grip));
  // The elbow lies on a circle around the shoulder–fist line: its centre this far along the line, this wide.
  const t = (a * a - b * b + d * d) / (2 * d);
  const r = Math.sqrt(Math.max(0, a * a - t * t));
  const side = { x: -u.y, y: u.x };
  const n = side.x * toward.x + side.y * toward.y >= 0 ? side : mul(side, -1);
  const elbow = add(add(shoulder, mul(u, t)), mul(n, r * Math.cos(rad(flare))));
  const upper = sub(elbow, shoulder);
  const fore = sub(grip, elbow);
  return { upper: angleOf(upper), fore: angleOf(fore), scale: Math.hypot(upper.x, upper.y) / a, foreScale: Math.hypot(fore.x, fore.y) / b };
}

// ── Bridges and hip thrusts ──────────────────────────────────────────────
// Face up, head to the left. `tilt` is how far the line from the shoulders to
// the hips rises toward the hips; the lower trunk then points 270 - tilt
// (hip → shoulder) and the body line 90 - tilt (shoulder → hip).

/** The drawn bar's radius, and a dumbbell handle's. */
const BAR_R = 0.02;
const HANDLE_R = 0.015;
/** Elbows bent out to the sides when the hands hold a load on the hips. */
const FLARE = 50;

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
 * How far the drawn front of the body (outline included) lies from the trunk
 * and thigh lines where a load in the hip crease touches it: in a deep crease
 * (hip angle 90°) it rests on the lower belly and the upper thigh, once the
 * hips are straight (180°) on the front of the pelvis over the hip joint, which
 * is thinner. Measured on the drawn figure.
 */
const CREASE_DEEP = 0.0617;
const CREASE_STRAIGHT = 0.0505;

/**
 * Where a bar or a dumbbell handle of radius `r` rests in the hip crease:
 * on the bisector of the hip angle, touching the front of the hips and thighs.
 */
function inCrease(hip: Vec, torso: number, thigh: number, r: number): Vec {
  const angle = (((thigh - torso) % 360) + 360) % 360;
  const skin = lerp(CREASE_STRAIGHT, CREASE_DEEP, (180 - angle) / 90);
  return along(hip, torso + angle / 2, (skin + r) / Math.sin(rad(angle / 2)));
}

/** Hands on the load in the hip crease, elbows out to the sides. */
const loadArm = (shoulder: Vec, hip: Vec, torso: number, thigh: number, implement: Implement): Arm =>
  flaredGrip(shoulder, inCrease(hip, torso, thigh, implement === 'barbell' ? BAR_R : HANDLE_R), UP, FLARE);

/** The load in the hands: a barbell (its plate drawn behind the lifter) or a dumbbell across the hips, seen end-on. */
const loadProps = (implement: Implement): Prop[] =>
  implement === 'barbell' ? [{ kind: 'barbell', at: 'wrist' }] : implement === 'dumbbell' || implement === 'kettlebell' ? [{ kind: 'dumbbell', at: 'wrist' }] : [];

export function bridge(o: { onBench: boolean; implement?: Implement; singleLeg?: boolean; slider?: boolean }): Demo {
  if (o.slider) return sliderLegCurl();
  if (o.onBench) return hipThrust(o.implement ?? 'none');
  return floorBridge(o.implement ?? 'none', !!o.singleLeg);
}

/**
 * Glute bridge: shoulders, head, feet and arms stay on the floor; the hips
 * rise from resting on the floor until shoulders, hips and knees form a
 * straight line, shins about vertical. Single leg: the free leg straight, its
 * thigh level with the working one.
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
  // Arms long on the floor by the sides, palms down.
  const { palm, hand } = armOnFloor(floorShoulder(floor, bottom), floor);
  const pose = (s: number): DemoPose => {
    const tilt = lerp(bottom, top, s);
    const shoulder = floorShoulder(floor, tilt);
    const hip = along(shoulder, 90 - tilt, L.torso);
    const leg = legTo(hip, ankle, UP);
    return {
      torso: 270 - tilt,
      head: headOnFloor(shoulder, floor),
      leg,
      // Free leg straight along the working thigh, the foot relaxed.
      leg2: singleLeg ? { thigh: leg.thigh, shin: leg.thigh, foot: leg.thigh - 95 } : undefined,
      arm: implement === 'none' ? palmTo(shoulder, palm, hand, DOWN) : loadArm(shoulder, hip, 270 - tilt, leg.thigh, implement),
      anchor: 'shoulder',
      at: shoulder,
    };
  };
  // Single leg: the near leg works, the free leg's muscles stay near rest.
  return { view: 'side', floor, pose, props: loadProps(implement), pauseFar: 0.3, ...(singleLeg && { working: 'a' as const }) };
}

/**
 * Slider leg curl: heels on sliders, toes up, arms on the floor. From the hips
 * just off the floor and the legs long (knees almost straight), pull the heels
 * in until the knees are bent and the hips fully extended (the top of a
 * bridge), then slide them back out. The heels ride the sliders.
 */
function sliderLegCurl(): Demo {
  const floor = FLOOR;
  // A slider (a flat disc) under each heel.
  const SLIDER = 0.008;
  // Legs long: toes up and a little away. Heels in: toes pulled up toward the shins. Over that range the
  // heel point (heel·cos + ankleHeight·sin of the foot below the ankle) stays within 2 mm of its deepest,
  // so the ankle rides at one height and the slider stays flat on the floor.
  const foot0 = 35;
  const foot1 = 62;
  const depth = Math.hypot(L.heel, L.ankleHeight);
  const ankleY = floor - SLIDER - depth;
  // Start: hips just off the floor, knees almost straight (172°).
  const tilt0 = 7;
  const hip0 = along(floorShoulder(floor, tilt0), 90 - tilt0, L.torso);
  const reach = Math.sqrt(L.thigh ** 2 + L.shin ** 2 - 2 * L.thigh * L.shin * Math.cos(rad(172)));
  const x0 = hip0.x + Math.sqrt(reach ** 2 - (ankleY - hip0.y) ** 2);
  // Turnaround: knees on the body line, shins about vertical.
  const shinLean = 5;
  const tilt1 = tiltFor(floor - ankleY + L.shin * Math.cos(rad(shinLean)), L.torso + L.thigh);
  const x1 = along(floorShoulder(floor, tilt1), 90 - tilt1, L.torso + L.thigh).x + L.shin * Math.sin(rad(shinLean));
  const { palm, hand } = armOnFloor(floorShoulder(floor, tilt0), floor);
  return {
    view: 'side',
    floor,
    pose: (s) => {
      const tilt = lerp(tilt0, tilt1, s);
      const shoulder = floorShoulder(floor, tilt);
      const hip = along(shoulder, 90 - tilt, L.torso);
      const foot = lerp(foot0, foot1, s);
      return {
        torso: 270 - tilt,
        head: headOnFloor(shoulder, floor),
        leg: legTo(hip, { x: lerp(x0, x1, s), y: ankleY }, UP, foot),
        arm: palmTo(shoulder, palm, hand, DOWN),
        anchor: 'shoulder',
        at: shoulder,
      };
    },
    // The slider under the heels, flat on the floor; it slides with them.
    props: [{ kind: 'attached', at: 'ankle', from: { x: -0.05, y: depth + SLIDER / 2 }, to: { x: 0.05, y: depth + SLIDER / 2 }, width: SLIDER, pad: true }],
  };
}

/**
 * Hip thrust: the upper back across the side of a bench (seen end-on, its
 * length running away from the camera), feet flat, the load in the hip crease.
 * The trunk rolls over the bench edge from the hips low (a few centimetres off
 * the floor, hip angle about 90°) to a straight line from the shoulders to the
 * knees, level with the floor, shins about vertical. Chin tucked, eyes
 * forward; elbows out to the sides.
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
  // Bottom: the hips sink until the glutes are a few centimetres off the floor (hip angle about 90°).
  const glutes = (drop: number) => {
    const t = trunk(drop);
    return along(t.hip, t.torso - 90, BODY.glute).y;
  };
  const low = solveFor(20, 70, glutes, floor - 0.035);
  const pose = (s: number): DemoPose => {
    const { torso, shoulder, hip } = trunk(lerp(low, 0, s));
    const leg = legTo(hip, ankle, UP);
    return { torso, head: torso + 28, leg, arm: loadArm(shoulder, hip, torso, leg.thigh, implement), anchor: 'shoulder', at: shoulder };
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
 * The bottom arm stretches overhead along the floor as a pillow, its forearm
 * and palm on the floor and the head resting on the upper arm; the top hand
 * rests on the iliac crest, its fingers clear of the working gluteus medius. The
 * top leg lifts straight from resting on the bottom leg to about 40° above
 * it, without the pelvis rolling.
 */
export function sideLyingAbduction(): Demo {
  // The shoulders are wider than the hips: the trunk rises a little toward them.
  const torso = 81;
  const across = dir(torso + 90); // from the top side to the bottom side
  // Bone to the floor (front view, see FRONT_SKIN): the outer hip, the outer edge of the foot.
  const HIP_SIDE = FRONT_SKIN.hip;
  const ANKLE_SIDE = FRONT_SKIN.foot;
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
  // The pillow arm: the upper arm slopes from the shoulder to the elbow, whose forearm's inner side rests on the floor;
  // the forearm slopes on to the wrist (it thins), and the palm lies on the floor bent a little at the wrist.
  const elbowY = floor - FRONT_SKIN.forearm;
  const pillow = 90 + deg(Math.asin((elbowY - shBottom.y) / L.upperArm));
  const wristY = floor - FRONT_SKIN.wrist;
  const fore = 90 + deg(Math.asin((wristY - elbowY) / L.forearm));
  const hand = 90 + deg(Math.atan((floor - FRONT_SKIN.palm - wristY) / 0.08));
  // The head rests on the upper arm: its side on the arm's outer edge, where the head is along the arm.
  const elbow = along(shBottom, pillow, L.upperArm);
  const armTop = (x: number) => shBottom.y + ((elbow.y - shBottom.y) * (x - shBottom.x)) / (elbow.x - shBottom.x) - FRONT_SKIN.upperArm;
  const headAt = (h: number) => along(shC, h, L.neck);
  const head = solveFor(80, 120, (h) => headAt(h).y + FRONT_SKIN.head - armTop(headAt(h).x), 0);
  // Top hand flat on the side of the pelvis at the iliac crest, lying along it toward the feet (turned a little off the
  // body as the hip widens below the crest, and the working gluteus medius stays in view); elbow up.
  const palm = sub(along(hipTop, torso, 0.065), mul(across, FRONT_SKIN.crest + BODY.hand / 2));
  const topArm = palmTo(shTop, palm, torso + 187, mul(across, -1));
  // Place the figure so the floor is at FLOOR.
  const at = add(hipTop, { x: 0, y: FLOOR - floor });
  return {
    view: 'front',
    floor: FLOOR,
    pose: (s) => {
      const lift = rest + 40 * s;
      return {
        torso,
        head,
        leg: { thigh: lift, shin: lift, foot: 0 },
        leg2: { thigh: bottomLeg, shin: bottomLeg, foot: 0 },
        arm: topArm,
        arm2: { upper: pillow, fore, hand, flat: true },
        anchor: 'hip',
        at,
      };
    },
    // The top leg works; the bottom one rests on the floor.
    working: 'a',
  };
}

// ── Calf raises ──────────────────────────────────────────────────────────
// The heels rise as each foot turns about the ball of the foot; the toes stay
// flat on the floor or the platform. Standing, the body stays tall and
// balanced: over the middle of the foot with the heels down, over the balls
// of the feet with the heels up.

/** Ankle of a foot pointing `foot` degrees (heel to ball) whose ball of the foot, on the sole, is at `ball`. */
const ankleFrom = (ball: Vec, foot: number): Vec => sub(sub(ball, mul(dir(foot), L.ball)), mul(dir(foot + 90), L.ankleHeight));

/** Heels up: the foot turns this many degrees about the ball (a heel rise of about 6.5% of height). */
const RISE = 40;
/** Arms hanging relaxed at the sides, elbows soft. */
const RELAXED: Arm = { upper: 183, fore: 175 };
/** Ankle to shoulder, standing tall. */
const STANDING = L.shin + L.thigh + L.torso;
/** Where a standing body balances, ahead of the ankle at rest: over the middle of the flat foot, then just ahead of the balls of the feet. */
const OVER_MIDFOOT = (L.foot - L.heel) / 2 - 0.01;
const OVER_BALLS = L.ball + 0.012;

/** A body standing tall on straight legs, leaning `lean` degrees forward from the ankles, toes flat. */
const tall = (lean: number, foot: number) => ({ torso: lean, head: 0, leg: { thigh: 180 + lean, shin: 180 + lean, foot, toes: 90 } });

export function calfRaise(o: { implement?: Implement; single?: boolean; seated?: boolean; machine?: boolean }): Demo {
  if (o.seated) return seatedCalfRaise();
  if (o.machine) return machineCalfRaise();
  return standingCalfRaise(o.implement ?? 'none', !!o.single);
}

/**
 * Standing calf raise on the floor: tall, knees straight, rise onto the balls
 * of the feet, pause, lower the heels to the floor. The body rides up and a
 * little forward, staying balanced. Dumbbells hang at the sides, palms in.
 * Single leg: the free knee bent with the foot behind, one hand on a wall.
 */
function standingCalfRaise(implement: Implement, single: boolean): Demo {
  const toe: Vec = { x: L.foot, y: FLOOR }; // toe tips on the floor; the ankle starts at the origin
  const dumbbells = implement === 'dumbbell';
  // Single leg: one hand flat on a wall ahead at chest height, fingers up.
  const palm: Vec = { x: 0.31, y: -STANDING + 0.07 };
  const build = (foot: number, lean: number): DemoPose => {
    const p: DemoPose = {
      ...tall(lean, foot),
      // Free leg: thigh a little forward, knee bent, the foot lifted behind and relaxed.
      leg2: single ? { thigh: 172 + lean, shin: 252 + lean, foot: 172 + lean } : undefined,
      arm: dumbbells ? HANG : RELAXED,
      arm2: single ? RELAXED : undefined,
      anchor: 'toe',
      at: toe,
    };
    return single ? { ...p, arm: palmTo(solve('side', p).a.shoulder, palm, 0, DOWN) } : p;
  };
  // A dumbbell in each hand: about a fifth of body weight each.
  const massX = (p: DemoPose) => {
    const f = solve('side', p);
    return centreOfMass(f, dumbbells ? [{ at: f.a.hand, share: 0.2 }, { at: f.b.hand, share: 0.2 }] : []).x;
  };
  return {
    view: 'side',
    pose: (s) => {
      const foot = 90 + RISE * s;
      // The weight moves over the balls of the feet early, as the heels leave the floor.
      const target = lerp(OVER_MIDFOOT, OVER_BALLS, 1 - (1 - s) ** 2);
      return build(foot, solveFor(-15, 25, (lean) => massX(build(foot, lean)), target));
    },
    props: single
      ? [{ kind: 'wall', x: palm.x + BODY.hand / 2, top: -STANDING - 0.3, facing: 'left' }]
      : dumbbells
        ? [{ kind: 'dumbbell', at: 'wrists', lengthwise: true }]
        : [],
    pauseFar: 0.5,
    // Single leg: the near (standing) leg works.
    ...(single && { working: 'a' as const }),
  };
}

/**
 * Seated calf raise: on a bench, thighs level and shins vertical, a dumbbell
 * stood on end on each lower thigh and steadied by the hands. Rise onto the
 * balls of the feet (the knees and dumbbells lift), pause, lower.
 */
function seatedCalfRaise(): Demo {
  const hip: Vec = { x: 0, y: FLOOR - L.ankleHeight - L.shin };
  const ball: Vec = { x: L.thigh + L.ball, y: FLOOR }; // the ankle starts under the knee
  const torso = 12;
  const shoulder = along(hip, torso, L.torso);
  // The bench pad's centre line: its top just under the back of the thighs.
  const seat = hip.y + BODY.thighBack + PAD_HALF;
  /** Half the height of a dumbbell stood on end (see ../equipment). */
  const DB_HALF = 0.062;
  return {
    view: 'side',
    pose: (s) => {
      const foot = 90 + RISE * s;
      const leg = { ...legTo(hip, ankleFrom(ball, foot), UP, foot), toes: 90 };
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
 * Standing calf machine: shoulders under the pads, hands on the carriage's
 * handles, the balls of the feet on the platform's edge and the toes flat on
 * it. Lower the heels below the platform for a stretch, then rise as high as
 * possible. The pads ride a carriage straight up the machine's column, over
 * the balls of the feet, so the shoulders move straight up.
 */
function machineCalfRaise(): Demo {
  const step = 0.06; // platform height
  const ball: Vec = { x: 0, y: FLOOR - step }; // the ball of the foot pivots on the platform's back edge
  const low = 90 - 18; // heels below the platform
  const high = 90 + RISE; // heels well above it
  const shoulderX = ball.x; // pads over the balls of the feet
  const column = ball.x + 0.26;
  // The carriage, from the shoulder joints: the shoulder pad on top of the shoulder (over the side of the
  // neck), and an arm out of the lower half of the pad's front face, just under the chin, through the
  // handles to the column.
  const PAD = { along: 0.045, back: 0.018, thick: 0.042, long: 0.11 };
  const armY = -(PAD.along - PAD.thick / 2 + 0.008);
  const handle: Vec = { x: 0.125, y: armY };
  const pose = (s: number): DemoPose => {
    const foot = lerp(low, high, s);
    const ankle = ankleFrom(ball, foot);
    // Body straight from ankle to shoulder, the shoulders kept under the pads.
    const lean = deg(Math.asin((shoulderX - ankle.x) / STANDING));
    const shoulder = along(ankle, lean, STANDING);
    return { ...tall(lean, foot), arm: gripTo(shoulder, add(shoulder, handle), { x: 0.3, y: 1 }), anchor: 'ankle', at: ankle };
  };
  const top = along(ankleFrom(ball, high), 0, STANDING);
  return {
    view: 'side',
    pose,
    props: [
      { kind: 'box', x: ball.x, y: ball.y, w: column + 0.03 - ball.x, h: step },
      { kind: 'line', from: { x: column, y: FLOOR - 0.01 }, to: { x: column, y: top.y - 0.26 }, width: 0.045 },
      { kind: 'pad', at: 'shoulder', frame: 'trunk', offset: { x: PAD.along, y: -PAD.back }, block: { along: PAD.thick, across: PAD.long } },
      { kind: 'attached', at: 'shoulder', from: { x: PAD.long / 2 - PAD.back, y: armY }, to: { x: column - shoulderX, y: armY }, width: 0.024 },
    ],
    pauseFar: 0.5,
  };
}
