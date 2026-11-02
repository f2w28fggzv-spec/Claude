import { useMemo } from 'preact/hooks';
import { getExercise } from '../data/exercises';
import { isBodyweight } from '../data/filters';
import { exerciseHistory, formatSet, formatSetShort, formatWeight, personalRecords, toUnit } from '../log/stats';
import { loadBodyweight, loadTechnique, loadUnit, loadWorkouts } from '../log/store';
import { ProgressChart, type ChartPoint } from './ProgressChart';
import { Screen } from './Layout';

/** Progress for one exercise: estimated max over time, records and history. */
export function ProgressScreen({ id }: { id: string }) {
  const ex = getExercise(id);
  const unit = useMemo(loadUnit, []);
  const history = useMemo(() => exerciseHistory(loadWorkouts(), id), [id]);
  const technique = useMemo(() => loadTechnique().filter((t) => t.exerciseId === id), [id]);
  const rec = personalRecords(history);
  const bw = !!ex && isBodyweight(ex);
  const hold = ex?.tracking.kind === 'hold';
  const loaded = history.filter((h) => h.bestE1rm > 0);
  const hasBodyweight = loadBodyweight() !== undefined;
  const kg = (v: number) => formatWeight(v, unit, 1);

  // What to chart: estimated max when loads are known, otherwise reps or hold time.
  let chart: { title: string; points: ChartPoint[]; format: (v: number) => string } | null = null;
  if (hold) {
    const pts = history.filter((h) => h.maxSeconds > 0);
    if (pts.length >= 2) {
      chart = {
        title: 'Longest hold (seconds)',
        format: (v) => `${Math.round(v)} s`,
        points: pts.map((h) => ({ date: h.date, value: h.maxSeconds, detail: `${h.sets.length} set${h.sets.length === 1 ? '' : 's'}` })),
      };
    }
  } else if (loaded.length >= 2) {
    chart = {
      title: `Estimated one-rep max (${unit}${bw ? ', body weight included' : ''})`,
      format: (v) => `${Number(v.toFixed(0))} ${unit}`,
      points: loaded.map((h) => ({ date: h.date, value: toUnit(h.bestE1rm, unit), detail: h.bestSet ? `Best set ${formatSet(h.bestSet, unit)}` : '' })),
    };
  } else if (history.length >= 2) {
    chart = {
      title: 'Most reps in a set',
      format: (v) => `${Math.round(v)} reps`,
      points: history.map((h) => ({ date: h.date, value: h.maxReps, detail: h.sets.map((x) => formatSetShort(x, unit)).join(', ') })),
    };
  }

  const tiles: [string, string][] = hold
    ? [
        [rec.longestHold ? `${rec.longestHold} s` : '–', 'longest hold'],
        [String(history.length), history.length === 1 ? 'session' : 'sessions'],
        [String(history.reduce((n, h) => n + h.sets.length, 0)), 'sets'],
      ]
    : bw
      ? [
          [rec.mostReps ? String(rec.mostReps) : '–', 'most reps'],
          [rec.mostAdded ? `+${formatWeight(rec.mostAdded, unit)}` : '–', 'most added'],
          [rec.bestE1rm ? kg(rec.bestE1rm) : '–', 'best est. max'],
        ]
      : [
          [rec.bestE1rm ? kg(rec.bestE1rm) : '–', 'best est. max'],
          [rec.heaviest ? formatWeight(rec.heaviest, unit) : '–', 'heaviest set'],
          [rec.mostReps ? String(rec.mostReps) : '–', 'most reps'],
        ];

  return (
    <Screen title={ex?.name ?? 'Exercise'} subtitle="Progress" back="log" tab="log">
      {chart ? (
        <ProgressChart title={chart.title} format={chart.format} points={chart.points} />
      ) : (
        <p class="muted">Log this exercise in two or more workouts to see a progress chart.</p>
      )}
      <div class="stat-row">
        {tiles.map(([v, label]) => (
          <div class="stat">
            <strong>{v}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {!hold && (
        <p class="muted small">
          Estimated one-rep max uses the Epley formula (weight × (1 + reps ÷ 30)) on your best set each session.
          {bw && ' For bodyweight exercises the weight is your body weight plus anything you added. '}
          {bw && !hasBodyweight && (
            <>
              <a href="#/settings">Add your body weight in Settings</a> to see it.
            </>
          )}
        </p>
      )}

      <h2>History</h2>
      {history.length === 0 && <p class="muted">Not logged yet.</p>}
      <table class="history">
        <thead>
          <tr>
            <th>Date</th>
            <th>Sets</th>
            <th>{hold ? 'Longest' : loaded.length ? 'Est. max' : 'Best'}</th>
          </tr>
        </thead>
        <tbody>
          {[...history].reverse().map((h) => (
            <tr>
              <td>
                <a href={`#/session/${h.workoutId}`}>{new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</a>
              </td>
              <td>{h.sets.map((x) => formatSetShort(x, unit)).join(', ')}</td>
              <td>{hold ? `${h.maxSeconds} s` : h.bestE1rm ? kg(h.bestE1rm) : `${h.maxReps} reps`}</td>
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
