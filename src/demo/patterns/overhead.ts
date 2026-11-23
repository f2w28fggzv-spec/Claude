// Movement patterns: overhead presses, pike and handstand push-ups, raises. Conventions and helpers: ./shared.ts.
//
// Presses are seen from the side with the arms worked out in 3D: the forearms
// stay stacked under what the hands hold (upright from the side), and an elbow
// that flares out to the side, toward the camera, makes the upper arm look
// short. Standing lifters keep the centre of pressure over the middle of the
// foot, the weight included. A barbell travels up close in front of the face
// while the head draws back, then the head and chest come through under it.
// Hands pressing on the floor are flat with the fingers forward; the head
// stops just off the floor (or touches it, in a handstand push-up).
import { BODY } from '../body';
import { skinPoints } from '../contact';
import { GRIP, L, PALM, add, along, angleOf, armTo, dir, dist, legTo, lerp, lerpV, mul, solve, sub, twoLink, type Arm, type DemoPose, type Figure, type Leg, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { O, FLOOR, LEG_LEN, FWD, centreOfMass, restingPad, solveFor, type Implement } from './shared';

/** The middle of a flat foot, ahead of the ankle. A standing lifter's centre of pressure sits a little behind it (as in ./legs). */
const MIDFOOT = (L.foot - L.heel) / 2;
const BALANCE = MIDFOOT - 0.01;
/** Elbow to the middle of the fist. */
const REACH = L.forearm + GRIP;

// ── Helpers ──────────────────────────────────────────────────────────────

const rad = (deg: number) => (deg * Math.PI) / 180;
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
/** 0 → 1 smoothly as s goes from a to b. */
const ramp = (s: number, a: number, b: number) => {
  const u = clamp01((s - a) / (b - a));
  return u * u * (3 - 2 * u);
};

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

/** Apparent share of a segment `len` long whose ends are `side` apart toward or away from the camera. */
const seen = (len: number, side: number) => Math.sqrt(Math.max(0, len * len - side * side)) / len;

/** Ball of the foot from the ankle, for a foot pointing `foot` degrees (heel to ball; see ../figure). */
const ballFrom = (foot: number): Vec => add(mul(dir(foot), L.ball), mul(dir(foot + 90), L.ankleHeight));

// ── Arms seen from the side ──────────────────────────────────────────────

/**
 * Arm closed on `grip` with the forearm leaning `tilt` degrees on screen
 * (0 = upright, negative = the elbow ahead of the grip), the grip `out` to
 * the side of the shoulder joint (a bar held just outside the shoulders). The
 * elbow flares out to the side, toward the camera, only as far as the arm's
 * lengths need, so the side view sees the upper arm (and the forearm, slanting
 * in to the bar) shorter. A grip at the end of the arm's reach gets the
 * straight arm.
 */
function barArm(shoulder: Vec, grip: Vec, out: number, tilt: number): Arm {
  const u = dir(tilt);
  // f: the forearm's length on screen; the elbow sits f below the grip along the forearm.
  const elbowAt = (f: number) => sub(grip, mul(u, f));
  const fits = (f: number) => dist(elbowAt(f), shoulder) <= L.upperArm;
  // What the upper arm's length leaves for the elbow to point out to the side; the forearm's 3D length must come out right.
  const flare = (f: number) => Math.sqrt(Math.max(0, L.upperArm ** 2 - dist(elbowAt(f), shoulder) ** 2));
  const miss = (f: number) => f * f + (flare(f) - out) ** 2 - REACH ** 2;
  // From the forearm at full length, shorten it until the lengths fit: the least flared elbow.
  let hi = REACH;
  for (let k = 1; k <= 80; k++) {
    const lo = REACH * (1 - k / 80);
    if (fits(lo) && fits(hi) && miss(lo) < 0 && miss(hi) >= 0) {
      const elbow = elbowAt(solveFor(lo, hi, miss, 0));
      const f = dist(elbow, grip);
      return { upper: angleOf(sub(elbow, shoulder)), scale: dist(elbow, shoulder) / L.upperArm, fore: tilt, foreScale: f / REACH };
    }
    hi = lo;
  }
  // Out of reach: the arm straight toward the grip.
  const elbowOut = (out * L.upperArm) / (L.upperArm + REACH);
  const scale = seen(L.upperArm, elbowOut);
  const foreScale = seen(REACH, out - elbowOut);
  const [upper, fore] = twoLink(shoulder, grip, L.upperArm * scale, REACH * foreScale, FWD);
  return { upper, fore, scale, foreScale };
}

/**
 * Arm holding a dumbbell (or a handle) straight above its elbow: the forearm
 * upright from the side and from the front, so the side view sees it full
 * length and the upper arm short by however far the elbow points out to the
 * side, toward the camera.
 */
function stackedArm(shoulder: Vec, grip: Vec): Arm {
  const elbow = add(grip, { x: 0, y: REACH });
  const d = dist(elbow, shoulder);
  if (d >= L.upperArm) return { ...armTo(shoulder, sub(grip, { x: 0, y: -GRIP }), FWD), foreScale: 1 };
  return { upper: angleOf(sub(elbow, shoulder)), scale: d / L.upperArm, fore: 0, foreScale: 1 };
}

/**
 * Where a fist held straight above its elbow sits, seen from the side,
 * relative to the shoulder joint: `up` above it, with the upper arm `plane`
 * degrees forward of pointing straight out to the side (about 30 is the
 * scapular plane; 90 points straight ahead).
 */
function overElbow(up: number, plane: number): Vec {
  const rise = Math.max(-1, Math.min(1, (up - REACH) / L.upperArm));
  return { x: L.upperArm * Math.sqrt(1 - rise * rise) * Math.sin(rad(plane)), y: -up };
}

/**
 * Arm pressing its palm flat on `palm`, fingers pointing `hand` degrees, the
 * wrist `out` to the side of the shoulder joint and the elbow `elbowOut`
 * (toward the camera), bending toward `toward`. Seen from the side, the more
 * a segment points out to the side the shorter it looks.
 */
function palmArm(shoulder: Vec, palm: Vec, hand: number, toward: Vec, out: number, elbowOut: number): Arm {
  const scale = seen(L.upperArm, elbowOut);
  const foreScale = seen(L.forearm, out - elbowOut);
  const wrist = along(palm, hand + 180, PALM * foreScale);
  const [upper, fore] = twoLink(shoulder, wrist, L.upperArm * scale, L.forearm * foreScale, toward);
  return { upper, fore, scale, foreScale, hand, flat: true };
}

/** How far to the side the elbow of a straight arm sits when its wrist is `out` to the side of the shoulder. */
const straightOut = (out: number) => (out * L.upperArm) / (L.upperArm + L.forearm);

/** Shoulder to wrist with the arm straight, as the side view sees it (wrist `out` to the side). */
const straightReach = (out: number) => L.upperArm * seen(L.upperArm, straightOut(out)) + L.forearm * seen(L.forearm, out - straightOut(out));

/**
 * The same arm with the elbow flaring out to the side just as far as it takes
 * for the forearm to point `fore` degrees on screen (elbow to wrist; 180 =
 * straight down): the forearms stay over the hands while the upper arms point
 * back and out. Where no flare gives that forearm, the nearest one.
 */
function palmArmToward(shoulder: Vec, palm: Vec, hand: number, toward: Vec, out: number, fore: number): Arm {
  const arm = (e: number) => palmArm(shoulder, palm, hand, toward, out, e);
  const off = (e: number) => ((arm(e).fore - fore + 540) % 360) - 180;
  // Only flares that still let the hand reach the floor (more flare makes the arm shorter on screen).
  const reaches = (e: number) => {
    const fs = seen(L.forearm, out - e);
    return dist(shoulder, along(palm, hand + 180, PALM * fs)) <= L.upperArm * seen(L.upperArm, e) + L.forearm * fs;
  };
  const step = 0.003;
  let best = straightOut(out);
  for (let e = best; e + step < L.upperArm * 0.92 && reaches(e + step); e += step) {
    const a = off(e);
    const b = off(e + step);
    // The first flare where the forearm swings past the target: home in on it.
    if (Math.sign(a) !== Math.sign(b) && Math.abs(a - b) < 90) {
      let lo = e;
      let hi = e + step;
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        if (Math.sign(off(mid)) === Math.sign(a)) lo = mid;
        else hi = mid;
      }
      return arm((lo + hi) / 2);
    }
    if (Math.abs(b) < Math.abs(off(best))) best = e + step;
  }
  return arm(best);
}

// ── Standing ─────────────────────────────────────────────────────────────

/**
 * Standing with the feet flat (ankle at the origin): the hip joint `hipX`
 * ahead of the ankle, the knees locked or, with `sink`, bent forward so the
 * hips drop that far; the trunk leaning `lean` degrees (back when negative).
 */
function standingAt(hipX: number, lean: number, sink = 0): { leg: Leg; shoulder: Vec } {
  const hip = { x: hipX, y: -Math.sqrt(LEG_LEN ** 2 - hipX ** 2) + sink };
  return { leg: legTo(hip, O, FWD), shoulder: along(hip, lean, L.torso) };
}

/** x of a standing figure's centre of pressure: its centre of mass with the loads it holds. */
const pressureX = (pose: DemoPose, loads: (f: Figure) => { at: Vec; share: number }[]) => {
  const f = solve('side', pose);
  return centreOfMass(f, loads(f)).x;
};

// ── Overhead presses ─────────────────────────────────────────────────────

/** Standing barbell press (`dip`: push press), standing dumbbell press (`arnold`: Arnold press), or `seated` on the shoulder press machine. */
export function overheadPress(o: { implement: Implement; seated?: boolean; dip?: boolean; machine?: boolean; arnold?: boolean }): Demo {
  if (o.seated) return machinePress();
  if (o.implement === 'barbell' || o.implement === 'ezbar') return barbellPress(!!o.dip);
  return dumbbellPress(!!o.arnold);
}

/** A working press weight, as a share of body weight. */
const BAR_LOAD = 0.5;
/** Fists just outside the shoulders: this far out to the side of the shoulder joints. */
const BAR_OUT = 0.035;
/** Bar resting on the front delts by the collarbones: this far in front of and above the shoulder joint. */
const RACK = { fwd: 0.08, up: 0.024 };
/** The bar locked out overhead: shoulder joint to bar with the elbows at 176°, as the side view sees it. */
const LOCKED = Math.sqrt(L.upperArm ** 2 + REACH ** 2 + 2 * L.upperArm * REACH * Math.cos(rad(4)) - BAR_OUT ** 2);

/**
 * Standing barbell press, side view: s = 0 with the bar resting on the front
 * delts (forearms near upright, elbows a little in front of the bar), s = 1
 * locked out over the shoulders and the middle of the foot. Legs locked, the
 * trunk braced. The lifter leans back a few degrees by pushing the hips
 * forward and draws the head back, so the bar rises close in front of the
 * face; once it is past the forehead the head and chest come forward under it
 * ("through the window"). The elbows flare out to the sides under the bar on
 * the way up. Every frame keeps lifter and bar balanced over the middle of
 * the foot. With `dip` (push press): a short dip of the knees with the trunk
 * upright and the bar on the shoulders, then the legs drive it off and the
 * arms finish the press.
 */
function barbellPress(dip: boolean): Demo {
  // The dip and drive take the first part of the rep, the bar still on the shoulders.
  const leave = dip ? 0.4 : 0;
  const press = (s: number) => clamp01((s - leave) / (1 - leave));
  // Hips sink about 5% of height, then drive back up to locked knees.
  const sink = dip ? curve([[0, 0], [leave * 0.55, 0.05], [leave, 0]]) : () => 0;
  // Trunk lean (back when negative) and the head against the trunk, by press progress.
  const lean = dip
    ? curve([[0, 0], [0.25, -3], [0.5, -2.5], [0.8, 0], [1, 1]])
    : curve([[0, -3], [0.2, -6], [0.45, -6], [0.75, -1], [1, 1]]);
  const neck = curve([[0, 0], [0.15, -6], [0.4, -8], [0.6, -2], [0.85, 6], [1, 6]]);
  // Forearms: elbows a little in front of the bar on the shoulders, under it once it moves.
  const tilt = (p: number) => lerp(-8, 0, ramp(p, 0, 0.4));

  type Place = (shoulder: Vec, torso: number) => Vec;
  const onShoulders: Place = (sh, torso) => local(sh, torso, RACK.fwd, RACK.up);
  const overhead: Place = (sh) => add(sh, { x: 0, y: -LOCKED });
  const build = (s: number, hipX: number, bar: Vec | Place) => {
    const p = press(s);
    const torso = lean(p);
    const { leg, shoulder } = standingAt(hipX, torso, sink(s));
    const at = typeof bar === 'function' ? bar(shoulder, torso) : bar;
    const pose: DemoPose = { torso, head: torso + neck(p), leg, arm: barArm(shoulder, at, BAR_OUT, tilt(p)), anchor: 'ankle', at: O };
    return { pose, bar: at };
  };
  // The hips shift until lifter and bar balance over the middle of the foot.
  const balanced = (s: number, bar: Vec | Place) => {
    const hipX = solveFor(-0.1, 0.2, (h) => {
      const b = build(s, h, bar);
      return pressureX(b.pose, () => [{ at: b.bar, share: BAR_LOAD }]);
    }, BALANCE);
    return build(s, hipX, bar);
  };
  const from = balanced(leave, onShoulders).bar;
  const to = balanced(1, overhead).bar;
  // In between the bar rises in a line, kept forward while it passes the face, then settles back over the shoulders.
  const barAt = (p: number): Vec => ({ x: lerp(from.x, to.x, ramp(p, 0.3, 0.9)), y: lerp(from.y, to.y, p) });
  return {
    view: 'side',
    pose: (s) => balanced(s, s <= leave ? onShoulders : s >= 1 ? overhead : barAt(press(s))).pose,
    props: [{ kind: 'barbell', at: 'wrist' }],
  };
}

/** One dumbbell as a share of body weight. */
const DUMBBELL = 0.12;

/**
 * Standing dumbbell press, side view, palms forward (the dumbbells seen
 * end-on): s = 0 with the dumbbells at the sides of the head about level with
 * the chin, elbows out to the sides and a little forward, right under the
 * hands; s = 1 locked out straight over the shoulders. The forearms stay
 * upright all the way; the head stays still while the dumbbells pass beside
 * it, the body braced and balanced over the middle of the foot.
 * `arnold`: starts lower and in front, palms facing the lifter and elbows
 * together in front of the chest (like the top of a curl); the elbows open
 * out to the sides as the dumbbells rise, turning the palms forward.
 */
function dumbbellPress(arnold: boolean): Demo {
  const up0 = arnold ? 0.045 : 0.07;
  const up1 = L.upperArm + REACH - 0.0005;
  // The upper arms' plane: straight ahead to the scapular plane (Arnold), or in the scapular plane.
  const plane = arnold ? (s: number) => 30 + 70 * (1 - clamp01(s / 0.45)) ** 2 : () => 30;
  const hand = (s: number) => overElbow(lerp(up0, up1, s), plane(s));
  const build = (hipX: number, s: number): DemoPose => {
    const { leg, shoulder } = standingAt(hipX, 0);
    return { torso: 0, head: 0, leg, arm: stackedArm(shoulder, add(shoulder, hand(s))), anchor: 'ankle', at: O };
  };
  // One stance for the whole rep: balanced half way up (the body doesn't sway with the dumbbells).
  const hipX = solveFor(-0.1, 0.2, (h) => pressureX(build(h, 0.5), (f) => [{ at: f.a.hand, share: 2 * DUMBBELL }]), BALANCE);
  return { view: 'side', pose: (s) => build(hipX, s), props: [{ kind: 'dumbbell', at: 'wrists' }] };
}

/**
 * Seated shoulder press machine, side view: back against the upright pad,
 * feet flat, hands on the handles at about shoulder height just in front of
 * the shoulders (below the face), elbows out to the sides under them, pressed
 * straight up to straight arms a little in front of the head. The handles
 * ride on a carriage up a guide column standing behind the back pad; the
 * carriage's arms reach forward from it past the lifter's sides, drawn behind
 * the trunk and head so only the handle shows under the fist (the camera
 * films from the side the machine leaves open).
 */
function machinePress(): Demo {
  const torso = -8; // back pad reclined a little
  const shoulder = along(O, torso, L.torso);
  // Handles wider than the shoulders, at shoulder height at the bottom, pressed straight up.
  const out = 0.07;
  const bottom = add(shoulder, { x: 0.06, y: -0.025 });
  const reach = Math.sqrt(L.upperArm ** 2 + REACH ** 2 + 2 * L.upperArm * REACH * Math.cos(rad(4)) - out ** 2);
  const top = { x: bottom.x, y: shoulder.y - Math.sqrt(reach ** 2 - (bottom.x - shoulder.x) ** 2) };
  const lockTilt = angleOf(sub(top, shoulder));
  const leg: Leg = { thigh: 90, shin: 180, foot: 90 };
  const floor = L.shin + L.ankleHeight;
  const pose = (s: number): DemoPose => {
    const grip = lerpV(bottom, top, s);
    // Forearms upright under the handles, leaning with the straight arm at lockout.
    return { torso, head: torso, leg, arm: barArm(shoulder, grip, out, lerp(0, lockTilt, ramp(s, 0.5, 1))), anchor: 'hip', at: O };
  };
  // Back pad behind the trunk and up behind the head; the seat under the thighs.
  const behind = mul(dir(torso - 90), BODY.torsoBack + 0.023);
  const [b0, b1] = restingPad(pose, add(along(O, torso, 0.5), behind), add(along(O, torso, 0.03), behind), /hand|forearm|upper arm/);
  const [s0, s1] = restingPad(pose, { x: -0.08, y: BODY.thighBack + 0.023 }, { x: 0.17, y: BODY.thighBack + 0.023 }, /hand|forearm|upper arm/);
  const seatX = (s0.x + s1.x) / 2;
  const backPost = lerpV(b0, b1, 0.6);
  // The guide column stands on the base behind the back pad, taller than the handles go.
  const column = Math.min(b0.x, b1.x) - 0.075;
  const arm = column - bottom.x;
  const props: Prop[] = [
    { kind: 'line', from: { x: column - 0.06, y: floor - 0.008 }, to: { x: s1.x + 0.02, y: floor - 0.008 }, width: 0.016 },
    { kind: 'line', from: { x: column, y: floor - 0.01 }, to: { x: column, y: top.y - 0.07 }, width: 0.034 },
    // Seat post, and the back pad's post down to the base.
    { kind: 'line', from: { x: seatX, y: s0.y }, to: { x: seatX, y: floor - 0.01 }, width: 0.026 },
    { kind: 'line', from: add(backPost, mul(dir(torso - 90), 0.02)), to: { x: backPost.x - 0.02, y: floor - 0.01 }, width: 0.026 },
    // The carriage, behind the lifter: its arm from the handle back to the column, and its sleeve on the column.
    { kind: 'attached', at: 'wrist', from: { x: 0, y: 0 }, to: { x: arm, y: 0 }, width: 0.024, pad: true },
    { kind: 'attached', at: 'wrist', from: { x: arm, y: -0.045 }, to: { x: arm, y: 0.045 }, width: 0.05, pad: true },
    // The pads over the carriage arm.
    { kind: 'bench', points: [b0, b1], legs: false },
    { kind: 'bench', points: [s0, s1], legs: false },
    // The handle, seen end-on under the fist.
    { kind: 'attached', at: 'wrist', from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, width: 0.036 },
  ];
  return { view: 'side', floor, pose, props };
}

// ── Pike and handstand push-ups ──────────────────────────────────────────

/** The head stops this far off the floor at the bottom of a pike push-up. */
const HEAD_CLEAR = 0.012;
/** Elbows bending back toward the feet (pike push-up). */
const BACK_UP: Vec = { x: -1, y: -0.5 };

/** Lowest point of the head's skin (see ../contact) for a pose. */
const headLow = (pose: DemoPose) =>
  Math.max(...skinPoints({ view: 'side', pose: () => pose }, 0).filter((sp) => /^head/.test(sp.part)).map((sp) => sp.p.y));

/**
 * Pike push-up: hands flat on the floor about shoulder-width, fingers
 * forward; feet walked in so the hips are high (an inverted V), on the balls
 * of the feet with the toes bent and the legs straight. The elbows bend back
 * toward the feet and the head lowers to just off the floor a little in front
 * of the hands (head and hands make a triangle); the shoulders come forward
 * over the hands while the hips stay high, then press back up to straight arms.
 */
export function pikePushUp(): Demo {
  const ball: Vec = { x: 0, y: FLOOR };
  // Hands to the balls of the feet: feet walked in toward the hands.
  const palm: Vec = { x: 0.43, y: FLOOR - BODY.hand / 2 };
  const out = 0.075; // hands a little wider than the shoulders
  const wrist = along(palm, 270, PALM);
  // The foot keeps this angle to the shin (heels up, about 20° pointed), pivoting on the ball.
  const footFor = (legDeg: number) => legDeg + 110;
  /** Hip, for the leg pointing `legDeg` from the ankle to the hip (0 = straight up, + toward the hands). */
  const hipFor = (legDeg: number) => along(sub(ball, ballFrom(footFor(legDeg))), legDeg, LEG_LEN);
  /** Leg direction that puts the hip a trunk's length from the shoulder (the higher of the two). */
  const legFor = (shoulder: Vec) => solveFor(-30, 80, (d) => -dist(hipFor(d), shoulder), -L.torso);
  const build = (shoulder: Vec, arm: (shoulder: Vec) => Arm): DemoPose => {
    const legDeg = legFor(shoulder);
    const hip = hipFor(legDeg);
    const torso = angleOf(sub(shoulder, hip));
    return { torso, head: torso, leg: { thigh: legDeg + 180, shin: legDeg + 180, foot: footFor(legDeg), toes: 90 }, arm: arm(shoulder), anchor: 'hip', at: hip };
  };
  // Top: arms straight, leaning back toward the feet a little more than upright.
  const top = along(wrist, -10, straightReach(out) - 0.002);
  // Bottom: shoulders ahead of the hands, lowered until the head is just off the floor.
  const bottomX = wrist.x + 0.115;
  const straightArm = (sh: Vec) => palmArm(sh, palm, 90, BACK_UP, out, straightOut(out));
  const bottomY = solveFor(top.y, FLOOR, (y) => headLow(build({ x: bottomX, y }, straightArm)), FLOOR - HEAD_CLEAR);
  const bottom = { x: bottomX, y: bottomY };
  // The forearms turn from the straight arm's line to standing over the hands (elbows a little behind the wrists).
  const foreTop = angleOf(sub(wrist, top));
  return {
    view: 'side',
    pose: (s) => build(lerpV(top, bottom, s), (sh) => palmArmToward(sh, palm, 90, BACK_UP, out, lerp(foreTop, 172, ramp(s, 0, 0.7)))),
  };
}

/**
 * Wall handstand push-up, back to the wall: hands flat on the floor about a
 * hand's length from it, fingers pointing away, the body straight with the
 * heels resting on the wall. The elbows bend back toward the wall and the head
 * lowers until it touches the floor a little in front of the hands (a
 * triangle with them), the heels sliding down the wall; then press back up to
 * straight arms. Upside down the lifter faces left, so the wall is on the right.
 */
export function handstandPushUp(): Demo {
  const palm: Vec = { x: 0, y: FLOOR - BODY.hand / 2 };
  const hand = 270; // fingers pointing away from the wall
  const wrist = along(palm, hand + 180, PALM);
  const out = 0.075; // hands a little wider than the shoulders
  const wall = wrist.x + 0.12;
  const toward: Vec = { x: 1, y: -0.4 }; // elbows bend back, toward the wall
  /** The straight body from the shoulder, leaning `deg` from vertical toward the wall (feet toward it). */
  const build = (shoulder: Vec, deg: number, arm: Arm): DemoPose => ({
    torso: deg + 180,
    head: deg + 180,
    // Legs in line with the trunk, toes pointed.
    leg: { thigh: deg, shin: deg, foot: deg - 25 },
    arm,
    anchor: 'shoulder',
    at: shoulder,
  });
  /** How far the back of the legs (calves and heels) reaches toward the wall. */
  const legsBack = (p: DemoPose) => Math.max(...skinPoints({ view: 'side', pose: () => p }, 0).filter((sp) => /shin \(back\)|heel/.test(sp.part)).map((sp) => sp.p.x));
  /** The lean that rests the legs on the wall. */
  const leanFor = (shoulder: Vec, arm: Arm) => solveFor(-10, 40, (d) => legsBack(build(shoulder, d, arm)), wall);
  // Top: arms straight and upright, shoulders over the wrists.
  const top = { x: wrist.x, y: wrist.y - (straightReach(out) - 0.002) };
  // Bottom: the top of the head touching the floor in front of the hands.
  const head = { x: palm.x - 0.1, y: FLOOR - BODY.head + 0.004 };
  const shoulderFor = (deg: number): Vec => sub(head, mul(dir(deg + 180), L.neck));
  const straightArm = (sh: Vec) => palmArm(sh, palm, hand, toward, out, straightOut(out));
  const bottom = shoulderFor(solveFor(-10, 40, (d) => legsBack(build(shoulderFor(d), d, straightArm(shoulderFor(d)))), wall));
  return {
    view: 'side',
    pose: (s) => {
      const shoulder = lerpV(top, bottom, s);
      // Forearms from upright (straight arms) to standing over the hands with the elbows a little toward the wall.
      const arm = palmArmToward(shoulder, palm, hand, toward, out, lerp(180, 190, ramp(s, 0, 0.7)));
      return build(shoulder, leanFor(shoulder, arm), arm);
    },
    props: [{ kind: 'wall', x: wall, top: top.y - 0.95, facing: 'left' }],
  };
}

// ── Raises ───────────────────────────────────────────────────────────────

/**
 * Raises seen from the front: arms from hanging (elbows soft) out to the
 * sides until level with the shoulders, leading with the elbows (hands no
 * higher than them), no shrug, the body still. `oneArm` + `cable`: the right
 * arm raises the handle of a low cable on the lifter's left, the cable across
 * the front of the body, the free hand holding the machine. `bentOver`: hinged
 * forward with soft knees (the trunk foreshortened), arms hanging under the
 * shoulders and raised out to the sides level with the back.
 */
export function lateralRaise(o: { oneArm?: boolean; cable?: boolean; bentOver?: boolean }): Demo {
  const torsoScale = o.bentOver ? 0.42 : 1;
  const leg: Leg = o.bentOver ? { thigh: 186, shin: 178, foot: 0 } : { thigh: 184, shin: 180, foot: 0 };
  const leg2: Leg = o.bentOver ? { thigh: 174, shin: 182, foot: 0 } : { thigh: 176, shin: 180, foot: 0 };
  // The lifter's right arm is on the image left (270 = out to the side). Hanging: beside the thighs, or
  // bent over straight down under the shoulders; with the cable, in front of the hip.
  const low = o.bentOver ? { upper: 182, fore: 180 } : o.cable ? { upper: 174, fore: 172 } : { upper: 188, fore: 185 };
  const high = { upper: 268, fore: 262 };
  const base: DemoPose = { torso: 0, torsoScale, leg, leg2, arm: low, anchor: 'ankle', at: O };
  const arm = (s: number) => ({ upper: lerp(low.upper, high.upper, s), fore: lerp(low.fore, high.fore, s) });
  const mirror = (a: { upper: number; fore: number }) => ({ upper: 360 - a.upper, fore: 360 - a.fore });
  if (!o.cable) {
    return {
      view: 'front',
      pose: (s) => ({ ...base, arm: arm(s), arm2: o.oneArm ? mirror(low) : mirror(arm(s)) }),
      props: [{ kind: 'dumbbell', at: o.oneArm ? 'wrist' : 'wrists' }],
    };
  }
  // Cable: the machine stands to the lifter's left, the pulley at its foot; the free hand holds the frame.
  const f = solve('front', base);
  const tower = f.b.hip.x + 0.24;
  const pulley: Vec = { x: tower - 0.04, y: FLOOR - 0.07 };
  const grab: Vec = { x: tower - 0.025, y: f.b.hip.y - 0.1 };
  const free = armTo(f.b.shoulder, sub(grab, { x: GRIP, y: 0 }), { x: 0.3, y: 1 });
  return {
    view: 'front',
    pose: (s) => ({ ...base, arm: arm(s), arm2: free }),
    props: [
      { kind: 'line', from: { x: tower, y: FLOOR - 0.01 }, to: { x: tower, y: f.a.shoulder.y - 0.3 }, width: 0.04 },
      { kind: 'cable', from: pulley, at: 'wrist', column: tower },
    ],
    working: 'a',
  };
}

/**
 * Dumbbell front raise, side view, palms down (the dumbbells seen end-on):
 * from resting on the front of the thighs, arms nearly straight, raise them
 * in front to shoulder height and lower under control. The body stays still,
 * braced and balanced over the middle of the foot; no swing.
 */
export function frontRaise(): Demo {
  const bend = 8; // elbows soft
  const load = 2 * DUMBBELL * 0.6; // lighter dumbbells than for a press
  const build = (hipX: number, upper: number): DemoPose => {
    const { leg } = standingAt(hipX, 0);
    return { torso: 0, head: 0, leg, arm: { upper, fore: upper - bend }, anchor: 'ankle', at: O };
  };
  /** How far the fist is in front of the near thigh's skin. */
  const offThigh = (p: DemoPose) => {
    const f = solve('side', p);
    const ab = sub(f.a.knee, f.a.hip);
    const t = clamp01(((f.a.hand.x - f.a.hip.x) * ab.x + (f.a.hand.y - f.a.hip.y) * ab.y) / (ab.x ** 2 + ab.y ** 2));
    return dist(f.a.hand, add(f.a.hip, mul(ab, t))) - BODY.thighFront - BODY.hand;
  };
  // Top: arms level with the shoulders. One stance for the whole rep, balanced half way up: the body stays still.
  const topUpper = 90 + bend / 2;
  const hipX = solveFor(-0.1, 0.2, (h) => pressureX(build(h, (167 + topUpper) / 2), (f) => [{ at: f.a.hand, share: load }]), BALANCE);
  // Start: the fists resting on the front of the thighs.
  const startUpper = solveFor(150, 180, (u) => -offThigh(build(hipX, u)), 0);
  return {
    view: 'side',
    pose: (s) => build(hipX, lerp(startUpper, topUpper, s)),
    props: [{ kind: 'dumbbell', at: 'wrists' }],
  };
}
