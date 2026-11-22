// Movement patterns: curls and triceps isolation. Conventions and helpers: ./shared.ts.
import { along, lerp, type Vec } from '../figure';
import type { Demo, Prop } from '../types';
import { standing, handProp, type Implement } from './shared';

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
