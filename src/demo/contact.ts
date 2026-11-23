// Where a demo's body would sink into the floor or into equipment, or where a
// planted foot slides, worked out from the skeleton and the body's thickness
// (BODY). Pure: used by the tests and by `npm run demo:contact`.
//
// The body is approximated by its skin outline: points along each bone,
// offset to the front and back by the thickness there. Side views only (the
// front view's depth isn't drawn).
import { BODY } from './body';
import { add, dir, mul, sub, type Vec } from './figure';
import { figureAt, floorOf } from './render';
import type { Demo, Prop } from './types';

export interface ContactIssue {
  /** Movement progress of the frame. */
  s: number;
  kind: 'floor' | 'bench' | 'box' | 'wall' | 'slide';
  /** Body part, e.g. "near shin (front)". */
  part: string;
  /** How far it goes in (or slides), in body heights. */
  depth: number;
}

/** Bench pads are drawn this thick, centred on their points (see ./equipment). */
export const PAD_HALF = 0.023;
/** Wall slabs are drawn this thick, behind their x (see ./equipment). */
const WALL_DEPTH = 0.05;

interface SkinPoint {
  p: Vec;
  part: string;
}

/** Points on the skin outline of one segment. `frontDeg` is the direction of the segment's front. */
function segmentSkin(from: Vec, to: Vec, frontDeg: number, front: number, back: number, name: string, out: SkinPoint[]) {
  const n = dir(frontDeg);
  for (const t of [0.15, 0.35, 0.5, 0.65, 0.85]) {
    const c = add(from, mul(sub(to, from), t));
    out.push({ p: add(c, mul(n, front)), part: `${name} (front)` }, { p: add(c, mul(n, -back)), part: `${name} (back)` });
  }
}

/** The skin outline points of a side-view figure at progress s. */
export function skinPoints(demo: Demo, s: number, back = false): SkinPoint[] {
  const f = figureAt(demo, s, back);
  const out: SkinPoint[] = [];
  const pose = f.pose;
  const sides = [
    { side: f.a, leg: pose.leg, arm: pose.arm, label: 'near' },
    { side: f.b, leg: pose.leg2, arm: pose.arm2, label: 'far' },
  ];
  // Trunk: lower part hip to waist (glutes at the back by the hip), upper part waist to shoulder.
  const hip = f.a.hip;
  segmentSkin(hip, f.waist, pose.torso + 90, BODY.bellyFront, BODY.torsoBack, 'lower trunk', out);
  segmentSkin(f.waist, f.a.shoulder, pose.torso + pose.bend + 90, BODY.torsoFront, BODY.torsoBack, 'upper trunk', out);
  out.push({ p: add(hip, mul(dir(pose.torso - 90), BODY.glute)), part: 'glutes' });
  out.push({ p: add(f.head, mul(dir(pose.head), BODY.head)), part: 'head (top)' });
  for (const deg of [0, 90, 180, 270]) out.push({ p: add(f.head, mul(dir(pose.head + deg), BODY.head * 0.9)), part: 'head' });
  for (const { side, leg, arm, label } of sides) {
    segmentSkin(side.hip, side.knee, leg.thigh - 90, BODY.thighFront, BODY.thighBack, `${label} thigh`, out);
    segmentSkin(side.knee, side.ankle, leg.shin - 90, BODY.shinFront, BODY.calf, `${label} shin`, out);
    segmentSkin(side.shoulder, side.elbow, arm.upper - 90, BODY.upperArm, BODY.upperArm, `${label} upper arm`, out);
    segmentSkin(side.elbow, side.wrist, arm.fore - 90, BODY.forearm, BODY.forearm, `${label} forearm`, out);
    const handHalf = arm.flat ? BODY.hand / 2 : BODY.hand;
    out.push({ p: add(side.hand, mul(dir(arm.hand - 90), handHalf)), part: `${label} hand` }, { p: add(side.hand, mul(dir(arm.hand + 90), handHalf)), part: `${label} hand` });
    out.push({ p: side.heel, part: `${label} heel` }, { p: side.ball, part: `${label} ball of the foot` }, { p: side.toe, part: `${label} toe` });
  }
  return out;
}

/** Signed distance of p from segment a-b, positive on the side `up` points to; null when p is past either end. */
function across(p: Vec, a: Vec, b: Vec): number | null {
  const d = sub(b, a);
  const len = Math.hypot(d.x, d.y);
  if (len < 1e-9) return null;
  const u = { x: d.x / len, y: d.y / len };
  const t = (p.x - a.x) * u.x + (p.y - a.y) * u.y;
  if (t < 0 || t > len) return null;
  // Normal pointing up the screen (negative y) for a left-to-right pad.
  const nx = u.y;
  const ny = -u.x;
  const sgn = ny <= 0 ? 1 : -1;
  return sgn * ((p.x - a.x) * nx + (p.y - a.y) * ny);
}

function equipmentIssue(sp: SkinPoint, prop: Prop, tolerance: number): { kind: ContactIssue['kind']; depth: number } | null {
  if (prop.kind === 'bench') {
    for (let i = 0; i < prop.points.length - 1; i++) {
      const h = across(sp.p, prop.points[i], prop.points[i + 1]);
      // Inside the pad: between its bottom and top surfaces.
      if (h !== null && h < PAD_HALF - tolerance && h > -PAD_HALF) return { kind: 'bench', depth: PAD_HALF - h };
    }
  }
  if (prop.kind === 'box') {
    const { x, y } = sp.p;
    const inside = Math.min(x - prop.x, prop.x + prop.w - x, y - prop.y, prop.y + prop.h - y);
    if (inside > tolerance) return { kind: 'box', depth: inside };
  }
  if (prop.kind === 'wall') {
    const inside = prop.facing === 'left' ? Math.min(prop.x + WALL_DEPTH - sp.p.x, sp.p.x - prop.x) : Math.min(sp.p.x - (prop.x - WALL_DEPTH), prop.x - sp.p.x);
    if (inside > tolerance && sp.p.y > prop.top) return { kind: 'wall', depth: inside };
  }
  return null;
}

/**
 * Every frame (of `frames` from s = 0 to 1) where the body goes into the
 * floor or a bench, box or wall by more than `tolerance`, and every planted
 * foot point that slides along the floor. One entry per part and kind, at
 * its deepest frame.
 */
export function contactIssues(demo: Demo, frames = 11, tolerance = 0.012): ContactIssue[] {
  if (demo.view !== 'side') return [];
  const floor = floorOf(demo);
  const worst = new Map<string, ContactIssue>();
  const note = (issue: ContactIssue) => {
    const key = `${issue.kind}|${issue.part}`;
    const prev = worst.get(key);
    if (!prev || issue.depth > prev.depth) worst.set(key, issue);
  };
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const planted = new Map<string, number[][]>();
  // The way out, then the way back when it takes its own path; feet are tracked on the moving ground.
  const steps = Array.from({ length: frames }, (_, k) => ({ s: frames === 1 ? 0 : k / (frames - 1), back: false }));
  if (demo.back) steps.push(...steps.slice(0, -1).reverse().map((st) => ({ s: st.s, back: true })));
  for (const { s, back } of steps) {
    const moved = demo.ground?.at(s, back) ?? 0;
    for (const sp of skinPoints(demo, s, back)) {
      if (floor !== null && sp.p.y > floor + tolerance) note({ s, kind: 'floor', part: sp.part, depth: round(sp.p.y - floor) });
      for (const prop of demo.props ?? []) {
        if (prop.kind === 'bench' && prop.beside?.test(sp.part)) continue;
        const hit = equipmentIssue(sp, prop, tolerance);
        if (hit) note({ s, kind: hit.kind, part: sp.part, depth: round(hit.depth) });
      }
      // Feet on the floor: remember where, frame by frame, to catch sliding (a foot that lifts and lands elsewhere is a step).
      if (floor !== null && /heel|ball|toe/.test(sp.part)) {
        const runs = planted.get(sp.part) ?? [[]];
        const run = runs[runs.length - 1];
        if (Math.abs(sp.p.y - floor) <= 0.004) run.push(sp.p.x + moved);
        else if (run.length) runs.push([]);
        planted.set(sp.part, runs);
      }
    }
  }
  for (const [part, runs] of planted) {
    const slide = Math.max(0, ...runs.filter((xs) => xs.length).map((xs) => Math.max(...xs) - Math.min(...xs)));
    if (slide > tolerance) note({ s: 0, kind: 'slide', part, depth: round(slide) });
  }
  return [...worst.values()].sort((a, b) => b.depth - a.depth);
}
