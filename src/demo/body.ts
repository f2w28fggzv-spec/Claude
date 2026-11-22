// The human figure for exercise demos: SVG markup drawn from the solved
// skeleton, with each muscle group coloured by how hard it is working.
//
// PLACEHOLDER: a plain mannequin with the final interface. The real figure
// replaces the drawing below.
import type { Arm, Figure, Leg, Side, Vec } from './figure';
import { restingSide, type Levels } from './engagement';

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

const rad = (deg: number) => (deg * Math.PI) / 180;
const dir = (deg: number): Vec => ({ x: Math.sin(rad(deg)), y: -Math.cos(rad(deg)) });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const lerpV = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const n = (v: number) => v.toFixed(4);
const line = (a: Vec, b: Vec, w: number, colour: string) =>
  `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${colour}" stroke-width="${w}" stroke-linecap="round"/>`;

/** The levels one side's limbs are drawn with: the working side (or both) at full, the other near rest. */
const limbLevels = (c: BodyContext, side: 'a' | 'b'): Levels => (c.working && c.working !== side ? restingSide(c.level) : c.level);

function sideLimbs(s: Side, which: 'a' | 'b', leg: Leg, arm: Arm, c: BodyContext, body: string) {
  const { heat } = c;
  const level = limbLevels(c, which);
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
    line(s.heel, s.ball, 0.03, body) +
    line(s.ball, s.toe, 0.026, body);
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
    const far = sideLimbs(fig.b, 'b', p.leg2, p.arm2, c, 'var(--line-strong)');
    const near = sideLimbs(fig.a, 'a', p.leg, p.arm, c, body);
    const core =
      line(hip, sh, 0.12, body) +
      line(add(lerpV(hip, sh, 0.65), mul(front, 0.035)), add(lerpV(hip, sh, 0.9), mul(front, 0.035)), 0.04, heat(level.chest)) +
      line(add(lerpV(hip, sh, 0.1), mul(front, 0.035)), add(lerpV(hip, sh, 0.5), mul(front, 0.035)), 0.04, heat(level.core)) +
      line(add(lerpV(hip, sh, 0.15), mul(front, -0.035)), add(lerpV(hip, sh, 0.9), mul(front, -0.035)), 0.04, heat(level.back)) +
      `<circle cx="${n(fig.head.x)}" cy="${n(fig.head.y)}" r="0.058" fill="${body}"/><circle cx="${n(fig.nose.x)}" cy="${n(fig.nose.y)}" r="0.012" fill="${body}"/>`;
    return { far: far.arms + far.legs, core, nearLeg: near.legs, nearArm: near.arms };
  }
  let s = `<polygon points="${[fig.a.shoulder, fig.b.shoulder, fig.b.hip, fig.a.hip].map((q) => `${n(q.x)},${n(q.y)}`).join(' ')}" fill="${body}" stroke="${body}" stroke-width="0.06" stroke-linejoin="round"/>`;
  for (const [side, which] of [[fig.a, 'a'], [fig.b, 'b']] as const) {
    const lv = limbLevels(c, which);
    s += line(side.hip, side.knee, 0.075, heat(lv.quads)) + line(side.knee, side.ankle, 0.055, body) + line(side.heel, side.toe, 0.03, body);
    s += line(side.shoulder, side.elbow, 0.05, heat(lv.biceps)) + line(side.elbow, side.wrist, 0.04, body);
    s += `<circle cx="${n(side.shoulder.x)}" cy="${n(side.shoulder.y)}" r="0.035" fill="${heat(lv.shoulders)}"/>`;
  }
  s += `<circle cx="${n(fig.head.x)}" cy="${n(fig.head.y)}" r="0.058" fill="${body}"/>`;
  return { far: '', core: s, nearLeg: '', nearArm: '' };
}
