// Turns an exercise's animated demo into a landmark sequence, so the demo can
// be run through the analysis engine like a recording.
import type { Exercise } from '../../src/data/types';
import { solve, type Figure, type Side, type Vec } from '../../src/demo/figure';
import { progressAt, timeline } from '../../src/demo/timeline';
import type { PoseFrame, PoseSequence, RawLandmark } from '../../src/engine/types';

const SIDE_INDEX: Record<keyof Side, [right: number, left: number]> = {
  shoulder: [12, 11],
  elbow: [14, 13],
  wrist: [16, 15],
  hip: [24, 23],
  knee: [26, 25],
  ankle: [28, 27],
  heel: [30, 29],
  toe: [32, 31],
};

export function demoSequence(e: Exercise, o: { reps?: number; fps?: number } = {}): PoseSequence {
  const reps = o.reps ?? 3;
  const fps = o.fps ?? 20;
  const demo = e.demo;
  const tl = timeline(e, demo.pauseFar);
  const hold = e.tracking.kind === 'hold';
  const seconds = hold ? 6 : reps * tl.total + 0.8;
  const portrait = e.placement.orientation === 'portrait';
  const width = portrait ? 720 : 1280;
  const height = portrait ? 1280 : 720;

  const figures: Figure[] = [];
  for (let k = 0; k * (1000 / fps) <= seconds * 1000; k++) {
    const t = k / fps;
    const s = hold || t >= reps * tl.total ? 0 : progressAt(tl, t);
    figures.push(solve(demo.view, demo.pose(s)));
  }
  // Fit the whole movement into 80% of the frame.
  const all: Vec[] = figures.flatMap((f) => [...Object.values(f.a), ...Object.values(f.b), f.head]);
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y)) - 0.06;
  const maxY = Math.max(...all.map((p) => p.y));
  const scale = Math.min((width * 0.8) / (maxX - minX), (height * 0.8) / (maxY - minY));
  const ox = (width - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (height - (maxY - minY) * scale) / 2 - minY * scale;
  const norm = (p: Vec, v: number): RawLandmark => [
    Math.round(((p.x * scale + ox) / width) * 10000) / 10000,
    Math.round(((p.y * scale + oy) / height) * 10000) / 10000,
    0,
    v,
  ];

  const frames: PoseFrame[] = figures.map((f, k) => {
    const lm: RawLandmark[] = Array.from({ length: 33 }, () => [0, 0, 0, 0]);
    const side = demo.view === 'side';
    for (const key of Object.keys(SIDE_INDEX) as (keyof Side)[]) {
      const [right, left] = SIDE_INDEX[key];
      lm[right] = norm(f.a[key], side ? 0.98 : 0.97);
      lm[left] = norm(f.b[key], side ? 0.8 : 0.97);
    }
    lm[0] = norm(f.nose, 0.98);
    lm[8] = norm(f.ear, 0.95);
    lm[7] = norm(f.ear2, side ? 0.7 : 0.95);
    return { t: Math.round((k * 1000) / fps), lm };
  });
  return { version: 1, width, height, source: 'synthetic', frames };
}
