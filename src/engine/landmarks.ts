// Mapping from config joint names to BlazePose landmark indices, plus helpers
// that read points in pixel space (so angles aren't distorted by the frame's
// aspect ratio).
import type { CameraView, Joint } from '../data/types';
import type { PoseFrame, PoseSequence } from './types';

export type Side = 'left' | 'right';

const INDEX: Record<Joint, { left: number; right: number }> = {
  nose: { left: 0, right: 0 },
  ear: { left: 7, right: 8 },
  shoulder: { left: 11, right: 12 },
  elbow: { left: 13, right: 14 },
  wrist: { left: 15, right: 16 },
  hip: { left: 23, right: 24 },
  knee: { left: 25, right: 26 },
  ankle: { left: 27, right: 28 },
  heel: { left: 29, right: 30 },
  toe: { left: 31, right: 32 },
};

export const landmarkIndex = (joint: Joint, side: Side) => INDEX[joint][side];

/** Minimum visibility for a landmark to be used at all (e.g. rep tracking). */
export const MIN_VISIBILITY = 0.5;
/** Minimum visibility for a landmark to be used to judge a check. */
export const JUDGE_VISIBILITY = 0.6;

export interface Point {
  x: number;
  y: number;
  /** Visibility 0..1. */
  v: number;
}

export interface Reader {
  width: number;
  height: number;
  view: CameraView;
  side: Side;
}

function raw(frame: PoseFrame, i: number, r: Reader): Point | null {
  const lm = frame.lm?.[i];
  if (!lm) return null;
  return { x: lm[0] * r.width, y: lm[1] * r.height, v: lm[3] };
}

/** A joint on one specific side. */
export function sidedPoint(frame: PoseFrame, joint: Joint, side: Side, r: Reader): Point | null {
  return raw(frame, landmarkIndex(joint, side), r);
}

/**
 * A joint as the config means it: the near side for side views, the midpoint
 * of both sides for front views. Visibility is the weaker of the two.
 */
export function point(frame: PoseFrame, joint: Joint, r: Reader): Point | null {
  if (r.view === 'side' || joint === 'nose') return sidedPoint(frame, joint, r.side, r);
  const a = sidedPoint(frame, joint, 'left', r);
  const b = sidedPoint(frame, joint, 'right', r);
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) };
}

/** Midpoint of left and right, used for torso length and orientation. */
export function midpoint(frame: PoseFrame, joint: Joint, r: Pick<Reader, 'width' | 'height'>): Point | null {
  const reader = { ...r, view: 'side' as const, side: 'left' as const };
  const a = sidedPoint(frame, joint, 'left', reader);
  const b = sidedPoint(frame, joint, 'right', reader);
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) };
}

/**
 * The side facing the camera: the one whose joints MediaPipe sees more
 * confidently across the sequence.
 */
export function nearSide(seq: PoseSequence, joints: Joint[]): Side {
  let left = 0;
  let right = 0;
  for (const f of seq.frames) {
    if (!f.lm) continue;
    for (const j of joints) {
      if (j === 'nose') continue;
      left += f.lm[INDEX[j].left]?.[3] ?? 0;
      right += f.lm[INDEX[j].right]?.[3] ?? 0;
    }
  }
  return right > left ? 'right' : 'left';
}
