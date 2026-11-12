import { useMemo, useState } from 'preact/hooks';
import { getExercise } from '../data/exercises';
import { isBodyweight } from '../data/filters';
import { MUSCLE_LABELS, type MuscleGroup } from '../data/types';
import { addCorrective, easyWeekActive, insights, nextDayIndex, planSuggestion, startEasyWeek, type Insight } from '../log/coach';
import { emptyWorkout, repeatWorkout, startFromPlan, startRoutine } from '../log/session';
import { dayKey, exerciseHistory, finished, formatWeight, weekStart, workoutsByDay } from '../log/stats';
import { exerciseName } from '../log/exercises';
import { weekMuscles } from '../log/muscles';
import { loadActiveWorkout, loadEasyWeek, loadMode, loadRoutines, loadTechnique, loadUnit, loadWorkouts, saveActiveWorkout, saveEasyWeek, saveMode, saveRoutine } from '../log/store';
import type { Routine, TechniqueSummary, TrainMode, Unit, Workout } from '../log/types';
import type { Program } from '../program/builder';
import { navigate } from '../router';
import { deleteProgram, loadPrograms, saveProgram } from '../storage';
import { showToast } from '../ui/toast';
import { Icon, MuscleIcon, type IconName } from './icons';
import { PRIVACY, Screen } from './Layout';
import { BodyHeatmap } from './BodyHeatmap';
import { PlanDays, planSubtitle } from './ProgramView';
import { RenameSheet } from './RenameSheet';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
/** One group per plate colour: legs red, pull blue, push yellow, core green. */
const HERO_GROUPS: MuscleGroup[] = ['quads', 'back', 'chest', 'core'];
const elapsed = (iso: string) => Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const MODES: { id: TrainMode; label: string; icon: IconName; blurb: string }[] = [
  { id: 'coach', label: 'Personal trainer', icon: 'spark', blurb: 'The app builds your plan, suggests your weights and adjusts them as you go.' },
  { id: 'self', label: 'My workouts', icon: 'edit', blurb: 'Log any workout your way and save the routines you repeat.' },
];

/** Train tab: pick Personal trainer (plan + coach) or My workouts (log your own). */
export function Home() {
  const [version, refresh] = useState(0);
  const [mode, setModeState] = useState<TrainMode>(() => loadMode() ?? 'coach');
  const workouts = useMemo(loadWorkouts, [version]);
  const technique = useMemo(loadTechnique, [version]);
  const unit = useMemo(loadUnit, []);
  const active = loadActiveWorkout();
  const setMode = (m: TrainMode) => {
    setModeState(m);
    saveMode(m);
  };
  const begin = (w: Workout) => {
    if (active && !confirm('Replace the workout in progress?')) return;
    saveActiveWorkout(w);
    navigate('/workout');
  };
  const index = MODES.findIndex((m) => m.id === mode);

  return (
    <Screen title="Today" subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} tab="plan">
      <div class="mode-switch" role="tablist" aria-label="How do you want to train?">
        <span class="mode-pill" aria-hidden="true" style={{ transform: `translateX(${index * 100}%)` }} />
        {MODES.map((m) => (
          <button type="button" role="tab" aria-selected={m.id === mode} class={m.id === mode ? 'on' : ''} onClick={() => setMode(m.id)}>
            <Icon name={m.icon} size={18} /> {m.label}
          </button>
        ))}
      </div>
      <p class="mode-blurb" key={mode}>
        {MODES[index].blurb}
      </p>

      {active && (
        <a class="card live-banner" href="#/workout">
          <span class="pulse" aria-hidden="true" />
          <span class="row-main">
            <strong>Workout in progress</strong>
            <small>
              {active.dayName ?? 'New workout'} · {elapsed(active.startedAt)} min
            </small>
          </span>
          <span class="button small-btn">Continue</span>
        </a>
      )}

      <div class={`mode-pane ${mode}`} key={mode}>
        {mode === 'coach' ? (
          <CoachToday
            workouts={workouts}
            technique={technique}
            unit={unit}
            begin={begin}
            refresh={() => refresh((n) => n + 1)}
            useOwn={() => setMode('self')}
          />
        ) : (
          <SelfToday workouts={workouts} technique={technique} unit={unit} begin={begin} />
        )}
      </div>
    </Screen>
  );
}

interface PaneProps {
  workouts: Workout[];
  technique: TechniqueSummary[];
  unit: Unit;
  begin: (w: Workout) => void;
}

/** Personal trainer: the next day of your plan with suggested weights, and the coach. */
function CoachToday({ workouts, technique, unit, begin, refresh, useOwn }: PaneProps & { refresh: () => void; useOwn: () => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [current, ...older] = loadPrograms();

  if (!current) {
    return (
      <>
        <section class="hero">
          <div class="hero-icons" aria-hidden="true">
            {HERO_GROUPS.map((g) => (
              <MuscleIcon group={g} size={46} />
            ))}
          </div>
          <h2>Get a plan built for you</h2>
          <p class="muted">Pick the muscles you want to train. You get a weekly plan with suggested weights that adapt as you log, plus technique feedback from your camera.</p>
          <a class="button big" href="#/groups">
            Create my plan
          </a>
          <button type="button" class="link center" onClick={useOwn}>
            Prefer to plan your own? Use My workouts
          </button>
        </section>
        <p class="privacy small center">{PRIVACY}</p>
      </>
    );
  }

  const next = nextDayIndex(current, workouts);
  const dayIndex = picked ?? next;
  const day = current.days[dayIndex];
  const easyWeek = loadEasyWeek();
  const easy = easyWeekActive(easyWeek);
  const tips = insights(current, workouts, technique, unit, new Date(), easyWeek);

  const act = (i: Insight) => {
    if (i.action?.kind === 'easyWeek') {
      saveEasyWeek(startEasyWeek());
      showToast('Easier week on: lighter weights and fewer sets for 7 days');
    } else if (i.action?.kind === 'endEasyWeek' && easyWeek) {
      saveEasyWeek({ ...easyWeek, until: new Date().toISOString() });
      showToast('Back to normal training');
    } else if (i.action?.kind === 'addCorrective') {
      saveProgram(addCorrective(current, i.action.exerciseId, i.action.correctiveId));
      showToast(`${getExercise(i.action.correctiveId)?.name ?? 'Exercise'} added to your plan`);
    } else return;
    refresh();
  };

  return (
    <>
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
            const ex = getExercise(item.exerciseId);
            const bw = !!ex && isBodyweight(ex);
            const s = planSuggestion(item, exerciseHistory(workouts, item.exerciseId), technique, unit, new Date(), easy);
            return (
              <li style={{ '--i': String(i) }}>
                <a href={`#/exercise/${item.exerciseId}`}>
                  <span class="row-main">
                    <strong>{ex?.name ?? item.exerciseId}</strong>
                    <small class={s.kind === 'increase' ? 'up' : s.kind === 'reduce' || s.kind === 'technique' ? 'down' : ''}>
                      {s.weight !== undefined && s.weight > 0
                        ? `${bw ? 'BW + ' : ''}${formatWeight(s.weight, unit)}`
                        : bw
                          ? 'Body weight'
                          : s.kind === 'start'
                            ? 'New: start light'
                            : 'No weight'}
                      {s.delta ? ` (${s.delta > 0 ? '+' : '−'}${formatWeight(Math.abs(s.delta), unit)})` : ''}
                      {s.form === 'clean' && <span class="form-tag clean">form ✓</span>}
                      {s.kind === 'check' && <span class="form-tag check">check form first</span>}
                      {s.form === 'faults' && <span class="form-tag faults">form: hold weight</span>}
                    </small>
                  </span>
                  <span class="sets">
                    {s.sets} × {item.reps[0]}–{item.reps[1]}
                    {item.unit === 'seconds' ? ' s' : ''}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        <button type="button" class="big" onClick={() => begin(startFromPlan(current, dayIndex, workouts, technique, unit, new Date(), easy))}>
          <Icon name="play" size={20} /> Start workout
        </button>
      </section>

      <WeekStrip workouts={workouts} planned={current.days.length} program={current} />
      <CoachCard title="Coach" tips={tips} onAct={act} note="Adjusts your weights and plan from your log and technique checks, on this phone." />

      <details class="more">
        <summary>Full plan · {planSubtitle(current)}</summary>
        <PlanDays program={current} />
      </details>
      {current.notes.length > 0 && current.notes.map((n) => <p class="note">{n}</p>)}

      <div class="stack">
        <a class="button secondary" href="#/groups">
          <Icon name="plus" size={18} /> New plan
        </a>
      </div>
      {older.length > 0 && <EarlierPlans programs={older} />}
      <p class="footer small">
        <button
          type="button"
          class="link"
          onClick={() => {
            if (confirm('Delete your current plan? Your workout log stays.')) {
              deleteProgram(current.id);
              refresh();
            }
          }}
        >
          Delete plan
        </button>
        {' · '}
        <a href="#/settings">Settings</a>
      </p>
    </>
  );
}

/** My workouts: start an empty workout, one of your routines, or repeat a recent one. */
function SelfToday({ workouts, technique, unit, begin }: PaneProps) {
  const [renaming, setRenaming] = useState<Routine | null>(null);
  const [, bump] = useState(0);
  const routines = loadRoutines();
  const done = finished(workouts);
  const recent = done.slice(0, 3);
  const tips = insights(null, workouts, technique, unit).filter((t) => t.id !== 'first');
  const lastDone = (routineId: string) => done.find((w) => w.routineId === routineId);
  const names = (w: Workout) =>
    w.entries
      .slice(0, 3)
      .map((e) => exerciseName(e.exerciseId))
      .join(', ') + (w.entries.length > 3 ? ` +${w.entries.length - 3}` : '');

  return (
    <>
      <section class="card self-start">
        <span class="plates" aria-hidden="true">
          {(['red', 'blue', 'yellow', 'green'] as const).map((c, i) => (
            <i style={{ background: `var(--${c})`, height: i === 1 || i === 2 ? '30px' : '22px' }} />
          ))}
        </span>
        <h2>Log a workout</h2>
        <p class="muted small">Add exercises as you go: weight and reps, or body weight plus any added weight.</p>
        <button type="button" class="big" onClick={() => begin(emptyWorkout())}>
          <Icon name="play" size={20} /> Start an empty workout
        </button>
      </section>

      <section class="card">
        <header class="day-head">
          <h2>My routines</h2>
          <a class="link" href="#/routine/new">
            <Icon name="plus" size={16} /> New routine
          </a>
        </header>
        {routines.length === 0 ? (
          <p class="muted small">Save the workouts you repeat, like “Push day” or “Upper body”, and start them with one tap.</p>
        ) : (
          <ul class="rows">
            {routines.map((r, i) => {
              const last = lastDone(r.id);
              return (
                <li class="with-action" style={{ '--i': String(i) }}>
                  <a href={`#/routine/${r.id}`}>
                    <span class="row-main">
                      <strong>{r.name}</strong>
                      <small>
                        {r.items.length} exercise{r.items.length === 1 ? '' : 's'}
                        {last ? ` · last ${shortDate(last.startedAt)}` : ''}
                      </small>
                    </span>
                  </a>
                  <button type="button" class="icon-btn small" aria-label={`Rename ${r.name}`} onClick={() => setRenaming(r)}>
                    <Icon name="edit" size={16} />
                  </button>
                  <button type="button" class="small-btn" onClick={() => begin(startRoutine(r, workouts))} aria-label={`Start ${r.name}`}>
                    <Icon name="play" size={16} /> Start
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section class="card">
          <h2>Repeat a recent workout</h2>
          <ul class="rows">
            {recent.map((w, i) => (
              <li class="with-action" style={{ '--i': String(i) }}>
                <a href={`#/session/${w.id}`}>
                  <span class="row-main">
                    <strong>{w.dayName ?? 'Workout'}</strong>
                    <small>
                      {shortDate(w.startedAt)} · {names(w)}
                    </small>
                  </span>
                </a>
                <button type="button" class="small-btn secondary" onClick={() => begin(repeatWorkout(w))} aria-label={`Repeat ${w.dayName ?? 'workout'}`}>
                  <Icon name="play" size={16} /> Repeat
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {renaming && (
        <RenameSheet
          title="Rename routine"
          value={renaming.name}
          onSave={(name) => {
            saveRoutine({ ...renaming, name });
            showToast('Routine renamed');
            setRenaming(null);
            bump((n) => n + 1);
          }}
          onClose={() => setRenaming(null)}
        />
      )}

      <WeekStrip workouts={workouts} program={null} />
      <CoachCard title="Highlights" tips={tips} note="From your log and technique checks, on this phone." />
      <p class="footer small">
        <a href="#/settings">Settings</a>
      </p>
    </>
  );
}

function WeekStrip({ workouts, planned, program }: { workouts: Workout[]; planned?: number; program: Program | null }) {
  const byDay = workoutsByDay(workouts);
  const monday = weekStart(new Date());
  const week = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  const done = week.filter((d) => byDay.has(dayKey(d))).length;
  return (
    <section class="card week">
      <header class="day-head">
        <h2>This week</h2>
        <span class="muted small">{planned ? `${done} of ${planned} workouts` : `${done} workout${done === 1 ? '' : 's'}`}</span>
      </header>
      <div class="week-strip">
        {week.map((d, i) => (
          <span class={`wk ${byDay.has(dayKey(d)) ? 'done' : ''} ${dayKey(d) === dayKey(new Date()) ? 'today' : ''}`} style={{ '--i': String(i) }}>
            <small>{DOW[i]}</small>
            <span class="dot">{byDay.has(dayKey(d)) ? <Icon name="check" size={14} /> : d.getDate()}</span>
          </span>
        ))}
      </div>
      <BodyHeatmap weeks={weekMuscles(workouts, program)} compact />
    </section>
  );
}

function CoachCard({ title, tips, note, onAct }: { title: string; tips: Insight[]; note: string; onAct?: (i: Insight) => void }) {
  if (tips.length === 0) return null;
  return (
    <section class="card coach">
      <h2>
        <Icon name="spark" size={20} /> {title}
      </h2>
      <p class="muted small">{note}</p>
      <ul class="insights">
        {tips.map((t, i) => (
          <li class={t.tone} style={{ '--i': String(i) }}>
            <strong>{t.title}</strong>
            <span>{t.body}</span>
            {t.action && onAct && (
              <button type="button" class="secondary small-btn" onClick={() => onAct(t)}>
                <Icon name="plus" size={16} /> {t.action.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EarlierPlans({ programs }: { programs: Program[] }) {
  return (
    <details class="more">
      <summary>Earlier plans ({programs.length})</summary>
      <ul class="rows">
        {programs.map((p) => (
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
  );
}
