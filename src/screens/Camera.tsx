import { useEffect, useRef, useState } from 'preact/hooks';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { closeCamera, openCamera, type Facing } from '../camera';
import { getExercise } from '../data/exercises';
import { placementLines } from '../data/describe';
import { drawSkeleton } from '../draw';
import { LM, createPoseLandmarker, type Delegate, type ModelVariant } from '../pose';
import { Screen } from './Layout';

// The model is kept across screens so it only loads once per visit.
let cached: { variant: ModelVariant; landmarker: PoseLandmarker; delegate: Delegate } | undefined;
async function getLandmarker(variant: ModelVariant) {
  if (cached?.variant === variant) return cached;
  cached?.landmarker.close();
  cached = undefined;
  const made = await createPoseLandmarker(variant);
  cached = { variant, ...made };
  return cached;
}

function cameraErrorMessage(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access in your browser settings and try again.';
  if (name === 'NotFoundError') return 'No camera found on this device.';
  if (name === 'NotReadableError') return 'The camera is in use by another app.';
  return (err as Error)?.message ?? String(err);
}

export function Camera({ exerciseId }: { exerciseId?: string }) {
  const exercise = exerciseId ? getExercise(exerciseId) : undefined;
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState<ModelVariant>(cached?.variant ?? 'full');
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [facing, setFacing] = useState<Facing>('environment');
  const [error, setError] = useState('');
  const [debug, setDebug] = useState('');
  const state = useRef({
    running: false,
    stream: undefined as MediaStream | undefined,
    lastTs: 0,
    lastVideoTime: -1,
    fps: 0,
    lastFrameAt: 0,
    inferMs: 0,
  });

  // Load (or switch) the model.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    getLandmarker(variant)
      .then(() => !cancelled && setReady(true))
      .catch((err) => !cancelled && setError(`Failed to load pose model: ${(err as Error).message ?? err}`));
    return () => {
      cancelled = true;
    };
  }, [variant]);

  const stop = () => {
    const s = state.current;
    s.running = false;
    setRunning(false);
    // Stop the tracks via our own reference: on unmount the video ref is
    // already cleared, and the camera must still be released.
    s.stream?.getTracks().forEach((t) => t.stop());
    s.stream = undefined;
    if (videoRef.current) closeCamera(videoRef.current);
    const c = canvasRef.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  };

  // Release the camera when leaving the screen or backgrounding the page.
  useEffect(() => {
    const onHide = () => document.hidden && stop();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, []);

  const start = async (which: Facing = facing) => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const stage = stageRef.current!;
    const ctx = canvas.getContext('2d')!;
    setError('');
    // Show the stage before opening the camera: iOS may not start a video
    // element that is hidden.
    setRunning(true);
    try {
      state.current.stream = await openCamera(video, which);
    } catch (err) {
      setRunning(false);
      setError(cameraErrorMessage(err));
      return;
    }
    const s = state.current;
    s.running = true;
    s.lastVideoTime = -1;

    const schedule = () => {
      if (!s.running) return;
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onFrame);
      else requestAnimationFrame(onFrame);
    };
    const onFrame = () => {
      if (!s.running) return;
      const model = cached;
      if (model && video.readyState >= 2 && video.currentTime !== s.lastVideoTime) {
        s.lastVideoTime = video.currentTime;
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
        }
        // MediaPipe needs strictly increasing timestamps in VIDEO mode.
        const ts = Math.max(s.lastTs + 1, performance.now());
        s.lastTs = ts;
        const t0 = performance.now();
        const result = model.landmarker.detectForVideo(video, ts);
        const t1 = performance.now();
        s.inferMs = s.inferMs * 0.9 + (t1 - t0) * 0.1;
        if (s.lastFrameAt) s.fps = s.fps * 0.9 + (1000 / (t1 - s.lastFrameAt)) * 0.1;
        s.lastFrameAt = t1;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const pose = result.landmarks[0];
        if (pose) drawSkeleton(ctx, pose);
        const lines = [
          `${model.variant} model · ${model.delegate} · ${video.videoWidth}x${video.videoHeight}`,
          `${s.fps.toFixed(0)} fps · ${s.inferMs.toFixed(0)} ms/frame`,
        ];
        if (!pose) lines.push('No person detected');
        else
          for (const [name, i] of Object.entries(LM))
            lines.push(`${name.padEnd(14)} y=${pose[i].y.toFixed(3)}  vis=${pose[i].visibility.toFixed(2)}`);
        setDebug(lines.join('\n'));
        // Nothing from the frame is kept: the result is dropped after drawing.
      }
      schedule();
    };
    schedule();
  };

  const flip = async () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    stop();
    await start(next);
  };

  return (
    <Screen title={exercise ? exercise.name : 'Camera test'} back={exercise ? `exercise/${exercise.id}` : ''}>
      {exercise && !running && (
        <section class="card">
          <h2>Camera placement</h2>
          <ul>
            {placementLines(exercise.placement).map((l) => (
              <li>{l}</li>
            ))}
          </ul>
        </section>
      )}
      {!exercise && !running && <p class="muted">Checks that pose tracking works on this phone. Nothing is recorded.</p>}

      <div class={`stage ${facing === 'user' ? 'mirrored' : ''}`} ref={stageRef} hidden={!running}>
        <video ref={videoRef} playsInline muted autoPlay />
        <canvas ref={canvasRef} />
      </div>

      {!running ? (
        <button type="button" disabled={!ready} onClick={() => start()}>
          {ready ? 'Start camera' : 'Loading pose model…'}
        </button>
      ) : (
        <div class="controls">
          <button type="button" class="secondary" onClick={flip}>
            Flip camera
          </button>
          <button type="button" class="secondary" onClick={stop}>
            Stop
          </button>
        </div>
      )}
      <label class="inline">
        Model
        <select value={variant} disabled={!ready} onChange={(e) => setVariant(e.currentTarget.value as ModelVariant)}>
          <option value="lite">Lite (faster)</option>
          <option value="full">Full (more accurate)</option>
        </select>
      </label>
      {error && <p class="error">{error}</p>}
      {running && <pre class="debug">{debug}</pre>}
    </Screen>
  );
}
