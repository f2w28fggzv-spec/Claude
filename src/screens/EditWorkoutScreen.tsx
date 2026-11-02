import { useMemo, useState } from 'preact/hooks';
import { emptyWorkout, finishWorkout } from '../log/session';
import { workoutMinutes } from '../log/stats';
import { loadBodyweight, loadUnit, loadWorkouts, saveWorkout } from '../log/store';
import type { Workout } from '../log/types';
import { navigate } from '../router';
import { showToast } from '../ui/toast';
import { Icon } from './icons';
import { Screen } from './Layout';
import { RenameSheet } from './RenameSheet';
import { ExerciseCards, NotesField } from './WorkoutEditor';

const pad = (n: number) => String(n).padStart(2, '0');
const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function fromInputs(date: string, time: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Default start for a workout logged afterwards: 18:00 that day, or an hour ago if that's still to come today. */
function defaultStart(day: string | undefined, now = new Date()): Date {
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? fromInputs(day, '18:00') : null;
  const start = d ?? fromInputs(dateInput(now), '18:00')!;
  return start.getTime() > now.getTime() - 3600000 ? new Date(now.getTime() - 3600000) : start;
}

/**
 * Log a workout afterwards (`#/edit/new?date=YYYY-MM-DD`) or edit a finished
 * one (`#/edit/:id`): date, start time, length, exercises, sets and notes.
 */
export function EditWorkoutScreen({ id, date }: { id: string; date?: string }) {
  const original = useMemo(() => (id === 'new' ? undefined : loadWorkouts().find((x) => x.id === id)), [id]);
  const history = useMemo(loadWorkouts, []);
  const unit = useMemo(loadUnit, []);
  const [w, setW] = useState<Workout>(() => original ?? { ...emptyWorkout(), startedAt: defaultStart(date).toISOString() });
  const start0 = new Date(w.startedAt);
  const [day, setDay] = useState(dateInput(start0));
  const [time, setTime] = useState(timeInput(start0));
  const [minutes, setMinutes] = useState(String(original ? workoutMinutes(original) : 60));
  const [renaming, setRenaming] = useState(false);

  if (id !== 'new' && !original) {
    return (
      <Screen title="Workout not found" back="log" tab="log">
        <p class="muted">This workout isn’t saved on this phone.</p>
      </Screen>
    );
  }

  const leave = () => navigate(original ? `/session/${original.id}` : '/log');
  // Keep the workout's start in step with the date and time fields, so
  // "last time" and pre-filled numbers come from before that day.
  const setWhen = (d: string, t: string) => {
    setDay(d);
    setTime(t);
    const start = fromInputs(d, t);
    if (start) setW((cur) => ({ ...cur, startedAt: start.toISOString() }));
  };
  const save = () => {
    const start = fromInputs(day, time);
    const mins = Math.round(Number(minutes));
    if (!start) return showToast('Pick a date and a start time');
    if (start.getTime() > Date.now()) return showToast('That start time is still to come');
    if (!Number.isFinite(mins) || mins < 1 || mins > 600) return showToast('Length should be between 1 and 600 minutes');
    const final = finishWorkout({ ...w, startedAt: start.toISOString(), finishedAt: undefined }, new Date(start.getTime() + mins * 60000), w.bodyweight ?? loadBodyweight());
    if (!final.entries.length) return showToast('Fill in or tick at least one set');
    saveWorkout(final);
    showToast(original ? 'Changes saved' : 'Workout added to your log');
    navigate(`/session/${final.id}`);
  };

  return (
    <Screen
      title={w.dayName ?? (original ? 'Workout' : 'Past workout')}
      subtitle={original ? 'Edit workout' : 'Log a workout you’ve done'}
      back={original ? `session/${original.id}` : 'log'}
      titleAction={
        <button type="button" class="icon-btn small title-edit" aria-label="Rename workout" onClick={() => setRenaming(true)}>
          <Icon name="edit" size={16} />
        </button>
      }
      action={
        <button type="button" onClick={save}>
          <Icon name="check" size={20} /> {original ? 'Save changes' : 'Save to log'}
        </button>
      }
    >
      <div class="when-row">
        <label class="text-field">
          <span>Date</span>
          <input type="date" value={day} max={dateInput(new Date())} onInput={(e) => setWhen(e.currentTarget.value, time)} />
        </label>
        <label class="text-field">
          <span>Start</span>
          <input type="time" value={time} onInput={(e) => setWhen(day, e.currentTarget.value)} />
        </label>
        <label class="text-field">
          <span>Minutes</span>
          <input type="text" inputMode="numeric" value={minutes} onInput={(e) => setMinutes(e.currentTarget.value)} />
        </label>
      </div>
      {!original && <p class="muted small">Type in what you did; each set you fill in is ticked for you. Untick a set to leave it out.</p>}

      <ExerciseCards w={w} update={setW} history={history} unit={unit} editing />
      <NotesField value={w.notes} onChange={(notes) => setW({ ...w, notes })} />
      <button type="button" class="link center" onClick={leave}>
        Cancel
      </button>

      {renaming && (
        <RenameSheet
          title="Rename workout"
          value={w.dayName ?? ''}
          onSave={(name) => {
            setW({ ...w, dayName: name });
            setRenaming(false);
          }}
          onClose={() => setRenaming(false)}
        />
      )}
    </Screen>
  );
}
