// Data the analysis engine works on. Pose sequences are numbers only (never
// images), so they can be kept, exported as test fixtures (Phase 4) and stored
// on the device without breaking the privacy rules.

/** One MediaPipe landmark: normalized x, y (0..1 of the image), z, visibility. */
export type RawLandmark = [x: number, y: number, z: number, visibility: number];

export interface PoseFrame {
  /** Milliseconds since the start of the sequence. */
  t: number;
  /** The 33 BlazePose landmarks, or null when no person was detected. */
  lm: RawLandmark[] | null;
}

export interface PoseSequence {
  version: 1;
  /** Image size in pixels; landmarks are scaled by these to get true angles. */
  width: number;
  height: number;
  source: 'camera' | 'file' | 'synthetic';
  frames: PoseFrame[];
}

export type CheckStatus = 'pass' | 'fail' | 'unknown';

export interface CheckResult {
  checkId: string;
  label: string;
  status: CheckStatus;
  /** Measured value in the check's unit (degrees, seconds, torso fractions). */
  value?: number;
  /** Human-readable measurement, e.g. "Hip 6% of torso below knee". */
  measured?: string;
  /** Human-readable target, e.g. "at or below knee". */
  target: string;
  /** Fault id when status is 'fail'. */
  fault?: string;
  /** Why the check couldn't be judged. */
  reason?: string;
  /** Note when the threshold was adjusted for the user's proportions. */
  adjustment?: string;
}

export interface RepResult {
  index: number;
  startFrame: number;
  /** Turnaround of the rep (bottom of a squat, top of a pull-up). */
  turnFrame: number;
  endFrame: number;
  topFrame: number;
  bottomFrame: number;
  durationSec: number;
  checks: CheckResult[];
}

export interface HoldResult {
  startFrame: number;
  endFrame: number;
  durationSec: number;
  checks: CheckResult[];
}

export interface AnalysisResult {
  exerciseId: string;
  kind: 'reps' | 'hold';
  /** Body side used for side-view exercises. */
  side: 'left' | 'right' | 'both';
  reps: RepResult[];
  hold?: HoldResult;
  /** Problems with the recording as a whole, e.g. "No person detected". */
  warnings: string[];
  /** Median torso length in pixels, the scale for distance checks. */
  torsoPx: number;
}

/** Segment lengths as multiples of torso length (shoulder to hip). */
export interface BodyProportions {
  thigh?: number;
  shin?: number;
  upperArm?: number;
  forearm?: number;
  measuredAt: string;
}

/** User-tuned threshold values: exerciseId -> checkId -> field -> value. */
export type ThresholdOverrides = Record<string, Record<string, Record<string, number>>>;
