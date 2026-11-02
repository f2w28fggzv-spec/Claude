import { useMemo } from 'preact/hooks';
import { getExercise } from '../data/exercises';
import { CLEAN_SHARE, FORM_WINDOW_DAYS, formState, techniqueTrend } from '../log/coach';
import { exerciseInfo } from '../log/exercises';
import { exerciseHistory, formatSet, formatSetShort, formatWeight, personalRecords, toUnit } from '../log/stats';
import { loadBodyweight, loadTechnique, loadUnit, loadWorkouts } from '../log/store';
import { ProgressChart, type ChartPoint } from './ProgressChart';
import { Icon } from './icons';
import { Screen } from './Layout';

/** Progress for one exercise: estimated max over time, records and history. */
export function ProgressScreen({ id }: { id: string }) {
  const info = exerciseInfo(id);
  const ex = info?.library;
  const unit = useMemo(loadUnit, []);
  const history = useMemo(() => exerciseHistory(loadWorkouts(), id), [id]);
  const technique = useMemo(() => loadTechnique().filter((t) => t.exerciseId === id), [id]);
  const trend = techniqueTrend(technique, id);
  const gate = formState(technique, id);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const rec = personalRecords(history);
  const bw = !!info?.bodyweight;
  const hold = !!info?.hold;
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
    <Screen title={info?.name ?? 'Exercise'} subtitle={info?.custom ? 'Progress · your exercise' : 'Progress'} back="log" tab="log">
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
      {ex && (trend.points.length > 0 || ex.analysis === 'full') && (
        <>
          <header class="day-head section-head">
            <h2>Technique</h2>
            <a class="link" href={`#/analyze/${id}`}>
              <Icon name="camera" size={16} /> Check technique
            </a>
          </header>
          {trend.points.length >= 2 && (
            <ProgressChart
              title="Reps with no faults, per check (%)"
              format={(v) => `${Math.round(v)}%`}
              domain={[0, 100]}
              points={trend.points.map((p) => ({ date: p.at, value: p.share * 100, detail: `${p.clean} of ${p.reps} reps clean` }))}
            />
          )}
          {ex.analysis === 'full' && (
            <p class={`form-gate ${gate.state}`}>
              <strong>{gate.state === 'clean' ? 'Form ✓' : gate.state === 'faults' ? 'Form: hold weight' : 'Form: check needed'}</strong>
              <span>
                {gate.state === 'clean'
                  ? `Your last check (${new Date(gate.latest!.at).toLocaleDateString()}) was clean, so the coach adds weight once every set reaches the top of the range.`
                  : gate.state === 'faults'
                    ? `Your last check had faults on ${gate.latest!.reps - gate.latest!.cleanReps} of ${gate.latest!.reps} reps. The coach keeps the weight until a check is at least ${Math.round(CLEAN_SHARE * 100)}% clean.`
                    : `No check in the last ${FORM_WINDOW_DAYS} days. Before adding weight, the coach asks for a clean technique check.`}
              </span>
            </p>
          )}
          {trend.top &&
            (() => {
              const fault = ex.faults.find((f) => f.id === trend.top!.fault);
              const corrective = fault ? getExercise(fault.corrective) : undefined;
              return fault ? (
                <section class="card top-fault">
                  <h3>Most common fault</h3>
                  <strong>{fault.label}</strong>
                  <span class="muted small">
                    {trend.top!.reps} rep{trend.top!.reps === 1 ? '' : 's'} across {trend.top!.checks} check{trend.top!.checks === 1 ? '' : 's'}
                  </span>
                  <p>{fault.cue}</p>
                  {corrective && (
                    <a class="link" href={`#/exercise/${corrective.id}`}>
                      Helps: {corrective.name}
                    </a>
                  )}
                </section>
              ) : null;
            })()}
          {technique.length > 0 && (
            <ul class="rows card">
              {[...technique]
                .sort((a, b) => b.at.localeCompare(a.at))
                .slice(0, 10)
                .map((t) => (
                  <li>
                    <a href={`#/analyze/${id}`}>
                      <span class="row-main">
                        <strong>
                          {t.cleanReps}/{t.reps} reps with no faults · {pct(t.cleanReps / t.reps)}
                        </strong>
                        <small>
                          {new Date(t.at).toLocaleDateString()}
                          {Object.keys(t.faults).length
                            ? ` · ${Object.entries(t.faults)
                                .map(([f, n]) => `${ex.faults.find((x) => x.id === f)?.label.toLowerCase() ?? f} ×${n}`)
                                .join(', ')}`
                            : ''}
                        </small>
                      </span>
                    </a>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </Screen>
  );
}
