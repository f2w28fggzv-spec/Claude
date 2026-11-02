import { useEffect, useMemo, useState } from 'preact/hooks';
import { exerciseInfo } from '../log/exercises';
import { addExercise, completeSet, finishWorkout } from '../log/session';
import { exerciseHistory, formatSetShort, formatWeight, fromUnit, toUnit } from '../log/stats';
import { loadActiveWorkout, loadBodyweight, loadUnit, loadWorkouts, saveActiveWorkout, saveWorkout } from '../log/store';
import type { SetEntry, Unit, Workout } from '../log/types';
import { navigate } from '../router';
import { showToast } from '../ui/toast';
import { ExercisePicker } from './ExercisePicker';
import { RenameSheet } from './RenameSheet';
import { Icon } from './icons';
import { Screen } from './Layout';

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const num = (v: string): number | undefined => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
};

/** The workout in progress: log sets as you go. */
export function WorkoutScreen() {
  const [w, setW] = useState<Workout | null>(loadActiveWorkout);
  const unit: Unit = useMemo(loadUnit, []);
  const history = useMemo(loadWorkouts, []);
  const [now, setNow] = useState(Date.now());
  const [rest, setRest] = useState<{ until: number; total: number } | null>(null);
  const [picker, setPicker] = useState(false);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (rest && now >= rest.until) {
      setRest(null);
      try {
        navigator.vibrate?.(200);
      } catch {
        // Vibration is optional.
      }
    }
  }, [now, rest]);

  if (!w) {
    return (
      <Screen title="No workout in progress" back="" tab="plan">
        <p class="muted">Start a workout from your plan.</p>
        <a class="button" href="#/">
          Go to my plan
        </a>
      </Screen>
    );
  }

  const update = (next: Workout) => {
    setW(next);
    saveActiveWorkout(next);
  };
  // Typing a weight or rep count also becomes the plan for the later sets of
  // that exercise you haven't filled in yet, so ticking them logs the same.
  const updateSet = (ei: number, si: number, patch: Partial<SetEntry>) =>
    update({
      ...w,
      entries: w.entries.map((e, i) =>
        i !== ei
          ? e
          : {
              ...e,
              sets: e.sets.map((s, j) => {
                if (j === si) return { ...s, ...patch };
                if (j < si || s.done) return s;
                const planned = { ...s.planned };
                for (const k of ['weight', 'reps', 'seconds'] as const) {
                  if (k in patch && patch[k] !== undefined && s[k] === undefined) planned[k] = patch[k];
                }
                return { ...s, planned };
              }),
            },
      ),
    });
  const toggleDone = (ei: number, si: number) => {
    const set = w.entries[ei].sets[si];
    const next = completeSet(set);
    updateSet(ei, si, next);
    if (next.done) {
      const restSec = w.entries[ei].target?.restSec ?? 90;
      setRest({ until: Date.now() + restSec * 1000, total: restSec * 1000 });
    }
  };
  const addSet = (ei: number) =>
    update({
      ...w,
      entries: w.entries.map((e, i) => {
        if (i !== ei) return e;
        const last = e.sets[e.sets.length - 1];
        return { ...e, sets: [...e.sets, { done: false, planned: last ? { weight: last.weight ?? last.planned?.weight, reps: last.reps ?? last.planned?.reps, seconds: last.seconds ?? last.planned?.seconds } : {} }] };
      }),
    });
  const removeSet = (ei: number, si: number) =>
    update({ ...w, entries: w.entries.map((e, i) => (i !== ei ? e : { ...e, sets: e.sets.filter((_, j) => j !== si) })) });
  const removeExercise = (ei: number) => update({ ...w, entries: w.entries.filter((_, i) => i !== ei) });

  const done = w.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const finish = () => {
    if (done === 0 && !confirm('No sets are ticked yet. Finish anyway?')) return;
    const final = finishWorkout(w, new Date(), loadBodyweight());
    if (final.entries.length) saveWorkout(final);
    saveActiveWorkout(null);
    showToast(final.entries.length ? 'Workout saved' : 'Workout discarded');
    navigate(final.entries.length ? `/session/${final.id}` : '/');
  };
  const discard = () => {
    if (!confirm('Discard this workout? Nothing will be saved.')) return;
    saveActiveWorkout(null);
    navigate('/');
  };

  return (
    <Screen
      title={w.dayName ?? 'New workout'}
      subtitle={`${clock(now - new Date(w.startedAt).getTime())} · ${done} set${done === 1 ? '' : 's'} done`}
      back=""
      titleAction={
        <button type="button" class="icon-btn small title-edit" aria-label="Rename workout" onClick={() => setRenaming(true)}>
          <Icon name="edit" size={16} />
        </button>
      }
      action={
        <button type="button" onClick={finish}>
          <Icon name="check" size={20} /> Finish workout
        </button>
      }
    >
      {w.entries.length === 0 && (
        <section class="card empty-workout">
          <Icon name="plus" size={28} />
          <h2>Add your first exercise</h2>
          <p class="muted small">Log sets as you go: weight, reps, or body weight plus any added weight.</p>
          <button type="button" class="big" onClick={() => setPicker(true)}>
            <Icon name="plus" size={20} /> Add exercise
          </button>
        </section>
      )}
      {w.entries.map((e, ei) => {
        const ex = exerciseInfo(e.exerciseId);
        const hold = !!ex?.hold;
        const bw = !!ex?.bodyweight;
        const prev = exerciseHistory(history, e.exerciseId).at(-1);
        return (
          <section class="card log-ex" style={{ '--i': String(ei) }}>
            <header class="log-ex-head">
              {ex?.library ? (
                <a href={`#/exercise/${e.exerciseId}`}>
                  <strong>{ex.name}</strong>
                </a>
              ) : (
                <span>
                  <strong>{ex?.name ?? 'Removed exercise'}</strong> <span class="own-tag">Yours</span>
                </span>
              )}
              <button type="button" class="icon-btn" aria-label={`Remove ${ex?.name}`} onClick={() => removeExercise(ei)}>
                <Icon name="close" size={18} />
              </button>
            </header>
            {(e.target || prev) && (
              <p class="muted small target">
                {e.target && (
                  <>
                    Target {e.target.sets} × {e.target.reps[0]}–{e.target.reps[1]}
                    {e.target.unit === 'seconds' ? ' s' : ''}
                    {e.target.weight !== undefined && ` · ${bw ? 'BW + ' : ''}${formatWeight(e.target.weight, unit)}`}
                    {prev && ' · '}
                  </>
                )}
                {prev && `Last time: ${prev.sets.map((s) => formatSetShort(s, unit)).join(', ')}`}
              </p>
            )}
            {bw && !hold && (
              <p class="bw-hint">
                <span class="bw-chip">BW</span> Body weight. Add weight under +{unit} for a vest, belt or dumbbell.
              </p>
            )}
            {e.coachNote && (
              <p class="coach-note">
                <Icon name="spark" size={16} /> {e.coachNote}
              </p>
            )}
            <div class="set-table" role="table" aria-label={`${ex?.name} sets`}>
              <div class="set-row head" role="row">
                <span>Set</span>
                {!hold && <span>{bw ? `+${unit}` : unit}</span>}
                <span>{hold ? 'Seconds' : 'Reps'}</span>
                <span />
              </div>
              {e.sets.map((s, si) => (
                <div class={`set-row ${s.done ? 'done' : ''}`} role="row">
                  <span class="set-n">{si + 1}</span>
                  {!hold && (
                    <NumInput
                      decimal
                      label={bw ? `Set ${si + 1} added weight in ${unit} (empty for body weight only)` : `Set ${si + 1} weight in ${unit}`}
                      placeholder={s.planned?.weight !== undefined ? String(Number(toUnit(s.planned.weight, unit).toFixed(1))) : bw ? 'BW' : '–'}
                      value={s.weight !== undefined ? toUnit(s.weight, unit) : undefined}
                      onValue={(v) => updateSet(ei, si, { weight: v === undefined ? undefined : fromUnit(v, unit) })}
                    />
                  )}
                  <NumInput
                    label={`Set ${si + 1} ${hold ? 'seconds' : 'reps'}`}
                    placeholder={String((hold ? s.planned?.seconds : s.planned?.reps) ?? '–')}
                    value={hold ? s.seconds : s.reps}
                    onValue={(v) => updateSet(ei, si, hold ? { seconds: v } : { reps: v })}
                  />
                  <span class="set-actions">
                    <button type="button" class={`tick-btn ${s.done ? 'on' : ''}`} aria-pressed={s.done} aria-label={`Set ${si + 1} done`} onClick={() => toggleDone(ei, si)}>
                      <Icon name="check" size={20} />
                    </button>
                    {!s.done && e.sets.length > 1 && (
                      <button type="button" class="icon-btn small" aria-label={`Remove set ${si + 1}`} onClick={() => removeSet(ei, si)}>
                        <Icon name="minus" size={16} />
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div class="log-ex-foot">
              <button type="button" class="link" onClick={() => addSet(ei)}>
                <Icon name="plus" size={16} /> Add set
              </button>
              {ex?.library && (
                <a class="link" href={`#/analyze/${e.exerciseId}`}>
                  <Icon name="camera" size={16} /> Check technique
                </a>
              )}
            </div>
          </section>
        );
      })}

      {w.entries.length > 0 && (
        <button type="button" class="secondary" onClick={() => setPicker(true)}>
          <Icon name="plus" size={18} /> Add exercise
        </button>
      )}
      <button type="button" class="link danger center" onClick={discard}>
        Discard workout
      </button>

      {rest && (
        <div class="rest-bar" role="timer" aria-live="off">
          <div class="rest-fill" style={{ transform: `scaleX(${Math.max(0, (rest.until - now) / rest.total)})` }} />
          <span>Rest {clock(rest.until - now)}</span>
          <button type="button" class="link" onClick={() => setRest(null)}>
            Skip
          </button>
        </div>
      )}

      {renaming && (
        <RenameSheet
          title="Rename workout"
          value={w.dayName ?? ''}
          onSave={(name) => {
            update({ ...w, dayName: name });
            setRenaming(false);
          }}
          onClose={() => setRenaming(false)}
        />
      )}

      {picker && (
        <ExercisePicker
          onPick={(id) => {
            update(addExercise(w, id, history));
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </Screen>
  );
}

/**
 * Number field that keeps its own text while typing (so "62." isn't wiped by
 * the clock re-rendering) and reports the parsed number.
 */
function NumInput(props: { value?: number; onValue: (v: number | undefined) => void; placeholder: string; label: string; decimal?: boolean }) {
  const show = (v?: number) => (v === undefined ? '' : String(Number(v.toFixed(2))));
  const [text, setText] = useState(show(props.value));
  useEffect(() => {
    const parsed = num(text);
    if (parsed === undefined ? props.value !== undefined : props.value === undefined || Math.abs(parsed - props.value) > 1e-6) {
      setText(show(props.value));
    }
  }, [props.value]);
  return (
    <input
      type="text"
      inputMode={props.decimal ? 'decimal' : 'numeric'}
      aria-label={props.label}
      placeholder={props.placeholder}
      value={text}
      onInput={(e) => {
        setText(e.currentTarget.value);
        props.onValue(num(e.currentTarget.value));
      }}
    />
  );
}
