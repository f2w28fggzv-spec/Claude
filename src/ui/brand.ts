// fitee brand colours. The four plate colours come from the logo (a barbell
// with red, blue, yellow and green plates); Ink is the type colour. The same
// values are CSS variables in style.css (--red, --blue, --yellow, --green, --ink).
import type { MuscleGroup } from '../data/types';

export const PLATE = {
  red: '#D7262B',
  blue: '#1F57C3',
  yellow: '#F7C42B',
  green: '#1E9A55',
} as const;
export const INK = '#17181C';

export type Plate = keyof typeof PLATE;

/**
 * Each muscle group keeps one plate colour everywhere it appears (tiles,
 * chips, icons), grouped the way lifters split training: legs red, pull
 * blue, push yellow, core green.
 */
export const GROUP_PLATE: Record<MuscleGroup, Plate> = {
  quads: 'red',
  hamstrings: 'red',
  glutes: 'red',
  calves: 'red',
  back: 'blue',
  biceps: 'blue',
  chest: 'yellow',
  shoulders: 'yellow',
  triceps: 'yellow',
  core: 'green',
};

/** Text colour that reads on a filled plate (WCAG AA): white on red and blue, ink on yellow and green. */
export const ON_PLATE: Record<Plate, string> = { red: '#FFFFFF', blue: '#FFFFFF', yellow: INK, green: INK };
/** Same for large text (19px+ bold, 3:1): white also works on green. */
export const ON_PLATE_LARGE: Record<Plate, string> = { ...ON_PLATE, green: '#FFFFFF' };

/** Inline CSS variables for an element coloured by a muscle group (`--g` fill, `--g-on` / `--g-on-lg` text on it). */
export const groupStyle = (g: MuscleGroup): Record<string, string> => ({
  '--g': PLATE[GROUP_PLATE[g]],
  '--g-on': ON_PLATE[GROUP_PLATE[g]],
  '--g-on-lg': ON_PLATE_LARGE[GROUP_PLATE[g]],
});
