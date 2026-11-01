// Small builders that keep entries in exercises.ts short. They only produce
// plain config objects; nothing here is exercise-specific logic.
import type {
  Check,
  Exercise,
  Fault,
  Joint,
  JointAngle,
  PersonalizationRule,
  Placement,
  RepPosition,
} from './types';

/** Common joint angles (vertex in the middle). */
export const ANGLES = {
  knee: { a: 'hip', vertex: 'knee', c: 'ankle' },
  hip: { a: 'shoulder', vertex: 'hip', c: 'knee' },
  elbow: { a: 'shoulder', vertex: 'elbow', c: 'wrist' },
  shoulder: { a: 'hip', vertex: 'shoulder', c: 'elbow' },
  ankle: { a: 'knee', vertex: 'ankle', c: 'toe' },
  /** Shoulder–hip–ankle: 180 is a straight body line. */
  body: { a: 'shoulder', vertex: 'hip', c: 'ankle' },
} satisfies Record<string, JointAngle>;
export type AngleName = keyof typeof ANGLES;

/** Camera placements shared by many exercises. */
export const PLACEMENTS = {
  sideStanding: {
    view: 'side',
    phoneHeight: 'hip',
    distanceM: [2.5, 4],
    orientation: 'portrait',
  },
  sideFloor: {
    view: 'side',
    phoneHeight: 'floor',
    distanceM: [2, 3.5],
    orientation: 'landscape',
    notes: 'You will be horizontal, so turn the phone sideways and prop it up on the floor.',
  },
  sideBench: {
    view: 'side',
    phoneHeight: 'knee',
    distanceM: [2, 3.5],
    orientation: 'landscape',
    notes: 'Place the phone at bench height and keep the whole bench in frame.',
  },
  sideSeated: {
    view: 'side',
    phoneHeight: 'knee',
    distanceM: [2, 3.5],
    orientation: 'portrait',
  },
  sideHanging: {
    view: 'side',
    phoneHeight: 'chest',
    distanceM: [2.5, 4],
    orientation: 'portrait',
    notes: 'Keep the bar and your feet in frame.',
  },
  sideMachine: {
    view: 'side',
    phoneHeight: 'hip',
    distanceM: [2, 3.5],
    orientation: 'portrait',
    notes: 'Machines can hide your joints. Film from the side the machine leaves open.',
  },
  sideLow: {
    view: 'side',
    phoneHeight: 'floor',
    distanceM: [1.5, 3],
    orientation: 'portrait',
    notes: 'Phone on the floor so your feet and ankles are clearly visible.',
  },
  frontStanding: {
    view: 'front',
    phoneHeight: 'hip',
    distanceM: [2.5, 4],
    orientation: 'portrait',
  },
  frontFloor: {
    view: 'front',
    phoneHeight: 'floor',
    distanceM: [2, 3.5],
    orientation: 'landscape',
    notes: 'Face the camera side-on to the floor, as if lying across the frame.',
  },
} satisfies Record<string, Placement>;

const U = 'unvalidated' as const;

interface Range {
  min?: number;
  max?: number;
}

/**
 * Check builders. All thresholds start as 'unvalidated' drafts; Phase 3
 * replaces them with sourced values and Phase 4 calibrates them.
 */
export const C = {
  depth: (margin = 0, at: RepPosition = 'bottom'): Check => ({
    id: 'depth',
    type: 'relativeHeight',
    label: 'Depth: hip at or below knee',
    point: 'hip',
    reference: 'knee',
    relation: 'atOrBelow',
    at,
    margin,
    fault: 'shallowDepth',
    status: U,
  }),
  height: (
    id: string,
    label: string,
    point: Joint,
    reference: Joint,
    relation: 'atOrBelow' | 'atOrAbove',
    at: RepPosition,
    margin: number,
    fault: string,
  ): Check => ({ id, type: 'relativeHeight', label, point, reference, relation, at, margin, fault, status: U }),
  rom: (joint: AngleName, minDeg: number, fault = 'partialRange'): Check => ({
    id: `rom-${joint}`,
    type: 'rangeOfMotion',
    label: `Range of motion (${joint})`,
    angle: ANGLES[joint],
    minDeg,
    fault,
    status: U,
  }),
  lockout: (joint: AngleName, minDeg: number, at: RepPosition = 'top', fault = 'noLockout'): Check => ({
    id: `lockout-${joint}`,
    type: 'lockout',
    label: `Lockout (${joint})`,
    angle: ANGLES[joint],
    at,
    minDeg,
    fault,
    status: U,
  }),
  angle: (joint: AngleName, at: RepPosition, range: Range, fault: string, label: string): Check => ({
    id: `angle-${joint}-${at}`,
    type: 'jointAngle',
    label,
    angle: ANGLES[joint],
    at,
    ...range,
    fault,
    status: U,
  }),
  torso: (
    at: RepPosition,
    range: { minDeg?: number; maxDeg?: number; personalize?: PersonalizationRule },
    fault: string,
    label: string,
  ): Check => ({
    id: `torso-${at}`,
    type: 'torsoAngle',
    label,
    at,
    ...range,
    fault,
    status: U,
  }),
  path: (point: Joint, maxDrift: number, fault: string, label: string): Check => ({
    id: `path-${point}`,
    type: 'path',
    label,
    point,
    maxDrift,
    fault,
    status: U,
  }),
  symmetry: (joint: AngleName, at: RepPosition, maxDiffDeg: number, fault = 'uneven'): Check => ({
    id: `symmetry-${joint}`,
    type: 'symmetry',
    label: `Left/right symmetry (${joint})`,
    angle: ANGLES[joint],
    at,
    maxDiffDeg,
    fault,
    status: U,
  }),
  eccentric: (minSec: number, fault = 'rushedLowering'): Check => ({
    id: 'tempo-eccentric',
    type: 'tempo',
    label: 'Controlled lowering',
    phase: 'eccentric',
    minSec,
    fault,
    status: U,
  }),
  hold: (joint: AngleName, min: number, max: number, fault: string, label: string): Check => ({
    id: `hold-${joint}`,
    type: 'holdAlignment',
    label,
    angle: ANGLES[joint],
    min,
    max,
    fault,
    status: U,
  }),
};

/** Fault builders: shared label and cue, exercise-specific corrective. */
export const F = {
  shallowDepth: (corrective: string): Fault => ({
    id: 'shallowDepth',
    label: 'Not reaching depth',
    cue: 'Sit lower until your hip crease is level with or below your knee.',
    corrective,
  }),
  partialRange: (corrective: string, cue = 'Use the full range of motion on every rep.'): Fault => ({
    id: 'partialRange',
    label: 'Partial range of motion',
    cue,
    corrective,
  }),
  noLockout: (corrective: string, cue = 'Finish every rep fully before starting the next.'): Fault => ({
    id: 'noLockout',
    label: 'Not finishing the rep',
    cue,
    corrective,
  }),
  rushedLowering: (corrective: string): Fault => ({
    id: 'rushedLowering',
    label: 'Lowering too fast',
    cue: 'Lower under control, taking about two seconds.',
    corrective,
  }),
  forwardLean: (corrective: string, cue = 'Keep your chest up and brace your midsection.'): Fault => ({
    id: 'forwardLean',
    label: 'Too much forward lean',
    cue,
    corrective,
  }),
  pathDrift: (corrective: string, cue = 'Keep the weight moving in a straight vertical line.'): Fault => ({
    id: 'pathDrift',
    label: 'Weight drifting off line',
    cue,
    corrective,
  }),
  bodyLine: (
    corrective: string,
    cue = 'Keep a straight line from shoulders to ankles: squeeze your glutes and brace.',
  ): Fault => ({
    id: 'bodyLine',
    label: 'Hips sagging or piking',
    cue,
    corrective,
  }),
  swinging: (corrective: string, cue = 'Keep your torso still; do not swing the weight up.'): Fault => ({
    id: 'swinging',
    label: 'Using momentum',
    cue,
    corrective,
  }),
  elbowDrift: (corrective: string, cue = 'Keep your upper arms still and elbows in place.'): Fault => ({
    id: 'elbowDrift',
    label: 'Elbows drifting',
    cue,
    corrective,
  }),
  uneven: (corrective: string, cue = 'Move both sides evenly.'): Fault => ({
    id: 'uneven',
    label: 'Uneven left and right',
    cue,
    corrective,
  }),
  kneesCaving: (corrective: string): Fault => ({
    id: 'kneesCaving',
    label: 'Knees caving in',
    cue: 'Push your knees out in line with your toes.',
    corrective,
  }),
  heelsLifting: (corrective: string): Fault => ({
    id: 'heelsLifting',
    label: 'Heels lifting',
    cue: 'Keep your whole foot planted, weight over mid-foot.',
    corrective,
  }),
  shrugging: (corrective: string): Fault => ({
    id: 'shrugging',
    label: 'Shoulders shrugging',
    cue: 'Keep your shoulders down and away from your ears.',
    corrective,
  }),
  overArching: (corrective: string): Fault => ({
    id: 'overArching',
    label: 'Lower back over-arching',
    cue: 'Brace your midsection and keep your ribs down.',
    corrective,
  }),
};

type Draft = Omit<Exercise, 'requiredLandmarks' | 'secondary' | 'analysis' | 'minLevel' | 'checks'> &
  Partial<Pick<Exercise, 'secondary' | 'analysis' | 'minLevel' | 'checks' | 'requiredLandmarks'>>;

function jointsOf(check: Check): Joint[] {
  switch (check.type) {
    case 'jointAngle':
    case 'rangeOfMotion':
    case 'symmetry':
    case 'lockout':
    case 'holdAlignment':
      return [check.angle.a, check.angle.vertex, check.angle.c];
    case 'relativeHeight':
      return [check.point, check.reference];
    case 'path':
      return [check.point];
    case 'torsoAngle':
    case 'tempo':
      return [];
  }
}

/**
 * Builds an entry with defaults. Required landmarks default to every joint the
 * tracking and checks use, plus shoulder and hip (torso length is the scale
 * reference for distances).
 */
export function ex(d: Draft): Exercise {
  const checks = d.checks ?? [];
  const joints = new Set<Joint>(['shoulder', 'hip']);
  if (d.tracking.kind === 'reps') joints.add(d.tracking.joint);
  for (const c of checks) for (const j of jointsOf(c)) joints.add(j);
  for (const j of d.requiredLandmarks ?? []) joints.add(j);
  return {
    ...d,
    secondary: d.secondary ?? [],
    analysis: d.analysis ?? 'basic',
    minLevel: d.minLevel ?? 'beginner',
    checks,
    requiredLandmarks: [...joints],
  };
}

export { jointsOf };
