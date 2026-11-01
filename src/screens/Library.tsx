import { useState } from 'preact/hooks';
import { EXERCISES } from '../data/exercises';
import { equipmentText } from '../data/describe';
import { MUSCLE_GROUPS, MUSCLE_LABELS, type MuscleGroup } from '../data/types';
import { loadGroups } from '../storage';
import { Icon, MuscleIcon } from './icons';
import { Screen } from './Layout';

/** Exercises tab: search plus one row of muscle filters. */
export function Library() {
  const mine = loadGroups();
  const [filter, setFilter] = useState<MuscleGroup | 'all'>('all');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  // Your own muscle groups first in the filter row.
  const order = [...mine, ...MUSCLE_GROUPS.filter((g) => !mine.includes(g))];
  const matches = EXERCISES.filter(
    (e) => (filter === 'all' || e.primary.includes(filter)) && (!q || e.name.toLowerCase().includes(q)),
  );
  // Each exercise once, under its main muscle.
  const sections = (filter === 'all' ? order : [filter])
    .map((g) => ({ g, list: matches.filter((e) => (filter === 'all' ? e.primary[0] === g : true)) }))
    .filter((s) => s.list.length);

  return (
    <Screen title="Exercises" tab="exercises">
      <input class="search" type="search" placeholder="Search exercises" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      <div class="filter-row" role="group" aria-label="Filter by muscle">
        <button type="button" class={`filter ${filter === 'all' ? 'on' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </button>
        {order.map((g) => (
          <button type="button" class={`filter ${filter === g ? 'on' : ''}`} aria-pressed={filter === g} onClick={() => setFilter(g)}>
            <MuscleIcon group={g} size={18} />
            {MUSCLE_LABELS[g]}
          </button>
        ))}
      </div>

      {sections.map(({ g, list }) => (
        <section class="lib-section">
          <h2>{MUSCLE_LABELS[g]}</h2>
          <ul class="rows card">
            {list.map((e) => (
              <li>
                <a href={`#/exercise/${e.id}`}>
                  <span class="row-main">
                    <strong>{e.name}</strong>
                    <small>{equipmentText(e)}</small>
                  </span>
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {matches.length === 0 && <p class="muted center">No exercises match.</p>}
    </Screen>
  );
}
