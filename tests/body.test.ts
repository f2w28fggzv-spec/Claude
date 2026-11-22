// The demo figure: well-formed and light enough to redraw every frame, every
// muscle group the camera can see is on the body, and a one-sided exercise
// keeps the resting limb cool.
import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../src/data/exercises';
import { MUSCLE_GROUPS, type MuscleGroup } from '../src/data/types';
import { drawBody, type BodyContext, type BodyLayers } from '../src/demo/body';
import { RESTING_SIDE, type Levels } from '../src/demo/engagement';
import { figureAt } from '../src/demo/render';

/** A distinct level per group, and a heat function that names the level, so a fill tells which group it is. */
const LEVELS = Object.fromEntries(MUSCLE_GROUPS.map((g, i) => [g, (i + 1) / 20])) as Levels;
const fill = (level: number) => `#lv${Math.round(level * 1000)}_`;
const ctx = (over: Partial<BodyContext> = {}): BodyContext => ({ level: LEVELS, heat: fill, id: 't', ...over });
const all = (l: BodyLayers) => l.far + l.core + l.nearLeg + l.nearArm;
const shows = (markup: string, g: MuscleGroup, level = LEVELS[g]) => markup.includes(fill(level));

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
