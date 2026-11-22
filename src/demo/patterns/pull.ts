// Movement patterns: rows, pull-ups and pulldowns. Conventions and helpers: ./shared.ts.
//
// What the hands hold stays outside the body: a barbell comes up to touch the
// front of the torso, dumbbells come up beside the ribs, a pull-up bar passes
// in front of the face with the chin finishing over it. Bodies rest on benches
// and pads by their skin (BODY), and planted feet stay where they are.
import { BODY } from '../body';
import { PAD_HALF } from '../contact';
import { L, GRIP, PALM, add, along, dir, dist, gripTo, legTo, lerp, lerpV, mul, palmTo, solve, sub, type DemoPose, type Figure, type Leg, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { O, FLOOR, LEG_LEN, HANG, BACK, FWD, handProp, type Implement } from './shared';

/** Shoulder to the middle of the fist, arm straight. */
const REACH = L.upperArm + L.forearm + GRIP;
/** A bar's end as ../equipment draws it. */
const BAR_R = 0.02;
/** The middle of a flat foot, ahead of the ankle (heel to toe). */
const MIDFOOT = (L.foot - L.heel) / 2;
/** A flat bench's pad top above the floor (43 cm on a 1.75 m lifter). */
const BENCH_H = 0.245;

// ── Helpers ──────────────────────────────────────────────────────────────

/** Segment masses as a share of body mass (Winter 2009). */
const MASS = { head: 0.081, trunk: 0.497, upperArm: 0.028, forearm: 0.016, hand: 0.006, thigh: 0.1, shank: 0.0465, foot: 0.0145 };

/** Horizontal centre of mass of the body plus held loads (`share` = load mass / body mass). */
function massX(f: Figure, loads: { at: Vec; share: number }[] = []): number {
  const parts: [number, Vec][] = [
    [MASS.head, f.head],
    [MASS.trunk, lerpV(f.a.hip, f.a.shoulder, 0.5)],
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
  return parts.reduce((a, [w, p]) => a + w * p.x, 0) / parts.reduce((a, [w]) => a + w, 0);
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
 * Bent-over row: hinged with a flat back and soft knees, shins nearly
 * vertical, feet flat. The weight hangs straight under the shoulders and is
 * rowed to the torso; only the arms move. The hips sit back until lifter and
 * weight balance over the middle of the foot.
 */
function bentOverRow(implement: 'barbell' | 'dumbbell', torso: number): Demo {
  const shin = 184; // knees just ahead of the ankles
  const load = implement === 'barbell' ? 0.6 : 0.3; // the weight, as a share of body mass
  const head = headFor(torso);
  const elbows = dir(torso + 225); // elbows drive up and back, toward the hips
  const stance = (thighBack: number) => {
    const leg: Leg = { thigh: 180 - thighBack, shin, foot: 90 };
    const knee = along(O, shin + 180, L.shin);
    const hip = along(knee, leg.thigh + 180, L.thigh);
    const shoulder = along(hip, torso, L.torso);
    return { leg, knee, hip, shoulder, hang: add(shoulder, { x: 0, y: REACH }) };
  };
  type Stance = ReturnType<typeof stance>;
  const poseAt = (st: Stance, hand: Vec): DemoPose => ({ torso, head, leg: st.leg, arm: gripTo(st.shoulder, hand, elbows), anchor: 'ankle', at: O });
  // Hips back until balanced with the weight hanging (the centre of mass moves back as they go).
  const thighBack = solveFor(
    0,
    80,
    (t) => {
      const st = stance(t);
      const f = solve('side', poseAt(st, st.hang));
      return -massX(f, [{ at: f.a.hand, share: load }]);
    },
    -MIDFOOT,
  );
  const st = stance(thighBack);
  const front = dir(torso + 90);
  // Top: the bar touches the lower chest; dumbbells come up beside the lower ribs.
  const top =
    implement === 'barbell' ? add(lerpV(st.hip, st.shoulder, 0.62), mul(front, BODY.torsoFront + BAR_R)) : add(lerpV(st.hip, st.shoulder, 0.5), mul(front, 0.03));
  // On the way up the bar stays in front of the knees and thighs.
  const r = implement === 'barbell' ? BAR_R : 0;
  const path = bowedPath(st.hang, top, (p) => Math.min(segDist(p, st.hip, st.knee) - BODY.thighFront, segDist(p, st.knee, O) - BODY.shinFront) - r);
  return { view: 'side', pose: (s) => poseAt(st, path(s)), props: handProp(implement) };
}

/**
 * One-arm dumbbell row: the far knee and far hand on a flat bench (shin flat
 * on the pad, hand flat under the shoulder, elbow soft), the near foot on the
 * floor beside it, back flat. The near arm rows the dumbbell from a straight
 * hang to the hip.
 */
function oneArmRow(implement: Implement): Demo {
  const padTop = FLOOR - BENCH_H;
  // Far shin flat on the pad, far thigh straight up to the hip.
  const knee2: Vec = { x: 0, y: padTop - BODY.shinFront };
  const leg2: Leg = { thigh: 180, shin: 270, foot: 265 };
  const hip = along(knee2, 0, L.thigh);
  // Far hand flat on the pad straight under the shoulder: the trunk tips forward until the soft arm reaches it.
  const palmY = padTop - BODY.hand / 2;
  const elbowBend = 12;
  const span = Math.sqrt(L.upperArm ** 2 + L.forearm ** 2 + 2 * L.upperArm * L.forearm * Math.cos((elbowBend * Math.PI) / 180));
  const torso = (Math.acos((hip.y - (palmY - span)) / L.torso) * 180) / Math.PI;
  const shoulder = along(hip, torso, L.torso);
  const palm: Vec = { x: shoulder.x + PALM, y: palmY };
  const arm2 = palmTo(shoulder, palm, 90, BACK);
  // Near foot flat on the floor, a little ahead of the hip, knee soft.
  const leg = legTo(hip, { x: hip.x + 0.05, y: FLOOR - L.ankleHeight }, FWD);
  // Bottom: the dumbbell hangs straight under the shoulder. Top: beside the hip, elbow past the back.
  const hang = add(shoulder, { x: 0, y: REACH });
  const top = add(lerpV(hip, shoulder, 0.32), mul(dir(torso + 90), 0.02));
  const elbows = dir(torso + 225);
  const pose = (s: number): DemoPose => ({
    torso,
    head: headFor(torso),
    leg,
    leg2,
    arm: gripTo(shoulder, lerpV(hang, top, s), elbows),
    arm2,
    anchor: 'hip',
    at: hip,
  });
  // The bench runs from behind the far foot to just past the far hand.
  const f = solve('side', pose(0));
  const padY = padTop + PAD_HALF;
  const props: Prop[] = [{ kind: 'bench', points: [{ x: f.b.toe.x - 0.05, y: padY }, { x: palm.x + 0.08, y: padY }] }, ...handProp(implement)];
  return { view: 'side', pose, props };
}

/**
 * Chest-supported row: lying face down on an incline bench (trunk `torso`
 * degrees from vertical), toes on the floor behind it, knees soft. The arms
 * hang straight down beside the pad and row the dumbbells up toward the hips.
 */
function chestSupportedRow(implement: Implement, torso: number): Demo {
  // Hips a little bent, knees soft, on the balls of the feet.
  const thigh = torso + 168;
  const leg: Leg = { thigh, shin: thigh + 10, foot: 125 };
  const base: DemoPose = { torso, head: headFor(torso), leg, arm: HANG, anchor: 'toe', at: { x: 0, y: FLOOR } };
  const { hip, shoulder } = solve('side', base).a;
  const front = dir(torso + 90);
  // The pad under the front of the trunk, from the hips to the upper chest.
  const onPad = (t: number) => add(lerpV(hip, shoulder, t), mul(front, BODY.torsoFront + PAD_HALF));
  const hang = add(shoulder, { x: 0, y: REACH });
  const top = add(lerpV(hip, shoulder, 0.42), mul(front, 0.01)); // beside the waist, elbows past the back
  const elbows = dir(torso + 225);
  return {
    view: 'side',
    pose: (s) => ({ ...base, arm: gripTo(shoulder, lerpV(hang, top, s), elbows) }),
    props: [{ kind: 'bench', points: [onPad(0.02), onPad(0.9)] }, ...handProp(implement)],
  };
}

// ── Pull-ups ─────────────────────────────────────────────────────────────

/**
 * Hanging from a bar at the origin. Dead hang (s = 0): arms straight, body
 * plumb under the bar. Pulling, the shoulders drift back so the bar passes in
 * front of the face; top (s = 1): chin over the bar, which is level with the
 * collarbones. At every frame the body leans just enough to keep its centre of
 * mass under the bar, legs straight and together a little ahead of the hips.
 * `chin`: underhand grip at shoulder width, elbows forward. Otherwise an
 * overhand grip a little wider than the shoulders: the arms reach up and out,
 * so from the side they look a little short and the elbows stay under the bar.
 * `startTop`: a negative, lowered from the top; the toes find a box at the
 * bottom (the way back up). `scapular`: arms stay straight; the shoulder blades
 * pull down and the chest lifts, raising the body a few centimetres.
 */
export function pullUp(o: { startTop?: boolean; scapular?: boolean; chin?: boolean }): Demo {
  const bar = O;
  const scale = o.chin ? 1 : 0.94;
  const reach = REACH * scale;
  const elbows = o.chin ? dir(120) : dir(165);
  const hang: Vec = { x: bar.x, y: bar.y + reach };
  const top: Vec = o.scapular ? { x: bar.x - 0.03, y: hang.y - 0.028 } : { x: bar.x - 0.08, y: bar.y + 0.042 };
  const shoulderAt = (s: number): Vec => {
    if (o.scapular) return lerpV(hang, top, s);
    // Up steadily; back early, so the face is behind the bar before it gets there.
    const y = lerp(hang.y, top.y, s);
    return { x: lerp(hang.x, top.x, smooth((hang.y - y) / ((hang.y - top.y) * 0.6))), y };
  };
  const build = (s: number, torso: number): DemoPose => {
    const shoulder = shoulderAt(s);
    const thigh = torso + 172;
    const shin = thigh + 3;
    const armScale = o.scapular ? Math.hypot(shoulder.x - bar.x, shoulder.y - bar.y) / REACH : scale;
    return {
      torso,
      head: torso * 0.4,
      leg: { thigh, shin, foot: shin - 32 }, // toes pointed
      arm: gripTo(shoulder, bar, elbows, armScale),
      anchor: 'shoulder',
      at: shoulder,
    };
  };
  // Lean so the centre of mass hangs under the bar (it moves forward as the trunk tips back).
  const pose = (s: number): DemoPose => build(s, solveFor(-45, 25, (t) => -massX(solve('side', build(s, t))), -bar.x));
  const props: Prop[] = [{ kind: 'bar', at: bar }];
  if (!o.startTop) return { view: 'side', floor: null, pose, props };
  // Negative: from the top (s = 0) down to a dead hang (s = 1), toes just touching a box.
  const toe = solve('side', pose(0)).a.toe;
  const boxH = 0.3;
  props.push({ kind: 'box', x: toe.x - 0.17, y: toe.y, w: 0.3, h: boxH });
  return { view: 'side', floor: toe.y + boxH, pose: (s) => pose(1 - s), props };
}

/**
 * Inverted row: lying face up under a bar set about hip height, heels on the
 * floor, body straight from shoulders to heels; head to the left (face up).
 * The body pivots on the heels until the lower chest touches the bar; at the
 * bottom the arms are straight.
 */
export function invertedRow(): Demo {
  const heel: Vec = { x: 0, y: FLOOR };
  const bodyLen = LEG_LEN + L.torso; // ankle to shoulder
  // Body `lift` degrees above the floor; feet at a right angle to the shins, heels planted.
  const heelOff = (lift: number) => add(mul(dir(lift), -L.heel), mul(dir(lift + 90), L.ankleHeight));
  const ankleAt = (lift: number) => sub(heel, heelOff(lift));
  const along_ = (lift: number, d: number) => along(ankleAt(lift), 270 + lift, d);
  // Top: the bar touches the lower chest.
  const topLift = 40;
  const chestAt = along_(topLift, LEG_LEN + L.torso * 0.72);
  const barAt = add(chestAt, mul(dir(topLift), BODY.torsoFront + BAR_R));
  // Bottom: lowered until the arms are straight.
  const bottomLift = solveFor(0, topLift, (lift) => -dist(barAt, along_(lift, bodyLen)), -REACH);
  return {
    view: 'side',
    pose: (s) => {
      const lift = lerp(bottomLift, topLift, s);
      const torso = 270 + lift;
      const shoulder = along_(lift, bodyLen);
      return {
        torso,
        head: torso + 6, // chin slightly tucked
        leg: { thigh: lift + 90, shin: lift + 90, foot: lift },
        arm: gripTo(shoulder, barAt, dir(lift + 180)),
        anchor: 'ankle',
        at: ankleAt(lift),
      };
    },
    props: [{ kind: 'bar', at: barAt }],
  };
}

// ── Pulldowns ────────────────────────────────────────────────────────────

/**
 * Lat pulldown: seated, thighs level under the knee pads, feet flat, trunk
 * leaning back a little with the chest up. The bar comes down from straight
 * arms overhead, in front of the face, to the upper chest. `straightArm`:
 * standing a step back from a high pulley, hips back and knees soft; straight
 * arms sweep the bar from overhead down to the thighs.
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
  // Wide grip: the arms reach up and out, so from the side they look a little short.
  const scale = 0.92;
  // Bottom: the bar at the upper chest, just under the collarbones.
  const chest = add(along(shoulder, torso + 180, 0.04), mul(dir(torso + 90), BODY.torsoFront + BAR_R));
  // Top: arms straight up under the pulley.
  const topBar: Vec = { x: shoulder.x + 0.03, y: shoulder.y - Math.sqrt((REACH * scale) ** 2 - 0.03 ** 2) };
  const pulley: Vec = { x: topBar.x, y: topBar.y - 0.26 };
  // The bar moves forward early so it passes in front of the face.
  const barAt = (s: number): Vec => ({ x: lerp(topBar.x, chest.x, 1 - (1 - s) ** 2.4), y: lerp(topBar.y, chest.y, s) });
  // Seat under the backs of the thighs; knee pads resting on the thighs just behind the knees.
  const seatY = hip.y + BODY.thighBack + PAD_HALF;
  const kneePad = add(along(f.a.knee, leg.thigh + 180, 0.045), mul(dir(leg.thigh - 90), BODY.thighFront + 0.037));
  return {
    view: 'side',
    floor: f.a.ankle.y + L.ankleHeight,
    pose: (s) => ({ ...base, arm: gripTo(shoulder, barAt(s), dir(200), scale) }),
    props: [
      { kind: 'cable', from: pulley, at: 'wrist' },
      { kind: 'barbell', at: 'wrist', plate: 0 },
      { kind: 'bench', points: [{ x: hip.x - 0.12, y: seatY }, { x: hip.x + 0.17, y: seatY }], legs: true },
      { kind: 'pad', at: 'knee', offset: sub(kneePad, add(f.a.knee, { x: 0, y: -0.06 })) },
    ],
  };
}

function straightArmPulldown(): Demo {
  const torso = 24;
  const leg: Leg = { thigh: 166, shin: 184, foot: 90 };
  const base: DemoPose = { torso, head: headFor(torso), leg, arm: HANG, anchor: 'ankle', at: O };
  const f = solve('side', base);
  const shoulder = f.a.shoulder;
  const pulley: Vec = { x: 0.6, y: FLOOR - 1.08 };
  // Elbows soft and fixed; the whole arm turns at the shoulder.
  const bend = 12;
  const armAt = (deg: number) => ({ upper: deg, fore: deg - bend });
  const handAt = (deg: number) => {
    const a = armAt(deg);
    return along(along(along(shoulder, a.upper, L.upperArm), a.fore, L.forearm), a.fore, GRIP);
  };
  // Start: arms reaching up toward the pulley. End: the bar against the front of the thighs.
  const start = Math.atan2(pulley.x - shoulder.x, shoulder.y - pulley.y) * (180 / Math.PI);
  let end = start;
  while (end < 200 && segDist(handAt(end + 0.5), f.a.hip, f.a.knee) > BODY.thighFront + BAR_R) end += 0.5;
  return {
    view: 'side',
    pose: (s) => ({ ...base, arm: armAt(lerp(start, end, s)) }),
    props: [
      { kind: 'cable', from: pulley, at: 'wrist' },
      { kind: 'barbell', at: 'wrist', plate: 0 },
    ],
  };
}

