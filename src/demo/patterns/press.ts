// Movement patterns: bench and floor presses, push-ups, dips, flys, skull crushers. Conventions and helpers: ./shared.ts.
//
// Lying face up the head is to the LEFT; face down (push-ups) to the right.
// Arms that reach out to the side (a wide grip, flared elbows, a fly) are
// drawn foreshortened: from the side each segment looks shorter by how far it
// points toward or away from the camera.
import { BODY } from '../body';
import { PAD_HALF, skinPoints } from '../contact';
import { GRIP, L, PALM, add, along, angleOf, dir, legTo, lerp, lerpV, mul, solve, sub, twoLink, type Arm, type DemoPose, type Leg, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { FLOOR, HANG, STAND, UP, centreOfMass, handProp, restingPad, solveFor, type Implement } from './shared';

const rad = (deg: number) => (deg * Math.PI) / 180;
/** Elbow to the middle of the fist. */
const REACH = L.forearm + GRIP;
/** A flat bench, and an incline bench's seat: about 44 cm. */
const BENCH_H = 0.25;

// ── Arms seen from the side ──────────────────────────────────────────────

/** Apparent share of a segment `len` long whose ends are `side` apart toward or away from the camera. */
const seen = (len: number, side: number) => Math.sqrt(Math.max(0, len * len - side * side)) / len;

/** How far to the side the elbow of a straight arm sits when its end is `out` to the side of the shoulder. */
const straightOut = (out: number, reach = REACH) => (out * L.upperArm) / (L.upperArm + reach);

/** Shoulder to hand as seen from the side with the elbow bent to `deg` (180 = straight). */
function sideReach(deg: number, out: number, elbowOut: number, reach = REACH): number {
  const u = L.upperArm * seen(L.upperArm, elbowOut);
  const f = reach * seen(reach, out - elbowOut);
  return Math.sqrt(u * u + f * f - 2 * u * f * Math.cos(rad(deg)));
}

/**
 * Arm pressing the palm flat on `palm`, fingers pointing `hand` degrees, the
 * wrist `out` to the side of the shoulder and the elbow `elbowOut` (+ = away
 * from the body's midline), elbow toward `toward`.
 */
function sidePalm(shoulder: Vec, palm: Vec, hand: number, toward: Vec, out: number, elbowOut: number): Arm {
  const scale = seen(L.upperArm, elbowOut);
  const foreScale = seen(L.forearm, out - elbowOut);
  const wrist = along(palm, hand + 180, PALM * foreScale);
  const [upper, fore] = twoLink(shoulder, wrist, L.upperArm * scale, L.forearm * foreScale, toward);
  return { upper, fore, scale, foreScale, hand, flat: true };
}

/** An arm from its elbow and hand points (side view): directions and apparent lengths. */
function armThrough(shoulder: Vec, elbow: Vec, hand: Vec): Arm {
  return {
    upper: angleOf(sub(elbow, shoulder)),
    scale: Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y) / L.upperArm,
    fore: angleOf(sub(hand, elbow)),
    foreScale: Math.hypot(hand.x - elbow.x, hand.y - elbow.y) / REACH,
  };
}

/**
 * Arm whose fist closes on `grip` with the forearm seen leaning `lean`
 * degrees from upright (negative = back toward the head when lying), the hand
 * `out` to the side of the shoulder: the elbow goes out to the side as far as
 * the arm's length needs (the upper arm looks shorter the further it goes).
 */
function leaningGrip(shoulder: Vec, grip: Vec, lean: number, out: number): Arm {
  const d = dir(lean);
  const elbowAt = (elbowOut: number) => sub(grip, mul(d, REACH * seen(REACH, out - elbowOut)));
  const miss = (elbowOut: number) => {
    const e = elbowAt(elbowOut);
    return Math.hypot(e.x - shoulder.x, e.y - shoulder.y) - L.upperArm * seen(L.upperArm, elbowOut);
  };
  return armThrough(shoulder, elbowAt(solveFor(straightOut(out), L.upperArm * 0.995, miss, 0)), grip);
}

// ── Contact helpers ──────────────────────────────────────────────────────

/** Skin points of one pose (see ../contact) whose part matches. */
const skin = (p: DemoPose, parts: RegExp) => skinPoints({ view: 'side', pose: () => p }, 0).filter((sp) => parts.test(sp.part));

/** Height of p above the line through a pointing `deg` degrees (measured on its +90° side). */
function above(p: Vec, a: Vec, deg: number): number {
  const n = dir(deg + 90);
  return (p.x - a.x) * n.x + (p.y - a.y) * n.y;
}

/** Where the lines through a1-b1 and a2-b2 cross. */
function crossing(a1: Vec, b1: Vec, a2: Vec, b2: Vec): Vec {
  const d1 = sub(b1, a1);
  const d2 = sub(b2, a2);
  const t = ((a2.x - a1.x) * d2.y - (a2.y - a1.y) * d2.x) / (d1.x * d2.y - d1.y * d2.x);
  return add(a1, mul(d1, t));
}

/** Hip-to-ankle distance with the knee bent to `deg` (180 = straight). */
const legSpan = (deg: number) => Math.sqrt(L.thigh ** 2 + L.shin ** 2 - 2 * L.thigh * L.shin * Math.cos(rad(deg)));

// ── Lying face up ────────────────────────────────────────────────────────

/** Natural arch: the lower trunk turns up from the upper trunk by this much at the waist, lifting the lower back a little. */
const ARCH = 12;

interface Lying {
  /** The pose with these arms. */
  pose: (arm: Arm) => DemoPose;
  shoulder: Vec;
  /** Upper trunk direction (waist to shoulder). */
  upper: number;
  /** Middle of the head. */
  head: Vec;
  /** The bench (none on the floor). */
  props: Prop[];
}

/**
 * Lying face up on a flat bench, an incline bench (`incline` degrees) or the
 * floor: glutes and upper back down, the lower back gently arched, the back
 * of the head resting, feet flat on the floor with the knees bent.
 */
function lying(o: { incline?: number; floor?: boolean }): Lying {
  const incline = o.incline ?? 0;
  // What the glutes rest on: the floor, or the bench (seat) top.
  const seat = o.floor ? FLOOR : FLOOR - BENCH_H;
  const trunk = (torso: number, at: Vec = { x: 0, y: 0 }): DemoPose => ({ torso, bend: -ARCH, leg: STAND, arm: HANG, anchor: 'hip', at });
  const lowest = (p: DemoPose, part: RegExp) => Math.max(...skin(p, part).map((sp) => sp.p.y));
  // The trunk tilts until the upper back rests level with the glutes (on an incline, both on the back pad).
  const flat = solveFor(250, 290, (t) => lowest(trunk(t), /^glutes$/) - lowest(trunk(t), /^upper trunk \(back\)$/), 0);
  const torso = flat + incline;
  const hip: Vec = { x: 0, y: seat - lowest(trunk(torso), /^glutes$/) };
  // Feet flat on the floor, about under the knees (on the floor the knees point up).
  const ankle: Vec = { x: 0, y: 0 };
  ankle.x = hip.x + Math.sqrt(legSpan(o.floor ? 85 : 92) ** 2 - (ankle.y - hip.y) ** 2);
  const leg: Leg = legTo(hip, ankle, UP);
  const body = (arm: Arm, head: number): DemoPose => ({ ...trunk(torso, hip), leg, arm, head });
  const upper = torso - ARCH;
  const shoulder = solve('side', body(HANG, upper)).a.shoulder;

  // The surface under the upper back and head: a point on it and its direction (toward the head).
  let support: { at: Vec; deg: number };
  const props: Prop[] = [];
  const free = /arm|forearm|hand|head/; // parts that rest elsewhere or pass beside the pad
  const arms = /upper arm|forearm|hand/; // the bench is narrower than the shoulders: the arms pass beside it
  if (o.floor) support = { at: { x: 0, y: FLOOR }, deg: 270 };
  else if (!incline) {
    // Flat bench from just past the head to under the top of the thighs.
    const y = seat + PAD_HALF;
    const [a, b] = restingPad(() => body(HANG, upper), { x: shoulder.x - L.neck - BODY.head - 0.035, y }, { x: hip.x + 0.12, y }, free);
    props.push({ kind: 'bench', points: [a, b], beside: arms });
    support = { at: { x: a.x, y: a.y - PAD_HALF }, deg: 270 };
  } else {
    // Back pad at the incline under the glutes, upper back and head; the seat under the glutes and thighs.
    const deg = 270 + incline;
    const behind = mul(dir(deg - 90), BODY.glute + PAD_HALF);
    const [b0, b1] = restingPad(() => body(HANG, upper), add(hip, behind), add(along(hip, deg, L.torso + L.neck + BODY.head + 0.05), behind), free);
    const y = seat + PAD_HALF;
    const [s0, s1] = restingPad(() => body(HANG, upper), { x: hip.x - 0.14, y }, { x: hip.x + 0.14, y }, free);
    // An adjustable bench: legs under the seat, the back pad propped on a strut from a floor rail.
    const corner = crossing(b0, b1, s0, s1);
    const backLen = Math.hypot(corner.x - b1.x, corner.y - b1.y);
    const atCorner = backLen / (backLen + Math.hypot(s1.x - corner.x, s1.y - corner.y));
    const strutTop = add(lerpV(corner, b1, 0.5), mul(dir(deg - 90), PAD_HALF));
    const strutFoot = { x: lerp(strutTop.x, corner.x, 0.5), y: FLOOR - 0.008 };
    props.push(
      { kind: 'line', from: strutFoot, to: strutTop, width: 0.018 },
      { kind: 'line', from: { x: strutFoot.x - 0.05, y: FLOOR - 0.008 }, to: { x: s1.x + 0.04, y: FLOOR - 0.008 }, width: 0.016 },
      { kind: 'bench', points: [b1, corner, s1], legs: [atCorner, 1], beside: arms },
    );
    support = { at: add(b0, mul(dir(deg + 90), PAD_HALF)), deg };
  }
  // The back of the head rests on the surface (neck in line with the trunk).
  const head = solveFor(support.deg - 40, support.deg + 40, (h) => above(along(shoulder, h, L.neck), support.at, support.deg), BODY.head);
  return { pose: (arm) => body(arm, head), shoulder, upper, head: along(shoulder, head, L.neck), props };
}

/** How a lying press moves: where the load touches the chest, the grip width and how the forearms lean. */
interface PressPath {
  /** Load at the bottom: this far down the chest from the shoulder joint... */
  touch: number;
  /** ...and its middle this far above the chest's skin (dumbbells: level with it, beside the chest). */
  lift: number;
  /** Hands to the side of the shoulders at the top and at the bottom. */
  out: [number, number];
  /** Forearms at the bottom, seen leaning back toward the head by this much (degrees)... */
  lean: number;
  /** ...and this much more mid-way, as the elbows travel (tucked elbows travel further toward the hips). */
  bump: number;
}

/** Bar to the lower chest, hands a little outside the shoulders, elbows about 45–60° from the body. */
const BAR: PressPath = { touch: 0.085, lift: 0.015, out: [0.08, 0.08], lean: 12, bump: 6 };
/** Close grip: hands about shoulder-width, elbows tucked to the sides, bar to the bottom of the chest. */
const CLOSE: PressPath = { touch: 0.135, lift: 0.015, out: [0, 0], lean: 12, bump: 14 };
/** Dumbbells over the shoulders, lowered beside the chest with the forearms upright. */
const DUMBBELLS: PressPath = { touch: 0.075, lift: 0, out: [-0.03, 0.12], lean: 6, bump: 6 };
/** Floor press: the elbows (about 45° from the body) come down onto the floor, forearms upright. */
const FLOOR_ELBOW = 0.12;

/** Face-up press on a flat or incline bench or the floor: from straight arms over the shoulders down to the chest. */
export function lyingPress(o: { implement: Implement; incline?: number; floor?: boolean; closeGrip?: boolean }): Demo {
  const body = lying(o);
  const S = body.shoulder;
  const path = o.closeGrip ? CLOSE : o.implement === 'dumbbell' ? DUMBBELLS : BAR;
  // On an incline the load comes down to the upper chest, just under the collarbones, forearms upright.
  const touch = o.incline ? 0.035 : path.touch;
  const lean = o.incline || o.floor ? 2 : path.lean;
  // Top: arms locked straight up over the shoulders.
  const outTop = path.out[0];
  const top: Vec = { x: S.x, y: S.y - sideReach(176, outTop, straightOut(outTop)) };
  // Bottom: on the chest; on the floor the backs of the upper arms rest on the floor.
  let bottom: Vec;
  let outBottom = path.out[1];
  if (o.floor) {
    outBottom = FLOOR_ELBOW;
    const elbowY = FLOOR - BODY.upperArm - 0.001;
    const upperLen = L.upperArm * seen(L.upperArm, FLOOR_ELBOW);
    const elbow = { x: S.x + Math.sqrt(upperLen ** 2 - (elbowY - S.y) ** 2), y: elbowY };
    bottom = along(elbow, -lean, REACH);
  } else bottom = add(along(S, body.upper + 180, touch), mul(dir(body.upper + 90), BODY.torsoFront + path.lift));
  const pose = (s: number): DemoPose => {
    // A slight J-curve: down from over the shoulders, drifting onto the chest on the way.
    const grip = { x: lerp(top.x, bottom.x, s ** 1.25), y: lerp(top.y, bottom.y, s) };
    // Forearms nearly upright all the way, leaning back a little more mid-way as the elbows travel.
    return body.pose(leaningGrip(S, grip, -(lean * s + path.bump * Math.sin(Math.PI * s)), lerp(outTop, outBottom, s)));
  };
  return { view: 'side', pose, props: [...body.props, ...handProp(o.implement)] };
}

/**
 * Dumbbell fly on a flat bench, palms facing (light dumbbells held along the
 * body): from over the chest the arms open out to the sides as one piece,
 * elbows softly bent, in a plane angled toward the feet (not straight out
 * from the shoulders), until the upper arms are just below level and the
 * dumbbells sit beside the lower chest, between the bench and the chest's
 * height; then they hug back together over the chest. From the side the near
 * arm reaches toward the camera, so it looks short at the bottom, the elbow
 * lowest.
 */
export function fly(): Demo {
  const body = lying({});
  const S = body.shoulder;
  const bend = 20; // elbows bent this much throughout
  const lean = 8; // at the top the arms lean this far toward the feet: the dumbbells over the chest
  const plane = 24; // the arms open this far toward the feet from straight out to the side
  // Directions in 3D on the bench: [toward the feet, up, out to the near side]. The arms move in the plane
  // through `up` and `out`; the side view sees the first two (screen y points down).
  const up = [Math.sin(rad(lean)), Math.cos(rad(lean)), 0];
  const wide = [Math.sin(rad(plane)), 0, Math.cos(rad(plane))];
  const k = wide[0] * up[0] + wide[1] * up[1];
  const o = wide.map((v, i) => v - k * up[i]);
  const out = o.map((v) => v / Math.hypot(...o));
  /** A segment `len` long at `deg` in that plane (0 = up, 90 = level out to the side), as the side view sees it. */
  const seenAt = (deg: number, len: number): Vec => {
    const [c, s] = [Math.cos(rad(deg)), Math.sin(rad(deg))];
    return { x: len * (c * up[0] + s * out[0]), y: -len * (c * up[1] + s * out[1]) };
  };
  return {
    view: 'side',
    pose: (s) => {
      // Upper arm from just past upright (hands together over the chest) to just below level.
      const phi = lerp(-2, 98, s);
      const elbow = add(S, seenAt(phi, L.upperArm));
      const hand = add(elbow, seenAt(phi - bend, REACH));
      // The handle runs along the body all the way: the fist is drawn upright over it.
      return body.pose({ ...armThrough(S, elbow, hand), hand: 0 });
    },
    props: [...body.props, { kind: 'dumbbell', at: 'wrist', lengthwise: true, light: true }],
  };
}

/**
 * Skull crusher on a flat bench: upper arms angled slightly back toward the
 * head and held still; only the elbows bend, lowering the bar until it is
 * just above the forehead.
 */
export function skullCrusher(): Demo {
  const body = lying({});
  const upper = 348;
  const elbow = along(body.shoulder, upper, L.upperArm);
  // The forearm turns toward the head until the fist is just clear of it.
  const clear = BODY.head + BODY.hand + 0.012;
  const bottom = solveFor(200, upper, (f) => Math.hypot(along(elbow, f, REACH).x - body.head.x, along(elbow, f, REACH).y - body.head.y), clear);
  return {
    view: 'side',
    pose: (s) => body.pose({ upper, fore: lerp(upper - 2, bottom, s) }),
    props: [...body.props, ...handProp('ezbar')],
  };
}

// ── Push-ups ─────────────────────────────────────────────────────────────

/** Ball of the foot from the ankle for a foot pointing `foot` degrees (see ../figure). */
const ballFrom = (foot: number): Vec => add(mul(dir(foot), L.ball), mul(dir(foot + 90), L.ankleHeight));
/** Kneeling: the knee joint this far above the floor (the kneecap on the floor). */
const KNEEL = 0.05;
/** At the bottom the chest (or whatever is lowest) stays this far off the floor or bench; kneeling, the belly comes right down. */
const CLEAR = 0.012;
const CLEAR_KNEELING = 0.002;

/**
 * Push-up family: the body is one straight line from the heels (or knees) to
 * the head, pivoting on the balls of the feet with the toes bent flat on the
 * floor (kneeling: on the kneecaps, shins raised). Palms flat, fingers
 * forward, under the shoulders (diamond: together under the chest), elbows
 * about 45° from the body at the bottom (diamond: tucked along the ribs).
 */
export function pushUp(o: { variant: 'standard' | 'incline' | 'knee' | 'diamond' }): Demo {
  const kneeling = o.variant === 'knee';
  const diamond = o.variant === 'diamond';
  const incline = o.variant === 'incline';
  const ball: Vec = { x: 0, y: FLOOR };
  const knee: Vec = { x: 0, y: FLOOR - KNEEL };
  /** The body at `deg` (the line from the feet or knees to the shoulder; 90 = level). */
  const build = (deg: number, arm: Arm): DemoPose => {
    if (kneeling) return { torso: deg, head: deg, leg: { thigh: deg + 180, shin: 305, foot: 245 }, arm, anchor: 'knee', at: knee };
    // The ankle opens a little as the body lowers; the foot rolls on its ball.
    const foot = 135 + 0.4 * deg;
    return { torso: deg, head: deg, leg: { thigh: deg + 180, shin: deg + 180, foot, toes: 90 }, arm, anchor: 'ankle', at: sub(ball, ballFrom(foot)) };
  };
  const shoulderAt = (deg: number) => solve('side', build(deg, HANG)).a.shoulder;
  const bodyFor = (y: number) => solveFor(10, 100, (d) => shoulderAt(d).y, y);

  // Hands slightly wider than the shoulders (diamond: wrists inside them).
  const out = diamond ? -0.06 : 0.04;
  const elbowTop = straightOut(out, L.forearm);
  const elbowBottom = diamond ? 0.035 : 0.11;
  // Hands on the floor, or on a bench (seen end-on, its near edge just behind the wrists).
  const surface = incline ? FLOOR - BENCH_H : FLOOR;
  const palmY = surface - BODY.hand / 2;
  // Top: arms locked, wrists just behind the shoulders (diamond: under the chest).
  const behind = diamond ? 0.07 : 0.035;
  const reach = sideReach(176, out, elbowTop, L.forearm);
  const degTop = bodyFor(palmY - Math.sqrt(reach ** 2 - behind ** 2));
  const wrist: Vec = { x: shoulderAt(degTop).x - behind, y: palmY };
  const palm = along(wrist, 90, PALM * seen(L.forearm, out - elbowTop));
  const edge = wrist.x - 0.012;
  const bench: Prop[] = incline ? [{ kind: 'bench', points: [{ x: edge, y: surface + PAD_HALF }, { x: edge + 0.16, y: surface + PAD_HALF }], endOn: true }] : [];
  // Bottom: lowered until the body nearly touches the floor (or the chest the bench).
  const lowest = kneeling ? /trunk \(front\)|^head$/ : /trunk \(front\)|thigh \(front\)|^head$/;
  const gap = (deg: number) =>
    Math.min(
      ...skin(build(deg, HANG), lowest)
        .filter((sp) => !incline || (sp.p.x >= edge && sp.p.x <= edge + 0.16))
        .map((sp) => surface - sp.p.y),
    );
  const degBottom = solveFor(degTop, 100, (d) => -gap(d), -(kneeling ? CLEAR_KNEELING : CLEAR));
  const yTop = shoulderAt(degTop).y;
  const yBottom = shoulderAt(degBottom).y;
  return {
    view: 'side',
    pose: (s) => {
      const deg = bodyFor(lerp(yTop, yBottom, s));
      const shoulder = shoulderAt(deg);
      return build(deg, sidePalm(shoulder, palm, 90, { x: -1, y: -0.5 }, out, lerp(elbowTop, elbowBottom, s)));
    },
    props: bench,
  };
}

// ── Dips ─────────────────────────────────────────────────────────────────

export function dip(o: { onBench: boolean }): Demo {
  return o.onBench ? benchDip() : barDip();
}

/**
 * Parallel-bar dip: hands on the bars by the hips, knees bent with the feet
 * behind. From straight arms, lower until the upper arms are level, elbows
 * pointing back; the body leans forward as it drops, its centre of mass
 * staying over the hands.
 */
function barDip(): Demo {
  const bar: Vec = { x: 0, y: 0 };
  // Directions from the hand to the elbow and from the elbow to the shoulder.
  const fore = (s: number) => lerp(-2, -14, s);
  const upper = (s: number) => lerp(2, 85, s);
  // The legs hang under the hips, swinging back a little as the trunk leans; knees bent, feet behind.
  const legs = (t: number): Leg => {
    const thigh = 172 + 0.35 * t;
    const shin = thigh + 75;
    return { thigh, shin, foot: shin - 65 };
  };
  const build = (s: number, t: number): DemoPose => {
    const elbow = along(bar, fore(s), REACH);
    const shoulder = along(elbow, upper(s), L.upperArm);
    return { torso: t, head: t * 0.5, leg: legs(t), arm: { upper: upper(s) + 180, fore: fore(s) + 180 }, anchor: 'shoulder', at: shoulder };
  };
  return {
    view: 'side',
    floor: null,
    // The trunk leans until the body balances over the hands.
    pose: (s) => build(s, solveFor(-20, 75, (t) => -centreOfMass(solve('side', build(s, t))).x, -bar.x)),
    // The near bar runs front to back, between the body and the near arm.
    props: [{ kind: 'attached', at: 'wrist', from: { x: -0.17, y: 0 }, to: { x: 0.16, y: 0 }, width: 0.024 }],
  };
}

/**
 * Bench dip: hands on the front edge of a bench behind the hips, fingers
 * forward and curled over the edge, legs out in front on the heels. The hips
 * drop straight down close to the bench until the elbows are bent to 90°,
 * pointing back, then press up.
 */
function benchDip(): Demo {
  const top = FLOOR - BENCH_H;
  const edge = 0; // the bench's front edge
  // The palm wraps the edge, fingers pointing forward and down over it.
  const hand = 130;
  const palm = add({ x: edge, y: top }, mul(dir(hand - 90), BODY.hand / 2));
  const wrist = along(palm, hand + 180, PALM);
  const lean = 3; // trunk nearly upright
  // Bottom: elbows at 90°, forearms leaning back a little; the shoulders stay
  // this far in front of the hands, keeping the back and glutes just clear of the bench.
  const elbowBottom = along(wrist, -15, L.forearm);
  const bottom = along(elbowBottom, 75, L.upperArm);
  const yTop = wrist.y - Math.sqrt(sideReach(176, 0, 0, L.forearm) ** 2 - (bottom.x - wrist.x) ** 2);
  const shoulderAt = (s: number): Vec => ({ x: bottom.x, y: lerp(yTop, bottom.y, s) });
  // On the heels, toes up; the knees bend a little more as the hips drop.
  const foot = 20;
  const heelFrom = add(mul(dir(foot), -L.heel), mul(dir(foot + 90), L.ankleHeight));
  const hipTop = along(shoulderAt(0), lean + 180, L.torso);
  const ankleY = FLOOR - heelFrom.y;
  const ankle: Vec = { x: hipTop.x + Math.sqrt(legSpan(164) ** 2 - (ankleY - hipTop.y) ** 2), y: ankleY };
  return {
    view: 'side',
    pose: (s) => {
      const shoulder = shoulderAt(s);
      const hip = along(shoulder, lean + 180, L.torso);
      return {
        torso: lean,
        leg: legTo(hip, ankle, UP, foot),
        arm: sidePalm(shoulder, palm, hand, { x: -1, y: 0 }, 0, 0),
        anchor: 'shoulder',
        at: shoulder,
      };
    },
    // The bench seen end-on, its top under the palms.
    props: [{ kind: 'bench', points: [{ x: edge - 0.16, y: top + PAD_HALF }, { x: edge, y: top + PAD_HALF }], endOn: true }],
  };
}
