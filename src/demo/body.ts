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
//
// Two bodies, his and hers, are drawn by this same code on the same skeleton,
// each from its own shape set (MALE, FEMALE at the end of the file): the
// profiles, a few numbers, and for her limbs a warp that reshapes everything
// drawn in that limb's frame. Where a body rests on a floor, a bench or a pad
// her outline is his.
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
/** Which body to draw: the profile's body drawing. Both share the skeleton and the thickness (BODY). */
export type BodyKind = 'male' | 'female';

export interface BodyContext {
  /** Muscle levels; for a one-sided exercise these are the working side's. */
  level: Levels;
  /** Which body (default male). */
  body?: BodyKind;
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
  /** Front of the lower trunk (hip to waist): the belly is slimmer than the chest. */
  bellyFront: 0.062,
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
/**
 * A body's own contour for a limb: moves a profile point [t, d] before it is
 * mapped, so everything drawn in that limb's frame (its outline, its muscles,
 * the glute's seam on the thigh) follows the same shape. His limbs have none.
 */
type Warp = (t: number, d: number) => P2;
const flatFrame = (o: Vec, u: Vec, f: Vec, k: number, w?: Warp): Frame => ({
  u,
  f,
  k,
  p: (t, d) => {
    if (w) [t, d] = w(t, d);
    return V(o.x + u.x * t * k + f.x * d, o.y + u.y * t * k + f.y * d);
  },
});
/**
 * A limb segment from joint `o` to joint `tip`. The bone is scaled to its
 * apparent length, but whatever lies beyond either joint (the shoulder cap, the
 * elbow, the knee) keeps its true size, so a limb pointing at the camera ends
 * round and keeps its deltoid cap instead of shrinking to a sliver.
 */
function boneFrame(o: Vec, tip: Vec, nominal: number, deg: number, sideOf: (u: Vec) => Vec, w?: Warp): Frame {
  const v = sub(tip, o);
  const L = len(v);
  const u = L > 1e-6 ? mul(v, 1 / L) : dir(deg);
  const k = L > 1e-6 ? Math.min(L / nominal, 1.2) : 1;
  const f = sideOf(u);
  const along = (t: number) => (t <= 0 ? t : t >= nominal ? nominal * k + (t - nominal) : t * k);
  return {
    u,
    f,
    k,
    p: (t, d) => {
      if (w) [t, d] = w(t, d);
      return V(o.x + u.x * along(t) + f.x * d, o.y + u.y * along(t) + f.y * d);
    },
  };
}
/** Side view: d > 0 is the front of the segment (its direction - 90 degrees). */
const sideFrame = (o: Vec, tip: Vec, nominal: number, deg: number, w?: Warp) => boneFrame(o, tip, nominal, deg, (u) => V(u.y, -u.x), w);
const mapped = (F: { p(t: number, d: number): Vec }, list: readonly P2[]) => list.map(([t, d]) => F.p(t, d));
/** A profile pushed outward by w (lines that sit on the visible outline). */
const grow = (list: readonly P2[], w: number): P2[] => list.map(([t, d]) => [t, d + (d >= 0 ? w : -w)]);

/* ---------------- shape sets ---------------- */
/** The buttock's outline in side view (see glutes). */
interface GluteShape {
  /** Where it leaves the lower back, on the trunk's back contour, and two points of that contour giving its tangent. */
  sacrum: P2;
  contour: [P2, P2];
  /** How far it turns out from that tangent as it leaves the back (degrees): the shelf of a rounder buttock. */
  shelf: number;
  /** Where it meets the back of the thigh: q[0] + q[1] * flexion down the thigh, q[2] across it. */
  q: [number, number, number];
  /** The angle across the thigh it arrives at when standing, into the gluteal fold (degrees). */
  fold: number;
  /** Its apex: apex[0] - apex[1] * flexion out from the hip joint, and apex[2] * (1 - flexion) down the thigh. */
  apex: [number, number, number];
  /** Handles of the upper and the lower arc, as a share of the chord: larger is fuller. */
  handles: [number, number];
  /**
   * A fuller buttock relaxes as the hip bends: by flexion share `at` it has
   * become `to` (his), so a seat, a bench, a wall or the floor meets it where
   * it meets his.
   */
  relax?: { at: number; to: GluteShape };
}
/**
 * One body's shapes: every profile the drawing code maps, and the few numbers
 * it reads. Both bodies are drawn by the same code on the same skeleton and
 * rest on the same surfaces; his (MALE) are the tables in this file, hers
 * (FEMALE) differ in the contour between the places a body rests on.
 */
interface Shape {
  /** Limb contours (none: the tables as they are). Side view, then front view. */
  warp: { thigh?: Warp; shin?: Warp; foot?: Warp; toes?: Warp; upperArm?: Warp; forearm?: Warp; fist?: Warp; flatHand?: Warp; thighF?: Warp; shinF?: Warp; footF?: Warp; upperArmF?: Warp; forearmF?: Warp };
  /** Height of the top of the toe joint over the ball of the foot. */
  toeJoint: number;
  thighGroove: P2[][];
  glute: GluteShape;
  // Side-view trunk, its muscles, the neck and the head.
  trunk: P2[];
  /** How far the chest swells as the pectoral works, from trunk[chestFrom] on. */
  chestSwell: number[];
  chestFrom: number;
  /** The pectoral: a run of the trunk's front contour (indices), and its inner edge; inner points from pecDropFrom on drop as it works. */
  pecRun: [number, number];
  pecIn: P2[];
  pecDropFrom: number;
  pecSamples: P2[];
  backSamples: P2[];
  rectusRun: P2[];
  rectusIn: P2[];
  rectusSplits: P2[][];
  oblique: P2[];
  /** How far each oblique point moves as the core works. */
  obliqueSwell: number[];
  lat: P2[];
  erectors: P2[];
  upperBack: P2[];
  /** The neck: points on the trunk, on the head (head frame), then on the trunk again. */
  neck: { front: P2[]; head: P2[]; back: P2[] };
  /** The upper trapezius up the back of the neck: head point, trunk points, head point. */
  trap: { start: P2; trunk: P2[]; end: P2 };
  head: P2[];
  hair: P2[];
  /** The hair's colour (a theme token). */
  hairFill: string;
  /** The hair covers the tops of the ears: the ears are drawn before it. */
  earUnder?: boolean;
  /**
   * Hair tied back (head frame): drawn behind the neck, so only what lies past
   * its outline shows; `tie` is the band round it, `strands` a line or two
   * along it.
   */
  tail?: P2[];
  tie?: P2[];
  strands?: P2[][];
  face: P2[];
  ear: P2[];
  eye: P2[];
  brow: P2[];
  // Front view: trunk halves (chest, and the back seen from above), muscles, neck and head.
  trunkFH: P2[];
  trunkBH: P2[];
  pecF: P2[];
  rectusFH: P2[];
  /** The linea alba from t[0] down to t[1], and the tendinous lines across the rectus. */
  lineaF: [number, number];
  rectusFLines: number[];
  obliqueF: P2[];
  latF: P2[];
  trapF: P2[];
  trapB: P2[];
  latB: P2[];
  erectorB: P2[];
  /** Where the front fold of the armpit leaves the chest (two trunk points). */
  foldF: [P2, P2];
  neckF: { trunk: P2[]; head: P2[] };
  headF: P2[];
  /** Hair in front view, and on a head bowed toward the camera; `part` lines are partings (skin-coloured). */
  hairF: P2[];
  hairTop: P2[];
  partF?: P2[];
  partTop?: P2[];
  /**
   * Front view: the hair seen past the head and neck (at the temples, over the
   * ears, behind the jaw), drawn with an outline behind them so only that
   * part shows.
   */
  hairBackF?: P2[];
  /**
   * A bowed head: the hair seen past it (the knot of hair tied back, over the
   * ears), drawn with an outline behind the head. It and `partTop` fade out as
   * the chest view fades in.
   */
  knotTop?: P2[];
  faceBowed: P2[][];
  earF: P2[];
  facePair: P2[][];
  faceMid: P2[][];
}

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
const trunkProfile = (S: Shape, chest: number): P2[] => S.trunk.map(([t, d], i): P2 => [t, d + chest * (S.chestSwell[i - S.chestFrom] ?? 0)]);
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
const obliqueAt = (S: Shape, core: number): P2[] => S.oblique.map(([t, d], i): P2 => [t, d + core * (S.obliqueSwell[i] ?? 0)]);
/** His: the back border (5-10) by -0.006, the front edge (13-16, 0) by 0.003. */
const OBLIQUE_SWELL = OBLIQUE.map((_, i) => (i >= 5 && i <= 10 ? -0.006 : i >= 13 || i === 0 ? 0.003 : 0));
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
function glutes(hip: Vec, T: TrunkFrame, Th: Frame, G: GluteShape) {
  const flexion = clamp(wrap(angleOf(T.u1) + 180 - angleOf(Th.u)), -45, 170);
  const fl = clamp(flexion / 120, 0, 1);
  const opened = smooth(flexion / 70);
  const trunkBack = mul(T.f1, -1);
  const thighBack = mul(Th.f, -1);
  const wF = 0.5 - 0.25 * fl;
  const m = unit(add(mul(trunkBack, 1 - wF), mul(thighBack, wF)), trunkBack);
  // A fuller buttock (hers) becomes the leaner one (his) as the hip bends.
  const k = G.relax ? smooth(fl / G.relax.at) : 0;
  const R = G.relax?.to ?? G;
  const mix = (a: number, b: number) => a + (b - a) * k;
  const shelf = mix(G.shelf, R.shelf);
  const handles = [mix(G.handles[0], R.handles[0]), mix(G.handles[1], R.handles[1])];
  // S lies on the trunk's back contour (his: between TRUNK[24] and TRUNK[25]), leaving along the contour's own
  // tangent, or turned out from it into a shelf.
  const S = T.p(G.sacrum[0], G.sacrum[1]);
  let tS = unit(sub(T.p(G.contour[0][0], G.contour[0][1]), T.p(G.contour[1][0], G.contour[1][1])), mul(T.u1, -1));
  if (shelf) tS = unit(add(mul(tS, Math.cos(shelf * RAD)), mul(trunkBack, Math.sin(shelf * RAD))), tS);
  const tq = mix(G.q[0], R.q[0]) + mix(G.q[1], R.q[1]) * fl;
  const Q = Th.p(tq, mix(G.q[2], R.q[2]));
  // Arrival at Q: across the thigh into the fold when standing, along the thigh once the fold has opened.
  const beta = mix(G.fold, R.fold) * (1 - opened) * RAD;
  const tQ = unit(add(mul(Th.u, Math.cos(beta)), mul(Th.f, Math.sin(beta))), Th.u);
  const A = add(add(hip, mul(m, mix(G.apex[0], R.apex[0]) - mix(G.apex[1], R.apex[1]) * fl)), mul(Th.u, mix(G.apex[2], R.apex[2]) * (1 - fl)));
  let tA = rot90(m);
  if (dot(tA, sub(Q, S)) < 0) tA = mul(tA, -1);
  // Each arc's handles are a share of its chord: a larger share makes it fuller.
  const arc = (P0: Vec, t0: Vec, P3: Vec, t3: Vec, share: number): Vec[] => {
    const h = share * len(sub(P3, P0));
    const P1 = add(P0, mul(t0, h));
    const P2 = sub(P3, mul(t3, h));
    return [0.2, 0.4, 0.6, 0.8, 1].map((t) => cubic(P0, P1, P2, P3, t));
  };
  const curve = [S, ...arc(S, tS, A, tA, handles[0]), ...arc(A, tA, Q, tQ, handles[1])];
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
function footOutline(s: Side, leg: Leg, S: Shape): Vec[] {
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
  const F = flatFrame(heel, u, up, Lf > 1e-6 ? Lf / 0.102 : 1, S.warp.foot);
  const toes = flatFrame(ball, u2, up2, 1, S.warp.toes);
  const bisector = unit(add(up, up2), up);
  const c = Math.max(0.5, Math.cos(bend / 2));
  return [
    F.p(0.012, W), F.p(0.05, W + 0.001), F.p(0.084, W),
    add(ball, mul(bisector, W / c)), // the ball's pad, where the two parts of the sole meet
    toes.p(0.016, W), toes.p(0.031, W + 0.0005), toes.p(0.04, 0.006), toes.p(0.035, 0.0125), toes.p(0.017, 0.0145),
    add(ball, mul(bisector, Math.min(0.03, S.toeJoint / c))), // top of the toe joint
    F.p(0.074, 0.029), F.p(0.05, 0.043), F.p(0.034, 0.058), F.p(0.012, 0.064), F.p(-0.006, 0.047), F.p(-0.016, 0.026), F.p(-0.012, 0.009),
  ];
}

function sideLeg(s: Side, leg: Leg, T: TrunkFrame, pal: Palette, S: Shape): string {
  const Th = sideFrame(s.hip, s.knee, 0.245, leg.thigh, S.warp.thigh);
  const Sh = sideFrame(s.knee, s.ankle, 0.246, leg.shin, S.warp.shin);
  const thigh = mapped(Th, THIGH);
  const shin = mapped(Sh, SHIN);
  const foot = footOutline(s, leg, S);
  const g = glutes(s.hip, T, Th, S.glute);
  let o = outline(arcOf(thigh, 1, 18) + closed(shin) + closed(foot) + open(g.curve), pal);
  o += skin(union([shin, foot]), pal);
  o += muscle(closed(mapped(Sh, SOLEUS)) + closed(mapped(Sh, belly(GASTRO_RUN, GASTRO_IN, -1, 0.006 * pal.lv('calves')))), pal.m('calves'), pal);
  o += skin(union([thigh, g.blob]), pal);
  o += outline(arcOf(mapped(Th, grow(THIGH, W / 2)), 11, 15), pal, W); // the kneecap's lower edge
  o += muscle(closed(mapped(Th, belly(HAMS_RUN, HAMS_IN, -1, 0.007 * pal.lv('hamstrings')))), pal.m('hamstrings'), pal);
  o += muscle(closed(mapped(Th, belly(QUADS_RUN, QUADS_IN, 1, 0.011 * pal.lv('quads')))), pal.m('quads'), pal);
  o += crease(lines(Th, S.thighGroove));
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
function armShape(s: Side, arm: Required<Arm>, S: Shape): ArmShape {
  const Ua = sideFrame(s.shoulder, s.elbow, 0.186, arm.upper, S.warp.upperArm);
  const Fa = sideFrame(s.elbow, s.wrist, 0.146, arm.fore, S.warp.forearm);
  const flex = elbowFlex(Ua, Fa);
  const prof = upperArmProfile(flex);
  let H: Frame;
  if (arm.flat) {
    // Palm down on the surface, fingers pointing `hand`, the palm on the side away from the elbow.
    const u = dir(arm.hand);
    let toPalm = V(u.y, -u.x);
    const side = dot(toPalm, sub(s.elbow, s.wrist));
    if (Math.abs(side) < 1e-4 ? dot(toPalm, Fa.f) < 0 : side > 0) toPalm = mul(toPalm, -1);
    H = flatFrame(s.wrist, u, toPalm, 1, S.warp.flatHand);
  } else {
    const u = unit(sub(s.hand, s.wrist), Fa.u);
    H = flatFrame(s.wrist, u, V(u.y, -u.x), 1, S.warp.fist);
  }
  return { Ua, Fa, H, flex, prof, upper: mapped(Ua, prof), fore: mapped(Fa, FOREARM), hand: mapped(H, arm.flat ? FLAT_HAND : FIST) };
}
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

/** How far either side of the arm's edge a sample point eases from shown to hidden, so coverage changes smoothly. */
const COVER_EDGE = 0.012;

/** Share of a trunk region (its sample points) hidden behind the near arm, easing across the arm's edge so it never jumps between frames. */
function covered(T: TrunkFrame, s: Side, samples: readonly P2[]): number {
  const parts: [Vec, Vec, number][] = [[s.shoulder, s.elbow, 0.036], [s.elbow, s.wrist, 0.026], [s.wrist, s.hand, 0.026]];
  let hidden = 0;
  for (const [t, d] of samples) {
    const q = T.p(t, d);
    // How deep inside the nearest arm part the point lies (negative outside it).
    const depth = Math.max(...parts.map(([a, b, r]) => r - distToSegment(q, a, b)));
    hidden += smooth((depth + COVER_EDGE) / (2 * COVER_EDGE));
  }
  return hidden / samples.length;
}

function sideHead(fig: BodyFigure, pal: Palette, S: Shape): string {
  const Hf = headFrame(fig);
  const ear = path(closed(mapped(Hf, S.ear)), `fill="${pal.skin}" stroke="${pal.line}" stroke-width="${num(W * 0.7)}"`);
  return (
    solid(closed(mapped(Hf, S.head)), pal) +
    (S.earUnder ? ear : '') +
    path(closed(mapped(Hf, S.hair)), `fill="${S.hairFill}"`) +
    (S.earUnder ? '' : ear) +
    path(closed(mapped(Hf, S.eye)) + closed(mapped(Hf, S.brow)), 'fill="var(--fig-face)"')
  );
}
/** Hair that lies past the outline of the head or neck: drawn behind them with its own outline. */
const hairMass = (d: string, S: Shape, pal: Palette, fade = 1) =>
  path(d, `fill="${S.hairFill}" stroke="${pal.line}" stroke-width="${num(2 * W)}" stroke-linejoin="round" paint-order="stroke"${fade < 1 ? ` opacity="${num(fade)}"` : ''}`);

function sideTrunk(fig: BodyFigure, T: TrunkFrame, pal: Palette, S: Shape): string {
  const Hf = headFrame(fig);
  const neck = [...mapped(T, S.neck.front), ...mapped(Hf, S.neck.head), ...mapped(T, S.neck.back)];
  const ch = pal.lv('chest');
  const prof = trunkProfile(S, ch);
  // Hair tied back lies behind the neck: painted first, so the neck and the trunk cover all but what shows past them.
  let o = S.tail ? hairMass(closed(mapped(Hf, S.tail)), S, pal) : '';
  if (S.strands) o += path(S.strands.map((l) => open(mapped(Hf, l))).join(''), 'fill="none" stroke="var(--fig-face)" stroke-opacity=".5" stroke-width=".0022" stroke-linecap="round"');
  if (S.tie) o += split(open(mapped(Hf, S.tie)), pal, 0.0042);
  o += solid(union([mapped(T, prof), neck]), pal);
  // Back: erectors, scapular back, the lat wing, and the upper trapezius running up the back of the neck.
  const trapezius = [Hf.p(S.trap.start[0], S.trap.start[1]), ...mapped(T, S.trap.trunk), Hf.p(S.trap.end[0], S.trap.end[1])];
  o += muscle(closed(mapped(T, S.erectors)) + closed(mapped(T, S.upperBack)) + closed(mapped(T, S.lat)) + closed(trapezius), pal.m('back'), pal);
  // Core: the external oblique on the flank, the rectus along the front with its tendinous lines.
  const core = pal.lv('core');
  o += muscle(closed(mapped(T, obliqueAt(S, core))) + closed(mapped(T, belly(S.rectusRun, S.rectusIn, 1, 0.009 * core))), pal.m('core'), pal);
  o += split(S.rectusSplits.map((l) => open(mapped(T, l))).join(''), pal, 0.0042);
  // Chest: the pectoral's lower border drops a little as it works.
  const pecIn = S.pecIn.map(([t, d], i): P2 => (i >= S.pecDropFrom ? [t - 0.012 * ch, d - 0.004 * ch] : [t, d]));
  o += muscle(closed(mapped(T, [...runOf(prof, S.pecRun[0], S.pecRun[1]), ...pecIn])), pal.m('chest'), pal);
  return o + sideHead(fig, pal, S);
}

/**
 * The near arm is nearer the camera than the head, so it is painted over it.
 * While it is raised beside the head the face is drawn again over it, as if
 * the head were just through the arms, so the figure never reads as
 * headless; that switches only as the arm comes up past the shoulder or
 * moves away from the head, where the arm is clear of the face, so it never
 * pops mid-press. An arm muscle the face would cover that is doing the main
 * work (the triceps in an overhead extension) is painted back over the face,
 * fading in as it becomes the hardest-working muscle.
 */
function faceOverArm(fig: BodyFigure, s: Side, A: ArmShape, pal: Palette, armPal: Palette, S: Shape): string {
  const near = Math.min(distToSegment(fig.head, s.shoulder, s.elbow), distToSegment(fig.head, s.elbow, s.wrist), distToSegment(fig.head, s.wrist, s.hand));
  const raised = dot(sub(s.elbow, s.shoulder), dir(fig.pose.torso + fig.pose.bend)) > 0.02;
  if (near > 0.085 || !raised) return '';
  const Hf = headFrame(fig);
  let o = solid(closed(mapped(Hf, S.face)), pal) + path(closed(mapped(Hf, S.eye)) + closed(mapped(Hf, S.brow)), 'fill="var(--fig-face)"');
  const hardest = Math.max(...MUSCLE_GROUPS.map((g) => pal.lv(g)));
  const seen = 1 - 2 * endOnOf(A);
  for (const g of ['triceps', 'biceps'] as const) {
    const show = seen * smooth((armPal.lv(g) - hardest + 0.1) / 0.1);
    if (show > 0.01 && armPal.lv(g) > 0.05) o += armMuscle(A, g, armPal, show);
  }
  return o;
}

const samePoint = (p: Vec, q: Vec) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) < 2e-4;

function drawSide(fig: BodyFigure, c: BodyContext, S: Shape): BodyLayers {
  const { pose, a, b } = fig;
  const nearPal = palette(c, limbLevels(c, 'a'), false);
  const farPal = palette(c, limbLevels(c, 'b'), true);
  const trunkPal = palette(c, c.level, false);
  const T = trunkFrame(a.hip, fig.waist, a.shoulder, pose.torso, pose.bend);
  // The far limbs are drawn only where they show (not hidden exactly behind the near ones).
  const legHidden = (['hip', 'knee', 'ankle', 'heel', 'ball', 'toe'] as const).every((k) => samePoint(a[k], b[k]));
  const armHidden = (['shoulder', 'elbow', 'wrist', 'hand'] as const).every((k) => samePoint(a[k], b[k])) && pose.arm.flat === pose.arm2.flat;
  // When the near arm covers most of the chest or of a working back, that muscle's tendon is drawn onto the arm.
  // A back that only steadies (a good morning's, at most 0.5) keeps its fold off the arm.
  const pecTail = smooth((covered(T, a, S.pecSamples) - 0.3) / 0.4) * smooth(trunkPal.lv('chest') / 0.3);
  const backTail = smooth((covered(T, a, S.backSamples) - 0.3) / 0.4) * smooth((trunkPal.lv('back') - 0.5) / 0.25);
  const nearArm = armShape(a, pose.arm, S);
  return {
    far: (armHidden ? '' : sideArm(armShape(b, pose.arm2, S), pose.arm2, farPal)) + (legHidden ? '' : sideLeg(b, pose.leg2, T, farPal, S)),
    core: sideTrunk(fig, T, trunkPal, S),
    nearLeg: sideLeg(a, pose.leg, T, nearPal, S),
    nearArm: sideArm(nearArm, pose.arm, nearPal, pecTail, backTail) + faceOverArm(fig, a, nearArm, trunkPal, nearPal, S),
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
const frontFrame = (o: Vec, tip: Vec, nominal: number, deg: number, outer: number, w?: Warp) => boneFrame(o, tip, nominal, deg, (u) => mul(rot90(u), outer), w);

function frontLeg(s: Side, leg: Leg, outer: number, pal: Palette, S: Shape): string {
  const Th = frontFrame(s.hip, s.knee, 0.245, leg.thigh, outer, S.warp.thighF);
  const Sh = frontFrame(s.knee, s.ankle, 0.246, leg.shin, outer, S.warp.shinF);
  const thigh = mapped(Th, THIGH_F);
  const shin = mapped(Sh, SHIN_F);
  const foot = mapped(flatFrame(s.ankle, Sh.u, Sh.f, 1, S.warp.footF), footF(clamp(dot(sub(s.toe, s.heel), Sh.f), -0.06, 0.06)));
  let o = outline(arcOf(thigh, 0, 19) + closed(shin) + closed(foot), pal);
  o += skin(union([shin, foot]), pal);
  o += muscle(closed(mapped(Sh, CALF_FI)) + closed(mapped(Sh, CALF_FO)), pal.m('calves'), pal);
  o += skin(closed(thigh), pal);
  o += muscle(closed(mapped(Th, belly(QUADS_F_RUN, QUADS_F_IN, 1, 0.008 * pal.lv('quads')))), pal.m('quads'), pal);
  return o + muscle(closed(mapped(Th, GLUTE_F)), pal.m('glutes'), pal);
}

/** One arm; `side` is -1 for a (image left when upright), +1 for b. */
function frontArm(s: Side, arm: Required<Arm>, side: -1 | 1, outer: number, pal: Palette, TF: FrontTrunk, S: Shape): string {
  const Ua = frontFrame(s.shoulder, s.elbow, 0.186, arm.upper, outer, S.warp.upperArmF);
  const Fa = frontFrame(s.elbow, s.wrist, 0.146, arm.fore, outer, S.warp.forearmF);
  const upper = mapped(Ua, UARM_F);
  const fore = mapped(Fa, FOREARM_F);
  const hu = unit(sub(s.hand, s.wrist), Fa.u);
  const fist = mapped(flatFrame(s.wrist, hu, mul(Fa.f, 0.8), 1, S.warp.fist), FIST); // seen from the front a fist is narrower
  let o = '';
  // Front fold of the armpit: once the arm is lifted away from the side (chest view only), the pectoral's tendon
  // is seen running from the chest into the arm.
  const lift = Math.atan2(dot(Ua.u, mul(TF.side, side)), dot(Ua.u, mul(TF.u, -1))) / RAD;
  if (lift > 25 && TF.k >= 0.7) {
    const A0 = TF.p(S.foldF[0][0], S.foldF[0][1] * side);
    const A1 = TF.p(S.foldF[1][0], S.foldF[1][1] * side);
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

/**
 * The trunk with the neck and head: a chest view, or the back seen from above
 * when the trunk tips toward the camera. While the two crossfade, the hair
 * only the bowed view shows (its parting, the knot) is drawn at `fade`, so
 * none of it shows through the chest view's face.
 */
function frontTrunk(fig: BodyFigure, TF: FrontTrunk, back: boolean, pal: Palette, S: Shape, fade = 1): string {
  const Hf = headFrame(fig);
  const half = back ? S.trunkBH : S.trunkFH;
  const body = mapped(TF, [...half, ...mirror(half).reverse().slice(0, -1)]);
  const pair = (list: readonly P2[]) => union([mapped(TF, list), mapped(TF, mirror(list))]);
  const whole = (list: readonly P2[]) => closed(mapped(TF, [...list, ...mirror(list).reverse().slice(1, -1)]));
  const head = solid(closed(mapped(Hf, S.headF)), pal);
  const ears = path(closed(mapped(Hf, S.earF)) + closed(mapped(Hf, mirrorFace(S.earF))), `fill="${pal.skin}" stroke="${pal.line}" stroke-width="${num(W * 0.7)}"`);
  const hair = (list: readonly P2[], part?: P2[], partFade = 1) =>
    (S.earUnder ? ears : '') +
    path(closed(mapped(Hf, list)), `fill="${S.hairFill}"`) +
    (part ? path(open(mapped(Hf, part)), `fill="none" stroke="${pal.skin}" stroke-width="${num(0.0025)}" stroke-linecap="round"${partFade < 1 ? ` opacity="${num(partFade)}"` : ''}`) : '') +
    (S.earUnder ? '' : ears);
  if (back) {
    return (
      solid(closed(body), pal) +
      muscle(pair(S.latB) + whole(S.trapB) + pair(S.erectorB), pal.m('back'), pal) +
      split(`M${coords([TF.p(0.16, 0)])}L${coords([TF.p(0.33, 0)])}`, pal, 0.004) +
      (S.knotTop ? hairMass(closed(mapped(Hf, S.knotTop)), S, pal, fade) : '') +
      head +
      hair(S.hairTop, S.partTop, fade) +
      path(S.faceBowed.map((f) => closed(mapped(Hf, f)) + closed(mapped(Hf, mirrorFace(f)))).join(''), 'fill="var(--fig-face)"')
    );
  }
  const N = S.neckF;
  const neck = [...mapped(TF, N.trunk), ...mapped(Hf, N.head), ...mapped(Hf, mirrorFace(N.head).reverse()), ...mapped(TF, mirror(N.trunk).reverse())];
  let o = S.hairBackF ? hairMass(closed(mapped(Hf, S.hairBackF)), S, pal) : '';
  o += solid(union([body, neck]), pal);
  o += muscle(pair(S.trapF) + pair(S.latF), pal.m('back'), pal);
  o += muscle(pair(S.obliqueF) + whole(S.rectusFH), pal.m('core'), pal);
  let abs = `M${coords([TF.p(S.lineaF[0], 0)])}L${coords([TF.p(S.lineaF[1], 0)])}`;
  for (const t of S.rectusFLines) abs += open([TF.p(t + 0.004, -0.044), TF.p(t - 0.006, -0.022), TF.p(t, 0)]) + open([TF.p(t, 0), TF.p(t - 0.006, 0.022), TF.p(t + 0.004, 0.044)]);
  o += split(abs, pal, 0.004);
  o += muscle(pair(S.pecF), pal.m('chest'), pal);
  o += head + hair(S.hairF, S.partF);
  const features = S.facePair.map((f) => closed(mapped(Hf, f)) + closed(mapped(Hf, mirrorFace(f)))).join('') + S.faceMid.map((f) => closed(mapped(Hf, f))).join('');
  return o + path(features, 'fill="var(--fig-face)"');
}

function drawFront(fig: BodyFigure, c: BodyContext, S: Shape): BodyLayers {
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
  const legs = frontLeg(b, pose.leg2, -hand, palB, S) + frontLeg(a, pose.leg, hand, palA, S);
  const arms = frontArm(b, pose.arm2, 1, -hand, palB, TF, S) + frontArm(a, pose.arm, -1, hand, palA, TF, S);
  // Tipped toward the camera the trunk turns from a chest view (k >= 0.8) into the back seen from above (k <= 0.6),
  // crossfading in between; the hips are then behind the trunk, so the legs go behind it.
  const chest = smooth((k - 0.6) / 0.2);
  if (chest >= 1) return { far: '', core: frontTrunk(fig, TF, false, trunkPal, S), nearLeg: legs, nearArm: arms };
  let core = frontTrunk(fig, TF, true, trunkPal, S, (1 - chest) ** 2);
  if (chest > 0) core += `<g opacity="${num(chest)}">${frontTrunk(fig, TF, false, trunkPal, S)}</g>`;
  return { far: legs, core, nearLeg: '', nearArm: arms };
}

/* =========================================================================
   SHAPE SETS
   ========================================================================= */
const GLUTE: GluteShape = { sacrum: [0.063, -0.058], contour: [[0.048, -0.062], [0.078, -0.054]], shelf: 0, q: [0.072, 0.08, -0.0462], fold: 72, apex: [0.0805, 0.004, 0.018], handles: [0.4, 0.4] };
const MALE: Shape = {
  warp: {},
  toeJoint: 0.0175,
  thighGroove: THIGH_GROOVE,
  glute: GLUTE,
  trunk: TRUNK,
  chestSwell: CHEST_SWELL,
  chestFrom: 6,
  pecRun: [6, 11],
  pecIn: PEC_IN,
  pecDropFrom: 4,
  pecSamples: PEC_SAMPLES,
  backSamples: BACK_SAMPLES,
  rectusRun: RECTUS_RUN,
  rectusIn: RECTUS_IN,
  rectusSplits: RECTUS_LINES.map(([t0, t1, d1]): P2[] => [[t0, 0.04], [t1, 0.051], [t1 - 0.001, d1]]),
  oblique: OBLIQUE,
  obliqueSwell: OBLIQUE_SWELL,
  lat: LAT,
  erectors: ERECTORS,
  upperBack: UPPER_BACK,
  neck: { front: [[0.265, 0.02], [0.29, 0.034]], head: [[0.028, -0.066], [0.018, -0.04], [-0.02, -0.03], [-0.034, -0.042]], back: [[0.33, -0.036], [0.3, -0.04]] },
  trap: { start: [-0.031, -0.04], trunk: [[0.334, -0.031], [0.322, -0.043], [0.304, -0.03], [0.298, -0.014], [0.305, 0.0]], end: [-0.012, -0.05] },
  head: HEAD,
  hair: HAIR,
  hairFill: 'var(--fig-hair)',
  face: FACE,
  ear: EAR,
  eye: EYE,
  brow: BROW,
  trunkFH: TRUNK_FH,
  trunkBH: TRUNK_BH,
  pecF: PEC_F,
  rectusFH: RECTUS_FH,
  lineaF: [0.188, -0.004],
  rectusFLines: RECTUS_F_LINES,
  obliqueF: OBLIQUE_F,
  latF: LAT_F,
  trapF: TRAP_F,
  trapB: TRAP_B,
  latB: LAT_B,
  erectorB: ERECTOR_B,
  foldF: [[0.262, 0.096], [0.208, 0.094]],
  neckF: { trunk: [[0.27, 0.03], [0.3, 0.034]], head: [[0.035, -0.03], [0.031, -0.05]] },
  headF: HEAD_F,
  hairF: HAIR_F,
  hairTop: HAIR_TOP,
  faceBowed: FACE_BOWED,
  earF: EAR_F,
  facePair: FACE_PAIR,
  faceMid: FACE_MID,
};

/* ---------------- her shapes ----------------
   The same skeleton and the same resting surfaces as his: her back contour,
   her lower belly, the glutes' reach from the hip, the thighs' and shins'
   extents, the backs of the arms, the palms, soles and the back and top of the
   head match his. She differs in between: a bust within his chest depth, its
   fullest point lower, a straight slope above it and its underside curving
   back to the ribs; a narrower waist; rounder glutes with a higher shelf;
   thighs full at the hip; a slimmer neck with a lower trapezius line, slimmer
   fronts of the arms and calves; smaller hands and feet; a softer face; hair
   swept over the tops of the ears and tied back in a low ponytail that fills
   the hollow behind the neck (seen from the front, the hair shows past the
   head at the temples and behind the jaw), in a hair colour of her own. Her
   muscles have fewer definition lines but light as much as his. */

/** A piecewise-linear factor along a bone: [t, factor] stops, held flat past the ends. */
function ramp(stops: readonly P2[]): (t: number) => number {
  return (t) => {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, k0] = stops[i - 1];
        const [t1, k1] = stops[i];
        return k0 + ((k1 - k0) * (t - t0)) / (t1 - t0);
      }
    }
    return stops[stops.length - 1][1];
  };
}
/** Scales a limb across the bone: one factor ramp for the d >= 0 side, one for the other; `cap` shortens what lies above the joint (t < 0). */
function slim(pos: readonly P2[], neg: readonly P2[], cap = 1): Warp {
  const kp = ramp(pos);
  const kn = ramp(neg);
  return (t, d) => [t < 0 ? t * cap : t, d * (d >= 0 ? kp(t) : kn(t))];
}
/** Scales a hand about the point it holds or presses with. */
const handScale = (t0: number, k: number, kd = k, palm = false): Warp => (t, d) => [t0 + (t - t0) * k, palm && d > 0 ? d : d * kd];

// Side-view trunk: his lower belly (lying face down on a pad it rests where his does), a waist a little flatter than
// his up to the fold under the bust (6), then the bust: a broad front (7-8) whose fullest point is lower than his,
// and above it a straight slope up to the collarbone (9-12), all within his chest. Fitted to the tilts at which a push-up's bottom, a bench pad or a lying leg curl
// meets it, so lying on the chest it rests where he does, never deeper. The neck base (16-17) is lower and slimmer;
// the back (18-27) and the seat are his, so she lies on benches and floors where he does.
const TRUNK_W: P2[] = [
  [-0.05, 0.028], [-0.02, 0.043], [0.02, 0.0485], [0.062, 0.0532], [0.102, 0.0555], [0.14, 0.059], // 0-5 belly and waist
  [0.161, 0.0582], [0.189, 0.0753], [0.2065, 0.0806], [0.231, 0.0786], [0.2435, 0.0725], [0.2655, 0.0585], [0.288, 0.043], [0.296, 0.032], // 6-13 bust, chest
  [0.31, 0.012], [0.322, -0.012], [0.324, -0.027], // 14-16 neck base
  [0.314, -0.043], [0.296, -0.0595], [0.268, -0.0685], [0.238, -0.0725], [0.205, -0.071], [0.172, -0.0645], [0.14, -0.057], // 17-23
  [0.108, -0.0515], [0.078, -0.054], [0.048, -0.062], [0.015, -0.067], // 24-27 back
  [-0.02, -0.06], [-0.045, -0.035], [-0.058, -0.005], // 28-30 seat
];
// The chest group covers the pectoral and the bust over it: from the fold under the bust up to the collarbone, its
// inner edge running down to the armpit (a little deeper than his, as her bust's upper slope is less full than his
// chest) and round under the bust.
const PEC_IN_W: P2[] = [[0.293, 0.031], [0.288, 0.016], [0.276, 0.003], [0.256, -0.005], [0.234, -0.002], [0.212, 0.01], [0.193, 0.028], [0.178, 0.044], [0.168, 0.054]];
// The external oblique as his, up under the bust fold, with a smooth upper edge.
const OBLIQUE_W: P2[] = [
  [0.166, 0.0375], [0.183, 0.032], [0.191, 0.023], [0.187, 0.0155], [0.173, 0.011],
  [0.148, 0.004], [0.124, -0.005], [0.106, -0.014], [0.098, -0.019],
  [0.094, -0.006], [0.096, 0.008], [0.09, 0.02], [0.078, 0.0285],
  [0.1, 0.0315], [0.125, 0.0335], [0.145, 0.0345], [0.157, 0.036],
];
// Head: his skull (the back and top rest on benches and floors), a rounder forehead, a softer brow, a smaller nose
// tipped up a little, fuller lips, a smaller chin and a softer jaw.
const HEAD_W: P2[] = [
  [-0.036, -0.036], [-0.056, -0.018], [-0.063, 0.012], [-0.055, 0.039], [-0.032, 0.0575], [-0.002, 0.0625], [0.027, 0.0565],
  [0.0465, 0.0405], [0.0515, 0.019], [0.0495, 0.0075], [0.0555, -0.005], [0.0635, -0.0155], [0.0515, -0.0205], [0.0562, -0.0282],
  [0.0488, -0.0342], [0.0515, -0.0402], [0.0455, -0.0472], [0.048, -0.0555], [0.036, -0.0635], [0.012, -0.057], [-0.011, -0.045],
  [-0.016, -0.033],
];
// Hair drawn back from a rounded hairline at the temple, over the tops of the ears, to the nape.
const HAIR_W: P2[] = [
  [0.038, 0.0465], [0.027, 0.0565], [-0.002, 0.0625], [-0.032, 0.0575], [-0.055, 0.039], [-0.063, 0.012], [-0.056, -0.018], [-0.044, -0.031],
  [-0.036, -0.026], [-0.03, -0.014], [-0.027, -0.003], [-0.02, 0.004], [-0.008, 0.0065], [0.004, 0.0055], [0.012, 0.0065], [0.017, 0.013],
  [0.0205, 0.026], [0.027, 0.0365], [0.033, 0.0435],
];
// The ponytail: tied at the nape and filling the hollow behind the neck, its back edge never past the line from the back
// of the skull to the upper back, so lying on a bench or the floor it rests where the head does.
const TAIL_W: P2[] = [
  [-0.052, 0.0], [-0.059, -0.014], [-0.0605, -0.03], [-0.0605, -0.048], [-0.0598, -0.066], [-0.0575, -0.083], [-0.052, -0.098], [-0.044, -0.108],
  [-0.036, -0.1], [-0.029, -0.084], [-0.026, -0.064], [-0.027, -0.046], [-0.032, -0.03], [-0.04, -0.014],
];
const FACE_W: P2[] = [
  [0.03, 0.046], [0.0465, 0.0405], [0.0515, 0.019], [0.0495, 0.0075], [0.0555, -0.005], [0.0635, -0.0155], [0.0515, -0.0205], [0.0562, -0.0282],
  [0.0488, -0.0342], [0.0515, -0.0402], [0.0455, -0.0472], [0.048, -0.0555], [0.036, -0.0635], [0.012, -0.057], [0.0, -0.048], [0.004, -0.02], [0.012, 0.012], [0.018, 0.036],
];
/** The eye with a flick of lashes at its front; a finer, arched brow. */
const EYE_W: P2[] = [[0.0295, 0.0095], [0.0362, 0.0128], [0.0425, 0.0108], [0.0462, 0.0128], [0.0432, 0.0088], [0.0365, 0.006]];
const BROW_W: P2[] = [[0.026, 0.0215], [0.036, 0.0255], [0.0465, 0.0225], [0.046, 0.0205], [0.036, 0.0235], [0.027, 0.0195]];

// Front view: a narrower ribcage and waist, the hips flaring from the iliac crest (no wider than his at the outer
// hip, which rests on the floor lying on the side), slimmer shoulders and neck.
const TRUNK_FH_W: P2[] = [
  [-0.013, 0.0], [-0.022, 0.011], [-0.034, 0.024], [-0.024, 0.048], [0.0, 0.08], [0.022, 0.0945], [0.045, 0.095],
  [0.07, 0.086], [0.095, 0.073], [0.12, 0.0675], [0.15, 0.072], [0.18, 0.0795], [0.21, 0.085], [0.235, 0.088],
  [0.256, 0.089], [0.276, 0.088], [0.294, 0.082], [0.309, 0.068], [0.321, 0.053], [0.33, 0.041], [0.338, 0.028],
];
// Seen from above: a narrower back, a small waist and rounder hips.
const TRUNK_BH_W: P2[] = [
  [-0.02, 0.0], [-0.03, 0.014], [-0.034, 0.036], [-0.022, 0.06], [0.0, 0.079], [0.028, 0.088], [0.058, 0.082],
  [0.095, 0.068], [0.13, 0.07], [0.165, 0.078], [0.2, 0.085], [0.232, 0.089], [0.258, 0.09],
  [0.278, 0.088], [0.296, 0.081], [0.316, 0.069], [0.335, 0.052], [0.351, 0.035], [0.363, 0.018], [0.37, 0.0],
];
// The chest group as two rounded shapes over the bust, close at the sternum: a straight top along the collarbone,
// narrowing into the armpit, and below it a full round bowl whose lowest point is near its middle, curving up to the
// sternum on the inside, so the pair reads as a bust.
const PEC_F_W: P2[] = [
  [0.282, 0.009], [0.289, 0.03], [0.287, 0.052], [0.274, 0.07], [0.255, 0.082], [0.232, 0.0875], [0.208, 0.0875], [0.189, 0.0815],
  [0.175, 0.068], [0.167, 0.049], [0.17, 0.03], [0.181, 0.017], [0.199, 0.01], [0.232, 0.0085], [0.262, 0.0085],
];
// The abdominals below the bust: the rectus rising to a point between the two bowls, the obliques under their outer
// curves; as wide as her waist allows.
const RECTUS_FH_W: P2[] = [[0.192, 0.0], [0.185, 0.009], [0.173, 0.02], [0.163, 0.032], [0.155, 0.046], [0.11, 0.048], [0.07, 0.0465], [0.035, 0.04], [0.01, 0.027], [-0.012, 0.0]];
const OBLIQUE_F_W: P2[] = [
  [0.158, 0.054], [0.17, 0.0655], [0.181, 0.0765], [0.15, 0.069], [0.12, 0.065], [0.098, 0.068], [0.075, 0.0775], [0.055, 0.0815],
  [0.038, 0.0745], [0.024, 0.064], [0.014, 0.0535], [0.034, 0.0555], [0.07, 0.0545], [0.11, 0.054], [0.142, 0.0545],
];
const HEAD_F_W: P2[] = [
  [0.0, 0.0615], [0.03, 0.057], [0.046, 0.04], [0.05, 0.015], [0.047, -0.008], [0.041, -0.03], [0.03, -0.049], [0.016, -0.06], [0.0, -0.064],
  [-0.016, -0.06], [-0.03, -0.049], [-0.041, -0.03], [-0.047, -0.008], [-0.05, 0.015], [-0.046, 0.04], [-0.03, 0.057],
];
/** A symmetric outline from its image-right half: from the top of the midline down that side to the bottom of the midline. */
const both = (half: readonly P2[]): P2[] => [...half, ...mirrorFace(half).reverse().slice(1, -1)];
/** A symmetric band round the face from its image-right half: the outer edge from the top of the midline, then the inner edge back to it. */
const band = (outer: readonly P2[], inner: readonly P2[]): P2[] => [...outer, ...inner, ...mirrorFace(inner).reverse().slice(1), ...mirrorFace(outer).reverse().slice(0, -1)];
// Hair framing the face: parted in the middle and drawn back from a rounded hairline, filling the temples and over the
// tops of the ears. Behind the head, the hair seen past it: fuller at the temples, over the ears and going back behind
// the jaw to the nape on both sides of the neck.
const HAIR_F_W: P2[] = band(
  [[0.0, 0.0615], [0.03, 0.057], [0.046, 0.04], [0.0525, 0.021], [0.0585, 0.0075]],
  [[0.0575, -0.0005], [0.051, 0.0015], [0.0458, 0.0045], [0.0432, 0.0155], [0.0375, 0.0295], [0.0255, 0.039], [0.012, 0.0428], [0.0, 0.0418]],
);
const HAIR_BACK_F_W: P2[] = both([
  [0.0, 0.0635], [0.032, 0.0592], [0.0508, 0.0418], [0.0565, 0.021], [0.0618, 0.007], [0.0612, -0.007], [0.056, -0.022], [0.0485, -0.037],
  [0.0415, -0.051], [0.0345, -0.064], [0.022, -0.074], [0.0, -0.078],
]);
// A bowed head seen from the front and above: the crown of hair parted down the middle and over the tops of the ears,
// and past it the knot of hair tied back at the top and the hair over the ears.
const HAIR_TOP_W: P2[] = both([
  [0.0, 0.0615], [0.03, 0.057], [0.046, 0.04], [0.052, 0.021], [0.0565, 0.0075], [0.0555, -0.001], [0.051, -0.006], [0.048, -0.014],
  [0.04, -0.03], [0.02, -0.04], [0.0, -0.043],
]);
const KNOT_TOP_W: P2[] = both([
  [0.0, 0.0775], [0.0115, 0.0762], [0.0172, 0.0698], [0.0192, 0.0615], [0.033, 0.0592], [0.0505, 0.0415], [0.0545, 0.0215], [0.0585, 0.008],
  [0.0578, -0.004], [0.05, -0.012], [0.03, -0.004], [0.0, 0.0],
]);
// Eyes with a flick of lashes at the outer corner, finer arched brows; a small nose; lips with a bow and a fuller lower lip.
const FACE_PAIR_W: P2[][] = [
  [[0.012, 0.0072], [0.019, 0.0102], [0.026, 0.0082], [0.0288, 0.0099], [0.0263, 0.006], [0.019, 0.0045]],
  [[0.011, 0.018], [0.02, 0.0222], [0.03, 0.0195], [0.0295, 0.0178], [0.02, 0.0204], [0.0115, 0.0164]],
];
const FACE_MID_W: P2[][] = [
  [[-0.003, -0.016], [0.0, -0.0182], [0.003, -0.016], [0.0, -0.0148]],
  [[-0.0105, -0.0338], [-0.0042, -0.0321], [0.0, -0.0328], [0.0042, -0.0321], [0.0105, -0.0338], [0.005, -0.0365], [-0.005, -0.0365]],
];

const FEMALE: Shape = {
  warp: {
    // Thighs full at the front of the hip. Below it a thigh rests all along (its front on a pad or under a lap pad,
    // its back on a seat, the knee kneeling), so there the outline is his; her fuller buttock is the glute's own.
    thigh: slim([[-0.03, 1.06], [0.0, 1.05], [0.04, 1.0]], [[0, 1]]),
    // A slimmer calf belly; the shin's front, the Achilles and the heel (pads, rollers, kneeling) as his.
    shin: slim([[0.17, 1], [0.21, 0.95]], [[-0.03, 1], [0.0, 0.975], [0.062, 0.945], [0.098, 0.945], [0.14, 0.97], [0.17, 1]]),
    // A lower instep and shorter toes; the sole, the heel and the Achilles above it (rollers press there) as his.
    foot: (t, d) => [t, d > 0.008 ? 0.008 + (d - 0.008) * (1 - 0.07 * smooth((t - 0.012) / 0.03)) : d],
    toes: (t, d) => [t * 0.92, d > 0.008 ? 0.008 + (d - 0.008) * 0.93 : d],
    // Arms slimmer on the front only: their backs rest on the floor (a plank's forearms, the arms beside a bridge, the
    // elbows of a floor press), so they are his, as is the tip of the wrist (on the floor at a push-up's bottom); the
    // deltoid cap within a few per cent of his.
    upperArm: slim([[0.0, 0.96], [0.05, 0.955], [0.1, 0.95], [0.19, 0.95], [0.22, 0.97]], [[0.0, 1]], 0.96),
    forearm: slim([[0.03, 0.97], [0.09, 0.94], [0.13, 0.93], [0.15, 0.97], [0.158, 1]], [[0.0, 1]]),
    fist: handScale(0.035, 0.92),
    flatHand: handScale(0.03, 0.93, 0.9, true),
    // Front view: the outer hip fills out above the joint, up into the flare of the trunk; below it the outer side
    // of the leg (lying on the side, the bottom leg rests on it) is his; the inner thighs meet at the top.
    thighF: slim(
      [[-0.06, 1.3], [-0.035, 1.15], [-0.012, 1.0]],
      [[-0.03, 1.15], [-0.008, 1.2], [0.025, 1.149], [0.055, 1.14], [0.095, 1.069], [0.145, 1.0], [0.19, 0.9625], [0.25, 1]],
    ),
    shinF: slim([[0.0, 1]], [[0.0, 0.97], [0.048, 0.95], [0.2, 0.93]]),
    // A narrower foot; its outer edge (a side plank rests on it) is his.
    footF: (t, d) => [t, d < 0 ? d * 0.86 : d],
    // Front view: a slightly smaller deltoid cap and a slimmer outer arm; the inner side (lying on the side, the arm
    // under the head rests on it) as his.
    upperArmF: slim([[0.0, 0.95], [0.05, 0.94], [0.1, 0.93]], [[0.0, 1]], 0.95),
    forearmF: slim([[0.03, 0.97], [0.1, 0.93]], [[0.0, 1]]),
  },
  toeJoint: 0.0165,
  thighGroove: [],
  // Rounder, with a higher shelf where it leaves the back and a deeper fold; his once the hip bends (seats, benches).
  glute: { ...GLUTE, shelf: 18, fold: 82, apex: [0.0795, 0.004, 0.014], handles: [0.5, 0.45], relax: { at: 0.2, to: GLUTE } },
  trunk: TRUNK_W,
  chestSwell: [0.006, 0.01, 0.012, 0.008, 0.004],
  chestFrom: 7,
  pecRun: [6, 12],
  pecIn: PEC_IN_W,
  pecDropFrom: 4,
  // Judged on the same points as his, so the near arm carries her chest's tendon when it would carry his.
  pecSamples: PEC_SAMPLES,
  backSamples: BACK_SAMPLES,
  // The rectus as wide as his behind her flatter front, running up under the bust.
  rectusRun: [...runOf(TRUNK_W, 1, 6), [0.168, 0.0505]],
  rectusIn: [[0.172, 0.048], [0.163, 0.0445], [0.152, 0.0428], [0.14, 0.0415], [0.1, 0.0395], [0.06, 0.0375], [0.02, 0.0335], [-0.008, 0.0302], [-0.02, 0.035]],
  rectusSplits: [[[0.13, 0.038], [0.125, 0.047], [0.124, 0.0535]], [[0.098, 0.036], [0.094, 0.045], [0.093, 0.0515]]],
  oblique: OBLIQUE_W,
  // Working, it spreads back toward the lat a little further than his, as her rectus fills more of the band in front.
  obliqueSwell: OBLIQUE_W.map((_, i) => (i >= 4 && i <= 9 ? -0.008 : i >= 12 || i === 0 ? 0.003 : 0)),
  lat: [
    [0.264, -0.008], [0.246, 0.003], [0.222, 0.005], [0.198, 0.006], [0.172, 0.006], [0.145, -0.003], [0.122, -0.011], [0.104, -0.02], [0.09, -0.028],
    [0.096, -0.034], [0.12, -0.033], [0.145, -0.038], [0.172, -0.048], ...runOf(TRUNK_W, 21, 21), [0.224, -0.064], [0.244, -0.053], [0.258, -0.034],
  ],
  erectors: [...runOf(TRUNK_W, 22, 26), [0.05, -0.044], [0.078, -0.039], [0.11, -0.038], [0.14, -0.043], [0.163, -0.053]],
  upperBack: [...runOf(TRUNK_W, 17, 21), [0.21, -0.064], [0.232, -0.058], [0.252, -0.043], [0.272, -0.029], [0.296, -0.024], [0.316, -0.022]],
  neck: { front: [[0.265, 0.02], [0.29, 0.029]], head: [[0.021, -0.065], [0.014, -0.04], [-0.02, -0.031], [-0.028, -0.046]], back: [[0.326, -0.028], [0.3, -0.034]] },
  trap: { start: [-0.025, -0.046], trunk: [[0.328, -0.0245], [0.316, -0.036], [0.303, -0.027], [0.299, -0.014], [0.305, -0.002]], end: [-0.011, -0.05] },
  head: HEAD_W,
  hair: HAIR_W,
  hairFill: 'var(--fig-hair-her)',
  earUnder: true,
  tail: TAIL_W,
  tie: [[-0.06, -0.031], [-0.049, -0.035], [-0.037, -0.039]],
  strands: [[[-0.057, -0.046], [-0.0555, -0.066], [-0.052, -0.086]], [[-0.049, -0.046], [-0.0475, -0.066], [-0.044, -0.086]]],
  face: FACE_W,
  ear: EAR,
  eye: EYE_W,
  brow: BROW_W,
  trunkFH: TRUNK_FH_W,
  trunkBH: TRUNK_BH_W,
  pecF: PEC_F_W,
  rectusFH: RECTUS_FH_W,
  // Fewer definition lines than his: two tendinous lines, and the linea alba fading out below the navel.
  lineaF: [0.186, 0.05],
  rectusFLines: [0.14, 0.104],
  obliqueF: OBLIQUE_F_W,
  latF: [[0.25, 0.086], [0.23, 0.0845], [0.21, 0.0815], [0.19, 0.0775], [0.205, 0.077], [0.228, 0.08]],
  trapF: [...runOf(TRUNK_FH_W, 20, 16), [0.283, 0.072], [0.291, 0.06], [0.3, 0.048], [0.311, 0.038], [0.323, 0.029], [0.332, 0.022]],
  trapB: [...runOf(TRUNK_BH_W, 18, 14), [0.295, 0.072], [0.281, 0.061], [0.262, 0.051], [0.238, 0.04], [0.21, 0.029], [0.182, 0.017], [0.16, 0.007], [0.15, 0.0]],
  latB: [...runOf(TRUNK_BH_W, 12, 6), [0.056, 0.07], [0.076, 0.057], [0.1, 0.051], [0.13, 0.053], [0.162, 0.06], [0.195, 0.071], [0.225, 0.081]],
  erectorB: ERECTOR_B,
  foldF: [[0.262, 0.086], [0.208, 0.083]],
  neckF: { trunk: [[0.27, 0.0255], [0.3, 0.0272]], head: [[0.029, -0.03], [0.0255, -0.048]] },
  headF: HEAD_F_W,
  hairF: HAIR_F_W,
  hairBackF: HAIR_BACK_F_W,
  hairTop: HAIR_TOP_W,
  partF: [[0.0, 0.0425], [0.0003, 0.052], [0.0008, 0.0605]],
  partTop: [[0.0, -0.036], [0.0005, 0.01], [0.001, 0.05]],
  knotTop: KNOT_TOP_W,
  faceBowed: FACE_BOWED,
  earF: EAR_F,
  facePair: FACE_PAIR_W,
  faceMid: FACE_MID_W,
};

export function drawBody(fig: BodyFigure, c: BodyContext): BodyLayers {
  const S = c.body === 'female' ? FEMALE : MALE;
  return fig.view === 'front' ? drawFront(fig, c, S) : drawSide(fig, c, S);
}
