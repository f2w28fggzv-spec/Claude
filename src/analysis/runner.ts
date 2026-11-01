// Shared MediaPipe pose model: loaded once, used by the live camera and by
// video-file analysis. Converts results to engine PoseFrames (numbers only).
import type { PoseLandmarker, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { createPoseLandmarker, type Delegate, type ModelVariant } from '../pose';
import type { PoseFrame, RawLandmark } from '../engine/types';

export interface LoadedModel {
  variant: ModelVariant;
  landmarker: PoseLandmarker;
  delegate: Delegate;
}

let cached: LoadedModel | undefined;
let loading: { variant: ModelVariant; promise: Promise<LoadedModel> } | undefined;

export function currentModel(): LoadedModel | undefined {
  return cached;
}

export async function loadModel(variant: ModelVariant): Promise<LoadedModel> {
  if (cached?.variant === variant) return cached;
  if (loading?.variant === variant) return loading.promise;
  const promise = (async () => {
    cached?.landmarker.close();
    cached = undefined;
    const made = await createPoseLandmarker(variant);
    cached = { variant, ...made };
    return cached;
  })();
  loading = { variant, promise };
  try {
    return await promise;
  } finally {
    if (loading?.promise === promise) loading = undefined;
  }
}

// VIDEO mode needs strictly increasing timestamps across every call on the
// same model, whether the frames come from the camera or a file.
let lastTs = 0;

export function detect(model: LoadedModel, source: HTMLVideoElement, wantMs: number): PoseLandmarkerResult {
  const ts = Math.max(lastTs + 1, Math.round(wantMs));
  lastTs = ts;
  return model.landmarker.detectForVideo(source, ts);
}

/** Start of a fresh timeline (e.g. a video file) after everything so far. */
export function timelineStart(): number {
  return lastTs + 1000;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

export function toPoseFrame(result: PoseLandmarkerResult, t: number): PoseFrame {
  const pose = result.landmarks[0];
  if (!pose) return { t, lm: null };
  return {
    t,
    lm: pose.map((p) => [r4(p.x), r4(p.y), r4(p.z), Math.round((p.visibility ?? 0) * 100) / 100] as RawLandmark),
  };
}
