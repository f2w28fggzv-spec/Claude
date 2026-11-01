// Human-readable text for config values.
import type { Exercise, Placement } from './types';
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
