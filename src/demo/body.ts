// The human figure for exercise demos: SVG markup drawn from the solved
// skeleton, with each muscle group coloured by how hard it is working.
//
// Construction. Every body part is a profile: a list of [t, d] points, t along
// the bone (in body heights, as if the segment were its full length) and d
// across it, toward the front of the segment in side view or the outside of
// the body in front view. A profile is mapped through its bone's frame and
// drawn as a closed quadratic B-spline, which is smooth and never overshoots
// its control points, so no pose can make it loop or spike. The silhouette is
// one outlined shape per chain (outline stroke painted under the fill), so
// joints never show seams. Muscles are inlaid on the silhouette as bellies that
// follow its contour, separated by thin skin-coloured gaps, and filled with the
// heat ramp. Working muscles swell into the skin bands between them, so effort
// shows in shape as well as colour.
import { MUSCLE_GROUPS, type MuscleGroup } from '../data/types';
import { restingSide, type Levels } from './engagement';
import type { Arm, Figure, Leg, Side, Vec } from './figure';

/** A pose with every optional part filled in. */
export interface ResolvedPose {
  /** Lower trunk direction. */
  torso: number;
  /** Spine flexion at the waist (upper trunk = torso + bend). */
  bend: number;
  head: number;
  torsoScale: number;
  leg: Leg;
  arm: Required<Arm>;
  leg2: Leg;
  arm2: Required<Arm>;
}
export interface BodyFigure extends Figure {
  pose: ResolvedPose;
}
export interface BodyContext {
  /** Muscle levels; for a one-sided exercise these are the working side's. */
  level: Levels;
  /**
   * One-sided exercise: the side whose limbs work (`a` or `b`, see
   * Demo.working). The other side's arm and leg use `restingSide(level)`;
   * the trunk always uses `level`.
   */
  working?: 'a' | 'b';
  /** Share of its level the other side's limbs show (Demo.otherSide; default at rest). */
  otherSide?: number;
  /** Colour for an engagement level. */
  heat: (level: number) => string;
  /** Unique per drawn figure: prefix for any ids in <defs>. */
  id: string;
}
/**
 * Painted back to front: far limbs, trunk with neck and head, near leg, near
 * arm; equipment goes between and around them (a held bar between the near
 * leg and the near arm). With the hands between the legs (Demo.armBehindLegs)
 * the near arm is painted before the near leg. Front view: everything that
 * isn't one of the near limbs goes in far and core.
 */
export interface BodyLayers {
  far: string;
  core: string;
  nearLeg: string;
  nearArm: string;
}

/**
 * Bone line to skin, in body heights (a standing figure is about 1 tall), for
 * an athletic adult. The figure is drawn to these, and the movement patterns
 * use them so the body rests on the floor and on benches instead of sinking
 * into them. Side view: torso and glute from the hip-shoulder line; limbs from
 * the bone line; footSole from the ankle joint to the sole.
 */
export const BODY = {
  torsoBack: 0.076,
  torsoFront: 0.084,
  glute: 0.086,
  thighBack: 0.05,
  thighFront: 0.059,
  calf: 0.048,
  shinFront: 0.03,
  upperArm: 0.038,
  forearm: 0.027,
  /** A fist's half-thickness; a flat hand is about half of this. */
  hand: 0.025,
  head: 0.066,
  neck: 0.04,
  footSole: 0.035,
};

/* ---------------- vectors ---------------- */
type P2 = [number, number];
const RAD = Math.PI / 180;
const V = (x: number, y: number): Vec => ({ x, y });
const add = (a: Vec, b: Vec) => V(a.x + b.x, a.y + b.y);
const sub = (a: Vec, b: Vec) => V(a.x - b.x, a.y - b.y);
const mul = (a: Vec, k: number) => V(a.x * k, a.y * k);
const mid = (a: Vec, b: Vec) => V((a.x + b.x) / 2, (a.y + b.y) / 2);
const lerpV = (a: Vec, b: Vec, t: number) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const len = (a: Vec) => Math.hypot(a.x, a.y);
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
const dir = (deg: number) => V(Math.sin(deg * RAD), -Math.cos(deg * RAD));
const angleOf = (u: Vec) => Math.atan2(u.x, -u.y) / RAD;
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (u: number) => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};
const unit = (v: Vec, fallback: Vec) => {
  const l = len(v);
  return l > 1e-7 ? mul(v, 1 / l) : fallback;
};
/** The direction 90 degrees on from v (clockwise on screen). */
const rot90 = (v: Vec) => V(-v.y, v.x);
const distToSegment = (p: Vec, a: Vec, b: Vec) => {
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-9), 0, 1);
  return len(sub(p, add(a, mul(ab, t))));
};
/** Whether p lies inside the polygon (even-odd rule). */
function inside(p: Vec, poly: readonly Vec[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
/** Points on the closed curve drawn from a control polygon: each edge's midpoint and the curve's point at each corner. */
function onCurve(p: readonly Vec[]): Vec[] {
  const n = p.length;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i + n - 1) % n];
    const b = p[(i + 1) % n];
    out.push(V((a.x + 6 * p[i].x + b.x) / 8, (a.y + 6 * p[i].y + b.y) / 8), mid(p[i], b));
  }
  return out;
}
/** Whether drawn outlines (control polygons) cover p, their outline stroke included. */
function covers(shape: readonly (readonly Vec[])[], p: Vec): boolean {
  return shape.some((poly) => {
    const c = onCurve(poly);
    return inside(p, c) || c.some((q, i) => distToSegment(p, q, c[(i + 1) % c.length]) < W);
  });
}
const cubic = (a: Vec, b: Vec, c: Vec, d: Vec, t: number) => {
  const u = 1 - t;
  const [w0, w1, w2, w3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return V(w0 * a.x + w1 * b.x + w2 * c.x + w3 * d.x, w0 * a.y + w1 * b.y + w2 * c.y + w3 * d.y);
};

/* ---------------- path text ---------------- */
// Coordinates to 3 decimals, no leading zero, no space before a minus sign:
// the figure is redrawn every animation frame, so the markup stays small.
function num(v: number): string {
  let s = (Math.round((Number.isFinite(v) ? v : 0) * 1000) / 1000).toString();
  if (s === '-0') return '0';
  if (s.startsWith('0.')) s = s.slice(1);
  else if (s.startsWith('-0.')) s = '-' + s.slice(2);
  return s;
}
function coords(pts: Vec[]): string {
  let s = '';
  for (const p of pts) for (const n of [num(p.x), num(p.y)]) s += (s && n[0] !== '-' ? ' ' : '') + n;
  return s;
}
/** Closed quadratic B-spline on a control polygon. */
function closed(p: Vec[]): string {
  const n = p.length;
  const seq: Vec[] = [];
  for (let i = 0; i < n; i++) seq.push(p[i], mid(p[i], p[(i + 1) % n]));
  return `M${coords([mid(p[n - 1], p[0])])}Q${coords(seq)}Z`;
}
/** The part of that closed curve around control points i0 + 1 .. i1. */
function arcOf(p: Vec[], i0: number, i1: number): string {
  const n = p.length;
  const at = (i: number) => p[((i % n) + n) % n];
  const seq: Vec[] = [];
  for (let i = i0 + 1; i <= i1; i++) seq.push(at(i), mid(at(i), at(i + 1)));
  return `M${coords([mid(at(i0), at(i0 + 1))])}Q${coords(seq)}`;
}
/** Open curve from the first control point to the last. */
function open(p: Vec[]): string {
  const n = p.length;
  if (n === 2) return `M${coords([p[0]])}L${coords([p[1]])}`;
  const seq: Vec[] = [];
  for (let i = 1; i < n - 1; i++) seq.push(p[i], i === n - 2 ? p[n - 1] : mid(p[i], p[i + 1]));
  return `M${coords([p[0]])}Q${coords(seq)}`;
}
const signedArea = (p: Vec[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a;
};
/** Several outlines in one path, all wound the same way so overlaps unite under the nonzero rule. */
const union = (polys: Vec[][]) => polys.map((p) => closed(signedArea(p) < 0 ? p.slice().reverse() : p)).join('');

/* ---------------- frames ---------------- */
interface Frame {
  /** Along the bone (unit). */
  u: Vec;
  /** Across the bone: d > 0 side (unit). */
  f: Vec;
  /** Apparent length / nominal length. */
  k: number;
  p(t: number, d: number): Vec;
}
const flatFrame = (o: Vec, u: Vec, f: Vec, k: number): Frame => ({ u, f, k, p: (t, d) => V(o.x + u.x * t * k + f.x * d, o.y + u.y * t * k + f.y * d) });
/**
 * A limb segment from joint `o` to joint `tip`. The bone is scaled to its
 * apparent length, but whatever lies beyond either joint (the shoulder cap, the
 * elbow, the knee) keeps its true size, so a limb pointing at the camera ends
 * round and keeps its deltoid cap instead of shrinking to a sliver.
 */
function boneFrame(o: Vec, tip: Vec, nominal: number, deg: number, sideOf: (u: Vec) => Vec): Frame {
  const v = sub(tip, o);
  const L = len(v);
  const u = L > 1e-6 ? mul(v, 1 / L) : dir(deg);
  const k = L > 1e-6 ? Math.min(L / nominal, 1.2) : 1;
  const f = sideOf(u);
  const along = (t: number) => (t <= 0 ? t : t >= nominal ? nominal * k + (t - nominal) : t * k);
  return { u, f, k, p: (t, d) => V(o.x + u.x * along(t) + f.x * d, o.y + u.y * along(t) + f.y * d) };
}
/** Side view: d > 0 is the front of the segment (its direction - 90 degrees). */
const sideFrame = (o: Vec, tip: Vec, nominal: number, deg: number) => boneFrame(o, tip, nominal, deg, (u) => V(u.y, -u.x));
const mapped = (F: { p(t: number, d: number): Vec }, list: readonly P2[]) => list.map(([t, d]) => F.p(t, d));
/** A profile pushed outward by w (lines that sit on the visible outline). */
const grow = (list: readonly P2[], w: number): P2[] => list.map(([t, d]) => [t, d + (d >= 0 ? w : -w)]);

/** Width of the skin-coloured gap between neighbouring muscles (a stroke round each muscle). */
const GAP = 0.0045;
/** Visible outline, outside the fill edge (the fill is drawn this far inside BODY). */
const W = 0.0058;
/** A run of a silhouette profile (indices i0..i1, either way), pulled in by half a gap so a muscle built on it hugs the skin. */
function runOf(prof: readonly P2[], i0: number, i1: number): P2[] {
  const out: P2[] = [];
  const step = i1 >= i0 ? 1 : -1;
  for (let i = i0; i !== i1 + step; i += step) out.push([prof[i][0], prof[i][1] >= 0 ? prof[i][1] - GAP / 2 : prof[i][1] + GAP / 2]);
  return out;
}
/**
 * A muscle belly: a run along the skin and an inner edge that moves `swell`
 * away from the skin as the muscle works (side +1: the belly lies on the d > 0
 * side), tapering to both ends so it stays attached to the run.
 */
function belly(run: readonly P2[], inner: readonly P2[], side: 1 | -1, swell: number): P2[] {
  const n = inner.length;
  return [...run, ...inner.map(([t, d], i): P2 => [t, d - side * swell * Math.sin((Math.PI * (i + 1)) / (n + 1))])];
}

/** Side-view trunk frame: t runs 0 (hip joint) .. 0.288 (shoulder joint), d > 0 toward the chest. */
interface TrunkFrame {
  u1: Vec;
  f1: Vec;
  p(t: number, d: number): Vec;
}
/** Hip -> waist -> shoulder, bent smoothly through the waist on a circular fillet (abs shorten, back lengthens). */
function trunkFrame(hip: Vec, waist: Vec, shoulder: Vec, torsoDeg: number, bendDeg: number): TrunkFrame {
  let L1 = len(sub(waist, hip));
  let L2 = len(sub(shoulder, waist));
  const u1 = unit(sub(waist, hip), dir(torsoDeg));
  const u2 = unit(sub(shoulder, waist), dir(torsoDeg + bendDeg));
  if (L1 < 1e-6) L1 = 0.115;
  if (L2 < 1e-6) L2 = 0.173;
  const k1 = L1 / 0.115;
  const k2 = L2 / 0.173;
  const f1 = rot90(u1);
  const f2 = rot90(u2);
  const W0 = add(hip, mul(u1, L1));
  const lower = (t: number, d: number) => add(add(hip, mul(u1, t * k1)), mul(f1, d));
  const upper = (t: number, d: number) => add(add(W0, mul(u2, (t - 0.115) * k2)), mul(f2, d));
  const beta = Math.atan2(cross(u1, u2), dot(u1, u2));
  const B = Math.abs(beta);
  if (B < 0.004) return { u1, f1, p: (t, d) => (t <= 0.115 ? lower(t, d) : upper(t, d)) };
  const e = Math.min(0.1, 0.7 * L1, 0.7 * L2, Math.max(0.05, 0.09 * Math.tan(Math.min(B, 2.6) / 2)));
  const R = e / Math.tan(B / 2);
  const sg = Math.sign(beta);
  const C = add(sub(W0, mul(u1, e)), mul(f1, sg * R));
  const ta = 0.115 - e / k1;
  const tb = 0.115 + e / k2;
  return {
    u1,
    f1,
    p(t, d) {
      if (t <= ta) return lower(t, d);
      if (t >= tb) return upper(t, d);
      const ph = (beta * (t - ta)) / (tb - ta);
      const f = V(f1.x * Math.cos(ph) - u1.x * Math.sin(ph), f1.y * Math.cos(ph) - u1.y * Math.sin(ph));
      return add(sub(C, mul(f, sg * R)), mul(f, d));
    },
  };
}
/** Head frame: x toward the face (side view) or image right (front view), y toward the crown. */
function headFrame(fig: BodyFigure) {
  const up = dir(fig.pose.head);
  const fx = dir(fig.pose.head + 90);
  const o = fig.head;
  return { p: (x: number, y: number) => V(o.x + fx.x * x + up.x * y, o.y + fx.y * x + up.y * y) };
}

/* ---------------- paint ---------------- */
interface Palette {
  skin: string;
  line: string;
  /** A group's level, 0..1. */
  lv(g: MuscleGroup): number;
  /** A group's fill. */
  m(g: MuscleGroup): string;
}
function palette(c: BodyContext, level: Levels, far: boolean): Palette {
  const lv = (g: MuscleGroup) => clamp(Number.isFinite(level[g]) ? level[g] : 0, 0, 1);
  if (!far) return { skin: 'var(--fig-skin)', line: 'var(--fig-edge)', lv, m: (g) => c.heat(lv(g)) };
  // Far limbs sit on a darker skin; their heat is mixed in only lightly so it stays on the ramp.
  return { skin: 'var(--fig-skin-far)', line: 'var(--fig-edge-far)', lv, m: (g) => `color-mix(in oklab,${c.heat(lv(g))} 85%,var(--fig-skin-far))` };
}
/** The levels one side's limbs are drawn with: the working side (or both) at full, the other near rest. */
const limbLevels = (c: BodyContext, side: 'a' | 'b'): Levels => (c.working && c.working !== side ? restingSide(c.level, c.otherSide) : c.level);

const path = (d: string, attrs: string) => (d ? `<path d="${d}" ${attrs}/>` : '');
/** Skin with its outline (the stroke is painted under the fill, so only its outer half shows). */
const solid = (d: string, pal: Palette) => path(d, `fill="${pal.skin}" stroke="${pal.line}" stroke-width="${num(2 * W)}" stroke-linejoin="round" paint-order="stroke"`);
const outline = (d: string, pal: Palette, w = 2 * W) => path(d, `fill="none" stroke="${pal.line}" stroke-width="${num(w)}" stroke-linejoin="round" stroke-linecap="round"`);
const skin = (d: string, pal: Palette) => path(d, `fill="${pal.skin}"`);
const muscle = (d: string, fill: string, pal: Palette) => path(d, `fill="${fill}" stroke="${pal.skin}" stroke-width="${num(GAP)}" stroke-linejoin="round"`);
/** Skin-coloured lines that split a muscle (deltoid heads, the abdominals' tendinous lines). */
const split = (d: string, pal: Palette, w = 0.8 * GAP) => path(d, `fill="none" stroke="${pal.skin}" stroke-width="${num(w)}" stroke-linecap="round"`);
/** Faint darker lines: fingers, the thumb, a groove between muscle heads. */
const crease = (d: string, w = 0.0025) => path(d, `fill="none" stroke="var(--fig-crease)" stroke-opacity=".35" stroke-width="${num(w)}" stroke-linecap="round"`);
const lines = (F: { p(t: number, d: number): Vec }, list: readonly (readonly P2[])[]) => list.map((l) => open(mapped(F, l))).join('');

/* =========================================================================
   SIDE VIEW: the lifter faces +x; a = the side nearest the camera, b = far
   ========================================================================= */
const THIGH: P2[] = [
  [-0.03, 0.034], [0.0, 0.047], [0.04, 0.053], [0.09, 0.0555], [0.14, 0.052], [0.185, 0.045], [0.214, 0.0405], // 0-6 front
  [0.238, 0.042], [0.261, 0.036], [0.276, 0.018], [0.279, -0.004], [0.268, -0.024], // 7-11 knee
  [0.244, -0.034], [0.21, -0.0365], [0.165, -0.0415], [0.115, -0.0455], [0.065, -0.0465], [0.025, -0.046], [-0.005, -0.043], // 12-18 back
  [-0.035, -0.032], [-0.05, -0.005], // 19-20 hip cap
];
const SHIN: P2[] = [
  [-0.03, 0.022], [0.0, 0.0255], [0.035, 0.026], [0.085, 0.0225], [0.135, 0.0195], [0.185, 0.0175], [0.222, 0.0175], // 0-6 front
  [0.248, 0.018], [0.264, 0.009], [0.266, -0.006], [0.256, -0.018], // 7-10 ankle
  [0.232, -0.0205], [0.2, -0.021], [0.168, -0.026], [0.135, -0.0355], [0.098, -0.0425], [0.062, -0.044], [0.03, -0.0385], [0.0, -0.0325], // 11-18 calf
  [-0.028, -0.029], [-0.042, -0.01], // 19-20 knee cap
];
// Quadriceps (vastus lateralis and rectus femoris) on the front, hamstrings (biceps femoris) behind; at rest the
// iliotibial band shows between them as a skin band, which a working muscle swells into.
const QUADS_RUN: P2[] = [...runOf(THIGH, 1, 6), [0.232, 0.031], [0.242, 0.016]];
const QUADS_IN: P2[] = [[0.226, 0.006], [0.19, 0.004], [0.145, 0.003], [0.1, 0.002], [0.06, 0.0], [0.028, -0.004], [0.006, -0.012]];
const HAMS_RUN: P2[] = runOf(THIGH, 12, 17);
const HAMS_IN: P2[] = [[0.03, -0.03], [0.06, -0.019], [0.1, -0.0165], [0.15, -0.0165], [0.2, -0.018], [0.236, -0.022], [0.258, -0.029]];
const THIGH_GROOVE: P2[][] = [[[0.05, 0.03], [0.1, 0.034], [0.15, 0.031], [0.2, 0.024]]];
// Calf: the gastrocnemius bulge ending in a point at mid-calf, over the soleus band below and in front of it.
const GASTRO_RUN: P2[] = [[-0.008, -0.02], ...runOf(SHIN, 18, 14), [0.155, -0.026]];
const GASTRO_IN: P2[] = [[0.14, -0.016], [0.105, -0.008], [0.065, -0.006], [0.03, -0.009], [0.005, -0.014]];
const SOLEUS: P2[] = [[0.09, -0.004], [0.125, -0.006], [0.16, -0.009], [0.19, -0.011], [0.208, -0.016], ...runOf(SHIN, 12, 13), [0.165, -0.029], [0.15, -0.021], [0.13, -0.012]];

const UARM: P2[] = [
  [-0.03, 0.03], [0.005, 0.039], [0.045, 0.037], [0.085, 0.0315], [0.125, 0.0335], [0.158, 0.0295], [0.182, 0.0255], // 0-6 front
  [0.2, 0.024], [0.213, 0.012], [0.215, -0.004], [0.207, -0.019], // 7-10 elbow
  [0.186, -0.026], [0.155, -0.031], [0.12, -0.0335], [0.08, -0.0335], [0.04, -0.037], [0.005, -0.039], // 11-16 back
  [-0.03, -0.032], [-0.047, -0.012], [-0.046, 0.012], // 17-19 shoulder cap
];
/** The upper arm with the biceps bulging as the elbow bends (flex 0 = straight, 1 = fully bent). */
const upperArmProfile = (flex: number): P2[] => UARM.map(([t, d], i): P2 => [t, d + flex * (i === 3 ? 0.004 : i === 4 ? 0.007 : i === 5 ? 0.004 : 0)]);
const FOREARM: P2[] = [
  [-0.012, 0.021], [0.02, 0.0225], [0.055, 0.021], [0.09, 0.0175], [0.12, 0.0145], [0.14, 0.0135], // 0-5 palm side
  [0.152, 0.012], [0.158, 0.003], [0.157, -0.007], [0.149, -0.013], // 6-9 wrist
  [0.13, -0.0145], [0.1, -0.017], [0.065, -0.0205], [0.035, -0.0225], [0.01, -0.0225], // 10-14 back
  [-0.014, -0.021], [-0.026, -0.008], [-0.024, 0.01], // 15-17 elbow cap
];
// Triceps: the back half of the upper arm, its lateral head bulging from under the deltoid to the elbow.
const TRICEPS_IN: P2[] = [[0.045, -0.014], [0.08, -0.008], [0.12, -0.0065], [0.158, -0.008], [0.188, -0.014]];
// Fist closed around the hand point (GRIP past the wrist): t along the hand, d toward the palm. The thumb crosses
// the front of the fingers; one line marks the knuckles.
const FIST: P2[] = [
  [0.002, 0.0135], [0.013, 0.0195], [0.035, 0.0208], [0.054, 0.0188], [0.064, 0.0105], [0.0665, -0.003], [0.062, -0.0135],
  [0.05, -0.0192], [0.03, -0.0198], [0.012, -0.0165], [0.0, -0.0105], [-0.003, 0.002],
];
const FIST_LINES: P2[][] = [[[0.01, 0.012], [0.028, 0.014], [0.044, 0.008], [0.05, -0.003]], [[0.058, 0.012], [0.06, 0.0], [0.056, -0.011]]];
// Open hand pressing on a surface: t toward the fingertips, d toward the palm. The palm lies BODY.hand / 2 (outline
// included) from the line through the wrist and the palm centre, as the movement patterns place it.
const FLAT_HAND: P2[] = [
  [-0.014, -0.002], [-0.011, 0.0065], [0.004, 0.0067], [0.045, 0.0067], [0.08, 0.0067], [0.097, 0.006], [0.105, 0.002],
  [0.1, -0.0035], [0.08, -0.005], [0.055, -0.0058], [0.03, -0.0085], [0.008, -0.0115], [-0.008, -0.011],
];
const THUMB_LINE: P2[][] = [[[0.026, -0.006], [0.042, -0.002], [0.058, 0.003]]];
// Deltoid: a cap over the shoulder whose three heads (front, middle, back) converge in a V at mid-arm.
const DELT: P2[] = [
  [0.085, 0.002], [0.085, 0.002], [0.066, 0.012], [0.04, 0.024], [0.012, 0.0325], [-0.016, 0.033], [-0.036, 0.022], [-0.046, 0.002],
  [-0.042, -0.018], [-0.026, -0.032], [0.0, -0.034], [0.026, -0.029], [0.05, -0.018], [0.07, -0.007],
];
const DELT_SPLITS: P2[][] = [[[0.076, 0.003], [0.046, 0.011], [0.018, 0.018], [-0.012, 0.021], [-0.03, 0.017]], [[0.076, 0.0], [0.047, -0.009], [0.02, -0.015], [-0.01, -0.02], [-0.03, -0.019]]];
// The pectoral's tendon running into the front of the upper arm under the deltoid (the front fold of the armpit).
const PEC_TAIL: P2[] = [[-0.004, 0.028], ...runOf(UARM, 1, 5), [0.15, 0.019], [0.12, 0.006], [0.08, 0.002], [0.04, 0.004], [0.012, 0.012]];
// The back fold of the armpit: the lat and teres major running out from under the deltoid's back head along the back
// of the upper arm.
const BACK_TAIL: P2[] = [[-0.004, -0.03], ...runOf(UARM, 16, 12), [0.15, -0.02], [0.12, -0.007], [0.08, -0.002], [0.04, -0.004], [0.012, -0.012]];

const TRUNK: P2[] = [
  [-0.05, 0.028], [-0.02, 0.043], [0.02, 0.0485], [0.065, 0.0535], [0.105, 0.0585], [0.14, 0.0655], [0.172, 0.0735], [0.2, 0.0795], // 0-7
  [0.226, 0.0805], [0.252, 0.0735], [0.273, 0.058], [0.288, 0.043], [0.296, 0.032], // 8-12 front
  [0.31, 0.012], [0.322, -0.012], [0.328, -0.032], // 13-15 neck base
  [0.318, -0.047], [0.296, -0.0595], [0.268, -0.0685], [0.238, -0.0725], [0.205, -0.071], [0.172, -0.0645], [0.14, -0.057], // 16-22
  [0.108, -0.0515], [0.078, -0.054], [0.048, -0.062], [0.015, -0.067], // 23-26 back
  [-0.02, -0.06], [-0.045, -0.035], [-0.058, -0.005], // 27-29 seat (under the glute and the thigh)
];
/** The trunk with the chest (TRUNK 6-10) swelling forward as the pectoral works (chest 0..1), as working muscles do. */
const CHEST_SWELL = [0.004, 0.009, 0.012, 0.01, 0.005];
const trunkProfile = (chest: number): P2[] => TRUNK.map(([t, d], i): P2 => [t, d + chest * (CHEST_SWELL[i - 6] ?? 0)]);
// Pectoralis major: a tall fan from the clavicle and sternum down to the lower chest (along the chest's contour,
// TRUNK 6-11), converging on the armpit.
const PEC_IN: P2[] = [[0.293, 0.031], [0.288, 0.017], [0.276, 0.006], [0.256, -0.002], [0.234, 0.0], [0.212, 0.01], [0.193, 0.028], [0.179, 0.048], [0.171, 0.063]];
/** Points over the pectoral, for judging how much of it the near arm covers. */
const PEC_SAMPLES: P2[] = [[0.19, 0.045], [0.2, 0.065], [0.215, 0.025], [0.225, 0.05], [0.235, 0.072], [0.25, 0.03], [0.255, 0.058], [0.27, 0.015], [0.275, 0.042], [0.285, 0.03]];
/** Points over the lat, the scapular back and the lower back, for judging how much of the back the near arm covers. */
const BACK_SAMPLES: P2[] = [
  [0.08, -0.05], [0.11, -0.052], [0.12, -0.035], [0.15, -0.03], [0.15, -0.05], [0.18, -0.02], [0.18, -0.045],
  [0.2, -0.06], [0.21, -0.01], [0.22, -0.035], [0.24, -0.055], [0.25, -0.02], [0.27, -0.04], [0.29, -0.03],
];
// Rectus abdominis: a strip along the front, seen mostly in profile, so narrow until it works and thickens; three
// tendinous lines cross it ([t inside, t at the skin, d at the skin]).
const RECTUS_RUN: P2[] = runOf(TRUNK, 1, 6);
const RECTUS_IN: P2[] = [[0.176, 0.063], [0.168, 0.053], [0.14, 0.049], [0.1, 0.044], [0.06, 0.039], [0.02, 0.034], [-0.008, 0.031], [-0.02, 0.035]];
const RECTUS_LINES: [number, number, number][] = [[0.157, 0.152, 0.062], [0.126, 0.121, 0.058], [0.094, 0.09, 0.053]];
// External oblique on the front of the flank: a scalloped upper edge where it meets the serratus, a diagonal back
// border in front of the lat, and its lower edge on the iliac crest. Working, it spreads into the skin bands beside
// the lat and the rectus (obliqueAt).
const OBLIQUE: P2[] = [
  [0.166, 0.038], [0.184, 0.033], [0.177, 0.026], [0.193, 0.022], [0.184, 0.015],
  [0.172, 0.012], [0.148, 0.004], [0.124, -0.005], [0.106, -0.014], [0.098, -0.019],
  [0.094, -0.006], [0.096, 0.008], [0.09, 0.02], [0.078, 0.029],
  [0.1, 0.033], [0.13, 0.036], [0.15, 0.037],
];
/** The oblique working (core 0..1): its back border (5-10) moves back toward the lat, its front edge (13-16, 0) toward the rectus. */
const obliqueAt = (core: number): P2[] => OBLIQUE.map(([t, d], i): P2 => [t, d + core * (i >= 5 && i <= 10 ? -0.006 : i >= 13 || i === 0 ? 0.003 : 0)]);
// Latissimus dorsi: a wing from under the armpit sweeping down and back to the iliac crest, its lower fibres wrapping
// round the side of the lower ribs in front of the erectors.
const LAT: P2[] = [
  [0.264, -0.008], [0.246, 0.003], [0.222, 0.005], [0.198, 0.006], [0.172, 0.006], [0.145, -0.003], [0.122, -0.011], [0.104, -0.02], [0.09, -0.028],
  [0.096, -0.034], [0.12, -0.033], [0.145, -0.038], [0.172, -0.048], ...runOf(TRUNK, 20, 20), [0.224, -0.064], [0.244, -0.053], [0.258, -0.034],
];
// Erector spinae along the lower back, and the scapular back (middle trapezius, infraspinatus, teres) behind the shoulder.
const ERECTORS: P2[] = [...runOf(TRUNK, 21, 25), [0.05, -0.044], [0.078, -0.039], [0.11, -0.038], [0.14, -0.043], [0.163, -0.053]];
const UPPER_BACK: P2[] = [...runOf(TRUNK, 16, 20), [0.21, -0.064], [0.232, -0.058], [0.252, -0.043], [0.272, -0.029], [0.296, -0.024], [0.316, -0.022]];

// Head in profile, [x toward the face, y toward the crown] from the centre of the skull.
const HEAD: P2[] = [
  [-0.036, -0.036], [-0.056, -0.018], [-0.063, 0.012], [-0.055, 0.039], [-0.032, 0.0575], [-0.002, 0.0625], [0.026, 0.057],
  [0.046, 0.04], [0.053, 0.019], [0.0505, 0.007], [0.0575, -0.006], [0.068, -0.017], [0.052, -0.022], [0.055, -0.03],
  [0.05, -0.036], [0.052, -0.042], [0.046, -0.049], [0.051, -0.058], [0.038, -0.067], [0.012, -0.059], [-0.012, -0.047],
  [-0.016, -0.034],
];
const HAIR: P2[] = [
  [0.036, 0.048], [0.026, 0.057], [-0.002, 0.0625], [-0.032, 0.0575], [-0.055, 0.039], [-0.063, 0.012], [-0.056, -0.018], [-0.04, -0.033],
  [-0.03, -0.02], [-0.024, -0.004], [-0.012, 0.012], [0.0, 0.018], [0.008, 0.004], [0.016, 0.006], [0.02, 0.03], [0.03, 0.042],
];
/** The face alone, forehead to jaw: redrawn over a near arm raised past the head. */
const FACE: P2[] = [
  [0.03, 0.046], [0.046, 0.04], [0.053, 0.019], [0.0505, 0.007], [0.0575, -0.006], [0.068, -0.017], [0.052, -0.022], [0.055, -0.03],
  [0.05, -0.036], [0.052, -0.042], [0.046, -0.049], [0.051, -0.058], [0.038, -0.067], [0.012, -0.059], [0.0, -0.05], [0.004, -0.02], [0.012, 0.012], [0.018, 0.036],
];
const EAR: P2[] = [[-0.004, 0.008], [-0.016, 0.014], [-0.024, 0.004], [-0.022, -0.014], [-0.012, -0.024], [-0.004, -0.016], [0.0, -0.004]];
const EYE: P2[] = [[0.03, 0.009], [0.037, 0.0115], [0.042, 0.009], [0.037, 0.006]];
const BROW: P2[] = [[0.025, 0.02], [0.036, 0.024], [0.048, 0.021], [0.047, 0.018], [0.036, 0.0205], [0.026, 0.017]];

/**
 * Buttock and hip muscles. The buttock outline runs from the sacrum on the lower
 * back (S) to the back of the thigh (Q) in two cubic arcs through an apex A.
 * Standing, A bulges straight back a little below the joint and the outline
 * tucks into the gluteal fold. As the hip bends the fold opens, Q slides down
 * the thigh and A stays mostly behind the pelvis, so the buttock becomes a
 * rounded end whose underside is level with the back of the thigh (a seat, a
 * bench, the floor) rather than a ball around the joint. Gluteus medius is a fan
 * under the iliac crest that shares a straight border with gluteus maximus, so
 * the two stay flush at any hip angle.
 */
function glutes(hip: Vec, T: TrunkFrame, Th: Frame) {
  const flexion = clamp(wrap(angleOf(T.u1) + 180 - angleOf(Th.u)), -45, 170);
  const fl = clamp(flexion / 120, 0, 1);
  const opened = smooth(flexion / 70);
  const trunkBack = mul(T.f1, -1);
  const thighBack = mul(Th.f, -1);
  const wF = 0.5 - 0.25 * fl;
  const m = unit(add(mul(trunkBack, 1 - wF), mul(thighBack, wF)), trunkBack);
  // S lies on the trunk's back contour between TRUNK[24] and TRUNK[25], leaving along the contour's own tangent.
  const S = T.p(0.063, -0.058);
  const tS = unit(sub(T.p(0.048, -0.062), T.p(0.078, -0.054)), mul(T.u1, -1));
  const tq = 0.072 + 0.08 * fl;
  const Q = Th.p(tq, -0.0462);
  // Arrival at Q: across the thigh into the fold when standing, along the thigh once the fold has opened.
  const beta = 72 * (1 - opened) * RAD;
  const tQ = unit(add(mul(Th.u, Math.cos(beta)), mul(Th.f, Math.sin(beta))), Th.u);
  const A = add(add(hip, mul(m, 0.0805 - 0.004 * fl)), mul(Th.u, 0.018 * (1 - fl)));
  let tA = rot90(m);
  if (dot(tA, sub(Q, S)) < 0) tA = mul(tA, -1);
  const arc = (P0: Vec, t0: Vec, P3: Vec, t3: Vec): Vec[] => {
    const h = 0.4 * len(sub(P3, P0));
    const P1 = add(P0, mul(t0, h));
    const P2 = sub(P3, mul(t3, h));
    return [0.2, 0.4, 0.6, 0.8, 1].map((t) => cubic(P0, P1, P2, P3, t));
  };
  const curve = [S, ...arc(S, tS, A, tA), ...arc(A, tA, Q, tQ)];
  // Skin under the outline, unioned with the thigh and the trunk.
  const blob = [T.p(0.05, -0.02), ...curve, Th.p(tq, -0.02), Th.p(0.02, 0.0)];
  const inset = curve.map((p) => add(p, mul(sub(hip, p), GAP / 2 / Math.max(len(sub(hip, p)), 0.02))));
  const trochanter = T.p(-0.002, -0.009); // just behind the greater trochanter
  const crest = T.p(0.084, -0.038); // the iliac crest, a third of the way from the back
  // Gluteus maximus stops at its insertion on the back of the thigh (the gluteal fold when standing).
  const end = (0.068 + 0.045 * fl) * Th.k;
  const kept = inset.filter((p, i) => i < 2 || dot(sub(p, hip), Th.u) < end);
  const maximus = [...kept, Th.p(0.056 + 0.04 * fl, -0.03), Th.p(0.045 + 0.02 * fl, -0.014), trochanter, lerpV(trochanter, crest, 0.5), crest, T.p(0.082, -0.048), T.p(0.072, -0.052)];
  const medius = [crest, T.p(0.09, -0.022), T.p(0.089, -0.004), T.p(0.082, 0.012), T.p(0.066, 0.022), T.p(0.042, 0.017), T.p(0.018, 0.006), T.p(0.004, -0.002), trochanter, lerpV(trochanter, crest, 0.5)];
  return { curve, blob, maximus, medius };
}

/**
 * The foot, bending at the ball: heel to ball is the foot itself, ball to tip
 * the toes. The sole lies on the given heel, ball and toe points (outline
 * included), so a raised heel keeps the toes flat on the floor and a foot on
 * its ball shows the crease over the toe joint.
 */
function footOutline(s: Side, leg: Leg): Vec[] {
  const { heel, ball } = s;
  const e = sub(ball, heel);
  const Lf = len(e);
  const u = Lf > 1e-6 ? mul(e, 1 / Lf) : dir(leg.foot);
  let up = V(u.y, -u.x);
  if (dot(sub(s.ankle, heel), up) < 0) up = mul(up, -1);
  // Toe bend at the ball, + = toes turned up toward the instep; kept to what a foot can do.
  const toward = unit(sub(s.toe, ball), u);
  const bend = clamp(Math.atan2(dot(toward, up), dot(toward, u)) / RAD, -40, 100) * RAD;
  const u2 = add(mul(u, Math.cos(bend)), mul(up, Math.sin(bend)));
  const up2 = add(mul(u, -Math.sin(bend)), mul(up, Math.cos(bend)));
  const F = flatFrame(heel, u, up, Lf > 1e-6 ? Lf / 0.102 : 1);
  const toes = flatFrame(ball, u2, up2, 1);
  const bisector = unit(add(up, up2), up);
  const c = Math.max(0.5, Math.cos(bend / 2));
  return [
    F.p(0.012, W), F.p(0.05, W + 0.001), F.p(0.084, W),
    add(ball, mul(bisector, W / c)), // the ball's pad, where the two parts of the sole meet
    toes.p(0.016, W), toes.p(0.031, W + 0.0005), toes.p(0.04, 0.006), toes.p(0.035, 0.0125), toes.p(0.017, 0.0145),
    add(ball, mul(bisector, Math.min(0.03, 0.0175 / c))), // top of the toe joint
    F.p(0.074, 0.029), F.p(0.05, 0.043), F.p(0.034, 0.058), F.p(0.012, 0.064), F.p(-0.006, 0.047), F.p(-0.016, 0.026), F.p(-0.012, 0.009),
  ];
}

function sideLeg(s: Side, leg: Leg, T: TrunkFrame, pal: Palette): string {
  const Th = sideFrame(s.hip, s.knee, 0.245, leg.thigh);
  const Sh = sideFrame(s.knee, s.ankle, 0.246, leg.shin);
  const thigh = mapped(Th, THIGH);
  const shin = mapped(Sh, SHIN);
  const foot = footOutline(s, leg);
  const g = glutes(s.hip, T, Th);
  let o = outline(arcOf(thigh, 1, 18) + closed(shin) + closed(foot) + open(g.curve), pal);
  o += skin(union([shin, foot]), pal);
  o += muscle(closed(mapped(Sh, SOLEUS)) + closed(mapped(Sh, belly(GASTRO_RUN, GASTRO_IN, -1, 0.006 * pal.lv('calves')))), pal.m('calves'), pal);
  o += skin(union([thigh, g.blob]), pal);
  o += outline(arcOf(mapped(Th, grow(THIGH, W / 2)), 11, 15), pal, W); // the kneecap's lower edge
  o += muscle(closed(mapped(Th, belly(HAMS_RUN, HAMS_IN, -1, 0.007 * pal.lv('hamstrings')))), pal.m('hamstrings'), pal);
  o += muscle(closed(mapped(Th, belly(QUADS_RUN, QUADS_IN, 1, 0.011 * pal.lv('quads')))), pal.m('quads'), pal);
  o += crease(lines(Th, THIGH_GROOVE));
  o += muscle(closed(g.medius) + closed(g.maximus), pal.m('glutes'), pal);
  return o;
}

/** Elbow flexion, 0 (straight) .. 1 (fully bent), from the forearm turning toward the front of the upper arm. */
function elbowFlex(upper: Frame, fore: Frame): number {
  const angle = Math.abs(Math.atan2(cross(upper.u, fore.u), dot(upper.u, fore.u))) / RAD;
  return dot(fore.u, upper.f) > 0 ? clamp(angle / 130, 0, 1) : 0;
}

/** A side-view arm: its bone frames, elbow flexion and outline (upper arm, forearm, and the hand: a fist or a flat palm). */
interface ArmShape {
  Ua: Frame;
  Fa: Frame;
  /** The hand's frame: t toward the fingers. */
  H: Frame;
  flex: number;
  prof: P2[];
  upper: Vec[];
  fore: Vec[];
  hand: Vec[];
}
function armShape(s: Side, arm: Required<Arm>): ArmShape {
  const Ua = sideFrame(s.shoulder, s.elbow, 0.186, arm.upper);
  const Fa = sideFrame(s.elbow, s.wrist, 0.146, arm.fore);
  const flex = elbowFlex(Ua, Fa);
  const prof = upperArmProfile(flex);
  let H: Frame;
  if (arm.flat) {
    // Palm down on the surface, fingers pointing `hand`, the palm on the side away from the elbow.
    const u = dir(arm.hand);
    let toPalm = V(u.y, -u.x);
    const side = dot(toPalm, sub(s.elbow, s.wrist));
    if (Math.abs(side) < 1e-4 ? dot(toPalm, Fa.f) < 0 : side > 0) toPalm = mul(toPalm, -1);
    H = flatFrame(s.wrist, u, toPalm, 1);
  } else {
    const u = unit(sub(s.hand, s.wrist), Fa.u);
    H = flatFrame(s.wrist, u, V(u.y, -u.x), 1);
  }
  return { Ua, Fa, H, flex, prof, upper: mapped(Ua, prof), fore: mapped(Fa, FOREARM), hand: mapped(H, arm.flat ? FLAT_HAND : FIST) };
}
const outlineOf = (A: ArmShape) => [A.upper, A.fore, A.hand];
/** How far an upper arm has turned to point at the camera: 0 along the picture, 1 seen end-on. */
const endOnOf = (A: ArmShape) => 1 - smooth((A.Ua.k - 0.15) / 0.2);
/**
 * The triceps along the back of the upper arm, or the biceps along its front:
 * from under the deltoid's edge to the elbow; the biceps shortens and thickens
 * as the elbow bends.
 */
function armMuscle(A: ArmShape, g: 'triceps' | 'biceps', pal: Palette, seen = 1): string {
  const { Ua, flex, prof } = A;
  // `seen` < 1 (an arm turning end-on) thins the belly toward the skin it lies on.
  const thin = (list: readonly P2[], skin: number): P2[] => list.map(([t, d]) => [t, skin + (d - skin) * seen]);
  const shape =
    g === 'triceps'
      ? belly([...runOf(prof, 11, 15), [0.026, -0.031]], thin(TRICEPS_IN, -0.031), -1, 0.006 * seen * pal.lv(g))
      : belly(
          [...runOf(prof, 2, 6), [0.196 - 0.008 * flex, 0.017], [0.2 - 0.008 * flex, 0.006]],
          thin([[0.182, 0.005 - 0.003 * flex], [0.15, 0.007 - 0.005 * flex], [0.11, 0.009 - 0.006 * flex], [0.075, 0.013 - 0.004 * flex], [0.05, 0.023]], 0.03),
          1,
          0.008 * seen * pal.lv(g),
        );
  return muscle(closed(mapped(Ua, shape)), pal.m(g), pal);
}

/**
 * One arm. `pecTail` / `backTail` (0..1) grow the pectoral's tendon onto the
 * front of the upper arm, or the back's fold onto its back, when this arm
 * covers most of that working muscle (a press, a row), so the main mover never
 * vanishes behind the arm.
 *
 * An upper arm pointing at the camera (short apparent length) is drawn as seen
 * end-on: one smooth limb with the round deltoid cap at the shoulder and the
 * fist at its end. The details that only read along a full-length arm (the
 * elbow crease, the biceps and triceps, the tendons, the deltoid's head lines)
 * thin out and give way as it shortens, so it never folds into a knot.
 */
function sideArm(A: ArmShape, arm: Required<Arm>, pal: Palette, pecTail = 0, backTail = 0): string {
  const { Ua, H, prof, upper, fore, hand } = A;
  const endOn = endOnOf(A);
  let o: string;
  let fist = '';
  if (arm.flat) {
    o = outline(closed(upper) + arcOf(fore, 0, 14) + closed(hand), pal) + skin(closed(hand), pal) + crease(lines(H, THUMB_LINE), 0.0022);
  } else {
    o = outline(closed(upper) + arcOf(fore, 0, 14), pal);
    fist = solid(closed(hand), pal) + crease(lines(H, FIST_LINES), 0.0024);
  }
  o += skin(closed(fore), pal) + skin(closed(upper), pal);
  if (endOn < 0.5) {
    const seen = 1 - 2 * endOn;
    o += outline(arcOf(mapped(Ua, grow(prof, W / 2)), 3, 8), pal, W * seen); // the elbow crease
    o += armMuscle(A, 'triceps', pal, seen) + armMuscle(A, 'biceps', pal, seen);
    const tail = (list: readonly P2[], k: number): P2[] => list.map(([t, d]) => [t * k, d * (0.6 + 0.4 * k)]);
    if (pecTail > 0) o += muscle(closed(mapped(Ua, tail(PEC_TAIL, pecTail * seen))), pal.m('chest'), pal);
    if (backTail > 0) o += muscle(closed(mapped(Ua, tail(BACK_TAIL, backTail * seen))), pal.m('back'), pal);
  }
  // The deltoid's front head gives way to the pectoral's tendon, its back head to the back fold, below the cap.
  const deltoid = (list: readonly P2[]): P2[] => list.map(([t, d]) => [t, d * (1 - 0.55 * smooth((t + 0.02) / 0.05) * (d > 0 ? pecTail : backTail))]);
  o += muscle(closed(mapped(Ua, deltoid(DELT))), pal.m('shoulders'), pal);
  if (endOn < 1) o += split(lines(Ua, DELT_SPLITS.map(deltoid)), pal, 0.8 * GAP * (1 - endOn));
  return o + fist;
}

/** Share of a trunk region (its sample points) hidden behind the near arm. */
function covered(T: TrunkFrame, s: Side, samples: readonly P2[]): number {
  const parts: [Vec, Vec, number][] = [[s.shoulder, s.elbow, 0.036], [s.elbow, s.wrist, 0.026], [s.wrist, s.hand, 0.026]];
  const hidden = samples.filter(([t, d]) => {
    const q = T.p(t, d);
    return parts.some(([a, b, r]) => distToSegment(q, a, b) < r);
  });
  return hidden.length / samples.length;
}

function sideHead(fig: BodyFigure, pal: Palette): string {
  const Hf = headFrame(fig);
  return (
    solid(closed(mapped(Hf, HEAD)), pal) +
    path(closed(mapped(Hf, HAIR)), 'fill="var(--fig-hair)"') +
    path(closed(mapped(Hf, EAR)), `fill="${pal.skin}" stroke="${pal.line}" stroke-width="${num(W * 0.7)}"`) +
    path(closed(mapped(Hf, EYE)) + closed(mapped(Hf, BROW)), 'fill="var(--fig-face)"')
  );
}

function sideTrunk(fig: BodyFigure, T: TrunkFrame, pal: Palette): string {
  const Hf = headFrame(fig);
  const neck = [T.p(0.265, 0.02), T.p(0.29, 0.034), Hf.p(0.028, -0.066), Hf.p(0.018, -0.04), Hf.p(-0.02, -0.03), Hf.p(-0.034, -0.042), T.p(0.33, -0.036), T.p(0.3, -0.04)];
  const ch = pal.lv('chest');
  const prof = trunkProfile(ch);
  let o = solid(union([mapped(T, prof), neck]), pal);
  // Back: erectors, scapular back, the lat wing, and the upper trapezius running up the back of the neck.
  const trapezius = [Hf.p(-0.031, -0.04), T.p(0.334, -0.031), T.p(0.322, -0.043), T.p(0.304, -0.03), T.p(0.298, -0.014), T.p(0.305, 0.0), Hf.p(-0.012, -0.05)];
  o += muscle(closed(mapped(T, ERECTORS)) + closed(mapped(T, UPPER_BACK)) + closed(mapped(T, LAT)) + closed(trapezius), pal.m('back'), pal);
  // Core: the external oblique on the flank, the rectus along the front with its tendinous lines.
  const core = pal.lv('core');
  o += muscle(closed(mapped(T, obliqueAt(core))) + closed(mapped(T, belly(RECTUS_RUN, RECTUS_IN, 1, 0.009 * core))), pal.m('core'), pal);
  o += split(RECTUS_LINES.map(([t0, t1, d1]) => open(mapped(T, [[t0, 0.04], [t1, 0.051], [t1 - 0.001, d1]]))).join(''), pal, 0.0042);
  // Chest: the pectoral's lower border drops a little as it works.
  o += muscle(closed(mapped(T, [...runOf(prof, 6, 11), ...PEC_IN.map(([t, d], i): P2 => (i >= 4 ? [t - 0.012 * ch, d - 0.004 * ch] : [t, d]))])), pal.m('chest'), pal);
  return o + sideHead(fig, pal);
}

/** Points just inside the face's profile: forehead, brow, nose, upper lip, chin. */
const PROFILE_PTS: P2[] = [[0.039, 0.038], [0.046, 0.018], [0.06, -0.015], [0.048, -0.029], [0.044, -0.056]];

/**
 * The near arm is nearer the camera than the head, so it is painted over it.
 * Raised beside the ear (overhead press at lockout, hanging) it still leaves
 * the face's profile in view, as a real side view does. When it crosses in
 * front of the face and hides most of the profile, the face is drawn again
 * over it, as if the head were just through the arms, so the figure never
 * reads as headless; an arm muscle the face would cover that is doing the
 * main work at that moment (the triceps in an overhead extension) is painted
 * back over the face.
 */
function faceOverArm(fig: BodyFigure, s: Side, A: ArmShape, pal: Palette, armPal: Palette): string {
  const near = Math.min(distToSegment(fig.head, s.shoulder, s.elbow), distToSegment(fig.head, s.elbow, s.wrist), distToSegment(fig.head, s.wrist, s.hand));
  const raised = dot(sub(s.elbow, s.shoulder), dir(fig.pose.torso + fig.pose.bend)) > 0.02;
  if (near > 0.085 || !raised) return '';
  const Hf = headFrame(fig);
  const arm = outlineOf(A);
  if (PROFILE_PTS.filter(([x, y]) => !covers(arm, Hf.p(x, y))).length >= 3) return '';
  let o = solid(closed(mapped(Hf, FACE)), pal) + path(closed(mapped(Hf, EYE)) + closed(mapped(Hf, BROW)), 'fill="var(--fig-face)"');
  const hardest = Math.max(...MUSCLE_GROUPS.map((g) => pal.lv(g)));
  const seen = 1 - 2 * endOnOf(A);
  for (const g of ['triceps', 'biceps'] as const) if (seen > 0 && armPal.lv(g) > 0.05 && armPal.lv(g) >= hardest - 0.05) o += armMuscle(A, g, armPal, seen);
  return o;
}

const samePoint = (p: Vec, q: Vec) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) < 2e-4;

function drawSide(fig: BodyFigure, c: BodyContext): BodyLayers {
  const { pose, a, b } = fig;
  const nearPal = palette(c, limbLevels(c, 'a'), false);
  const farPal = palette(c, limbLevels(c, 'b'), true);
  const trunkPal = palette(c, c.level, false);
  const T = trunkFrame(a.hip, fig.waist, a.shoulder, pose.torso, pose.bend);
  // The far limbs are drawn only where they show (not hidden exactly behind the near ones).
  const legHidden = (['hip', 'knee', 'ankle', 'heel', 'ball', 'toe'] as const).every((k) => samePoint(a[k], b[k]));
  const armHidden = (['shoulder', 'elbow', 'wrist', 'hand'] as const).every((k) => samePoint(a[k], b[k])) && pose.arm.flat === pose.arm2.flat;
  // When the near arm covers most of the chest or of a working back, that muscle's tendon is drawn onto the arm.
  const pecTail = smooth((covered(T, a, PEC_SAMPLES) - 0.35) / 0.3) * smooth(trunkPal.lv('chest') / 0.3);
  const backTail = smooth((covered(T, a, BACK_SAMPLES) - 0.35) / 0.3) * smooth(trunkPal.lv('back') / 0.3);
  const nearArm = armShape(a, pose.arm);
  return {
    far: (armHidden ? '' : sideArm(armShape(b, pose.arm2), pose.arm2, farPal)) + (legHidden ? '' : sideLeg(b, pose.leg2, T, farPal)),
    core: sideTrunk(fig, T, trunkPal),
    nearLeg: sideLeg(a, pose.leg, T, nearPal),
    nearArm: sideArm(nearArm, pose.arm, nearPal, pecTail, backTail) + faceOverArm(fig, a, nearArm, trunkPal, nearPal),
  };
}

/* =========================================================================
   FRONT VIEW: a = the lifter's right (image left when upright), b = left
   ========================================================================= */
// Profiles are [t, x]: t along the bone, x toward the outside of the body.
const THIGH_F: P2[] = [
  [-0.06, 0.027], [-0.035, 0.036], [-0.005, 0.042], [0.04, 0.046], [0.09, 0.046], [0.14, 0.042], [0.185, 0.0375], [0.22, 0.0345], // 0-7 outer
  [0.245, 0.033], [0.264, 0.028], [0.276, 0.013], [0.277, -0.006], [0.268, -0.023], [0.25, -0.0335], // 8-13 knee
  [0.222, -0.04], [0.19, -0.04], [0.145, -0.041], [0.095, -0.0435], [0.055, -0.046], [0.025, -0.047], // 14-19 inner
  [-0.008, -0.034], [-0.03, -0.012], [-0.05, 0.012], // 20-22 top, along the groin under the trunk (no outline)
];
const SHIN_F: P2[] = [
  [-0.03, 0.03], [0.0, 0.0355], [0.04, 0.039], [0.08, 0.036], [0.125, 0.0285], [0.17, 0.0225], [0.21, 0.0195], [0.235, 0.021], // 0-7 outer
  [0.252, 0.018], [0.262, 0.006], [0.262, -0.008], [0.25, -0.02], // 8-11 ankle
  [0.232, -0.023], [0.205, -0.0205], [0.165, -0.025], [0.125, -0.034], [0.085, -0.041], [0.048, -0.0415], [0.012, -0.0365], [-0.02, -0.033], // 12-19 inner
  [-0.038, -0.012], [-0.036, 0.012], // 20-21 knee
];
const UARM_F: P2[] = [
  [-0.034, -0.024], [-0.05, 0.0], [-0.044, 0.028], [-0.02, 0.0435], [0.015, 0.045], [0.05, 0.039], [0.088, 0.029], [0.125, 0.0295], [0.16, 0.0285], [0.185, 0.0255], // 0-9 outer
  [0.2, 0.026], [0.212, 0.013], [0.214, -0.004], [0.205, -0.02], // 10-13 elbow
  [0.185, -0.0265], [0.15, -0.03], [0.11, -0.031], [0.07, -0.03], [0.035, -0.028], [0.005, -0.027], // 14-19 inner
];
const FOREARM_F: P2[] = [
  [-0.012, 0.022], [0.028, 0.0255], [0.065, 0.0215], [0.1, 0.017], [0.132, 0.0145], [0.15, 0.0118], [0.158, 0.003], [0.157, -0.007], [0.149, -0.0135],
  [0.12, -0.0155], [0.08, -0.019], [0.04, -0.0225], [0.01, -0.0225], [-0.015, -0.02], [-0.026, -0.006], [-0.022, 0.012],
];
// Trunk half outline (the b side, x > 0) from the crotch up the side to the neck; mirrored for the a side. Its bottom
// is a small arch between the thighs. The ribcage stays inside the shoulder joints: the shoulders' width comes from
// the deltoid caps on the arms.
const TRUNK_FH: P2[] = [
  [-0.013, 0.0], [-0.022, 0.011], [-0.034, 0.022], [-0.022, 0.04], [0.004, 0.058], [0.028, 0.072], [0.05, 0.082],
  [0.075, 0.0795], [0.1, 0.0785], [0.13, 0.082], [0.165, 0.0895], [0.2, 0.0955], [0.23, 0.0985],
  [0.256, 0.0995], [0.278, 0.097], [0.297, 0.088], [0.314, 0.073], [0.327, 0.058], [0.337, 0.045], [0.347, 0.034],
];
// The back of the trunk seen from above (trunk tipped toward the camera): broad across the shoulder blades, narrowing to
// the waist and flaring a little into the hips, which run into the thighs over a small arch between them.
const TRUNK_BH: P2[] = [
  [-0.02, 0.0], [-0.028, 0.013], [-0.03, 0.032], [-0.018, 0.054], [0.002, 0.071], [0.028, 0.082], [0.062, 0.079], // 0-6 hips
  [0.1, 0.074], [0.14, 0.078], [0.175, 0.087], [0.21, 0.095], [0.24, 0.0985], [0.262, 0.0995], // 7-12 waist to armpit
  [0.28, 0.097], [0.297, 0.088], [0.318, 0.075], [0.336, 0.056], [0.352, 0.038], [0.364, 0.019], [0.37, 0.0], // 13-19 shoulder to neck
];
// Pectoralis: a fan from the sternum and clavicle whose lower border rises to a tendon passing under the deltoid.
const PEC_F: P2[] = [[0.283, 0.007], [0.292, 0.036], [0.29, 0.064], [0.28, 0.086], [0.266, 0.1], [0.25, 0.1], [0.232, 0.09], [0.214, 0.074], [0.199, 0.055], [0.19, 0.034], [0.188, 0.015], [0.193, 0.006]];
// Rectus abdominis (half, mirrored into one shape), split by the linea alba and three tendinous lines.
const RECTUS_FH: P2[] = [[0.193, 0.0], [0.195, 0.024], [0.185, 0.04], [0.15, 0.0455], [0.11, 0.0455], [0.07, 0.0425], [0.035, 0.035], [0.01, 0.024], [-0.012, 0.0]];
const RECTUS_F_LINES = [0.16, 0.126, 0.092];
// External oblique: one smooth shape per side, its upper edge scalloped by three serratus slips.
const OBLIQUE_F: P2[] = [
  [0.176, 0.053], [0.19, 0.062], [0.182, 0.067], [0.197, 0.075], [0.189, 0.08], [0.203, 0.087],
  [0.18, 0.0855], [0.15, 0.0785], [0.12, 0.0745], [0.095, 0.0735], [0.072, 0.0735], [0.054, 0.07],
  [0.038, 0.062], [0.024, 0.052], [0.014, 0.044], [0.034, 0.05], [0.07, 0.0515], [0.11, 0.0525], [0.15, 0.0525],
];
const LAT_F: P2[] = [[0.252, 0.095], [0.232, 0.0935], [0.208, 0.0905], [0.188, 0.0865], [0.204, 0.0845], [0.228, 0.087]];
const TRAP_F: P2[] = [...runOf(TRUNK_FH, 19, 15), [0.287, 0.08], [0.296, 0.067], [0.306, 0.054], [0.318, 0.043], [0.331, 0.033], [0.342, 0.026]];
// Seen from above: the trapezius diamond down the middle, the lats as wings along the sides to the waist, and the
// erector spinae either side of the spine in the lower back.
const TRAP_B: P2[] = [...runOf(TRUNK_BH, 18, 14), [0.296, 0.078], [0.282, 0.066], [0.262, 0.055], [0.238, 0.043], [0.21, 0.031], [0.182, 0.018], [0.16, 0.007], [0.15, 0.0]];
const LAT_B: P2[] = [...runOf(TRUNK_BH, 12, 6), [0.058, 0.066], [0.078, 0.056], [0.105, 0.052], [0.135, 0.057], [0.168, 0.067], [0.2, 0.079], [0.228, 0.09]];
const ERECTOR_B: P2[] = [[0.004, 0.006], [0.05, 0.0055], [0.1, 0.006], [0.15, 0.0075], [0.172, 0.009], [0.168, 0.019], [0.13, 0.023], [0.085, 0.024], [0.04, 0.023], [0.012, 0.018]];
const QUADS_F_RUN: P2[] = [...runOf(THIGH_F, 3, 7), [0.238, 0.022], [0.246, 0.004], [0.242, -0.016], ...runOf(THIGH_F, 14, 15)];
const QUADS_F_IN: P2[] = [[0.16, -0.033], [0.12, -0.022], [0.08, -0.01], [0.045, 0.002], [0.02, 0.014], [0.015, 0.03]];
// Gluteus medius at the outer hip, the calf's two heads either side of the shin.
const GLUTE_F: P2[] = [...runOf(THIGH_F, 0, 3), [0.068, 0.04], [0.07, 0.028], [0.045, 0.0165], [0.01, 0.0115], [-0.03, 0.0095], [-0.058, 0.0135]];
const CALF_FI: P2[] = [...runOf(SHIN_F, 18, 14), [0.15, -0.018], [0.11, -0.0165], [0.07, -0.0175], [0.035, -0.0195], [0.012, -0.024]];
const CALF_FO: P2[] = [...runOf(SHIN_F, 1, 4), [0.11, 0.0195], [0.07, 0.0185], [0.035, 0.0195], [0.01, 0.025]];
// Deltoid: a rounded cap over the shoulder joint tapering to its tip at mid-arm on the outer side, one split between
// the front and middle heads (seen from behind, the back and middle heads).
const DELT_F: P2[] = [[-0.044, -0.012], [-0.047, 0.01], [-0.039, 0.029], [-0.017, 0.041], [0.015, 0.0425], [0.048, 0.0365], [0.074, 0.024], [0.094, 0.011], [0.094, 0.011], [0.072, 0.001], [0.044, -0.011], [0.014, -0.022], [-0.014, -0.028], [-0.034, -0.024]];
const DELT_F_SPLIT: P2[][] = [[[0.086, 0.009], [0.056, 0.009], [0.026, 0.005], [-0.004, -0.002], [-0.03, -0.004]]];
const TRICEPS_F: P2[] = [...runOf(UARM_F, 6, 9), [0.197, 0.018], [0.18, 0.0115], [0.14, 0.0115], [0.1, 0.0135], [0.078, 0.02]];
const BICEPS_F: P2[] = [...runOf(UARM_F, 17, 14), [0.196, -0.014], [0.199, 0.0], [0.19, 0.0125], [0.165, 0.017], [0.13, 0.018], [0.095, 0.0155], [0.07, 0.006], [0.06, -0.012]];
// A front-view foot (pointing at the camera) around the ankle, its toes turned out by `out`.
const footF = (out: number): P2[] => [
  [-0.006, -0.0205], [0.012, -0.0235], [0.026, -0.021 + 0.35 * out], [0.0305, -0.016 + 0.6 * out], [0.0305, 0.018 + 0.85 * out],
  [0.025, 0.024 + 0.65 * out], [0.01, 0.0245], [-0.006, 0.0205],
];

const HEAD_F: P2[] = [
  [0.0, 0.0615], [0.03, 0.057], [0.046, 0.04], [0.05, 0.015], [0.048, -0.008], [0.043, -0.03], [0.033, -0.05], [0.018, -0.063], [0.0, -0.068],
  [-0.018, -0.063], [-0.033, -0.05], [-0.043, -0.03], [-0.048, -0.008], [-0.05, 0.015], [-0.046, 0.04], [-0.03, 0.057],
];
const HAIR_F: P2[] = [[0.05, 0.012], [0.046, 0.04], [0.03, 0.057], [0.0, 0.0615], [-0.03, 0.057], [-0.046, 0.04], [-0.05, 0.012], [-0.044, 0.016], [-0.038, 0.032], [-0.018, 0.04], [0.0, 0.041], [0.018, 0.04], [0.038, 0.032], [0.044, 0.016]];
/** The head bowed toward the floor, seen from the front and above: mostly crown, the forehead a band at the bottom. */
/** Brow and lowered eye in that band, squashed by the bow (drawn on both sides), so the face still reads as facing us. */
const FACE_BOWED: P2[][] = [
  [[0.008, -0.0475], [0.017, -0.045], [0.027, -0.047], [0.026, -0.049], [0.017, -0.0472], [0.009, -0.0495]],
  [[0.009, -0.0555], [0.017, -0.0535], [0.025, -0.0555], [0.017, -0.0575]],
];
const HAIR_TOP: P2[] = [[0.05, 0.012], [0.046, 0.04], [0.03, 0.057], [0.0, 0.0615], [-0.03, 0.057], [-0.046, 0.04], [-0.05, 0.012], [-0.048, -0.012], [-0.04, -0.03], [-0.02, -0.04], [0.0, -0.043], [0.02, -0.04], [0.04, -0.03], [0.048, -0.012]];
const EAR_F: P2[] = [[0.046, 0.008], [0.056, 0.01], [0.058, -0.004], [0.054, -0.02], [0.046, -0.022]];
/** Eyes and brows (drawn on both sides), then the nose and the mouth. */
const FACE_PAIR: P2[][] = [
  [[0.012, 0.007], [0.019, 0.0095], [0.026, 0.007], [0.019, 0.0045]],
  [[0.01, 0.017], [0.02, 0.0205], [0.03, 0.018], [0.029, 0.0155], [0.02, 0.0175], [0.011, 0.0145]],
];
const FACE_MID: P2[][] = [
  [[-0.004, -0.016], [0.0, -0.019], [0.004, -0.016], [0.0, -0.0145]],
  [[-0.011, -0.034], [0.0, -0.0365], [0.011, -0.034], [0.0, -0.0335]],
];
/** A trunk [t, x] list on the other side of the body. */
const mirror = (list: readonly P2[]): P2[] => list.map(([t, x]) => [t, -x]);
/** A head [x, y] list on the other side of the face. */
const mirrorFace = (list: readonly P2[]): P2[] => list.map(([x, y]) => [-x, y]);

/** The front-view trunk frame: t up from the hip line (foreshortened by k up to the shoulders), x toward side b. */
interface FrontTrunk {
  u: Vec;
  side: Vec;
  k: number;
  p(t: number, x: number): Vec;
}

/** A front-view limb segment: d > 0 is the outside of the body (`outer` = ±1 picks the side). */
const frontFrame = (o: Vec, tip: Vec, nominal: number, deg: number, outer: number) => boneFrame(o, tip, nominal, deg, (u) => mul(rot90(u), outer));

function frontLeg(s: Side, leg: Leg, outer: number, pal: Palette): string {
  const Th = frontFrame(s.hip, s.knee, 0.245, leg.thigh, outer);
  const Sh = frontFrame(s.knee, s.ankle, 0.246, leg.shin, outer);
  const thigh = mapped(Th, THIGH_F);
  const shin = mapped(Sh, SHIN_F);
  const foot = mapped(flatFrame(s.ankle, Sh.u, Sh.f, 1), footF(clamp(dot(sub(s.toe, s.heel), Sh.f), -0.06, 0.06)));
  let o = outline(arcOf(thigh, 0, 19) + closed(shin) + closed(foot), pal);
  o += skin(union([shin, foot]), pal);
  o += muscle(closed(mapped(Sh, CALF_FI)) + closed(mapped(Sh, CALF_FO)), pal.m('calves'), pal);
  o += skin(closed(thigh), pal);
  o += muscle(closed(mapped(Th, belly(QUADS_F_RUN, QUADS_F_IN, 1, 0.008 * pal.lv('quads')))), pal.m('quads'), pal);
  return o + muscle(closed(mapped(Th, GLUTE_F)), pal.m('glutes'), pal);
}

/** One arm; `side` is -1 for a (image left when upright), +1 for b. */
function frontArm(s: Side, arm: Required<Arm>, side: -1 | 1, outer: number, pal: Palette, TF: FrontTrunk): string {
  const Ua = frontFrame(s.shoulder, s.elbow, 0.186, arm.upper, outer);
  const Fa = frontFrame(s.elbow, s.wrist, 0.146, arm.fore, outer);
  const upper = mapped(Ua, UARM_F);
  const fore = mapped(Fa, FOREARM_F);
  const hu = unit(sub(s.hand, s.wrist), Fa.u);
  const fist = mapped(flatFrame(s.wrist, hu, mul(Fa.f, 0.8), 1), FIST); // seen from the front a fist is narrower
  let o = '';
  // Front fold of the armpit: once the arm is lifted away from the side (chest view only), the pectoral's tendon
  // is seen running from the chest into the arm.
  const lift = Math.atan2(dot(Ua.u, mul(TF.side, side)), dot(Ua.u, mul(TF.u, -1))) / RAD;
  if (lift > 25 && TF.k >= 0.7) {
    const A0 = TF.p(0.262, 0.096 * side);
    const A1 = TF.p(0.208, 0.094 * side);
    const A2 = Ua.p(0.075, -0.022);
    const fold = [A0, Ua.p(0.01, -0.02), A2, lerpV(A2, A1, 0.5), A1];
    o += outline(open([A2, lerpV(A2, A1, 0.5), A1]), pal) + muscle(closed(fold), pal.m('chest'), pal);
  }
  o += outline(closed(upper) + arcOf(fore, 0, 13), pal);
  o += skin(closed(fore), pal) + skin(closed(upper), pal);
  o += muscle(closed(mapped(Ua, TRICEPS_F)), pal.m('triceps'), pal);
  o += muscle(closed(mapped(Ua, BICEPS_F)), pal.m('biceps'), pal);
  o += muscle(closed(mapped(Ua, DELT_F)), pal.m('shoulders'), pal) + split(lines(Ua, DELT_F_SPLIT), pal);
  return o + solid(closed(fist), pal);
}

/** The trunk with the neck and head: a chest view, or the back seen from above when the trunk tips toward the camera. */
function frontTrunk(fig: BodyFigure, TF: FrontTrunk, back: boolean, pal: Palette): string {
  const Hf = headFrame(fig);
  const half = back ? TRUNK_BH : TRUNK_FH;
  const body = mapped(TF, [...half, ...mirror(half).reverse().slice(0, -1)]);
  const pair = (list: readonly P2[]) => union([mapped(TF, list), mapped(TF, mirror(list))]);
  const whole = (list: readonly P2[]) => closed(mapped(TF, [...list, ...mirror(list).reverse().slice(1, -1)]));
  const head = solid(closed(mapped(Hf, HEAD_F)), pal);
  const ears = path(closed(mapped(Hf, EAR_F)) + closed(mapped(Hf, mirrorFace(EAR_F))), `fill="${pal.skin}" stroke="${pal.line}" stroke-width="${num(W * 0.7)}"`);
  if (back) {
    return (
      solid(closed(body), pal) +
      muscle(pair(LAT_B) + whole(TRAP_B) + pair(ERECTOR_B), pal.m('back'), pal) +
      split(`M${coords([TF.p(0.16, 0)])}L${coords([TF.p(0.33, 0)])}`, pal, 0.004) +
      head +
      path(closed(mapped(Hf, HAIR_TOP)), 'fill="var(--fig-hair)"') +
      ears +
      path(FACE_BOWED.map((f) => closed(mapped(Hf, f)) + closed(mapped(Hf, mirrorFace(f)))).join(''), 'fill="var(--fig-face)"')
    );
  }
  const neck = [TF.p(0.27, 0.03), TF.p(0.3, 0.034), Hf.p(0.035, -0.03), Hf.p(0.031, -0.05), Hf.p(-0.031, -0.05), Hf.p(-0.035, -0.03), TF.p(0.3, -0.034), TF.p(0.27, -0.03)];
  let o = solid(union([body, neck]), pal);
  o += muscle(pair(TRAP_F) + pair(LAT_F), pal.m('back'), pal);
  o += muscle(pair(OBLIQUE_F) + whole(RECTUS_FH), pal.m('core'), pal);
  let abs = `M${coords([TF.p(0.188, 0)])}L${coords([TF.p(-0.004, 0)])}`;
  for (const t of RECTUS_F_LINES) abs += open([TF.p(t + 0.004, -0.044), TF.p(t - 0.006, -0.022), TF.p(t, 0)]) + open([TF.p(t, 0), TF.p(t - 0.006, 0.022), TF.p(t + 0.004, 0.044)]);
  o += split(abs, pal, 0.004);
  o += muscle(pair(PEC_F), pal.m('chest'), pal);
  o += head + path(closed(mapped(Hf, HAIR_F)), 'fill="var(--fig-hair)"') + ears;
  const features = FACE_PAIR.map((f) => closed(mapped(Hf, f)) + closed(mapped(Hf, mirrorFace(f)))).join('') + FACE_MID.map((f) => closed(mapped(Hf, f))).join('');
  return o + path(features, 'fill="var(--fig-face)"');
}

function drawFront(fig: BodyFigure, c: BodyContext): BodyLayers {
  const { pose, a, b } = fig;
  const Hm = mid(a.hip, b.hip);
  const Sm = mid(a.shoulder, b.shoulder);
  const v = sub(Sm, Hm);
  const L = len(v);
  const u = L > 1e-6 ? mul(v, 1 / L) : dir(pose.torso);
  let across = rot90(u);
  const hand = dot(across, sub(b.shoulder, a.shoulder)) < 0 ? -1 : 1;
  across = mul(across, hand);
  const k = L > 1e-6 ? clamp(L / 0.288, 0.2, 1.5) : 1;
  // t is foreshortened with the trunk all the way up: a trunk tipped toward the camera tips the neck too (see solve).
  const TF: FrontTrunk = { u, side: across, k, p: (t, x) => V(Hm.x + u.x * t * k + across.x * x, Hm.y + u.y * t * k + across.y * x) };
  const palA = palette(c, limbLevels(c, 'a'), false);
  const palB = palette(c, limbLevels(c, 'b'), false);
  const trunkPal = palette(c, c.level, false);
  const legs = frontLeg(b, pose.leg2, -hand, palB) + frontLeg(a, pose.leg, hand, palA);
  const arms = frontArm(b, pose.arm2, 1, -hand, palB, TF) + frontArm(a, pose.arm, -1, hand, palA, TF);
  // Tipped toward the camera the trunk turns from a chest view (k >= 0.8) into the back seen from above (k <= 0.6),
  // crossfading in between; the hips are then behind the trunk, so the legs go behind it.
  const chest = smooth((k - 0.6) / 0.2);
  if (chest >= 1) return { far: '', core: frontTrunk(fig, TF, false, trunkPal), nearLeg: legs, nearArm: arms };
  let core = frontTrunk(fig, TF, true, trunkPal);
  if (chest > 0) core += `<g opacity="${num(chest)}">${frontTrunk(fig, TF, false, trunkPal)}</g>`;
  return { far: legs, core, nearLeg: '', nearArm: arms };
}

export function drawBody(fig: BodyFigure, c: BodyContext): BodyLayers {
  return fig.view === 'front' ? drawFront(fig, c) : drawSide(fig, c);
}
