// One frame of an exercise demo as SVG markup: floor, equipment and the
// figure, layered by depth. Pure strings (no DOM), so the app can paint a
// frame with one innerHTML and the sheet tool can render demos in Node.
import { BODY, drawBody, type BodyFigure, type ResolvedPose } from './body';
import { engageColour, type Levels } from './engagement';
import { drawEquipment, propExtent } from './equipment';
import { L, solve, type DemoPose, type Vec } from './figure';
import type { Demo } from './types';

/** Floor y when an ankle stands at y = 0 (same as FLOOR in ./patterns). */
const STANDING_FLOOR = L.ankleHeight;

export interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const floorOf = (demo: Demo): number | null => (demo.floor === undefined ? STANDING_FLOOR : demo.floor);

export function resolvePose(pose: DemoPose): ResolvedPose {
  return {
    torso: pose.torso,
    bend: pose.bend ?? 0,
    head: pose.head ?? pose.torso + (pose.bend ?? 0),
    torsoScale: pose.torsoScale ?? 1,
    leg: pose.leg,
    arm: resolveArm(pose.arm),
    leg2: pose.leg2 ?? pose.leg,
    arm2: resolveArm(pose.arm2 ?? pose.arm),
  };
}

const resolveArm = (a: DemoPose['arm']): ResolvedPose['arm'] => ({ scale: 1, hand: a.fore, flat: false, ...a, foreScale: a.foreScale ?? a.scale ?? 1 });

/** The solved skeleton with its pose angles at movement progress s. */
export function figureAt(demo: Demo, s: number): BodyFigure {
  const pose = demo.pose(s);
  return { ...solve(demo.view, pose), pose: resolvePose(pose) };
}

/** The box that holds the whole movement, so the picture doesn't jump. */
export function demoBounds(demo: Demo): FrameBox {
  const pts: Vec[] = [];
  // Skin sits this far outside the joints at most; the head a little more.
  const skin = Math.max(BODY.glute, BODY.torsoBack, BODY.torsoFront, BODY.thighFront) + 0.012;
  const head = BODY.head + 0.03;
  for (let k = 0; k <= 8; k++) {
    const f = figureAt(demo, k / 8);
    for (const side of [f.a, f.b]) for (const p of Object.values(side) as Vec[]) pts.push({ x: p.x - skin, y: p.y - skin }, { x: p.x + skin, y: p.y + skin });
    pts.push({ x: f.head.x - head, y: f.head.y - head }, { x: f.head.x + head, y: f.head.y + head });
    for (const p of demo.props ?? []) pts.push(...propExtent(p, f));
  }
  const floor = floorOf(demo);
  if (floor !== null) pts.push({ x: pts[0].x, y: floor + 0.012 });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = 0.025;
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

export const viewBoxOf = (b: FrameBox) => `${b.x.toFixed(4)} ${b.y.toFixed(4)} ${b.w.toFixed(4)} ${b.h.toFixed(4)}`;

/**
 * SVG content for one frame (no <svg> wrapper).
 * @param id unique per drawn figure on the page (prefix for any <defs> ids)
 */
export function frameMarkup(demo: Demo, s: number, levels: Levels, box: FrameBox, id = 'demo'): string {
  const fig = figureAt(demo, s);
  const floor = floorOf(demo);
  const eq = drawEquipment(demo.props ?? [], fig, floor);
  const body = drawBody(fig, { level: levels, heat: engageColour, id });
  const ground =
    floor === null
      ? ''
      : `<line x1="${box.x.toFixed(4)}" y1="${floor.toFixed(4)}" x2="${(box.x + box.w).toFixed(4)}" y2="${floor.toFixed(4)}" stroke="var(--floor)" stroke-width="0.008" stroke-linecap="round"/>`;
  return ground + eq.back + body.far + eq.behind + body.core + eq.mid + body.near + eq.front;
}
