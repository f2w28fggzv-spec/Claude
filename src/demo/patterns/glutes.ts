// Movement patterns: bridges and hip thrusts, hip abduction, calf raises. Conventions and helpers: ./shared.ts.
import { L, add, along, armTo, legTo, lerp, type DemoPose, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { FLOOR, HANG, UP, BACK, handProp, type Implement } from './shared';

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
