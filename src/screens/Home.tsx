import { useMemo, useState } from 'preact/hooks';
import { getExercise } from '../data/exercises';
import { MUSCLE_GROUPS, MUSCLE_LABELS } from '../data/types';
import { addCorrective, insights, nextDayIndex, suggest, type Insight } from '../log/coach';
import { startFromPlan, emptyWorkout } from '../log/session';
import { dayKey, exerciseHistory, formatWeight, weekStart, workoutsByDay } from '../log/stats';
import { loadActiveWorkout, loadTechnique, loadUnit, loadWorkouts, saveActiveWorkout } from '../log/store';
import { navigate } from '../router';
import { deleteProgram, loadPrograms, saveProgram } from '../storage';
import { showToast } from '../ui/toast';
import { Icon, MuscleIcon } from './icons';
import { PRIVACY, Screen } from './Layout';
import { PlanDays, planSubtitle } from './ProgramView';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const elapsed = (iso: string) => Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

/** Plan tab: today's workout, the coach, and your plan. */
export function Home() {
  const [version, refresh] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const programs = useMemo(loadPrograms, [version]);
  const workouts = useMemo(loadWorkouts, [version]);
  const technique = useMemo(loadTechnique, [version]);
  const unit = useMemo(loadUnit, []);
  const active = loadActiveWorkout();
  const [current, ...older] = programs;

  const startEmpty = () => {
    if (active && !confirm('Replace the workout in progress?')) return;
    saveActiveWorkout(emptyWorkout());
    navigate('/workout');
  };

  if (!current) {
    return (
      <Screen title="Form Check" tab="plan">
        <section class="hero">
          <div class="hero-icons" aria-hidden="true">
            {MUSCLE_GROUPS.slice(0, 5).map((g) => (
              <MuscleIcon group={g} size={34} />
            ))}
          </div>
          <h2>Train smarter with your phone camera</h2>
          <p class="muted">Get a weekly plan for the muscles you pick, log every workout, and get technique feedback and coaching that adapts your plan.</p>
          <a class="button big" href="#/groups">
            Create my plan
          </a>
          <button type="button" class="link center" onClick={startEmpty}>
            Or just log a workout
          </button>
        </section>
        <p class="privacy small center">{PRIVACY}</p>
      </Screen>
    );
  }

  const next = nextDayIndex(current, workouts);
  const dayIndex = picked ?? next;
  const day = current.days[dayIndex];
  const tips = insights(current, workouts, technique, unit);
  const byDay = workoutsByDay(workouts);
  const monday = weekStart(new Date());
  const week = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  const doneThisWeek = week.filter((d) => byDay.has(dayKey(d))).length;

  const start = () => {
    if (active && !confirm('Replace the workout in progress?')) return;
    saveActiveWorkout(startFromPlan(current, dayIndex, workouts, technique, unit));
    navigate('/workout');
  };
  const act = (i: Insight) => {
    if (i.action?.kind !== 'addCorrective') return;
    saveProgram(addCorrective(current, i.action.exerciseId, i.action.correctiveId));
    showToast(`${getExercise(i.action.correctiveId)?.name ?? 'Exercise'} added to your plan`);
    refresh((n) => n + 1);
  };

  return (
    <Screen title="Today" subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} tab="plan">
      {active && (
        <a class="card live-banner" href="#/workout">
          <span class="pulse" aria-hidden="true" />
          <span class="row-main">
            <strong>Workout in progress</strong>
            <small>
              {active.dayName ?? 'Workout'} · {elapsed(active.startedAt)} min
            </small>
          </span>
          <span class="button small-btn">Continue</span>
        </a>
      )}

      <section class="card next">
        <div class="day-chips" role="group" aria-label="Choose a day">
          {current.days.map((d, i) => (
            <button type="button" class={`filter ${i === dayIndex ? 'on' : ''}`} aria-pressed={i === dayIndex} onClick={() => setPicked(i)}>
              {d.name}
              {i === next && i !== dayIndex ? ' · next' : ''}
            </button>
          ))}
        </div>
        <h2>
          {dayIndex === next ? 'Next up: ' : ''}
          {day.groups.map((g) => MUSCLE_LABELS[g]).join(' · ')}
        </h2>
        <ul class="rows">
          {day.items.map((item, i) => {
            const s = suggest(item, exerciseHistory(workouts, item.exerciseId), technique, unit);
            return (
              <li style={{ '--i': String(i) }}>
                <a href={`#/exercise/${item.exerciseId}`}>
                  <span class="row-main">
                    <strong>{getExercise(item.exerciseId)?.name ?? item.exerciseId}</strong>
                    <small class={s.kind === 'increase' ? 'up' : s.kind === 'reduce' || s.kind === 'technique' ? 'down' : ''}>
                      {s.weight !== undefined ? formatWeight(s.weight, unit) : s.kind === 'start' ? 'New: start light' : 'Bodyweight'}
                      {s.delta ? ` (${s.delta > 0 ? '+' : '−'}${formatWeight(Math.abs(s.delta), unit)})` : ''}
                    </small>
                  </span>
                  <span class="sets">
                    {item.sets} × {item.reps[0]}–{item.reps[1]}
                    {item.unit === 'seconds' ? ' s' : ''}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        <button type="button" class="big" onClick={start}>
          <Icon name="play" size={20} /> {active ? 'Start this workout instead' : 'Start workout'}
        </button>
      </section>

      <section class="card week">
        <header class="day-head">
          <h2>This week</h2>
          <span class="muted small">
            {doneThisWeek} of {current.days.length} workouts
          </span>
        </header>
        <div class="week-strip">
          {week.map((d, i) => (
            <span class={`wk ${byDay.has(dayKey(d)) ? 'done' : ''} ${dayKey(d) === dayKey(new Date()) ? 'today' : ''}`} style={{ '--i': String(i) }}>
              <small>{DOW[i]}</small>
              <span class="dot">{byDay.has(dayKey(d)) ? <Icon name="check" size={14} /> : d.getDate()}</span>
            </span>
          ))}
        </div>
      </section>

      {tips.length > 0 && (
        <section class="card coach">
          <h2>
            <Icon name="spark" size={20} /> Coach
          </h2>
          <p class="muted small">Adjusts your weights and plan from your log and technique checks, on this phone.</p>
          <ul class="insights">
            {tips.map((t, i) => (
              <li class={t.tone} style={{ '--i': String(i) }}>
                <strong>{t.title}</strong>
                <span>{t.body}</span>
                {t.action && (
                  <button type="button" class="secondary small-btn" onClick={() => act(t)}>
                    <Icon name="plus" size={16} /> {t.action.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details class="more">
        <summary>Full plan · {planSubtitle(current)}</summary>
        <PlanDays program={current} />
      </details>
      {current.notes.length > 0 && current.notes.map((n) => <p class="note">{n}</p>)}

      <div class="stack">
        <a class="button secondary" href="#/groups">
          <Icon name="plus" size={18} /> New plan
        </a>
        <button type="button" class="link center" onClick={startEmpty}>
          Log a workout that isn’t in the plan
        </button>
      </div>
      {older.length > 0 && (
        <details class="more">
          <summary>Earlier plans ({older.length})</summary>
          <ul class="rows">
            {older.map((p) => (
              <li>
                <a href={`#/program/${p.id}`}>
                  <span class="row-main">
                    <strong>{p.name}</strong>
                    <small>{new Date(p.createdAt).toLocaleDateString()}</small>
                  </span>
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p class="footer small">
        <button
          type="button"
          class="link"
          onClick={() => {
            if (confirm('Delete your current plan? Your workout log stays.')) {
              deleteProgram(current.id);
              refresh((n) => n + 1);
            }
          }}
        >
          Delete plan
        </button>
        {' · '}
        <a href="#/settings">Settings</a>
      </p>
    </Screen>
  );
}
