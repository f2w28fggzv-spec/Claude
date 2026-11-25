// One frame of the landing page's hero, drawn with the app's own demo
// renderer and engagement model (src/demo), exactly as the app's exercise
// page draws it. Shared by the page's script (src/landing/hero.ts) and the
// build (src/landing/prerender.ts), so the frame written into the page is the
// one the animation starts from and nothing jumps when the script takes over.
import type { BodyKind } from '../demo/body';
import { engageColour, levelsAt, momentAt, type Levels, type Moment } from '../demo/engagement';
import { frameMarkup } from '../demo/render';
import type { Demo } from '../demo/types';
import type { HeroLift } from './types';

/** Prefix for the frame's <defs> ids (one figure on the page at a time). */
export const HERO_ID = 'hero';

export interface HeroState {
  moment: Moment;
  levels: Levels;
}

export interface HeroFrame extends HeroState {
  /** SVG content (no <svg> wrapper). */
  markup: string;
}

/** Where the rep is `t` seconds into the lift's animation, and how hard each muscle works then. */
export function heroState(lift: HeroLift, t: number): HeroState {
  const moment = momentAt(lift, lift.tl, t);
  return { moment, levels: levelsAt(lift.spec, moment, t) };
}

/** The figure for a state, drawn by the app's renderer. */
export const heroMarkup = (lift: HeroLift, demo: Demo, state: HeroState, body: BodyKind) =>
  frameMarkup(demo, state.moment.s, state.levels, lift.box, { id: HERO_ID, back: state.moment.phase === 'back', body });

/** The frame at `t` seconds into the lift's animation. */
export function heroFrame(lift: HeroLift, demo: Demo, t: number, body: BodyKind): HeroFrame {
  const state = heroState(lift, t);
  return { ...state, markup: heroMarkup(lift, demo, state, body) };
}

/** The figure's description for screen readers: as written into the page ('static'), and as the script keeps it. */
export const stageLabel = (lift: HeroLift, how: 'static' | 'live' | 'still') =>
  `${lift.name}: ${how === 'live' ? 'animated how-to demo' : how === 'still' ? 'how-to demo, the start and the turnaround' : 'how-to demo'}, ${lift.view}. Muscles working: ${lift.words}.`;

/** A legend bar's fill: its width (0..1 of the track) and colour on the heat ramp, as SVG attribute values. */
export function barFill(level: number): { width: string; fill: string } {
  return { width: Math.min(1, Math.max(0, level)).toFixed(3), fill: engageColour(level) };
}
