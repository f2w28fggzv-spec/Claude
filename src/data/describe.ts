// Human-readable text for config values.
import type { Check, Exercise, Placement } from './types';
import { EQUIPMENT_LABELS, MUSCLE_LABELS } from './types';

const HEIGHT: Record<Placement['phoneHeight'], string> = {
  floor: 'on the floor',
  knee: 'at about knee height',
  hip: 'at about hip height',
  chest: 'at about chest height',
};

export function placementLines(p: Placement): string[] {
  return [
    p.view === 'side' ? 'Film from the side (side-on to the camera)' : 'Film from the front (facing the camera)',
    `Phone ${HEIGHT[p.phoneHeight]}, held upright and level`,
    `About ${p.distanceM[0]}–${p.distanceM[1]} m away`,
    `${p.orientation === 'portrait' ? 'Portrait (upright)' : 'Landscape (sideways)'} orientation, 1x lens`,
    ...(p.notes ? [p.notes] : []),
  ];
}

export const musclesText = (e: Exercise) => e.primary.map((g) => MUSCLE_LABELS[g]).join(', ');
export const secondaryText = (e: Exercise) => e.secondary.map((g) => MUSCLE_LABELS[g]).join(', ');
export const equipmentText = (e: Exercise) => e.equipment.map((q) => EQUIPMENT_LABELS[q]).join(' + ');

const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
const range = (min?: number, max?: number, unit = '°') =>
  min !== undefined && max !== undefined ? `${min}–${max}${unit}` : max !== undefined ? `at most ${max}${unit}` : `at least ${min}${unit}`;

/** Plain-language target for a check, for the "How we judge it" list. */
export function describeTarget(c: Check): string {
  switch (c.type) {
    case 'jointAngle':
      return `${c.angle.vertex[0].toUpperCase()}${c.angle.vertex.slice(1)} angle ${range(c.min, c.max)} at the ${c.at}`;
    case 'rangeOfMotion':
      return `At least ${c.minDeg}° of ${c.angle.vertex} movement per rep`;
    case 'relativeHeight': {
      const rel = c.relation === 'atOrBelow' ? 'below' : 'above';
      if (c.margin === 0) return `${c.point[0].toUpperCase()}${c.point.slice(1)} level with or ${rel} the ${c.reference}`;
      return c.margin > 0
        ? `${c.point[0].toUpperCase()}${c.point.slice(1)} at least ${pct(c.margin)} of torso length ${rel} the ${c.reference}`
        : `${c.point[0].toUpperCase()}${c.point.slice(1)} no more than ${pct(c.margin)} of torso length short of the ${c.reference}`;
    }
    case 'torsoAngle':
      return `Torso ${range(c.minDeg, c.maxDeg)} from vertical at the ${c.at}${c.personalize ? ', adjusted for your proportions' : ''}`;
    case 'path':
      return `Moves at most ${pct(c.maxDrift)} of torso length sideways`;
    case 'symmetry':
      return `Left and right within ${c.maxDiffDeg}°`;
    case 'tempo':
      return `${c.phase === 'eccentric' ? 'Lowering' : 'Lifting'} takes ${range(c.minSec, c.maxSec, ' s')}`;
    case 'lockout':
      return `Straightens to at least ${c.minDeg}° at the ${c.at}`;
    case 'holdAlignment':
      return `${c.min}–${c.max}° for most of the hold`;
  }
}
