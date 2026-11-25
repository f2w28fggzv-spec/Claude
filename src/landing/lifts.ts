// The six full-analysis lifts the landing page's hero shows, each with the
// same demo pattern call as its entry in src/data/exercises.ts. The page
// imports only the pattern files, so it doesn't carry the whole exercise
// library; tests/landing.test.ts checks that every frame these draw is
// identical to the library's own demo (both bodies, both ways), so the two
// can't drift apart. The rest of each lift's data (name, timing, muscles)
// comes from the library at build time (src/landing/prerender.ts).
import { deadlift, hinge, lyingPress, overheadPress, row, squat } from '../demo/patterns';
import type { Demo } from '../demo/types';

export interface Lift {
  /** The library's exercise id. */
  id: string;
  /** The chip's label. */
  short: string;
  demo: () => Demo;
}

export const LIFTS: readonly Lift[] = [
  { id: 'back-squat', short: 'Back squat', demo: () => squat({ hold: 'back', thigh: 78, shin: 32 }) },
  { id: 'bench-press', short: 'Bench press', demo: () => lyingPress({ implement: 'barbell' }) },
  { id: 'deadlift', short: 'Deadlift', demo: () => deadlift({ shin: 4, ahead: 0.02, pastKnees: 25 }) },
  { id: 'overhead-press', short: 'Overhead press', demo: () => overheadPress({ implement: 'barbell' }) },
  { id: 'barbell-row', short: 'Barbell row', demo: () => row({ implement: 'barbell', torso: 70 }) },
  { id: 'romanian-deadlift', short: 'Romanian deadlift', demo: () => hinge({ implement: 'barbell', torso: 72, hipsBack: 27, knee: 3 }) },
];
