import { getExercise } from '../data/exercises';
import { equipmentText, musclesText, placementLines, secondaryText } from '../data/describe';
import { Screen } from './Layout';

export function ExerciseDetail({ id }: { id: string }) {
  const e = getExercise(id);
  if (!e) {
    return (
      <Screen title="Exercise not found" back="library">
        <p>No exercise with that name.</p>
      </Screen>
    );
  }
  const checkedFaults = new Set(e.checks.map((c) => c.fault));

  return (
    <Screen title={e.name} back="library">
      <p>{e.summary}</p>
      <dl class="facts">
        <dt>Muscles</dt>
        <dd>{musclesText(e)}</dd>
        {e.secondary.length > 0 && (
          <>
            <dt>Also works</dt>
            <dd>{secondaryText(e)}</dd>
          </>
        )}
        <dt>Equipment</dt>
        <dd>{equipmentText(e)}</dd>
        <dt>Technique feedback</dt>
        <dd>
          <span class={`badge ${e.analysis}`}>{e.analysis === 'full' ? 'Full analysis' : 'Basic analysis'}</span>
          {e.analysis === 'basic' && <small class="muted"> Placement, rep counting and range of motion</small>}
        </dd>
      </dl>

      <section class="card">
        <h2>Camera placement</h2>
        <ul>
          {placementLines(e.placement).map((l) => (
            <li>{l}</li>
          ))}
        </ul>
        <a class="button" href={`#/analyze/${e.id}`}>
          Check my technique
        </a>
      </section>

      <section>
        <h2>What gets checked</h2>
        <p class="muted small">Thresholds are early drafts and haven’t been calibrated yet.</p>
        <ul class="list plain">
          {e.tracking.kind === 'hold' ? <li>Hold time</li> : <li>Rep count</li>}
          {e.checks.map((c) => (
            <li>{c.label}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Common faults</h2>
        <ul class="list plain faults">
          {e.faults.map((f) => {
            const corrective = getExercise(f.corrective);
            return (
              <li>
                <strong>{f.label}</strong>
                <span>{f.cue}</span>
                <span class="muted small">
                  Corrective: <a href={`#/exercise/${f.corrective}`}>{corrective?.name ?? f.corrective}</a>
                  {!checkedFaults.has(f.id) && ' · Coaching tip only; the camera does not detect this'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </Screen>
  );
}
