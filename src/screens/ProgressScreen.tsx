import { useMemo } from 'preact/hooks';
import { getExercise } from '../data/exercises';
import { exerciseHistory, formatWeight, personalRecords, toUnit } from '../log/stats';
import { loadTechnique, loadUnit, loadWorkouts } from '../log/store';
import { ProgressChart } from './ProgressChart';
import { Screen } from './Layout';

/** Progress for one exercise: estimated max over time, records and history. */
export function ProgressScreen({ id }: { id: string }) {
  const ex = getExercise(id);
  const unit = useMemo(loadUnit, []);
  const history = useMemo(() => exerciseHistory(loadWorkouts(), id), [id]);
  const technique = useMemo(() => loadTechnique().filter((t) => t.exerciseId === id), [id]);
  const rec = personalRecords(history);
  const weighted = history.filter((h) => h.bestE1rm > 0);

  return (
    <Screen title={ex?.name ?? 'Exercise'} subtitle="Progress" back="log" tab="log">
      {weighted.length >= 2 ? (
        <ProgressChart
          title={`Estimated one-rep max (${unit})`}
          unit={unit}
          points={weighted.map((h) => ({
            date: h.date,
            value: h.bestE1rm,
            detail: h.bestSet ? `Best set ${formatWeight(h.bestSet.weight, unit)} × ${h.bestSet.reps}` : '',
          }))}
        />
      ) : (
        <p class="muted">Log this exercise in two or more workouts to see a progress chart.</p>
      )}
      <div class="stat-row">
        <div class="stat">
          <strong>{rec.bestE1rm ? formatWeight(rec.bestE1rm, unit, 1) : '–'}</strong>
          <span>best est. max</span>
        </div>
        <div class="stat">
          <strong>{rec.heaviest ? formatWeight(rec.heaviest, unit) : '–'}</strong>
          <span>heaviest set</span>
        </div>
        <div class="stat">
          <strong>{rec.mostReps || '–'}</strong>
          <span>most reps</span>
        </div>
      </div>
      <p class="muted small">Estimated one-rep max uses the Epley formula (weight × (1 + reps ÷ 30)) on your best set each session.</p>

      <h2>History</h2>
      {history.length === 0 && <p class="muted">Not logged yet.</p>}
      <table class="history">
        <thead>
          <tr>
            <th>Date</th>
            <th>Sets</th>
            <th>Est. max</th>
          </tr>
        </thead>
        <tbody>
          {[...history].reverse().map((h) => (
            <tr>
              <td>
                <a href={`#/session/${h.workoutId}`}>{new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</a>
              </td>
              <td>{h.sets.map((s) => (s.seconds !== undefined ? `${s.seconds}s` : s.weight ? `${Number(toUnit(s.weight, unit).toFixed(1))}×${s.reps}` : `${s.reps}`)).join(', ')}</td>
              <td>{h.bestE1rm ? formatWeight(h.bestE1rm, unit, 1) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {technique.length > 0 && (
        <>
          <h2>Technique checks</h2>
          <ul class="rows card">
            {technique.slice(0, 10).map((t) => (
              <li>
                <a href={`#/analyze/${id}`}>
                  <span class="row-main">
                    <strong>
                      {t.cleanReps}/{t.reps} reps with no faults
                    </strong>
                    <small>
                      {new Date(t.at).toLocaleDateString()}
                      {Object.keys(t.faults).length
                        ? ` · ${Object.entries(t.faults)
                            .map(([f, n]) => `${ex?.faults.find((x) => x.id === f)?.label.toLowerCase() ?? f} ×${n}`)
                            .join(', ')}`
                        : ''}
                    </small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </Screen>
  );
}
