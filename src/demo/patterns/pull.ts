// Movement patterns: rows, pull-ups and pulldowns. Conventions and helpers: ./shared.ts.
//
// What the hands hold stays outside the body: a barbell comes up to touch the
// front of the torso, dumbbells come up beside it under the elbows, a pull-up
// bar passes in front of the face with the chin finishing over it. Grips wider
// than the shoulders are worked out in 3D and drawn as the side view sees them
// (an elbow pointing out to the side makes the upper arm look short). Standing
// rows balance over the middle of the foot; bodies rest on benches and pads by
// their skin (BODY), and planted feet stay where they are.
import { BODY } from '../body';
import { PAD_HALF } from '../contact';
import { L, GRIP, PALM, add, along, angleOf, dir, dist, gripTo, legTo, lerp, lerpV, mul, palmTo, solve, sub, type Arm, type DemoPose, type Figure, type Leg, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { O, FLOOR, LEG_LEN, HANG, BACK, FWD, centreOfMass, handProp, restingPad, solveFor, type Implement } from './shared';

/** Shoulder to the middle of the fist, arm straight. */
const REACH = L.upperArm + L.forearm + GRIP;
/** A bar's end as ../equipment draws it. */
const BAR_R = 0.02;
/** A rack's J-hook: from the upright out to the bar it holds (about 14 cm). */
const HOOK = 0.08;
/** The middle of a flat foot, ahead of the ankle (heel to toe). */
const MIDFOOT = (L.foot - L.heel) / 2;
/** A flat bench's pad top above the floor (43 cm on a 1.75 m lifter). */
const BENCH_H = 0.245;

// ── Helpers ──────────────────────────────────────────────────────────────

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

/**
 * A straight path from a to b, bowed out to the front (the +x side) just
 * enough that `clear` stays positive all along it.
 */
function bowedPath(a: Vec, b: Vec, clear: (p: Vec) => number): (s: number) => Vec {
  const d = sub(b, a);
  const len = Math.hypot(d.x, d.y);
  const n = d.y <= 0 ? { x: -d.y / len, y: d.x / len } : { x: d.y / len, y: -d.x / len };
  const path = (k: number) => (s: number) => add(lerpV(a, b, s), mul(n, k * 4 * s * (1 - s)));
  const ok = (k: number) => {
    for (let i = 1; i < 40; i++) if (clear(path(k)(i / 40)) < 0.004) return false;
    return true;
  };
  if (ok(0)) return path(0);
  let lo = 0;
  let hi = 0.02;
  while (!ok(hi) && hi < 0.3) hi *= 2;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (ok(m)) hi = m;
    else lo = m;
  }
  return path(hi);
}

/** A direction in 3D for the side view: x forward, y down (as on screen), z out to the side (toward the camera for the near arm). */
interface Dir3 {
  x: number;
  y: number;
  z: number;
}

/**
 * An arm worked out in 3D and drawn as the side view sees it: the shoulder at
 * `shoulder`, the fist closed on `grip`, which is `out` further from the
 * body's midline than the shoulder joint (a grip wider than the shoulders).
 * The elbow bends toward `toward`; where it points out to the side, toward
 * the camera, the upper arm (Arm.scale) or forearm (Arm.foreScale) looks short.
 */
function sideArm(shoulder: Vec, grip: Vec, out: number, toward: Dir3): Arm {
  const l1 = L.upperArm;
  const l2 = L.forearm + GRIP;
  const h = { x: grip.x - shoulder.x, y: grip.y - shoulder.y, z: out };
  const len = Math.hypot(h.x, h.y, h.z);
  const u = { x: h.x / len, y: h.y / len, z: h.z / len };
  const d = Math.min(l1 + l2 - 1e-6, Math.max(Math.abs(l1 - l2) + 1e-6, len));
  // The elbow lies on a circle around the shoulder-to-fist line: its point furthest toward `toward`.
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const r = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const tu = toward.x * u.x + toward.y * u.y + toward.z * u.z;
  const w = { x: toward.x - tu * u.x, y: toward.y - tu * u.y, z: toward.z - tu * u.z };
  const wl = Math.hypot(w.x, w.y, w.z) || 1;
  const elbow = { x: u.x * a + (w.x / wl) * r, y: u.y * a + (w.y / wl) * r };
  const fore = { x: u.x * d - elbow.x, y: u.y * d - elbow.y };
  return { upper: angleOf(elbow), fore: angleOf(fore), scale: Math.hypot(elbow.x, elbow.y) / l1, foreScale: Math.hypot(fore.x, fore.y) / l2 };
}

/** Most a rowing forearm leans from plumb on the way up (the hand ahead of the elbow). */
const ROW_TILT = 15;

/**
 * A dumbbell row with a neutral grip, elbow close to the side: from hanging
 * straight under the shoulder (s = 0) to the finish beside the waist (s = 1),
 * where the upper arm points `past` degrees beyond the trunk line, the elbow
 * above the back, and the forearm hangs plumb. On the way the dumbbell rises
 * from the first moment, up and back along a nearly straight line: the
 * straight line from hang to finish, bowed toward the arc a plumb forearm
 * would swing through just enough that the forearm never leans more than
 * ROW_TILT. (Swinging the arm with the forearm plumb all the way would first
 * carry the dumbbell back toward the knees, hardly rising.) The elbow leads,
 * up and back.
 */
function rowArm(shoulder: Vec, torso: number, past: number): (s: number) => Arm {
  const hang = add(shoulder, { x: 0, y: REACH });
  const plumb = (s: number) => add(along(shoulder, lerp(180, torso + 180 + past, s), L.upperArm), { x: 0, y: L.forearm + GRIP });
  const finish = plumb(1);
  const back = { x: -1, y: -0.3 };
  const armFor = (bow: number) => (s: number): Arm => gripTo(shoulder, lerpV(lerpV(hang, finish, s), plumb(s), bow), back);
  const tilt = (bow: number) => {
    let most = 0;
    for (let k = 1; k < 20; k++) {
      const arm = armFor(bow)(k / 20);
      most = Math.max(most, Math.abs(((arm.fore - 180 + 540) % 360) - 180));
    }
    return most;
  };
  return armFor(solveFor(0, 1, (bow) => -tilt(bow), -ROW_TILT));
}

/**
 * Where the floor pushes back on a standing body (its x), with a cable pulling
 * the hands toward `pulley` (`tension` as a share of body weight). Balanced
 * when it sits over the middle of the foot.
 */
function pressureX(f: Figure, floor: number, cable: { pulley: Vec; tension: number }): number {
  const com = centreOfMass(f);
  const hand = f.a.hand;
  const len = dist(cable.pulley, hand);
  const u = mul(sub(cable.pulley, hand), 1 / len);
  // Moments about the point on the floor: body weight at the centre of mass, the cable at the hand.
  const t = cable.tension;
  return (com.x + t * (hand.x * u.y - (hand.y - floor) * u.x)) / (1 + t * u.y);
}

// ── Rows ─────────────────────────────────────────────────────────────────

/**
 * Rows. Standing (barbell or dumbbells): hinged with a flat back, the weight
 * rowed to the torso. `oneArm`: one knee and hand on a flat bench. `chestSupported`:
 * lying face down on an incline bench. `torso` is the trunk's lean from
 * vertical (standing and chest-supported; the one-arm row's follows from the
 * bench).
 */
export function row(o: { implement: Implement; torso?: number; oneArm?: boolean; chestSupported?: boolean }): Demo {
  if (o.oneArm) return oneArmRow(o.implement);
  if (o.chestSupported) return chestSupportedRow(o.implement, o.torso ?? 50);
  return bentOverRow(o.implement === 'barbell' ? 'barbell' : 'dumbbell', o.torso ?? 70);
}

/**
 * Bent-over row: hinged with a flat back and bent knees, shins nearly
 * vertical, feet flat. Only the arms move. The weight hangs straight under
 * the shoulders; the hips sit back until lifter and weight balance over the
 * middle of the foot. Barbell: overhand a little wider than the shoulders,
 * elbows out at about 45°, the bar rowed in front of the knees and thighs to
 * the lower ribs. Dumbbells: palms facing in, elbows close to the sides,
 * rowed until the elbows pass the back.
 */
function bentOverRow(implement: 'barbell' | 'dumbbell', torso: number): Demo {
  const barbell = implement === 'barbell';
  const shin = 182; // knees just ahead of the ankles
  const load = barbell ? 0.5 : 0.3; // the weight, as a share of body mass
  const head = headFor(torso);
  const stance = (thighBack: number) => {
    const leg: Leg = { thigh: 180 - thighBack, shin, foot: 90 };
    const knee = along(O, shin + 180, L.shin);
    const hip = along(knee, leg.thigh + 180, L.thigh);
    return { leg, knee, hip, shoulder: along(hip, torso, L.torso) };
  };
  const hanging = (leg: Leg): DemoPose => ({ torso, head, leg, arm: HANG, anchor: 'ankle', at: O });
  // Hips back until balanced with the weight hanging (the centre of mass moves back as they go).
  const thighBack = solveFor(
    0,
    80,
    (t) => {
      const f = solve('side', hanging(stance(t).leg));
      return -centreOfMass(f, [{ at: f.a.hand, share: load }]).x;
    },
    -MIDFOOT,
  );
  const st = stance(thighBack);
  if (!barbell) {
    const arm = rowArm(st.shoulder, torso, 38);
    return {
      view: 'side',
      pose: (s) => ({ ...hanging(st.leg), arm: arm(s) }),
      props: handProp('dumbbell', 'wrist', { lengthwise: true }),
    };
  }
  const front = dir(torso + 90);
  // Bottom: the bar hangs straight under the shoulders. Top: it touches the lower ribs.
  const out = 0.035;
  const hang = add(st.shoulder, { x: 0, y: Math.sqrt(REACH ** 2 - out ** 2) });
  const top = add(lerpV(st.hip, st.shoulder, 0.6), mul(front, BODY.torsoFront + BAR_R));
  // On the way up the bar stays in front of the knees and thighs.
  const path = bowedPath(hang, top, (p) => Math.min(segDist(p, st.hip, st.knee) - BODY.thighFront, segDist(p, st.knee, O) - BODY.shinFront) - BAR_R);
  // Elbows drive up and back toward the hips, flared out to the sides.
  const back = dir(torso + 225);
  const elbows: Dir3 = { x: back.x, y: back.y, z: 0.8 };
  return {
    view: 'side',
    pose: (s) => ({ ...hanging(st.leg), arm: sideArm(st.shoulder, path(s), out, elbows) }),
    props: handProp('barbell'),
  };
}

/**
 * One-arm dumbbell row: the far knee and far hand on a flat bench (shin flat
 * on the pad, hand flat under the shoulder, elbow soft), the near foot on the
 * floor beside it, back flat. The near arm rows the dumbbell (palm in) from a
 * straight hang to the hip, the elbow passing the back. The dumbbell hangs
 * beside the bench, so it passes in front of it.
 */
function oneArmRow(implement: Implement): Demo {
  const padTop = FLOOR - BENCH_H;
  // Far shin flat on the pad, far thigh straight up to the hip; the foot pointed back, its toes on the pad and the heel up.
  const knee2: Vec = { x: 0, y: padTop - BODY.shinFront };
  const leg2: Leg = { thigh: 180, shin: 270, foot: 248 };
  const hip = along(knee2, 0, L.thigh);
  // Far hand flat on the pad straight under the shoulder: the trunk tips forward until the soft arm reaches it.
  const palmY = padTop - BODY.hand / 2;
  const elbowBend = 12;
  const span = Math.sqrt(L.upperArm ** 2 + L.forearm ** 2 + 2 * L.upperArm * L.forearm * Math.cos((elbowBend * Math.PI) / 180));
  const torso = (Math.acos((hip.y - (palmY - span)) / L.torso) * 180) / Math.PI;
  const shoulder = along(hip, torso, L.torso);
  const palm: Vec = { x: shoulder.x + PALM, y: palmY };
  const arm2 = palmTo(shoulder, palm, 90, BACK);
  // Near foot flat on the floor a little ahead of the hip, knee soft.
  const leg = legTo(hip, { x: hip.x + 0.05, y: FLOOR - L.ankleHeight }, FWD);
  const arm = rowArm(shoulder, torso, 38);
  const pose = (s: number): DemoPose => ({ torso, head: headFor(torso), leg, leg2, arm: arm(s), arm2, anchor: 'hip', at: hip });
  // The bench runs from just behind the far foot to past the far hand.
  const f = solve('side', pose(0));
  const padY = padTop + PAD_HALF;
  // The rowing (near) arm hangs beside the bench, not into it.
  const props: Prop[] = [
    { kind: 'bench', points: [{ x: f.b.toe.x - 0.05, y: padY }, { x: palm.x + 0.08, y: padY }], beside: /near (hand|forearm|upper arm)/ },
    ...handProp(implement, 'wrist', { lengthwise: true }),
  ];
  // Only the rowing (near) arm works; the far arm just props the trunk up.
  return { view: 'side', pose, props, working: 'a' };
}

/**
 * Chest-supported row: lying face down on an incline bench (trunk `torso`
 * degrees from vertical), legs reaching back to the balls of the feet with
 * the toes bent on the floor, knees soft. The arms hang straight down beside
 * the pad and row the dumbbells (palms in) toward the hips until the elbows
 * pass the back. The pad sits under the chest and belly; a post and a strut
 * hold it up.
 */
function chestSupportedRow(implement: Implement, torso: number): Demo {
  // Hips a little bent, knees soft, on the balls of the feet.
  const thigh = torso + 168;
  const shin = thigh + 10;
  const leg: Leg = { thigh, shin, foot: shin - 100, toes: 90 };
  const base: DemoPose = { torso, head: headFor(torso), leg, arm: HANG, anchor: 'toe', at: { x: 0, y: FLOOR } };
  const { hip, shoulder } = solve('side', base).a;
  const arm = rowArm(shoulder, torso, 36);
  const pose = (s: number): DemoPose => ({ ...base, arm: arm(s) });
  const front = dir(torso + 90);
  // The pad under the front of the trunk, from the hips to the upper chest, resting on the skin.
  const onPad = (t: number) => add(lerpV(hip, shoulder, t), mul(front, BODY.torsoFront + PAD_HALF));
  const [low, high] = restingPad(pose, onPad(-0.05), onPad(0.88), /hand|forearm|upper arm/);
  // Its frame: a post from the low end to the floor, a strut up to the middle of the pad, a rail on the floor.
  const under = (t: number) => add(lerpV(low, high, t), mul(front, PAD_HALF));
  const postFoot = { x: under(0).x, y: FLOOR - 0.008 };
  const strutFoot = { x: under(0.62).x + 0.1, y: FLOOR - 0.008 };
  const props: Prop[] = [
    { kind: 'line', from: under(0), to: postFoot, width: 0.03 },
    { kind: 'line', from: under(0.62), to: strutFoot, width: 0.026 },
    { kind: 'line', from: { x: postFoot.x - 0.08, y: postFoot.y }, to: { x: strutFoot.x + 0.06, y: strutFoot.y }, width: 0.016 },
    // The arms hang beside the pad, not into it.
    { kind: 'bench', points: [low, high], legs: false, beside: /hand|forearm|upper arm/ },
    ...handProp(implement, 'wrist', { lengthwise: true }),
  ];
  return { view: 'side', pose, props };
}

// ── Pull-ups ─────────────────────────────────────────────────────────────

/**
 * A pull-up station seen from the side: the bar end-on at `bar`, on an arm
 * reaching back from a post that stands in front of the lifter (`post` = its
 * x) on a T-foot. In front, so neither the post nor the arm passes behind the
 * hanging body.
 */
function station(bar: Vec, post: number, floor: number): Prop[] {
  return [
    { kind: 'line', from: { x: post, y: floor - 0.008 }, to: { x: post, y: bar.y - 0.05 }, width: 0.03 },
    { kind: 'line', from: { x: post - 0.06, y: floor - 0.008 }, to: { x: post + 0.06, y: floor - 0.008 }, width: 0.018 },
    { kind: 'line', from: { x: post, y: bar.y }, to: bar, width: 0.026 },
    { kind: 'bar', at: bar },
  ];
}

/** How far forward any part of the legs reaches over a movement (toes, or the front of a bent knee). */
function legsFront(pose: (s: number) => DemoPose, back?: (s: number) => DemoPose): number {
  let x = -Infinity;
  for (let k = 0; k <= 16; k++) {
    for (const p of back ? [pose, back] : [pose]) {
      const f = solve('side', p(k / 16));
      x = Math.max(x, f.a.toe.x, f.a.knee.x + BODY.thighFront);
    }
  }
  return x;
}

/**
 * Hanging from a bar at the origin. Dead hang (s = 0): arms straight, body
 * plumb under the bar. Pulling, the shoulders drift back so the bar passes in
 * front of the face; top (s = 1): chin over the bar, which is level with the
 * collarbones. At every frame the body leans just enough to keep its centre of
 * mass under the bar, legs straight and together a little ahead of the hips,
 * toes a hand's width above the floor at the dead hang. `chin`: underhand grip
 * at shoulder width, elbows forward. Otherwise an overhand grip a little wider
 * than the shoulders: the elbows travel down and out to the sides, so from the
 * side they stay under the bar and the upper arms look short. `startTop`: a
 * negative (see negativePullUp). `scapular`: arms stay straight; the shoulder
 * blades pull down and the chest lifts, raising the body a few centimetres.
 */
export function pullUp(o: { startTop?: boolean; scapular?: boolean; chin?: boolean }): Demo {
  const bar = O;
  // Hands this far outside the shoulder joints; elbows forward (chin-up) or down and out (pull-up).
  const out = o.chin ? 0 : 0.05;
  const elbows: Dir3 = o.chin ? { x: 1, y: 0.7, z: 0.25 } : { x: 0.3, y: 1, z: 0.8 };
  const reach = Math.sqrt(REACH ** 2 - out ** 2);
  const hang: Vec = { x: bar.x, y: bar.y + reach };
  const top: Vec = o.scapular ? { x: bar.x - 0.045, y: hang.y - 0.032 } : { x: bar.x - 0.085, y: bar.y + 0.042 };
  const shoulderAt = (s: number): Vec => {
    if (o.scapular) return lerpV(hang, top, s);
    // Up steadily; back early, so the face is behind the bar before it gets there.
    const y = lerp(hang.y, top.y, s);
    return { x: lerp(hang.x, top.x, smooth((hang.y - y) / ((hang.y - top.y) * 0.55))), y };
  };
  const armAt = (s: number): Arm => {
    const shoulder = shoulderAt(s);
    // Scapular: straight arms; the shoulders pulling down from the ears shows as a shorter reach.
    return o.scapular
      ? { upper: angleOf(sub(bar, shoulder)), fore: angleOf(sub(bar, shoulder)), scale: dist(bar, shoulder) / REACH }
      : sideArm(shoulder, bar, out, elbows);
  };
  const build = (s: number, torso: number, leg?: (hip: Vec) => Leg): DemoPose => {
    const shoulder = shoulderAt(s);
    const thigh = torso + 172;
    const shin = thigh + 3;
    return {
      torso,
      head: torso * 0.4,
      leg: leg ? leg(along(shoulder, torso + 180, L.torso)) : { thigh, shin, foot: shin - 40 }, // toes pointed
      arm: armAt(s),
      anchor: 'shoulder',
      at: shoulder,
    };
  };
  // Lean so the centre of mass hangs under the bar (it moves forward as the trunk tips back).
  const lean = (s: number, leg?: (hip: Vec) => Leg) => solveFor(-45, 25, (t) => -centreOfMass(solve('side', build(s, t, leg))).x, -bar.x);
  if (o.startTop) return negativePullUp(bar, build, lean);
  const pose = (s: number): DemoPose => build(s, lean(s));
  // The floor a hand's width under the toes at the dead hang (the bar about 2.3 m up).
  let lowest = -Infinity;
  for (let k = 0; k <= 8; k++) lowest = Math.max(lowest, solve('side', pose(k / 8)).a.toe.y);
  const floor = lowest + 0.07;
  return { view: 'side', floor, pose, props: station(bar, legsFront(pose) + 0.09, floor) };
}

/**
 * Negative pull-up with a box under the bar, tall enough that standing on it
 * puts the chin over the bar. Start (s = 0): chin over the bar, feet flat on
 * the box, knees a little bent. Lowering (about four seconds), the feet come
 * off the box and the knees bend up in front, so the arms alone let the body
 * down to a dead hang (s = 1), where the feet land on the box again in a deep
 * squat. The way back up is the legs' job: feet planted, they stand the body
 * up to the top while the arms just follow.
 */
function negativePullUp(bar: Vec, build: (s: number, torso: number, leg?: (hip: Vec) => Leg) => DemoPose, lean: (s: number, leg?: (hip: Vec) => Leg) => number): Demo {
  // The motion runs from the top (s = 0 here) to the dead hang, so the hanging pull-up is played backwards.
  const at = (s: number) => 1 - s;
  // Top: hips a little bent, shins upright, feet flat on the box; the body hangs balanced under the bar as it will once the feet lift.
  const standing = (torso: number): Leg => ({ thigh: torso + 145, shin: 180, foot: 90 });
  const topTorso = solveFor(-45, 25, (t) => -centreOfMass(solve('side', build(at(0), t, () => standing(t)))).x, -bar.x);
  const topPose = build(at(0), topTorso, () => standing(topTorso));
  const feet = solve('side', topPose).a.ankle;
  const boxTop = feet.y + L.ankleHeight;
  // Off the box while lowering: the feet rise a little above where they will land, then come down onto it.
  const LIFT = 0.07;
  const lift = (s: number) => LIFT * smooth(s / 0.12) * (1 - smooth((s - 0.82) / 0.18));
  const legFor = (s: number, planted: boolean) => (hip: Vec): Leg => {
    const up = planted ? 0 : lift(s);
    // Knees forward; in the air the toes point a little.
    return legTo(hip, { x: feet.x, y: feet.y - up }, { x: 1, y: -0.4 }, 90 + 25 * (up / LIFT));
  };
  // The trunk leans so the body hangs balanced under the bar while the feet are off the box; the way back keeps the same lean.
  const torsoAt = (s: number) => (s <= 0 ? topTorso : lean(at(s), legFor(s, false)));
  const pose = (s: number): DemoPose => (s <= 0 ? topPose : build(at(s), torsoAt(s), legFor(s, false)));
  const back = (s: number): DemoPose => (s <= 0 ? topPose : build(at(s), torsoAt(s), legFor(s, true)));
  // A floor about 2.1 m under the bar; the box reaches up to where the feet stand.
  const floor = bar.y + 1.22;
  const box: Prop = { kind: 'box', x: feet.x - 0.13, y: boxTop, w: 0.3, h: floor - boxTop };
  const front = Math.max(legsFront(pose, back), box.x + box.w);
  return {
    view: 'side',
    floor,
    pose,
    back,
    props: [box, ...station(bar, front + 0.07, floor)],
    // Lowered slowly; the legs stand the body back up at an ordinary pace.
    timing: { out: 4, back: 1.6 },
  };
}

/**
 * Inverted row: lying face up under a bar set about hip height, heels on the
 * floor, body straight from shoulders to heels; head to the left (face up).
 * Overhand grip a little wider than the shoulders. The body pivots on the
 * heels until the lower chest touches the bar, elbows driving down toward
 * the floor and out at about 45°; at the bottom the arms are straight.
 */
export function invertedRow(): Demo {
  const heel: Vec = { x: 0, y: FLOOR };
  const bodyLen = LEG_LEN + L.torso; // ankle to shoulder
  // Body `lift` degrees above the floor; feet at a right angle to the shins, heels planted.
  const heelOff = (lift: number) => add(mul(dir(lift), -L.heel), mul(dir(lift + 90), L.ankleHeight));
  const ankleAt = (lift: number) => sub(heel, heelOff(lift));
  const onBody = (lift: number, d: number) => along(ankleAt(lift), 270 + lift, d);
  // Top: the bar touches the lower chest.
  const topLift = 40;
  const chestAt = onBody(topLift, LEG_LEN + L.torso * 0.72);
  const barAt = add(chestAt, mul(dir(topLift), BODY.torsoFront + BAR_R));
  // Bottom: lowered until the arms are straight.
  const out = 0.04;
  const straight = Math.sqrt(REACH ** 2 - out ** 2);
  const bottomLift = solveFor(0, topLift, (lift) => -dist(barAt, onBody(lift, bodyLen)), -straight);
  const elbows: Dir3 = { x: 0.6, y: 1, z: 0.8 };
  return {
    view: 'side',
    pose: (s) => {
      const lift = lerp(bottomLift, topLift, s);
      const torso = 270 + lift;
      const shoulder = onBody(lift, bodyLen);
      return {
        torso,
        head: torso + 6, // chin slightly tucked
        leg: { thigh: lift + 90, shin: lift + 90, foot: lift },
        arm: sideArm(shoulder, barAt, out, elbows),
        anchor: 'ankle',
        at: ankleAt(lift),
      };
    },
    // The bar rests in a J-hook on a rack upright, which stands behind the lifter a hand's width toward the
    // feet: the hook's arm runs out from the upright under the bar (clear of the fist, which closes on the
    // bar from the head's side) and turns up past it.
    props: [
      { kind: 'line', from: { x: barAt.x + HOOK, y: FLOOR - 0.01 }, to: { x: barAt.x + HOOK, y: barAt.y - 0.07 }, width: 0.026 },
      { kind: 'line', from: { x: barAt.x + HOOK, y: barAt.y + BAR_R + 0.007 }, to: { x: barAt.x - BAR_R - 0.004, y: barAt.y + BAR_R + 0.007 }, width: 0.014 },
      { kind: 'line', from: { x: barAt.x - BAR_R - 0.004, y: barAt.y + BAR_R + 0.007 }, to: { x: barAt.x - BAR_R - 0.004, y: barAt.y - 0.004 }, width: 0.012 },
      { kind: 'bar', at: barAt },
    ],
  };
}

// ── Pulldowns ────────────────────────────────────────────────────────────

/**
 * Lat pulldown: seated, thighs level under the knee pad, feet flat, trunk
 * leaning back a little with the chest up. Wide overhand grip: the bar comes
 * down from straight arms overhead, in front of the face, to the upper chest,
 * the elbows travelling down and out to the sides. `straightArm`: standing a
 * step back from a high pulley, hips back and knees soft; straight arms sweep
 * the bar from in front of the head down to the thighs.
 */
export function pulldown(o: { straightArm?: boolean }): Demo {
  return o.straightArm ? straightArmPulldown() : latPulldown();
}

function latPulldown(): Demo {
  const hip: Vec = O;
  const torso = -12;
  const leg: Leg = { thigh: 94, shin: 180, foot: 90 };
  const base: DemoPose = { torso, head: -4, leg, arm: HANG, anchor: 'hip', at: hip };
  const f = solve('side', base);
  const shoulder = f.a.shoulder;
  const floor = f.a.ankle.y + L.ankleHeight;
  // Hands well outside the shoulders on the long bar; elbows down and out, a little in front of the body.
  const out = 0.1;
  const elbows: Dir3 = { x: 0.35, y: 1, z: 0.9 };
  // Bottom: the bar at the upper chest, just under the collarbones.
  const chest = add(along(shoulder, torso + 180, 0.04), mul(dir(torso + 90), BODY.torsoFront + BAR_R));
  // Top: arms straight up under the pulley.
  const topBar: Vec = { x: shoulder.x + 0.03, y: shoulder.y - Math.sqrt(REACH ** 2 - out ** 2 - 0.03 ** 2) };
  const pulley: Vec = { x: topBar.x, y: topBar.y - 0.26 };
  // The bar moves forward early so it passes in front of the face.
  const barAt = (s: number): Vec => ({ x: lerp(topBar.x, chest.x, 1 - (1 - s) ** 2.4), y: lerp(topBar.y, chest.y, s) });
  // Seat under the backs of the thighs on its own post; the knee pad a roller on the thighs just behind
  // the knees, on a post from the floor rail. The weight stack stands in front of the knees, the pulley
  // on a beam reaching back over the head.
  const seatY = hip.y + BODY.thighBack + PAD_HALF;
  const kneePad = add(along(f.a.knee, leg.thigh + 180, 0.05), mul(dir(leg.thigh - 90), BODY.thighFront + 0.036));
  const stack = kneePad.x + 0.16;
  return {
    view: 'side',
    floor,
    pose: (s) => ({ ...base, arm: sideArm(shoulder, barAt(s), out, elbows) }),
    props: [
      { kind: 'line', from: { x: hip.x - 0.1, y: floor - 0.008 }, to: { x: stack + 0.03, y: floor - 0.008 }, width: 0.016 },
      { kind: 'line', from: { x: hip.x + 0.02, y: seatY }, to: { x: hip.x + 0.02, y: floor - 0.01 }, width: 0.026 },
      { kind: 'line', from: kneePad, to: { x: kneePad.x + 0.06, y: floor - 0.01 }, width: 0.024 },
      { kind: 'bench', points: [{ x: hip.x - 0.12, y: seatY }, { x: hip.x + 0.17, y: seatY }], legs: false },
      { kind: 'cable', from: pulley, at: 'wrist', column: stack },
      { kind: 'barbell', at: 'wrist', plate: 0 },
      { kind: 'pad', at: 'knee', offset: sub(kneePad, add(f.a.knee, { x: 0, y: -0.06 })) },
    ],
  };
}

/**
 * Straight-arm pulldown: standing a step back from a high pulley, hips back,
 * knees soft, flat back, overhand on a straight bar. The arms stay straight
 * (elbows soft) and turn at the shoulders, from reaching up toward the pulley
 * to the bar touching the thighs. The hips sit back until the feet carry the
 * lifter and the cable's pull over the middle of the foot.
 */
function straightArmPulldown(): Demo {
  const torso = 30;
  const shin = 183;
  const pulley: Vec = { x: 0.78, y: FLOOR - 1.13 };
  // Elbows soft and fixed; the whole arm turns at the shoulder.
  const bend = 12;
  const armAt = (deg: number): Arm => ({ upper: deg, fore: deg - bend });
  const stance = (thighBack: number, deg: number): DemoPose => ({
    torso,
    head: headFor(torso),
    leg: { thigh: 180 - thighBack, shin, foot: 90 },
    arm: armAt(deg),
    anchor: 'ankle',
    at: O,
  });
  // Start: arms reaching toward the pulley. End: the bar against the front of the thighs.
  const startFor = (thighBack: number) => {
    const sh = solve('side', stance(thighBack, 90)).a.shoulder;
    return angleOf(sub(pulley, sh));
  };
  const endFor = (thighBack: number) => {
    let deg = startFor(thighBack);
    for (;;) {
      const f = solve('side', stance(thighBack, deg + 0.5));
      if (deg >= 200 || segDist(f.a.hand, f.a.hip, f.a.knee) <= BODY.thighFront + BAR_R) return deg;
      deg += 0.5;
    }
  };
  // Hips back until balanced half way down, with the cable pulling about a sixth of body weight.
  const thighBack = solveFor(
    0,
    60,
    (t) => {
      const mid = (startFor(t) + endFor(t)) / 2;
      return -pressureX(solve('side', stance(t, mid)), FLOOR, { pulley, tension: 0.16 });
    },
    -MIDFOOT,
  );
  const start = startFor(thighBack);
  const end = endFor(thighBack);
  return {
    view: 'side',
    pose: (s) => stance(thighBack, lerp(start, end, s)),
    props: [
      { kind: 'cable', from: pulley, at: 'wrist' },
      { kind: 'barbell', at: 'wrist', plate: 0 },
    ],
  };
}
