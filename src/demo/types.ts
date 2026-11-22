import type { DemoPose, Vec } from './figure';

/** Where a moving prop sits on the body. */
export type Attach =
  | 'wrist'
  | 'wrists'
  /** The far hand only (side view), e.g. one dumbbell in the hand opposite the standing leg. */
  | 'wrist2'
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
  /**
   * Seen end-on (palms back or forward); `lengthwise` for a neutral grip at
   * the sides, the handle across the hand with a head at each end; `upright`
   * held on end (goblet), `cupped` with the hands under the top head.
   */
  | { kind: 'dumbbell'; at: Attach; upright?: boolean; cupped?: boolean; lengthwise?: boolean }
  /** Hangs below the fist, or with `swing` flies in line with the arm (kettlebell swing). */
  | { kind: 'kettlebell'; at: Attach; swing?: boolean }
  /** Bench or pad: a thick line through `points`, with legs to the floor. */
  | { kind: 'bench'; points: Vec[]; legs?: boolean }
  | { kind: 'box'; x: number; y: number; w: number; h: number }
  /** A bar seen end-on: pull-up bar, dip bar, low bar. */
  | { kind: 'bar'; at: Vec }
  /** A wall seen edge-on: its face at x, facing right (the slab behind it to the left) unless `facing: 'left'`. */
  | { kind: 'wall'; x: number; top: number; facing?: 'left' | 'right' }
  /** Cable from a pulley at `from`; `rope` draws a rope handle at the hand. */
  | { kind: 'cable'; from: Vec; at: Attach; rope?: boolean }
  | { kind: 'band'; from: Vec; at: Attach }
  /**
   * Machine pad on a joint: a round roller, or with `block` a padded block
   * (`along` the segment by `across` it). `offset` is on screen, or with
   * `frame` in that segment's own frame (x along it from the joint above, y
   * toward its +90° side: the back of a hanging limb, the front of the trunk),
   * so the pad turns with it (leg curl, leg extension, hack squat shoulders).
   */
  | { kind: 'pad'; at: Attach; offset?: Vec; frame?: 'shin' | 'thigh' | 'forearm' | 'trunk'; block?: { along: number; across: number } }
  /** A line that moves with a joint (machine plates, handles); `pad` draws it as a padded surface behind the body. */
  | { kind: 'attached'; at: Attach; from: Vec; to: Vec; width?: number; pad?: boolean }
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
  /**
   * Seconds for each part of the rep instead of the controlled default:
   * pause at the start, move out, pause at the turnaround, move back. For
   * ballistic lifts like the kettlebell swing. Tempo checks still set minimums.
   */
  timing?: { start?: number; out?: number; far?: number; back?: number };
  /**
   * Side view: the hands work between the legs (sumo deadlift, kettlebell
   * swing, cable pull-through, elbows inside the knees in a goblet squat), so
   * the near arm and what it holds pass behind the near leg.
   */
  armBehindLegs?: boolean;
  /**
   * One-sided exercises (one-arm row, single-leg moves, side-lying hip
   * abduction): the side whose arm and leg do the work, `a` = near (side
   * view) or the lifter's right (front view), `b` = the other side. The other
   * side's limb muscles stay near rest; trunk muscles are shared.
   */
  working?: 'a' | 'b';
}
