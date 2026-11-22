// How hard each muscle group works at each moment of a demo rep. Pure
// functions: the demo renderer colours the figure with these levels, and the
// tests check the data behind them.
//
// This is an illustration grounded in how the lift loads the body (which
// muscles move the weight, which hold the body steady, and where in the rep
// the load is hardest to hold), not a measurement of anyone's muscles.
import { MUSCLE_GROUPS, type Exercise, type MuscleGroup } from '../data/types';
import type { Timeline } from './timeline';

/**
 * What a muscle group does in an exercise.
 * main: moves the weight (shortens and lengthens under load).
 * assist: helps move it.
 * stabilize: holds a joint or the trunk steady without changing length.
 */
export type MuscleRole = 'main' | 'assist' | 'stabilize';

/**
 * Demand on the moving muscles when holding the load still at movement
 * progress s = 0 (start), 0.5 and 1 (turnaround): 0 = resting, 1 = the
 * hardest position of the range.
 */
export type Profile = readonly [number, number, number];

export interface MuscleUse {
  group: MuscleGroup;
  role: MuscleRole;
  /** Level at the hardest point of the rep (0..1). */
  peak: number;
  /** Own demand curve, when this muscle's timing differs from the exercise's. */
  profile?: Profile;
  /** What it does here, in a few words. */
  note?: string;
}

export interface Engagement {
  profile: Profile;
  /** At s = 0 the load rests on the floor, pins or weight stack: muscles are off until the move begins. */
  restAtStart?: boolean;
  muscles: MuscleUse[];
  /** The mechanics behind the profile (for maintainers; not shown in the app). */
  why?: string;
}

export type Levels = Record<MuscleGroup, number>;

/** Allowed peak range per role, enforced by tests on the data. */
export const PEAK_RANGE: Record<MuscleRole, readonly [number, number]> = {
  main: [0.85, 1],
  assist: [0.45, 0.7],
  stabilize: [0.25, 0.5],
};

/** Lowering the same load takes less muscle activation than lifting it: mid-way through lowering, movers show this share. */
const LOWERING = 0.8;
/** Share of their peak that stabilisers hold whatever the position; the rest follows the demand. */
const STEADY = 0.7;
/** With the load resting at the start: readiness level before it moves, and how much travel it takes to come on fully. */
const READY = 0.1;
const TAKE_UP = 0.1;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (u: number) => {
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
};
const mixN = (a: number, b: number, t: number) => a + (b - a) * t;

/** Demand at progress s: a smooth curve through the three profile points, never overshooting them. */
export function demandAt(profile: Profile, s: number): number {
  const x = clamp01(s);
  return x <= 0.5 ? mixN(profile[0], profile[1], smooth(x * 2)) : mixN(profile[1], profile[2], smooth(x * 2 - 1));
}

export type RepPhase = 'start' | 'out' | 'far' | 'back' | 'hold';

export interface Moment {
  phase: RepPhase;
  /** Movement progress (0 = start position, 1 = turnaround). */
  s: number;
  /** Progress within the current phase (0..1). */
  u: number;
  /** What the muscles are doing: lifting (shortening), lowering (lengthening) or holding still. */
  action: 'lifting' | 'lowering' | 'holding';
}

const ease = (u: number) => (1 - Math.cos(Math.PI * clamp01(u))) / 2;

/** Where in the rep time t (seconds) falls. Matches progressAt in ./timeline. */
export function momentAt(exercise: Exercise, tl: Timeline, t: number): Moment {
  if (exercise.tracking.kind === 'hold') return { phase: 'hold', s: 0, u: 0, action: 'holding' };
  const [p0, out, p1, back] = tl.segments;
  const first = exercise.tracking.firstPhase === 'eccentric' ? 'lowering' : 'lifting';
  const second = first === 'lowering' ? 'lifting' : 'lowering';
  let x = ((t % tl.total) + tl.total) % tl.total;
  if (x < p0) return { phase: 'start', s: 0, u: p0 ? x / p0 : 0, action: 'holding' };
  x -= p0;
  if (x < out) return { phase: 'out', s: ease(x / out), u: x / out, action: first };
  x -= out;
  if (x < p1) return { phase: 'far', s: 1, u: p1 ? x / p1 : 0, action: 'holding' };
  x -= p1;
  return { phase: 'back', s: 1 - ease(x / back), u: x / back, action: second };
}

/** Level of one muscle at a moment of the rep. */
export function levelOf(use: MuscleUse, spec: Engagement, m: Moment, t = 0): number {
  if (m.phase === 'hold') {
    // A hold is steady work; a slow, slight swell keeps the still picture alive.
    return clamp01(use.peak * (0.96 + 0.04 * Math.sin((2 * Math.PI * t) / 3.2)));
  }
  let demand = demandAt(use.profile ?? spec.profile, m.s);
  let on = 1;
  if (spec.restAtStart) {
    // The load sits on the floor or stack at s = 0: muscles come on as it leaves.
    on = smooth(m.s / TAKE_UP);
    demand = mixN(READY, demand, on);
  }
  if (use.role === 'stabilize') return clamp01(use.peak * (STEADY + (1 - STEADY) * demand) * mixN(0.4, 1, on));
  // Movers dip while lowering, smoothly so the colour never jumps at a pause.
  const lowering = m.action === 'lowering' ? 1 - (1 - LOWERING) * Math.sin(Math.PI * clamp01(m.u)) : 1;
  return clamp01(use.peak * demand * lowering);
}

/** Levels of all ten muscle groups at a moment (groups the exercise doesn't use stay 0). */
export function levelsAt(spec: Engagement, m: Moment, t = 0): Levels {
  const out = Object.fromEntries(MUSCLE_GROUPS.map((g) => [g, 0])) as Levels;
  for (const use of spec.muscles) out[use.group] = levelOf(use, spec, m, t);
  return out;
}

/** Each muscle at its own hardest point: for still pictures and the legend's order. */
export function peakLevels(spec: Engagement): Levels {
  const out = Object.fromEntries(MUSCLE_GROUPS.map((g) => [g, 0])) as Levels;
  for (const use of spec.muscles) out[use.group] = use.peak;
  return out;
}

/**
 * A spec from the library's lists alone: primary muscles move the weight,
 * secondary ones assist at about half, and the load is hardest at the
 * turnaround. Used only where no researched entry exists.
 */
export function defaultEngagement(exercise: Pick<Exercise, 'primary' | 'secondary' | 'tracking'>): Engagement {
  const hold = exercise.tracking.kind === 'hold';
  return {
    profile: hold ? [1, 1, 1] : [0.3, 0.7, 1],
    muscles: [
      ...exercise.primary.map((group): MuscleUse => ({ group, role: 'main', peak: 1 })),
      ...exercise.secondary.map((group): MuscleUse => ({ group, role: 'assist', peak: 0.55 })),
    ],
  };
}

/** Plain words for each role, as the legend shows them. */
export const ROLE_LABEL: Record<MuscleRole, string> = { main: 'Main', assist: 'Assists', stabilize: 'Steadies' };

/**
 * Colour for a level on the app's heat ramp: resting muscle grey, then amber,
 * orange, flame and red as the muscle works harder. Theme variables, so it
 * follows light and dark.
 */
const STOPS: readonly (readonly [number, string])[] = [
  [0, 'var(--an-muscle)'],
  [0.14, 'var(--amber)'],
  [0.45, 'var(--orange)'],
  [0.75, 'var(--flame)'],
  [1, 'var(--red)'],
];
export function engageColour(level: number): string {
  const l = clamp01(level);
  if (l <= 0.004) return STOPS[0][1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ca] = STOPS[i];
    const [b, cb] = STOPS[i + 1];
    if (l <= b) {
      // 5% steps: fewer distinct colours to restyle per frame, no visible banding.
      const f = Math.round(((l - a) / (b - a)) * 20) * 5;
      return f <= 0 ? ca : f >= 100 ? cb : `color-mix(in oklab, ${cb} ${f}%, ${ca})`;
    }
  }
  return STOPS[STOPS.length - 1][1];
}
