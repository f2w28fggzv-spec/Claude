import { MUSCLE_GROUPS, MUSCLE_LABELS, type MuscleGroup } from '../data/types';
import { BodyFigure } from './anatomy';
import { heatColour } from './BodyHeatmap';
import { MuscleIcon } from './icons';
import { Screen } from './Layout';

// A sample week: each group at a different share of its target.
const SAMPLE: Record<MuscleGroup, number> = {
  chest: 1,
  back: 0.8,
  shoulders: 0.6,
  biceps: 0.4,
  triceps: 0.5,
  core: 0.2,
  quads: 0.9,
  hamstrings: 0.3,
  glutes: 0.7,
  calves: 0,
};

/** Hidden page (#/dev/anatomy): both views large with sample shading, and every icon. */
export function DevAnatomy() {
  const fill = (g: MuscleGroup | null) => (g ? heatColour({ sets: SAMPLE[g] > 0 ? 1 : 0, share: SAMPLE[g] }) : undefined);
  const cls = (g: MuscleGroup | null) => (g ? '' : 'heat-n');
  return (
    <Screen title="Anatomy" subtitle="Developer view" back="">
      <div class="dev-anatomy">
        <BodyFigure view="front" muscleFill={fill} muscleClass={cls} label="Front" />
        <BodyFigure view="back" muscleFill={fill} muscleClass={cls} label="Back" />
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
