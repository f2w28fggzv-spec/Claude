import { useState } from 'preact/hooks';
import { EXERCISES } from '../data/exercises';
import { equipmentText } from '../data/describe';
import { LEVELS, MUSCLE_GROUPS, MUSCLE_LABELS } from '../data/types';
import { EQUIPMENT_SETTING_LABELS, availableExercises, type EquipmentSetting } from '../program/builder';
import { loadGroups } from '../storage';
import { Screen } from './Layout';

export function Library() {
  const selected = loadGroups();
  const [mine, setMine] = useState(selected.length > 0);
  const [query, setQuery] = useState('');
  const [equipment, setEquipment] = useState<EquipmentSetting | 'any'>('any');

  const allowed =
    equipment === 'any' ? null : new Set(availableExercises(equipment, LEVELS[LEVELS.length - 1]).map((e) => e.id));
  const q = query.trim().toLowerCase();
  const groups = mine ? selected : [...MUSCLE_GROUPS];
  const visible = EXERCISES.filter(
    (e) => (!allowed || allowed.has(e.id)) && (!q || e.name.toLowerCase().includes(q)),
  );

  return (
    <Screen title="Exercise library" back="">
      <div class="filters">
        <input type="search" placeholder="Search exercises" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <select value={equipment} onChange={(e) => setEquipment(e.currentTarget.value as EquipmentSetting | 'any')}>
          <option value="any">Any equipment</option>
          {(Object.keys(EQUIPMENT_SETTING_LABELS) as EquipmentSetting[]).map((k) => (
            <option value={k}>{EQUIPMENT_SETTING_LABELS[k]}</option>
          ))}
        </select>
        {selected.length > 0 && (
          <label class="toggle">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.currentTarget.checked)} />
            Only my muscle groups
          </label>
        )}
      </div>

      {groups.map((g) => {
        const list = visible.filter((e) => e.primary.includes(g));
        if (list.length === 0) return null;
        return (
          <section>
            <h2>{MUSCLE_LABELS[g]}</h2>
            <ul class="list">
              {list.map((e) => (
                <li>
                  <a href={`#/exercise/${e.id}`}>
                    <strong>{e.name}</strong>
                    <span class="muted small">
                      {equipmentText(e)}
                      <span class={`badge ${e.analysis}`}>{e.analysis === 'full' ? 'Full analysis' : 'Basic analysis'}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {visible.length === 0 && <p class="muted">No exercises match.</p>}
    </Screen>
  );
}
