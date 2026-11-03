// Exercise cards shared by the workout in progress and the log editor
// (past workouts and edits): set table, bodyweight hint, coach note, add /
// remove sets and exercises, and the exercise picker.
import { useEffect, useState } from 'preact/hooks';
import { formState } from '../log/coach';
import { exerciseInfo } from '../log/exercises';
import { addExercise, applyNextWeight, completeSet } from '../log/session';
import { exerciseHistory, formatSetShort, formatWeight, fromUnit, toUnit } from '../log/stats';
import type { SetEntry, TechniqueSummary, Unit, Workout } from '../log/types';
import { ExercisePicker } from './ExercisePicker';
import { Icon } from './icons';

const num = (v: string): number | undefined => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
};

interface CardsProps {
  w: Workout;
  update: (w: Workout) => void;
  /** Finished workouts, for "last time" and pre-filled numbers. */
  history: Workout[];
  unit: Unit;
  /** Technique checks, for the "clean check, go up" prompt. */
  technique?: TechniqueSummary[];
  /** Editing a past workout: typing a value ticks the set, and done sets can be removed. */
  editing?: boolean;
  /** Called when a set is ticked (starts the rest timer in a live workout). */
  onSetDone?: (entryIndex: number) => void;
}

export function ExerciseCards({ w, update, history, unit, technique = [], editing = false, onSetDone }: CardsProps) {
  const [picker, setPicker] = useState(false);

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
  // In the editor a set counts once it has a number in it.
  const typed = (ei: number, si: number, patch: Partial<SetEntry>) =>
    updateSet(ei, si, editing && Object.values(patch).some((v) => v !== undefined) ? { ...patch, done: true } : patch);
  const toggleDone = (ei: number, si: number) => {
    const next = completeSet(w.entries[ei].sets[si]);
    updateSet(ei, si, next);
    if (next.done) onSetDone?.(ei);
  };
  const addSet = (ei: number) =>
    update({
      ...w,
      entries: w.entries.map((e, i) => {
        if (i !== ei) return e;
        const last = e.sets[e.sets.length - 1];
        return {
          ...e,
          sets: [
            ...e.sets,
            { done: false, planned: last ? { weight: last.weight ?? last.planned?.weight, reps: last.reps ?? last.planned?.reps, seconds: last.seconds ?? last.planned?.seconds } : {} },
          ],
        };
      }),
    });
  const removeSet = (ei: number, si: number) => update({ ...w, entries: w.entries.map((e, i) => (i !== ei ? e : { ...e, sets: e.sets.filter((_, j) => j !== si) })) });
  const removeExercise = (ei: number) => update({ ...w, entries: w.entries.filter((_, i) => i !== ei) });

  return (
    <>
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
        const prev = exerciseHistory(
          history.filter((h) => h.id !== w.id && h.startedAt < w.startedAt),
          e.exerciseId,
        ).at(-1);
        // A clean technique check since this workout started unlocks the next weight.
        const form = e.nextWeight !== undefined ? formState(technique, e.exerciseId) : null;
        const unlocked = !!form && form.state === 'clean' && !!form.latest && form.latest.at >= w.startedAt;
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
            {unlocked ? (
              <div class="coach-note unlocked">
                <Icon name="check" size={16} />
                <span>
                  Clean technique check ({form!.latest!.cleanReps}/{form!.latest!.reps} reps). Go up to {formatWeight(e.nextWeight, unit)} for the rest of your sets.
                </span>
                <button type="button" class="small-btn" onClick={() => update(applyNextWeight(w, ei))}>
                  Use {formatWeight(e.nextWeight, unit)}
                </button>
              </div>
            ) : (
              e.coachNote && (
                <p class="coach-note">
                  <Icon name="spark" size={16} /> {e.coachNote}
                  {e.nextWeight !== undefined && ex?.library && (
                    <a class="link inline-check" href={`#/analyze/${e.exerciseId}`}>
                      <Icon name="camera" size={14} /> Check technique now
                    </a>
                  )}
                </p>
              )
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
                      onValue={(v) => typed(ei, si, { weight: v === undefined ? undefined : fromUnit(v, unit) })}
                    />
                  )}
                  <NumInput
                    label={`Set ${si + 1} ${hold ? 'seconds' : 'reps'}`}
                    placeholder={String((hold ? s.planned?.seconds : s.planned?.reps) ?? '–')}
                    value={hold ? s.seconds : s.reps}
                    onValue={(v) => typed(ei, si, hold ? { seconds: v } : { reps: v })}
                  />
                  <span class="set-actions">
                    <button type="button" class={`tick-btn ${s.done ? 'on' : ''}`} aria-pressed={s.done} aria-label={`Set ${si + 1} done`} onClick={() => toggleDone(ei, si)}>
                      <Icon name="check" size={20} />
                    </button>
                    {(editing || !s.done) && e.sets.length > 1 && (
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
              {ex?.library && !editing && (
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

      {picker && (
        <ExercisePicker
          onPick={(id) => {
            update(addExercise(w, id, history));
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </>
  );
}

/** Free-text notes for a workout ("felt strong", "left knee tight"…). */
export function NotesField({ value, onChange }: { value?: string; onChange: (notes: string | undefined) => void }) {
  return (
    <label class="text-field notes-field">
      <span>Notes</span>
      <textarea
        rows={3}
        maxLength={1000}
        placeholder="How did it go? Anything to remember next time?"
        value={value ?? ''}
        onInput={(e) => onChange(e.currentTarget.value.trim() ? e.currentTarget.value : undefined)}
      />
    </label>
  );
}

/**
 * Number field that keeps its own text while typing (so "62." isn't wiped by
 * the clock re-rendering) and reports the parsed number.
 */
export function NumInput(props: { value?: number; onValue: (v: number | undefined) => void; placeholder: string; label: string; decimal?: boolean }) {
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
