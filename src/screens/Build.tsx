import { useState } from 'preact/hooks';
import { LEVELS, MUSCLE_LABELS, type Level } from '../data/types';
import {
  EQUIPMENT_SETTING_LABELS,
  MAX_DAYS,
  MIN_DAYS,
  buildProgram,
  type EquipmentSetting,
} from '../program/builder';
import { navigate } from '../router';
import { loadGroups, saveProgram } from '../storage';
import { Screen } from './Layout';
import { rememberUnsaved } from './ProgramView';

const LEVEL_HELP: Record<Level, string> = {
  beginner: 'Under a year of regular lifting',
  intermediate: '1–3 years of consistent training',
  advanced: '3+ years, comfortable with heavy compound lifts',
};

export function Build() {
  const groups = loadGroups();
  const [days, setDays] = useState(3);
  const [level, setLevel] = useState<Level>('beginner');
  const [equipment, setEquipment] = useState<EquipmentSetting>('fullGym');

  if (groups.length === 0) {
    return (
      <Screen title="Build a program" back="">
        <p>Choose your muscle groups first.</p>
        <a class="button" href="#/groups">
          Choose muscle groups
        </a>
      </Screen>
    );
  }

  const build = () => {
    const program = buildProgram({ groups, daysPerWeek: days, level, equipment });
    if (!saveProgram(program)) rememberUnsaved(program);
    navigate(`/program/${program.id}`);
  };

  return (
    <Screen title="Build a program" back="">
      <p class="muted">
        Training: {groups.map((g) => MUSCLE_LABELS[g]).join(', ')} · <a href="#/groups">change</a>
      </p>

      <fieldset>
        <legend>Days per week</legend>
        <div class="segmented">
          {Array.from({ length: MAX_DAYS - MIN_DAYS + 1 }, (_, i) => i + MIN_DAYS).map((d) => (
            <button type="button" class={d === days ? 'on' : ''} aria-pressed={d === days} onClick={() => setDays(d)}>
              {d}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Experience</legend>
        {LEVELS.map((l) => (
          <label class="option">
            <input type="radio" name="level" checked={l === level} onChange={() => setLevel(l)} />
            <span>
              <strong>{l[0].toUpperCase() + l.slice(1)}</strong>
              <small>{LEVEL_HELP[l]}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Equipment</legend>
        {(Object.keys(EQUIPMENT_SETTING_LABELS) as EquipmentSetting[]).map((q) => (
          <label class="option">
            <input type="radio" name="equipment" checked={q === equipment} onChange={() => setEquipment(q)} />
            <span>
              <strong>{EQUIPMENT_SETTING_LABELS[q]}</strong>
              <small>
                {q === 'fullGym' && 'Barbells, dumbbells, benches, cables and machines'}
                {q === 'dumbbells' && 'Dumbbells, a pull-up bar and the floor (no bench)'}
                {q === 'bodyweight' && 'Bodyweight and a pull-up bar'}
              </small>
            </span>
          </label>
        ))}
      </fieldset>

      <button type="button" onClick={build}>
        Build program
      </button>
    </Screen>
  );
}
