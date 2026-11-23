// The demo figure, his and hers: well-formed and light enough to redraw every
// frame, every muscle group the camera can see is on the body, a one-sided
// exercise keeps the resting limb cool, the working muscle stays in view when a
// limb or the head would hide it, and she rests on floors and benches where he
// does.
import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../src/data/exercises';
import { MUSCLE_GROUPS, type MuscleGroup } from '../src/data/types';
import { drawBody, type BodyContext, type BodyFigure, type BodyKind, type BodyLayers } from '../src/demo/body';
import { RESTING_SIDE, type Levels } from '../src/demo/engagement';
import { L, dist, lerpV, solve, type DemoPose } from '../src/demo/figure';
import { figureAt, floorOf, resolvePose } from '../src/demo/render';
import { PAD_HALF } from '../src/demo/contact';

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
const draw = (fig: BodyFigure, level: Partial<Levels> = {}, body: BodyKind = 'male') => drawBody(fig, ctx({ level: { ...LEVELS, ...level }, body }));
const BODIES = ['male', 'female'] as const;
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

/** Points along every path in the markup (M, L and Q segments sampled), to find where the drawn body reaches. */
function drawnPoints(markup: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const [, d] of markup.matchAll(/<path d="([^"]+)"/g)) {
    let at = { x: 0, y: 0 };
    for (const [, cmd, args] of d.matchAll(/([MLQZ])([^MLQZ]*)/g)) {
      const n = (args.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
      if (cmd === 'Q') {
        for (let i = 0; i + 3 < n.length; i += 4) {
          const c = { x: n[i], y: n[i + 1] };
          const p = { x: n[i + 2], y: n[i + 3] };
          for (let k = 1; k <= 8; k++) {
            const t = k / 8;
            const u = 1 - t;
            out.push({ x: u * u * at.x + 2 * u * t * c.x + t * t * p.x, y: u * u * at.y + 2 * u * t * c.y + t * t * p.y });
          }
          at = p;
        }
      } else if (cmd !== 'Z') {
        for (let i = 0; i + 1 < n.length; i += 2) out.push((at = { x: n[i], y: n[i + 1] }));
      }
    }
  }
  return out;
}
/** The lowest point a layer of the drawn body reaches (largest y). */
const lowest = (markup: string) => Math.max(...drawnPoints(markup).map((p) => p.y));
type Pt = { x: number; y: number };
/** Height above a surface: the floor, or the top of a bench pad (null where the point isn't over the pad). */
function surfaceOf(demo: (typeof EXERCISES)[number]['demo'], which: 'floor' | number): (p: Pt) => number | null {
  if (which === 'floor') {
    const floor = floorOf(demo)!;
    return (p) => floor - p.y;
  }
  const prop = demo.props![which];
  if (prop.kind !== 'bench') throw new Error('not a bench');
  const [a, b] = prop.points;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = u.x >= 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
  return (p) => {
    const t = (p.x - a.x) * u.x + (p.y - a.y) * u.y;
    return t < 0 || t > len ? null : (p.x - a.x) * n.x + (p.y - a.y) * n.y - PAD_HALF;
  };
}

describe('demo figure', () => {
  it.each(EXERCISES.flatMap((e) => (['male', 'female'] as const).map((b) => [e.id, b, e] as const)))('%s (%s): well-formed at every point of the rep', (_, body, e) => {
    for (let k = 0; k <= 4; k++) {
      const fig = figureAt(e.demo, k / 4);
      const layers = drawBody(fig, ctx({ working: e.demo.working, body }));
      const markup = all(layers);
      expect(markup).not.toMatch(/NaN|undefined|Infinity/);
      // Light enough to repaint every animation frame on a phone.
      expect(markup.length).toBeLessThan(32000);
      expect((markup.match(/<path /g) ?? []).length).toBeLessThan(80);
      expect(layers.core).not.toBe('');
      expect(layers.nearArm).not.toBe('');
      if (e.demo.view === 'side') expect(layers.nearLeg).not.toBe('');
      // Same pose, same picture.
      expect(all(drawBody(fig, ctx({ working: e.demo.working, body })))).toBe(markup);
    }
  });

  it.each(BODIES)('draws every muscle group the camera can see (%s)', (body) => {
    const side = all(drawBody(figureAt(EXERCISES.find((e) => e.id === 'back-squat')!.demo, 0.5), ctx({ body })));
    for (const g of MUSCLE_GROUPS) expect(shows(side, g), g).toBe(true);
    // From the front the hamstrings are behind the thighs.
    const front = all(drawBody(figureAt(EXERCISES.find((e) => e.id === 'lateral-raise')!.demo, 0.5), ctx({ body })));
    for (const g of MUSCLE_GROUPS.filter((m) => m !== 'hamstrings')) expect(shows(front, g), g).toBe(true);
    // From behind (the trunk tipped toward the camera): the back, the deltoids and the arms.
    const back = all(drawBody(figureAt(EXERCISES.find((e) => e.id === 'rear-delt-fly')!.demo, 0.5), ctx({ body })));
    for (const g of ['back', 'shoulders', 'triceps', 'biceps', 'quads', 'glutes', 'calves'] as const) expect(shows(back, g), g).toBe(true);
  });

  it('draws her as her own figure: the same skeleton, a different body', () => {
    for (const [id, s] of [['back-squat', 0.5], ['bench-press', 1], ['lateral-raise', 0.5], ['rear-delt-fly', 0.5]] as const) {
      const fig = figureAt(EXERCISES.find((e) => e.id === id)!.demo, s);
      const him = drawBody(fig, ctx());
      const her = drawBody(fig, ctx({ body: 'female' }));
      expect(all(her), id).not.toBe(all(him));
      // No body named draws him; hers is about his size to repaint.
      expect(all(drawBody(fig, ctx({ body: undefined }))), id).toBe(all(him));
      expect(all(her).length, id).toBeLessThan(all(him).length * 1.15);
    }
  });

  it('rests her where he rests: lying, kneeling and planking, she neither sinks deeper nor floats', () => {
    // The layers that rest on the floor or a flat bench in each position (the back, the chest at the bottom of a
    // push-up and on a pad, the glutes, the arms and legs): the lowest point she reaches there is his, never lower
    // and at most 2 mm higher (a slimmer hand's fingertips).
    const cases: [string, number, (keyof BodyLayers)[]][] = [
      ['bench-press', 0, ['core', 'nearLeg']],
      ['bench-press', 1, ['core', 'nearLeg']],
      ['glute-bridge', 0, ['core', 'nearLeg']],
      ['hip-thrust', 1, ['core']],
      ['dead-bug', 0.5, ['core', 'nearLeg']],
      ['dead-bug', 1, ['core', 'nearLeg']],
      ['crunch', 0, ['core', 'nearLeg']],
      ['slider-leg-curl', 0, ['core', 'nearLeg']],
      ['push-up', 1, ['core', 'nearArm', 'nearLeg']],
      ['knee-push-up', 1, ['core', 'nearArm']],
      ['lying-leg-curl', 0, ['core']],
      ['dumbbell-floor-press', 1, ['core', 'nearArm']],
      ['side-plank', 0, ['nearArm', 'nearLeg']],
      ['side-lying-hip-abduction', 0, ['nearLeg']],
      ['plank', 0, ['nearArm', 'nearLeg']],
    ];
    for (const [id, s, layers] of cases) {
      const fig = figureAt(EXERCISES.find((e) => e.id === id)!.demo, s);
      const him = drawBody(fig, ctx());
      const her = drawBody(fig, ctx({ body: 'female' }));
      for (const layer of layers) {
        const gap = lowest(him[layer]) - lowest(her[layer]);
        expect(gap, `${id} ${layer}`).toBeGreaterThanOrEqual(-0.0002);
        expect(gap, `${id} ${layer}`).toBeLessThan(0.002);
      }
    }
  });

  it('rests her where he rests all along the surface: wherever she comes near it, he is as deep nearby', () => {
    // A local check (the lowest point alone can hide a hip that sinks while a foot is lowest): each of her points
    // within 6 mm of the surface must have one of his within 12 mm that is at least as close to it (0.3 mm slack).
    const cases: [string, number, 'floor' | number][] = [
      ['bench-press', 0, 0],
      ['bench-press', 1, 0],
      ['skull-crusher', 1, 0],
      ['glute-bridge', 0, 'floor'],
      ['glute-bridge', 1, 'floor'],
      ['hip-thrust', 1, 0],
      ['dead-bug', 0.5, 'floor'],
      ['crunch', 0, 'floor'],
      ['crunch', 1, 'floor'],
      ['hollow-body-hold', 0, 'floor'],
      ['slider-leg-curl', 0, 'floor'],
      ['push-up', 1, 'floor'],
      ['knee-push-up', 1, 'floor'],
      ['lying-leg-curl', 0, 0],
      ['dumbbell-floor-press', 1, 'floor'],
      ['plank', 0, 'floor'],
      ['side-plank', 0, 'floor'],
      ['side-lying-hip-abduction', 0, 'floor'],
      ['side-lying-hip-abduction', 1, 'floor'],
      ['seated-calf-raise', 0, 0],
    ];
    for (const [id, s, which] of cases) {
      const demo = EXERCISES.find((e) => e.id === id)!.demo;
      const fig = figureAt(demo, s);
      const gap = surfaceOf(demo, which);
      const near = (l: BodyLayers) => drawnPoints(all(l)).flatMap((p) => {
        const g = gap(p);
        return g === null ? [] : [{ ...p, g }];
      });
      const him = near(drawBody(fig, ctx()));
      const her = near(drawBody(fig, ctx({ body: 'female' })));
      for (const q of her) {
        if (q.g >= 0.006) continue;
        const his = Math.min(...him.filter((r) => Math.abs(r.x - q.x) < 0.012 && Math.abs(r.y - q.y) < 0.012).map((r) => r.g));
        expect(q.g, `${id} at s=${s}: her point (${q.x.toFixed(3)}, ${q.y.toFixed(3)})`).toBeGreaterThanOrEqual(his - 0.0003);
      }
    }
  });

  it('lays her hair where her head rests: lying on a bench or the floor it reaches no deeper than the back of the head', () => {
    // Her ponytail fills the hollow behind the neck and her hair covers the back of the skull; his hair covers the
    // same skull, so wherever the head rests her hair comes no closer to the surface than his (0.3 mm slack).
    const cases: [string, number, 'floor' | number][] = [
      ['bench-press', 0, 0],
      ['skull-crusher', 1, 0],
      ['glute-bridge', 0, 'floor'],
      ['glute-bridge', 1, 'floor'],
      ['dead-bug', 0.5, 'floor'],
      ['crunch', 0, 'floor'],
      ['slider-leg-curl', 0, 'floor'],
      ['dumbbell-floor-press', 1, 'floor'],
    ];
    const hairOf = (markup: string, fill: string) => [...markup.matchAll(new RegExp(`<path d="([^"]+)" fill="var\\(${fill}\\)"`, 'g'))].map((m) => `<path d="${m[1]}"`).join('');
    for (const [id, s, which] of cases) {
      const demo = EXERCISES.find((e) => e.id === id)!.demo;
      const fig = figureAt(demo, s);
      const gap = surfaceOf(demo, which);
      const closest = (markup: string) => Math.min(...drawnPoints(markup).map((p) => gap(p) ?? Infinity));
      const his = closest(hairOf(all(drawBody(fig, ctx())), '--fig-hair'));
      const hers = closest(hairOf(all(drawBody(fig, ctx({ body: 'female' }))), '--fig-hair-her'));
      expect(his, `${id} at s=${s}: his head rests`).toBeLessThan(0.008);
      expect(hers, `${id} at s=${s}`).toBeGreaterThanOrEqual(his - 0.0003);
    }
  });

  it('lights her main movers about as much as his: the core, the deltoids and the chest', () => {
    const areaIn = (markup: string, level: number) =>
      [...markup.matchAll(new RegExp(`<path d="([^"]+)" fill="${fill(level)}"`, 'g'))].reduce((sum, m) => sum + areaOf(`<path d="${m[1]}" fill="${fill(level)}"`, level), 0);
    const cases: [string, number, MuscleGroup][] = [
      ['plank', 0, 'core'],
      ['crunch', 1, 'core'],
      ['dead-bug', 0.5, 'core'],
      ['side-plank', 0, 'core'],
      ['lateral-raise', 1, 'shoulders'],
      ['overhead-press', 0.5, 'shoulders'],
      ['front-raise', 1, 'shoulders'],
      ['push-up', 1, 'chest'],
      ['bench-press', 0.5, 'chest'],
      ['dumbbell-fly', 0.5, 'chest'],
    ];
    for (const [id, s, g] of cases) {
      const fig = figureAt(EXERCISES.find((e) => e.id === id)!.demo, s);
      const lit = (body: BodyKind) => areaIn(all(drawBody(fig, ctx({ level: { ...LEVELS, [g]: 0.97 }, body }))), 0.97);
      expect(lit('female') / lit('male'), `${id} ${g}`).toBeGreaterThan(0.85);
    }
  });

  it('fades the hair only a bowed head shows while the chest view fades in, so it never shows through her face', () => {
    const bowed = (torsoScale: number, body: BodyKind) => draw(posed('front', { torsoScale }), {}, body).core;
    // Fully bowed (k <= 0.6): her knot and parting at full strength; crossfading (k = 0.7): faded; him: no such hair.
    expect(bowed(0.5, 'female')).not.toMatch(/ opacity="/);
    expect(bowed(0.7, 'female')).toMatch(/fill="var\(--fig-hair-her\)"[^>]*opacity="\.\d+"/);
    expect(bowed(0.7, 'male')).not.toMatch(/fill="var\(--fig-hair\)"[^>]*opacity=/);
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

  it.each(BODIES)('keeps the resting side of a one-sided exercise near rest (%s)', (body) => {
    const fig = figureAt(EXERCISES.find((e) => e.id === 'one-arm-dumbbell-row')!.demo, 0.5);
    const both = all(drawBody(fig, ctx({ body })));
    const one = all(drawBody(fig, ctx({ working: 'a', body })));
    const part = all(drawBody(fig, ctx({ working: 'a', otherSide: 0.3, body })));
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

describe.each(BODIES)('the working muscle stays in view (%s)', (body) => {
  it('draws both ears on a face seen from the front', () => {
    const fig = posed('front');
    const ears = draw(fig, {}, body).core.match(/<path d="([^"]+)" fill="var\(--fig-skin\)" stroke="var\(--fig-edge\)" stroke-width="\.004"/);
    const xs = outlinesOf(ears?.[1] ?? '').map((p) => p.reduce((a, q) => a + q.x, 0) / p.length);
    expect(xs).toHaveLength(2);
    expect(Math.min(...xs)).toBeLessThan(fig.head.x - 0.03);
    expect(Math.max(...xs)).toBeGreaterThan(fig.head.x + 0.03);
  });

  it('carries a working back onto the near arm that covers it at the top of a row', () => {
    const row = (arm: DemoPose['arm']) => posed('side', { torso: 70, head: 58, leg: { thigh: 138, shin: 182, foot: 90 }, arm });
    const top = row({ upper: -87, fore: 154, scale: 0.78, foreScale: 0.89 });
    expect(shows(draw(top, { back: 0.9 }, body).nearArm, 'back', 0.9)).toBe(true);
    // Arms hanging below the shoulders cover little of the back; a back at rest needs no help.
    expect(shows(draw(row({ upper: 175, fore: 175 }), { back: 0.9 }, body).nearArm, 'back', 0.9)).toBe(false);
    expect(shows(draw(top, { back: 0 }, body).nearArm, 'back', 0)).toBe(false);
  });

  it('carries a working chest onto the near arm that covers it in a press', () => {
    const press = posed('side', {
      torso: 274.4, bend: -12, head: 266, leg: { thigh: 104.3, shin: -167.7, foot: 90 },
      arm: { upper: 40.8, fore: -12, scale: 0.53, foreScale: 0.9 }, anchor: 'hip', at: { x: 0, y: -0.3 },
    });
    expect(shows(draw(press, { chest: 0.85 }, body).nearArm, 'chest', 0.85)).toBe(true);
    expect(shows(draw(press, { chest: 0 }, body).nearArm, 'chest', 0)).toBe(false);
  });

  it('never hides a working triceps under the face, and keeps the face over a raised arm by the head', () => {
    // Overhead extension: the upper arm crosses the side of the face with the triceps toward it.
    const extension = draw(posed('side', { torso: 3, head: 3, arm: { upper: 11, fore: -50 } }), { triceps: 0.95 }, body).nearArm;
    const face = extension.lastIndexOf('var(--fig-face)');
    expect(shows(extension, 'triceps', 0.95)).toBe(true);
    expect(face < 0 || extension.lastIndexOf(fill(0.95)) > face).toBe(true);
    // While the arm is raised by the head the face is drawn over it (hanging, arm across the face), so it never pops mid-rep;
    // an arm down by the side leaves the face alone.
    expect(draw(posed('side', { arm: { upper: 0, fore: 0 } }), {}, body).nearArm).toContain('var(--fig-face)');
    expect(draw(posed('side', { arm: { upper: 28, fore: -25 } }), {}, body).nearArm).toContain('var(--fig-face)');
    expect(draw(posed('side', { arm: { upper: 180, fore: 180 } }), {}, body).nearArm).not.toContain('var(--fig-face)');
  });

  it('draws an arm pointing at the camera as a clean limb seen end-on', () => {
    const arm = (scale: number) => draw(posed('side', { arm: { upper: 90, fore: 90, scale, foreScale: scale } }), {}, body).nearArm;
    expect(shows(arm(1), 'biceps') && shows(arm(1), 'triceps')).toBe(true);
    // End-on the arm's bellies give way; the round deltoid cap stays.
    const endOn = arm(0.15);
    expect(shows(endOn, 'biceps') || shows(endOn, 'triceps')).toBe(false);
    expect(shows(endOn, 'shoulders')).toBe(true);
  });

  it('keeps a steadying core modest and lets a working one swell', () => {
    const core = (level: number) => areaOf(draw(posed('side'), { core: level }, body).core, level);
    expect(core(0.97)).toBeGreaterThan(core(0.33) * 1.15);
  });

  it('gives the triceps a full belly on the back of the upper arm', () => {
    // It is about two thirds of the upper arm's muscle: on a straight arm at least the size of the biceps.
    const arm = draw(posed('side'), { biceps: 0.61, triceps: 0.62 }, body).nearArm;
    expect(areaOf(arm, 0.62)).toBeGreaterThan(areaOf(arm, 0.61));
  });
});
