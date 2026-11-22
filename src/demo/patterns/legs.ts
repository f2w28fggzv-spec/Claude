// Movement patterns: squats, lunges and leg machines. Conventions and helpers: ./shared.ts.
import { BODY } from '../body';
import { attachPoints } from '../attach';
import { PAD_HALF } from '../contact';
import { L, PALM, add, along, angleOf, armTo, dir, gripTo, legTo, lerp, lerpV, mul, solve, sub, type Arm, type DemoPose, type Figure, type Leg, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { O, FLOOR, LEG_LEN, HANG, FWD, DOWN, chainUp, standing, between, handProp, type Implement } from './shared';

// ── Balance ──────────────────────────────────────────────────────────────
// A standing lift is balanced when its load sits over the middle of the foot:
// the bar for barbell squats, the whole body (plus anything held) otherwise.

/** The middle of a flat foot, ahead of the ankle (heel to toe). */
export const MIDFOOT = (L.foot - L.heel) / 2;

/** Segment masses as a share of body mass (Winter 2009). */
const MASS = { head: 0.081, trunk: 0.497, upperArm: 0.028, forearm: 0.016, hand: 0.006, thigh: 0.1, shank: 0.0465, foot: 0.0145 };

/** Centre of mass of the body plus held loads (`share` = load mass / body mass). */
export function centreOfMass(f: Figure, loads: { at: Vec; share: number }[] = []): Vec {
  const parts: [number, Vec][] = [
    [MASS.head, f.head],
    [MASS.trunk, lerpV(lerpV(f.a.hip, f.b.hip, 0.5), lerpV(f.a.shoulder, f.b.shoulder, 0.5), 0.5)],
  ];
  for (const s of [f.a, f.b]) {
    parts.push(
      [MASS.upperArm, lerpV(s.shoulder, s.elbow, 0.436)],
      [MASS.forearm, lerpV(s.elbow, s.wrist, 0.43)],
      [MASS.hand, s.hand],
      [MASS.thigh, lerpV(s.hip, s.knee, 0.433)],
      [MASS.shank, lerpV(s.knee, s.ankle, 0.433)],
      [MASS.foot, lerpV(s.heel, s.toe, 0.5)],
    );
  }
  for (const l of loads) parts.push([l.share, l.at]);
  const m = parts.reduce((a, [w]) => a + w, 0);
  return { x: parts.reduce((a, [w, p]) => a + w * p.x, 0) / m, y: parts.reduce((a, [w, p]) => a + w * p.y, 0) / m };
}

/** The v in [lo, hi] where the increasing function f reaches target (bisection). */
function solveFor(lo: number, hi: number, f: (v: number) => number, target: number): number {
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

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
        // Dumbbell held upright against the chest, both hands around the handle, elbows down.
        const db = add(along(shoulder, torso + 180, 0.08), mul(dir(torso + 90), BODY.torsoFront + 0.04));
        return gripTo(shoulder, db, dir(torso + 160), 0.95);
      }
      case 'arms':
        // Arms straight out in front at shoulder height, as a counterweight.
        return { upper: 90, fore: 90 };
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
  if (o.hold === 'goblet') props.push({ kind: 'dumbbell', at: 'wrist', upright: true });
  if (o.box) {
    // Box under the glutes at the bottom: its top just under the back of the thighs.
    const f = solve('side', pose(1));
    const top = f.a.hip.y + BODY.thighBack + 0.003;
    props.push({ kind: 'box', x: f.a.hip.x - 0.16, y: top, w: 0.25, h: FLOOR - top });
  }
  return { view: 'side', pose, props, pauseFar: o.pauseFar };
}

// ── Feet and hands ───────────────────────────────────────────────────────

/** From the ankle to the toe point / heel point of a foot pointing `foot` degrees (see ../figure). */
const toeFrom = (foot: number): Vec => add(mul(dir(foot), L.foot), mul(dir(foot + 90), L.ankleHeight));
const heelFrom = (foot: number): Vec => add(mul(dir(foot), -L.heel), mul(dir(foot + 90), L.ankleHeight));

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
 * A stepping foot: from one planted position to another, lifted in an arc so
 * neither the heel nor the toe touches the floor on the way.
 */
function stepFoot(from: { ankle: Vec; foot: number }, to: { ankle: Vec; foot: number }, u: number, lift: number) {
  const e = smooth(u);
  const foot = lerp(from.foot, to.foot, e);
  const ankle = add(lerpV(from.ankle, to.ankle, e), { x: 0, y: -lift * Math.sin(Math.PI * Math.min(1, Math.max(0, u))) });
  // Keep the sole above the floor while the foot turns.
  const low = Math.max(heelFrom(foot).y, toeFrom(foot).y);
  return { ankle: { x: ankle.x, y: Math.min(ankle.y, FLOOR - low) }, foot };
}

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
 * hips drop straight down between the feet. The back foot stays on its toes
 * (pivoting as the knee drops) or rests on its laces on a bench.
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
  let rearAt: (s: number) => { ankle: Vec; foot: number };
  let hipAt: (s: number) => Vec;
  if (bench) {
    // Laces on the bench, ankle just past its front edge; the foot stays put.
    const y = benchTop - 0.025;
    const ankle = { x: kneeR.x - Math.sqrt(L.shin ** 2 - (y - kneeR.y) ** 2), y };
    // Top: standing on the front leg, back knee hanging under the hip.
    const hipTop = { x: hipB.x + 0.03, y: -Math.sqrt((LEG_LEN * 0.98) ** 2 - (hipB.x + 0.03) ** 2) };
    rearAt = () => ({ ankle, foot: 262 });
    hipAt = (s) => lerpV(hipTop, hipB, s);
  } else {
    // On the toes: the toe point stays planted while the heel rises and falls.
    const footB = 172;
    const ankleB = { x: 0, y: FLOOR - toeFrom(footB).y };
    ankleB.x = kneeR.x - Math.sqrt(L.shin ** 2 - (ankleB.y - kneeR.y) ** 2);
    const toe = add(ankleB, toeFrom(footB));
    const footTop = 140;
    const ankleTop = sub(toe, toeFrom(footTop));
    // Top of the split stance: both knees nearly straight.
    const hipTop = circlesMeet(O, LEG_LEN * 0.985, ankleTop, LEG_LEN * 0.985);
    const onToes = (u: number) => {
      const foot = lerp(footTop, footB, u);
      return { ankle: sub(toe, toeFrom(foot)), foot };
    };
    const split = (u: number) => lerpV(hipTop, hipB, u);
    const a = 0.4; // share of the way out spent stepping
    if (o.step === 'back') {
      // Standing on both feet, then the back foot reaches back and lands on its toes.
      const stand = { x: 0.005, y: -LEG_LEN * 0.998 };
      rearAt = (s) => (s >= a ? onToes((s - a) / (1 - a)) : stepFoot({ ankle: O, foot: 90 }, onToes(0), s / a, 0.035));
      hipAt = (s) => (s >= a ? split((s - a) / (1 - a)) : lerpV(stand, hipTop, smooth(s / a)));
    } else if (o.step === 'forward') {
      // Standing with the feet together behind; the front foot steps forward while the back heel rises.
      const start = sub(toe, toeFrom(90));
      const stand = { x: start.x + 0.005, y: -LEG_LEN * 0.998 };
      rearAt = (s) => (s >= a ? onToes((s - a) / (1 - a)) : (() => {
        const foot = lerp(90, footTop, smooth(s / a));
        return { ankle: sub(toe, toeFrom(foot)), foot };
      })());
      hipAt = (s) => (s >= a ? split((s - a) / (1 - a)) : lerpV(stand, hipTop, smooth(s / a)));
      const frontAt = (s: number) => (s >= a ? { ankle: O, foot: 90 } : stepFoot({ ankle: start, foot: 90 }, { ankle: O, foot: 90 }, s / a, 0.05));
      return lungeDemo(o, imp, hipAt, rearAt, frontAt, undefined);
    } else {
      rearAt = (s) => onToes(s);
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
  return lungeDemo(o, imp, hipAt, rearAt, () => ({ ankle: O, foot: 90 }), pad);
}

function lungeDemo(
  o: { lean?: number },
  imp: Implement,
  hipAt: (s: number) => Vec,
  rearAt: (s: number) => { ankle: Vec; foot: number },
  frontAt: (s: number) => { ankle: Vec; foot: number },
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
      leg: legTo(hip, front.ankle, FWD, front.foot),
      leg2: legTo(hip, rear.ankle, DOWN, rear.foot),
      anchor: 'hip',
      at: hip,
    };
  };
  const props: Prop[] = [...handProp(imp, 'wrists')];
  if (bench) props.push(bench);
  return { view: 'side', pose, props };
}

export function stepUp(o: { implement?: Implement }): Demo {
  const boxH = 0.26;
  const top = FLOOR - boxH;
  const front: Vec = { x: 0, y: top - L.ankleHeight };
  const rearFloor: Vec = { x: -0.32, y: 0 };
  const rearUp: Vec = { x: -0.03, y: front.y - 0.02 };
  const pose = (s: number): DemoPose => {
    const hip = lerpV({ x: -0.17, y: front.y - 0.33 }, { x: -0.01, y: front.y - LEG_LEN * 0.985 }, s);
    const rear = lerpV(rearFloor, rearUp, s);
    return {
      torso: lerp(12, 2, s),
      leg: legTo(hip, front, FWD),
      leg2: { ...legTo(hip, rear, FWD), foot: lerp(110, 90, s) },
      arm: HANG,
      anchor: 'ankle',
      at: front,
    };
  };
  return {
    view: 'side',
    pose,
    props: [{ kind: 'box', x: -0.12, y: top, w: 0.3, h: boxH }, ...handProp(o.implement ?? 'none')],
  };
}

export function pistol(): Demo {
  return {
    view: 'side',
    pose: between(
      standing({ arm: { upper: 90, fore: 90 }, leg2: { thigh: 165, shin: 165, foot: 60 } }),
      standing({ torso: 42, head: 20, leg: { thigh: 68, shin: 218, foot: 90 }, leg2: { thigh: 92, shin: 92, foot: 0 }, arm: { upper: 90, fore: 90 } }),
    ),
  };
}

export function wallSit(): Demo {
  const p = standing({ leg: { thigh: 90, shin: 180, foot: 90 }, arm: { upper: 175, fore: 175 } });
  const { hip } = chainUp(O, 180, 90, 0);
  return { view: 'side', pose: () => p, props: [{ kind: 'wall', x: hip.x - 0.06, top: hip.y - 0.55 }] };
}

export function legPress(): Demo {
  const hip = O;
  const torso = -58;
  const line = 52; // direction the sled travels
  const pose = (s: number): DemoPose => {
    const ankle = along(hip, line, lerp(LEG_LEN * 0.97, 0.27, s));
    return {
      torso,
      leg: legTo(hip, ankle, { x: -0.5, y: -1 }, line - 90),
      arm: { upper: torso + 175, fore: torso + 175 },
      anchor: 'hip',
      at: hip,
    };
  };
  return {
    view: 'side',
    floor: 0.2,
    pose,
    props: [
      { kind: 'bench', points: [along(add(hip, { x: 0.02, y: 0.05 }), torso, 0.46), add(hip, { x: 0.08, y: 0.06 })], legs: true },
      { kind: 'attached', at: 'ankle', from: along(along(O, line, 0.05), line - 90, 0.17), to: along(along(O, line, 0.05), line + 90, 0.06), width: 0.025 },
    ],
  };
}

export function legExtension(): Demo {
  const torso = -8;
  const pose = (s: number): DemoPose => {
    const shin = lerp(180, 94, s);
    return { torso, leg: { thigh: 90, shin, foot: shin - 90 }, arm: { upper: 172, fore: 172 }, anchor: 'hip', at: O };
  };
  return {
    view: 'side',
    floor: 0.33,
    pose,
    props: [
      { kind: 'bench', points: [along({ x: -0.05, y: 0.06 }, torso, 0.42), { x: -0.05, y: 0.06 }, { x: 0.24, y: 0.06 }], legs: true },
      { kind: 'pad', at: 'ankle', offset: { x: 0.035, y: -0.02 } },
    ],
  };
}

export function hackSquat(): Demo {
  return squat({ hold: 'arms', thigh: 82, shin: 26 });
}
