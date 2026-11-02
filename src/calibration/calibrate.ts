// Phase 4 calibration: compare the engine's verdicts with the user's own
// labels on recorded reps, measure accuracy per check, suggest thresholds and
// export the results. Pure functions (no DOM), so they're tested directly.
import type { Check, Exercise } from '../data/types';
import { analyze } from '../engine/analyze';
import type { CheckResult, PoseSequence, ThresholdOverrides } from '../engine/types';

/** A recorded set for calibration: landmarks only, never video. */
export interface CalibrationRecording {
  id: string;
  exerciseId: string;
  createdAt: string;
  source: 'camera' | 'file';
  seq: PoseSequence;
  /** Per rep index: the faults the user saw ([] = good rep). Missing = not labelled. */
  labels: Record<number, string[]>;
}

/** Threshold fields a check exposes for tuning, and which way they fail. */
export interface ThresholdField {
  field: string;
  /** 'min': the rep fails when the measured value is below it. 'max': above it. */
  direction: 'min' | 'max';
  step: number;
  unit: string;
}

export function thresholdFields(check: Check): ThresholdField[] {
  const deg = (field: string, direction: 'min' | 'max'): ThresholdField => ({ field, direction, step: 1, unit: '°' });
  switch (check.type) {
    case 'jointAngle':
      return [...(check.min !== undefined ? [deg('min', 'min')] : []), ...(check.max !== undefined ? [deg('max', 'max')] : [])];
    case 'rangeOfMotion':
      return [deg('minDeg', 'min')];
    case 'relativeHeight':
      return [{ field: 'margin', direction: 'min', step: 0.01, unit: '× torso' }];
    case 'torsoAngle':
      return [...(check.minDeg !== undefined ? [deg('minDeg', 'min')] : []), ...(check.maxDeg !== undefined ? [deg('maxDeg', 'max')] : [])];
    case 'path':
      return [{ field: 'maxDrift', direction: 'max', step: 0.01, unit: '× torso' }];
    case 'symmetry':
      return [deg('maxDiffDeg', 'max')];
    case 'tempo':
      return [
        ...(check.minSec !== undefined ? [{ field: 'minSec', direction: 'min' as const, step: 0.1, unit: 's' }] : []),
        ...(check.maxSec !== undefined ? [{ field: 'maxSec', direction: 'max' as const, step: 0.1, unit: 's' }] : []),
      ];
    case 'lockout':
      return [deg('minDeg', 'min')];
    case 'holdAlignment':
      return [deg('min', 'min'), deg('max', 'max')];
  }
}

/** The user's label says this check should fail on the rep. */
export const expectedFail = (check: Check, faults: string[]) => faults.includes(check.fault);

export interface CheckScore {
  checkId: string;
  label: string;
  /** Engine said fail and the label says fail. */
  truePos: number;
  /** Engine said fail, label says pass. */
  falsePos: number;
  /** Engine said pass, label says fail. */
  falseNeg: number;
  trueNeg: number;
  unknown: number;
  /** Agreement on judged reps, or null when no labelled rep was judged. */
  accuracy: number | null;
}

export interface ScoredRep {
  recordingId: string;
  repIndex: number;
  faults: string[] | null;
  checks: CheckResult[];
}

export interface CalibrationScore {
  perCheck: CheckScore[];
  reps: ScoredRep[];
  labelledReps: number;
}

/** Runs the engine on every recording and compares each check with the labels. */
export function scoreRecordings(
  exercise: Exercise,
  recordings: CalibrationRecording[],
  overrides: ThresholdOverrides,
): CalibrationScore {
  const reps: ScoredRep[] = [];
  for (const rec of recordings) {
    // Personalisation is off so thresholds are tuned for reference proportions.
    const result = analyze(exercise, rec.seq, { overrides });
    const items = result.hold ? [{ index: 0, checks: result.hold.checks }] : result.reps;
    for (const r of items) reps.push({ recordingId: rec.id, repIndex: r.index, faults: rec.labels[r.index] ?? null, checks: r.checks });
  }
  const perCheck = exercise.checks.map((check): CheckScore => {
    const s: CheckScore = { checkId: check.id, label: check.label, truePos: 0, falsePos: 0, falseNeg: 0, trueNeg: 0, unknown: 0, accuracy: null };
    for (const rep of reps) {
      if (!rep.faults) continue;
      const v = rep.checks.find((c) => c.checkId === check.id);
      if (!v || v.status === 'unknown') {
        s.unknown++;
        continue;
      }
      const want = expectedFail(check, rep.faults);
      const got = v.status === 'fail';
      if (got && want) s.truePos++;
      else if (got) s.falsePos++;
      else if (want) s.falseNeg++;
      else s.trueNeg++;
    }
    const judged = s.truePos + s.falsePos + s.falseNeg + s.trueNeg;
    s.accuracy = judged ? (s.truePos + s.trueNeg) / judged : null;
    return s;
  });
  return { perCheck, reps, labelledReps: reps.filter((r) => r.faults).length };
}

export interface Suggestion {
  field: string;
  value: number;
  accuracy: number;
  /** Accuracy with the current threshold, for comparison. */
  current: number;
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/**
 * Threshold that best separates labelled good and faulty reps for a
 * single-bound field, using the measured value of each rep. Returns null
 * unless it beats the current threshold.
 */
export function suggestThreshold(
  field: ThresholdField,
  current: number,
  samples: { value: number; expectFail: boolean }[],
): Suggestion | null {
  const usable = samples.filter((s) => Number.isFinite(s.value));
  if (usable.length < 2) return null;
  const fails = (t: number, v: number) => (field.direction === 'min' ? v < t : v > t);
  const accuracyAt = (t: number) => usable.filter((s) => fails(t, s.value) === s.expectFail).length / usable.length;
  const values = [...new Set(usable.map((s) => s.value))].sort((a, b) => a - b);
  const candidates = [values[0] - field.step, ...values.slice(1).map((v, i) => (v + values[i]) / 2), values[values.length - 1] + field.step];
  const base = accuracyAt(current);
  let best: Suggestion | null = null;
  for (const raw of candidates) {
    const t = Number(roundTo(raw, field.step).toFixed(4));
    const acc = accuracyAt(t);
    const better = !best || acc > best.accuracy || (acc === best.accuracy && Math.abs(t - current) < Math.abs(best.value - current));
    if (better) best = { field: field.field, value: t, accuracy: acc, current: base };
  }
  return best && best.accuracy > base ? best : null;
}

/** Measured values per labelled rep for one check, for suggestions. */
export function samplesFor(check: Check, score: CalibrationScore): { value: number; expectFail: boolean }[] {
  return score.reps
    .filter((r) => r.faults)
    .map((r) => ({ r, v: r.checks.find((c) => c.checkId === check.id) }))
    .filter(({ v }) => v && v.status !== 'unknown' && v.value !== undefined)
    .map(({ r, v }) => ({ value: v!.value!, expectFail: expectedFail(check, r.faults!) }));
}

// ── Export formats ─────────────────────────────────────────────────────────

export interface CalibratedThresholds {
  version: 1;
  exportedAt: string;
  exercises: Record<string, Record<string, { values: Record<string, number>; labelledReps: number; accuracy: number | null }>>;
}

/** Thresholds JSON for the repo (src/data/calibrated.json). */
export function exportThresholds(
  exercise: Exercise,
  overrides: ThresholdOverrides,
  score: CalibrationScore,
  previous?: CalibratedThresholds,
  now = new Date(),
): CalibratedThresholds {
  const out: CalibratedThresholds = previous
    ? { ...previous, exportedAt: now.toISOString(), exercises: { ...previous.exercises } }
    : { version: 1, exportedAt: now.toISOString(), exercises: {} };
  const mine = overrides[exercise.id] ?? {};
  out.exercises[exercise.id] = Object.fromEntries(
    exercise.checks.map((c) => {
      const values = Object.fromEntries(
        thresholdFields(c).map((f) => [f.field, mine[c.id]?.[f.field] ?? (c as unknown as Record<string, number>)[f.field]]),
      );
      const s = score.perCheck.find((p) => p.checkId === c.id);
      const judged = s ? s.truePos + s.falsePos + s.falseNeg + s.trueNeg : 0;
      return [c.id, { values, labelledReps: judged, accuracy: s?.accuracy ?? null }];
    }),
  );
  return out;
}

export interface LabelledFixtureBundle {
  version: 1;
  exerciseId: string;
  exportedAt: string;
  fixtures: {
    name: string;
    labels: { rep: number; startFrame: number; endFrame: number; faults: string[] }[];
    sequence: PoseSequence;
  }[];
}

/** Landmark sequences (numbers only) with the user's labels, as test fixtures. */
export function exportFixtures(exercise: Exercise, recordings: CalibrationRecording[], now = new Date()): LabelledFixtureBundle {
  return {
    version: 1,
    exerciseId: exercise.id,
    exportedAt: now.toISOString(),
    fixtures: recordings.map((rec, i) => {
      const reps = analyze(exercise, rec.seq).reps;
      return {
        name: `${exercise.id}-${i + 1}`,
        labels: reps
          .filter((r) => rec.labels[r.index])
          .map((r) => ({ rep: r.index, startFrame: r.startFrame, endFrame: r.endFrame, faults: rec.labels[r.index] })),
        sequence: rec.seq,
      };
    }),
  };
}

/**
 * Applies calibrated thresholds (src/data/calibrated.json) to the library:
 * values replace the drafts, status becomes 'calibrated' and the source notes
 * how many labelled reps they were tuned on.
 */
export function applyCalibration(exercises: Exercise[], calibrated: Partial<CalibratedThresholds>): Exercise[] {
  const table = calibrated.exercises ?? {};
  return exercises.map((e) => {
    const mine = table[e.id];
    if (!mine) return e;
    return {
      ...e,
      checks: e.checks.map((c) => {
        const cal = mine[c.id];
        if (!cal) return c;
        const allowed = new Set(thresholdFields(c).map((f) => f.field));
        const values = Object.fromEntries(Object.entries(cal.values).filter(([k, v]) => allowed.has(k) && Number.isFinite(v)));
        const date = calibrated.exportedAt ? calibrated.exportedAt.slice(0, 10) : 'unknown date';
        const acc = cal.accuracy === null ? '' : `, ${Math.round(cal.accuracy * 100)}% agreement`;
        return {
          ...c,
          ...values,
          status: 'calibrated',
          source: `${c.source ?? ''} · Calibrated on ${cal.labelledReps} labelled reps (${date}${acc}).`,
        } as Check;
      }),
    };
  });
}
