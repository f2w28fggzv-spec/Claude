// Movement patterns: squats, lunges and leg machines. Conventions and helpers: ./shared.ts.
import { BODY } from '../body';
import { attachPoints } from '../attach';
import { PAD_HALF } from '../contact';
import { L, PALM, add, along, armTo, dir, gripTo, legTo, lerp, lerpV, mul, solve, sub, type Arm, type DemoPose, type Figure, type Leg, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { O, FLOOR, LEG_LEN, HANG, FWD, centreOfMass, handProp, restingPad, solveFor, type Implement } from './shared';

// ── Balance ──────────────────────────────────────────────────────────────
// A standing lift is balanced when its load sits over the middle of the foot:
// the bar for barbell squats, the whole body (plus anything held) otherwise.

/** The middle of a flat foot, ahead of the ankle (heel to toe). */
const MIDFOOT = (L.foot - L.heel) / 2;

// ── Squats ───────────────────────────────────────────────────────────────

type SquatHold = 'back' | 'front' | 'goblet' | 'arms';

/** Legs from the shin's forward lean and the knee's inner angle (180 = straight). */
const squatLegs = (shinLean: number, knee: number): Leg => ({ thigh: shinLean + knee, shin: 180 + shinLean, foot: 90 });

/**
 * A squat with the feet flat and planted. The knee bends steadily while the
 * torso leans from `startLean` to the lean that keeps the load over the middle
 * of the foot at the bottom; at every frame the shins tilt just enough to keep
 * it there, so the bar travels straight up and down over mid-foot.
 */
export function squat(o: {
  hold: SquatHold;
  /** Thigh direction at the bottom: 90 = parallel, less = hips below the knees. */
  thigh: number;
  /** Shin's forward lean at the bottom (degrees from vertical): how far the knees travel forward. */
  shin: number;
  /** Torso lean at the top. */
  startLean?: number;
  /** Sit down onto a box at the bottom. */
  box?: boolean;
  pauseFar?: number;
}): Demo {
  const barbell = o.hold === 'back' || o.hold === 'front';
  // Held dumbbell for a goblet squat, as a share of body mass.
  const dumbbell = 0.2;
  // Bar over the middle of the foot; a body without a bar balances a little further back.
  const target = barbell ? MIDFOOT - 0.008 : MIDFOOT - 0.01;

  const arms = (f: Figure, torso: number): Arm => {
    const shoulder = f.a.shoulder;
    switch (o.hold) {
      case 'back': {
        // Hands just outside the shoulders, closed around the bar; elbows down and back.
        const bar = attachPoints(f, 'backRack')[0];
        return gripTo(shoulder, bar, dir(torso + 200), 0.8);
      }
      case 'front': {
        // Front rack: bar on the front of the shoulders, fingers under it,
        // elbows pointing forward and up. Wrist ahead of the bar, hand bent back to it.
        const bar = attachPoints(f, 'frontRack')[0];
        const hand = torso + 245;
        const wrist = along(bar, hand + 180, 0.07);
        return { ...armTo(shoulder, wrist, dir(torso + 120), 0.88), hand, flat: true };
      }
      case 'goblet': {
        // Dumbbell held upright against the chest, both hands cupping the top head, elbows down.
        const db = add(along(shoulder, torso + 180, 0.08), mul(dir(torso + 90), BODY.torsoFront + 0.04));
        return gripTo(shoulder, db, dir(torso + 160), 0.95);
      }
      case 'arms':
        // Arms straight out in front at shoulder height, palms down, as a counterweight.
        return { upper: 90, fore: 90, hand: 90, flat: true };
    }
  };
  const build = (shinLean: number, knee: number, torso: number): DemoPose => {
    const p: DemoPose = { torso, head: torso * 0.6, leg: squatLegs(shinLean, knee), arm: HANG, anchor: 'ankle', at: O };
    return { ...p, arm: arms(solve('side', p), torso) };
  };
  const balance = (p: DemoPose): number => {
    const f = solve('side', p);
    if (o.hold === 'back') return attachPoints(f, 'backRack')[0].x;
    if (o.hold === 'front') return attachPoints(f, 'frontRack')[0].x;
    return centreOfMass(f, o.hold === 'goblet' ? [{ at: f.a.hand, share: dumbbell }] : []).x;
  };
  // Bottom: depth and knee travel as given; the torso leans until balanced.
  const kneeBottom = o.thigh - o.shin;
  const leanBottom = solveFor(-20, 80, (t) => balance(build(o.shin, kneeBottom, t)), target);
  const leanTop = o.startLean ?? (o.hold === 'front' ? 2 : o.hold === 'back' ? 9 : 4);
  const pose = (s: number): DemoPose => {
    const knee = lerp(180, kneeBottom, s);
    // The torso leans a little ahead of the knees so the knees travel forward steadily.
    const torso = lerp(leanTop, leanBottom, 1 - (1 - s) ** 1.7);
    const shinLean = solveFor(-25, 70, (v) => balance(build(v, knee, torso)), target);
    return build(shinLean, knee, torso);
  };

  const props: Prop[] = [];
  if (o.hold === 'back') props.push({ kind: 'barbell', at: 'backRack' });
  if (o.hold === 'front') props.push({ kind: 'barbell', at: 'frontRack' });
  if (o.hold === 'goblet') props.push({ kind: 'dumbbell', at: 'wrist', upright: true, cupped: true });
  if (o.box) {
    // Box under the glutes at the bottom: its top just under the back of the thighs.
    const f = solve('side', pose(1));
    const top = f.a.hip.y + BODY.thighBack + 0.003;
    props.push({ kind: 'box', x: f.a.hip.x - 0.16, y: top, w: 0.25, h: FLOOR - top });
  }
  // Goblet: the elbows finish inside the knees.
  return { view: 'side', pose, props, pauseFar: o.pauseFar, armBehindLegs: o.hold === 'goblet' };
}

// ── Feet and hands ───────────────────────────────────────────────────────

/** A foot on the ground or in the air: its ankle, the heel-to-ball direction, and the toes (unset = in line). */
type Foot = { ankle: Vec; foot: number; toes?: number };

/** From the ankle to the heel point / ball of a foot pointing `foot` degrees (see ../figure). */
const heelFrom = (foot: number): Vec => add(mul(dir(foot), -L.heel), mul(dir(foot + 90), L.ankleHeight));
const ballFrom = (foot: number): Vec => add(mul(dir(foot), L.ball), mul(dir(foot + 90), L.ankleHeight));
/** The lowest point of a foot's sole below its ankle (heel, ball or toe tip). */
const soleDepth = (foot: number, toes = foot) => Math.max(heelFrom(foot).y, ballFrom(foot).y, ballFrom(foot).y + dir(toes).y * (L.foot - L.ball));
/** A leg whose foot may bend at the ball. */
const withToes = (leg: Leg, toes: number | undefined): Leg => (toes === undefined ? leg : { ...leg, toes });

/** The upper point where circles around a and b (radii ra, rb) meet. */
function circlesMeet(a: Vec, ra: number, b: Vec, rb: number): Vec {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const t = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - t * t));
  const u = { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
  const m = add(a, mul(u, t));
  const p1 = add(m, { x: u.y * h, y: -u.x * h });
  const p2 = add(m, { x: -u.y * h, y: u.x * h });
  return p1.y < p2.y ? p1 : p2;
}

const smooth = (u: number) => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
};

/**
 * A smooth, monotone curve through v0 (s = 0), v1 (s = a) and v2 (s = 1): it
 * never overshoots a keyframe and keeps moving through v1 (Fritsch–Butland).
 * `easeIn` starts it from rest.
 */
function through(v0: number, v1: number, v2: number, a: number, easeIn = false): (s: number) => number {
  const d0 = (v1 - v0) / a;
  const d1 = (v2 - v1) / (1 - a);
  const m1 = d0 * d1 > 0 ? 2 / (1 / d0 + 1 / d1) : 0;
  const m0 = easeIn ? 0 : d0;
  const hermite = (p0: number, p1: number, m0: number, mEnd: number, h: number, t: number) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * h * mEnd;
  };
  return (s) => (s < a ? hermite(v0, v1, m0, m1, a, s / a) : hermite(v1, v2, m1, d1, 1 - a, (s - a) / (1 - a)));
}

/**
 * A stepping foot: from one planted position to another, lifted in an arc so
 * neither the heel nor the toe touches the floor on the way.
 */
function stepFoot(from: Foot, to: Foot, u: number, lift: number): Foot {
  const e = smooth(u);
  const foot = lerp(from.foot, to.foot, e);
  const toes = lerp(from.toes ?? from.foot, to.toes ?? to.foot, e);
  const ankle = add(lerpV(from.ankle, to.ankle, e), { x: 0, y: -lift * Math.sin(Math.PI * Math.min(1, Math.max(0, u))) });
  // Keep the sole above the floor while the foot turns.
  return { ankle: { x: ankle.x, y: Math.min(ankle.y, FLOOR - soleDepth(foot, toes)) }, foot, toes };
}

/** A leg from hip to ankle whose knee bends forward, whichever way the leg points. */
const kneeForward = (hip: Vec, ankle: Vec, foot: number): Leg => {
  const d = sub(ankle, hip);
  return legTo(hip, ankle, { x: d.y, y: -d.x }, foot);
};

/** Hands resting on the hips: palms on the pelvis, fingers forward, elbows out to the sides. */
function handsOnHips(hip: Vec, torso: number): Arm {
  const scale = 0.82; // the elbows point out to the side, so the arm looks shorter from the side
  const shoulder = along(hip, torso, L.torso);
  const palm = add(along(hip, torso, 0.075), mul(dir(torso + 90), 0.01));
  const hand = torso + 140;
  const wrist = along(palm, hand + 180, PALM * scale);
  return { ...armTo(shoulder, wrist, dir(torso - 100), scale), hand, flat: true };
}

// ── Lunges ───────────────────────────────────────────────────────────────

/** Gap under the back knee (joint centre) at the bottom of a lunge: the kneecap nearly touches the floor. */
const KNEE_GAP = 0.05;

/**
 * Split stance, near (front) foot flat at the origin. At the bottom the front
 * thigh is parallel to the floor and the back knee hovers just above it; the
 * hips drop straight down between the feet. The back foot stays on its ball
 * with the toes flat (the heel rising as the knee drops) or rests on its
 * laces on a bench.
 *
 * `step` starts each rep from standing: stepping back into the lunge (reverse
 * lunge) or forward into it (walking lunge), and back again.
 */
export function lunge(o: { rear: 'floor' | 'bench'; step?: 'back' | 'forward'; implement?: Implement; lean?: number }): Demo {
  const imp = o.implement ?? 'none';
  const bench = o.rear === 'bench';
  // Bottom: front shin a little forward, back knee just above the floor; on
  // the floor the back thigh is nearly vertical (both knees near 90°), with
  // the foot on a bench the front thigh is parallel.
  const kneeF = along(O, bench ? 4 : 6, L.shin);
  const kneeY = FLOOR - KNEE_GAP;
  let hipB: Vec;
  if (bench) hipB = along(kneeF, 270, L.thigh);
  else {
    const y = kneeY - L.thigh * Math.cos((8 * Math.PI) / 180);
    hipB = { x: kneeF.x - Math.sqrt(L.thigh ** 2 - (kneeF.y - y) ** 2), y };
  }
  const kneeR = { x: hipB.x - Math.sqrt(L.thigh ** 2 - (kneeY - hipB.y) ** 2), y: kneeY };
  // A low flat bench (about 40 cm).
  const benchTop = FLOOR - 0.23;
  let rearAt: (s: number) => Foot;
  let hipAt: (s: number) => Vec;
  let frontAt = (_s: number): Foot => ({ ankle: O, foot: 90 });
  if (bench) {
    // Laces on the bench, ankle just past its front edge; the foot stays put.
    const y = benchTop - 0.025;
    const ankle = { x: kneeR.x - Math.sqrt(L.shin ** 2 - (y - kneeR.y) ** 2), y };
    // Top: standing on the front leg, back knee hanging under the hip.
    const hipTop = { x: hipB.x + 0.03, y: -Math.sqrt((LEG_LEN * 0.98) ** 2 - (hipB.x + 0.03) ** 2) };
    rearAt = () => ({ ankle, foot: 262 });
    hipAt = (s) => lerpV(hipTop, hipB, s);
  } else {
    // On the ball of the foot: the ball and the flat toes stay planted while the heel rises and falls.
    const footB = 158;
    const ankleB = { x: 0, y: FLOOR - ballFrom(footB).y };
    ankleB.x = kneeR.x - Math.sqrt(L.shin ** 2 - (ankleB.y - kneeR.y) ** 2);
    const ball = add(ankleB, ballFrom(footB));
    const footTop = 128;
    const ankleTop = sub(ball, ballFrom(footTop));
    // Top of the split stance: both knees nearly straight.
    const hipTop = circlesMeet(O, LEG_LEN * 0.985, ankleTop, LEG_LEN * 0.985);
    // The back foot pivots on its ball from `footTop` (heel low) to `footB` (heel high), toes flat on the floor.
    const toes = (foot: number): Foot => ({ ankle: sub(ball, ballFrom(foot)), foot, toes: 90 });
    const onToes = (u: number) => toes(lerp(footTop, footB, u));
    const split = (u: number) => lerpV(hipTop, hipB, u);
    const a = o.step ? 0.4 : 0; // share of the way out spent stepping
    const lower = (u: number) => (u - a) / (1 - a);
    if (o.step === 'back') {
      // Standing on both feet, the back foot reaches back and lands on its
      // ball while the front knee bends steadily; then straight down.
      const stand = { x: 0.005, y: -LEG_LEN * 0.998 };
      const polar = (p: Vec) => ({ deg: Math.atan2(p.x, -p.y) * (180 / Math.PI), r: Math.hypot(p.x, p.y) });
      const [p0, p1, p2] = [polar(stand), polar(hipTop), polar(hipB)];
      const deg = through(p0.deg, p1.deg, p2.deg, a);
      const r = through(p0.r, p1.r, p2.r, a);
      rearAt = (s) => (s >= a ? onToes(lower(s)) : stepFoot({ ankle: O, foot: 90 }, onToes(0), s / a, 0.035));
      hipAt = (s) => along(O, deg(s), r(s));
    } else if (o.step === 'forward') {
      // Standing with the feet together behind; the front foot steps forward
      // while the body moves over the back foot, whose heel peels up only as
      // far as it must to keep that knee nearly straight.
      const start = sub(ball, ballFrom(90));
      const stand = { x: start.x + 0.005, y: -LEG_LEN * 0.998 };
      const x = through(stand.x, hipTop.x, hipB.x, a);
      const y = through(stand.y, hipTop.y, hipB.y, a, true); // hips stay high until the body is over the back foot
      hipAt = (s) => ({ x: x(s), y: y(s) });
      const reachTop = Math.hypot(hipTop.x - toes(footTop).ankle.x, hipTop.y - toes(footTop).ankle.y);
      rearAt = (s) => {
        if (s >= a) return onToes(lower(s));
        const hip = hipAt(s);
        const want = lerp(legSpan(172), reachTop, smooth(s / a));
        const reach = (foot: number) => Math.hypot(hip.x - toes(foot).ankle.x, hip.y - toes(foot).ankle.y);
        // Raising the heel brings the ankle closer to the hip.
        const foot = reach(90) <= want ? 90 : solveFor(90, footTop, (f) => -reach(f), -want);
        return toes(foot);
      };
      frontAt = (s) => (s >= a ? { ankle: O, foot: 90 } : stepFoot({ ankle: start, foot: 90 }, { ankle: O, foot: 90 }, s / a, 0.05));
    } else {
      rearAt = onToes;
      hipAt = split;
    }
  }
  const pad: Prop | undefined = bench
    ? (() => {
        const edge = rearAt(1).ankle.x - 0.02;
        const y = benchTop + PAD_HALF;
        return { kind: 'bench', points: [{ x: edge - 0.3, y }, { x: edge, y }] };
      })()
    : undefined;
  return lungeDemo(o, imp, hipAt, rearAt, frontAt, pad);
}

function lungeDemo(
  o: { lean?: number },
  imp: Implement,
  hipAt: (s: number) => Vec,
  rearAt: (s: number) => Foot,
  frontAt: (s: number) => Foot,
  bench: Prop | undefined,
): Demo {
  const pose = (s: number): DemoPose => {
    const hip = hipAt(s);
    const torso = lerp(3, o.lean ?? 6, s);
    const rear = rearAt(s);
    const front = frontAt(s);
    return {
      torso,
      // Dumbbells hang straight down at the sides; without them, hands on the hips.
      arm: imp === 'none' ? handsOnHips(hip, torso) : HANG,
      leg: withToes(kneeForward(hip, front.ankle, front.foot), front.toes),
      leg2: withToes(kneeForward(hip, rear.ankle, rear.foot), rear.toes),
      anchor: 'hip',
      at: hip,
    };
  };
  const props: Prop[] = [...handProp(imp, 'wrists', { lengthwise: true })];
  if (bench) props.push(bench);
  return { view: 'side', pose, props };
}

// ── Step-up ──────────────────────────────────────────────────────────────

/**
 * Lead (near) foot flat on a knee-high box, lead knee bent about 90°, trailing
 * foot flat on the floor. Drive up through the lead leg to stand tall on the
 * box; the trailing foot rolls onto its ball, swings up over the box's edge and
 * lands next to the lead foot. Stepping down is the same path in reverse.
 */
export function stepUp(o: { implement?: Implement }): Demo {
  const boxH = 0.25;
  const top = FLOOR - boxH;
  const lead: Vec = { x: 0, y: top - L.ankleHeight };
  const edge = -0.12; // the box's near edge
  const trail: Vec = { x: -0.3, y: 0 };
  const ball = add(trail, ballFrom(90));
  const pushFoot = 128; // trailing foot on its ball, toes flat, just before it leaves the floor
  const lift = { ankle: sub(ball, ballFrom(pushFoot)), foot: pushFoot };
  const hipStart: Vec = { x: -0.25, y: -LEG_LEN * 0.985 };
  const hipTop: Vec = { x: lead.x + 0.005, y: lead.y - LEG_LEN * 0.998 };
  // Swing over the box's edge: a curve through a point well above it.
  const over: Vec = { x: edge - 0.09, y: top - 0.28 };
  const bezier = (u: number): Vec => {
    const e = smooth(u);
    const a = (1 - e) * (1 - e);
    const b = 2 * e * (1 - e);
    const c = e * e;
    return { x: a * lift.ankle.x + b * over.x + c * lead.x, y: a * lift.ankle.y + b * over.y + c * lead.y };
  };
  const trailAt = (s: number): Foot => {
    if (s < 0.25) {
      // Heel rises, the ball and toes stay down.
      const foot = lerp(90, pushFoot, smooth(s / 0.25));
      return { ankle: sub(ball, ballFrom(foot)), foot, toes: 90 };
    }
    if (s < 0.85) {
      // The toes leave the floor last and relax into line with the foot.
      const u = (s - 0.25) / 0.6;
      const foot = lerp(pushFoot, 90, smooth(u));
      return { ankle: bezier(u), foot, toes: lerp(90, foot, smooth(u / 0.3)) };
    }
    return { ankle: lead, foot: 90 };
  };
  const pose = (s: number): DemoPose => {
    // Weight shifts forward over the lead foot first, then the body rises.
    const hip = { x: lerp(hipStart.x, hipTop.x, smooth(s * 1.3)), y: lerp(hipStart.y, hipTop.y, smooth(s)) };
    const t = trailAt(s);
    return {
      torso: lerp(16, 2, smooth(s)),
      leg: kneeForward(hip, lead, 90),
      leg2: withToes(kneeForward(hip, t.ankle, t.foot), t.toes),
      arm: HANG,
      anchor: 'hip',
      at: hip,
    };
  };
  return {
    view: 'side',
    pose,
    props: [{ kind: 'box', x: edge, y: top, w: 0.34, h: boxH }, ...handProp(o.implement ?? 'none', 'wrists', { lengthwise: true })],
  };
}

// ── Pistol squat ─────────────────────────────────────────────────────────

/**
 * Single-leg squat on the near leg to full depth, the other leg held straight
 * out in front and off the floor, arms reaching forward. The torso leans just
 * enough to keep the body over the middle of the standing foot.
 */
export function pistol(): Demo {
  const shinB = 36;
  const kneeB = 38;
  const free = (s: number): Leg => {
    const thigh = lerp(160, 86, 1 - (1 - s) ** 1.4);
    return { thigh, shin: thigh, foot: thigh - 85 };
  };
  const build = (shinLean: number, knee: number, torso: number, s: number): DemoPose => ({
    torso,
    head: torso * 0.6,
    leg: squatLegs(shinLean, knee),
    leg2: free(s),
    arm: { upper: 88, fore: 88, hand: 88, flat: true },
    anchor: 'ankle',
    at: O,
  });
  const target = MIDFOOT - 0.005;
  const com = (p: DemoPose) => centreOfMass(solve('side', p)).x;
  const leanB = solveFor(-10, 80, (t) => com(build(shinB, kneeB, t, 1)), target);
  return {
    view: 'side',
    pose: (s) => {
      const knee = lerp(180, kneeB, s);
      const torso = lerp(3, leanB, 1 - (1 - s) ** 1.6);
      const shinLean = solveFor(-25, 70, (v) => com(build(v, knee, torso, s)), target);
      return build(shinLean, knee, torso, s);
    },
  };
}

// ── Wall sit ─────────────────────────────────────────────────────────────

/** Back flat against the wall, thighs level, shins vertical, arms folded across the chest. */
export function wallSit(): Demo {
  const torso = -2; // just enough to bring the upper back onto the wall too
  const base: DemoPose = { torso, leg: { thigh: 90, shin: 180, foot: 90 }, arm: HANG, anchor: 'ankle', at: O };
  // Folded arms: elbows in front of the ribs, fists resting under the opposite collarbone.
  const shoulder = solve('side', base).a.shoulder;
  const wrist = add(along(shoulder, torso + 90, BODY.torsoFront + 0.02), mul(dir(torso), -0.05));
  const p: DemoPose = { ...base, arm: { ...armTo(shoulder, wrist, dir(torso + 150)), hand: torso - 60 } };
  const f = solve('side', p);
  const back = (k: number) => along(lerpV(f.a.hip, f.a.shoulder, k), torso - 90, BODY.torsoBack).x;
  const wallX = Math.min(along(f.a.hip, torso - 90, BODY.glute).x, back(0.85));
  return { view: 'side', pose: () => p, props: [{ kind: 'wall', x: wallX, top: f.head.y - 0.12 }] };
}

// ── Machines ─────────────────────────────────────────────────────────────

/** Where the lines through a1-b1 and a2-b2 cross. */
function crossing(a1: Vec, b1: Vec, a2: Vec, b2: Vec): Vec {
  const d1 = sub(b1, a1);
  const d2 = sub(b2, a2);
  const t = ((a2.x - a1.x) * d2.y - (a2.y - a1.y) * d2.x) / (d1.x * d2.y - d1.y * d2.x);
  return add(a1, mul(d1, t));
}

/** Hip-to-ankle distance with the knee bent to `deg` (180 = straight). */
const legSpan = (deg: number) => Math.sqrt(L.thigh ** 2 + L.shin ** 2 - 2 * L.thigh * L.shin * Math.cos((deg * Math.PI) / 180));

/** How far along `u` from p the distance to the origin reaches r. */
const outTo = (p: Vec, u: Vec, r: number) => {
  const b = p.x * u.x + p.y * u.y;
  return -b + Math.sqrt(b * b - (p.x ** 2 + p.y ** 2 - r * r));
};

/**
 * 45° leg press: reclined in the seat, hands on the handles beside it, feet
 * flat on the sled's footplate. The sled runs down its rails until the knees
 * are bent about 90° (thighs near the chest, lower back still on the pad) and
 * is pushed back up without locking the knees.
 */
export function legPress(): Demo {
  const torso = -58;
  const rail = 45; // the sled's direction of travel, up and away
  const plate = -15; // footplate slope: feet point up it
  // Bottom: thighs just past vertical, knees about 90°.
  const kneeB = along(O, 8, L.thigh);
  const ankleB = along(kneeB, 98, L.shin);
  // Top: pushed up the rails until the knees are nearly straight (165°).
  const u = dir(rail);
  const travel = outTo(ankleB, u, legSpan(165));
  const ankleTop = add(ankleB, mul(u, travel));
  const shoulder = along(O, torso, L.torso);
  const pose = (s: number): DemoPose => ({
    torso,
    leg: legTo(O, lerpV(ankleTop, ankleB, s), { x: -0.3, y: -1 }, plate),
    // Arms along the sides to the handles, elbows slightly bent away from the back pad.
    arm: gripTo(shoulder, PRESS_HANDLE, dir(torso + 90)),
    anchor: 'hip',
    at: O,
  });
  // Footplate under the soles, moving with the feet; its lower end rides on the rails.
  const sole = mul(dir(plate + 90), L.ankleHeight + 0.014);
  const plateLow = add(sole, mul(dir(plate), -0.11));
  const footplate: Prop = { kind: 'attached', at: 'ankle', from: plateLow, to: add(sole, mul(dir(plate), 0.2)), width: 0.028 };
  const rails: Prop = { kind: 'line', from: add(add(ankleB, plateLow), mul(u, -0.12)), to: add(add(ankleTop, plateLow), mul(u, 0.25)), width: 0.03 };
  // Seat: back pad from behind the head to the hips, seat pan under the glutes.
  const behind = mul(dir(torso - 90), BODY.torsoBack + PAD_HALF);
  const [b0, b1] = restingPad(pose, add(along(O, torso, 0.5), behind), add(along(O, torso, 0.02), behind), /hand|forearm/);
  const panDir = dir(62);
  const pan0 = add(O, mul(dir(torso - 90), BODY.glute + PAD_HALF));
  const [p0, p1] = restingPad(pose, add(pan0, mul(panDir, -0.04)), add(pan0, mul(panDir, 0.12)), /hand|forearm/);
  const corner = crossing(b0, b1, p0, p1);
  return {
    view: 'side',
    floor: 0.3,
    pose,
    props: [rails, { kind: 'bench', points: [b0, corner, p1], legs: true }, { kind: 'bar', at: PRESS_HANDLE }, footplate],
  };
}
/** Leg-press handle beside the seat, by the hip. */
const PRESS_HANDLE: Vec = { x: 0.04, y: -0.03 };

/**
 * Hack squat: back flat on the sled's pad, shoulders under the shoulder pads,
 * hands on the handles, feet on the angled platform ahead of the hips. The
 * sled slides down its rails until the thighs are parallel to the platform.
 */
export function hackSquat(): Demo {
  const torso = -28; // the rails' slope: the back stays on the pad
  const tilt = 15; // platform, toes up
  const foot = 90 - tilt;
  // Bottom: thighs parallel to the platform, shins tilted forward.
  const kneeB = along(O, 14, L.shin);
  const hipB = along(kneeB, foot + 180, L.thigh);
  // Top: slid up the rails until the knees are nearly straight (about 165°).
  const up = dir(torso);
  const travel = outTo(hipB, up, legSpan(165));
  const hipTop = add(hipB, mul(up, travel));
  const pose = (s: number): DemoPose => {
    const hip = lerpV(hipTop, hipB, s);
    const shoulder = along(hip, torso, L.torso);
    // Handles at the front of the shoulder pads, about chest high; elbows down.
    const handle = add(along(shoulder, torso + 90, 0.09), mul(dir(torso), -0.06));
    return { torso, leg: legTo(hip, O, FWD, foot), arm: gripTo(shoulder, handle, dir(torso + 160), 0.85), anchor: 'hip', at: hip };
  };
  // Platform under the feet, tilted toes up.
  const heel = add(O, heelFrom(foot));
  const plateDir = dir(foot);
  const plateN = dir(foot + 90);
  const p0 = add(add(heel, mul(plateDir, -0.06)), mul(plateN, 0.014));
  const p1 = add(p0, mul(plateDir, 0.26));
  // Sled: pad behind the back from the lower back up past the shoulders,
  // moving with the lifter, and the rails it runs on.
  const behind = dir(torso - 90);
  const sledPad: Prop = {
    kind: 'attached',
    at: 'hip',
    from: add(mul(behind, BODY.torsoBack + 0.022), mul(up, 0.04)),
    to: add(mul(behind, BODY.torsoBack + 0.022), mul(up, L.torso + 0.06)),
    width: 0.04,
    pad: true,
  };
  const railBase = add(hipB, mul(behind, BODY.torsoBack + 0.07));
  const rails: Prop = { kind: 'line', from: add(railBase, mul(up, -0.12)), to: add(railBase, mul(up, travel + L.torso + 0.2)), width: 0.03 };
  return {
    view: 'side',
    floor: Math.max(p0.y, p1.y) + 0.03,
    pose,
    // Rails, sled pad, platform and the shoulder pad resting on top of the shoulder.
    props: [rails, sledPad, { kind: 'line', from: p0, to: p1, width: 0.028 }, { kind: 'pad', at: 'shoulder', offset: add(mul(up, 0.045), mul(dir(torso + 90), 0.01)) }],
  };
}

/**
 * Leg extension: seated upright against the back pad, knees at the seat's
 * edge (in line with the machine's pivot), shin pad on the front of the
 * ankles, hands on the handles. Straighten the knees fully, lower under control.
 */
export function legExtension(): Demo {
  const torso = -12;
  const shoulder = along(O, torso, L.torso);
  const pose = (s: number): DemoPose => {
    const shin = lerp(190, 95, s);
    return { torso, leg: { thigh: 90, shin, foot: shin - 90 }, arm: gripTo(shoulder, SEAT_HANDLE, { x: 0.3, y: 1 }), anchor: 'hip', at: O };
  };
  // Back pad behind the trunk; seat under the thighs, its front edge clear of the calves.
  const behind = mul(dir(torso - 90), BODY.torsoBack + PAD_HALF);
  const [b0, b1] = restingPad(pose, add(along(O, torso, 0.44), behind), add(along(O, torso, 0.02), behind), /hand|forearm/);
  const seatY = BODY.thighBack + PAD_HALF;
  const [s0, s1] = restingPad(pose, { x: -0.06, y: seatY }, { x: 0.165, y: seatY }, /hand|forearm/);
  return {
    view: 'side',
    floor: 0.33,
    pose,
    props: [
      { kind: 'bench', points: [b0, crossing(b0, b1, s0, s1), s1], legs: true },
      { kind: 'bar', at: SEAT_HANDLE },
      // Roller on the front of the shins just above the ankles, turning with them.
      { kind: 'pad', at: 'ankle', frame: 'shin', offset: { x: -0.04, y: -(BODY.shinFront + 0.037) } },
    ],
  };
}
/** Leg-extension handle at the side of the seat, by the hip. */
const SEAT_HANDLE: Vec = { x: 0.05, y: 0.02 };
