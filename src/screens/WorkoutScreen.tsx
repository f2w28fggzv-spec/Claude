import { useEffect, useMemo, useState } from 'preact/hooks';
import { finishWorkout } from '../log/session';
import { loadActiveWorkout, loadBodyweight, loadTechnique, loadUnit, loadWorkouts, saveActiveWorkout, saveWorkout } from '../log/store';
import type { Unit, Workout } from '../log/types';
import { navigate } from '../router';
import { showToast } from '../ui/toast';
import { RenameSheet } from './RenameSheet';
import { Icon } from './icons';
import { Screen } from './Layout';
import { ExerciseCards, NotesField } from './WorkoutEditor';

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** The workout in progress: log sets as you go. */
export function WorkoutScreen() {
  const [w, setW] = useState<Workout | null>(loadActiveWorkout);
  const unit: Unit = useMemo(loadUnit, []);
  const history = useMemo(loadWorkouts, []);
  const technique = useMemo(loadTechnique, []);
  const [now, setNow] = useState(Date.now());
  const [rest, setRest] = useState<{ until: number; total: number } | null>(null);
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
        <p class="muted">Start a workout from the Train tab.</p>
        <a class="button" href="#/">
          Go to Train
        </a>
      </Screen>
    );
  }

  const update = (next: Workout) => {
    setW(next);
    saveActiveWorkout(next);
  };
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
      <ExerciseCards
        w={w}
        update={update}
        history={history}
        unit={unit}
        technique={technique}
        onSetDone={(ei) => {
          const restSec = w.entries[ei].target?.restSec ?? 90;
          setRest({ until: Date.now() + restSec * 1000, total: restSec * 1000 });
        }}
      />
      {w.entries.length > 0 && <NotesField value={w.notes} onChange={(notes) => update({ ...w, notes })} />}
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
    </Screen>
  );
}
