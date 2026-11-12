import { getExercise } from '../data/exercises';
import { EQUIPMENT_LABELS, MUSCLE_LABELS } from '../data/types';
import { describeTarget } from '../data/describe';
import { groupStyle } from '../ui/brand';
import { Icon, MuscleIcon } from './icons';
import { ExerciseDemo } from './ExerciseDemo';
import { Screen } from './Layout';

export function ExerciseDetail({ id }: { id: string }) {
  const e = getExercise(id);
  if (!e) {
    return (
      <Screen title="Exercise not found" back="library" tab="exercises">
        <p class="muted">No exercise with that name.</p>
      </Screen>
    );
  }
  return (
    <Screen title={e.name} back="library" tab="exercises">
      <ExerciseDemo exercise={e} />
      <div class="tags">
        {e.primary.map((g) => (
          <span class="tag strong" style={groupStyle(g)}>
            <MuscleIcon group={g} size={10} />
            {MUSCLE_LABELS[g]}
          </span>
        ))}
        {e.equipment.map((q) => (
          <span class="tag">{EQUIPMENT_LABELS[q]}</span>
        ))}
        <span class={`tag ${e.analysis === 'full' ? 'full' : ''}`}>{e.analysis === 'full' ? 'Full analysis' : 'Basic analysis'}</span>
      </div>
      <a class="button big" href={`#/analyze/${e.id}`}>
        <Icon name="camera" size={22} /> Check my technique
      </a>
      <p class="lead">{e.summary}</p>

      <h2>Tips</h2>
      <ul class="tips">
        {e.faults.map((f) => {
          const corrective = getExercise(f.corrective);
          return (
            <li>
              <Icon name="tip" size={20} />
              <span>
                {f.cue}
                {corrective && (
                  <small>
                    {' '}
                    Practice with <a href={`#/exercise/${f.corrective}`}>{corrective.name.toLowerCase()}</a>.
                  </small>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {e.secondary.length > 0 && (
        <p class="muted small">Also works {e.secondary.map((g) => MUSCLE_LABELS[g].toLowerCase()).join(', ')}.</p>
      )}

      <details class="more">
        <summary>How we judge it</summary>
        <p class="muted small">
          {e.analysis === 'full'
            ? 'Full analysis: these checks come from written coaching and competition standards.'
            : 'Basic analysis: camera placement, rep counting and range of motion.'}{' '}
          All values are starting points and haven’t been calibrated against recorded reps yet.
        </p>
        <ul class="judged">
          <li>
            <strong>{e.tracking.kind === 'hold' ? 'Hold time' : 'Rep count'}</strong>
          </li>
          {e.checks.map((c) => (
            <li>
              <strong>{c.label}</strong>
              <span>{describeTarget(c)}</span>
              {c.source && <small>Source: {c.source}</small>}
            </li>
          ))}
        </ul>
      </details>
    </Screen>
  );
}
