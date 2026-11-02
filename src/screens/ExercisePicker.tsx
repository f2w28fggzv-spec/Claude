import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { EXERCISES } from '../data/exercises';
import { MUSCLE_GROUPS, MUSCLE_LABELS, type MuscleGroup } from '../data/types';
import { exerciseInfo, newCustomExercise, sameName, type ExerciseInfo } from '../log/exercises';
import { finished } from '../log/stats';
import { loadCustomExercises, loadWorkouts, saveCustomExercise } from '../log/store';
import type { CustomExercise } from '../log/types';
import { showToast } from '../ui/toast';
import { Icon, MuscleIcon } from './icons';

type View = { kind: 'list' } | { kind: 'form'; editing?: CustomExercise; name: string };

const muscles = (e: ExerciseInfo) => e.primary.map((g) => MUSCLE_LABELS[g]).join(', ');

/**
 * Bottom sheet for adding an exercise: search, muscle chips, recently used,
 * your own exercises, and a form to create one.
 */
export function ExercisePicker({ onPick, onClose, title = 'Add exercise' }: { onPick: (id: string) => void; onClose: () => void; title?: string }) {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>('all');
  const [view, setView] = useState<View>({ kind: 'list' });
  const [version, bump] = useState(0);
  const own = useMemo(() => loadCustomExercises().filter((c) => !c.archived), [version]);
  const recent = useMemo(
    () =>
      [...new Set(finished(loadWorkouts()).flatMap((w) => w.entries.map((e) => e.exerciseId)))]
        .map((id) => exerciseInfo(id))
        .filter((e): e is ExerciseInfo => !!e && !e.custom?.archived)
        .slice(0, 6),
    [version],
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

  if (view.kind === 'form') {
    return (
      <Sheet title={view.editing ? 'Edit your exercise' : 'Your own exercise'} onClose={onClose}>
        <CustomForm
          editing={view.editing}
          initialName={view.name}
          onBack={() => setView({ kind: 'list' })}
          onUse={onPick}
          onSaved={(c, created) => {
            bump((n) => n + 1);
            if (created) onPick(c.id);
            else setView({ kind: 'list' });
          }}
        />
      </Sheet>
    );
  }

  const query = q.trim().toLowerCase();
  const match = (e: ExerciseInfo) => (muscle === 'all' || e.primary.includes(muscle)) && (!query || e.name.toLowerCase().includes(query));
  const mine = own.map((c) => exerciseInfo(c.id, own)!).filter(match);
  const list = EXERCISES.map((e) => exerciseInfo(e.id, own)!)
    .filter(match)
    .sort((a, b) => a.name.localeCompare(b.name));
  const browsing = !query && muscle === 'all';

  const row = (e: ExerciseInfo, i: number) => (
    <li class={e.custom ? 'with-action' : ''} style={{ '--i': String(i) }}>
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
            {[muscles(e), e.bodyweight ? 'Bodyweight' : e.custom ? 'Added weight' : ''].filter(Boolean).join(' · ')}
            {e.custom && <span class="own-tag">Yours</span>}
          </small>
        </span>
        {!e.custom && <Icon name="plus" size={18} />}
      </a>
      {e.custom && (
        <button type="button" class="icon-btn small" aria-label={`Edit ${e.name}`} onClick={() => setView({ kind: 'form', editing: e.custom, name: e.name })}>
          <Icon name="edit" size={16} />
        </button>
      )}
    </li>
  );

  return (
    <Sheet
      title={title}
      onClose={onClose}
      top={
        <>
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
        </>
      }
    >
      <button type="button" class="create-own" onClick={() => setView({ kind: 'form', name: q.trim() })}>
        <Icon name="plus" size={18} />
        <span>
          <strong>{q.trim() && !list.length && !mine.length ? `Add “${q.trim()}” as your own exercise` : 'Create your own exercise'}</strong>
          <small>Anything that isn’t in the list. You choose bodyweight or added weight.</small>
        </span>
      </button>
      {mine.length > 0 && (
        <>
          <h3>My exercises</h3>
          <ul class="rows">{mine.map(row)}</ul>
        </>
      )}
      {browsing && recent.length > 0 && (
        <>
          <h3>Recently used</h3>
          <ul class="rows">{recent.map(row)}</ul>
        </>
      )}
      {list.length ? (
        <>
          <h3>{muscle === 'all' ? (query ? `${list.length} in the library` : 'All exercises') : MUSCLE_LABELS[muscle]}</h3>
          <ul class="rows">{list.map(row)}</ul>
        </>
      ) : (
        <p class="muted">Nothing in the library matches “{q}”.</p>
      )}
    </Sheet>
  );
}

function Sheet({ title, onClose, top, children }: { title: string; onClose: () => void; top?: ComponentChildren; children: ComponentChildren }) {
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
          {top}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Create or edit your own exercise. Bodyweight or added weight must be chosen. */
function CustomForm({
  editing,
  initialName,
  onBack,
  onUse,
  onSaved,
}: {
  editing?: CustomExercise;
  initialName: string;
  onBack: () => void;
  onUse: (id: string) => void;
  onSaved: (c: CustomExercise, created: boolean) => void;
}) {
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<CustomExercise['kind'] | null>(editing?.kind ?? null);
  const [picked, setPicked] = useState<MuscleGroup[]>(editing?.muscles ?? []);
  const clash = sameName(name, undefined, editing?.id);
  const trimmed = name.trim();
  const toggle = (g: MuscleGroup) => setPicked(picked.includes(g) ? picked.filter((x) => x !== g) : [...picked, g]);

  const save = () => {
    if (!trimmed || !kind || clash) return;
    const c = editing ? { ...editing, name: trimmed.replace(/\s+/g, ' ').slice(0, 40), kind, muscles: picked } : newCustomExercise(trimmed, kind, picked);
    saveCustomExercise(c);
    showToast(editing ? 'Exercise saved' : `“${c.name}” added to your exercises`);
    onSaved(c, !editing);
  };
  const remove = () => {
    if (!editing || !confirm(`Remove “${editing.name}” from your exercises? Workouts you logged with it stay in your log.`)) return;
    saveCustomExercise({ ...editing, archived: true });
    showToast('Exercise removed');
    onSaved(editing, false);
  };

  return (
    <form
      class="custom-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <button type="button" class="link back-link" onClick={onBack}>
        <Icon name="back" size={16} /> All exercises
      </button>
      <label class="text-field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          placeholder="e.g. Sled push, Weighted step-up"
          maxLength={40}
          autoFocus={!editing}
          onInput={(e) => setName(e.currentTarget.value)}
        />
      </label>
      {clash && (
        <p class="note clash">
          “{clash.name}” {clash.custom ? 'is already one of your exercises' : 'is already in the library'}.{' '}
          <button type="button" class="link" onClick={() => onUse(clash.id)}>
            Use it
          </button>
        </p>
      )}

      <h3>How is it loaded?</h3>
      <div class="segmented-2 kind-choice" role="radiogroup" aria-label="How is it loaded?">
        <button type="button" role="radio" aria-checked={kind === 'bodyweight'} class={kind === 'bodyweight' ? 'on' : ''} onClick={() => setKind('bodyweight')}>
          <strong>Bodyweight</strong>
          <small>Your body is the weight. Add extra if you like: BW + kg.</small>
        </button>
        <button type="button" role="radio" aria-checked={kind === 'weighted'} class={kind === 'weighted' ? 'on' : ''} onClick={() => setKind('weighted')}>
          <strong>Added weight</strong>
          <small>Barbell, dumbbells, machine or cable: weight × reps.</small>
        </button>
      </div>

      <h3>Main muscles (optional)</h3>
      <div class="chip-wrap">
        {MUSCLE_GROUPS.map((g) => (
          <button type="button" class={`filter ${picked.includes(g) ? 'on' : ''}`} aria-pressed={picked.includes(g)} onClick={() => toggle(g)}>
            <MuscleIcon group={g} size={12} />
            {MUSCLE_LABELS[g]}
          </button>
        ))}
      </div>
      <p class="muted small">Muscles count toward your weekly sets and name the workouts you build yourself.</p>

      <button type="submit" class="big" disabled={!trimmed || !kind || !!clash}>
        {!trimmed ? 'Name it first' : !kind ? 'Choose bodyweight or added weight' : editing ? 'Save changes' : 'Add exercise'}
      </button>
      {editing && (
        <button type="button" class="link danger center" onClick={remove}>
          Remove from my exercises
        </button>
      )}
    </form>
  );
}
