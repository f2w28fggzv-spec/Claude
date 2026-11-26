// Human-readable text for config values.
import type { Check, Exercise, Placement, RelativeHeightCheck } from './types';
import { EQUIPMENT_LABELS, MUSCLE_LABELS } from './types';
import { TEMPO_MEASURED_SHARE } from './sources';

const HEIGHT: Record<Placement['phoneHeight'], string> = {
  floor: 'on the floor',
  knee: 'at about knee height',
  hip: 'at about hip height',
  chest: 'at about chest height',
  head: 'at about head height',
};

export function placementLines(p: Placement): string[] {
  return [
    p.view === 'side' ? 'Film from the side (side-on to the camera)' : 'Film from the front (facing the camera)',
    `Phone ${HEIGHT[p.phoneHeight]}, ${p.tiltDown ? 'tilted down toward you' : 'held upright and level'}`,
    `About ${p.distanceM[0]}–${p.distanceM[1]} m away`,
    `${p.orientation === 'portrait' ? 'Portrait (upright)' : 'Landscape (sideways)'} orientation, 1x lens`,
    ...(p.notes ? [p.notes] : []),
  ];
}

export const musclesText = (e: Exercise) => e.primary.map((g) => MUSCLE_LABELS[g]).join(', ');
export const secondaryText = (e: Exercise) => e.secondary.map((g) => MUSCLE_LABELS[g]).join(', ');
export const equipmentText = (e: Exercise) => e.equipment.map((q) => EQUIPMENT_LABELS[q]).join(' + ');

const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
const secs = (v: number) => `${Math.round(v * 10) / 10} s`;
const range = (min?: number, max?: number, unit = '°') =>
  min !== undefined && max !== undefined ? `${min}–${max}${unit}` : max !== undefined ? `at most ${max}${unit}` : `at least ${min}${unit}`;

/** Plain-language target for a check, for the "How we judge it" list. */
export function describeTarget(c: Check): string {
  switch (c.type) {
    case 'jointAngle': {
      // The shoulder–hip–ankle angle reads the body's line (180° = straight), not how far the hip bends.
      const { a, vertex, c: end } = c.angle;
      if (a === 'shoulder' && vertex === 'hip' && end === 'ankle' && c.min !== undefined && c.max === undefined) {
        return `Shoulder, hip and ankle in a straight line (within ${180 - c.min}°) at the ${c.at}`;
      }
      return `${vertex[0].toUpperCase()}${vertex.slice(1)} angle ${range(c.min, c.max)} at the ${c.at}`;
    }
    case 'rangeOfMotion':
      return `At least ${c.minDeg}° of ${c.angle.vertex} movement per rep`;
    case 'relativeHeight': {
      const rel = c.relation === 'atOrBelow' ? 'below' : 'above';
      const short = c.relation === 'atOrBelow' ? 'above' : 'below';
      if (c.margin === 0) return `${c.point[0].toUpperCase()}${c.point.slice(1)} level with or ${rel} the ${c.reference}`;
      return c.margin > 0
        ? `${c.point[0].toUpperCase()}${c.point.slice(1)} at least ${pct(c.margin)} of torso length ${rel} the ${c.reference}`
        : `${c.point[0].toUpperCase()}${c.point.slice(1)} at most ${pct(c.margin)} of torso length ${short} the ${c.reference}`;
    }
    case 'torsoAngle':
      return `Torso ${range(c.minDeg, c.maxDeg)} from vertical at the ${c.at}${c.personalize ? ', adjusted for your proportions' : ''}`;
    case 'path':
      return `Moves at most ${pct(c.maxDrift)} of torso length sideways`;
    case 'symmetry':
      return `Left and right within ${c.maxDiffDeg}°`;
    case 'tempo': {
      // The engine doesn't time a movement's slow start and finish (TEMPO_MEASURED_SHARE): say what a minimum asks in all.
      const inAll = c.minSec !== undefined ? `, not counting its slow start and finish (about ${secs(c.minSec / TEMPO_MEASURED_SHARE)} in all)` : '';
      return `${c.phase === 'eccentric' ? 'Lowering' : 'Lifting'} takes ${range(c.minSec, c.maxSec, ' s')}${inAll}`;
    }
    case 'lockout':
      return `Straightens to at least ${c.minDeg}° at the ${c.at}`;
    case 'holdAlignment':
      return `${c.min}–${c.max}° for most of the hold`;
  }
}

/** How far the "Adjust depth strictness" slider reaches either side of a check's own margin, in torso lengths. */
export const MARGIN_SPAN = 0.2;
const hundredths = (v: number) => Math.round(v * 100) / 100;

/**
 * The strictness slider's range for a relative-height check: centred on the
 * check's own default margin (the push-up's −0.1, the reverse lunge's −1.2),
 * and stretched to take in a margin already saved outside it, so the thumb
 * shows the margin in use and a first touch only nudges it.
 */
export function marginRange(c: RelativeHeightCheck, saved?: number): { min: number; max: number; step: number } {
  const min = hundredths(c.margin - MARGIN_SPAN);
  const max = hundredths(c.margin + MARGIN_SPAN);
  const ok = saved !== undefined && Number.isFinite(saved);
  return { min: ok ? Math.min(min, hundredths(saved)) : min, max: ok ? Math.max(max, hundredths(saved)) : max, step: 0.01 };
}

/** What a margin asks of a relative-height check, naming its point and reference ("hip may stay up to 120% of torso above the toe"). */
export function describeMargin(m: number, c: RelativeHeightCheck): string {
  const p = Math.round(Math.abs(m) * 100);
  const toward = c.relation === 'atOrBelow' ? 'below' : 'above';
  const away = c.relation === 'atOrBelow' ? 'above' : 'below';
  if (p === 0) return `${c.point} level with or ${toward} the ${c.reference}`;
  return m > 0 ? `${c.point} at least ${p}% of torso ${toward} the ${c.reference}` : `${c.point} may stay up to ${p}% of torso ${away} the ${c.reference}`;
}
