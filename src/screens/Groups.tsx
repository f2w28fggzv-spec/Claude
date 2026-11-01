import { useState } from 'preact/hooks';
import { MUSCLE_GROUPS, MUSCLE_LABELS, type MuscleGroup } from '../data/types';
import { navigate } from '../router';
import { loadGroups, saveGroups } from '../storage';
import { Icon, MuscleIcon } from './icons';
import { Screen } from './Layout';

/** Step 1 of creating a plan: big tappable muscle tiles. */
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
    <Screen
      title="What do you want to train?"
      subtitle="Step 1 of 2 · pick one or more"
      back=""
      action={
        <button type="button" disabled={!selected.length} onClick={() => navigate('/build')}>
          {selected.length ? `Next · ${selected.length} selected` : 'Pick at least one'}
        </button>
      }
    >
      <div class="muscle-grid">
        {MUSCLE_GROUPS.map((g) => {
          const on = selected.includes(g);
          return (
            <button type="button" class={`muscle-tile ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(g)}>
              {on && (
                <span class="tick">
                  <Icon name="check" size={16} />
                </span>
              )}
              <MuscleIcon group={g} size={84} />
              <span class="label">{MUSCLE_LABELS[g]}</span>
            </button>
          );
        })}
      </div>
      <button type="button" class="link center" onClick={() => update(all ? [] : [...MUSCLE_GROUPS])}>
        {all ? 'Clear all' : 'Select all (full body)'}
      </button>
    </Screen>
  );
}
