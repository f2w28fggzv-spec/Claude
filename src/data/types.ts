// Schema for exercise config entries. The Phase 2 analysis engine reads these
// generically, so anything exercise-specific belongs in data, not code.

import type { Demo } from '../demo/types';

export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  core: 'Core',
};

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'kettlebell'
  | 'bodyweight'
  | 'pullupBar'
  | 'bench'
  | 'rack'
  | 'cable'
  | 'machine'
  | 'band'
  | 'dipBars'
  | 'ezBar';

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbells',
  kettlebell: 'Kettlebell',
  bodyweight: 'Bodyweight',
  pullupBar: 'Pull-up bar',
  bench: 'Bench',
  rack: 'Rack',
  cable: 'Cable',
  machine: 'Machine',
  band: 'Band',
  dipBars: 'Dip bars',
  ezBar: 'EZ bar',
};

/**
 * Body points. Unsided names resolve to the side nearest the camera for side
 * views, or to both sides for front views (see Placement.view).
 */
export const JOINTS = [
  'nose',
  'ear',
  'shoulder',
  'elbow',
  'wrist',
  'hip',
  'knee',
  'ankle',
  'heel',
  'toe',
] as const;
export type Joint = (typeof JOINTS)[number];

/** An angle at `vertex` between the segments to `a` and `c`, in degrees. */
export interface JointAngle {
  a: Joint;
  vertex: Joint;
  c: Joint;
}

export type CameraView = 'side' | 'front';

export interface Placement {
  view: CameraView;
  /** Where the phone sits, measured from the floor. */
  phoneHeight: 'floor' | 'knee' | 'hip' | 'chest';
  /** Phone-to-lifter distance range in metres. */
  distanceM: [number, number];
  orientation: 'portrait' | 'landscape';
  /** Extra setup notes shown to the user. */
  notes?: string;
}

/**
 * Which position in a rep a check is evaluated at: where the tracked joint
 * (Exercise.tracking.joint) is highest on screen ('top') or lowest ('bottom').
 * The far position is the turnaround of the rep. The start position is taken
 * at the end of the rep when the first move is down (finishing the squat
 * standing tall), and at the start when the first move is up (the deadlift
 * set-up position).
 */
export type RepPosition = 'top' | 'bottom';

/** Status of a threshold: every value is "unvalidated" until Phase 4 calibration. */
export type ThresholdStatus = 'unvalidated' | 'calibrated';

interface CheckBase {
  id: string;
  label: string;
  /** Fault id reported when this check fails. */
  fault: string;
  status: ThresholdStatus;
  /** Where the threshold comes from (filled in Phase 3). */
  source?: string;
}

/** Joint angle at the top or bottom of each rep must fall within [min, max]. */
export interface JointAngleCheck extends CheckBase {
  type: 'jointAngle';
  angle: JointAngle;
  at: RepPosition;
  min?: number;
  max?: number;
}

/** Difference between the angle at top and bottom must be at least minDeg. */
export interface RangeOfMotionCheck extends CheckBase {
  type: 'rangeOfMotion';
  angle: JointAngle;
  minDeg: number;
}

/**
 * At a rep position, `point` must be at or below (or above) `reference` in
 * screen space. `margin` is a fraction of torso length (shoulder to hip):
 * positive is stricter, negative allows `point` to fall short by that much.
 * Used for squat depth (hip vs knee) and pull-up height (nose vs wrist).
 */
export interface RelativeHeightCheck extends CheckBase {
  type: 'relativeHeight';
  point: Joint;
  reference: Joint;
  relation: 'atOrBelow' | 'atOrAbove';
  at: RepPosition;
  margin: number;
}

/** Torso (hip→shoulder) angle from vertical, in degrees, at a rep position. */
export interface TorsoAngleCheck extends CheckBase {
  type: 'torsoAngle';
  at: RepPosition;
  minDeg?: number;
  maxDeg?: number;
  /** Shift the limits for the user's limb proportions. */
  personalize?: PersonalizationRule;
}

/**
 * Horizontal drift of `point` across a rep, as a fraction of torso length.
 * Wrist path stands in for bar path.
 */
export interface PathCheck extends CheckBase {
  type: 'path';
  point: Joint;
  maxDrift: number;
}

/** Left/right angle difference at a rep position. Front view only. */
export interface SymmetryCheck extends CheckBase {
  type: 'symmetry';
  angle: JointAngle;
  at: RepPosition;
  maxDiffDeg: number;
}

/** Duration of a rep phase in seconds. */
export interface TempoCheck extends CheckBase {
  type: 'tempo';
  phase: 'eccentric' | 'concentric';
  minSec?: number;
  maxSec?: number;
}

/** Joint must reach at least minDeg (near straight) at a rep position. */
export interface LockoutCheck extends CheckBase {
  type: 'lockout';
  angle: JointAngle;
  at: RepPosition;
  minDeg: number;
}

/** For holds: an angle that must stay within [min, max] throughout. */
export interface HoldAlignmentCheck extends CheckBase {
  type: 'holdAlignment';
  angle: JointAngle;
  min: number;
  max: number;
}

export type Check =
  | JointAngleCheck
  | RangeOfMotionCheck
  | RelativeHeightCheck
  | TorsoAngleCheck
  | PathCheck
  | SymmetryCheck
  | TempoCheck
  | LockoutCheck
  | HoldAlignmentCheck;

export type CheckType = Check['type'];

/** Check types that need both sides of the body visible (front view). */
export const FRONT_ONLY_CHECKS: readonly CheckType[] = ['symmetry'];

export interface Fault {
  id: string;
  label: string;
  cue: string;
  /** Exercise id from the library. */
  corrective: string;
}

/**
 * How reps are segmented: the tracked joint's vertical movement on screen.
 * Exercises whose main movement is horizontal are not in the library yet.
 */
export type RepTracking =
  | {
      kind: 'reps';
      joint: Joint;
      /** Which way the tracked joint moves first from the start position. */
      firstMove: 'down' | 'up';
      /**
       * Whether that first movement is the lowering (eccentric) or lifting
       * (concentric) phase. Squat: eccentric. Lat pulldown: concentric.
       */
      firstPhase: 'eccentric' | 'concentric';
      /**
       * Smallest movement of the tracked joint that counts as a rep, as a
       * fraction of torso length. Default DEFAULT_MIN_AMPLITUDE.
       */
      minAmplitude?: number;
    }
  | { kind: 'hold' };

export const DEFAULT_MIN_AMPLITUDE = 0.15;

/**
 * Named, biomechanically motivated threshold adjustments based on the user's
 * measured limb proportions (see src/engine/personalize.ts).
 */
export type PersonalizationRule = 'squatTorsoLean';

/**
 * 'full': all check types the camera view supports.
 * 'basic': placement, rep counting and range of motion only.
 */
export type AnalysisLevel = 'full' | 'basic';

export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type Level = (typeof LEVELS)[number];

/** A check type allowed on 'basic' exercises. */
export const BASIC_CHECKS: readonly CheckType[] = ['rangeOfMotion', 'holdAlignment'];

export interface Exercise {
  id: string;
  name: string;
  primary: MuscleGroup[];
  secondary: MuscleGroup[];
  /** All equipment needed; the exercise is available only if every item is. */
  equipment: Equipment[];
  /** Multi-joint lifts go first in a session and get compound prescriptions. */
  role: 'compound' | 'isolation';
  unilateral?: boolean;
  /** Lowest experience level the program builder will assign this to. */
  minLevel: Level;
  /** Highest level it is assigned to (for regressions like knee push-ups). */
  maxLevel?: Level;
  placement: Placement;
  requiredLandmarks: Joint[];
  tracking: RepTracking;
  checks: Check[];
  faults: Fault[];
  analysis: AnalysisLevel;
  /** Short description of the movement. */
  summary: string;
  /** Animated how-to, drawn from the same camera angle as `placement`. */
  demo: Demo;
}
