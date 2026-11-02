import { useEffect, useMemo, useState } from 'preact/hooks';
import { EXERCISES, getExercise } from '../data/exercises';
import type { Check } from '../data/types';
import type { ThresholdOverrides } from '../engine/types';
import {
  exportFixtures,
  exportThresholds,
  samplesFor,
  scoreRecordings,
  suggestThreshold,
  thresholdFields,
  type CalibrationRecording,
} from '../calibration/calibrate';
import { deleteRecording, loadRecordings, saveRecording } from '../calibration/store';
import calibrated from '../data/calibrated.json';
import type { CalibratedThresholds } from '../calibration/calibrate';
import { navigate } from '../router';
import { loadOverrides, saveOverride } from '../storage';
import { downloadJson } from '../ui/download';
import { showToast } from '../ui/toast';
import { Icon } from './icons';
import { Screen } from './Layout';

const ICON = { pass: '✓', fail: '✗', unknown: '?' } as const;
const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
const fmt = (v: number, step: number) => (step < 1 ? v.toFixed(2) : String(Math.round(v)));

/** Hidden developer screen (#/dev/calibrate): label your own reps and tune thresholds. */
export function DevCalibrate({ exerciseId }: { exerciseId?: string }) {
  const [id, setId] = useState(exerciseId && getExercise(exerciseId) ? exerciseId : 'back-squat');
  const exercise = getExercise(id)!;
  const [recordings, setRecordings] = useState<CalibrationRecording[] | null>(null);
  // Working copy of the thresholds; saved to the phone only on request.
  const [overrides, setOverrides] = useState<ThresholdOverrides>(loadOverrides);

  useEffect(() => {
    void loadRecordings().then(setRecordings);
  }, []);

  const recs = (recordings ?? []).filter((r) => r.exerciseId === id);
  const score = useMemo(() => scoreRecordings(exercise, recs, overrides), [exercise, recs, overrides]);

  const valueOf = (c: Check, field: string): number =>
    overrides[id]?.[c.id]?.[field] ?? (c as unknown as Record<string, number>)[field];
  const setValue = (c: Check, field: string, value: number) =>
    setOverrides((o) => ({ ...o, [id]: { ...(o[id] ?? {}), [c.id]: { ...(o[id]?.[c.id] ?? {}), [field]: value } } }));

  const setLabels = async (rec: CalibrationRecording, rep: number, faults: string[] | null) => {
    const labels = { ...rec.labels };
    if (faults === null) delete labels[rep];
    else labels[rep] = faults;
    const next = { ...rec, labels };
    setRecordings((all) => (all ?? []).map((r) => (r.id === rec.id ? next : r)));
    await saveRecording(next);
  };

  const remove = async (rec: CalibrationRecording) => {
    if (!confirm('Delete this recording? Only its landmark numbers are stored.')) return;
    await deleteRecording(rec.id);
    setRecordings((all) => (all ?? []).filter((r) => r.id !== rec.id));
  };

  const applyOnPhone = () => {
    for (const c of exercise.checks)
      for (const f of thresholdFields(c)) {
        const v = overrides[id]?.[c.id]?.[f.field];
        if (v !== undefined) saveOverride(id, c.id, f.field, v);
      }
    showToast('Thresholds saved on this phone');
  };
  const resetToDefaults = () => {
    setOverrides((o) => {
      const next = { ...o };
      delete next[id];
      return next;
    });
    for (const c of exercise.checks) for (const f of thresholdFields(c)) saveOverride(id, c.id, f.field, null);
    showToast('Back to the app’s thresholds');
  };
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <Screen title="Calibration" subtitle="Developer tools · landmark numbers only, never video" back="">
      <label class="field-row">
        <span>Exercise</span>
        <select value={id} onChange={(e) => setId(e.currentTarget.value)}>
          {[...EXERCISES].sort((a, b) => (a.analysis === b.analysis ? a.name.localeCompare(b.name) : a.analysis === 'full' ? -1 : 1)).map((e) => (
            <option value={e.id}>
              {e.analysis === 'full' ? '★ ' : ''}
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" class="big" onClick={() => navigate(`/analyze/${id}?calibrate`)}>
        <Icon name="camera" size={22} /> Record a set to label
      </button>
      <p class="muted small">
        Do deliberate good and bad reps (for example: good, shallow, good, leaning). Then label each rep below. Personal
        proportion adjustments are off here so thresholds are tuned for average proportions.
      </p>

      <section class="card">
        <h2>Accuracy per check</h2>
        <p class="muted small">
          {score.labelledReps} labelled rep{score.labelledReps === 1 ? '' : 's'}. A check should fail exactly when you labelled its fault.
        </p>
        {exercise.checks.length === 0 && <p class="muted">This exercise has no checks to calibrate (rep counting only).</p>}
        <ul class="cal-checks">
          {exercise.checks.map((c) => {
            const s = score.perCheck.find((p) => p.checkId === c.id)!;
            const judged = s.truePos + s.falsePos + s.falseNeg + s.trueNeg;
            return (
              <li>
                <div class="cal-head">
                  <strong>{c.label}</strong>
                  <span class={`acc ${s.accuracy === null ? '' : s.accuracy >= 0.9 ? 'good' : s.accuracy >= 0.7 ? 'ok' : 'bad'}`}>{pct(s.accuracy)}</span>
                </div>
                <small class="muted">
                  {judged ? `${s.truePos + s.trueNeg}/${judged} agree · missed faults ${s.falseNeg} · false alarms ${s.falsePos}` : 'No labelled reps yet'}
                  {s.unknown ? ` · ${s.unknown} couldn’t judge` : ''}
                </small>
                {thresholdFields(c).map((f) => {
                  const v = valueOf(c, f.field);
                  const sug = suggestThreshold(f, v, samplesFor(c, score));
                  return (
                    <div class="stepper-row">
                      <span class="muted small">
                        {f.field} ({f.unit}, {f.direction === 'min' ? 'fails below' : 'fails above'})
                      </span>
                      <div class="stepper">
                        <button type="button" aria-label="Decrease" onClick={() => setValue(c, f.field, Number((v - f.step).toFixed(4)))}>
                          <Icon name="minus" size={16} />
                        </button>
                        <output>{fmt(v, f.step)}</output>
                        <button type="button" aria-label="Increase" onClick={() => setValue(c, f.field, Number((v + f.step).toFixed(4)))}>
                          <Icon name="plus" size={16} />
                        </button>
                      </div>
                      {sug && (
                        <button type="button" class="link suggest" onClick={() => setValue(c, f.field, sug.value)}>
                          <Icon name="spark" size={16} /> Suggest {fmt(sug.value, f.step)} → {pct(sug.accuracy)}
                        </button>
                      )}
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ul>
        <div class="stack">
          <button type="button" onClick={applyOnPhone}>
            Use these thresholds on this phone
          </button>
          <button type="button" class="secondary" onClick={resetToDefaults}>
            Reset to the app’s thresholds
          </button>
          <button
            type="button"
            class="secondary"
            onClick={() =>
              downloadJson(
                `calibrated-${id}-${stamp}.json`,
                exportThresholds(exercise, overrides, score, calibrated as unknown as CalibratedThresholds),
              )
            }
          >
            Export thresholds (JSON for the repo)
          </button>
          <button
            type="button"
            class="secondary"
            disabled={!recs.length}
            onClick={() => downloadJson(`fixtures-${id}-${stamp}.json`, exportFixtures(exercise, recs))}
          >
            Export labelled landmarks (test fixtures)
          </button>
        </div>
      </section>

      <h2>Recordings ({recs.length})</h2>
      {recordings === null && <p class="muted">Loading…</p>}
      {recordings !== null && recs.length === 0 && <p class="muted">No recordings for this exercise yet.</p>}
      {recs.map((rec) => {
        const reps = score.reps.filter((r) => r.recordingId === rec.id);
        return (
          <section class="card">
            <header class="day-head">
              <h2>{new Date(rec.createdAt).toLocaleString()}</h2>
              <button type="button" class="link danger-text" onClick={() => void remove(rec)} aria-label="Delete recording">
                <Icon name="trash" size={18} />
              </button>
            </header>
            <p class="muted small">
              {rec.source === 'camera' ? 'Live camera' : 'Video file'} · {reps.length} rep{reps.length === 1 ? '' : 's'} detected
            </p>
            {reps.map((rep) => {
              const faults = rec.labels[rep.repIndex];
              const toggleFault = (f: string) => {
                const cur = faults ?? [];
                void setLabels(rec, rep.repIndex, cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]);
              };
              return (
                <div class="cal-rep">
                  <div class="cal-rep-head">
                    <strong>Rep {rep.repIndex + 1}</strong>
                    {faults && (
                      <button type="button" class="link small" onClick={() => void setLabels(rec, rep.repIndex, null)}>
                        Clear label
                      </button>
                    )}
                  </div>
                  <div class="chip-wrap">
                    <button
                      type="button"
                      class={`filter ${faults && faults.length === 0 ? 'on' : ''}`}
                      onClick={() => void setLabels(rec, rep.repIndex, [])}
                    >
                      Good
                    </button>
                    {exercise.faults.map((f) => (
                      <button type="button" class={`filter ${faults?.includes(f.id) ? 'on fault' : ''}`} onClick={() => toggleFault(f.id)}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <ul class="verdicts">
                    {rep.checks.map((v) => {
                      const check = exercise.checks.find((c) => c.id === v.checkId)!;
                      const agrees =
                        !faults || v.status === 'unknown' ? null : (v.status === 'fail') === faults.includes(check.fault);
                      return (
                        <li class={`${v.status} ${agrees === null ? '' : agrees ? 'agree' : 'disagree'}`}>
                          <span class="icon">{ICON[v.status]}</span>
                          <span>
                            {check.label}
                            <small>{v.status === 'unknown' ? v.reason : v.measured}</small>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </Screen>
  );
}
