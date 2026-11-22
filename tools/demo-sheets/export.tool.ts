// Exports demo frames as SVG markup for tools/demo-sheets/sheets.cjs.
// Environment: DEMO_OUT (json path), DEMO_IDS (comma list, empty = all),
// DEMO_FRAMES (number of frames from s = 0 to 1).
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { engagementFor } from '../../src/data/engagement';
import { EXERCISES } from '../../src/data/exercises';
import { levelsAt, peakLevels } from '../../src/demo/engagement';
import { demoBounds, frameMarkup, viewBoxOf } from '../../src/demo/render';

it('export demo frames', () => {
  const ids = (process.env.DEMO_IDS ?? '').split(',').filter(Boolean);
  const count = Math.max(2, Number(process.env.DEMO_FRAMES ?? 5));
  const unknown = ids.filter((id) => !EXERCISES.some((e) => e.id === id));
  if (unknown.length) throw new Error(`Unknown exercise id(s): ${unknown.join(', ')}`);
  const list = ids.length ? ids.map((id) => EXERCISES.find((e) => e.id === id)!) : EXERCISES;
  const out = list.map((e) => {
    const box = demoBounds(e.demo);
    const spec = engagementFor(e);
    const hold = e.tracking.kind === 'hold';
    const steps = hold ? [0] : Array.from({ length: count }, (_, k) => k / (count - 1));
    return {
      id: e.id,
      name: e.name,
      view: e.demo.view,
      viewBox: viewBoxOf(box),
      aspect: box.w / box.h,
      firstPhase: e.tracking.kind === 'reps' ? e.tracking.firstPhase : 'hold',
      muscles: spec.muscles.map((m) => ({ group: m.group, role: m.role, peak: m.peak })),
      frames: steps.map((s) => ({
        s,
        // Levels as when lifting through (or holding at) this position.
        svg: frameMarkup(e.demo, s, hold ? peakLevels(spec) : levelsAt(spec, { phase: 'out', s, u: s, action: 'lifting' }), box, `${e.id}-${Math.round(s * 100)}`),
      })),
    };
  });
  writeFileSync(process.env.DEMO_OUT!, JSON.stringify(out));
});
