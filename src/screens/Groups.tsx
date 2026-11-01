import { useState } from 'preact/hooks';
import { MUSCLE_GROUPS, MUSCLE_LABELS, type MuscleGroup } from '../data/types';
import { loadGroups, saveGroups } from '../storage';
import { Screen } from './Layout';

export function Groups() {
  const [selected, setSelected] = useState<MuscleGroup[]>(loadGroups);
  const update = (next: MuscleGroup[]) => {
    const ordered = MUSCLE_GROUPS.filter((g) => next.includes(g));
    setSelected(ordered);
    saveGroups(ordered);
  };
  const toggle = (g: MuscleGroup) => update(selected.includes(g) ? selected.filter((x) => x !== g) : [...selected, g]);
  const all = selected.length === MUSCLE_GROUPS.length;

  return (
    <Screen title="Muscle groups" back="">
      <p class="muted">Select every group you want to train. You can change this any time.</p>
      <div class="chips">
        {MUSCLE_GROUPS.map((g) => (
          <button type="button" class={`chip ${selected.includes(g) ? 'on' : ''}`} aria-pressed={selected.includes(g)} onClick={() => toggle(g)}>
            {MUSCLE_LABELS[g]}
          </button>
        ))}
      </div>
      <button type="button" class="link" onClick={() => update(all ? [] : [...MUSCLE_GROUPS])}>
        {all ? 'Clear all' : 'Select all'}
      </button>
      <nav class="stack">
        <a class={`button ${selected.length ? '' : 'disabled'}`} href={selected.length ? '#/build' : undefined}>
          Build a program
        </a>
        <a class={`button secondary ${selected.length ? '' : 'disabled'}`} href={selected.length ? '#/library' : undefined}>
          See exercises
        </a>
      </nav>
    </Screen>
  );
}
