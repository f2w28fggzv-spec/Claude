// Made-up sample data for the landing page's screenshots of the real app
// (never real user data). tools/landing-screens/shoot.cjs bundles this with
// Vite and opens it at the app build's origin, so it writes the same
// localStorage and IndexedDB the app reads. It uses the app's own modules: the
// program builder, the session helpers, the analysis engine on a set made
// from the back squat demo's landmarks, and the saved-set store. A dev tool,
// not part of the app or the page.
import { EXERCISES_BY_ID } from '../../src/data/exercises';
import type { Exercise } from '../../src/data/types';
import { solve, sub, type Figure, type Side, type Vec } from '../../src/demo/figure';
import { progressAt, returningAt, timeline } from '../../src/demo/timeline';
import { analyze } from '../../src/engine/analyze';
import type { AnalysisResult, PoseFrame, PoseSequence, RawLandmark } from '../../src/engine/types';
import { completeSet, finishWorkout, startFromPlan } from '../../src/log/session';
import { saveMode, saveTechnique, saveUnit, saveWorkout, loadWorkouts, loadTechnique } from '../../src/log/store';
import type { Workout } from '../../src/log/types';
import { saveProfile, TERMS_VERSION } from '../../src/profile';
import { buildProgram } from '../../src/program/builder';
import { saveSet, saveSetVideo } from '../../src/sets/sets';
import { frameMarkup, type FrameBox } from '../../src/demo/render';
import type { Levels } from '../../src/demo/engagement';
import { saveGroups, saveProgram } from '../../src/storage';
import TOKENS from '../../src/tokens.css?raw';

const SIDE_INDEX: Record<Exclude<keyof Side, 'hand' | 'ball'>, [right: number, left: number]> = {
  shoulder: [12, 11],
  elbow: [14, 13],
  wrist: [16, 15],
  hip: [24, 23],
  knee: [26, 25],
  ankle: [28, 27],
  heel: [30, 29],
  toe: [32, 31],
};

/**
 * The demo as a recording, like tests/fixtures/demoSeq.ts, with per-rep
 * changes: `depth` scales how far a rep goes (1 = the demo's full depth), and
 * `dim` lowers the knees' visibility in a rep (the camera losing them).
 */
interface DemoSet {
  seq: PoseSequence;
  /** Per frame: the demo's progress and direction, to draw the same figure into a sample video. */
  steps: { s: number; back: boolean }[];
  /** World coordinates → image pixels: px = x * scale + ox. */
  map: { scale: number; ox: number; oy: number; width: number; height: number };
}

function demoSet(e: Exercise, reps: { depth?: number; dim?: boolean }[], fps = 20): DemoSet {
  const demo = e.demo;
  const tl = timeline(e, demo.pauseFar);
  const seconds = reps.length * tl.total + 0.8;
  const width = 720;
  const height = 1280;
  const figures: { f: Figure; rep: number }[] = [];
  const steps: { s: number; back: boolean }[] = [];
  for (let k = 0; k * (1000 / fps) <= seconds * 1000; k++) {
    const t = k / fps;
    const rep = Math.floor(t / tl.total);
    const moving = rep < reps.length;
    const depth = moving ? (reps[rep].depth ?? 1) : 1;
    const s = moving ? progressAt(tl, t) * depth : 0;
    const back = moving && returningAt(tl, t) && demo.back;
    figures.push({ f: solve(demo.view, back ? back(s) : demo.pose(s)), rep });
    steps.push({ s, back: !!back });
  }
  const all: Vec[] = figures.flatMap(({ f }) => [...Object.values(f.a), ...Object.values(f.b), f.head]);
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y)) - 0.06;
  const maxY = Math.max(...all.map((p) => p.y));
  const scale = Math.min((width * 0.8) / (maxX - minX), (height * 0.8) / (maxY - minY));
  const ox = (width - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (height - (maxY - minY) * scale) / 2 - minY * scale;
  // A little landmark jitter, as a real recording has.
  let seed = 7;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 0.0016;
  };
  const norm = (p: Vec, v: number): RawLandmark => [
    Math.round(((p.x * scale + ox) / width + noise()) * 10000) / 10000,
    Math.round(((p.y * scale + oy) / height + noise()) * 10000) / 10000,
    0,
    v,
  ];
  const frames: PoseFrame[] = figures.map(({ f, rep }, k) => {
    const lm: RawLandmark[] = Array.from({ length: 33 }, () => [0, 0, 0, 0]);
    const dim = rep < reps.length && reps[rep].dim;
    for (const key of Object.keys(SIDE_INDEX) as (keyof typeof SIDE_INDEX)[]) {
      const [right, left] = SIDE_INDEX[key];
      const v = dim && key === 'knee' ? 0.42 : 0.97;
      lm[right] = norm(f.a[key], v);
      lm[left] = norm(f.b[key], dim && key === 'knee' ? 0.3 : 0.78);
    }
    lm[0] = norm(f.nose, 0.98);
    lm[8] = norm(f.ear, 0.95);
    lm[7] = norm(f.ear2, 0.7);
    // The rest of MediaPipe's 33 points, so the replay draws a whole skeleton: eyes and mouth from the ear and
    // nose, and the hand points around the grip.
    const fwd = sub(f.nose, f.ear);
    const len = Math.hypot(fwd.x, fwd.y) || 1;
    const u = { x: fwd.x / len, y: fwd.y / len };
    const up = { x: u.y, y: -u.x };
    const head = (along: number, rise: number, extra = 0): Vec => ({ x: f.ear.x + u.x * len * (along + extra) + up.x * len * rise, y: f.ear.y + u.y * len * (along + extra) + up.y * len * rise });
    lm[4] = norm(head(0.74, 0.2), 0.96);
    lm[5] = norm(head(0.68, 0.22), 0.96);
    lm[6] = norm(head(0.6, 0.22), 0.95);
    lm[1] = norm(head(0.76, 0.2, 0.03), 0.8);
    lm[2] = norm(head(0.7, 0.22, 0.03), 0.8);
    lm[3] = norm(head(0.62, 0.22, 0.03), 0.78);
    lm[10] = norm(head(0.82, -0.34), 0.95);
    lm[9] = norm(head(0.84, -0.34, 0.02), 0.8);
    for (const [side, w, pinky, index, thumb, vis] of [
      [f.a, 16, 18, 20, 22, 0.95],
      [f.b, 15, 17, 19, 21, 0.75],
    ] as const) {
      const d = sub(side.hand, side.wrist);
      const n = { x: -d.y, y: d.x };
      const at2 = (k: number, s: number): Vec => ({ x: side.wrist.x + d.x * k + n.x * s, y: side.wrist.y + d.y * k + n.y * s });
      void w;
      lm[pinky] = norm(at2(1.7, -0.35), vis);
      lm[index] = norm(at2(1.9, 0.25), vis);
      lm[thumb] = norm(at2(1.1, 0.6), vis);
    }
    return { t: Math.round((k * 1000) / fps), lm };
  });
  return { seq: { version: 1, width, height, source: 'camera', frames }, steps, map: { scale, ox, oy, width, height } };
}


/** The app's light theme tokens (the figure's skin, edges, equipment), from the shared token file. */
function lightTokens(): string {
  const start = TOKENS.indexOf(':root {');
  return TOKENS.slice(start, TOKENS.indexOf('\n}', start) + 2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A short sample video of the demo figure for frames [from, to), drawn exactly
 * where its landmarks are (same mapping), on a dark backdrop, at 20 fps. It
 * stands in for a lifter's recording so the saved set shows the app's video
 * replay with the skeleton drawn over it. Made-up sample data, never a real person.
 */
async function sampleVideo(e: Exercise, set: DemoSet, from: number, to: number): Promise<Blob> {
  const { scale, ox, oy, width, height } = set.map;
  const tokens = lightTokens();
  const box: FrameBox = { x: -ox / scale, y: -oy / scale, w: width / scale, h: height / scale };
  const rest = Object.fromEntries(['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core'].map((g) => [g, 0])) as Levels;
  const floorY = (0.035 * scale + oy).toFixed(1);
  const bitmaps: ImageBitmap[] = [];
  for (let k = from; k < to; k++) {
    const { s, back } = set.steps[k];
    const markup = frameMarkup(e.demo, s, rest, box, { id: `v${k}`, back, body: 'female' });
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<style>${tokens}</style>` +
      `<defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3d43"/><stop offset="1" stop-color="#2b2d32"/></linearGradient></defs>` +
      `<rect width="${width}" height="${height}" fill="url(#wall)"/>` +
      `<rect y="${floorY}" width="${width}" height="${height}" fill="#222428"/>` +
      `<g transform="matrix(${scale} 0 0 ${scale} ${ox} ${oy})">${markup}</g></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.src = url;
    await img.decode();
    bitmaps.push(await createImageBitmap(img));
    URL.revokeObjectURL(url);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmaps[0], 0, 0);
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start();
  const t0 = performance.now();
  for (let i = 0; i < bitmaps.length; i++) {
    ctx.drawImage(bitmaps[i], 0, 0);
    track.requestFrame();
    const next = t0 + (i + 1) * 50;
    await sleep(Math.max(0, next - performance.now()));
  }
  rec.stop();
  await stopped;
  return new Blob(chunks, { type: 'video/webm' });
}

const DAY = 86400000;
const at = (daysAgo: number, hour: number, min = 0) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, min, 0, 0);
  return d;
};

/** What the app saves to the log about a technique check (faults per rep, clean reps). */
function summaryOf(result: AnalysisResult) {
  const faults: Record<string, number> = {};
  for (const r of result.reps) for (const c of r.checks) if (c.status === 'fail' && c.fault) faults[c.fault] = (faults[c.fault] ?? 0) + 1;
  const cleanReps = result.reps.filter((r) => r.checks.every((c) => c.status !== 'fail')).length;
  return { faults, cleanReps };
}

async function saveCheck(e: Exercise, seq: PoseSequence, when: Date, id: string) {
  const result = analyze(e, seq);
  const { faults, cleanReps } = summaryOf(result);
  const iso = when.toISOString();
  saveTechnique({ exerciseId: e.id, at: iso, reps: result.reps.length, faults, cleanReps, setId: id });
  await saveSet(
    { id, exerciseId: e.id, at: iso, source: 'camera', durationSec: Math.round((seq.frames.at(-1)?.t ?? 0) / 100) / 10, reps: result.reps.length, cleanReps, faults, mirrored: true },
    { seq, result },
  );
  return { result, faults, cleanReps };
}

(window as unknown as { seed: () => Promise<unknown> }).seed = async () => {
  localStorage.clear();
  saveProfile({ figure: 'female', termsAcceptedAt: at(24, 18).toISOString(), termsVersion: TERMS_VERSION });
  saveUnit('kg');
  saveMode('coach');
  const groups = ['quads', 'glutes', 'chest', 'back'] as const;
  saveGroups([...groups]);
  const program = buildProgram({ groups: [...groups], daysPerWeek: 3, level: 'intermediate', equipment: 'fullGym' }, at(22, 19));
  saveProgram(program);

  const squat = EXERCISES_BY_ID.get('back-squat')!;
  // Sample loads: a lifter a few months in.
  const base: Record<string, number> = {
    'back-squat': 75,
    'bench-press': 52.5,
    deadlift: 95,
    'overhead-press': 35,
    'barbell-row': 50,
    'romanian-deadlift': 70,
  };
  const guess = (id: string) => {
    const ex = EXERCISES_BY_ID.get(id);
    if (base[id] !== undefined) return base[id];
    if (!ex) return 20;
    if (ex.equipment.includes('dumbbell')) return 14;
    if (ex.equipment.includes('machine') || ex.equipment.includes('cable')) return 30;
    if (ex.equipment.includes('barbell')) return 40;
    return 0;
  };
  // Plan days on Mondays, Wednesdays and Fridays for three weeks, then Monday and Wednesday this week.
  // With "today" a Friday (app-shots.cjs fixes the clock), Day 1 is next and this week is 2 of 3.
  const sessions = [21, 18, 16, 14, 11, 9, 7, 4, 2];
  let workouts: Workout[] = [];
  const squatDays: Date[] = [];
  for (const [n, daysAgo] of sessions.entries()) {
    const dayIndex = n % program.days.length;
    const start = at(daysAgo, 18, 10);
    const w = startFromPlan(program, dayIndex, workouts, [], 'kg', start);
    const week = Math.floor(n / 3);
    for (const entry of w.entries) {
      const ex = EXERCISES_BY_ID.get(entry.exerciseId);
      const kg = entry.target?.weight ?? guess(entry.exerciseId) + week * (ex?.equipment.includes('dumbbell') ? 2 : 2.5);
      const [lo, hi] = entry.target?.reps ?? [8, 12];
      const bodyOnly = !!ex && ex.equipment.every((q) => q === 'bodyweight' || q === 'pullupBar' || q === 'dipBars' || q === 'bench');
      entry.sets = entry.sets.map((s, i) => {
        const reps = Math.min(hi, (s.planned?.reps ?? lo) + (i === 0 ? 1 : 0));
        const timed = entry.target?.unit === 'seconds';
        return completeSet({ ...s, weight: bodyOnly ? undefined : kg, reps: timed ? undefined : reps, seconds: timed ? (s.planned?.seconds ?? 30) : undefined });
      });
    }
    saveWorkout(finishWorkout(w, new Date(start.getTime() + 58 * 60000)));
    workouts = loadWorkouts();
    if (w.entries.some((e) => e.exerciseId === 'back-squat')) squatDays.push(new Date(start.getTime() + 14 * 60000));
  }
  // Technique checks on the back squat in its last three sessions: shallow depth on two reps, then a clean set,
  // then the set shown on the page: one shallow rep and one the camera couldn't judge (the knee out of sight).
  const plans: { reps: { depth?: number; dim?: boolean }[]; id: string }[] = [
    { reps: [{}, { depth: 0.74 }, {}, { depth: 0.72 }, {}], id: 'sampleA' },
    { reps: [{}, {}, {}, {}, {}], id: 'sampleB' },
    { reps: [{}, {}, { depth: 0.74 }, { dim: true }, {}], id: 'sampleC' },
  ];
  const days = squatDays.slice(-3);
  let shown: unknown = null;
  for (const [k, when] of days.entries()) {
    const c = plans[plans.length - days.length + k];
    const set = demoSet(squat, c.reps);
    const out = await saveCheck(squat, set.seq, when, c.id);
    if (c.id === 'sampleC') {
      // The page shows rep 3 at its turnaround: a sample video around it (1.5 s each way).
      const turn = out.result.reps[2].turnFrame;
      const from = Math.max(0, turn - 30);
      const to = Math.min(set.steps.length, turn + 30);
      const video = await sampleVideo(squat, set, from, to);
      await saveSetVideo(c.id, video, set.seq.frames[from].t);
      shown = {
        id: c.id,
        video: { bytes: video.size, type: video.type, offsetMs: set.seq.frames[from].t },
        reps: out.result.reps.map((r) => ({ turn: r.turnFrame, tTurn: set.seq.frames[r.turnFrame].t / 1000, checks: r.checks.map((x) => `${x.label}:${x.status}`) })),
      };
    }
  }
  return { program: program.days.map((d) => `${d.name}: ${d.items.map((i) => i.exerciseId).join(', ')}`), shown, technique: loadTechnique(), workouts: loadWorkouts().length };
};
