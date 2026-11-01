// Movement patterns for exercise demos. Each returns a Demo whose pose(s)
// goes from the start position (s = 0) to the turnaround (s = 1). Patterns are
// parameterized so one pattern covers many exercises; everything is data the
// renderer draws and the tests feed through the analysis engine.
//
// Side view: the lifter faces right. Lying face-up: head to the LEFT (the
// front of the body faces up). Lying face-down: head to the right.
import {
  L,
  add,
  solve,
  along,
  armTo,
  dir,
  legTo,
  lerp,
  lerpAngle,
  lerpV,
  type Arm,
  type DemoPose,
  type Leg,
  type Vec,
} from './figure';
import type { Demo, Prop } from './types';

const O: Vec = { x: 0, y: 0 };
/** Floor y when an ankle stands at y = 0. */
export const FLOOR = L.ankleHeight;
const LEG_LEN = L.thigh + L.shin;
const ARM_LEN = L.upperArm + L.forearm;
const STAND: Leg = { thigh: 180, shin: 180, foot: 90 };
const HANG: Arm = { upper: 180, fore: 180 };
const UP: Vec = { x: 0, y: -1 };
const DOWN: Vec = { x: 0, y: 1 };
const FWD: Vec = { x: 1, y: 0 };
const BACK: Vec = { x: -1, y: 0 };

/** Knee, hip and shoulder from an ankle and segment directions. */
function chainUp(ankle: Vec, shin: number, thigh: number, torso: number) {
  const knee = along(ankle, shin + 180, L.shin);
  const hip = along(knee, thigh + 180, L.thigh);
  const shoulder = along(hip, torso, L.torso);
  return { knee, hip, shoulder };
}

function mixLeg(a: Leg, b: Leg, s: number): Leg {
  return { thigh: lerpAngle(a.thigh, b.thigh, s), shin: lerpAngle(a.shin, b.shin, s), foot: lerpAngle(a.foot, b.foot, s) };
}
function mixArm(a: Arm, b: Arm, s: number): Arm {
  return {
    upper: lerpAngle(a.upper, b.upper, s),
    fore: lerpAngle(a.fore, b.fore, s),
    ...((a.scale ?? 1) !== 1 || (b.scale ?? 1) !== 1 ? { scale: lerp(a.scale ?? 1, b.scale ?? 1, s) } : {}),
  };
}
/** Interpolates two poses (angles, anchor position, scales). */
export function mix(a: DemoPose, b: DemoPose, s: number): DemoPose {
  return {
    torso: lerpAngle(a.torso, b.torso, s),
    head: a.head !== undefined || b.head !== undefined ? lerpAngle(a.head ?? a.torso, b.head ?? b.torso, s) : undefined,
    torsoScale: lerp(a.torsoScale ?? 1, b.torsoScale ?? 1, s),
    leg: mixLeg(a.leg, b.leg, s),
    arm: mixArm(a.arm, b.arm, s),
    leg2: a.leg2 || b.leg2 ? mixLeg(a.leg2 ?? a.leg, b.leg2 ?? b.leg, s) : undefined,
    arm2: a.arm2 || b.arm2 ? mixArm(a.arm2 ?? a.arm, b.arm2 ?? b.arm, s) : undefined,
    anchor: a.anchor,
    at: lerpV(a.at, b.at, s),
  };
}

const standing = (o: Partial<DemoPose> = {}): DemoPose => ({ torso: 0, leg: STAND, arm: HANG, anchor: 'ankle', at: O, ...o });
const between = (a: DemoPose, b: DemoPose): ((s: number) => DemoPose) => (s) => mix(a, b, s);

type Implement = 'barbell' | 'ezbar' | 'dumbbell' | 'kettlebell' | 'none';
const handProp = (imp: Implement, at: 'wrist' | 'wrists' = 'wrist'): Prop[] =>
  imp === 'barbell'
    ? [{ kind: 'barbell', at }]
    : imp === 'ezbar'
      ? [{ kind: 'barbell', at, plate: 0.09 }]
      : imp === 'dumbbell'
        ? [{ kind: 'dumbbell', at }]
        : imp === 'kettlebell'
          ? [{ kind: 'kettlebell', at }]
          : [];

// ── Squats and lunges ─────────────────────────────────────────────────────

export function squat(o: {
  hold: 'back' | 'front' | 'goblet' | 'arms' | 'handles';
  thigh: number;
  shin: number;
  lean: number;
  /** Torso lean at the start (hack squat keeps it constant). */
  startLean?: number;
  box?: boolean;
  pad?: boolean;
  pauseFar?: number;
}): Demo {
  const arms = (torso: number): Arm => {
    switch (o.hold) {
      case 'back':
      case 'handles':
        return { upper: torso + 200, fore: torso + 345 };
      case 'front':
        return { upper: torso + 90, fore: torso + 250 };
      case 'goblet':
        return { upper: torso + 160, fore: torso + 20 };
      case 'arms':
        return { upper: 90, fore: 90 };
    }
  };
  const pose = (s: number): DemoPose => {
    const torso = lerp(o.startLean ?? 0, o.lean, s);
    return standing({
      torso,
      head: torso * 0.5,
      leg: { thigh: lerp(180, o.thigh, s), shin: lerp(180, 180 + o.shin, s), foot: 90 },
      arm: arms(torso),
    });
  };
  const props: Prop[] = [];
  if (o.hold === 'back') props.push({ kind: 'barbell', at: 'backRack' });
  if (o.hold === 'front') props.push({ kind: 'barbell', at: 'frontRack' });
  if (o.hold === 'goblet') props.push({ kind: 'dumbbell', at: 'wrist', upright: true });
  if (o.box) {
    const { hip } = chainUp(O, 180 + o.shin, o.thigh, o.lean);
    props.push({ kind: 'box', x: hip.x - 0.12, y: hip.y + 0.06, w: 0.2, h: FLOOR - (hip.y + 0.06) });
  }
  if (o.pad) props.push({ kind: 'pad', at: 'shoulder', offset: { x: -0.02, y: -0.01 } });
  return { view: 'side', pose, props, pauseFar: o.pauseFar };
}

/** Split stance: near (front) foot at the origin, rear foot behind. */
export function lunge(o: { rear: 'floor' | 'bench'; implement?: Implement; drop?: number; lean?: number }): Demo {
  const stride = o.rear === 'bench' ? 0.52 : 0.46;
  const rearAnkle: Vec = o.rear === 'bench' ? { x: -stride, y: -0.255 } : { x: -stride, y: -0.075 };
  const rearFoot = o.rear === 'bench' ? 290 : 120; // on its laces on the bench / up on the toes
  const hipX = -stride * 0.42;
  const reach = (a: Vec) => Math.sqrt(Math.max(0, (LEG_LEN * 0.985) ** 2 - (a.x - hipX) ** 2));
  const topY = Math.max(-reach(O), rearAnkle.y - reach(rearAnkle));
  const drop = o.drop ?? 0.21;
  const pose = (s: number): DemoPose => {
    const hip = { x: hipX + 0.03 * s, y: topY + drop * s };
    const torso = lerp(4, o.lean ?? 10, s);
    // Weights hang at the sides; without them, hands rest on the hips.
    const arm: Arm = o.implement && o.implement !== 'none' ? HANG : { upper: torso + 215, fore: torso + 130 };
    return {
      torso,
      leg: legTo(hip, O, FWD),
      leg2: { ...legTo(hip, rearAnkle, { x: 0.3, y: 1 }), foot: rearFoot },
      arm,
      anchor: 'ankle',
      at: O,
    };
  };
  const props: Prop[] = handProp(o.implement ?? 'none');
  if (o.rear === 'bench') props.push({ kind: 'bench', points: [{ x: -stride - 0.12, y: rearAnkle.y + 0.04 }, { x: -stride + 0.12, y: rearAnkle.y + 0.04 }] });
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

// ── Hinges ────────────────────────────────────────────────────────────────

/** Hip hinge from standing (s = 0) to the bottom (s = 1). */
export function hinge(o: {
  implement: Implement | 'backBar' | 'cable';
  torso: number;
  /** Thigh tilt back from vertical at the bottom (hips back). */
  hipsBack: number;
  /** Knee forward travel at the bottom, degrees of shin tilt. */
  knee: number;
  /** Bar height at the bottom: fraction from knee (0) to ankle (1). */
  reach?: number;
  singleLeg?: boolean;
}): Demo {
  const at = (s: number) => {
    const torso = o.torso * s;
    const shin = 180 + o.knee * s;
    const thigh = 180 - o.hipsBack * s;
    const { knee, shoulder } = chainUp(O, shin, thigh, torso);
    return { torso, shin, thigh, knee, shoulder };
  };
  const pose = (s: number): DemoPose => {
    const { torso, shin, thigh, knee, shoulder } = at(s);
    let arm: Arm;
    if (o.implement === 'backBar') arm = { upper: torso + 200, fore: torso + 345 };
    else if (o.implement === 'cable') {
      const top = { x: shoulder.x + 0.03, y: shoulder.y + ARM_LEN * 0.97 };
      arm = armTo(shoulder, lerpV(top, { x: knee.x - 0.05, y: knee.y + 0.03 }, s), BACK);
    } else {
      // The weight slides down the front of the legs; arms hang as long as they can.
      const x = lerp(0.03, knee.x + 0.03, s);
      const reach = ARM_LEN * 0.97;
      const y = shoulder.y + Math.sqrt(Math.max(0, reach ** 2 - (x - shoulder.x) ** 2));
      arm = armTo(shoulder, { x, y: Math.min(y, lerp(knee.y, FLOOR, o.reach ?? 0.3)) }, BACK);
    }
    return {
      torso,
      head: torso * 0.6,
      leg: { thigh, shin, foot: 90 },
      leg2: o.singleLeg ? { thigh: lerp(178, torso + 180, s), shin: lerp(178, torso + 180, s), foot: lerp(90, torso + 90, s) } : undefined,
      arm,
      anchor: 'ankle',
      at: O,
    };
  };
  const props: Prop[] =
    o.implement === 'backBar'
      ? [{ kind: 'barbell', at: 'backRack' }]
      : o.implement === 'cable'
        ? [{ kind: 'cable', from: { x: -0.75, y: -0.02 }, at: 'wrist' }]
        : handProp(o.implement);
  return { view: 'side', pose, props };
}

/** Conventional / sumo deadlift: s = 0 at the floor, s = 1 at lockout. */
export function deadlift(o: { thigh: number; shin: number; torso: number }): Demo {
  const plate = 0.125;
  const bottomBar: Vec = { x: 0.04, y: FLOOR - plate };
  const pose = (s: number): DemoPose => {
    const torso = lerp(o.torso, 0, s);
    const thigh = lerp(o.thigh, 180, s);
    const shin = lerp(o.shin, 180, s);
    const { shoulder } = chainUp(O, shin, thigh, torso);
    const lockBar = { x: 0.03, y: shoulder.y + ARM_LEN * 0.97 };
    const bar = s < 1 ? { x: lerp(bottomBar.x, lockBar.x, s), y: lerp(bottomBar.y, lockBar.y, s) } : lockBar;
    return { torso, head: torso * 0.4, leg: { thigh, shin, foot: 90 }, arm: armTo(shoulder, bar, BACK), anchor: 'ankle', at: O };
  };
  return { view: 'side', pose, props: [{ kind: 'barbell', at: 'wrist', plate }] };
}

export function swing(): Demo {
  const hingeAt = (s: number) => chainUp(O, 180 + 10 * s, 180 - 22 * s, 68 * s);
  return {
    view: 'side',
    pose: (s) => {
      // s = 0: bell swung back between the legs; s = 1: standing, bell at chest height.
      const k = 1 - s;
      const { knee, shoulder } = hingeAt(k);
      const back = armTo(shoulder, { x: knee.x - 0.08, y: knee.y + 0.02 }, BACK);
      const front: Arm = { upper: 92, fore: 92 };
      return {
        torso: 68 * k,
        head: 40 * k,
        leg: { thigh: 180 - 22 * k, shin: 180 + 10 * k, foot: 90 },
        arm: mixArm(back, front, s),
        anchor: 'ankle',
        at: O,
      };
    },
    props: [{ kind: 'kettlebell', at: 'wrist' }],
  };
}

export function nordic(): Demo {
  const knee: Vec = { x: 0, y: FLOOR - 0.05 };
  return {
    view: 'side',
    floor: FLOOR,
    pose: (s) => {
      const thigh = lerp(180, 232, s);
      const torso = thigh - 180;
      return {
        torso,
        head: torso,
        leg: { thigh, shin: 270, foot: 180 },
        arm: { upper: torso + 150, fore: torso + 120 },
        anchor: 'knee',
        at: knee,
      };
    },
    props: [{ kind: 'pad', at: 'ankle', offset: { x: 0, y: -0.04 } }],
  };
}

/** The same movement played from the other end (start ↔ turnaround). */
export function reversed(d: Demo): Demo {
  return { ...d, pose: (s) => d.pose(1 - s) };
}

/** Face down on a bench, head right; heels curl up toward the glutes. */
export function lyingLegCurl(): Demo {
  return {
    view: 'side',
    floor: 0.5,
    pose: (s) => {
      const shin = lerp(272, 375, s);
      return { torso: 92, head: 80, leg: { thigh: 270, shin, foot: shin - 90 }, arm: { upper: 172, fore: 92 }, anchor: 'hip', at: O };
    },
    props: [
      { kind: 'bench', points: [{ x: -0.32, y: 0.06 }, { x: 0.42, y: 0.06 }], legs: true },
      { kind: 'pad', at: 'ankle', offset: { x: 0.0, y: -0.045 } },
    ],
  };
}

/** Seated, legs straight out in front; heels curl down and back. */
export function seatedLegCurl(): Demo {
  const torso = -10;
  return {
    view: 'side',
    floor: 0.4,
    pose: (s) => {
      const shin = lerp(92, 200, s);
      return { torso, leg: { thigh: 90, shin, foot: shin - 90 }, arm: { upper: 172, fore: 172 }, anchor: 'hip', at: O };
    },
    props: [
      { kind: 'bench', points: [along({ x: -0.05, y: 0.06 }, torso, 0.42), { x: -0.05, y: 0.06 }, { x: 0.24, y: 0.06 }], legs: true },
      { kind: 'pad', at: 'ankle', offset: { x: 0.0, y: -0.045 } },
    ],
  };
}

// ── Lying hip extension (bridges, thrusts, slider curls) ───────────────────

/** Face up, head to the left. s = 0 hips down, s = 1 hips up. */
export function bridge(o: { onBench: boolean; implement?: Implement; singleLeg?: boolean; slider?: boolean }): Demo {
  const floor = FLOOR;
  const shoulder: Vec = o.onBench ? { x: 0, y: floor - 0.27 } : { x: 0, y: floor - 0.06 };
  const footY = floor - L.ankleHeight;
  const pose = (s: number): DemoPose => {
    let hip: Vec;
    let ankle: Vec;
    if (o.slider) {
      ankle = { x: lerp(0.86, 0.6, s), y: footY };
      hip = { x: lerp(0.29, 0.27, s), y: lerp(floor - 0.08, floor - 0.25, s) };
    } else if (o.onBench) {
      ankle = { x: 0.54, y: footY };
      const phi = lerp(150, 92, s); // direction shoulder → hip
      hip = along(shoulder, phi, L.torso);
    } else {
      ankle = { x: 0.52, y: footY };
      hip = along(shoulder, lerp(100, 72, s), L.torso);
    }
    const torso = Math.atan2(shoulder.x - hip.x, -(shoulder.y - hip.y)) * (180 / Math.PI);
    const leg = legTo(hip, ankle, UP);
    return {
      torso,
      head: torso,
      leg,
      leg2: o.singleLeg ? { thigh: leg.thigh, shin: leg.thigh, foot: leg.thigh - 90 } : undefined,
      // Hands hold the weight on the lap, or rest on the floor / bench.
      arm:
        o.implement && o.implement !== 'none'
          ? armTo(shoulder, along(hip, torso + 90, 0.08), UP)
          : { upper: torso + 170, fore: torso + 175 },
      anchor: 'shoulder',
      at: shoulder,
    };
  };
  const props: Prop[] = [];
  if (o.onBench) props.push({ kind: 'bench', points: [{ x: -0.45, y: shoulder.y + 0.045 }, { x: 0.03, y: shoulder.y + 0.045 }] });
  if (o.implement === 'barbell') props.push({ kind: 'barbell', at: 'lap' });
  if (o.implement === 'dumbbell') props.push({ kind: 'dumbbell', at: 'lap' });
  return { view: 'side', floor, pose, props };
}

/** Front view, lying on the left side, head to the right; top leg lifts. */
export function sideLyingAbduction(): Demo {
  const hip: Vec = { x: 0, y: FLOOR - 0.12 };
  return {
    view: 'front',
    floor: FLOOR,
    pose: (s) => ({
      torso: 90,
      head: 85,
      leg: { thigh: lerp(270, 306, s), shin: lerp(270, 306, s), foot: 0 },
      leg2: { thigh: 270, shin: 270, foot: 0 },
      // Top arm rests along the body; bottom arm pillows the head.
      arm: { upper: 262, fore: 262 },
      arm2: { upper: 140, fore: 40 },
      anchor: 'hip',
      at: hip,
    }),
  };
}

// ── Calves ────────────────────────────────────────────────────────────────

export function calfRaise(o: { implement?: Implement; single?: boolean; seated?: boolean; machine?: boolean }): Demo {
  const toe: Vec = { x: L.foot, y: 0 };
  if (o.seated) {
    const hip: Vec = { x: -0.24, y: -0.5 };
    return {
      view: 'side',
      pose: (s) => {
        const foot = lerp(90, 124, s);
        const ankle = add(add(toe, { x: -L.foot * Math.sin((foot * Math.PI) / 180), y: L.foot * Math.cos((foot * Math.PI) / 180) }), { x: 0, y: 0 });
        const ankleAt = { x: ankle.x - L.ankleHeight * Math.cos((foot * Math.PI) / 180) * 0, y: ankle.y - L.ankleHeight * Math.sin((foot * Math.PI) / 180) + (foot === 90 ? 0 : 0) };
        return {
          torso: 8,
          leg: { ...legTo(hip, ankleAt, UP), foot },
          arm: armTo(along(hip, 8, L.torso), add(hip, { x: 0.21, y: -0.06 }), BACK),
          anchor: 'hip',
          at: hip,
        };
      },
      props: [{ kind: 'box', x: -0.42, y: -0.47, w: 0.26, h: 0.505 }, { kind: 'dumbbell', at: 'knee' }],
    };
  }
  return {
    view: 'side',
    pose: (s) => ({
      torso: 0,
      leg: { thigh: 180, shin: 180, foot: lerp(90, 120, s) },
      leg2: o.single ? { thigh: 178, shin: 250, foot: 160 } : undefined,
      arm: o.machine ? { upper: 200, fore: 345 } : o.implement === 'dumbbell' ? HANG : { upper: 175, fore: 175 },
      anchor: 'toe',
      at: toe,
    }),
    props: o.machine ? [{ kind: 'pad', at: 'shoulder', offset: { x: 0, y: -0.03 } }] : handProp(o.implement ?? 'none'),
  };
}

// ── Presses ───────────────────────────────────────────────────────────────

/** Face-up press on a bench or the floor: head left, bar over the shoulders. */
export function lyingPress(o: { implement: Implement; incline?: number; floor?: boolean; closeGrip?: boolean }): Demo {
  const incline = o.incline ?? 0;
  const benchTop = o.floor ? FLOOR : FLOOR - 0.25;
  const hip: Vec = { x: 0.28, y: benchTop - 0.05 };
  const torso = 270 + incline;
  const shoulder = along(hip, torso, L.torso);
  const ankle: Vec = { x: o.floor ? 0.62 : 0.66, y: FLOOR - L.ankleHeight };
  const top = { x: shoulder.x, y: shoulder.y - ARM_LEN * 0.992 };
  const bottom = { x: shoulder.x + (o.closeGrip ? 0.07 : 0.05), y: shoulder.y - (o.floor ? 0.14 : 0.08) };
  const pose = (s: number): DemoPose => ({
    torso,
    head: torso,
    leg: legTo(hip, ankle, UP),
    arm: armTo(shoulder, lerpV(top, bottom, s), o.floor ? DOWN : { x: 0.3, y: 1 }),
    anchor: 'hip',
    at: hip,
  });
  const props: Prop[] = handProp(o.implement);
  if (!o.floor) {
    const seatEnd = { x: hip.x + 0.12, y: benchTop };
    const backStart = along({ x: hip.x - 0.02, y: benchTop }, torso, 0.36);
    props.unshift({ kind: 'bench', points: incline ? [backStart, { x: hip.x - 0.02, y: benchTop }, seatEnd] : [{ x: backStart.x - 0.04, y: benchTop }, seatEnd] });
  }
  return { view: 'side', pose, props };
}

/** Push-up family: body pivots on the toes (or knees), hands fixed. */
export function pushUp(o: { variant: 'standard' | 'incline' | 'knee' | 'diamond' | 'pike' }): Demo {
  if (o.variant === 'pike') {
    // Hips high; the head lowers toward the floor just in front of the hands.
    const toe: Vec = { x: -0.04, y: 0 };
    const wrist: Vec = { x: 0.62, y: FLOOR - 0.01 };
    return {
      view: 'side',
      pose: (s) => {
        const hip = lerpV({ x: 0.284, y: -0.445 }, { x: 0.36, y: -0.4 }, s);
        const torso = lerp(125, 158, s);
        const shoulder = along(hip, torso, L.torso);
        const legDir = Math.atan2(toe.x - hip.x, -(toe.y - hip.y)) * (180 / Math.PI);
        return {
          torso,
          head: torso + 20,
          leg: { thigh: legDir, shin: legDir, foot: legDir - 80 },
          arm: armTo(shoulder, wrist, BACK),
          anchor: 'hip',
          at: hip,
        };
      },
    };
  }
  const knee = o.variant === 'knee';
  // The body pivots on the toes (or knees); hands stay planted under the
  // shoulders. The shoulder is pinned so the arm geometry is exact.
  const pivot: Vec = { x: 0, y: knee ? FLOOR - 0.05 : FLOOR - 0.06 };
  const handY = o.variant === 'incline' ? FLOOR - 0.3 : FLOOR - 0.01;
  const bodyLen = knee ? L.thigh + L.torso : LEG_LEN + L.torso + 0.03;
  const shoulderAt = (aboveHand: number): Vec => {
    const dy = pivot.y - (handY - aboveHand);
    return { x: pivot.x + Math.sqrt(Math.max(0, bodyLen ** 2 - dy ** 2)), y: handY - aboveHand };
  };
  const start = shoulderAt(ARM_LEN * 0.96);
  const wrist: Vec = { x: start.x + (o.variant === 'diamond' ? 0.03 : 0.01), y: handY };
  return {
    view: 'side',
    pose: (s) => {
      const shoulder = shoulderAt(lerp(ARM_LEN * 0.96, 0.075, s));
      const body = Math.atan2(shoulder.x - pivot.x, -(shoulder.y - pivot.y)) * (180 / Math.PI);
      return {
        torso: body,
        head: body,
        leg: knee ? { thigh: body + 180, shin: 270, foot: 180 } : { thigh: body + 180, shin: body + 180, foot: body + 100 },
        arm: armTo(shoulder, wrist, { x: -1, y: -0.3 }),
        anchor: 'shoulder',
        at: shoulder,
      };
    },
    props:
      o.variant === 'incline'
        ? [{ kind: 'bench', points: [{ x: wrist.x - 0.12, y: handY + 0.035 }, { x: wrist.x + 0.2, y: handY + 0.035 }] }]
        : [],
  };
}

export function dip(o: { onBench: boolean }): Demo {
  if (o.onBench) {
    const wrist: Vec = { x: 0, y: FLOOR - 0.26 };
    const ankle: Vec = { x: 0.62, y: FLOOR - L.ankleHeight };
    return {
      view: 'side',
      pose: (s) => {
        const shoulder = { x: wrist.x + lerp(0.035, 0.09, s), y: wrist.y - lerp(ARM_LEN * 0.97, 0.16, s) };
        const hip = along(shoulder, 182, L.torso);
        return {
          torso: 2,
          leg: legTo(hip, ankle, UP),
          arm: armTo(shoulder, wrist, BACK),
          anchor: 'shoulder',
          at: shoulder,
        };
      },
      props: [{ kind: 'bench', points: [{ x: -0.3, y: wrist.y + 0.035 }, { x: 0.02, y: wrist.y + 0.035 }] }],
    };
  }
  const wrist: Vec = { x: 0, y: 0 };
  return {
    view: 'side',
    floor: null,
    pose: (s) => {
      const shoulder = { x: lerp(-0.02, -0.1, s), y: lerp(-ARM_LEN * 0.97, -0.12, s) };
      const torso = lerp(10, 25, s);
      return {
        torso,
        head: torso,
        leg: { thigh: 175, shin: 235, foot: 160 },
        arm: armTo(shoulder, wrist, BACK),
        anchor: 'shoulder',
        at: shoulder,
      };
    },
    // Parallel bars run front to back, so from the side they look like a line.
    props: [{ kind: 'line', from: { x: -0.32, y: 0.018 }, to: { x: 0.3, y: 0.018 }, width: 0.022 }],
  };
}

export function fly(): Demo {
  const p = lyingPress({ implement: 'dumbbell' });
  const hip: Vec = { x: 0.28, y: FLOOR - 0.3 };
  const shoulder = along(hip, 270, L.torso);
  return {
    ...p,
    pose: (s) => {
      // Arms open out to the sides: seen from the side they point at the camera and look short.
      const scale = lerp(1, 0.42, s);
      const base = p.pose(0);
      return { ...base, arm: armTo(shoulder, along(shoulder, lerp(2, 40, s), ARM_LEN * 0.97 * scale), DOWN, scale) };
    },
  };
}

/** Standing overhead press; s = 0 at the shoulders, s = 1 locked out. */
export function overheadPress(o: { implement: Implement; seated?: boolean; dip?: boolean; machine?: boolean }): Demo {
  const seatHip: Vec = { x: 0, y: 0 };
  const pose = (s: number): DemoPose => {
    const base: DemoPose = o.seated
      ? { torso: -6, leg: { thigh: 90, shin: 180, foot: 90 }, arm: HANG, anchor: 'hip', at: seatHip }
      : standing(o.dip ? { leg: { thigh: 180 - 14 * Math.sin(Math.PI * Math.min(1, s * 3)), shin: 180 + 12 * Math.sin(Math.PI * Math.min(1, s * 3)), foot: 90 } } : {});
    const torso = base.torso;
    const shoulderRel = along({ x: 0, y: 0 }, torso, L.torso);
    const rack = add(shoulderRel, { x: 0.07, y: -0.01 });
    const lock = add(shoulderRel, { x: 0.015, y: -ARM_LEN * 0.992 });
    // Arm angles from relative positions (the anchor doesn't change them).
    return { ...base, arm: armTo(shoulderRel, lerpV(rack, lock, s), { x: 1, y: 0.3 }) };
  };
  const props: Prop[] = handProp(o.implement);
  if (o.seated) props.unshift({ kind: 'bench', points: [along({ x: -0.06, y: 0.06 }, -6, 0.45), { x: -0.06, y: 0.06 }, { x: 0.2, y: 0.06 }], legs: true });
  return { view: 'side', floor: o.seated ? L.shin + L.ankleHeight : undefined, pose, props };
}

export function handstandPushUp(): Demo {
  const wrist: Vec = { x: 0, y: FLOOR - 0.01 };
  return {
    view: 'side',
    pose: (s) => {
      const shoulder = { x: lerp(0.005, 0.07, s), y: wrist.y - lerp(ARM_LEN * 0.985, 0.14, s) };
      return {
        torso: 178,
        head: 178,
        leg: { thigh: 0, shin: 0, foot: 270 },
        arm: armTo(shoulder, wrist, { x: 1, y: 0 }),
        anchor: 'shoulder',
        at: shoulder,
      };
    },
    props: [{ kind: 'wall', x: -0.1, top: -1.1 }],
  };
}

// ── Raises (front view and side view) ─────────────────────────────────────

export function lateralRaise(o: { oneArm?: boolean; cable?: boolean; bentOver?: boolean }): Demo {
  const torsoScale = o.bentOver ? 0.42 : 1;
  const leg: Leg = o.bentOver ? { thigh: 186, shin: 178, foot: 0 } : { thigh: 184, shin: 180, foot: 0 };
  const leg2: Leg = o.bentOver ? { thigh: 174, shin: 182, foot: 0 } : { thigh: 176, shin: 180, foot: 0 };
  return {
    view: 'front',
    pose: (s) => ({
      torso: 0,
      torsoScale,
      leg,
      leg2,
      // The lifter's right arm is on the image left (270 = out to the side).
      arm: { upper: lerp(188, 268, s), fore: lerp(185, 262, s) },
      arm2: o.oneArm ? { upper: 172, fore: 175 } : { upper: lerp(172, 92, s), fore: lerp(175, 98, s) },
      anchor: 'ankle',
      at: O,
    }),
    props: o.cable
      ? [{ kind: 'cable', from: { x: 0.25, y: -0.02 }, at: 'wrist' }]
      : [{ kind: 'dumbbell', at: o.oneArm ? 'wrist' : 'wrists' }],
  };
}

export function frontRaise(): Demo {
  return {
    view: 'side',
    pose: between(standing({ arm: { upper: 172, fore: 172 } }), standing({ arm: { upper: 92, fore: 95 } })),
    props: [{ kind: 'dumbbell', at: 'wrist' }],
  };
}

// ── Rows and pulls ────────────────────────────────────────────────────────

export function row(o: { implement: Implement; torso: number; oneArm?: boolean; chestSupported?: boolean }): Demo {
  const torso = o.torso;
  const leg: Leg = o.chestSupported ? { thigh: 196, shin: 176, foot: 90 } : o.oneArm ? { thigh: 172, shin: 186, foot: 90 } : { thigh: 165, shin: 196, foot: 90 };
  const { hip, shoulder } = chainUp(O, leg.shin, leg.thigh, torso);
  const hang = { x: shoulder.x + 0.02, y: shoulder.y + ARM_LEN * 0.96 };
  const ribs = { x: hip.x + 0.1, y: hip.y - 0.02 };
  // One-arm row: the far knee and hand rest on a bench beside the standing leg.
  const knee2 = { x: hip.x, y: hip.y + L.thigh };
  const benchTop = knee2.y + 0.035;
  const hand2 = { x: shoulder.x + 0.04, y: benchTop - 0.012 };
  const pose = (s: number): DemoPose => ({
    torso,
    head: torso * 0.55,
    leg,
    leg2: o.oneArm ? { thigh: 180, shin: 270, foot: 180 } : undefined,
    arm: armTo(shoulder, lerpV(hang, ribs, s), { x: -1, y: -1 }),
    arm2: o.oneArm ? armTo(shoulder, hand2, BACK) : undefined,
    anchor: 'ankle',
    at: O,
  });
  const props: Prop[] = handProp(o.implement);
  if (o.oneArm) props.unshift({ kind: 'bench', points: [{ x: knee2.x - 0.3, y: benchTop }, { x: hand2.x + 0.08, y: benchTop }] });
  if (o.chestSupported) {
    // Incline pad under the chest, parallel to the torso.
    const off = along(O, torso + 90, 0.075);
    props.unshift({ kind: 'bench', points: [add(along(hip, torso, -0.02), off), add(along(hip, torso, 0.3), off)] });
  }
  return { view: 'side', pose, props };
}

/** Hanging from a bar at the origin. */
export function pullUp(o: { startTop?: boolean; scapular?: boolean; chin?: boolean }): Demo {
  const bar: Vec = { x: 0, y: 0 };
  const hangShoulder = { x: -0.02, y: ARM_LEN * 0.985 };
  const topShoulder = o.scapular ? { x: -0.03, y: ARM_LEN * 0.985 - 0.06 } : { x: -0.06, y: 0.075 };
  const pose = (s0: number): DemoPose => {
    const s = o.startTop ? 1 - s0 : s0;
    const shoulder = lerpV(hangShoulder, topShoulder, s);
    const torso = o.scapular ? lerp(-4, -16, s) : lerp(-6, -18, s);
    return {
      torso,
      head: torso + (o.scapular ? 0 : 10 * s),
      leg: { thigh: 185 + torso * 0.3, shin: 205, foot: 150 },
      arm: armTo(shoulder, bar, o.chin ? FWD : { x: 0.6, y: 0.3 }),
      anchor: 'shoulder',
      at: shoulder,
    };
  };
  return { view: 'side', floor: null, pose, props: [{ kind: 'bar', at: { x: 0.005, y: -0.012 } }] };
}

export function invertedRow(): Demo {
  const ankle: Vec = { x: 0, y: FLOOR - L.ankleHeight - 0.02 };
  const bar: Vec = { x: 0.7, y: FLOOR - 0.5 };
  const bodyLen = LEG_LEN + L.torso;
  // Angle of the straight body from the heels, for a given shoulder-to-bar distance.
  // Raise the body from horizontal until the shoulder is within reach.
  const solveBody = (reach: number) => {
    for (let lift = 0; lift < 89; lift += 0.25) {
      const sh = along(ankle, 90 - lift, bodyLen);
      if (Math.hypot(sh.x - bar.x, sh.y - bar.y) <= reach) return 90 - lift;
    }
    return 1;
  };
  return {
    view: 'side',
    pose: (s) => {
      const body = solveBody(lerp(ARM_LEN * 0.97, 0.1, s)); // direction ankle → shoulder
      const shoulder = along(ankle, body, bodyLen);
      return {
        torso: body,
        head: body,
        leg: { thigh: body + 180, shin: body + 180, foot: body + 90 - 180 },
        arm: armTo(shoulder, bar, DOWN),
        anchor: 'ankle',
        at: ankle,
      };
    },
    props: [{ kind: 'bar', at: { x: bar.x + 0.005, y: bar.y - 0.012 } }],
  };
}

export function pulldown(o: { straightArm?: boolean }): Demo {
  if (o.straightArm) {
    const torso = 18;
    return {
      view: 'side',
      pose: (s) =>
        standing({
          torso,
          head: 8,
          leg: { thigh: 172, shin: 186, foot: 90 },
          arm: { upper: lerp(40, 168, s), fore: lerp(42, 170, s) },
        }),
      props: [{ kind: 'cable', from: { x: 0.85, y: -1.1 }, at: 'wrist' }],
    };
  }
  const hip: Vec = { x: 0, y: 0 };
  const torso = -14;
  const shoulder = along(hip, torso, L.torso);
  return {
    view: 'side',
    floor: 0.3,
    pose: (s) => ({
      torso,
      leg: { thigh: 95, shin: 180, foot: 90 },
      arm: armTo(shoulder, lerpV(add(shoulder, { x: 0.06, y: -ARM_LEN * 0.98 }), add(shoulder, { x: 0.1, y: -0.02 }), s), { x: 0.4, y: 1 }),
      anchor: 'hip',
      at: hip,
    }),
    props: [
      { kind: 'cable', from: { x: shoulder.x + 0.08, y: shoulder.y - 0.6 }, at: 'wrist' },
      { kind: 'bench', points: [{ x: -0.08, y: 0.06 }, { x: 0.22, y: 0.06 }], legs: true },
      { kind: 'pad', at: 'knee', offset: { x: 0.02, y: -0.05 } },
    ],
  };
}

export function backExtension(): Demo {
  const ankle: Vec = { x: 0, y: -0.22 };
  const pose = (s: number): DemoPose => {
    const torso = lerp(48, 158, s);
    return {
      torso,
      head: torso,
      leg: { thigh: 228, shin: 228, foot: 138 },
      arm: { upper: torso + 160, fore: torso + 30 },
      anchor: 'ankle',
      at: ankle,
    };
  };
  // Pad under the thighs, parallel to the legs, on a post.
  const f = solve('side', pose(0));
  const under = along(O, 228 - 90, 0.05);
  const padA = add(f.a.knee, under);
  const padB = add(along(f.a.hip, 48, 0.02), under);
  return {
    view: 'side',
    pose,
    props: [
      { kind: 'pad', at: 'ankle', offset: { x: -0.035, y: 0.035 } },
      { kind: 'line', from: padA, to: padB, width: 0.05 },
      { kind: 'line', from: lerpV(padA, padB, 0.5), to: { x: lerpV(padA, padB, 0.5).x, y: FLOOR } },
    ],
  };
}

// ── Arms ──────────────────────────────────────────────────────────────────

export function curl(o: { implement: Implement | 'cable' | 'band'; incline?: boolean; concentration?: boolean }): Demo {
  if (o.incline) {
    const hip: Vec = { x: 0, y: 0 };
    const torso = -38;
    return {
      view: 'side',
      floor: 0.3,
      pose: (s) => ({ torso, head: -20, leg: { thigh: 98, shin: 182, foot: 90 }, arm: { upper: 186, fore: lerp(186, 40, s) }, anchor: 'hip', at: hip }),
      props: [
        { kind: 'bench', points: [along({ x: -0.05, y: 0.06 }, torso, 0.5), { x: -0.05, y: 0.06 }, { x: 0.2, y: 0.06 }], legs: true },
        { kind: 'dumbbell', at: 'wrist' },
      ],
    };
  }
  if (o.concentration) {
    const hip: Vec = { x: 0, y: 0 };
    return {
      view: 'side',
      floor: 0.3,
      pose: (s) => ({ torso: 38, head: 50, leg: { thigh: 95, shin: 185, foot: 90 }, arm: { upper: 172, fore: lerp(176, 20, s) }, anchor: 'hip', at: hip }),
      props: [{ kind: 'box', x: -0.2, y: 0.06, w: 0.3, h: 0.27 }, { kind: 'dumbbell', at: 'wrist' }],
    };
  }
  const props: Prop[] =
    o.implement === 'cable'
      ? [{ kind: 'cable', from: { x: 0.45, y: -0.02 }, at: 'wrist' }]
      : o.implement === 'band'
        ? [{ kind: 'band', from: { x: 0.02, y: 0.02 }, at: 'wrist' }]
        : handProp(o.implement);
  return {
    view: 'side',
    pose: (s) => standing({ arm: { upper: 182, fore: lerp(178, 28, s) } }),
    props,
  };
}

export function overheadExtension(): Demo {
  return {
    view: 'side',
    pose: (s) => standing({ arm: { upper: 2, fore: lerp(2, 205, s) } }),
    props: [{ kind: 'dumbbell', at: 'wrist', upright: true }],
  };
}

export function skullCrusher(): Demo {
  const p = lyingPress({ implement: 'ezbar' });
  return {
    ...p,
    pose: (s) => ({ ...p.pose(0), arm: { upper: 352, fore: lerp(354, 262, s) } }),
  };
}

export function pushdown(o: { band?: boolean }): Demo {
  return {
    view: 'side',
    pose: (s) => standing({ torso: 8, head: 4, arm: { upper: 178, fore: lerp(62, 178, s) } }),
    props: o.band ? [{ kind: 'band', from: { x: 0.28, y: -1.12 }, at: 'wrist' }] : [{ kind: 'cable', from: { x: 0.28, y: -1.12 }, at: 'wrist' }],
  };
}

export function kickback(): Demo {
  const torso = 72;
  return {
    view: 'side',
    pose: (s) =>
      standing({
        torso,
        head: 50,
        leg: { thigh: 160, shin: 192, foot: 90 },
        arm: { upper: torso + 180, fore: lerp(180, torso + 180, s) },
      }),
    props: [{ kind: 'dumbbell', at: 'wrist' }],
  };
}

// ── Core ──────────────────────────────────────────────────────────────────

export function plank(): Demo {
  const toe: Vec = { x: 0, y: 0 };
  const body = 78; // direction toe → shoulder
  const p: DemoPose = {
    torso: body,
    head: body,
    leg: { thigh: body + 180, shin: body + 180, foot: body + 100 },
    arm: { upper: 180, fore: 90 },
    anchor: 'toe',
    at: toe,
  };
  return { view: 'side', pose: () => p };
}

/** Front view, propped on the left forearm, head to the right. */
export function sidePlank(): Demo {
  const body = 72;
  return {
    view: 'front',
    pose: () => ({
      torso: body,
      head: body,
      leg: { thigh: body + 180, shin: body + 180, foot: 0 },
      arm: { upper: body + 175, fore: body + 175 },
      arm2: { upper: 180, fore: 90 },
      anchor: 'ankle',
      at: O,
    }),
  };
}

export function hollowHold(): Demo {
  const hip: Vec = { x: 0, y: FLOOR - 0.06 };
  const p: DemoPose = {
    torso: 292,
    head: 300,
    leg: { thigh: 72, shin: 74, foot: 0 },
    arm: { upper: 280, fore: 280 },
    anchor: 'hip',
    at: hip,
  };
  return { view: 'side', floor: FLOOR, pose: () => p };
}

export function deadBug(): Demo {
  const hip: Vec = { x: 0, y: FLOOR - 0.06 };
  return {
    view: 'side',
    floor: FLOOR,
    pose: (s) => ({
      torso: 270,
      head: 270,
      leg: { thigh: lerp(0, 82, s), shin: lerp(90, 84, s), foot: lerp(0, -6, s) },
      leg2: { thigh: 0, shin: 90, foot: 0 },
      arm: { upper: lerp(0, -60, s), fore: lerp(0, -65, s) },
      arm2: { upper: 0, fore: 0 },
      anchor: 'hip',
      at: hip,
    }),
  };
}

export function crunch(): Demo {
  const hip: Vec = { x: 0, y: FLOOR - 0.06 };
  const ankle: Vec = { x: 0.36, y: FLOOR - L.ankleHeight };
  return {
    view: 'side',
    floor: FLOOR,
    pose: (s) => {
      const torso = lerp(270, 302, s);
      return { torso, head: torso + 8 * s, leg: legTo(hip, ankle, UP), arm: { upper: torso + 150, fore: torso + 40 }, anchor: 'hip', at: hip };
    },
  };
}

export function hangingRaise(o: { straight?: boolean }): Demo {
  const bar: Vec = { x: 0, y: 0 };
  return {
    view: 'side',
    floor: null,
    pose: (s) => ({
      torso: -6 + 6 * s,
      leg: o.straight ? { thigh: lerp(180, 90, s), shin: lerp(180, 92, s), foot: lerp(150, 0, s) } : { thigh: lerp(180, 95, s), shin: lerp(180, 182, s), foot: lerp(150, 120, s) },
      arm: { upper: 0, fore: 0 },
      anchor: 'wrist',
      at: bar,
    }),
    props: [{ kind: 'bar', at: { x: 0, y: -0.012 } }],
  };
}

export function cableCrunch(): Demo {
  const knee: Vec = { x: 0, y: FLOOR - 0.05 };
  return {
    view: 'side',
    floor: FLOOR,
    pose: (s) => {
      const torso = lerp(18, 78, s);
      return {
        torso,
        head: torso + 10,
        leg: { thigh: lerp(175, 165, s), shin: 270, foot: 180 },
        arm: { upper: torso + 150, fore: torso + 330 },
        anchor: 'knee',
        at: knee,
      };
    },
    props: [{ kind: 'cable', from: { x: 0.2, y: -1.15 }, at: 'wrist' }],
  };
}

export { dir };
