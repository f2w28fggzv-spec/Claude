import { useState } from 'preact/hooks';
import { getExercise } from '../data/exercises';
import { isBodyweight } from '../data/filters';
import { MUSCLE_LABELS, type MuscleGroup } from '../data/types';
import { startRoutine } from '../log/session';
import { deleteRoutine, loadActiveWorkout, loadRoutines, loadWorkouts, saveActiveWorkout, saveMode, saveRoutine } from '../log/store';
import type { Routine } from '../log/types';
import { navigate } from '../router';
import { showToast } from '../ui/toast';
import { ExercisePicker } from './ExercisePicker';
import { Icon } from './icons';
import { Screen } from './Layout';

const newId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** "Chest & Back" from the muscles with the most sets. */
function suggestName(items: Routine['items']): string {
  const sets = new Map<MuscleGroup, number>();
  for (const it of items) for (const g of getExercise(it.exerciseId)?.primary ?? []) sets.set(g, (sets.get(g) ?? 0) + it.sets);
  const top = [...sets].sort((a, b) => b[1] - a[1]).slice(0, 2);
  return top.length ? top.map(([g]) => MUSCLE_LABELS[g]).join(' & ') : 'My routine';
}

/** Create or edit one of your routines (My workouts mode). */
export function RoutineScreen({ id }: { id: string }) {
  const existing = id === 'new' ? undefined : loadRoutines().find((r) => r.id === id);
  const [name, setName] = useState(existing?.name ?? '');
  const [items, setItems] = useState<Routine['items']>(existing?.items ?? []);
  const [picker, setPicker] = useState(false);

  if (id !== 'new' && !existing) {
    return (
      <Screen title="Routine not found" back="" tab="plan">
        <p class="muted">This routine isn’t saved on this phone.</p>
      </Screen>
    );
  }

  const build = (): Routine => ({
    id: existing?.id ?? newId(),
    name: name.trim() || suggestName(items),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    items,
  });
  const save = () => {
    const r = build();
    saveRoutine(r);
    saveMode('self');
    showToast(existing ? 'Routine saved' : `“${r.name}” added to My workouts`);
    navigate('/');
  };
  const startNow = () => {
    const r = build();
    saveRoutine(r);
    if (loadActiveWorkout() && !confirm('Replace the workout in progress?')) return;
    saveActiveWorkout(startRoutine(r, loadWorkouts()));
    navigate('/workout');
  };
  const remove = () => {
    if (!existing || !confirm(`Delete “${existing.name}”? Workouts you logged with it stay in your log.`)) return;
    deleteRoutine(existing.id);
    showToast('Routine deleted');
    navigate('/');
  };
  const setSets = (i: number, n: number) => setItems(items.map((it, j) => (j === i ? { ...it, sets: Math.min(10, Math.max(1, n)) } : it)));
  const move = (i: number) => {
    if (i === 0) return;
    const next = [...items];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setItems(next);
  };

  return (
    <Screen
      title={existing ? 'Edit routine' : 'New routine'}
      subtitle="My workouts"
      back=""
      action={
        <button type="button" disabled={items.length === 0} onClick={save}>
          <Icon name="check" size={20} /> {items.length === 0 ? 'Add an exercise first' : 'Save routine'}
        </button>
      }
    >
      <label class="text-field">
        <span>Name</span>
        <input type="text" value={name} placeholder={items.length ? suggestName(items) : 'e.g. Push day'} maxLength={40} onInput={(e) => setName(e.currentTarget.value)} />
      </label>

      {items.length > 0 && (
        <ul class="card routine-items">
          {items.map((it, i) => {
            const ex = getExercise(it.exerciseId);
            return (
              <li style={{ '--i': String(i) }}>
                <span class="row-main">
                  <strong>{ex?.name ?? it.exerciseId}</strong>
                  <small>
                    {ex?.primary.map((g) => MUSCLE_LABELS[g]).join(', ')}
                    {ex && isBodyweight(ex) ? ' · Bodyweight' : ''}
                  </small>
                </span>
                <span class="routine-controls">
                  <span class="stepper" role="group" aria-label={`${ex?.name} sets`}>
                    <button type="button" aria-label="Fewer sets" onClick={() => setSets(i, it.sets - 1)}>
                      <Icon name="minus" size={16} />
                    </button>
                    <output>
                      {it.sets} set{it.sets === 1 ? '' : 's'}
                    </output>
                    <button type="button" aria-label="More sets" onClick={() => setSets(i, it.sets + 1)}>
                      <Icon name="plus" size={16} />
                    </button>
                  </span>
                  {i > 0 && (
                    <button type="button" class="icon-btn small move-up" aria-label={`Move ${ex?.name} up`} onClick={() => move(i)}>
                      <Icon name="chevron" size={16} />
                    </button>
                  )}
                  <button type="button" class="icon-btn small" aria-label={`Remove ${ex?.name}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                    <Icon name="close" size={16} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" class={items.length ? 'secondary' : 'big'} onClick={() => setPicker(true)}>
        <Icon name="plus" size={18} /> Add exercise
      </button>
      {items.length > 0 && (
        <button type="button" class="link center" onClick={startNow}>
          <Icon name="play" size={16} /> Save and start now
        </button>
      )}
      {existing && (
        <button type="button" class="link danger center" onClick={remove}>
          Delete routine
        </button>
      )}

      {picker && (
        <ExercisePicker
          onPick={(exerciseId) => {
            const hold = getExercise(exerciseId)?.tracking.kind === 'hold';
            setItems([...items, { exerciseId, sets: hold ? 2 : 3 }]);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </Screen>
  );
}
