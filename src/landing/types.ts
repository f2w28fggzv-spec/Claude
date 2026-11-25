// What the build hands the landing page's script about each lift of the hero
// (src/landing/prerender.ts writes it into the page as JSON; src/landing/hero.ts reads it).
import type { Exercise, MuscleGroup } from '../data/types';
import type { BodyKind } from '../demo/body';
import type { Engagement } from '../demo/engagement';
import type { FrameBox } from '../demo/render';
import type { Timeline } from '../demo/timeline';

export interface HeroLift {
  /** The library's exercise id (also in src/landing/lifts.ts). */
  id: string;
  name: string;
  /** "side view", "front view" or "front view from above", as the app says it. */
  view: string;
  /** What momentAt reads: rep or hold, and which half of the rep comes first. */
  tracking: Exercise['tracking'];
  /** The rep's timing, from the library's exercise (timeline in src/demo/timeline.ts). */
  tl: Timeline;
  /** The box that holds the whole movement (demoBounds), the SVG's viewBox. */
  box: FrameBox;
  /** How hard each muscle works through the rep (src/data/engagement.ts), without the maintainers' notes. */
  spec: Engagement;
  /** The legend's rows in order: row i's bar shows this group's level. */
  groups: MuscleGroup[];
  /** "quads and glutes (main), hamstrings (assists), core (steadies)", for the figure's description. */
  words: string;
}

export interface HeroData {
  lifts: HeroLift[];
  /** The figure the page starts with (the prerendered frame is drawn with it). */
  body: BodyKind;
}
