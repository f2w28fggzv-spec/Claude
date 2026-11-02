import { useMemo } from 'preact/hooks';
import { getExercise } from '../data/exercises';
import { exerciseHistory, formatWeight, toUnit, workoutMinutes, workoutSets, workoutVolume } from '../log/stats';
import { deleteWorkout, loadTechnique, loadUnit, loadWorkouts } from '../log/store';
import { dayKey } from '../log/stats';
import { navigate } from '../router';
import { showToast } from '../ui/toast';
import { Icon } from './icons';
import { Screen } from './Layout';

/** One finished workout: what you did, records, and technique checks that day. */
export function SessionScreen({ id }: { id: string }) {
  const workouts = useMemo(loadWorkouts, []);
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
  const remove = () => {
    if (!confirm('Delete this workout from your log?')) return;
    deleteWorkout(w.id);
    showToast('Workout deleted');
    navigate('/log');
  };
  return (
    <Screen
      title={w.dayName ?? 'Workout'}
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
        const ex = getExercise(e.exerciseId);
        const hist = exerciseHistory(workouts, e.exerciseId);
        const idx = hist.findIndex((h) => h.workoutId === w.id);
        const record = idx > 0 && hist[idx].bestE1rm > Math.max(...hist.slice(0, idx).map((h) => h.bestE1rm)) * 1.001;
        const tech = technique.find((t) => t.exerciseId === e.exerciseId);
        return (
          <section class="card" style={{ '--i': String(i) }}>
            <header class="day-head">
              <a href={`#/progress/${e.exerciseId}`}>
                <h2>{ex?.name ?? e.exerciseId}</h2>
              </a>
              {record && (
                <span class="badge-pr">
                  <Icon name="trophy" size={14} /> Best
                </span>
              )}
            </header>
            <ol class="set-list">
              {e.sets.map((s) => (
                <li>
                  {s.seconds !== undefined ? `${s.seconds} s` : `${s.weight ? `${formatWeight(s.weight, unit)} × ` : ''}${s.reps ?? 0} reps`}
                </li>
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
      <button type="button" class="link danger center" onClick={remove}>
        Delete workout
      </button>
    </Screen>
  );
}
