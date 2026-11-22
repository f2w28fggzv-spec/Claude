// Movement patterns: squats, lunges and leg machines. Conventions and helpers: ./shared.ts.
import { L, add, along, legTo, lerp, lerpV, type Arm, type DemoPose, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { O, FLOOR, LEG_LEN, HANG, FWD, chainUp, standing, between, handProp, type Implement } from './shared';

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
