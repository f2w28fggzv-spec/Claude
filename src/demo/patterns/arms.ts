// Movement patterns: curls and triceps isolation. Conventions and helpers: ./shared.ts.
//
// Only the forearms move: the upper arms stay where they are (by the sides,
// up beside the head, along the back), drifting a few degrees at most, and
// what the hands hold stays clear of the body: a bar starts on the front of
// the thighs and finishes in front of the shoulders, a dumbbell held
// overhead passes behind the head. Standing lifters keep still (no swinging),
// knees soft and trunk braced, tipped a degree or two at the ankles so that
// the pressure under the feet stays around the middle of the foot through
// the rep: against a weight out in front or behind the head, or a cable
// pulling the hands. Seated lifters rest on their bench by the skin (BODY).
import { BODY } from '../body';
import { PAD_HALF } from '../contact';
import { L, PALM, add, along, angleOf, armTo, dir, dist, legTo, lerp, lerpV, mul, solve, sub, type Arm, type DemoPose, type Figure, type Leg, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { O, FLOOR, UP, centreOfMass, restingPad, solveFor, type Implement } from './shared';

/** The middle of a flat foot, ahead of the ankle (heel to toe). */
const MIDFOOT = (L.foot - L.heel) / 2;
/** Where a standing lifter's centre of pressure sits: a little behind the middle of the foot (as in ./legs). */
const BALANCE = MIDFOOT - 0.01;
/** A flat bench's pad top above the floor (43 cm on a 1.75 m lifter). */
const BENCH_H = 0.245;
/** Body parts that hang beside a bench or pad rather than resting on it. */
const ARMS = /hand|forearm|upper arm/;

// ── Helpers ──────────────────────────────────────────────────────────────

/** 0 → 1 smoothly as s goes from a to b. */
const ramp = (s: number, a: number, b: number) => {
  const u = Math.min(1, Math.max(0, (s - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

function segDist(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x ** 2 + ab.y ** 2)));
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t));
}

/** How far p is outside the front of the near thigh (negative inside). */
const offThigh = (f: Figure, p: Vec) => segDist(p, f.a.hip, f.a.knee) - BODY.thighFront;

/** Neck in line with the back, eyes a little ahead: the head lifts slightly from the trunk line as it tips forward. */
const headFor = (trunk: number) => trunk - Math.min(12, Math.max(0, trunk) * 0.2);

/** Where the lines through a0-a1 and b0-b1 cross. */
function crossing(a0: Vec, a1: Vec, b0: Vec, b1: Vec): Vec {
  const d1 = sub(a1, a0);
  const d2 = sub(b1, b0);
  const t = ((b0.x - a0.x) * d2.y - (b0.y - a0.y) * d2.x) / (d1.x * d2.y - d1.y * d2.x);
  return add(a0, mul(d1, t));
}

/**
 * The near arm with its upper arm `fwd` degrees forward of the trunk's line
 * down the side (elbows by the ribs at 0) and the elbow bent `flex` degrees
 * (0 = straight).
 */
function sideArm(torso: number, fwd: number, flex: number): Arm {
  const upper = torso + 180 - fwd;
  return { upper, fore: upper - flex };
}

/**
 * The free (far) arm bracing its flat hand on `palm`, fingers pointing `hand`,
 * the elbow a little bent toward `toward`. Where the hand is nearer than the
 * arm reaches, the elbow bends out to the side, which from the side looks like
 * a shorter arm.
 */
function bracedArm(shoulder: Vec, palm: Vec, hand: number, toward: Vec): Arm {
  const bend = (20 * Math.PI) / 180;
  const span = Math.sqrt(L.upperArm ** 2 + L.forearm ** 2 + 2 * L.upperArm * L.forearm * Math.cos(bend));
  let scale = 1;
  for (let k = 0; k < 4; k++) scale = Math.min(1, dist(shoulder, along(palm, hand + 180, PALM * scale)) / span);
  return { ...armTo(shoulder, along(palm, hand + 180, PALM * scale), toward, scale), hand, flat: true };
}

// ── Balance ──────────────────────────────────────────────────────────────

/**
 * What a standing lifter balances besides the body: a weight in the hands
 * (`share` of body weight), or with `from` a cable or band pulling the hands
 * toward that point with that tension.
 */
interface Load {
  share: number;
  from?: Vec;
}

/** x of the centre of pressure under the feet: where the floor's push balances the body and the load. */
function pressureX(f: Figure, load?: Load): number {
  const hand = f.a.hand;
  if (!load) return centreOfMass(f).x;
  if (!load.from) return centreOfMass(f, [{ at: hand, share: load.share }]).x;
  // Moments about the centre of pressure on the floor: body weight at its centre of mass, the pull along the cable at the hands.
  const d = sub(load.from, hand);
  const u = mul(d, 1 / Math.hypot(d.x, d.y));
  const t = load.share;
  return (centreOfMass(f).x + t * (hand.x * u.y - (hand.y - FLOOR) * u.x)) / (1 + t * u.y);
}

/**
 * Standing with the feet flat (ankle at the origin), knees soft, the trunk
 * `hinge` degrees forward of the legs, the whole body tipped `lean` degrees
 * forward at the ankles.
 */
function stance(lean: number, hinge = 0, knee = 6): { leg: Leg; torso: number } {
  return { leg: { thigh: 180 + lean - knee / 2, shin: 180 + lean + knee / 2, foot: 90 }, torso: lean + hinge };
}

/**
 * A standing lift with the body held still: `build(lean, s)` is the pose at
 * progress s with the body tipped `lean` degrees at the ankles, `load(lean)`
 * what it balances. One lean serves the whole rep, chosen so the centre of
 * pressure under the feet stays around where a relaxed stance puts it: as the
 * weight moves it shifts toward the toes or heels while the body stays put
 * (no swinging). Returns that lean.
 */
function stillLean(build: (lean: number, s: number) => DemoPose, load: (lean: number) => Load | undefined): number {
  const frames = Array.from({ length: 11 }, (_, k) => k / 10);
  const middle = (lean: number) => {
    const xs = frames.map((s) => pressureX(solve('side', build(lean, s)), load(lean)));
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  };
  return solveFor(-20, 20, middle, BALANCE);
}

// ── Curls ────────────────────────────────────────────────────────────────

/**
 * Curls. Standing (barbell, EZ bar, dumbbells, a cable bar or band handles),
 * `incline` lying back on an incline bench, or `concentration` seated with
 * the elbow braced on the inner thigh. `neutral`: palms facing each other
 * (hammer curl), the dumbbells seen lengthwise.
 */
export function curl(o: { implement: Implement | 'cable' | 'band'; incline?: boolean; concentration?: boolean; neutral?: boolean }): Demo {
  if (o.incline) return inclineCurl();
  if (o.concentration) return concentrationCurl();
  return standingCurl(o.implement, !!o.neutral);
}

/** Elbow bend at the top of a curl: the forearm about 40° from the upper arm. */
const CURL_TOP = 140;

/**
 * Standing curl: tall, knees soft, elbows by the sides, palms up. A bar
 * (barbell, EZ bar, cable bar) starts on straight arms resting on the front
 * of the thighs; dumbbells and band handles hang beside them. The forearms
 * curl the weight up in an arc to the front of the shoulders, the elbows
 * drifting a few degrees forward only at the very top, and lower it back to
 * straight arms. The body stays still, tipped very slightly back at the
 * ankles against the weight out in front (a little more against a low
 * cable's pull).
 */
function standingCurl(implement: Implement | 'cable' | 'band', neutral: boolean): Demo {
  const bar = implement === 'barbell' || implement === 'ezbar' || implement === 'cable';
  // Low pulley just off the floor, a short step in front of the toes; a band stood on under the middle of the feet.
  const pulley: Vec = { x: 0.27, y: FLOOR - 0.08 };
  const anchor: Vec = { x: MIDFOOT, y: FLOOR };
  // The weight (or the cable's tension) as a share of body weight; a band pulls the hands toward the feet, so it balances itself.
  const load: Load | undefined = implement === 'cable' ? { share: 0.2, from: pulley } : implement === 'band' ? undefined : { share: 0.3 };
  const build = (lean: number, fwd: number, flex: number): DemoPose => {
    const st = stance(lean);
    return { torso: st.torso, head: st.torso, leg: st.leg, arm: sideArm(st.torso, fwd, flex), anchor: 'ankle', at: O };
  };
  // Start: straight arms. A bar rests on the front of the thighs (the backs of the fists against them); handles hang by the thighs.
  const start = bar ? solveFor(0, 40, (fwd) => {
    const f = solve('side', build(0, fwd, 0));
    return offThigh(f, f.a.hand);
  }, BODY.hand) : 3;
  // Hammer grip: the dumbbell's inner head reaches the front of the shoulder a little sooner.
  const top = neutral ? CURL_TOP - 12 : CURL_TOP;
  const fwdAt = (s: number) => start + 6 * ramp(s, 0.55, 1);
  const lean = stillLean((v, s) => build(v, fwdAt(s), top * s), () => load);
  const pose = (s: number) => build(lean, fwdAt(s), top * s);
  const props: Prop[] =
    implement === 'cable'
      ? // A straight bar on the cable, seen end-on (a bar with no plates).
        [{ kind: 'cable', from: pulley, at: 'wrist' }, { kind: 'barbell', at: 'wrist', plate: 0 }]
      : implement === 'band'
        ? [{ kind: 'band', from: anchor, at: 'wrist' }]
        : implement === 'dumbbell'
          ? [{ kind: 'dumbbell', at: 'wrist', ...(neutral && { lengthwise: true }) }]
          : // Curling plates are smaller than a deadlift's: 10–15 kg plates on a barbell, 5–10 kg on an EZ bar.
            [{ kind: 'barbell', at: 'wrist', plate: implement === 'ezbar' ? 0.08 : 0.1 }];
  return { view: 'side', pose, props };
}

/**
 * Incline dumbbell curl: sitting back on a bench inclined about 50°, back
 * and head on the pad, feet flat. The arms hang straight down beside the
 * backrest (behind the body: the biceps start stretched), palms forward;
 * the upper arms stay vertical while the forearms curl the dumbbells up to
 * the front of the shoulders.
 */
function inclineCurl(): Demo {
  const torso = -40;
  const floor = 0.3;
  // Thighs about level, shins nearly upright, feet flat.
  const leg = legTo(O, { x: 0.27, y: floor - L.ankleHeight }, { x: 0.3, y: -1 });
  const pose = (s: number): DemoPose => ({ torso, head: torso, leg, arm: { upper: 180, fore: 180 - CURL_TOP * s }, anchor: 'hip', at: O });
  // Backrest under the back and head, seat under the glutes and thighs, each fitted so the body rests on it.
  const behind = mul(dir(torso - 90), BODY.torsoBack + PAD_HALF);
  const [b0, b1] = restingPad(pose, add(along(O, torso, L.torso + L.neck + 0.07), behind), add(O, behind), ARMS);
  const seatY = BODY.thighBack + PAD_HALF;
  const [s0, s1] = restingPad(pose, { x: -0.1, y: seatY }, { x: 0.13, y: seatY }, ARMS);
  const corner = crossing(b0, b1, s0, s1);
  // The backrest's strut, standing on the frame and propping the middle of the pad from behind.
  const strutTop = add(lerpV(b0, corner, 0.5), mul(dir(torso - 90), 0.03));
  return {
    view: 'side',
    floor,
    pose,
    props: [
      { kind: 'line', from: { x: strutTop.x + 0.03, y: floor - 0.01 }, to: strutTop, width: 0.018 },
      { kind: 'line', from: { x: strutTop.x - 0.06, y: floor - 0.008 }, to: { x: s1.x + 0.04, y: floor - 0.008 }, width: 0.016 },
      { kind: 'bench', points: [b0, corner], legs: false },
      { kind: 'bench', points: [corner, s1] },
      { kind: 'dumbbell', at: 'wrist' },
    ],
  };
}

/**
 * Concentration curl: sitting on the end of a flat bench, feet wide and
 * flat, leaning forward from the hips with a flat back. The working arm
 * hangs between the legs, the back of the upper arm braced on the inner
 * thigh near the knee (so the near thigh hides the elbow); the free hand
 * rests on the other knee. The forearm curls the dumbbell from a straight
 * arm up toward the shoulder and lowers it again.
 */
function concentrationCurl(): Demo {
  const padTop = FLOOR - BENCH_H;
  // Sitting on the back of the thighs, shins about upright, feet flat.
  const hip: Vec = { x: -0.25, y: padTop - BODY.thighBack - 0.002 };
  const leg = legTo(hip, O, UP);
  const knee = along(hip, leg.thigh, L.thigh);
  // Elbow braced on the inner thigh about three quarters of the way to the knee, in the thigh's upper half.
  const elbow = add(lerpV(hip, knee, 0.74), mul(dir(leg.thigh - 90), 0.02));
  // The trunk leans forward until the upper arm hangs from the shoulder to that point.
  const torso = solveFor(20, 70, (t) => -dist(along(hip, t, L.torso), elbow), -L.upperArm);
  const shoulder = along(hip, torso, L.torso);
  const upper = angleOf(sub(elbow, shoulder));
  // Free hand flat on top of the far thigh by the knee, fingers over it (the knee is out to the side: feet wide).
  const palm = add(lerpV(hip, knee, 0.82), mul(dir(leg.thigh - 90), BODY.thighFront + BODY.hand / 2));
  const arm2 = bracedArm(shoulder, palm, leg.thigh + 15, { x: -1, y: -0.3 });
  const pose = (s: number): DemoPose => ({
    torso,
    // Eyes on the dumbbell.
    head: torso + 18,
    leg,
    arm: { upper, fore: upper - CURL_TOP * s },
    arm2,
    anchor: 'hip',
    at: hip,
  });
  // The bench runs back from under the thighs.
  const [p0, p1] = restingPad(pose, { x: hip.x - 0.55, y: padTop + PAD_HALF }, { x: hip.x + 0.07, y: padTop + PAD_HALF }, ARMS);
  return { view: 'side', pose, props: [{ kind: 'bench', points: [p0, p1] }, { kind: 'dumbbell', at: 'wrist' }], armBehindLegs: true, working: 'a' };
}

// ── Triceps ──────────────────────────────────────────────────────────────

/**
 * Overhead dumbbell extension, standing: one dumbbell held on end, both
 * palms under its top head, arms straight up beside the head (upper arms a
 * little forward of vertical, as far as the shoulders allow). The elbows stay
 * pointing up while the forearms lower the dumbbell behind the head to about
 * a 60° elbow, then press it back up.
 */
export function overheadExtension(): Demo {
  const load: Load = { share: 0.2 };
  const fwd = 8; // upper arms just forward of the trunk line
  const bottom = 120; // elbow bend at the bottom: 60° at the elbow
  const build = (lean: number, s: number): DemoPose => {
    const st = stance(lean);
    const upper = st.torso + fwd;
    // Straight (not locked) at the top; the forearms tip back behind the head.
    return { torso: st.torso, head: st.torso, leg: st.leg, arm: { upper, fore: upper - lerp(3, bottom, s) }, anchor: 'ankle', at: O };
  };
  const lean = stillLean(build, () => load);
  return { view: 'side', pose: (s) => build(lean, s), props: [{ kind: 'dumbbell', at: 'wrist', upright: true, cupped: true }] };
}

/**
 * Triceps pushdown at a high pulley (or a band looped over a bar overhead):
 * standing close, knees soft, leaning forward a little from the hips, the
 * elbows pinned to the sides. From forearms just above parallel, push down
 * until the arms are straight with the bar at the front of the thighs. The
 * cable hangs nearly straight down to the hands.
 */
export function pushdown(o: { band?: boolean }): Demo {
  const hinge = 12;
  const flexTop = 100; // forearms just above parallel at the top: 80° at the elbow
  const build = (lean: number, fwd: number, flex: number): DemoPose => {
    const st = stance(lean, hinge);
    return { torso: st.torso, head: headFor(st.torso), leg: st.leg, arm: sideArm(st.torso, fwd, flex), anchor: 'ankle', at: O };
  };
  // Upper arms angled just enough that the straight arms put the bar on the front of the thighs.
  const fwd = solveFor(-10, 40, (v) => {
    const f = solve('side', build(0, v, 0));
    return offThigh(f, f.a.hand);
  }, BODY.hand);
  // Pulley (or the band's bar) overhead, just in front of the fists at the top (the column clear of them): the cable hangs nearly straight.
  const pulley = (lean: number): Vec => ({ x: solve('side', build(lean, fwd, flexTop)).a.hand.x + 0.06, y: o.band ? FLOOR - 1.2 : FLOOR - 1.16 });
  const lean = stillLean((v, s) => build(v, fwd, flexTop * (1 - s)), (v) => ({ share: 0.2, from: pulley(v) }));
  const from = pulley(lean);
  const pose = (s: number) => build(lean, fwd, flexTop * (1 - s));
  const props: Prop[] = o.band
    ? [{ kind: 'bar', at: { x: from.x, y: from.y - 0.012 } }, { kind: 'band', from, at: 'wrist' }]
    : // A straight bar on the cable, seen end-on (a bar with no plates).
      [{ kind: 'cable', from, at: 'wrist' }, { kind: 'barbell', at: 'wrist', plate: 0 }];
  return { view: 'side', pose, props };
}

/**
 * One-arm dumbbell kickback: hinged forward with a flat back (trunk about
 * 70° from vertical), knees soft, the free hand braced on its knee. The
 * working upper arm stays up along the side, a little above the line of the
 * back, palm facing in (the dumbbell seen lengthwise); the forearm swings
 * from hanging straight down to straight back in line with it. The hips sit
 * back until lifter and dumbbell balance over the feet.
 */
export function kickback(): Demo {
  const torso = 70;
  const shin = 182; // shins about upright, knees soft
  const load: Load = { share: 0.12 };
  const upper = torso + 190; // 10° above the line of the trunk
  const build = (thighBack: number, s: number): DemoPose => {
    const leg: Leg = { thigh: 180 - thighBack, shin, foot: 90 };
    const knee = along(O, shin + 180, L.shin);
    const hip = along(knee, leg.thigh + 180, L.thigh);
    const shoulder = along(hip, torso, L.torso);
    // Free hand flat on its knee, fingers over the kneecap.
    const palm = add(lerpV(hip, knee, 0.93), mul(dir(leg.thigh - 90), BODY.thighFront + BODY.hand / 2));
    return {
      torso,
      head: headFor(torso),
      leg,
      arm: { upper, fore: lerp(180, upper, s) },
      arm2: bracedArm(shoulder, palm, leg.thigh, { x: -0.4, y: -1 }),
      anchor: 'ankle',
      at: O,
    };
  };
  // Hips back until balanced with the dumbbell hanging (the stance then stays put).
  const thighBack = solveFor(0, 80, (t) => -pressureX(solve('side', build(t, 0)), load), -BALANCE);
  return { view: 'side', pose: (s) => build(thighBack, s), props: [{ kind: 'dumbbell', at: 'wrist', lengthwise: true }], working: 'a' };
}
