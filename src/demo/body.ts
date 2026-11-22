// The human figure for exercise demos: SVG markup drawn from the solved
// skeleton, with each muscle group coloured by how hard it is working.
//
// PLACEHOLDER: a plain mannequin with the final interface. The real figure
// replaces the drawing below.
import type { Arm, Figure, Leg, Side, Vec } from './figure';
import type { Levels } from './engagement';

/** A pose with every optional part filled in. */
export interface ResolvedPose {
  torso: number;
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
  level: Levels;
  /** Colour for an engagement level. */
  heat: (level: number) => string;
  /** Unique per drawn figure: prefix for any ids in <defs>. */
  id: string;
}
/** Painted far, then core, then near; equipment goes between and around them. */
export interface BodyLayers {
  far: string;
  core: string;
  near: string;
}

/** Bone line to skin, in body heights, where the body rests on things. */
export const BODY = {
  torsoBack: 0.055,
  torsoFront: 0.055,
  glute: 0.06,
  thighBack: 0.045,
  thighFront: 0.045,
  calf: 0.035,
  shinFront: 0.025,
  upperArm: 0.03,
  forearm: 0.022,
  hand: 0.02,
  head: 0.06,
  neck: 0.03,
  footSole: 0.035,
};

const rad = (deg: number) => (deg * Math.PI) / 180;
const dir = (deg: number): Vec => ({ x: Math.sin(rad(deg)), y: -Math.cos(rad(deg)) });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const lerpV = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const n = (v: number) => v.toFixed(4);
const line = (a: Vec, b: Vec, w: number, colour: string) =>
  `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${colour}" stroke-width="${w}" stroke-linecap="round"/>`;

function sideLimbs(s: Side, leg: Leg, arm: Arm, c: BodyContext, body: string) {
  const { level, heat } = c;
  const thighFront = dir(leg.thigh - 90);
  const shinFront = dir(leg.shin - 90);
  const armFront = dir(arm.upper - 90);
  const off = (p: Vec, v: Vec, k: number) => add(p, mul(v, k));
  const legs =
    line(s.hip, s.knee, 0.085, body) +
    line(off(lerpV(s.hip, s.knee, 0.2), thighFront, 0.02), off(lerpV(s.hip, s.knee, 0.85), thighFront, 0.02), 0.035, heat(level.quads)) +
    line(off(lerpV(s.hip, s.knee, 0.2), thighFront, -0.022), off(lerpV(s.hip, s.knee, 0.85), thighFront, -0.022), 0.035, heat(level.hamstrings)) +
    line(s.hip, off(s.hip, thighFront, -0.03), 0.07, heat(level.glutes)) +
    line(s.knee, s.ankle, 0.06, body) +
    line(off(lerpV(s.knee, s.ankle, 0.15), shinFront, -0.015), off(lerpV(s.knee, s.ankle, 0.55), shinFront, -0.015), 0.03, heat(level.calves)) +
    line(s.heel, s.toe, 0.03, body);
  const arms =
    line(s.shoulder, s.elbow, 0.055, body) +
    line(off(lerpV(s.shoulder, s.elbow, 0.3), armFront, 0.012), off(lerpV(s.shoulder, s.elbow, 0.85), armFront, 0.012), 0.024, heat(level.biceps)) +
    line(off(lerpV(s.shoulder, s.elbow, 0.3), armFront, -0.014), off(lerpV(s.shoulder, s.elbow, 0.85), armFront, -0.014), 0.024, heat(level.triceps)) +
    line(s.shoulder, lerpV(s.shoulder, s.elbow, 0.2), 0.06, heat(level.shoulders)) +
    line(s.elbow, s.wrist, 0.04, body);
  return { legs, arms };
}

export function drawBody(fig: BodyFigure, c: BodyContext): BodyLayers {
  const { level, heat } = c;
  const body = 'var(--an-body)';
  if (fig.view === 'side') {
    const p = fig.pose;
    const hip = fig.a.hip;
    const sh = fig.a.shoulder;
    const front = dir(p.torso + 90);
    const far = sideLimbs(fig.b, p.leg2, p.arm2, c, 'var(--line-strong)');
    const near = sideLimbs(fig.a, p.leg, p.arm, c, body);
    const core =
      line(hip, sh, 0.12, body) +
      line(add(lerpV(hip, sh, 0.65), mul(front, 0.035)), add(lerpV(hip, sh, 0.9), mul(front, 0.035)), 0.04, heat(level.chest)) +
      line(add(lerpV(hip, sh, 0.1), mul(front, 0.035)), add(lerpV(hip, sh, 0.5), mul(front, 0.035)), 0.04, heat(level.core)) +
      line(add(lerpV(hip, sh, 0.15), mul(front, -0.035)), add(lerpV(hip, sh, 0.9), mul(front, -0.035)), 0.04, heat(level.back)) +
      `<circle cx="${n(fig.head.x)}" cy="${n(fig.head.y)}" r="0.058" fill="${body}"/><circle cx="${n(fig.nose.x)}" cy="${n(fig.nose.y)}" r="0.012" fill="${body}"/>`;
    return { far: far.arms + far.legs, core, near: near.legs + near.arms };
  }
  let s = `<polygon points="${[fig.a.shoulder, fig.b.shoulder, fig.b.hip, fig.a.hip].map((q) => `${n(q.x)},${n(q.y)}`).join(' ')}" fill="${body}" stroke="${body}" stroke-width="0.06" stroke-linejoin="round"/>`;
  for (const side of [fig.a, fig.b]) {
    s += line(side.hip, side.knee, 0.075, heat(level.quads)) + line(side.knee, side.ankle, 0.055, body) + line(side.heel, side.toe, 0.03, body);
    s += line(side.shoulder, side.elbow, 0.05, heat(level.biceps)) + line(side.elbow, side.wrist, 0.04, body);
    s += `<circle cx="${n(side.shoulder.x)}" cy="${n(side.shoulder.y)}" r="0.035" fill="${heat(level.shoulders)}"/>`;
  }
  s += `<circle cx="${n(fig.head.x)}" cy="${n(fig.head.y)}" r="0.058" fill="${body}"/>`;
  return { far: '', core: s, near: '' };
}
