// Writes the synthetic landmark fixtures in tests/fixtures/*.json.gz.
// Run: npm run fixtures. Deterministic (seeded), so re-running gives the same files.
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../tests/fixtures/synth.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const good = { out: 1.8, hold: 0.2, back: 1.1, rest: 0.8 };
const bad = { ...good, fault: true };

const fixtures: Record<string, S.PoseSequence> = {
  'squat-good': S.squat({ seed: 1 }),
  'squat-shallow': S.squat({ seed: 2, reps: [good, bad, good, bad] }),
  'squat-lean': S.squat({ seed: 3, faultKind: 'lean', reps: [good, bad, good, bad] }),
  'squat-fast': S.squat({ seed: 4, reps: [good, { ...good, out: 0.5 }, good] }),
  'squat-noisy': S.squat({
    seed: 5,
    noisePx: 4,
    // Knee hidden around the bottom of the third rep (bottom ≈ 10.8–11.0 s).
    dropouts: [{ joints: ['knee'], fromMs: 10300, toMs: 11600 }],
  }),
  'squat-front': S.squat({ seed: 6, view: 'front' }),
  'squat-cut': S.squat({ seed: 7, reps: [good, good, good], endAtTurn: true }),
  'squat-bounces': S.squat({
    seed: 8,
    reps: [good, { out: 0.4, back: 0.4, depth: 0.12, rest: 0.4 }, good, { out: 0.3, back: 0.3, depth: 0.1, rest: 0.4 }],
  }),
  'bench-good': S.bench({ seed: 10 }),
  'bench-partial': S.bench({ seed: 11, reps: [good, bad, good, bad].map((r) => ({ ...r, out: 1.6, back: 1.0 })) }),
  'bench-drift': S.bench({ seed: 12, drift: 170 }),
  'deadlift-good': S.deadlift({ seed: 20 }),
  'deadlift-hips-high': S.deadlift({ seed: 21, reps: [1, 2, 3].map(() => ({ out: 1.2, hold: 0.4, back: 1.2, rest: 1.0, fault: true })) }),
  'deadlift-soft-lockout': S.deadlift({ seed: 22, lockout: 0.75 }),
  'rdl-good': S.rdl({ seed: 30 }),
  'rdl-squatting': S.rdl({ seed: 31, reps: [1, 2, 3, 4].map((i) => ({ out: 2.4, hold: 0.2, back: 1.2, rest: 0.6, fault: i > 2 })) }),
  'ohp-good': S.overheadPress({ seed: 40 }),
  'ohp-lean-back': S.overheadPress({ seed: 41, reps: [1, 2, 3, 4].map((i) => ({ out: 1.1, hold: 0.3, back: 1.4, rest: 0.6, fault: i >= 3 })) }),
  'ohp-short-lockout': S.overheadPress({ seed: 42, lockoutReach: 290 }),
  'row-good': S.barbellRow({ seed: 50 }),
  'row-swinging': S.barbellRow({ seed: 51, reps: [1, 2, 3, 4].map((i) => ({ out: 0.9, hold: 0.2, back: 1.6, rest: 0.4, fault: i >= 3 })) }),
  'lateral-raise-front': S.lateralRaise({ seed: 60, reps: [1, 2, 3, 4].map((i) => ({ out: 1.0, hold: 0.3, back: 1.4, rest: 0.4, fault: i >= 3 })) }),
  'plank-good': S.plank({ seed: 70 }),
  'plank-sag': S.plank({ seed: 71, sagPx: 90 }),
  'calf-raise': S.calfRaise({ seed: 80 }),
};

// Synthetic fixtures are stored gzipped (the generator above is their
// source); real recordings from Phase 4 can be plain .json.
for (const f of readdirSync(dir)) if (f.endsWith('.json.gz')) rmSync(join(dir, f));
for (const [name, seq] of Object.entries(fixtures)) {
  writeFileSync(join(dir, `${name}.json.gz`), gzipSync(JSON.stringify(seq), { level: 9 }));
}
console.log(`Wrote ${Object.keys(fixtures).length} fixtures to tests/fixtures/`);
