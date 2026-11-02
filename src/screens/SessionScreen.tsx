import { useMemo, useState } from 'preact/hooks';
import { exerciseName } from '../log/exercises';
import { repeatWorkout, routineFromWorkout } from '../log/session';
import { dayKey, exerciseHistory, formatSet, toUnit, workoutMinutes, workoutSets, workoutVolume } from '../log/stats';
import { deleteWorkout, loadActiveWorkout, loadRoutines, loadTechnique, loadUnit, loadWorkouts, saveActiveWorkout, saveMode, saveRoutine, saveWorkout } from '../log/store';
import { navigate } from '../router';
import { showToast } from '../ui/toast';
import { Icon } from './icons';
import { RenameSheet } from './RenameSheet';
import { Screen } from './Layout';

/** One finished workout: what you did, records, and technique checks that day. */
export function SessionScreen({ id }: { id: string }) {
  const [version, refresh] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const workouts = useMemo(loadWorkouts, [version]);
  const unit = useMemo(loadUnit, []);
  const w = workouts.find((x) => x.id === id);
  if (!w) {
    return (
      <Screen title="Workout not found" back="log" tab="log">
        <p class="muted">This workout isn’t saved on this phone.</p>
      </Screen>
    );
  }
  const technique = loadTechnique().filter((t) => dayKey(t.at) === dayKey(w.startedAt));
  const routine = w.routineId ? loadRoutines().find((r) => r.id === w.routineId) : undefined;
  const saveAsRoutine = () => {
    const r = routineFromWorkout(w);
    saveRoutine(r);
    saveMode('self');
    showToast('Saved to My workouts. Rename it if you like.');
    navigate(`/routine/${r.id}`);
  };
  const repeat = () => {
    if (loadActiveWorkout() && !confirm('Replace the workout in progress?')) return;
    saveActiveWorkout(repeatWorkout(w));
    navigate('/workout');
  };
  const remove = () => {
    if (!confirm('Delete this workout from your log?')) return;
    deleteWorkout(w.id);
    showToast('Workout deleted');
    navigate('/log');
  };
  return (
    <Screen
      title={w.dayName ?? 'Workout'}
      titleAction={
        <button type="button" class="icon-btn small title-edit" aria-label="Rename workout" onClick={() => setRenaming(true)}>
          <Icon name="edit" size={16} />
        </button>
      }
      subtitle={new Date(w.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      back="log"
      tab="log"
    >
      <div class="stat-row">
        <div class="stat">
          <strong>{workoutMinutes(w)}</strong>
          <span>{workoutMinutes(w) === 1 ? 'minute' : 'minutes'}</span>
        </div>
        <div class="stat">
          <strong>{workoutSets(w)}</strong>
          <span>{workoutSets(w) === 1 ? 'set' : 'sets'}</span>
        </div>
        <div class="stat">
          <strong>{Math.round(toUnit(workoutVolume(w), unit)).toLocaleString()}</strong>
          <span>{unit} lifted</span>
        </div>
      </div>
      {w.entries.map((e, i) => {
        const name = exerciseName(e.exerciseId);
        const hist = exerciseHistory(workouts, e.exerciseId);
        const idx = hist.findIndex((h) => h.workoutId === w.id);
        const record = idx > 0 && hist[idx].bestE1rm > Math.max(...hist.slice(0, idx).map((h) => h.bestE1rm)) * 1.001;
        const tech = technique.find((t) => t.exerciseId === e.exerciseId);
        return (
          <section class="card" style={{ '--i': String(i) }}>
            <header class="day-head">
              <a href={`#/progress/${e.exerciseId}`}>
                <h2>{name}</h2>
              </a>
              {record && (
                <span class="badge-pr">
                  <Icon name="trophy" size={14} /> Best
                </span>
              )}
            </header>
            <ol class="set-list">
              {e.sets.map((s) => (
                <li>{formatSet(s, unit)}</li>
              ))}
            </ol>
            {tech && (
              <p class="muted small">
                Technique check: {tech.cleanReps}/{tech.reps} reps with no faults
              </p>
            )}
          </section>
        );
      })}
      <div class="stack">
        <button type="button" class="secondary" onClick={repeat}>
          <Icon name="play" size={18} /> Repeat this workout
        </button>
        {!routine && (
          <button type="button" class="secondary" onClick={saveAsRoutine}>
            <Icon name="plus" size={18} /> Save as a routine
          </button>
        )}
      </div>
      <button type="button" class="link danger center" onClick={remove}>
        Delete workout
      </button>
      {renaming && (
        <RenameSheet
          title="Rename workout"
          value={w.dayName ?? ''}
          onSave={(name) => {
            saveWorkout({ ...w, dayName: name });
            setRenaming(false);
            refresh((n) => n + 1);
          }}
          onClose={() => setRenaming(false)}
        />
      )}
    </Screen>
  );
}
