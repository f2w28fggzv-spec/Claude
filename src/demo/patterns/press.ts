// Movement patterns: bench and floor presses, push-ups, dips, flys, skull crushers. Conventions and helpers: ./shared.ts.
import { L, along, armTo, legTo, lerp, lerpV, type DemoPose, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { FLOOR, LEG_LEN, ARM_LEN, UP, DOWN, BACK, handProp, type Implement } from './shared';

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
export function pushUp(o: { variant: 'standard' | 'incline' | 'knee' | 'diamond' }): Demo {
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

export function skullCrusher(): Demo {
  const p = lyingPress({ implement: 'ezbar' });
  return {
    ...p,
    pose: (s) => ({ ...p.pose(0), arm: { upper: 352, fore: lerp(354, 262, s) } }),
  };
}
