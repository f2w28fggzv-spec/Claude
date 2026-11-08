import { MUSCLE_GROUPS, MUSCLE_LABELS, type MuscleGroup } from '../data/types';
import { BodyFigure } from './anatomy';
import { MuscleIcon } from './icons';
import { Screen } from './Layout';

/** Hidden page (#/dev/anatomy): both views large, one colour per group, and every icon. */
export function DevAnatomy() {
  const cls = (g: MuscleGroup | null) => (g ? `dev-${g}` : 'an-neutral');
  return (
    <Screen title="Anatomy" subtitle="Developer view" back="">
      <div class="dev-anatomy">
        <BodyFigure view="front" muscleClass={cls} crop={false} label="Front" />
        <BodyFigure view="back" muscleClass={cls} crop={false} label="Back" />
      </div>
      <div class="dev-anatomy">
        <BodyFigure view="front" class="muscle-icon" muscleClass={(g) => (g === 'chest' ? 'mi-on' : 'mi-off')} crop={false} />
        <BodyFigure view="back" class="muscle-icon" muscleClass={(g) => (g === 'back' ? 'mi-on' : 'mi-off')} crop={false} />
      </div>
      <div class="dev-icons">
        {MUSCLE_GROUPS.map((g) => (
          <figure>
            <MuscleIcon group={g} size={72} />
            <figcaption class="small">{MUSCLE_LABELS[g]}</figcaption>
          </figure>
        ))}
      </div>
    </Screen>
  );
}
