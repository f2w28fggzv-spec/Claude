// The app side of offline use (src/offline/state.ts): install hints, what the
// offline row in Settings shows, the pose-model message and when an update
// may apply by itself.
import { describe, expect, it } from 'vitest';
import {
  canApplyUpdate,
  formatMB,
  installHint,
  LAUNCH_WINDOW_MS,
  looksLikeNetworkError,
  modelErrorMessage,
  offlineView,
  POSE_NEEDS_CONNECTION,
  POSE_NOT_SAVED,
  poseSaved,
  type OfflineFacts,
} from '../src/offline/state';
import type { WorkerStatus } from '../src/offline/worker';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
};

describe('install hint', () => {
  const hint = (o: Partial<Parameters<typeof installHint>[0]>) =>
    installHint({ standalone: false, installed: false, canPrompt: false, userAgent: UA.androidChrome, maxTouchPoints: 5, ...o });

  it('says it is installed when running from the home screen or just installed', () => {
    expect(hint({ standalone: true, canPrompt: true })).toBe('installed');
    expect(hint({ installed: true })).toBe('installed');
  });
  it('offers the install button when Chrome has its prompt ready', () => {
    expect(hint({ canPrompt: true })).toBe('prompt');
  });
  it('explains Share → Add to Home Screen on iPhone and iPad Safari', () => {
    expect(hint({ userAgent: UA.iphoneSafari })).toBe('ios-safari');
    expect(hint({ userAgent: UA.ipadSafari, maxTouchPoints: 5 })).toBe('ios-safari');
    expect(hint({ userAgent: UA.ipadSafari, maxTouchPoints: 0 })).toBe('other'); // a Mac
    expect(hint({ userAgent: UA.iphoneChrome })).toBe('ios-other');
  });
  it('gives a one-line hint elsewhere', () => {
    expect(hint({})).toBe('other');
    expect(hint({ userAgent: UA.androidFirefox })).toBe('other');
  });
});

const status = (saved: string[], appSaved = 3): WorkerStatus => ({
  version: 'v1',
  app: { files: 3, saved: appSaved, bytes: 900_000 },
  pose: [
    { url: 'mediapipe/models/pose_landmarker_full.task', size: 9_398_198, saved: false },
    { url: 'mediapipe/models/pose_landmarker_lite.task', size: 5_777_746, saved: false },
    { url: 'mediapipe/wasm/vision_wasm_internal.js', size: 334_128, saved: false },
    { url: 'mediapipe/wasm/vision_wasm_internal.wasm', size: 14_466_654, saved: false },
    { url: 'mediapipe/wasm/vision_wasm_nosimd_internal.js', size: 333_931, saved: false },
    { url: 'mediapipe/wasm/vision_wasm_nosimd_internal.wasm', size: 12_915_401, saved: false },
  ].map((p) => ({ ...p, saved: saved.some((s) => p.url.endsWith(s)) })),
});
const SIMD_FULL = ['pose_landmarker_full.task', 'vision_wasm_internal.js', 'vision_wasm_internal.wasm'];
const NOSIMD_FULL = ['pose_landmarker_full.task', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];

describe('offline state', () => {
  const view = (o: Partial<OfflineFacts>) => offlineView({ simd: true, saveFailed: false, online: true, ...o });

  it('is off without a service worker, saying why', () => {
    expect(view({ off: 'unsupported' })).toEqual({ kind: 'off', reason: 'unsupported' });
    expect(view({ off: 'dev', status: status(SIMD_FULL) })).toEqual({ kind: 'off', reason: 'dev' });
  });
  it('is saving the app until every file of it is saved', () => {
    expect(view({})).toEqual({ kind: 'saving-app' });
    expect(view({ status: status([], 2) })).toEqual({ kind: 'saving-app' });
  });
  it('has the app but not the pose model, with its size', () => {
    expect(view({ status: status(['vision_wasm_internal.js']) })).toEqual({ kind: 'app-only', poseBytes: 24_198_980, failed: false, online: true });
    expect(view({ status: status([]), simd: false, saveFailed: true, online: false })).toEqual({ kind: 'app-only', poseBytes: 22_647_530, failed: true, online: false });
    // The no-SIMD runtime doesn't help a SIMD browser, and the lite model isn't the default.
    expect(view({ status: status([...NOSIMD_FULL, 'lite.task']) }).kind).toBe('app-only');
  });
  it('shows progress while saving the pose model', () => {
    expect(view({ status: status([]), saving: { done: 5e6, total: 24e6 } })).toEqual({ kind: 'saving-pose', done: 5e6, total: 24e6 });
  });
  it('is ready when the runtime this browser uses and the full model are saved, with everything saved counted', () => {
    expect(view({ status: status(SIMD_FULL) })).toEqual({ kind: 'ready', bytes: 900_000 + 24_198_980 });
    expect(view({ status: status(NOSIMD_FULL), simd: false })).toEqual({ kind: 'ready', bytes: 900_000 + 22_647_530 });
  });
  it('knows which model a technique check needs', () => {
    expect(poseSaved(status(SIMD_FULL), true)).toBe(true);
    expect(poseSaved(status(SIMD_FULL), true, 'lite')).toBe(false);
    expect(poseSaved(status(SIMD_FULL), false)).toBe(false);
    expect(poseSaved(undefined, true)).toBe(false);
  });
  it('formats sizes for people', () => {
    expect(formatMB(906_000)).toBe('0.9 MB');
    expect(formatMB(24_198_980)).toBe('24 MB');
    expect(formatMB(25_098_980)).toBe('25 MB');
  });
});

describe('pose model message', () => {
  const msg = (o: Partial<Parameters<typeof modelErrorMessage>[0]>) =>
    modelErrorMessage({ online: true, saved: false, offlineAvailable: true, error: new TypeError('Failed to fetch'), ...o });

  it('says plainly that the model is not saved yet, offline or on a failed download', () => {
    expect(msg({ online: false, error: new Error('anything') })).toBe(POSE_NOT_SAVED);
    expect(msg({})).toBe(POSE_NOT_SAVED);
    expect(msg({ error: new TypeError('Load failed') })).toBe(POSE_NOT_SAVED); // Safari
    expect(msg({ error: new Event('error') })).toBe(POSE_NOT_SAVED); // the runtime's script didn't load
    expect(POSE_NOT_SAVED).toBe('The pose model isn’t saved on this phone yet. Connect to the internet once, then technique checks work offline.');
  });
  it('does not promise offline use where this browser can’t keep it', () => {
    expect(msg({ online: false, offlineAvailable: false })).toBe(POSE_NEEDS_CONNECTION);
  });
  it('shows other failures as they are', () => {
    expect(msg({ error: new Error('WebGL is not available') })).toBe('Couldn’t load the pose model: WebGL is not available');
    expect(msg({ saved: true, online: false, error: new Error('Out of memory') })).toBe('Couldn’t load the pose model: Out of memory');
    expect(msg({ saved: true, error: {} })).toBe('Couldn’t load the pose model. Try again.');
  });
  it('recognises failed downloads', () => {
    expect(looksLikeNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(looksLikeNetworkError(new Error('Aborted(both async and sync fetching of the wasm failed)'))).toBe(true);
    expect(looksLikeNetworkError(new TypeError('x is undefined'))).toBe(false);
  });
});

describe('when an update applies by itself', () => {
  const can = (o: Partial<Parameters<typeof canApplyUpdate>[0]>) => canApplyUpdate({ hash: '#/', activeWorkout: false, typing: false, sinceLaunchMs: 2000, ...o });

  it('only just after the app opens, on a screen where a reload loses nothing', () => {
    for (const hash of ['', '#/', '#/log', '#/library', '#/settings', '#/exercise/back-squat', '#/session/w1', '#/progress/back-squat', '#/set/s1', '#/privacy'])
      expect(can({ hash })).toBe(true);
    expect(can({ sinceLaunchMs: LAUNCH_WINDOW_MS + 1 })).toBe(false);
  });
  it('never during a technique check or the camera test', () => {
    expect(can({ hash: '#/analyze/back-squat' })).toBe(false);
    expect(can({ hash: '#/analyze/back-squat?calibrate' })).toBe(false);
    expect(can({ hash: '#/camera' })).toBe(false);
    expect(can({ hash: '#/dev/calibrate' })).toBe(false);
  });
  it('never while a workout is logged or edited, or a form is being filled in', () => {
    for (const hash of ['#/workout', '#/edit/w1', '#/edit/new?date=2026-11-20', '#/routine/new', '#/profile?setup', '#/groups', '#/build'])
      expect(can({ hash })).toBe(false);
    expect(can({ activeWorkout: true })).toBe(false);
    expect(can({ typing: true })).toBe(false);
  });
});
