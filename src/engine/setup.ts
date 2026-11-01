// Live setup check before recording, driven by the exercise's placement and
// required landmarks. Works on one frame at a time; SetupStabilizer makes the
// verdict steady.
import type { Exercise, Joint } from '../data/types';
import { dist } from './geometry';
import { JUDGE_VISIBILITY, landmarkIndex, midpoint, sidedPoint, type Reader, type Side } from './landmarks';
import type { PoseFrame } from './types';

export interface SetupItem {
  id: 'visible' | 'view' | 'size' | 'orientation' | 'height';
  label: string;
  ok: boolean;
  /** Recording is only allowed when every blocking item is ok. */
  blocking: boolean;
}

export interface SetupStatus {
  ready: boolean;
  items: SetupItem[];
  /** The single most useful instruction right now. */
  nudge: string | null;
  side: Side;
  torsoPx: number;
}

/** Stricter than the recording check (analyze.ts) so analysis has margin. */
export const SETUP_SIDE_MAX_RATIO = 0.25;
export const SETUP_FRONT_MIN_RATIO = 0.4;
/** Landmarks closer than this to the frame edge count as cut off. */
const EDGE = 0.02;
/** The body should span at least this share of the frame. */
const MIN_SPAN = 0.35;

const JOINT_NAMES: Record<Joint, string> = {
  nose: 'head',
  ear: 'head',
  shoulder: 'shoulders',
  elbow: 'elbows',
  wrist: 'hands',
  hip: 'hips',
  knee: 'knees',
  ankle: 'feet',
  heel: 'feet',
  toe: 'feet',
};
const LOWER: Joint[] = ['knee', 'ankle', 'heel', 'toe'];

export function checkSetup(frame: PoseFrame | null, exercise: Exercise, width: number, height: number): SetupStatus {
  const { placement } = exercise;
  const viewLabel = placement.view === 'side' ? 'Side-on to the camera' : 'Facing the camera';
  const empty = (nudge: string): SetupStatus => ({
    ready: false,
    nudge,
    side: 'left',
    torsoPx: NaN,
    items: [
      { id: 'visible', label: 'Required body parts in view', ok: false, blocking: true },
      { id: 'view', label: viewLabel, ok: false, blocking: true },
    ],
  });
  if (!frame?.lm) return empty('Step into view of the camera.');

  const r0 = { width, height };
  const vis = (j: Joint, s: Side) => frame.lm![landmarkIndex(j, s)]?.[3] ?? 0;
  const side: Side =
    exercise.requiredLandmarks.reduce((acc, j) => acc + vis(j, 'right') - vis(j, 'left'), 0) > 0 ? 'right' : 'left';
  const reader: Reader = { ...r0, view: placement.view, side };
  const sides: Side[] = placement.view === 'side' ? [side] : ['left', 'right'];

  // 1. Every required landmark is confidently detected and inside the frame.
  const missing: Joint[] = [];
  const cutTop: Joint[] = [];
  const cutBottom: Joint[] = [];
  const cutSide: Joint[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const j of exercise.requiredLandmarks) {
    for (const s of j === 'nose' ? (['left'] as Side[]) : sides) {
      const p = sidedPoint(frame, j, s, reader);
      const nx = p ? p.x / width : NaN;
      const ny = p ? p.y / height : NaN;
      if (p && Number.isFinite(nx)) {
        xs.push(nx);
        ys.push(ny);
      }
      if (ny > 1 - EDGE) cutBottom.push(j);
      else if (ny < EDGE) cutTop.push(j);
      else if (nx < EDGE || nx > 1 - EDGE) cutSide.push(j);
      else if (!p || p.v < JUDGE_VISIBILITY) missing.push(j);
    }
  }
  const visibleOk = !missing.length && !cutTop.length && !cutBottom.length && !cutSide.length;

  // 2. Camera angle: shoulders and hips overlap when side-on, spread when facing.
  const sh = midpoint(frame, 'shoulder', r0);
  const hip = midpoint(frame, 'hip', r0);
  const torsoPx = sh && hip ? dist(sh, hip) : NaN;
  const sep = (['shoulder', 'hip'] as const).map((j) => {
    const a = sidedPoint(frame, j, 'left', reader);
    const b = sidedPoint(frame, j, 'right', reader);
    return a && b ? dist(a, b) / torsoPx : NaN;
  });
  const ratio = (sep[0] + sep[1]) / 2;
  const viewOk =
    Number.isFinite(ratio) &&
    (placement.view === 'side' ? ratio < SETUP_SIDE_MAX_RATIO : ratio > SETUP_FRONT_MIN_RATIO);

  // 3. Advisory: big enough in frame, phone orientation, phone height.
  const span = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0;
  const sizeOk = span >= MIN_SPAN;
  const portrait = height >= width;
  const orientationOk = (placement.orientation === 'portrait') === portrait;
  const hipY = hip ? hip.y / height : NaN;
  const heightOk = placement.phoneHeight !== 'hip' || !Number.isFinite(hipY) || (hipY > 0.3 && hipY < 0.75);

  const items: SetupItem[] = [
    { id: 'visible', label: 'Required body parts in view', ok: visibleOk, blocking: true },
    { id: 'view', label: viewLabel, ok: viewOk, blocking: true },
    { id: 'size', label: 'Close enough to the camera', ok: sizeOk, blocking: false },
    {
      id: 'orientation',
      label: placement.orientation === 'portrait' ? 'Phone upright' : 'Phone sideways',
      ok: orientationOk,
      blocking: false,
    },
  ];
  if (placement.phoneHeight === 'hip') items.push({ id: 'height', label: 'Phone at about hip height', ok: heightOk, blocking: false });

  const names = (js: Joint[]) => [...new Set(js.map((j) => JOINT_NAMES[j]))].join(' and ');
  // Every body-part name is plural except "head".
  const verb = (js: Joint[]) => (names(js) === 'head' ? 'is' : 'are');
  let nudge: string | null = null;
  if (cutBottom.length || cutTop.length) {
    nudge = `Step back: your ${names([...cutBottom, ...cutTop])} ${verb([...cutBottom, ...cutTop])} cut off.`;
    if (cutBottom.some((j) => LOWER.includes(j)) && !cutTop.length && !sizeOk) nudge = 'Tilt the phone down slightly so your feet are in view.';
  } else if (cutSide.length) nudge = 'Move toward the middle of the frame.';
  else if (missing.length) nudge = `Make sure your ${names(missing)} ${verb(missing)} clearly visible (good light, nothing in the way).`;
  else if (!viewOk) nudge = placement.view === 'side' ? 'Turn side-on to the camera.' : 'Turn to face the camera.';
  else if (!orientationOk) nudge = placement.orientation === 'portrait' ? 'Turn the phone upright.' : 'Turn the phone sideways.';
  else if (!sizeOk) nudge = 'Move a little closer to the camera.';
  else if (!heightOk) nudge = hipY <= 0.3 ? 'Lower the phone to about hip height.' : 'Raise the phone to about hip height.';

  return { ready: visibleOk && viewOk, items, nudge, side, torsoPx };
}

/**
 * Requires the check to pass for most of the last `windowMs` before
 * reporting ready, so the button doesn't flicker.
 */
export class SetupStabilizer {
  private history: { t: number; ready: boolean }[] = [];
  constructor(private windowMs = 800) {}

  push(t: number, ready: boolean): boolean {
    this.history.push({ t, ready });
    while (this.history.length && this.history[0].t < t - this.windowMs) this.history.shift();
    const span = this.history.length ? t - this.history[0].t : 0;
    const share = this.history.filter((h) => h.ready).length / this.history.length;
    return span >= this.windowMs * 0.75 && share >= 0.85 && ready;
  }

  reset(): void {
    this.history = [];
  }
}
