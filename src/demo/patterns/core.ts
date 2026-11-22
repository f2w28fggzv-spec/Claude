// Movement patterns: planks, holds, crunches and hanging raises. Conventions and helpers: ./shared.ts.
import { L, legTo, lerp, type DemoPose, type Vec } from '../figure';
import type { Demo } from '../types';
import { O, FLOOR, UP } from './shared';

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
