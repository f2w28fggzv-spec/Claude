import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { POSE_WASM_DIR, poseModelPath, type PoseVariant } from './offline/manifest';

export type ModelVariant = PoseVariant;
export type Delegate = 'GPU' | 'CPU';

/** Indices into the 33 BlazePose landmarks that v0 cares about. */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

// Assets are self-hosted (see scripts/fetch-assets.mjs) so nothing is fetched
// from third parties at runtime. The service worker keeps a copy once they've
// been used (src/offline/), so technique checks also work offline.
const asset = (path: string) => new URL(path, document.baseURI).href;

let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | undefined;

export async function createPoseLandmarker(
  variant: ModelVariant,
): Promise<{ landmarker: PoseLandmarker; delegate: Delegate }> {
  fileset ??= await FilesetResolver.forVisionTasks(asset(POSE_WASM_DIR));
  const options = (delegate: Delegate) => ({
    baseOptions: {
      modelAssetPath: asset(poseModelPath(variant)),
      delegate,
    },
    runningMode: 'VIDEO' as const,
    numPoses: 1,
  });
  try {
    return { landmarker: await PoseLandmarker.createFromOptions(fileset, options('GPU')), delegate: 'GPU' };
  } catch (err) {
    console.warn('GPU delegate failed, falling back to CPU', err);
    return { landmarker: await PoseLandmarker.createFromOptions(fileset, options('CPU')), delegate: 'CPU' };
  }
}
