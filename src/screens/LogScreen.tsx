import { useMemo, useState } from 'preact/hooks';
import { getExercise } from '../data/exercises';
import { dayKey, exerciseHistory, finished, formatWeight, toUnit, weekStreak, workoutMinutes, workoutSets, workoutVolume, workoutsByDay } from '../log/stats';
import { loadUnit, loadWorkouts } from '../log/store';
import type { Workout } from '../log/types';
import { CountUp } from '../ui/CountUp';
import { Icon } from './icons';
import { Screen } from './Layout';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Log tab: calendar of training days, monthly stats and progress per exercise. */
export function LogScreen() {
  const workouts = useMemo(loadWorkouts, []);
  const unit = useMemo(loadUnit, []);
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<string | null>(null);
  const byDay = useMemo(() => workoutsByDay(workouts), [workouts]);

  const first = month;
  const offset = (first.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const inMonth = finished(workouts).filter((w) => {
    const d = new Date(w.startedAt);
    return d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
  });
  const volume = inMonth.reduce((s, w) => s + workoutVolume(w), 0);
  const shown: Workout[] = selected ? (byDay.get(selected) ?? []) : finished(workouts).slice(0, 6);

  const exercises = [...new Set(finished(workouts).flatMap((w) => w.entries.map((e) => e.exerciseId)))];

  return (
    <Screen title="Log" tab="log">
      <section class="card calendar">
        <header class="cal-nav">
          <button type="button" class="icon-btn" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            <Icon name="back" size={20} />
          </button>
          <h2 aria-live="polite">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <button type="button" class="icon-btn" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            <Icon name="chevron" size={20} />
          </button>
        </header>
        <div class="cal-grid" role="grid" key={month.toISOString()}>
          {WEEKDAYS.map((d) => (
            <span class="cal-dow" role="columnheader">
              {d}
            </span>
          ))}
          {cells.map((c, i) =>
            c === null ? (
              <span />
            ) : (
              <button
                type="button"
                role="gridcell"
                style={{ '--i': String(i) }}
                class={[
                  'cal-day',
                  byDay.has(dayKey(c)) ? 'trained' : '',
                  dayKey(c) === dayKey(today) ? 'today' : '',
                  selected === dayKey(c) ? 'sel' : '',
                ].join(' ')}
                aria-label={`${c.toLocaleDateString()}${byDay.has(dayKey(c)) ? ', trained' : ''}`}
                onClick={() => setSelected(selected === dayKey(c) ? null : dayKey(c))}
              >
                {c.getDate()}
              </button>
            ),
          )}
        </div>
      </section>

      <div class="stat-row">
        <div class="stat">
          <strong>
            <CountUp value={inMonth.length} />
          </strong>
          <span>{inMonth.length === 1 ? 'workout' : 'workouts'}</span>
        </div>
        <div class="stat">
          <strong>{Math.round(toUnit(volume, unit)).toLocaleString()}</strong>
          <span>{unit} lifted</span>
        </div>
        <div class="stat">
          <strong>
            <CountUp value={weekStreak(workouts)} />
          </strong>
          <span>week streak</span>
        </div>
      </div>

      <h2>{selected ? new Date(selected).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Recent workouts'}</h2>
      {shown.length === 0 ? (
        <p class="muted">{selected ? 'No workout logged this day.' : 'No workouts yet. Start one from the Plan tab.'}</p>
      ) : (
        <ul class="rows card">
          {shown.map((w, i) => (
            <li style={{ '--i': String(i) }}>
              <a href={`#/session/${w.id}`}>
                <span class="row-main">
                  <strong>{w.dayName ?? 'Workout'}</strong>
                  <small>
                    {new Date(w.startedAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {workoutMinutes(w)} min ·{' '}
                    {workoutSets(w)} sets
                  </small>
                </span>
                <span class="sets">{formatWeight(workoutVolume(w), unit)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {exercises.length > 0 && (
        <>
          <h2>Progress</h2>
          <ul class="rows card">
            {exercises.map((id, i) => {
              const h = exerciseHistory(workouts, id);
              const best = Math.max(0, ...h.map((s) => s.bestE1rm));
              return (
                <li style={{ '--i': String(i) }}>
                  <a href={`#/progress/${id}`}>
                    <span class="row-main">
                      <strong>{getExercise(id)?.name ?? id}</strong>
                      <small>
                        {h.length} session{h.length === 1 ? '' : 's'}
                        {best > 0 ? ` · best est. max ${formatWeight(best, unit, 1)}` : ''}
                      </small>
                    </span>
                    <Icon name="chevron" size={18} />
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p class="footer small">
        <a href="#/settings">
          <Icon name="settings" size={14} /> Settings and data
        </a>
      </p>
    </Screen>
  );
}
