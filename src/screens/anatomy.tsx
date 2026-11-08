// Anatomical figure (front and back) for the muscle icons and the weekly body
// map. The outlines come from react-native-body-highlighter (MIT; see
// bodyPaths.ts and THIRD_PARTY_NOTICES.md); this file maps its parts to the
// app's muscle groups and renders them.
import type { JSX } from 'preact';
import type { MuscleGroup } from '../data/types';
import { BACK_PATHS, FRONT_PATHS, type BodyPart, type BodySlug } from './bodyPaths';

export type View = 'front' | 'back';

/**
 * Training group of each part: a muscle group, null for muscles that aren't
 * a group of their own here (forearms, shins, adductors, neck), or 'body'
 * for parts that aren't muscles (head, hands, knees, feet).
 */
const GROUP: Record<BodySlug, MuscleGroup | null | 'body'> = {
  chest: 'chest',
  abs: 'core',
  obliques: 'core',
  biceps: 'biceps',
  triceps: 'triceps',
  deltoids: 'shoulders',
  trapezius: 'back',
  'upper-back': 'back',
  'lower-back': 'back',
  quadriceps: 'quads',
  hamstring: 'hamstrings',
  gluteal: 'glutes',
  calves: 'calves',
  adductors: null,
  tibialis: null,
  forearm: null,
  neck: null,
  head: 'body',
  hair: 'body',
  hands: 'body',
  feet: 'body',
  ankles: 'body',
  knees: 'body',
};

const NAMES: Record<BodySlug, string> = {
  chest: 'Chest',
  abs: 'Abs',
  obliques: 'Obliques',
  biceps: 'Biceps',
  triceps: 'Triceps',
  deltoids: 'Shoulders',
  trapezius: 'Trapezius',
  'upper-back': 'Upper back and lats',
  'lower-back': 'Lower back',
  quadriceps: 'Quadriceps',
  hamstring: 'Hamstrings',
  gluteal: 'Glutes',
  calves: 'Calves',
  adductors: 'Adductors',
  tibialis: 'Shins',
  forearm: 'Forearms',
  neck: 'Neck',
  head: 'Head',
  hair: 'Hair',
  hands: 'Hands',
  feet: 'Feet',
  ankles: 'Ankles',
  knees: 'Knees',
};

const PARTS: Record<View, BodyPart[]> = { front: FRONT_PATHS, back: BACK_PATHS };
/** Tight boxes around each figure (the back view is drawn 724 units to the right). */
const BOX: Record<View, [number, number, number, number]> = { front: [45, 88, 640, 1264], back: [765, 88, 640, 1264] };

/** The view that shows a group best. */
export const VIEW_OF: Record<MuscleGroup, View> = {
  chest: 'front',
  shoulders: 'front',
  biceps: 'front',
  core: 'front',
  quads: 'front',
  back: 'back',
  triceps: 'back',
  glutes: 'back',
  hamstrings: 'back',
  calves: 'back',
};

interface FigureProps {
  view: View;
  /** Class for each muscle by its group (null = not a training group). */
  muscleClass?: (group: MuscleGroup | null) => string;
  /** Inline fill for each muscle by its group (for continuous shading). */
  muscleFill?: (group: MuscleGroup | null) => string | undefined;
  /** Called with a muscle's group when it is tapped. */
  onPick?: (group: MuscleGroup) => void;
  class?: string;
  width?: number;
  label?: string;
  children?: JSX.Element | JSX.Element[];
}

/** One view of the figure with every muscle drawn and classed or shaded by its group. */
export function BodyFigure({ view, muscleClass, muscleFill, onPick, class: cls = '', width, label, children }: FigureProps) {
  const [x, y, w, h] = BOX[view];
  return (
    <svg
      class={`anatomy ${cls}`}
      viewBox={`${x} ${y} ${w} ${h}`}
      width={width}
      height={width ? (width * h) / w : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      {PARTS[view].map((part) => {
        const group = GROUP[part.slug];
        if (group === 'body') {
          return (
            <g class={`an-body ${part.slug === 'hair' ? 'an-hair' : ''}`}>
              {part.d.map((d) => (
                <path d={d} />
              ))}
            </g>
          );
        }
        const fill = muscleFill?.(group);
        return (
          <g
            class={`an-muscle ${muscleClass?.(group) ?? ''}`}
            data-group={group ?? undefined}
            style={fill ? { fill } : undefined}
            onClick={group && onPick ? () => onPick(group) : undefined}
          >
            <title>{NAMES[part.slug]}</title>
            {part.d.map((d) => (
              <path d={d} />
            ))}
          </g>
        );
      })}
      {children}
    </svg>
  );
}
