import { useState } from 'preact/hooks';
import { LEVELS, MUSCLE_LABELS, type Level } from '../data/types';
import { EQUIPMENT_SETTING_LABELS, MAX_DAYS, MIN_DAYS, buildProgram, type EquipmentSetting } from '../program/builder';
import { navigate } from '../router';
import { loadGroups, saveProgram } from '../storage';
import { Icon, LevelIcon, type IconName } from './icons';
import { Screen } from './Layout';
import { rememberUnsaved } from './ProgramView';

const LEVEL_TEXT: Record<Level, [string, string]> = {
  beginner: ['New', 'Less than a year of lifting'],
  intermediate: ['Some experience', '1–3 years'],
  advanced: ['Experienced', '3+ years'],
};

const EQUIPMENT: Record<EquipmentSetting, [IconName, string]> = {
  fullGym: ['barbell', 'Barbells, machines, everything'],
  dumbbells: ['dumbbell', 'Dumbbells and a pull-up bar'],
  bodyweight: ['body', 'No weights, just a pull-up bar'],
};

/** Step 2 of creating a plan. */
export function Build() {
  const groups = loadGroups();
  const [days, setDays] = useState(3);
  const [level, setLevel] = useState<Level>('beginner');
  const [equipment, setEquipment] = useState<EquipmentSetting>('fullGym');

  if (groups.length === 0) {
    return (
      <Screen title="How do you train?" back="">
        <p class="muted">Pick the muscle groups you want to train first.</p>
        <a class="button" href="#/groups">
          Pick muscle groups
        </a>
      </Screen>
    );
  }

  const build = () => {
    const program = buildProgram({ groups, daysPerWeek: days, level, equipment });
    // The Plan tab shows the newest saved plan; if saving failed, show it directly.
    if (saveProgram(program)) navigate('/');
    else {
      rememberUnsaved(program);
      navigate(`/program/${program.id}`);
    }
  };

  return (
    <Screen
      title="How do you train?"
      subtitle={`Step 2 of 2 · ${groups.map((g) => MUSCLE_LABELS[g]).join(', ')}`}
      back="groups"
      action={
        <button type="button" onClick={build}>
          Create my plan
        </button>
      }
    >
      <h2 class="field">Days per week</h2>
      <div class="days">
        {Array.from({ length: MAX_DAYS - MIN_DAYS + 1 }, (_, i) => i + MIN_DAYS).map((d) => (
          <button type="button" class={d === days ? 'on' : ''} aria-pressed={d === days} onClick={() => setDays(d)}>
            {d}
          </button>
        ))}
      </div>

      <h2 class="field">Experience</h2>
      <div class="choices">
        {LEVELS.map((l, i) => (
          <button type="button" class={`choice ${l === level ? 'on' : ''}`} aria-pressed={l === level} onClick={() => setLevel(l)}>
            <LevelIcon level={(i + 1) as 1 | 2 | 3} />
            <span>
              <strong>{LEVEL_TEXT[l][0]}</strong>
              <small>{LEVEL_TEXT[l][1]}</small>
            </span>
          </button>
        ))}
      </div>

      <h2 class="field">Equipment</h2>
      <div class="choices">
        {(Object.keys(EQUIPMENT) as EquipmentSetting[]).map((q) => (
          <button type="button" class={`choice ${q === equipment ? 'on' : ''}`} aria-pressed={q === equipment} onClick={() => setEquipment(q)}>
            <Icon name={EQUIPMENT[q][0]} size={28} />
            <span>
              <strong>{EQUIPMENT_SETTING_LABELS[q]}</strong>
              <small>{EQUIPMENT[q][1]}</small>
            </span>
          </button>
        ))}
      </div>
    </Screen>
  );
}
