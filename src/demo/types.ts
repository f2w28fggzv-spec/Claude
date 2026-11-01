import type { DemoPose, Vec } from './figure';

/** Where a moving prop sits on the body. */
export type Attach =
  | 'wrist'
  | 'wrists'
  | 'backRack'
  | 'frontRack'
  | 'lap'
  | 'knee'
  | 'ankle'
  | 'ankles'
  | 'shoulder'
  | 'hip';

export type Prop =
  /** Barbell seen end-on (side view): a plate. */
  | { kind: 'barbell'; at: Attach; plate?: number }
  | { kind: 'dumbbell'; at: Attach; upright?: boolean }
  | { kind: 'kettlebell'; at: Attach }
  /** Bench or pad: a thick line through `points`, with legs to the floor. */
  | { kind: 'bench'; points: Vec[]; legs?: boolean }
  | { kind: 'box'; x: number; y: number; w: number; h: number }
  /** A bar seen end-on: pull-up bar, dip bar, low bar. */
  | { kind: 'bar'; at: Vec }
  | { kind: 'wall'; x: number; top: number }
  | { kind: 'cable'; from: Vec; at: Attach }
  | { kind: 'band'; from: Vec; at: Attach }
  /** Machine roller pad on a joint. */
  | { kind: 'pad'; at: Attach; offset?: Vec }
  /** A line that moves with a joint (machine plates, handles). */
  | { kind: 'attached'; at: Attach; from: Vec; to: Vec; width?: number }
  | { kind: 'line'; from: Vec; to: Vec; width?: number };

export interface Demo {
  view: 'side' | 'front';
  /**
   * The pose at movement progress s: 0 = start position, 1 = turnaround
   * (bottom of a squat, top of a pull-up). Holds ignore s.
   */
  pose: (s: number) => DemoPose;
  props?: Prop[];
  /** Floor height (y). Defaults to the standing floor under the ankle (y = 0.035); null hides it. */
  floor?: number | null;
  /** Extra pause at the turnaround in seconds, e.g. a pause squat. */
  pauseFar?: number;
}
