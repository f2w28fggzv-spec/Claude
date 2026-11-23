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
// profiles, a few numbers, and in the side view for her limbs a warp that
// reshapes everything drawn in that limb's frame (the front view has a table
// set per body, FrontShape). Where a body rests on a floor, a bench or a pad
// her outline is his.
import { MUSCLE_GROUPS, type MuscleGroup } from '../data/types';
import { restingSide, type Levels } from './engagement';
import { L, type Arm, type Figure, type Leg, type Side, type Vec } from './figure';

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
/** A table point with an optional skinning weight (see skinFrame). */
type P3 = [number, number, number?];
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
// Written out from the whole thousandths (the same text as rounding and printing the number, faster).
function num(v: number): string {
  const r = Math.round((Number.isFinite(v) ? v : 0) * 1000);
  if (r === 0) return '0';
  const a = r < 0 ? -r : r;
  const whole = Math.floor(a / 1000);
  const f = a - whole * 1000;
  let s = whole === 0 ? '' : String(whole);
  if (f !== 0) {
    if (f % 100 === 0) s += '.' + f / 100;
    else if (f % 10 === 0) s += (f < 100 ? '.0' : '.') + f / 10;
    else s += (f < 10 ? '.00' : f < 100 ? '.0' : '.') + f;
  }
  return r < 0 ? '-' + s : s;
}
function coords(pts: Vec[]): string {
  let s = '';
  for (const p of pts) {
    const x = num(p.x);
    const y = num(p.y);
    s += (s && x[0] !== '-' ? ' ' : '') + x + (y[0] !== '-' ? ' ' : '') + y;
  }
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
  /** A table point; `w` (skinned limbs only) blends it from the trunk's frame to the bone's. */
  p(t: number, d: number, w?: number): Vec;
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
const mapped3 = (F: Frame, list: readonly P3[]) => list.map(([t, d, w]) => F.p(t, d, w));
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
  /** Limb contours in the side view (none: the tables as they are). */
  warp: { thigh?: Warp; shin?: Warp; foot?: Warp; toes?: Warp; upperArm?: Warp; forearm?: Warp; fist?: Warp; flatHand?: Warp };
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
  /** Front view (see FrontShape). */
  front: FrontShape;
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
// Built the way a life drawing is: the bony landmarks first (the clavicles and the acromion, the rib cage, the iliac
// crest and the groin, the trochanter, the knee and the malleoli), then the masses over them, in real adult
// proportions for each body (FrontShape, with the shape sets at the end of the file).
//
// Each limb is drawn in its rest pose, hanging along the trunk ([t, d]: t along the limb from its joint, d out to the
// side), and skinned to the trunk: a point's weight (0 = with the trunk, 1 = with the bone) turns it that share of the
// way from the trunk's frame to the bone's, about the joint. The shoulder's cap and the outer hip turn part of the way,
// so the deltoid wraps the joint at any arm angle, the armpit opens into a fold as the arm rises and the hip bunches as
// the leg lifts; on the arm's inner side (the front of the shoulder, the armpit) points slide in a straight line instead,
// so an arm raised overhead never swings them out under the joint. As the arm rises the deltoid shortens and gathers
// into a mound over the joint, the acromion riding up a little with the turning shoulder blade. Where a limb grows out
// of the trunk (the cap's top, the groin) its outline is painted under the trunk's skin, so only the union's edge shows;
// the rest of its outline is painted with the limb, so it stays an edge where the limb passes in front of the body. A
// flat hand belongs to the arm's silhouette, so the wrist bends into it; a fist is its own shape over what it holds.
//
// A trunk tipped toward the camera past the camera's line of sight (torsoScale < 0: a camera above a lifter bent over
// toward it) shows the back from above, the hips at the top and the bowed head at the bottom (frontBack).

/** The front-view trunk frame: t up from the hip line (foreshortened by k up to the shoulders), x toward side b. */
interface FrontTrunk {
  u: Vec;
  k: number;
  p(t: number, x: number): Vec;
}

/** A front-view limb segment: d > 0 is the outside of the body (`outer` = ±1 picks the side). */
const frontFrame = (o: Vec, tip: Vec, nominal: number, deg: number, outer: number, w?: Warp) => boneFrame(o, tip, nominal, deg, (u) => mul(rot90(u), outer), w);

/** The direction `rad` radians on from unit u toward unit f. */
const turn = (u: Vec, f: Vec, rad: number) => add(mul(u, Math.cos(rad)), mul(f, Math.sin(rad)));

/** How far round from rest (radians) a limb's turn still counts as raised out to the side and overhead (see skinFrame). */
const WRAP = 200 * RAD;
/**
 * A limb skinned to the trunk at its root (see above). `rest` is the way the limb hangs in its tables (down along the
 * trunk), `kRest` the trunk's foreshortening, `weight` how far each table point follows the bone. With `slideInner`
 * the points on the limb's inner side (d < 0: the front of the shoulder, the armpit) slide on a straight line from the
 * trunk to the bone as explicitly weighted points do, instead of turning part of the way round the joint, so a limb
 * raised overhead never swings them out under the joint.
 */
function skinFrame(o: Vec, tip: Vec, nominal: number, deg: number, outer: number, rest: Vec, kRest: number, weight: (t: number, d: number) => number, slideInner = false, roundCap = false): Frame & { phi: number } {
  const bone = frontFrame(o, tip, nominal, deg, outer);
  const fRest = mul(rot90(rest), outer);
  // How far the bone has turned out to the side from rest (negative: in across the body). A limb can reach a little past
  // straight overhead (raised out to the side, then on over the head) or well across the body and up, but not both
  // ways round at once: the turn reads as raised overhead up to WRAP and as across the body beyond it, where no real
  // limb goes either way (an arm 20 degrees past vertical on the far side), so a limb swept across the body or up
  // overhead turns smoothly.
  let phi = Math.atan2(dot(bone.u, fRest), dot(bone.u, rest));
  if (phi < WRAP - 2 * Math.PI) phi += 2 * Math.PI;
  const k = bone.k;
  const along = (t: number) => (t <= 0 ? t : t >= nominal ? nominal * k + (t - nominal) : t * k);
  // Where the trunk holds a point: foreshortened with it, except (roundCap) the cap round the joint, a rounded mass
  // whose outline the trunk's foreshortening doesn't flatten (capRound).
  const held = (t: number, d: number) => (roundCap && t < 0 ? t * (kRest + (1 - kRest) * capRound(t, d)) : t * kRest);
  return {
    u: bone.u,
    f: bone.f,
    k,
    phi,
    p: (t, d, w) => {
      if (w === undefined && slideInner && d < 0) w = weight(t, d);
      if (w !== undefined) {
        // An explicit weight: the point slides on a straight line from where the trunk holds it to where the bone
        // does (a muscle stretched from its origin to its insertion, the skin of the armpit).
        const r = add(add(o, mul(rest, held(t, d))), mul(fRest, d));
        return lerpV(r, add(add(o, mul(bone.u, along(t))), mul(bone.f, d)), w);
      }
      const a = weight(t, d);
      const u = turn(rest, fRest, a * phi);
      const f = turn(fRest, mul(rest, -1), a * phi);
      const s0 = held(t, d);
      const s = s0 + (along(t) - s0) * a;
      return V(o.x + u.x * s + f.x * d, o.y + u.y * s + f.y * d);
    },
  };
}
/**
 * How much of a point above the shoulder joint keeps its rest shape when the trunk is foreshortened (a trunk tipped
 * toward the camera): the deltoid's cap, from over its top round to its outer side, is a rounded mass and stays round
 * however the trunk is seen; toward the trunk (its inner side) it joins the trunk's foreshortened outline.
 */
const capRound = (t: number, d: number) => smooth((Math.atan2(d, -t) / RAD + 30) / 60);
/**
 * The shoulder. The cap's top (the acromion and the clavicle) stays with the trunk; round the outside of the joint the
 * weight grows with the angle from the acromion to the deltoid's widest point, so as the arm rises the cap closes
 * evenly into a mound over the joint instead of folding; the front of the arm below the joint and everything well down
 * the arm go with the bone; the chest stays.
 */
function shoulderWeight(t: number, d: number): number {
  const a = Math.atan2(d, -t) / RAD;
  const round = a >= -35 ? clamp((a + 10) / 140, 0, 1) : smooth((-60 - a) / 50) * smooth(t / 0.03);
  return Math.max(round, smooth((t - 0.025) / 0.035)) * smooth((d + 0.05) / 0.02);
}
/** Where the shoulder's cap stands out as the deltoid gathers over the joint: round the joint, fading down the arm. */
const capBulge = (t: number) => smooth((t + 0.008) / 0.032) * (1 - smooth((t - 0.04) / 0.05));
/** The hip: the iliac crest and the top of the groin stay with the trunk, the outer hip over the trochanter turns about half way, the thigh goes with the bone. */
const hipWeight = (t: number) => smooth((t + 0.048) / 0.1);

/** A limb's markup: its outline at the root (painted under the trunk's skin), the rest of its outline, its skin and what lies on it. */
interface FrontLimb {
  root: string;
  edge: string;
  skin: string;
  detail: string;
}

/** Trunk [t, x] lists for one side; arm and leg tables in their rest pose. */
const mirror = (list: readonly P2[]): P2[] => list.map(([t, x]) => [t, -x]);
/** A head [x, y] list on the other side of the face. */
const mirrorFace = (list: readonly P2[]): P2[] => list.map(([x, y]) => [-x, y]);
/** A symmetric outline from its image-right half: from the top of the midline down that side to the bottom of the midline. */
const both = (half: readonly P2[]): P2[] => [...half, ...mirrorFace(half).reverse().slice(1, -1)];
/** A symmetric band round the face from its image-right half: the outer edge from the top of the midline, then the inner edge back to it. */
const band = (outer: readonly P2[], inner: readonly P2[]): P2[] => [...outer, ...inner, ...mirrorFace(inner).reverse().slice(1), ...mirrorFace(outer).reverse().slice(0, -1)];

/**
 * One arm. The hand is a fist (a held handle, a fist on the floor) or flat (on the hip, on the floor), seen from its
 * side as in the side view. The chest muscle is drawn with the arm (on its skin, under the deltoid), since its
 * outer half turns with it into the front fold of the armpit; its level is the trunk's.
 */
function frontArm(s: Side, arm: Required<Arm>, outer: number, rest: Vec, TF: FrontTrunk, pal: Palette, chest: Palette | null, F: FrontShape, table = F.upperArm, deltoid = F.deltoid): FrontLimb {
  const Ua = skinFrame(s.shoulder, s.elbow, 0.186, arm.upper, outer, rest, TF.k, shoulderWeight, true, true);
  const Fa = frontFrame(s.elbow, s.wrist, 0.146, arm.fore, outer);
  const lv = pal.lv('shoulders');
  // As the arm rises the deltoid shortens and gathers into a mound over the joint, and a working one swells: the cap
  // and the deltoid on it stand out (mound) and the deltoid's lower end draws up toward the joint (gather).
  const raised = smooth((Ua.phi / RAD - 25) / 55);
  const mound = 0.0034 * raised + 0.0018 * lv;
  const gather = (t: number) => t - 0.013 * raised * smooth((t - 0.04) / 0.06);
  const bulge = (t: number, d: number) => (d > 0 ? mound * capBulge(t) * smooth(d / 0.01) : 0);
  // The acromion rides up a little as the shoulder blade turns with the raised arm, so the cap rises from the
  // trapezius without a notch.
  const lift = (t: number, d: number) => (d >= 0 ? 0.0045 * raised * smooth((t + 0.028) / 0.01) * (1 - smooth((t + 0.006) / 0.008)) : 0);
  const upper = mapped3(Ua, table.map(([t, d, w]): P3 => (w === undefined ? [t - lift(t, d), d + bulge(t, d)] : [t, d, w])));
  const fore = mapped(Fa, F.forearm);
  let H: Frame;
  if (arm.flat) {
    // Palm on the surface, fingers pointing `hand`, the palm on the side away from the elbow (as in the side view).
    const u = dir(arm.hand);
    let toPalm = V(u.y, -u.x);
    const side = dot(toPalm, sub(s.elbow, s.wrist));
    if (Math.abs(side) < 1e-4 ? dot(toPalm, Fa.f) < 0 : side > 0) toPalm = mul(toPalm, -1);
    H = flatFrame(s.wrist, u, toPalm, 1);
  } else {
    const u = unit(sub(s.hand, s.wrist), Fa.u);
    H = flatFrame(s.wrist, u, mul(rot90(u), outer), 1);
  }
  const hand = mapped(H, arm.flat ? F.flatHand : F.fist);
  const [i0, i1] = F.capArc;
  const n = upper.length;
  const nf = fore.length;
  // The deltoid swells as it works, into the skin bands round it: round the cap outward, its front border inward.
  const delt = deltoid.map(([t0, d], i): P2 => {
    const t = gather(t0);
    const swell = i >= DELT_CAP[0] && i <= DELT_CAP[1] ? 0.003 : i >= DELT_FRONT[0] && i <= DELT_FRONT[1] ? -0.0025 : 0;
    return [t - lift(t, d), d + bulge(t, d) + swell * lv * smooth((0.11 - t0) / 0.05)];
  });
  let detail = chest ? muscle(closed(mapped3(Ua, F.pec)), chest.m('chest'), pal) + crease(F.pecFold.map((l) => open(mapped3(Ua, l))).join(''), 0.0026) : '';
  detail += muscle(closed(mapped(Ua, F.biceps)), pal.m('biceps'), pal) + muscle(closed(mapped(Ua, F.triceps)), pal.m('triceps'), pal);
  detail += muscle(closed(mapped(Ua, delt)), pal.m('shoulders'), pal) + split(open(mapped(Ua, F.deltSplit.map(([t, d]): P2 => [gather(t), d + bulge(gather(t), d)]))), pal, 0.7 * GAP);
  detail += crease(open(mapped(Fa, F.foreCrease)) + open(mapped(Ua, F.elbowCrease)), 0.0024);
  // A fist is its own mass over what it holds; a flat hand is part of the arm's silhouette (its outline under the arm's
  // skin, as in the side view), so the wrist bends into it without a seam.
  detail += arm.flat ? crease(lines(H, F.flatLines), 0.0022) : solid(closed(hand), pal) + crease(lines(H, F.fistLines), 0.0022);
  return {
    root: arcOf(upper, i1, i0 + n),
    edge: arcOf(upper, i0, i1) + arcOf(fore, 0, nf - 3) + (arm.flat ? closed(hand) : ''),
    skin: skin(union(arm.flat ? [upper, fore, hand] : [upper, fore]), pal),
    detail,
  };
}

/** Where her fuller hip stands out along the thigh: from nothing at the iliac crest to all of it at the trochanter, fading down the upper thigh. */
const hipBump = (t: number) => smooth((t + 0.05) / 0.05) * (1 - smooth((t - 0.03) / 0.12));

/** How soft flesh gives where two legs press together: the contact eases in over this much. */
const PRESS_EASE = 0.004;
/** The press holds a point from this far down the leg's bone (it lets go toward the hip). */
const PRESS_FROM = 0.07;
/** The front view's thigh and shin, hip to knee and knee to ankle, and how far the leg's bone line runs on past the ankle through the foot. */
const THIGH_LEN = 0.245;
const SHIN_LEN = 0.246;
const TOE_LEN = 0.045;
/** From a point to the segment from (ax, ay) along (dx, dy). */
function toSegment(px: number, py: number, ax: number, ay: number, dx: number, dy: number): number {
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / Math.max(dx * dx + dy * dy, 1e-9), 0, 1);
  const x = px - ax - dx * t;
  const y = py - ay - dy * t;
  return Math.sqrt(x * x + y * y);
}
/** The gap between two segments, each a start and a direction: none where they cross, else from the nearest end of one to the other. */
function segmentGap(ax: number, ay: number, adx: number, ady: number, bx: number, by: number, bdx: number, bdy: number): number {
  const crosses = (adx * (by - ay) - ady * (bx - ax)) * (adx * (by + bdy - ay) - ady * (bx + bdx - ax)) < 0 && (bdx * (ay - by) - bdy * (ax - bx)) * (bdx * (ay + ady - by) - bdy * (ax + adx - bx)) < 0;
  if (crosses) return 0;
  return Math.min(toSegment(ax, ay, bx, by, bdx, bdy), toSegment(ax + adx, ay + ady, bx, by, bdx, bdy), toSegment(bx, by, ax, ay, adx, ady), toSegment(bx + bdx, by + bdy, ax, ay, adx, ady));
}
/**
 * Legs that rest on each other (lying on the side, the top leg on the bottom one) press flat where they meet instead
 * of passing through each other: a point of this leg that would reach past the line half way to the other leg's bone
 * (less the outline, and `inset` for what lies inside the outline) is held at that line, easing in so the contact
 * flattens smoothly. The inner thighs meet at the crotch as drawn, so it lets go toward the hip.
 *
 * `reach` is how far the point can lie from this leg's bone, from the shape tables: a point that cannot come within the
 * ease of the line where the legs come closest is left as it is without finding the bones (exactly as the press would
 * leave it), so legs that cannot touch, standing, cost next to nothing and only legs at rest on each other pay.
 */
function pressing(own: Side, other: Side): (p: Vec, reach: number, inset?: number) => Vec {
  // Each leg's bone line as three segments (hip to knee, knee to ankle, on past the ankle through the foot), seven
  // numbers each: start, direction, squared length, length and the length from the hip to the start. Plain numbers in
  // one list: this runs for every point of a leg that can reach the line.
  const bones = (s: Side): number[] => {
    const toe = add(s.ankle, mul(unit(sub(s.ankle, s.knee), V(0, 1)), TOE_LEN));
    const ends = [s.hip, s.knee, s.ankle, toe];
    const out: number[] = [];
    let run = 0;
    for (let i = 0; i < 3; i++) {
      const dx = ends[i + 1].x - ends[i].x;
      const dy = ends[i + 1].y - ends[i].y;
      const l = Math.hypot(dx, dy);
      out.push(ends[i].x, ends[i].y, dx, dy, Math.max(l * l, 1e-9), l, run);
      run += l;
    }
    return out;
  };
  const mine = bones(own);
  const theirs = bones(other);
  // Where the legs come closest: the other leg's bone line from this one's, below where this one's hold starts. Every
  // point the press holds lies across from a point of its bone at least this far from the other bone, so a point no
  // further than `free` from its bone stays short of the half-way line by the whole ease, where the press leaves it.
  let apart = Infinity;
  for (let i = 0; i < 21; i += 7) {
    const l = mine[i + 5];
    const run = mine[i + 6];
    if (run + l <= PRESS_FROM) continue;
    // The part of the segment past the hold start.
    const f = Math.max(0, (PRESS_FROM - run) / l);
    const dx = mine[i + 2];
    const dy = mine[i + 3];
    for (let j = 0; j < 21; j += 7) {
      apart = Math.min(apart, segmentGap(mine[i] + dx * f, mine[i + 1] + dy * f, dx * (1 - f), dy * (1 - f), theirs[j], theirs[j + 1], theirs[j + 2], theirs[j + 3]));
    }
  }
  const free = apart / 2 - W - 0.0008 - PRESS_EASE;
  return (p, reach, inset = 0) => {
    if (reach + inset <= free) return p;
    // The nearest point q of this leg's bone, and how far it is from the hip.
    let qx = p.x;
    let qy = p.y;
    let at = 0;
    let best = Infinity;
    for (let i = 0; i < 21; i += 7) {
      const ax = mine[i];
      const ay = mine[i + 1];
      const dx = mine[i + 2];
      const dy = mine[i + 3];
      const t = clamp(((p.x - ax) * dx + (p.y - ay) * dy) / mine[i + 4], 0, 1);
      const x = ax + dx * t;
      const y = ay + dy * t;
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < best) {
        best = d;
        qx = x;
        qy = y;
        at = mine[i + 6] + t * mine[i + 5];
      }
    }
    const hold = smooth((at - PRESS_FROM) / 0.05);
    if (hold <= 0) return p;
    // The other leg's bone nearest q, and the way across to it.
    let rx = qx;
    let ry = qy;
    best = Infinity;
    for (let i = 0; i < 21; i += 7) {
      const ax = theirs[i];
      const ay = theirs[i + 1];
      const dx = theirs[i + 2];
      const dy = theirs[i + 3];
      const t = clamp(((qx - ax) * dx + (qy - ay) * dy) / theirs[i + 4], 0, 1);
      const x = ax + dx * t;
      const y = ay + dy * t;
      const d = (qx - x) * (qx - x) + (qy - y) * (qy - y);
      if (d < best) {
        best = d;
        rx = x;
        ry = y;
      }
    }
    const D = Math.sqrt(best);
    if (D < 1e-6) return p;
    const nx = (rx - qx) / D;
    const ny = (ry - qy) / D;
    const x = (p.x - qx) * nx + (p.y - qy) * ny;
    // A hair short of the half-way line, as the other leg measures it from its own bone.
    const limit = D / 2 - W - inset - 0.0008;
    if (x <= limit - PRESS_EASE) return p;
    // A smooth minimum of x and the limit: x itself well short of it, the limit well past it.
    const h = clamp(0.5 + (0.5 * (limit - x)) / PRESS_EASE, 0, 1);
    const move = (x * h + limit * (1 - h) - PRESS_EASE * h * (1 - h) - x) * hold;
    return V(p.x + nx * move, p.y + ny * move);
  };
}

/** One leg: the thigh skinned at the hip, the shin, the foot pointing at the camera with its toes turned out by `out`; it presses flat where it rests on the other leg. */
function frontLeg(s: Side, leg: Leg, outer: number, rest: Vec, TF: FrontTrunk, pal: Palette, F: FrontShape, other: Side): FrontLimb {
  const Th = skinFrame(s.hip, s.knee, THIGH_LEN, leg.thigh, outer, rest, TF.k, hipWeight);
  const Sh = frontFrame(s.knee, s.ankle, SHIN_LEN, leg.shin, outer);
  // Her fuller hip and upper outer thigh (hipFlare) settle flat where the hip faces the floor: lying on it she rests
  // where he does.
  const press = smooth((mul(rot90(rest), outer).y - 0.5) / 0.4);
  const flare = (F.hipFlare ?? 0) * (1 - press);
  const wide = (list: readonly P2[], from = 0.015): P2[] => list.map(([t, d]) => [t, d > from ? d + flare * hipBump(t) : d]);
  // Everything drawn on the leg presses flat where it rests on the other leg; what lies inside the outline stays a gap's
  // width inside it. Each point goes with its reach from the leg's bone line, which runs from 0 to `end` along t in its
  // frame: its distance across, or from the joint where it lies past either end (below the knee on the thigh, above it
  // on the shin). Near the hip, where the thigh turns only part of the way with the bone, the press lets go anyway.
  const on = pressing(s, other);
  const at = (Fr: { p(t: number, d: number): Vec }, list: readonly P2[], end: number, inset = GAP / 2) =>
    list.map(([t, d]) => {
      const p = Fr.p(t, d);
      if (d >= 0) return p;
      const past = t < 0 ? -t : t > end ? t - end : 0;
      return on(p, past > 0 ? Math.hypot(past, d) : -d, inset);
    });
  const thigh = at(Th, wide(F.thigh), THIGH_LEN, 0);
  const shin = at(Sh, F.shin, SHIN_LEN + TOE_LEN, 0);
  // Toes turned out (standing): the big toe's side comes round toward the little toe's; the outer edge stays (lying on
  // the side, the foot rests on it).
  const out = clamp(dot(sub(s.toe, s.heel), Sh.f) / 0.03, -1, 1);
  const Ft = flatFrame(s.ankle, Sh.u, Sh.f, 1);
  const foot = at(Ft, F.foot.map(([t, d]): P2 => [t, d < 0 ? d * (1 - 0.12 * out * smooth(t / 0.03)) + 0.004 * out * smooth(t / 0.03) : d]), TOE_LEN, 0);
  const [j0, j1] = F.hipArc;
  const n = thigh.length;
  const quads = F.quads.map((m, i) => closed(at(Th, i ? m : wide(m, 0.02), THIGH_LEN))).join('');
  // The abductors swell forward as they work.
  const gl = pal.lv('glutes');
  let detail = muscle(closed(at(Th, wide(F.glute).map(([t, d], i): P2 => [t, i > 7 ? d - 0.005 * gl * smooth((0.07 - Math.abs(t - 0.02)) / 0.05) : d]), THIGH_LEN)), pal.m('glutes'), pal);
  detail += muscle(quads, pal.m('quads'), pal);
  detail += muscle(F.calves.map((m) => closed(at(Sh, m, SHIN_LEN + TOE_LEN))).join(''), pal.m('calves'), pal);
  detail += crease(open(at(Th, F.patella, THIGH_LEN)) + open(at(Th, F.groin, THIGH_LEN)) + F.toeLines.map((l) => open(at(Ft, l, TOE_LEN))).join(''), 0.0024);
  return {
    root: arcOf(thigh, j1, j0 + n),
    edge: arcOf(thigh, j0, j1) + closed(shin) + closed(foot),
    skin: skin(union([thigh, shin, foot]), pal),
    detail,
  };
}

/** The head facing the camera: the skull and the jaw, the ears, the hair and the features. */
function frontHead(fig: BodyFigure, pal: Palette, S: Shape): string {
  const F = S.front;
  const Hf = headFrame(fig);
  const ears = path(closed(mapped(Hf, F.ear)) + closed(mapped(Hf, mirrorFace(F.ear))), `fill="${pal.skin}" stroke="${pal.line}" stroke-width="${num(W * 0.7)}"`);
  let o = solid(closed(mapped(Hf, F.head)), pal);
  o += F.earUnder ? ears : '';
  o += path(closed(mapped(Hf, F.hair)), `fill="${S.hairFill}"`);
  if (F.part) o += path(open(mapped(Hf, F.part)), `fill="none" stroke="${pal.skin}" stroke-width=".0022" stroke-linecap="round"`);
  o += F.earUnder ? '' : ears;
  const features = F.facePair.map((f) => closed(mapped(Hf, f)) + closed(mapped(Hf, mirrorFace(f)))).join('') + F.faceMid.map((f) => closed(mapped(Hf, f))).join('');
  return o + path(features, 'fill="var(--fig-face)"') + crease(F.faceLines.map((l) => open(mapped(Hf, l)) + open(mapped(Hf, mirrorFace(l)))).join(''), 0.002);
}

/** The body facing the camera (chest view): trunk with neck and head in core, legs, then arms. */
function frontChest(fig: BodyFigure, TF: FrontTrunk, hand: number, c: BodyContext, S: Shape): BodyLayers {
  const F = S.front;
  const { pose, a, b } = fig;
  const Hf = headFrame(fig);
  const palA = palette(c, limbLevels(c, 'a'), false);
  const palB = palette(c, limbLevels(c, 'b'), false);
  const trunkPal = palette(c, c.level, false);
  const rest = mul(TF.u, -1);
  const arms = [frontArm(b, pose.arm2, -hand, rest, TF, palB, trunkPal, F), frontArm(a, pose.arm, hand, rest, TF, palA, trunkPal, F)];
  const legs = [frontLeg(b, pose.leg2, -hand, rest, TF, palB, F, a), frontLeg(a, pose.leg, hand, rest, TF, palA, F, b)];
  const body = mapped(TF, [...F.trunk, ...mirror(F.trunk).reverse().slice(1, -1)]);
  const pair = (list: readonly P2[]) => union([mapped(TF, list), mapped(TF, mirror(list))]);
  const whole = (list: readonly P2[]) => closed(mapped(TF, [...list, ...mirror(list).reverse().slice(1, -1)]));
  const N = F.neck;
  const neck = [...mapped(TF, N.trunk), ...mapped(Hf, N.head), ...mapped(Hf, mirrorFace(N.head).reverse()), ...mapped(TF, mirror(N.trunk).reverse())];
  // Lines across the neck and the shoulders: the sternocleidomastoids from behind the ears to the top of the sternum,
  // and the clavicles out to the acromion.
  const scm = (side: number) => open([Hf.p(side * F.scm[0][0], F.scm[0][1]), Hf.p(side * F.scm[1][0], F.scm[1][1]), TF.p(F.scm[2][0], side * F.scm[2][1])]);
  const core = trunkPal.lv('core');
  // Hair seen past the head and the neck, behind them: the hair over the back of the head and the ponytail on her left
  // (the floor side when she lies on her left side). The tail draws in behind the head as the trunk tips toward the
  // camera, so it never hangs over the chest.
  const hang = smooth((TF.k - 0.3) / 0.4);
  const tail = F.tail && hang > 0.02 ? F.tail.map(([x, y]): P2 => [F.tail![0][0] + (x - F.tail![0][0]) * hang, F.tail![0][1] + (y - F.tail![0][1]) * hang]) : null;
  const hairBack = [...(F.hairBack ? [mapped(Hf, F.hairBack)] : []), ...(tail ? [mapped(Hf, tail)] : [])];
  let o = hairBack.length ? hairMass(union(hairBack), S, trunkPal) : '';
  o += outline(closed(body) + closed(neck) + arms.map((l) => l.root).join('') + legs.map((l) => l.root).join(''), trunkPal);
  o += skin(union([body, neck]), trunkPal);
  o += muscle(pair(F.trap) + pair(F.lat), trunkPal.m('back'), trunkPal);
  // A working oblique spreads in toward the rectus: its inner edge (obliqueInner) moves in.
  const [o0, o1] = F.obliqueInner;
  const oblique = F.oblique.map(([t, x], i): P2 => [t, i >= o0 && i <= o1 ? x - 0.0015 * core : x]);
  o += muscle(pair(oblique) + whole(F.rectus), trunkPal.m('core'), trunkPal);
  o += split(F.rectusLines.map((l) => open(mapped(TF, l)) + (l[0][1] === 0 ? '' : open(mapped(TF, mirror(l))))).join(''), trunkPal, F.rectusLineWidth);
  o += crease(scm(1) + scm(-1) + F.trunkLines.map((l) => open(mapped(TF, l)) + open(mapped(TF, mirror(l)))).join('') + closed(mapped(TF, F.navel)) + (F.cleavage ? open(mapped(TF, F.cleavage)) : ''), 0.0024);
  o += frontHead(fig, trunkPal, S);
  return {
    far: '',
    core: o,
    nearLeg: legs.map((l) => outline(l.edge, l === legs[0] ? palB : palA) + l.skin + l.detail).join(''),
    nearArm: arms.map((l) => outline(l.edge, l === arms[0] ? palB : palA) + l.skin + l.detail).join(''),
  };
}

/** Light on hair: half way from the skin to the outline, so it is lighter than the hair in either theme (warm brown on brown, grey on near-black). */
const SHINE = 'color-mix(in oklab,var(--fig-skin),var(--fig-edge))';
/** A tapered streak along a line of control points: `w` wide at its middle, narrowing to points at both ends. */
function streak(line: readonly P2[], w: number): P2[] {
  const n = line.length;
  const left: P2[] = [];
  const right: P2[] = [];
  for (let i = 1; i < n - 1; i++) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i + 1];
    const l = Math.hypot(x1 - x0, y1 - y0) || 1;
    const k = (w / 2) * Math.sin((Math.PI * i) / (n - 1));
    const [x, y] = line[i];
    left.push([x - ((y1 - y0) / l) * k, y + ((x1 - x0) / l) * k]);
    right.push([x + ((y1 - y0) / l) * k, y - ((x1 - x0) / l) * k]);
  }
  return [line[0], ...left, line[n - 1], ...right.reverse()];
}

/**
 * The head bowed toward a camera above: the crown and the hair, the hairline and the forehead below it with the brows
 * and the lowered lids, the ears at the sides. Her hair tied back shows as a knot beyond the crown; it and her parting
 * fade with `fade` while the chest view crossfades in.
 */
function bowedHead(fig: BodyFigure, pal: Palette, S: Shape, fade: number): string {
  const F = S.front;
  const B = F.back;
  const Hf = headFrame(fig);
  const ears = path(closed(mapped(Hf, B.ear)) + closed(mapped(Hf, mirrorFace(B.ear))), `fill="${pal.skin}" stroke="${pal.line}" stroke-width="${num(W * 0.7)}"`);
  // Her hair stands off the skull, tied in a knot at the nape: the knot beyond the crown, then the crown's hair over it,
  // each edged by one line (the crown passes in front of the knot), the hair over the head reaching out to the same
  // edge and covering the skull's own outline.
  let o = B.knot ? hairMass(closed(mapped(Hf, B.knot)), S, pal, fade) + hairMass(closed(mapped(Hf, B.hair)), S, pal) : '';
  o += solid(closed(mapped(Hf, B.head)), pal) + (F.earUnder ? ears : '');
  o += path(closed(mapped(Hf, B.hair)), `fill="${S.hairFill}"`);
  if (B.part) o += path(open(mapped(Hf, B.part)), `fill="none" stroke="${pal.skin}" stroke-width=".0022" stroke-linecap="round"${fade < 1 ? ` opacity="${num(fade)}"` : ''}`);
  // Light catches the hair over the far part of the crown, clear of its edge, and his hair turns out from the whorl, so
  // dark hair reads as hair on a skull rather than a ball.
  for (const b of B.sheen) o += path(closed(mapped(Hf, b)), `fill="${SHINE}" fill-opacity=".4"`);
  if (B.strands) o += path(B.strands.map((l) => closed(mapped(Hf, streak(l, 0.0036)))).join(''), `fill="${SHINE}" fill-opacity=".42"`);
  o += F.earUnder ? '' : ears;
  return o + path(B.face.map((f) => closed(mapped(Hf, f)) + closed(mapped(Hf, mirrorFace(f)))).join(''), 'fill="var(--fig-face)"');
}

/**
 * The back seen from above, bent over toward a camera above the lifter: the hips beyond the shoulders at the top of
 * the picture (the buttocks), the lower back, the lats, the shoulder blades and the trapezius, the head bowed between
 * the shoulders, the arms hanging down the picture from the deltoid caps, and the legs behind it all.
 */
function frontBack(fig: BodyFigure, TF: FrontTrunk, hand: number, c: BodyContext, S: Shape, fade: number): BodyLayers {
  const F = S.front;
  const B = F.back;
  const { pose, a, b } = fig;
  const palA = palette(c, limbLevels(c, 'a'), false);
  const palB = palette(c, limbLevels(c, 'b'), false);
  const trunkPal = palette(c, c.level, false);
  // The legs stand far back under the body, in its shade: drawn as far limbs are.
  const farA = palette(c, limbLevels(c, 'a'), true);
  const farB = palette(c, limbLevels(c, 'b'), true);
  // The limbs hang down the picture, away from the hips.
  const rest = TF.u;
  const arms = [frontArm(b, pose.arm2, hand, rest, TF, palB, null, F, B.upperArm, B.deltoid), frontArm(a, pose.arm, -hand, rest, TF, palA, null, F, B.upperArm, B.deltoid)];
  const legs = [frontLeg(b, pose.leg2, hand, rest, TF, farB, F, a), frontLeg(a, pose.leg, -hand, rest, TF, farA, F, b)];
  const body = mapped(TF, [...B.trunk, ...mirror(B.trunk).reverse().slice(1, -1)]);
  const pair = (list: readonly P2[]) => union([mapped(TF, list), mapped(TF, mirror(list))]);
  const whole = (list: readonly P2[]) => closed(mapped(TF, [...list, ...mirror(list).reverse().slice(1, -1)]));
  let o = outline(closed(body) + arms.map((l) => l.root).join(''), trunkPal) + skin(closed(body), trunkPal);
  o += muscle(pair(B.glute), trunkPal.m('glutes'), trunkPal);
  // A few masses that follow the back's contour: the lats as wings from the armpits down over the lower back to the
  // spine (the erectors under them), a shoulder blade each side, and the trapezius as a diamond along the spine.
  o += muscle(pair(B.wing) + pair(B.scapula) + whole(B.trap), trunkPal.m('back'), trunkPal);
  o += crease(open(mapped(TF, B.spine)) + open(mapped(TF, B.cleft)), 0.0024);
  o += bowedHead(fig, trunkPal, S, fade);
  return {
    far: legs.map((l, i) => outline(l.root + l.edge, i ? farA : farB) + l.skin + l.detail).join(''),
    core: o,
    nearLeg: '',
    nearArm: arms.map((l, i) => outline(l.edge, i ? palA : palB) + l.skin + l.detail).join(''),
  };
}

function drawFront(fig: BodyFigure, c: BodyContext, S: Shape): BodyLayers {
  const { pose, a, b } = fig;
  const Hm = mid(a.hip, b.hip);
  const Sm = mid(a.shoulder, b.shoulder);
  const v = sub(Sm, Hm);
  const L = len(v);
  const k = L > 1e-6 ? clamp(L / 0.288, 0.2, 1.5) : 0.2;
  /** The trunk's frame; a trunk seen exactly end-on takes the way its view points it (the chest view up, the back view down). */
  const frame = (fallback: number) => {
    const u = L > 1e-6 ? mul(v, 1 / L) : dir(fallback);
    const side = rot90(u);
    const hand = dot(side, sub(b.shoulder, a.shoulder)) < 0 ? -1 : 1;
    const across = mul(side, hand);
    // t is foreshortened with the trunk all the way up: a trunk tipped toward the camera tips the neck too (see solve).
    const TF: FrontTrunk = { u, k, p: (t, x) => V(Hm.x + u.x * t * k + across.x * x, Hm.y + u.y * t * k + across.y * x) };
    return { TF, hand };
  };
  // A trunk tipped toward the camera shows its chest while it still points up the picture (a level camera,
  // torsoScale > 0), and its back once tipped past the camera's line of sight (a camera above, torsoScale < 0); seen
  // nearly end-on in between, the two crossfade.
  const chest = smooth((pose.torsoScale + 0.25) / 0.5);
  const up = frame(pose.torso);
  if (chest >= 1) return frontChest(fig, up.TF, up.hand, c, S);
  const down = frame(pose.torso + 180);
  const back = frontBack(fig, down.TF, down.hand, c, S, (1 - chest) ** 2);
  if (chest <= 0) return back;
  const front = frontChest(fig, up.TF, up.hand, c, S);
  return { far: back.far, core: back.core + `<g opacity="${num(chest)}">${front.core}</g>`, nearLeg: back.nearLeg, nearArm: back.nearArm };
}

/* =========================================================================
   SHAPE SETS
   ========================================================================= */
/* ---------------- front view shapes ----------------
   Measured as a share of height (ANSUR anthropometry, Winter 2009), on the skeleton's joints (shoulders at
   ±L.shoulderHalf, hips at ±L.hipHalf). Outline paths sit W inside the skin's visible edge. His: shoulders (deltoid to
   deltoid) 0.28, chest 0.18, waist 0.165, hips 0.198, neck 0.07, head 0.09 (0.106 with the ears). Hers: shoulders
   0.265, chest 0.17, waist 0.15, hips 0.214 (her hipFlare below the iliac crest), neck 0.062, head 0.088. Where a body
   lies on the floor on its side (the outer hip, the edge of the foot, the elbow, the fist) her outline reaches as far
   from the bone as his: her fuller hip settles flat where it faces the floor. */
/**
 * Bone to skin in the front view, where the lying front-view patterns rest a body on the floor (or the head on the
 * arm): a part placed this far from the surface touches it with its outline, the middle of the drawn line between on
 * the surface and the line's half-width (W) off it, for both bodies (the rest tests and tools/demo-sheets measure it).
 * A fist rests by BODY.hand, as in the side view.
 */
export const FRONT_SKIN = {
  /** Lying on the side: the outer hip over the trochanter (both bodies, within the outline's width). */
  hip: 0.043,
  /** The side of the pelvis at the iliac crest, 0.06 above the hip joint, where a hand rests on the hip. */
  crest: 0.031,
  /** The outer edge of the foot from the ankle. */
  foot: 0.035,
  /**
   * Legs stacked on their side, the top one resting on the bottom one: the inner side of the knee and of the ankle (the
   * malleolus), where the two touch. Both bodies reach at least this far, so their legs press together there (see
   * pressing).
   */
  knee: 0.0345,
  ankle: 0.023,
  /** The point of the elbow, along the upper arm past the elbow joint (a side plank rests on it). */
  elbow: 0.03,
  /** The side of the head, the ear and the hair. */
  head: 0.059,
  /** The outer side of the upper arm half way down, where a head rests on it. */
  upperArm: 0.027,
  /** An arm lying on its inner side: the forearm below the elbow, at the wrist, and a flat palm. */
  forearm: 0.025,
  wrist: 0.0135,
  palm: 0.0087,
};

/** One body's front-view shapes: [t, x] trunk lists (t up from the hips, x out), [t, d] limb lists in their rest pose (t along the limb, d out), [x, y] head lists. */
interface FrontShape {
  trunk: P2[];
  neck: { trunk: P2[]; head: P2[] };
  /** Behind the ear to the top of the sternum: two head points, then a trunk point. */
  scm: [P2, P2, P2];
  /** Clavicles and other lines on the trunk (drawn on both sides). */
  trunkLines: P2[][];
  trap: P2[];
  lat: P2[];
  oblique: P2[];
  /** The oblique's inner edge beside the rectus, from obliqueInner[0] to obliqueInner[1]: it spreads in as the core works. */
  obliqueInner: [number, number];
  rectus: P2[];
  /** The linea alba (on the midline, once, the rectus's full length) and at most two tendinous lines (both sides). */
  rectusLines: P2[][];
  rectusLineWidth: number;
  navel: P2[];
  upperArm: P3[];
  /** The arm's own outline runs from capArc[0] round the elbow to capArc[1]; the rest (the cap's top) is under the trunk's skin. */
  capArc: [number, number];
  forearm: P2[];
  fist: P2[];
  fistLines: P2[][];
  flatHand: P2[];
  flatLines: P2[][];
  pec: P3[];
  /** The fold under the chest, along its lower edge (and other lines on it). */
  pecFold: P3[][];
  /** A line down the middle of the chest, drawn once (between her busts). */
  cleavage?: P2[];
  deltoid: P2[];
  deltSplit: P2[];
  biceps: P2[];
  triceps: P2[];
  foreCrease: P2[];
  elbowCrease: P2[];
  thigh: P2[];
  /** Her hip and upper outer thigh stand out this much further below the iliac crest (see hipBump), except where she lies on them. */
  hipFlare?: number;
  /**
   * The leg's own outline runs from hipArc[0] round the knee to hipArc[1], ending just short of the crotch so the two
   * inner thighs meet in one point; the rest (the groin, the crest) is under the trunk's skin.
   */
  hipArc: [number, number];
  shin: P2[];
  foot: P2[];
  toeLines: P2[][];
  glute: P2[];
  quads: P2[][];
  calves: P2[][];
  patella: P2[];
  groin: P2[];
  head: P2[];
  ear: P2[];
  earUnder?: boolean;
  hair: P2[];
  part?: P2[];
  /** Hair seen past the head and neck (tied back), painted behind them with its own outline, and the ponytail past the neck. */
  hairBack?: P2[];
  tail?: P2[];
  facePair: P2[][];
  faceMid: P2[][];
  faceLines: P2[][];
  /** Bent over, seen from above (frontBack): the back's half outline and muscles ([t, x] in the trunk's frame), the arm without the chest's fold, the bowed head ([x, y], y toward the nape). */
  back: {
    trunk: P2[];
    glute: P2[];
    /** The lat as a wing from the armpit down over the lower back to the spine (the erectors under it). */
    wing: P2[];
    scapula: P2[];
    trap: P2[];
    spine: P2[];
    cleft: P2[];
    upperArm: P3[];
    /** The deltoid seen from behind: its rear head, the main mover of a rear delt fly, wraps further round the back of the shoulder. */
    deltoid: P2[];
    head: P2[];
    hair: P2[];
    part?: P2[];
    knot?: P2[];
    /**
     * Light on the hair over the far part of the crown, a band of dark hair clear of its edge: bands painted over each
     * other, so it is brightest in the middle and soft at its edges.
     */
    sheen: P2[][];
    /** His whorl: the middle lines of a few tapered strands (see streak) turning out from it toward the hairline and the temples. */
    strands?: P2[][];
    ear: P2[];
    face: P2[][];
  };
}

const SHX = L.shoulderHalf;
const HPX = L.hipHalf;
/** A trunk point as a point of the arm's table (rest pose) on that side. */
const armAt = ([t, x, w]: P3): P3 => [L.torso - t, x - SHX, w];
/** A point of the back view's trunk as a point of the arm's table there (the arm hangs down the picture, away from the hips). */
const armBackAt = ([t, x, w]: P3): P3 => [t - L.torso, x - SHX, w];
/** A trunk point as a point of the leg's table (rest pose) on that side. */
const legAt = ([t, x]: P2): P2 => [-t, x - HPX];

// ---- his ----
// The trunk: under the neck, the trapezius to the acromion, under the shoulder (the arm covers it), the lats and the
// rib cage to the waist, the flank over the iliac crest, then in under the thigh (the leg covers it) to the crotch.
const TRUNK_FM: P2[] = [
  [0.342, 0.0], [0.34, 0.019], [0.335, 0.031], // 0-2 under the neck
  [0.33, 0.045], [0.324, 0.06], [0.318, 0.074], [0.313, 0.086], [0.309, 0.096], // 3-7 trapezius to the acromion
  [0.302, 0.105], [0.288, 0.11], [0.266, 0.106], [0.246, 0.1], // 8-11 over the joint and under the shoulder (the arm covers it)
  [0.228, 0.095], [0.206, 0.0925], [0.182, 0.089], [0.158, 0.0845], [0.134, 0.08], [0.112, 0.0772], [0.09, 0.0772], // 12-18 lats, ribs, waist
  [0.072, 0.0795], [0.058, 0.0805], // 19-20 the flank over the iliac crest
  [0.042, 0.077], [0.02, 0.069], [-0.004, 0.058], [-0.028, 0.043], [-0.047, 0.023], [-0.058, 0.007], [-0.06, 0.0], // 21-27 under the thigh
];
// The upper arm hanging: on the trapezius line (= trunk 6-7), the deltoid's curve over the joint to its insertion, the
// outer arm, the elbow, the inner arm up to the armpit, and under the cap (inside the trunk) back to the start.
const UARM_FM: P3[] = [
  armAt(TRUNK_FM[6]), armAt(TRUNK_FM[7]), // 0-1 on the trapezius line, to the acromion
  [-0.018, 0.002], [-0.012, 0.0125], [-0.003, 0.0215], [0.009, 0.0275], [0.024, 0.0298], [0.044, 0.0288], [0.066, 0.0255], // 2-8 the cap: the deltoid over the joint
  [0.09, 0.0215], [0.12, 0.0212], [0.148, 0.021], [0.172, 0.0195], [0.19, 0.0192], // 9-13 its insertion, the outer arm
  [0.205, 0.0165], [0.214, 0.006], [0.213, -0.008], [0.2, -0.0205], // 14-17 the elbow
  [0.18, -0.0245], [0.152, -0.0268], [0.122, -0.028], [0.096, -0.0285], [0.078, -0.0282], // 18-22 inner arm
  // 23-26 the front fold of the armpit along the chest's lower border (it stretches from the chest to the arm as the
  // arm rises), 27-29 back under the chest and the cap (inside the trunk)
  [0.064, -0.026, 0.5], [0.082, -0.04, 0.22], [0.098, -0.056, 0.07], [0.106, -0.07, 0], [0.06, -0.07, 0], [0.025, -0.05, 0], [0.0, -0.03, 0],
];
const FOREARM_FM: P2[] = [
  [-0.018, 0.016], [0.0, 0.0205], [0.025, 0.0235], [0.05, 0.022], [0.08, 0.018], [0.11, 0.0145], [0.135, 0.0125], [0.148, 0.0125], // 0-7 outer
  [0.158, 0.007], [0.159, -0.004], [0.152, -0.0115], // 8-10 wrist
  [0.135, -0.0125], [0.11, -0.014], [0.08, -0.0175], [0.05, -0.021], [0.025, -0.022], [0.0, -0.0205], [-0.016, -0.016], // 11-17 inner
  [-0.024, -0.004], [-0.022, 0.008], // 18-19 under the upper arm
];
// The chest: the pectoral from the clavicle and the sternum, its lower border rising to the front fold of the armpit and
// on under the deltoid to the arm (trunk points, as the arm's table).
const PEC_FM: P3[] = ([
  [0.285, 0.008, 0], [0.29, 0.03, 0], [0.29, 0.052, 0], [0.286, 0.07, 0.02], [0.276, 0.083, 0.25], [0.262, 0.094, 0.6], [0.246, 0.099, 0.9], [0.234, 0.094, 1],
  [0.227, 0.0775, 0.5], [0.209, 0.0635, 0.22], [0.193, 0.0478, 0.07], [0.185, 0.034, 0], [0.181, 0.02, 0], [0.184, 0.008, 0], [0.21, 0.0055, 0], [0.25, 0.0055, 0],
] as P3[]).map(armAt);
// Every deltoid table (his, hers, and both seen from behind) has this layout: 0-3 along the clavicle to the acromion,
// 4-12 round the cap, 13-14 the insertion, 15-20 the front border. A working deltoid swells outward round the cap
// (DELT_CAP) and inward along its front border (DELT_FRONT), into the skin bands round it.
const DELT_CAP: [number, number] = [5, 12];
const DELT_FRONT: [number, number] = [16, 19];
const DELT_FM: P2[] = [
  [-0.006, -0.0385], [-0.012, -0.023], [-0.016, -0.012], [-0.017, -0.003], // along the clavicle's outer third to the acromion
  [-0.013, 0.006], [-0.006, 0.015], [0.003, 0.0219], [0.013, 0.0271], [0.027, 0.0292], [0.046, 0.0282], [0.066, 0.025], [0.086, 0.021], [0.102, 0.017], // round the cap
  [0.117, 0.0112], [0.122, 0.0035], // the insertion, half way down the arm
  [0.108, -0.0082], [0.09, -0.0182], [0.068, -0.0272], [0.046, -0.034], [0.024, -0.0386], [0.006, -0.0402], // the front border (the deltopectoral groove)
];
const BICEPS_FM: P2[] = [[0.072, -0.013], [0.095, -0.0045], [0.125, 0.0015], [0.153, 0.0025], [0.174, -0.0005], [0.186, -0.007], [0.187, -0.0135], [0.176, -0.0195], [0.15, -0.0225], [0.12, -0.0232], [0.094, -0.0212], [0.078, -0.0172]];
const TRICEPS_FM: P2[] = [[0.096, 0.0186], [0.12, 0.019], [0.148, 0.0188], [0.17, 0.0173], [0.181, 0.0155], [0.17, 0.0112], [0.145, 0.0098], [0.12, 0.0108], [0.103, 0.0135]];
// The thigh from the iliac crest (= trunk 19): the outer hip over the trochanter, the outer thigh, the knee, the inner
// thigh (the vastus medialis above the knee, the adductors) up to the crotch, and the groin line back to the crest.
const THIGH_FM: P2[] = [
  legAt(TRUNK_FM[20]), [-0.042, 0.0285], [-0.022, 0.0328], [0.0, 0.0364], [0.022, 0.0385], // 0-4 the hip
  [0.05, 0.0376], [0.085, 0.0352], [0.12, 0.0325], [0.155, 0.029], [0.188, 0.0255], [0.215, 0.0225], [0.238, 0.021], // 5-11 outer thigh
  [0.258, 0.0195], [0.27, 0.007], [0.27, -0.012], [0.258, -0.0285], // 12-15 the knee
  [0.238, -0.034], [0.218, -0.037], [0.2, -0.0372], [0.18, -0.0365], [0.155, -0.038], [0.125, -0.0418], [0.095, -0.0465], [0.072, -0.0508], [0.058, -0.0535], // 16-24 inner thigh
  [0.04, -0.045], [0.016, -0.028], [-0.01, -0.0105], [-0.034, 0.007], [-0.05, 0.0175], // 25-29 the groin line up to the crest
];
const SHIN_FM: P2[] = [
  [-0.03, 0.0195], [-0.008, 0.0225], [0.018, 0.0285], [0.04, 0.0322], [0.065, 0.0318], [0.095, 0.0282], [0.13, 0.0232], [0.168, 0.0182], [0.2, 0.0152], [0.222, 0.0155], // 0-9 outer: the lateral calf, high
  [0.236, 0.0182], [0.25, 0.0168], [0.258, 0.008], [0.258, -0.008], // 10-13 the outer ankle, low, into the foot
  [0.248, -0.0155], [0.23, -0.0205], [0.212, -0.0172], [0.182, -0.0185], [0.148, -0.0238], [0.115, -0.0318], [0.088, -0.0345], [0.062, -0.0342], [0.036, -0.032], [0.01, -0.0315], // 14-23 inner: the ankle (higher), the medial calf (lower)
  [-0.016, -0.0328], [-0.034, -0.028], // 24-25 the knee
];
// The foot pointing at the camera (from the ankle down to the floor at 0.035): the outer edge, the toes along the floor
// (their outline's edge on it), the big toe and the arch up to the inner ankle.
const FOOT_FM: P2[] = [
  [-0.004, 0.0168], [0.012, 0.0222], [0.022, 0.0274], [0.0268, 0.0296], // the outer edge to the little toe
  [0.0282, 0.025], [0.0286, 0.017], [0.0289, 0.009], [0.0291, 0.0], [0.0292, -0.008], [0.0292, -0.0165], // the toes along the floor
  [0.0286, -0.0255], [0.0248, -0.0298], [0.0145, -0.0278], [0.004, -0.0225], [-0.008, -0.0195], // the big toe, its ball, the arch
];
// The hip's abductors on its outer side, from the iliac crest down past the trochanter: gluteus medius, with the
// tensor of the fascia lata in front of it toward the front of the hip.
const GLUTE_FM: P2[] = [
  [-0.056, 0.0232], [-0.042, 0.0262], [-0.022, 0.0305], [0.0, 0.0341], [0.022, 0.0362], [0.046, 0.0354], [0.07, 0.0332], // along the outer hip
  [0.08, 0.0255], [0.066, 0.0148], [0.044, 0.0068], [0.018, 0.0012], [-0.01, -0.0008], [-0.034, 0.0042], [-0.05, 0.0128], // its front edge
];
const QUADS_FM: P2[][] = [
  // vastus lateralis down the outer thigh
  [[0.088, 0.0328], [0.12, 0.0302], [0.155, 0.0268], [0.188, 0.0233], [0.212, 0.0203], [0.224, 0.0165], [0.215, 0.0105], [0.185, 0.0075], [0.145, 0.0068], [0.11, 0.0098], [0.088, 0.0175], [0.082, 0.026]],
  // rectus femoris down the middle
  [[0.035, -0.0035], [0.07, 0.0015], [0.11, 0.0035], [0.15, 0.0022], [0.188, -0.0028], [0.21, -0.0085], [0.203, -0.0158], [0.172, -0.0195], [0.132, -0.0205], [0.092, -0.0188], [0.056, -0.013]],
  // vastus medialis, the teardrop above the inner knee
  [[0.142, -0.0352], [0.168, -0.0338], [0.192, -0.035], [0.212, -0.0348], [0.226, -0.0305], [0.23, -0.0225], [0.219, -0.0168], [0.198, -0.019], [0.174, -0.0235], [0.155, -0.029]],
];
const CALVES_FM: P2[][] = [
  // the lateral head, high on the outer side
  [[0.004, 0.0222], [0.022, 0.0265], [0.044, 0.03], [0.07, 0.0292], [0.1, 0.0254], [0.122, 0.0218], [0.108, 0.0172], [0.08, 0.0158], [0.052, 0.0162], [0.026, 0.0178], [0.01, 0.0196]],
  // the medial head, lower on the inner side
  [[0.018, -0.0296], [0.04, -0.0305], [0.064, -0.0322], [0.09, -0.0323], [0.116, -0.0296], [0.14, -0.0245], [0.13, -0.0205], [0.105, -0.0228], [0.078, -0.0245], [0.05, -0.0242], [0.028, -0.0238]],
];
// The knee: a short crease under the kneecap (the vastus medialis bulges above it on the inside).
const PATELLA_FM: P2[] = [[0.2405, 0.0055], [0.2525, -0.0025], [0.2548, -0.0135], [0.2468, -0.0235]];
const GROIN_FM: P2[] = [[0.03, -0.0385], [0.008, -0.0222], [-0.016, -0.0062], [-0.034, 0.0065]];
const TRAP_FM: P2[] = [...runOf(TRUNK_FM, 2, 7), [0.302, 0.09], [0.302, 0.079], [0.307, 0.064], [0.314, 0.051], [0.322, 0.041], [0.329, 0.034]];
const LAT_FM: P2[] = [...runOf(TRUNK_FM, 12, 16), [0.138, 0.0752], [0.16, 0.0785], [0.184, 0.082], [0.206, 0.0853], [0.222, 0.0878]];
// External oblique filling the flank under the serratus slips, from the side of the rib cage and the waist in to a
// narrow skin band beside the rectus (the linea semilunaris), its foot on the crest and the groin. The rectus is a long
// strap from the pubis to the rib margin: a broad, flat top along the costal arch (under the pectorals when they hang),
// its sides nearly parallel down past the navel, narrowing only below it to the pubis.
const OBLIQUE_FM: P2[] = [
  [0.204, 0.0815], [0.196, 0.0738], [0.19, 0.0795], [0.182, 0.0712], [0.175, 0.0768], [0.166, 0.0682],
  [0.15, 0.0572], [0.128, 0.0502], [0.104, 0.0488], [0.08, 0.0492], [0.06, 0.0522], [0.045, 0.0592], [0.046, 0.0705], [0.056, 0.0762],
  [0.072, 0.0762], [0.09, 0.0742], [0.112, 0.0745], [0.134, 0.0772], [0.158, 0.0812], [0.182, 0.0848],
];
const RECTUS_FM: P2[] = [
  [0.193, 0.0], [0.193, 0.018], [0.1915, 0.0335], [0.186, 0.0432], [0.168, 0.046], [0.14, 0.0465], [0.11, 0.0462], [0.086, 0.0452],
  [0.062, 0.042], [0.036, 0.0362], [0.01, 0.0282], [-0.012, 0.0192], [-0.027, 0.0098], [-0.033, 0.0],
];
const HEAD_FM: P2[] = both([
  [0.0, 0.0625], [0.0225, 0.0598], [0.0368, 0.0505], [0.0438, 0.0352], [0.0458, 0.0182], [0.0448, 0.0018], [0.0428, -0.0138], [0.0398, -0.0268],
  [0.0368, -0.0388], [0.0298, -0.0488], [0.0198, -0.0575], [0.0095, -0.0636], [0.0, -0.0655],
]);
// The ears close to the head, standing out a little from it (the head with ears about 0.106 of height across).
const EAR_FM: P2[] = [[0.0432, 0.0125], [0.0478, 0.0148], [0.0512, 0.0074], [0.051, -0.006], [0.0481, -0.0178], [0.0428, -0.0225]];
// Short hair over the crown, cut above the ears, its hairline back from the temples.
const HAIR_FM: P2[] = both([
  [0.0, 0.0672], [0.0248, 0.0642], [0.0405, 0.0535], [0.0482, 0.0372], [0.0496, 0.0212], [0.0478, 0.0105],
  [0.0446, 0.0138], [0.0418, 0.0262], [0.0352, 0.0365], [0.0245, 0.0425], [0.012, 0.0452], [0.0, 0.0458],
]);
// The eyes open: an almond about twice as wide as it is tall, so it reads as an open eye even a few pixels across (as
// the profile's eye does), under the brow.
const FACE_PAIR_FM: P2[][] = [
  [[0.01, 0.0061], [0.0162, 0.0098], [0.0236, 0.0066], [0.0168, 0.0028]],
  [[0.0068, 0.0162], [0.0172, 0.0194], [0.0282, 0.0172], [0.0278, 0.0144], [0.0172, 0.0162], [0.0075, 0.0134]],
];
const FACE_MID_FM: P2[][] = [
  [[-0.0062, -0.0196], [-0.002, -0.0215], [0.002, -0.0215], [0.0062, -0.0196], [0.0, -0.0178]],
  [[-0.0128, -0.0352], [0.0, -0.0372], [0.0128, -0.0352], [0.0, -0.0342]],
];
// The side of the nose and the fold of the cheek.
const FACE_LINES_FM: P2[][] = [[[0.0045, -0.003], [0.0052, -0.012], [0.0068, -0.0185]]];

/** The deltoid as seen from behind: the rear head fuller toward the shoulder blade, the insertion a little lower down the arm. */
const rearDeltoid = (list: readonly P2[]): P2[] => list.map(([t, d]) => [t + 0.007 * clamp((t - 0.06) / 0.05, 0, 1), d < 0 ? d * 1.12 : d]);

// Bent over, seen from above. The back: the buttocks at the far end (top), the hips into the waist, the lats out to
// the armpits, the deltoid caps (the arm's table), the trapezius to the neck under the bowed head.
const BACK_FM: P2[] = [
  [-0.19, 0.0], [-0.198, 0.016], [-0.205, 0.036], [-0.2, 0.058], [-0.183, 0.077], [-0.148, 0.09], // 0-5 the buttocks, either side of the cleft
  [-0.09, 0.094], [-0.03, 0.087], [0.035, 0.0798], [0.085, 0.079], // 6-9 hips to the waist
  [0.13, 0.086], [0.175, 0.096], [0.212, 0.104], [0.24, 0.106], // 10-13 the lats to the armpit
  [0.264, 0.098], [0.262, 0.086], // 14-15 the cap's top (the arm's table)
  [0.28, 0.072], [0.298, 0.058], [0.318, 0.047], [0.338, 0.038], [0.36, 0.032], [0.39, 0.02], [0.41, 0.0], // 16-22 the trapezius to the neck
];
// The hanging arm without the chest's fold: its inner side runs straight up under the cap. Seen from behind and above,
// the shoulder's mound is the rear deltoid over the back of the joint, rising further toward the hips than the cap's
// top seen from the front (2-4), from the side of the back round to the deltoid's widest point.
const UARM_BACK_FM: P3[] = [armBackAt(BACK_FM[15] as P3), armBackAt(BACK_FM[14] as P3), [-0.0288, 0.005], [-0.019, 0.016], [-0.009, 0.024], ...UARM_FM.slice(5, 23), [0.05, -0.028], [0.02, -0.03], [-0.006, -0.026]];
/** The rear deltoid seen from behind (rearDeltoid), its top round the cap (4-6) following the mound over the back of the joint. */
const DELT_BACK_FM: P2[] = rearDeltoid(DELT_FM).map((p, i): P2 => ([[-0.0197, 0.007], [-0.0135, 0.0155], [-0.005, 0.0205]] as P2[])[i - 4] ?? p);
const BACK_VIEW_M: FrontShape['back'] = {
  trunk: BACK_FM,
  glute: [[-0.19, 0.0085], [-0.197, 0.02], [-0.201, 0.037], [-0.195, 0.057], [-0.178, 0.073], [-0.145, 0.0845], [-0.118, 0.085], [-0.128, 0.068], [-0.142, 0.048], [-0.152, 0.028], [-0.158, 0.012]],
  // The lat from the armpit along the side and over the lower back to the spine, its upper border under the shoulder blade.
  wing: [
    [0.228, 0.1005], [0.205, 0.0985], [0.18, 0.0928], [0.15, 0.0855], [0.12, 0.0792], [0.09, 0.0752], [0.06, 0.0732], [0.03, 0.0725], [0.0, 0.0705], // along the side
    [-0.035, 0.0595], [-0.06, 0.0425], [-0.075, 0.0245], [-0.08, 0.0098], // over the lower back to the sacrum
    [-0.05, 0.0072], [0.0, 0.0072], [0.05, 0.0082], [0.085, 0.0102], // up beside the spine
    [0.105, 0.0185], [0.125, 0.0345], [0.145, 0.0565], [0.163, 0.0752], [0.185, 0.0895], [0.207, 0.0962], // under the shoulder blade to the armpit
  ],
  // Each shoulder blade: infraspinatus and teres below the spine of the scapula, from its medial border to the armpit.
  scapula: [[0.252, 0.0585], [0.257, 0.074], [0.255, 0.0875], [0.241, 0.0972], [0.219, 0.0952], [0.197, 0.0858], [0.176, 0.0728], [0.162, 0.0605], [0.172, 0.0512], [0.196, 0.0462], [0.224, 0.0458], [0.243, 0.0498]],
  // The trapezius: from the neck out along the shoulders to the acromion, along the spines of the scapulae, and down
  // to its point in the middle of the back.
  trap: [[0.405, 0.0], [0.388, 0.016], [0.362, 0.028], [0.336, 0.037], [0.312, 0.05], [0.292, 0.066], [0.276, 0.082], [0.264, 0.08], [0.258, 0.066], [0.252, 0.052], [0.24, 0.0425], [0.212, 0.0335], [0.178, 0.0232], [0.142, 0.0132], [0.114, 0.0055], [0.098, 0.0]],
  spine: [[0.33, 0.0], [0.2, 0.0], [0.06, 0.0], [-0.075, 0.0]],
  cleft: [[-0.19, 0.0], [-0.17, 0.0], [-0.15, 0.0]],
  upperArm: UARM_BACK_FM,
  deltoid: DELT_BACK_FM,
  head: both([[0.0, 0.056], [0.0245, 0.0525], [0.0395, 0.0425], [0.0465, 0.0265], [0.0475, 0.0075], [0.0445, -0.0125], [0.0385, -0.0305], [0.0285, -0.0445], [0.0155, -0.0535], [0.0, -0.0565]]),
  hair: both([[0.0, 0.0595], [0.026, 0.056], [0.0428, 0.0455], [0.0505, 0.0285], [0.0515, 0.008], [0.0482, -0.0075], [0.0446, -0.0088], [0.0412, -0.0128], [0.0338, -0.0212], [0.022, -0.0265], [0.01, -0.0288], [0.0, -0.0292]]),
  ear: [[0.0442, -0.0085], [0.0512, -0.0065], [0.0545, -0.0158], [0.0526, -0.0285], [0.0468, -0.0352], [0.0418, -0.0302]],
  // Light over the far part of the crown round the whorl (0.0058, 0.0205), a band of dark hair clear of its edge: a broad
  // band reaching in toward the whorl, and over it the light the locks catch, their tips pointing in at it.
  sheen: [
    [[0.0455, 0.0219], [0.0412, 0.0363], [0.0312, 0.0468], [0.0184, 0.0516], [0.0058, 0.0532], [-0.0075, 0.0533], [-0.0233, 0.0507], [-0.0387, 0.0403], [-0.0454, 0.0223], [-0.0331, 0.0347], [-0.0065, 0.0352], [0.0058, 0.0252], [0.0152, 0.0317], [0.0348, 0.0311]],
    [[0.0438, 0.0258], [0.0388, 0.0384], [0.0288, 0.047], [0.0171, 0.0508], [0.0058, 0.0522], [-0.0061, 0.0525], [-0.0203, 0.0506], [-0.0352, 0.0428], [-0.0435, 0.0274], [-0.0338, 0.039], [-0.0174, 0.0414], [-0.0092, 0.0454], [0.0018, 0.0364], [0.0074, 0.0436], [0.0121, 0.0362], [0.0232, 0.0428], [0.0278, 0.0365], [0.038, 0.0335]],
  ],
  // The hair turns out from the whorl, each strand bending a little round it, on over the skull to the hairline and the
  // temples.
  strands: [
    [[0.002, 0.0134], [-0.001, 0.0042], [-0.0022, -0.0056], [-0.0016, -0.0158], [0.0009, -0.0259]],
    [[0.0069, 0.0126], [0.0097, 0.0044], [0.014, -0.0032], [0.0198, -0.0101], [0.0269, -0.0161]],
    [[0.0112, 0.0146], [0.0179, 0.0094], [0.0257, 0.0055], [0.0343, 0.003], [0.0435, 0.0021]],
    [[-0.0017, 0.0178], [-0.0114, 0.0123], [-0.02, 0.005], [-0.0273, -0.004], [-0.033, -0.0144]],
  ],
  face: [
    [[0.0058, -0.0408], [0.016, -0.038], [0.0272, -0.0398], [0.0268, -0.0421], [0.016, -0.0404], [0.0068, -0.0428]],
    [[0.0085, -0.0496], [0.016, -0.0484], [0.0236, -0.0494], [0.016, -0.0509]],
  ],
};

const FRONT_M: FrontShape = {
  trunk: TRUNK_FM,
  neck: { trunk: [[0.3, 0.0288], [0.326, 0.0292]], head: [[0.0298, -0.048], [0.0285, -0.028]] },
  scm: [[0.036, -0.026], [0.024, -0.058], [0.293, 0.009]],
  trunkLines: [[[0.292, 0.009], [0.296, 0.032], [0.293, 0.056], [0.297, 0.079], [0.3, 0.094]]],
  trap: TRAP_FM,
  lat: LAT_FM,
  oblique: OBLIQUE_FM,
  obliqueInner: [6, 11],
  rectus: RECTUS_FM,
  rectusLines: [[[0.19, 0.0], [-0.022, 0.0]], [[0.155, 0.0425], [0.151, 0.022], [0.157, 0.0]], [[0.119, 0.0445], [0.115, 0.022], [0.121, 0.0]]],
  rectusLineWidth: 0.0036,
  navel: [[0.072, -0.003], [0.068, 0.0], [0.072, 0.003], [0.076, 0.0]],
  upperArm: UARM_FM,
  capArc: [5, 22],
  forearm: FOREARM_FM,
  fist: [[0.004, -0.0185], [0.0, -0.006], [0.004, 0.009], [0.016, 0.019], [0.036, 0.0215], [0.054, 0.0175], [0.0625, 0.004], [0.0605, -0.0115], [0.05, -0.0205], [0.03, -0.0222], [0.014, -0.0215]],
  fistLines: [[[0.012, 0.0128], [0.028, 0.0145], [0.043, 0.0095], [0.05, -0.001]]],
  flatHand: FLAT_HAND,
  flatLines: THUMB_LINE,
  pec: PEC_FM,
  pecFold: [([[0.18, 0.006, 0], [0.1755, 0.02, 0], [0.1765, 0.035, 0], [0.184, 0.05, 0.03], [0.196, 0.064, 0.15]] as P3[]).map(armAt)],
  deltoid: DELT_FM,
  deltSplit: [[-0.012, 0.003], [0.02, 0.0115], [0.05, 0.0128], [0.08, 0.0105]],
  biceps: BICEPS_FM,
  triceps: TRICEPS_FM,
  foreCrease: [[0.012, 0.009], [0.035, 0.0098], [0.058, 0.0085]],
  elbowCrease: [[0.196, -0.012], [0.2, -0.004], [0.198, 0.004]],
  thigh: THIGH_FM,
  hipArc: [2, 23],
  shin: SHIN_FM,
  foot: FOOT_FM,
  toeLines: [[[0.0205, -0.0128], [0.0286, -0.0132]], [[0.0222, -0.0035], [0.0287, -0.0038]], [[0.0228, 0.0055], [0.0285, 0.0052]]],
  glute: GLUTE_FM,
  quads: QUADS_FM,
  calves: CALVES_FM,
  patella: PATELLA_FM,
  groin: GROIN_FM,
  head: HEAD_FM,
  ear: EAR_FM,
  hair: HAIR_FM,
  part: [[0.0212, 0.0442], [0.0192, 0.0528]],
  facePair: FACE_PAIR_FM,
  faceMid: FACE_MID_FM,
  faceLines: FACE_LINES_FM,
  back: BACK_VIEW_M,
};

// ---- hers ----
// A narrower rib cage and waist (narrowest a little higher than his), the hips flaring from above the iliac crest to
// the trochanter; slimmer shoulders and neck; the same crest (a hand rests there) and the same outer edges where she
// lies on her side.
const TRUNK_FW: P2[] = [
  [0.336, 0.0], [0.334, 0.017], [0.33, 0.0272], // 0-2 under the neck
  [0.325, 0.04], [0.319, 0.054], [0.313, 0.067], [0.308, 0.079], [0.304, 0.089], // 3-7 trapezius to the acromion
  [0.298, 0.098], [0.284, 0.102], [0.264, 0.0995], [0.244, 0.094], // 8-11 over the joint, under the shoulder
  [0.226, 0.0878], [0.205, 0.0842], [0.182, 0.0802], [0.158, 0.0748], [0.136, 0.0702], [0.116, 0.0678], [0.097, 0.0692], // 12-18 ribs to the waist
  [0.078, 0.0742], [0.06, 0.0805], // 19-20 the hip flaring over the crest
  [0.044, 0.08], [0.022, 0.074], [-0.004, 0.062], [-0.028, 0.045], [-0.047, 0.024], [-0.058, 0.007], [-0.06, 0.0], // 21-27 under the thigh
];
const UARM_FW: P3[] = [
  armAt(TRUNK_FW[6]), armAt(TRUNK_FW[7]), // 0-1 on the trapezius line
  [-0.016, -0.004], [-0.012, 0.0068], [-0.004, 0.0158], [0.008, 0.0208], [0.024, 0.0225], [0.044, 0.0216], [0.066, 0.0192], // 2-8 the cap
  [0.09, 0.0158], [0.12, 0.0165], [0.148, 0.0165], [0.172, 0.0158], [0.19, 0.0165], // 9-13 outer arm
  [0.205, 0.0148], [0.214, 0.006], [0.213, -0.008], [0.2, -0.0188], // 14-17 the elbow
  [0.18, -0.0222], [0.152, -0.0242], [0.122, -0.0252], [0.096, -0.0258], [0.078, -0.0258], // 18-22 inner arm
  // 23-26 the front fold of the armpit (the pectoral's lower border, under the bust) as his: it runs in from the arm
  // inside the chest's outline, so the hollow of the armpit stays high at the arm's lower line as the arm rises; 27-29
  // under the chest and the cap
  [0.066, -0.023, 0.36], [0.083, -0.035, 0.14], [0.098, -0.052, 0.04], [0.106, -0.068, 0], [0.07, -0.07, 0], [0.03, -0.05, 0], [0.0, -0.03, 0],
];
const FOREARM_FW: P2[] = [
  [-0.018, 0.0145], [0.0, 0.0182], [0.025, 0.0205], [0.05, 0.019], [0.08, 0.0155], [0.11, 0.0125], [0.135, 0.011], [0.148, 0.011],
  [0.157, 0.006], [0.158, -0.004], [0.151, -0.0105],
  [0.135, -0.0112], [0.11, -0.0125], [0.08, -0.0155], [0.05, -0.0185], [0.025, -0.0195], [0.0, -0.0182], [-0.016, -0.0145],
  [-0.024, -0.004], [-0.022, 0.008],
];
// The chest group is her bust, as the app's icon draws it: lower on the chest than his pectoral and round, its upper slope
// rising from the cleavage below the collarbones' skin, its tail running into the armpit (the only part that goes with
// the arm, so it stays a bust inside the chest's outline as the arm rises), and its full lower curve back to the sternum.
const PEC_FW: P3[] = ([
  [0.214, 0.009, 0], [0.226, 0.021, 0], [0.237, 0.036, 0], [0.2435, 0.052, 0], // the upper slope from the cleavage
  [0.244, 0.0635, 0.06], [0.2405, 0.0742, 0.35], [0.2335, 0.0832, 0.8], [0.2265, 0.0868, 1], // the tail into the armpit
  [0.2175, 0.0788, 0.08], [0.2, 0.0802, 0], [0.1838, 0.0764, 0], [0.1712, 0.0655, 0], // the outer curve, on the chest wall
  [0.1645, 0.0515, 0], [0.163, 0.036, 0], [0.166, 0.0225, 0], [0.173, 0.0132, 0], [0.184, 0.0088, 0], [0.198, 0.0078, 0], // round under, to the cleavage
] as P3[]).map(armAt);
const DELT_FW: P2[] = [
  [-0.008, -0.0375], [-0.013, -0.0235], [-0.016, -0.0125], [-0.0165, -0.004],
  [-0.0125, 0.0042], [-0.005, 0.012], [0.004, 0.0172], [0.014, 0.0204], [0.028, 0.0218], [0.046, 0.0212], [0.066, 0.0192], [0.086, 0.0166], [0.103, 0.0142],
  [0.119, 0.0098], [0.124, 0.0025],
  [0.11, -0.0098], [0.09, -0.0198], [0.068, -0.0282], [0.046, -0.0345], [0.024, -0.0385], [0.006, -0.0398],
];
const THIGH_FW: P2[] = [
  legAt(TRUNK_FW[20]), [-0.044, 0.0342], [-0.024, 0.0364], [-0.002, 0.0376], [0.022, 0.0385], // 0-4 the hip flare to the trochanter
  [0.05, 0.0376], [0.085, 0.0352], [0.12, 0.0322], [0.155, 0.0288], [0.188, 0.025], [0.215, 0.0215], [0.238, 0.019], // 5-11 outer thigh
  [0.258, 0.0172], [0.27, 0.005], [0.27, -0.012], [0.258, -0.0272], // 12-15 the knee
  [0.238, -0.0322], [0.218, -0.0352], [0.2, -0.0356], [0.18, -0.0355], [0.155, -0.0385], [0.125, -0.0432], [0.095, -0.0482], [0.072, -0.0525], [0.058, -0.0552], // 16-24 inner thigh
  [0.04, -0.0462], [0.016, -0.029], [-0.01, -0.011], [-0.034, 0.0068], [-0.05, 0.0178], // 25-29 the groin line up to the crest
];
const SHIN_FW: P2[] = [
  [-0.03, 0.0185], [-0.008, 0.0205], [0.02, 0.0245], [0.045, 0.0268], [0.07, 0.0262], [0.1, 0.0238], [0.135, 0.0198], [0.17, 0.0158], [0.2, 0.0135], [0.222, 0.0138],
  [0.236, 0.0166], [0.25, 0.0156], [0.258, 0.0072], [0.258, -0.0072],
  [0.248, -0.0142], [0.23, -0.0185], [0.212, -0.0152], [0.182, -0.0165], [0.148, -0.0212], [0.115, -0.0282], [0.088, -0.0305], [0.062, -0.0302], [0.036, -0.0285], [0.01, -0.0288],
  [-0.016, -0.031], [-0.034, -0.0262],
];
// Her foot: the outer edge as his (a side plank rests on it), the inner side narrower.
const FOOT_FW: P2[] = [
  [-0.004, 0.0155], [0.012, 0.0215], [0.022, 0.027], [0.0268, 0.0294],
  [0.0282, 0.0248], [0.0286, 0.017], [0.0289, 0.0095], [0.0291, 0.0015], [0.0292, -0.006], [0.0292, -0.0135],
  [0.0286, -0.0212], [0.0248, -0.0252], [0.0145, -0.0238], [0.004, -0.0192], [-0.008, -0.0162],
];
const HEAD_FW: P2[] = both([
  [0.0, 0.0625], [0.0225, 0.0598], [0.0366, 0.0505], [0.0436, 0.0352], [0.0452, 0.0182], [0.0442, 0.0018], [0.0418, -0.0138], [0.0384, -0.027],
  [0.0335, -0.0385], [0.026, -0.0488], [0.0172, -0.0568], [0.0082, -0.0618], [0.0, -0.063],
]);
// Hair parted in the middle and drawn back over the skull from a rounded hairline to a ponytail at the nape, as in her
// side view: one mass with one outline. Its silhouette (HAIR_SIL_FW) stands a little off the skull over the crown and the
// temples and passes behind the ears just below their tops; the hair behind the head is drawn there, with its outline,
// and the hair over the head reaches out to the same silhouette, covering the skull's own outline, so the hair shows as
// hair edged by a single line in either theme. Over the head it comes down over the tops of the ears (drawn before it),
// whose lobes and outer rims stay clear.
const HAIR_SIL_FW: P2[] = [[0.0, 0.0695], [0.0268, 0.0661], [0.0436, 0.0556], [0.0512, 0.0388], [0.0531, 0.0222], [0.0513, 0.0121], [0.0466, 0.0054]];
const HAIR_FW: P2[] = band(HAIR_SIL_FW, [[0.0428, 0.0074], [0.041, 0.0185], [0.0372, 0.0298], [0.0298, 0.0388], [0.0182, 0.0445], [0.0072, 0.0462], [0.0, 0.0458]]);
// Behind the head: the silhouette, then tucked in behind the ears and closed inside the head.
const HAIR_BACK_FW: P2[] = both([...HAIR_SIL_FW, [0.0428, 0.0012], [0.024, -0.002], [0.0, -0.002]]);
const TAIL_FW: P2[] = [[0.033, -0.03], [0.0492, -0.0385], [0.0602, -0.0592], [0.0652, -0.0852], [0.0632, -0.1095], [0.0552, -0.1238], [0.0452, -0.1198], [0.0402, -0.0998], [0.0362, -0.0732], [0.0312, -0.0505]];
// Her eyes as open as his, with a flick of lashes at the outer corner.
const FACE_PAIR_FW: P2[][] = [
  [[0.01, 0.0063], [0.016, 0.0101], [0.0224, 0.0083], [0.0252, 0.0092], [0.0236, 0.0059], [0.0168, 0.0029]],
  [[0.0072, 0.017], [0.0168, 0.0212], [0.0272, 0.0186], [0.0268, 0.0168], [0.0168, 0.0192], [0.0078, 0.0154]],
];
const FACE_MID_FW: P2[][] = [
  [[-0.0052, -0.0192], [-0.0018, -0.0208], [0.0018, -0.0208], [0.0052, -0.0192], [0.0, -0.0176]],
  [[-0.0112, -0.0338], [-0.0045, -0.0318], [0.0, -0.0326], [0.0045, -0.0318], [0.0112, -0.0338], [0.0052, -0.0372], [-0.0052, -0.0372]],
];

// Her back from above: narrower across the lats and the waist, the hips and the buttocks fuller; her hair tied back
// in a knot at the nape, parted in the middle.
const BACK_FW: P2[] = [
  [-0.194, 0.0], [-0.203, 0.017], [-0.21, 0.039], [-0.205, 0.064], [-0.186, 0.085], [-0.148, 0.099], // 0-5 the buttocks
  [-0.09, 0.101], [-0.03, 0.089], [0.035, 0.0752], [0.085, 0.07], // 6-9 hips to the waist
  [0.13, 0.076], [0.175, 0.086], [0.212, 0.094], [0.24, 0.097], // 10-13 to the armpit
  [0.269, 0.089], [0.268, 0.079], // 14-15 the cap's top
  [0.284, 0.066], [0.301, 0.054], [0.319, 0.044], [0.338, 0.036], [0.358, 0.03], [0.388, 0.018], [0.41, 0.0], // 16-22 the trapezius to the neck
];
const BACK_VIEW_W: FrontShape['back'] = {
  trunk: BACK_FW,
  glute: [[-0.194, 0.0085], [-0.202, 0.021], [-0.206, 0.04], [-0.2, 0.063], [-0.182, 0.081], [-0.147, 0.093], [-0.112, 0.094], [-0.124, 0.075], [-0.14, 0.052], [-0.152, 0.03], [-0.16, 0.012]],
  wing: [
    [0.227, 0.0912], [0.205, 0.0892], [0.18, 0.0838], [0.15, 0.0768], [0.12, 0.0698], [0.09, 0.0648], [0.06, 0.0628], [0.03, 0.0642], [0.0, 0.066],
    [-0.035, 0.0575], [-0.06, 0.0412], [-0.075, 0.024], [-0.08, 0.0096],
    [-0.05, 0.007], [0.0, 0.007], [0.05, 0.008], [0.085, 0.0098],
    [0.105, 0.0178], [0.125, 0.0322], [0.145, 0.0515], [0.163, 0.0672], [0.185, 0.0808], [0.206, 0.0872],
  ],
  scapula: [[0.255, 0.0548], [0.26, 0.0685], [0.258, 0.0805], [0.245, 0.0885], [0.224, 0.0868], [0.202, 0.0785], [0.18, 0.0668], [0.166, 0.0558], [0.176, 0.0475], [0.199, 0.0432], [0.228, 0.0428], [0.246, 0.0465]],
  trap: [[0.405, 0.0], [0.388, 0.015], [0.362, 0.026], [0.338, 0.034], [0.315, 0.045], [0.296, 0.059], [0.28, 0.073], [0.269, 0.0715], [0.264, 0.06], [0.257, 0.048], [0.245, 0.0398], [0.214, 0.031], [0.178, 0.0215], [0.142, 0.0122], [0.114, 0.005], [0.098, 0.0]],
  spine: BACK_VIEW_M.spine,
  cleft: [[-0.194, 0.0], [-0.172, 0.0], [-0.15, 0.0]],
  // The mound over the back of her shoulder as his (UARM_BACK_FM, DELT_BACK_FM), from her narrower back to her smaller cap.
  upperArm: [armBackAt(BACK_FW[15] as P3), armBackAt(BACK_FW[14] as P3), [-0.0385, -0.004], [-0.0206, 0.0065], [-0.0105, 0.0145], ...UARM_FW.slice(5, 23), [0.05, -0.0252], [0.02, -0.027], [-0.006, -0.0235]],
  deltoid: rearDeltoid(DELT_FW).map((p, i): P2 => ([[-0.0242, 0.0015], [-0.0135, 0.009], [-0.005, 0.0135]] as P2[])[i - 4] ?? p),
  head: both([[0.0, 0.0555], [0.0242, 0.052], [0.039, 0.042], [0.0458, 0.026], [0.0466, 0.0072], [0.0435, -0.0125], [0.0372, -0.0302], [0.0272, -0.0438], [0.0148, -0.0522], [0.0, -0.055]]),
  hair: both([[0.0, 0.0625], [0.0278, 0.059], [0.0452, 0.0478], [0.0535, 0.0295], [0.0552, 0.008], [0.0532, -0.0115], [0.0492, -0.0232], [0.0452, -0.0252], [0.0428, -0.0178], [0.0358, -0.0222], [0.0238, -0.0275], [0.011, -0.0302], [0.0, -0.0308]]),
  part: [[0.0, -0.0296], [0.0004, 0.006], [0.0008, 0.042]],
  knot: both([[0.0, 0.0845], [0.0128, 0.0815], [0.0198, 0.073], [0.0215, 0.0618], [0.0175, 0.0518], [0.0075, 0.0465], [0.0, 0.0455]]),
  sheen: [
    band([[0.0, 0.0572], [0.0238, 0.0542], [0.0395, 0.0458], [0.0482, 0.0335], [0.0512, 0.0188]], [[0.0468, 0.019], [0.0425, 0.0285], [0.0335, 0.0352], [0.0195, 0.039], [0.0, 0.04]]),
    band([[0.0, 0.0536], [0.0205, 0.0512], [0.0338, 0.0448], [0.0412, 0.036], [0.044, 0.026]], [[0.0408, 0.026], [0.0362, 0.0322], [0.0275, 0.0378], [0.0152, 0.0414], [0.0, 0.0425]]),
  ],
  ear: [[0.0432, -0.0095], [0.0502, -0.0078], [0.0532, -0.0165], [0.0514, -0.0285], [0.0458, -0.0348], [0.041, -0.0298]],
  face: [
    [[0.0062, -0.0412], [0.016, -0.0388], [0.0268, -0.0402], [0.0265, -0.0418], [0.016, -0.0404], [0.007, -0.0428]],
    [[0.0085, -0.0494], [0.016, -0.0482], [0.0236, -0.0492], [0.0262, -0.0484], [0.016, -0.0506]],
  ],
};

const FRONT_W: FrontShape = {
  ...FRONT_M,
  trunk: TRUNK_FW,
  neck: { trunk: [[0.296, 0.025], [0.322, 0.0255]], head: [[0.0262, -0.047], [0.025, -0.028]] },
  scm: [[0.033, -0.026], [0.021, -0.056], [0.29, 0.008]],
  trunkLines: [[[0.289, 0.008], [0.293, 0.03], [0.29, 0.052], [0.294, 0.073], [0.297, 0.086]]],
  trap: [...runOf(TRUNK_FW, 2, 7), [0.298, 0.083], [0.299, 0.072], [0.304, 0.059], [0.31, 0.047], [0.317, 0.038], [0.324, 0.031]],
  lat: [...runOf(TRUNK_FW, 12, 16), [0.14, 0.0665], [0.16, 0.0702], [0.184, 0.0752], [0.206, 0.0792], [0.222, 0.0822]],
  oblique: [
    [0.176, 0.0772], [0.166, 0.0688], [0.15, 0.0568], [0.128, 0.0502], [0.104, 0.0482], [0.08, 0.0486], [0.06, 0.0524], [0.045, 0.06], [0.047, 0.0705], [0.056, 0.0778],
    [0.072, 0.0718], [0.09, 0.067], [0.11, 0.0655], [0.132, 0.0678], [0.156, 0.0725],
  ],
  obliqueInner: [2, 7],
  // The rectus as his strap, from under the bust (which covers its top) to the pubis, with softer definition: the
  // linea alba down its length and no tendinous lines.
  rectus: [
    [0.181, 0.0], [0.181, 0.017], [0.1795, 0.0318], [0.173, 0.0418], [0.155, 0.0458], [0.13, 0.0466], [0.104, 0.0466], [0.082, 0.0455],
    [0.06, 0.0422], [0.036, 0.0364], [0.01, 0.0286], [-0.012, 0.0195], [-0.027, 0.0098], [-0.033, 0.0],
  ],
  rectusLines: [[[0.176, 0.0], [-0.022, 0.0]]],
  rectusLineWidth: 0.0028,
  navel: [[0.076, -0.0025], [0.071, 0.0], [0.076, 0.0025], [0.0805, 0.0]],
  upperArm: UARM_FW,
  forearm: FOREARM_FW,
  fist: FRONT_M.fist.map(([t, d]): P2 => [0.03 + (t - 0.03) * 0.92, d * (d < 0 ? 1 : 0.92)]),
  flatHand: FLAT_HAND.map(([t, d]): P2 => [0.03 + (t - 0.03) * 0.93, d > 0 ? d : d * 0.9]),
  pec: PEC_FW,
  // The fold under the bust.
  pecFold: [([[0.1745, 0.0745, 0.01], [0.1625, 0.0635, 0], [0.1558, 0.0495, 0], [0.1545, 0.0345, 0], [0.1578, 0.0205, 0]] as P3[]).map(armAt)],
  cleavage: [[0.203, 0.0], [0.194, 0.0], [0.185, 0.0]],
  deltoid: DELT_FW,
  deltSplit: [[-0.011, 0.001], [0.02, 0.0075], [0.05, 0.0085], [0.08, 0.007]],
  biceps: BICEPS_FM.map(([t, d]): P2 => [t, d * 0.86 - 0.0012]),
  triceps: [[0.098, 0.0142], [0.12, 0.0145], [0.148, 0.0145], [0.17, 0.0136], [0.181, 0.0125], [0.17, 0.0088], [0.145, 0.0078], [0.12, 0.0085], [0.104, 0.0108]],
  thigh: THIGH_FW,
  hipFlare: 0.0075,
  shin: SHIN_FW,
  foot: FOOT_FW,
  glute: [
    [-0.056, 0.0235], [-0.042, 0.0322], [-0.022, 0.0358], [0.0, 0.0364], [0.022, 0.0362], [0.046, 0.0354], [0.07, 0.0336],
    [0.08, 0.0262], [0.066, 0.0158], [0.044, 0.0078], [0.018, 0.0022], [-0.01, 0.0002], [-0.034, 0.0052], [-0.05, 0.0132],
  ],
  quads: [
    [[0.088, 0.0328], [0.12, 0.0299], [0.155, 0.0265], [0.188, 0.0228], [0.212, 0.0195], [0.224, 0.0158], [0.215, 0.0102], [0.185, 0.0075], [0.145, 0.0072], [0.11, 0.0098], [0.088, 0.0178], [0.082, 0.026]],
    [[0.035, -0.0035], [0.07, 0.0018], [0.11, 0.0038], [0.15, 0.0022], [0.188, -0.0028], [0.21, -0.0085], [0.203, -0.0155], [0.172, -0.019], [0.132, -0.02], [0.092, -0.0185], [0.056, -0.013]],
    [[0.148, -0.0352], [0.172, -0.0332], [0.194, -0.034], [0.212, -0.0335], [0.225, -0.0292], [0.228, -0.0218], [0.218, -0.0165], [0.198, -0.0185], [0.176, -0.0228], [0.158, -0.0288]],
  ],
  calves: [
    [[0.004, 0.0202], [0.024, 0.0232], [0.048, 0.0248], [0.075, 0.0238], [0.104, 0.0208], [0.12, 0.0185], [0.106, 0.0152], [0.08, 0.0142], [0.052, 0.0145], [0.026, 0.0158], [0.01, 0.0172]],
    [[0.018, -0.0262], [0.04, -0.0268], [0.064, -0.0282], [0.09, -0.0282], [0.116, -0.026], [0.138, -0.0215], [0.128, -0.0182], [0.104, -0.0202], [0.078, -0.0218], [0.05, -0.0215], [0.028, -0.0212]],
  ],
  groin: [[0.03, -0.0395], [0.008, -0.0228], [-0.016, -0.0065], [-0.034, 0.0065]],
  head: HEAD_FW,
  earUnder: true,
  hair: HAIR_FW,
  part: [[0.0, 0.0456], [0.0003, 0.0535], [0.0008, 0.061]],
  hairBack: HAIR_BACK_FW,
  tail: TAIL_FW,
  facePair: FACE_PAIR_FW,
  faceMid: FACE_MID_FW,
  faceLines: [[[0.0042, -0.004], [0.0048, -0.0115], [0.0062, -0.0178]]],
  back: BACK_VIEW_W,
};

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
  front: FRONT_M,
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
   the hollow behind the neck, in a hair colour of her own. Her muscles have
   fewer definition lines but light as much as his. Her front view has its own
   tables (FRONT_W, with the front view shapes). */

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
  front: FRONT_W,
};

export function drawBody(fig: BodyFigure, c: BodyContext): BodyLayers {
  const S = c.body === 'female' ? FEMALE : MALE;
  return fig.view === 'front' ? drawFront(fig, c, S) : drawSide(fig, c, S);
}
