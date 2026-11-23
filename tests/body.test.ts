// The demo figure: well-formed and light enough to redraw every frame, every
// muscle group the camera can see is on the body, a one-sided exercise keeps
// the resting limb cool, and the working muscle stays in view when a limb or
// the head would hide it.
import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../src/data/exercises';
import { MUSCLE_GROUPS, type MuscleGroup } from '../src/data/types';
import { drawBody, type BodyContext, type BodyFigure, type BodyLayers } from '../src/demo/body';
import { RESTING_SIDE, type Levels } from '../src/demo/engagement';
import { L, dist, lerpV, solve, type DemoPose } from '../src/demo/figure';
import { figureAt, resolvePose } from '../src/demo/render';

/** A distinct level per group, and a heat function that names the level, so a fill tells which group it is. */
const LEVELS = Object.fromEntries(MUSCLE_GROUPS.map((g, i) => [g, (i + 1) / 20])) as Levels;
const fill = (level: number) => `#lv${Math.round(level * 1000)}_`;
const ctx = (over: Partial<BodyContext> = {}): BodyContext => ({ level: LEVELS, heat: fill, id: 't', ...over });
const all = (l: BodyLayers) => l.far + l.core + l.nearLeg + l.nearArm;
const shows = (markup: string, g: MuscleGroup, level = LEVELS[g]) => markup.includes(fill(level));

/** A figure in a fixed pose (standing side-on unless overridden), independent of the movement patterns. */
const STAND = { thigh: 180, shin: 180, foot: 90 };
function posed(view: 'side' | 'front', over: Partial<DemoPose> = {}): BodyFigure {
  const pose = { torso: 0, leg: STAND, arm: { upper: 180, fore: 180 }, anchor: 'ankle', at: { x: 0, y: 0 }, ...over } as DemoPose;
  return { ...solve(view, pose), pose: resolvePose(pose) };
}
const draw = (fig: BodyFigure, level: Partial<Levels> = {}) => drawBody(fig, ctx({ level: { ...LEVELS, ...level } }));
/** The outlines of a path's subpaths, as their control points. */
const outlinesOf = (d: string) =>
  d.split('M').filter(Boolean).map((sub) => {
    const n = (sub.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    return Array.from({ length: n.length >> 1 }, (_, i) => ({ x: n[2 * i], y: n[2 * i + 1] }));
  });
/** Area of the muscle drawn in `level`'s fill (shoelace over its control points; close enough to compare sizes). */
function areaOf(markup: string, level: number): number {
  const d = markup.match(new RegExp(`<path d="([^"]+)" fill="${fill(level)}"`))?.[1] ?? '';
  return outlinesOf(d).reduce((sum, p) => sum + Math.abs(p.reduce((a, q, i) => a + q.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * q.y, 0)) / 2, 0);
}

describe('demo figure', () => {
  it.each(EXERCISES.map((e) => [e.id, e] as const))('%s: well-formed at every point of the rep', (_, e) => {
    for (let k = 0; k <= 4; k++) {
      const fig = figureAt(e.demo, k / 4);
      const layers = drawBody(fig, ctx({ working: e.demo.working }));
      const markup = all(layers);
      expect(markup).not.toMatch(/NaN|undefined|Infinity/);
      // Light enough to repaint every animation frame on a phone.
      expect(markup.length).toBeLessThan(32000);
      expect((markup.match(/<path /g) ?? []).length).toBeLessThan(80);
      expect(layers.core).not.toBe('');
      expect(layers.nearArm).not.toBe('');
      if (e.demo.view === 'side') expect(layers.nearLeg).not.toBe('');
      // Same pose, same picture.
      expect(all(drawBody(fig, ctx({ working: e.demo.working })))).toBe(markup);
    }
  });

  it('draws every muscle group the camera can see', () => {
    const side = all(drawBody(figureAt(EXERCISES.find((e) => e.id === 'back-squat')!.demo, 0.5), ctx()));
    for (const g of MUSCLE_GROUPS) expect(shows(side, g), g).toBe(true);
    // From the front the hamstrings are behind the thighs.
    const front = all(drawBody(figureAt(EXERCISES.find((e) => e.id === 'lateral-raise')!.demo, 0.5), ctx()));
    for (const g of MUSCLE_GROUPS.filter((m) => m !== 'hamstrings')) expect(shows(front, g), g).toBe(true);
  });

  it('keeps the resting side of a one-sided exercise near rest', () => {
    const fig = figureAt(EXERCISES.find((e) => e.id === 'one-arm-dumbbell-row')!.demo, 0.5);
    const both = all(drawBody(fig, ctx()));
    const one = all(drawBody(fig, ctx({ working: 'a' })));
    const part = all(drawBody(fig, ctx({ working: 'a', otherSide: 0.3 })));
    expect(shows(both, 'biceps')).toBe(true);
    // The near (working) arm keeps its level; the far arm's limb muscles drop to their share (at rest by default), the trunk doesn't.
    expect(RESTING_SIDE).toBe(0);
    expect(shows(one, 'biceps')).toBe(true);
    expect(one).not.toBe(both);
    // A share that matches no other group's test level: 0.3 of the biceps level.
    expect(shows(part, 'biceps', LEVELS.biceps * 0.3)).toBe(true);
    expect(shows(both, 'biceps', LEVELS.biceps * 0.3)).toBe(false);
    expect(shows(one, 'back')).toBe(true);
  });
});

describe('the working muscle stays in view', () => {
  it('draws both ears on a face seen from the front', () => {
    const fig = posed('front');
    const ears = draw(fig).core.match(/<path d="([^"]+)" fill="var\(--fig-skin\)" stroke="var\(--fig-edge\)" stroke-width="\.004"/);
    const xs = outlinesOf(ears?.[1] ?? '').map((p) => p.reduce((a, q) => a + q.x, 0) / p.length);
    expect(xs).toHaveLength(2);
    expect(Math.min(...xs)).toBeLessThan(fig.head.x - 0.03);
    expect(Math.max(...xs)).toBeGreaterThan(fig.head.x + 0.03);
  });

  it('tips the neck with a trunk tipped toward the camera, so a bent-over lifter seen from the front reads as bent over', () => {
    const neck = (view: 'side' | 'front', torsoScale?: number) => {
      const f = solve(view, { torso: 0, torsoScale, leg: STAND, arm: { upper: 180, fore: 180 }, anchor: 'ankle', at: { x: 0, y: 0 } });
      return dist(f.head, lerpV(f.a.shoulder, f.b.shoulder, 0.5));
    };
    expect(neck('front')).toBeCloseTo(L.neck, 6);
    expect(neck('front', 0.42)).toBeCloseTo(L.neck * 0.42, 6);
    expect(neck('side', 0.42)).toBeCloseTo(L.neck, 6);
  });

  it('carries a working back onto the near arm that covers it at the top of a row', () => {
    const row = (arm: DemoPose['arm']) => posed('side', { torso: 70, head: 58, leg: { thigh: 138, shin: 182, foot: 90 }, arm });
    const top = row({ upper: -87, fore: 154, scale: 0.78, foreScale: 0.89 });
    expect(shows(draw(top, { back: 0.9 }).nearArm, 'back', 0.9)).toBe(true);
    // Arms hanging below the shoulders cover little of the back; a back at rest needs no help.
    expect(shows(draw(row({ upper: 175, fore: 175 }), { back: 0.9 }).nearArm, 'back', 0.9)).toBe(false);
    expect(shows(draw(top, { back: 0 }).nearArm, 'back', 0)).toBe(false);
  });

  it('carries a working chest onto the near arm that covers it in a press', () => {
    const press = posed('side', {
      torso: 274.4, bend: -12, head: 266, leg: { thigh: 104.3, shin: -167.7, foot: 90 },
      arm: { upper: 40.8, fore: -12, scale: 0.53, foreScale: 0.9 }, anchor: 'hip', at: { x: 0, y: -0.3 },
    });
    expect(shows(draw(press, { chest: 0.85 }).nearArm, 'chest', 0.85)).toBe(true);
    expect(shows(draw(press, { chest: 0 }).nearArm, 'chest', 0)).toBe(false);
  });

  it('never hides a working triceps under the face, and leaves a face beside a raised arm alone', () => {
    // Overhead extension: the upper arm crosses the side of the face with the triceps toward it.
    const extension = draw(posed('side', { torso: 3, head: 3, arm: { upper: 11, fore: -50 } }), { triceps: 0.95 }).nearArm;
    const face = extension.lastIndexOf('var(--fig-face)');
    expect(shows(extension, 'triceps', 0.95)).toBe(true);
    expect(face < 0 || extension.lastIndexOf(fill(0.95)) > face).toBe(true);
    // Hanging: the profile shows past the arm, as in a real side view. Arm across the face: the face is drawn over it.
    expect(draw(posed('side', { arm: { upper: 0, fore: 0 } })).nearArm).not.toContain('var(--fig-face)');
    expect(draw(posed('side', { arm: { upper: 28, fore: -25 } })).nearArm).toContain('var(--fig-face)');
  });

  it('draws an arm pointing at the camera as a clean limb seen end-on', () => {
    const arm = (scale: number) => draw(posed('side', { arm: { upper: 90, fore: 90, scale, foreScale: scale } })).nearArm;
    expect(shows(arm(1), 'biceps') && shows(arm(1), 'triceps')).toBe(true);
    // End-on the arm's bellies give way; the round deltoid cap stays.
    const endOn = arm(0.15);
    expect(shows(endOn, 'biceps') || shows(endOn, 'triceps')).toBe(false);
    expect(shows(endOn, 'shoulders')).toBe(true);
  });

  it('keeps a steadying core modest and lets a working one swell', () => {
    const core = (level: number) => areaOf(draw(posed('side'), { core: level }).core, level);
    expect(core(0.97)).toBeGreaterThan(core(0.33) * 1.15);
  });

  it('gives the triceps a full belly on the back of the upper arm', () => {
    // It is about two thirds of the upper arm's muscle: on a straight arm at least the size of the biceps.
    const arm = draw(posed('side'), { biceps: 0.61, triceps: 0.62 }).nearArm;
    expect(areaOf(arm, 0.62)).toBeGreaterThan(areaOf(arm, 0.61));
  });
});
