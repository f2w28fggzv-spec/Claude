import { useEffect, useMemo, useState } from 'preact/hooks';
import { exerciseName } from '../log/exercises';
import { formRating, formText } from '../log/form';
import { dayKey, exerciseHistory, finished, formatSetShort, formatWeight, toUnit, weekStart, weekStreak, workoutMinutes, workoutSets, workoutVolume, workoutsByDay } from '../log/stats';
import { weekMuscles } from '../log/muscles';
import { loadMode, loadTechnique, loadUnit, loadWorkouts } from '../log/store';
import { loadSets, type SavedSetMeta } from '../sets/sets';
import { loadPrograms } from '../storage';
import type { Unit, Workout } from '../log/types';
import { CountUp } from '../ui/CountUp';
import { BodyHeatmap } from './BodyHeatmap';
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
  const [weekOf, setWeekOf] = useState(() => new Date());
  const plan = useMemo(() => (loadMode() === 'self' ? null : (loadPrograms()[0] ?? null)), []);
  const thisWeek = dayKey(weekStart(weekOf)) === dayKey(weekStart(today));
  const moveWeek = (days: number) => setWeekOf(new Date(weekOf.getFullYear(), weekOf.getMonth(), weekOf.getDate() + days));
  const byDay = useMemo(() => workoutsByDay(workouts), [workouts]);
  const [sets, setSets] = useState<SavedSetMeta[]>([]);
  useEffect(() => {
    void loadSets().then(setSets);
  }, []);
  // Days with a technique check (saved set or summary), for the calendar.
  const checkedDays = useMemo(() => new Set([...sets.map((m) => dayKey(m.at)), ...loadTechnique().map((t) => dayKey(t.at))]), [sets]);

  const first = month;
  const offset = (first.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const inMonth = finished(workouts).filter((w) => {
    const d = new Date(w.startedAt);
    return d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
  });
  const volume = inMonth.reduce((s, w) => s + workoutVolume(w), 0);
  const selectedDate = selected ? new Date(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)) - 1, Number(selected.slice(8, 10))) : null;
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
                  byDay.has(dayKey(c)) ? 'trained' : checkedDays.has(dayKey(c)) ? 'checked' : '',
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

      <section class="card muscles-card">
        <header class="cal-nav">
          <button type="button" class="icon-btn" aria-label="Previous week" onClick={() => moveWeek(-7)}>
            <Icon name="back" size={20} />
          </button>
          <h2 aria-live="polite">{thisWeek ? 'Muscles this week' : `Week of ${weekStart(weekOf).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}</h2>
          <button type="button" class="icon-btn" aria-label="Next week" disabled={thisWeek} onClick={() => moveWeek(7)}>
            <Icon name="chevron" size={20} />
          </button>
        </header>
        <BodyHeatmap weeks={weekMuscles(workouts, plan, weekOf)} />
      </section>

      <h2>{selectedDate ? selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Recent workouts'}</h2>
      {(!selected || selected <= dayKey(today)) && (
        <a class="button secondary log-past" href={`#/edit/new${selected ? `?date=${selected}` : ''}`}>
          <Icon name="plus" size={18} /> {selected ? (selected === dayKey(today) ? 'Log a workout for today' : 'Log a workout for this day') : 'Log a past workout'}
        </a>
      )}
      {selected ? (
        <DayDetail workouts={shown} sets={sets.filter((m) => dayKey(m.at) === selected)} unit={unit} />
      ) : shown.length === 0 ? (
        <p class="muted">No workouts yet. Start one from the Train tab, or log one you’ve already done.</p>
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
                      <strong>{exerciseName(id)}</strong>
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

/** A saved technique check: form rating, linked to its video or replay. */
function SetBadge({ meta }: { meta: SavedSetMeta }) {
  const reps = meta.reps || (meta.holdSec !== undefined ? 1 : 0);
  const tone = formRating(meta.cleanReps, reps)?.tone ?? 'ok';
  return (
    <a class={`set-badge ${tone}`} href={`#/set/${meta.id}`}>
      <Icon name={meta.video ? 'video' : 'play'} size={14} />
      {meta.reps > 0 ? formText(meta.cleanReps, meta.reps) : meta.holdSec !== undefined ? `Hold ${meta.holdSec} s` : 'Replay'}
      <span class="set-badge-kind">{meta.video ? 'Video' : 'Replay'}</span>
    </a>
  );
}

/** Everything about one calendar day: each workout's exercises, sets, notes and technique checks. */
function DayDetail({ workouts, sets, unit }: { workouts: Workout[]; sets: SavedSetMeta[]; unit: Unit }) {
  const used = new Set<string>();
  const cards = workouts.map((w, i) => (
    <section class="card day-workout" style={{ '--i': String(i) }}>
      <header class="day-head">
        <a href={`#/session/${w.id}`}>
          <h2>{w.dayName ?? 'Workout'}</h2>
        </a>
        <span class="muted small">
          {new Date(w.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {workoutMinutes(w)} min
        </span>
      </header>
      <ul class="day-ex">
        {w.entries.map((e) => {
          const check = sets.find((m) => m.exerciseId === e.exerciseId && !used.has(m.id));
          if (check) used.add(check.id);
          return (
            <li>
              <strong>{exerciseName(e.exerciseId)}</strong>
              <small>{e.sets.map((x) => formatSetShort(x, unit)).join(', ')}</small>
              {check && <SetBadge meta={check} />}
            </li>
          );
        })}
      </ul>
      {w.notes && <p class="day-notes">“{w.notes}”</p>}
      <div class="day-foot">
        <span class="muted small">
          {workoutSets(w)} sets · {formatWeight(workoutVolume(w), unit)}
        </span>
        <a class="link" href={`#/session/${w.id}`}>
          Open workout <Icon name="chevron" size={14} />
        </a>
      </div>
    </section>
  ));
  const others = sets.filter((m) => !used.has(m.id));
  return (
    <>
      {workouts.length === 0 && others.length === 0 && <p class="muted">No workout logged this day.</p>}
      {cards}
      {others.length > 0 && (
        <section class="card">
          <h2>Technique checks</h2>
          <ul class="day-ex">
            {others.map((m) => (
              <li>
                <strong>{exerciseName(m.exerciseId)}</strong>
                <small>{new Date(m.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</small>
                <SetBadge meta={m} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
