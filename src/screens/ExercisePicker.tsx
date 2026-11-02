import { useEffect, useMemo, useState } from 'preact/hooks';
import { EXERCISES, getExercise } from '../data/exercises';
import { isBodyweight } from '../data/filters';
import { MUSCLE_GROUPS, MUSCLE_LABELS, type Exercise, type MuscleGroup } from '../data/types';
import { finished } from '../log/stats';
import { loadWorkouts } from '../log/store';
import { Icon, MuscleIcon } from './icons';

/** Bottom sheet for adding an exercise: search, muscle chips and recently used. */
export function ExercisePicker({ onPick, onClose, title = 'Add exercise' }: { onPick: (id: string) => void; onClose: () => void; title?: string }) {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>('all');
  const recent = useMemo(
    () =>
      [...new Set(finished(loadWorkouts()).flatMap((w) => w.entries.map((e) => e.exerciseId)))]
        .map((id) => getExercise(id))
        .filter((e): e is Exercise => !!e)
        .slice(0, 6),
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, []);

  const query = q.trim().toLowerCase();
  const list = EXERCISES.filter((e) => (muscle === 'all' || e.primary.includes(muscle)) && (!query || e.name.toLowerCase().includes(query))).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const showRecent = !query && muscle === 'all' && recent.length > 0;

  const row = (e: Exercise, i: number) => (
    <li style={{ '--i': String(i) }}>
      <a
        href="#"
        onClick={(ev) => {
          ev.preventDefault();
          onPick(e.id);
        }}
      >
        <span class="row-main">
          <strong>{e.name}</strong>
          <small>
            {e.primary.map((g) => MUSCLE_LABELS[g]).join(', ')}
            {isBodyweight(e) ? ' · Bodyweight' : ''}
          </small>
        </span>
        <Icon name="plus" size={18} />
      </a>
    </li>
  );

  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet picker" role="dialog" aria-modal="true" aria-label={title}>
        <div class="picker-top">
          <header class="sheet-head">
            <h2>{title}</h2>
            <button type="button" class="link" onClick={onClose}>
              Close
            </button>
          </header>
          <input class="search" type="search" placeholder="Search exercises" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          <div class="filter-row" role="group" aria-label="Filter by muscle">
            <button type="button" class={`filter ${muscle === 'all' ? 'on' : ''}`} aria-pressed={muscle === 'all'} onClick={() => setMuscle('all')}>
              All
            </button>
            {MUSCLE_GROUPS.map((g) => (
              <button type="button" class={`filter ${muscle === g ? 'on' : ''}`} aria-pressed={muscle === g} onClick={() => setMuscle(g)}>
                <MuscleIcon group={g} size={12} />
                {MUSCLE_LABELS[g]}
              </button>
            ))}
          </div>
        </div>
        {showRecent && (
          <>
            <h3>Recently used</h3>
            <ul class="rows">{recent.map(row)}</ul>
          </>
        )}
        <h3>{muscle === 'all' ? (query ? `${list.length} found` : 'All exercises') : MUSCLE_LABELS[muscle]}</h3>
        {list.length ? <ul class="rows">{list.map(row)}</ul> : <p class="muted">No exercise matches “{q}”.</p>}
      </div>
    </div>
  );
}
