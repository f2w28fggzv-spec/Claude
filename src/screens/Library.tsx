import { useEffect, useState } from 'preact/hooks';
import { EXERCISES } from '../data/exercises';
import { equipmentText } from '../data/describe';
import {
  EQUIPMENT_FILTERS,
  EQUIPMENT_FILTER_LABELS,
  LEVEL_FILTER_LABELS,
  NO_FILTERS,
  TYPE_LABELS,
  filterExercises,
  sanitizeFilters,
  sheetFilterCount,
  type LibraryFilters,
} from '../data/filters';
import { LEVELS, MUSCLE_GROUPS, MUSCLE_LABELS } from '../data/types';
import { loadGroups, loadLibraryFilters, saveLibraryFilters } from '../storage';
import { groupStyle } from '../ui/brand';
import { Icon, MuscleIcon } from './icons';
import { Screen } from './Layout';

const ROLES = ['compound', 'isolation'] as const;

/** Exercises tab: search, a muscle row, and a sheet with more filters. */
export function Library() {
  const mine = loadGroups();
  const [filters, setFilters] = useState<LibraryFilters>(() => sanitizeFilters(loadLibraryFilters(), MUSCLE_GROUPS));
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState(false);

  const update = (next: Partial<LibraryFilters>) => {
    const f = { ...filters, ...next };
    setFilters(f);
    saveLibraryFilters(f);
  };
  const toggle = <K extends 'equipment' | 'levels' | 'types'>(key: K, value: LibraryFilters[K][number]) => {
    const list = filters[key] as string[];
    update({ [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] } as Partial<LibraryFilters>);
  };

  // Your own muscle groups first in the filter row.
  const order = [...mine, ...MUSCLE_GROUPS.filter((g) => !mine.includes(g))];
  const matches = filterExercises(EXERCISES, filters, query);
  // Each exercise once, under its main muscle.
  const sections = (filters.muscle === 'all' ? order : [filters.muscle])
    .map((g) => ({ g, list: matches.filter((e) => (filters.muscle === 'all' ? e.primary[0] === g : true)) }))
    .filter((s) => s.list.length);
  const count = sheetFilterCount(filters);

  // Active sheet filters as removable chips.
  const active: { label: string; remove: () => void }[] = [
    ...filters.equipment.map((q) => ({ label: EQUIPMENT_FILTER_LABELS[q], remove: () => toggle('equipment', q) })),
    ...filters.levels.map((l) => ({ label: LEVEL_FILTER_LABELS[l], remove: () => toggle('levels', l) })),
    ...filters.types.map((t) => ({ label: t === 'compound' ? 'Compound' : 'Isolation', remove: () => toggle('types', t) })),
    ...(filters.fullOnly ? [{ label: 'Full analysis', remove: () => update({ fullOnly: false }) }] : []),
  ];

  return (
    <Screen title="Exercises" tab="exercises">
      <div class="search-row">
        <input class="search" type="search" placeholder="Search exercises" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <button type="button" class={`filters-btn ${count ? 'on' : ''}`} onClick={() => setSheet(true)} aria-haspopup="dialog">
          <Icon name="filter" size={20} />
          Filters{count ? <span class="count">{count}</span> : null}
        </button>
      </div>
      <div class="filter-row" role="group" aria-label="Filter by muscle">
        <button type="button" class={`filter ${filters.muscle === 'all' ? 'on' : ''}`} aria-pressed={filters.muscle === 'all'} onClick={() => update({ muscle: 'all' })}>
          All
        </button>
        {order.map((g) => (
          <button
            type="button"
            class={`filter group ${filters.muscle === g ? 'on' : ''}`}
            style={groupStyle(g)}
            aria-pressed={filters.muscle === g}
            onClick={() => update({ muscle: g })}
          >
            <MuscleIcon group={g} size={12} />
            {MUSCLE_LABELS[g]}
          </button>
        ))}
      </div>
      {active.length > 0 && (
        <div class="active-filters">
          {active.map((a) => (
            <button type="button" class="active-chip" onClick={a.remove} aria-label={`Remove filter ${a.label}`}>
              {a.label} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" class="link" onClick={() => update({ ...NO_FILTERS, muscle: filters.muscle })}>
            Clear
          </button>
        </div>
      )}

      {sections.map(({ g, list }, si) => (
        <section class="lib-section" style={{ '--i': String(si) }}>
          <h2>{MUSCLE_LABELS[g]}</h2>
          <ul class="rows card">
            {list.map((e, i) => (
              <li style={{ '--i': String(i) }}>
                <a href={`#/exercise/${e.id}`}>
                  <span class="row-main">
                    <strong>{e.name}</strong>
                    <small>
                      {equipmentText(e)}
                      {e.analysis === 'full' && <span class="full-dot"> · Full analysis</span>}
                    </small>
                  </span>
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {matches.length === 0 && (
        <div class="empty">
          <p class="muted center">No exercises match these filters.</p>
          <button type="button" class="link center" onClick={() => update(NO_FILTERS)}>
            Clear all filters
          </button>
        </div>
      )}

      {sheet && (
        <FilterSheet
          filters={filters}
          resultCount={matches.length}
          onToggle={toggle}
          onFullOnly={(v) => update({ fullOnly: v })}
          onClear={() => update({ ...NO_FILTERS, muscle: filters.muscle })}
          onClose={() => setSheet(false)}
        />
      )}
    </Screen>
  );
}

function FilterSheet(props: {
  filters: LibraryFilters;
  resultCount: number;
  onToggle: <K extends 'equipment' | 'levels' | 'types'>(key: K, value: LibraryFilters[K][number]) => void;
  onFullOnly: (v: boolean) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { filters: f } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, []);
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" class={`filter ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>
      {on && <Icon name="check" size={14} />}
      {label}
    </button>
  );
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Filter exercises">
        <header class="sheet-head">
          <h2>Filters</h2>
          <button type="button" class="link" onClick={props.onClear}>
            Clear all
          </button>
        </header>

        <h3>Equipment</h3>
        <div class="chip-wrap">
          {EQUIPMENT_FILTERS.map((q) => chip(f.equipment.includes(q), EQUIPMENT_FILTER_LABELS[q], () => props.onToggle('equipment', q)))}
        </div>

        <h3>Difficulty</h3>
        <div class="chip-wrap">
          {LEVELS.map((l) => chip(f.levels.includes(l), LEVEL_FILTER_LABELS[l], () => props.onToggle('levels', l)))}
        </div>

        <h3>Type</h3>
        <div class="chip-wrap">{ROLES.map((r) => chip(f.types.includes(r), TYPE_LABELS[r], () => props.onToggle('types', r)))}</div>

        <label class="switch-row">
          <span>
            <strong>Full technique analysis only</strong>
            <small>Exercises with every check, not just rep counting and range of motion</small>
          </span>
          <input type="checkbox" role="switch" checked={f.fullOnly} onChange={(e) => props.onFullOnly(e.currentTarget.checked)} />
        </label>

        <button type="button" class="big" onClick={props.onClose}>
          Show {props.resultCount} exercise{props.resultCount === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}
