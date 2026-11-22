// Which muscles each exercise works, what each one does, and where in the rep
// the load is hardest: the data behind the demo's muscle colours.
//
// Every entry uses exactly the exercise's primary and secondary groups from
// ./exercises.ts (primary = main movers); tests/engagement-data.test.ts
// enforces that. Model and field meanings: ../demo/engagement.ts.
import { defaultEngagement, type Engagement } from '../demo/engagement';
import type { Exercise } from './types';

export const ENGAGEMENT: Record<string, Engagement> = {};

/** The researched entry for an exercise, or one derived from its muscle lists. */
export function engagementFor(exercise: Pick<Exercise, 'id' | 'primary' | 'secondary' | 'tracking'>): Engagement {
  return ENGAGEMENT[exercise.id] ?? defaultEngagement(exercise);
}
