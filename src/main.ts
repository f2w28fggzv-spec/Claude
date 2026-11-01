import './style.css';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createPoseLandmarker, LM, type Delegate, type ModelVariant } from './pose';
import { closeCamera, openCamera, type Facing } from './camera';
import { drawSkeleton } from './draw';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const intro = $<HTMLElement>('intro');
const live = $<HTMLElement>('live');
const startBtn = $<HTMLButtonElement>('start');
const stopBtn = $<HTMLButtonElement>('stop');
const flipBtn = $<HTMLButtonElement>('flip');
const modelSel = $<HTMLSelectElement>('model');
const errorEl = $<HTMLParagraphElement>('error');
const stage = $<HTMLDivElement>('stage');
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('overlay');
const debug = $<HTMLPreElement>('debug');
const ctx = canvas.getContext('2d')!;

let landmarker: PoseLandmarker | undefined;
let delegate: Delegate = 'GPU';
let variant: ModelVariant = modelSel.value as ModelVariant;
let facing: Facing = 'environment';
let running = false;
let swapping = false;
let lastTs = 0;
let lastVideoTime = -1;
let fps = 0;
let lastFrameAt = 0;
let inferMs = 0;

function showError(msg: string) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

async function loadModel(v: ModelVariant) {
  swapping = true;
  landmarker?.close();
  landmarker = undefined;
  ({ landmarker, delegate } = await createPoseLandmarker(v));
  variant = v;
  swapping = false;
}

function scheduleFrame() {
  if (!running) return;
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onFrame);
  else requestAnimationFrame(onFrame);
}

function onFrame() {
  if (!running) return;
  if (landmarker && !swapping && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    }
    // MediaPipe needs strictly increasing timestamps in VIDEO mode.
    const ts = Math.max(lastTs + 1, performance.now());
    lastTs = ts;
    const t0 = performance.now();
    const result = landmarker.detectForVideo(video, ts);
    const t1 = performance.now();
    inferMs = inferMs * 0.9 + (t1 - t0) * 0.1;
    if (lastFrameAt) fps = fps * 0.9 + (1000 / (t1 - lastFrameAt)) * 0.1;
    lastFrameAt = t1;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pose = result.landmarks[0];
    if (pose) drawSkeleton(ctx, pose);
    renderDebug(pose);
    // Nothing from the frame is kept: the video element only holds the live
    // stream and the result is dropped after drawing.
  }
  scheduleFrame();
}

function renderDebug(pose?: { x: number; y: number; visibility: number }[]) {
  const lines = [
    `${variant} model · ${delegate} · ${video.videoWidth}x${video.videoHeight}`,
    `${fps.toFixed(0)} fps · ${inferMs.toFixed(0)} ms/frame`,
  ];
  if (!pose) {
    lines.push('No person detected');
  } else {
    const row = (name: string, i: number) => {
      const p = pose[i];
      return `${name.padEnd(14)} y=${p.y.toFixed(3)}  vis=${p.visibility.toFixed(2)}`;
    };
    for (const [name, i] of Object.entries(LM)) lines.push(row(name, i));
  }
  debug.textContent = lines.join('\n');
}

async function start() {
  errorEl.hidden = true;
  try {
    await openCamera(video, facing);
  } catch (err) {
    showError(cameraErrorMessage(err));
    return;
  }
  stage.classList.toggle('mirrored', facing === 'user');
  intro.hidden = true;
  live.hidden = false;
  running = true;
  lastVideoTime = -1;
  scheduleFrame();
}

function stop() {
  running = false;
  closeCamera(video);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  live.hidden = true;
  intro.hidden = false;
}

function cameraErrorMessage(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access in your browser settings and try again.';
  if (name === 'NotFoundError') return 'No camera found on this device.';
  if (name === 'NotReadableError') return 'The camera is in use by another app.';
  return (err as Error)?.message ?? String(err);
}

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);
flipBtn.addEventListener('click', async () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  running = false;
  closeCamera(video);
  await start();
});
modelSel.addEventListener('change', async () => {
  modelSel.disabled = true;
  try {
    await loadModel(modelSel.value as ModelVariant);
  } catch (err) {
    showError(`Failed to load model: ${(err as Error).message}`);
  } finally {
    modelSel.disabled = false;
  }
});

// Release the camera as soon as the page is backgrounded.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) stop();
});
window.addEventListener('pagehide', () => running && stop());

loadModel(variant)
  .then(() => {
    startBtn.disabled = false;
    startBtn.textContent = 'Start camera';
  })
  .catch((err) => {
    startBtn.textContent = 'Model failed to load';
    showError(String(err?.message ?? err));
  });
