import { useState } from 'preact/hooks';
import { getExercise } from '../data/exercises';
import { placementLines } from '../data/describe';
import { LM } from '../pose';
import { usePoseCamera, type LiveFrame } from '../analysis/usePoseCamera';
import { Screen } from './Layout';
import { CameraStage, ModelPicker } from './CameraStage';

/** Camera test: live skeleton overlay and landmark readout, nothing recorded. */
export function Camera({ exerciseId }: { exerciseId?: string }) {
  const exercise = exerciseId ? getExercise(exerciseId) : undefined;
  const [debug, setDebug] = useState('');
  const cam = usePoseCamera(({ frame }: LiveFrame) => {
    const lines: string[] = [];
    if (!frame.lm) lines.push('No person detected');
    else for (const [name, i] of Object.entries(LM)) lines.push(`${name.padEnd(14)} y=${frame.lm[i][1].toFixed(3)}  vis=${frame.lm[i][3].toFixed(2)}`);
    setDebug(lines.join('\n'));
  });

  return (
    <Screen title={exercise ? exercise.name : 'Camera test'} back={exercise ? `exercise/${exercise.id}` : ''}>
      {exercise && !cam.running && (
        <section class="card">
          <h2>Camera placement</h2>
          <ul>
            {placementLines(exercise.placement).map((l) => (
              <li>{l}</li>
            ))}
          </ul>
        </section>
      )}
      {!exercise && !cam.running && <p class="muted">Checks that pose tracking works on this phone. Nothing is recorded.</p>}
      <CameraStage cam={cam} />
      {!cam.running ? (
        <button type="button" disabled={!cam.ready} onClick={() => cam.start()}>
          {cam.ready ? 'Start camera' : 'Loading pose model…'}
        </button>
      ) : (
        <div class="controls">
          <button type="button" class="secondary" onClick={cam.flip}>
            Flip camera
          </button>
          <button type="button" class="secondary" onClick={cam.stop}>
            Stop
          </button>
        </div>
      )}
      <ModelPicker cam={cam} />
      {cam.error && <p class="error">{cam.error}</p>}
      {cam.running && (
        <pre class="debug">
          {cam.stats &&
            `${cam.stats.variant} model · ${cam.stats.delegate} · ${cam.stats.width}x${cam.stats.height}\n${cam.stats.fps.toFixed(0)} fps · ${cam.stats.inferMs.toFixed(0)} ms/frame\n`}
          {debug}
        </pre>
      )}
    </Screen>
  );
}
