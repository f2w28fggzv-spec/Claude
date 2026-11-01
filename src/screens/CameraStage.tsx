import type { ComponentChildren } from 'preact';
import type { ModelVariant } from '../pose';
import type { usePoseCamera } from '../analysis/usePoseCamera';

type Cam = ReturnType<typeof usePoseCamera>;

/** Video with the skeleton overlay; children are drawn on top (status, countdown). */
export function CameraStage({ cam, children }: { cam: Cam; children?: ComponentChildren }) {
  return (
    <div class="stage-wrap" hidden={!cam.running}>
      <div class={`stage ${cam.facing === 'user' ? 'mirrored' : ''}`} ref={cam.stageRef}>
        <video ref={cam.videoRef} playsInline muted autoPlay />
        <canvas ref={cam.canvasRef} />
      </div>
      {children}
    </div>
  );
}

export function ModelPicker({ cam }: { cam: Cam }) {
  return (
    <label class="inline">
      Model
      <select value={cam.variant} disabled={!cam.ready} onChange={(e) => cam.setVariant(e.currentTarget.value as ModelVariant)}>
        <option value="lite">Lite (faster)</option>
        <option value="full">Full (more accurate)</option>
      </select>
    </label>
  );
}
