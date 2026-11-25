// The app side of offline use (src/offline/state.ts): install hints, what the
// offline row in Settings shows (its problem, heading, message and button),
// a new version that needs more room, the pose-model message, when the app
// saves the pose model by itself and when an update may apply by itself.
import { describe, expect, it } from 'vitest';
import {
  appFailedMessage,
  appOnlyHeading,
  appOnlyMessage,
  canApplyUpdate,
  formatMB,
  installHint,
  LAUNCH_WINDOW_MS,
  looksLikeNetworkError,
  mayAutoSave,
  modelErrorMessage,
  NO_ROOM_RETRY_MS,
  offlineView,
  POSE_NEEDS_CONNECTION,
  POSE_NOT_KEPT,
  POSE_NOT_SAVED,
  poseSaved,
  poseToSave,
  poseUnkeptAt,
  saveButtonLabel,
  UPDATE_HELD_HEADING,
  updateHeldMessage,
  variantNotSaved,
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
  noRoom: false,
  newer: false,
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
/** "24 MB", with the no-break space formatMB puts between the number and the unit. */
const MB = (n: string) => `${n}\u00a0MB`;
const NOSIMD_FULL = ['pose_landmarker_full.task', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];

describe('offline state', () => {
  const view = (o: Partial<OfflineFacts>) => offlineView({ worker: 'active', simd: true, updateReady: false, online: true, ...o });

  it('is off without a service worker, saying why', () => {
    expect(view({ off: 'unsupported' })).toEqual({ kind: 'off', reason: 'unsupported' });
    expect(view({ off: 'dev', status: status(SIMD_FULL) })).toEqual({ kind: 'off', reason: 'dev' });
  });
  it('is saving the app while the first version installs, until every file of it is saved', () => {
    expect(view({ worker: 'installing' })).toEqual({ kind: 'saving-app' });
    expect(view({ status: status([], 2) })).toEqual({ kind: 'saving-app' });
  });
  it('is only checking, not saving, while a running service worker hasn’t answered yet', () => {
    expect(view({})).toEqual({ kind: 'checking' });
    expect(view({ worker: 'unknown' })).toEqual({ kind: 'checking' });
  });
  it('says so when saving the app failed, instead of saving forever, and why when the phone had no room for it', () => {
    expect(view({ worker: 'failed' })).toEqual({ kind: 'app-failed', online: true });
    expect(view({ worker: 'failed', online: false })).toEqual({ kind: 'app-failed', online: false });
    expect(view({ worker: 'failed', installNoRoom: 716_727 })).toEqual({ kind: 'app-failed', online: true, noRoomBytes: 716_727 });
    expect(appFailedMessage({ online: true })).toBe('The connection may have dropped. Try again, or it tries by itself the next time you open fitee.');
    expect(appFailedMessage({ online: false })).toBe('It tries again when you’re back online. Until then, fitee needs a connection to open.');
    // Not the connection: the phone had no room (it isn't retried by itself on every return to the app).
    for (const online of [true, false])
      expect(appFailedMessage({ online, noRoomBytes: 716_727 })).toBe(
        `This phone couldn’t keep it (${MB('0.7')}), most likely for lack of space. Free up some space, then try again.`,
      );
    // The browser wouldn't even register it (Chromium on a nearly full disk): no size known, and no Try again promised.
    expect(view({ worker: 'failed', installNoRoom: 0 })).toEqual({ kind: 'app-failed', online: true, noRoomBytes: 0 });
    for (const online of [true, false])
      expect(appFailedMessage({ online, noRoomBytes: 0 })).toBe(
        'This phone couldn’t keep it, most likely for lack of space. Free up some space; it tries again the next time you open fitee.',
      );
  });
  it('has the app but not the pose model, with what saving it downloads', () => {
    expect(view({ status: status([]) })).toEqual({ kind: 'app-only', poseBytes: 24_198_980, updateWaiting: false, updateHeld: false, online: true });
    expect(view({ status: status(['vision_wasm_internal.js']) })).toEqual({
      kind: 'app-only',
      poseBytes: 24_198_980 - 334_128,
      updateWaiting: false,
      updateHeld: false,
      online: true,
    });
    expect(view({ status: status([]), simd: false, problem: 'failed', online: false })).toEqual({
      kind: 'app-only',
      poseBytes: 22_647_530,
      problem: 'failed',
      updateWaiting: false,
      updateHeld: false,
      online: false,
    });
    // The no-SIMD runtime doesn't help a SIMD browser, and the lite model isn't the default.
    expect(view({ status: status([...NOSIMD_FULL, 'lite.task']) }).kind).toBe('app-only');
    expect(poseToSave(status(['full.task']), true).map((p) => p.url)).toEqual(['mediapipe/wasm/vision_wasm_internal.js', 'mediapipe/wasm/vision_wasm_internal.wasm']);
  });
  it('says why the last try didn’t save the pose model: the connection, a phone that couldn’t keep it, or a newer version on the site', () => {
    for (const problem of ['failed', 'no-room', 'newer'] as const)
      expect(view({ status: status([]), problem })).toEqual({ kind: 'app-only', poseBytes: 24_198_980, problem, updateWaiting: false, updateHeld: false, online: true });
    // Once it's saved (e.g. by a technique check), a problem from before doesn't show.
    expect(view({ status: status(SIMD_FULL), problem: 'no-room' }).kind).toBe('ready');
  });
  it('says when a new version is waiting (saving applies it first), or couldn’t install for lack of room', () => {
    expect(view({ status: status([]), updateReady: true })).toMatchObject({ kind: 'app-only', updateWaiting: true });
    expect(view({ status: status([]), updateReady: true, problem: 'newer' })).toMatchObject({ kind: 'app-only', updateWaiting: true, problem: 'newer' });
    expect(view({ status: status([]), updateHeld: 9_398_199 })).toMatchObject({ kind: 'app-only', updateWaiting: false, updateHeld: true });
  });
  it('words each problem, with the real size of what is missing, and names it in the heading', () => {
    expect(appOnlyHeading({})).toBe('The app works offline');
    for (const problem of ['failed', 'no-room', 'newer'] as const) expect(appOnlyHeading({ problem })).toBe('The pose model isn’t saved');
    expect(appOnlyMessage({ poseBytes: 24_198_980 })).toBe(`Technique checks need the pose model. Save it (${MB('24')}) to check your technique with no signal.`);
    expect(appOnlyMessage({ poseBytes: 23_864_852, problem: 'no-room' })).toBe(
      `This phone couldn’t keep the pose model (${MB('24')}), most likely for lack of space. Free up some space, then try again.`,
    );
    expect(appOnlyMessage({ poseBytes: 9_398_198, problem: 'no-room' })).toContain(`(${MB('9.4')})`);
    expect(appOnlyMessage({ poseBytes: 24_198_980, problem: 'failed' })).toBe('Couldn’t save the pose model. Check your connection, then try again.');
    // The site already serves a newer version, not on this phone yet: nothing to save until it is.
    expect(appOnlyMessage({ poseBytes: 24_198_980, problem: 'newer' })).toBe(
      'The pose model has changed online, but the new version of fitee isn’t on this phone yet. Try again in a few minutes.',
    );
    expect(appOnlyMessage({ poseBytes: 24_198_980, problem: 'newer', updateHeld: true })).toBe(
      'The new version has a new pose model, and it needs more space on this phone first. Free up some space, then try again.',
    );
  });
  it('with a new version waiting, points to the button there is (“Update and save”), and names the new version only in its own row', () => {
    expect(appOnlyMessage({ poseBytes: 24_198_980, problem: 'no-room', updateWaiting: true })).toBe(
      `This phone couldn’t keep the pose model (${MB('24')}), most likely for lack of space. Free up some space, then tap Update and save.`,
    );
    expect(appOnlyMessage({ poseBytes: 24_198_980, problem: 'failed', updateWaiting: true })).toBe(
      'Couldn’t save the pose model. Check your connection, then tap Update and save.',
    );
    expect(appOnlyMessage({ poseBytes: 24_198_980, problem: 'newer', updateWaiting: true })).toBe(
      'The new version has a new pose model: tap Update and save to get it.',
    );
    for (const problem of [undefined, 'failed', 'no-room', 'newer'] as const) {
      const text = appOnlyMessage({ poseBytes: 24_198_980, problem, updateWaiting: true });
      expect(text).not.toMatch(/is out|is ready|Update it/);
      expect(saveButtonLabel({ problem, updateWaiting: true })).toBe('Update and save');
      if (problem) expect(text).toMatch(/Update and save/);
    }
  });
  it('says how much free space a new version needs (all it writes: the estimate can’t show the shortfall)', () => {
    expect(UPDATE_HELD_HEADING).toBe('A new version needs more space');
    expect(updateHeldMessage(9_398_199)).toBe(
      `It needs about ${MB('9.4')} of free space on this phone. Until then this version keeps working, offline too. Free up some space, then try again.`,
    );
  });
  it('labels the button “Update and save” whenever a new version waits, else “Try again” after a problem, else “Save for offline use”', () => {
    expect(saveButtonLabel({ updateWaiting: false })).toBe('Save for offline use');
    for (const problem of ['failed', 'no-room', 'newer'] as const) {
      expect(saveButtonLabel({ updateWaiting: false, problem })).toBe('Try again');
      expect(saveButtonLabel({ updateWaiting: true, problem })).toBe('Update and save');
    }
    expect(saveButtonLabel({ updateWaiting: true })).toBe('Update and save');
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
  it('formats sizes for people, keeping the unit with its number', () => {
    expect(formatMB(906_000)).toBe(MB('0.9'));
    expect(formatMB(24_198_980)).toBe(MB('24'));
    expect(formatMB(25_098_980)).toBe(MB('25'));
    expect(formatMB(24_198_980)).not.toContain(' ');
    // Something small is never “0.0 MB”.
    expect(formatMB(21_000)).toBe(MB('0.1'));
    expect(formatMB(0)).toBe(MB('0.0'));
  });
  it('knows when the phone last couldn’t keep a file a technique check needs, from the worker', () => {
    const s = status([]);
    expect(poseUnkeptAt(s, true)).toBeUndefined();
    const at = (url: string, t: number) => (s.pose.find((p) => p.url.endsWith(url))!.unkeptAt = t);
    at('pose_landmarker_lite.task', 500); // not one the default check needs
    expect(poseUnkeptAt(s, true)).toBeUndefined();
    expect(poseUnkeptAt(s, true, 'lite')).toBe(500);
    at('vision_wasm_internal.wasm', 100);
    at('pose_landmarker_full.task', 300);
    expect(poseUnkeptAt(s, true)).toBe(300);
    expect(poseUnkeptAt(s, false)).toBe(300);
    // A file kept since doesn't count.
    s.pose.find((p) => p.url.endsWith('pose_landmarker_full.task'))!.saved = true;
    expect(poseUnkeptAt(s, true)).toBe(100);
    expect(poseUnkeptAt(undefined, true)).toBeUndefined();
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
    // Closing the app stops a save, so it says to keep it open.
    expect(POSE_NOT_SAVED).toBe(
      'The pose model isn’t saved on this phone yet. Connect to the internet and keep fitee open while it loads; after that, technique checks work offline.',
    );
  });
  it('says plainly where the phone couldn’t keep the model, instead of promising it will work offline', () => {
    expect(msg({ online: false, notKept: true })).toBe(POSE_NOT_KEPT);
    expect(msg({ notKept: true })).toBe(POSE_NOT_KEPT);
    expect(POSE_NOT_KEPT).toBe(
      'This phone couldn’t keep the pose model (most likely for lack of space), so technique checks need a connection here. Free up some space, then save it in Settings.',
    );
    expect(msg({ online: false, notKept: true, offlineAvailable: false })).toBe(POSE_NEEDS_CONNECTION);
    expect(msg({ online: false, notKept: true, choice: { variant: 'lite', saved: 'full' } })).toBe(variantNotSaved('lite', 'full'));
  });
  it('points to the saved model where people choose one (the camera test)', () => {
    expect(msg({ online: false, choice: { variant: 'lite', saved: 'full' } })).toBe(variantNotSaved('lite', 'full'));
    expect(variantNotSaved('lite', 'full')).toBe(
      'The Lite model isn’t saved on this phone, but the Full one is: choose Full, or connect to the internet to load Lite.',
    );
    expect(msg({ online: false, choice: { variant: 'lite', saved: 'full' }, offlineAvailable: false })).toBe(POSE_NEEDS_CONNECTION);
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

describe('when an installed app saves the pose model by itself', () => {
  const NOW = Date.UTC(2026, 10, 24);
  const may = (o: Partial<Parameters<typeof mayAutoSave>[0]>) =>
    mayAutoSave({ standalone: true, online: true, saveData: false, termsAccepted: true, now: NOW, ...o });

  it('only from the home screen, online, once the terms that describe it are accepted', () => {
    expect(may({})).toBe(true);
    expect(may({ standalone: false })).toBe(false);
    expect(may({ online: false })).toBe(false);
    expect(may({ termsAccepted: false })).toBe(false);
  });
  it('not where the browser reports Data Saver', () => {
    expect(may({ saveData: true })).toBe(false);
  });
  it('not again for a week after the phone couldn’t keep it, so a full phone doesn’t download it at every launch', () => {
    expect(may({ noRoomAt: NOW - 60_000 })).toBe(false);
    expect(may({ noRoomAt: NOW - NO_ROOM_RETRY_MS + 1 })).toBe(false);
    expect(may({ noRoomAt: NOW - NO_ROOM_RETRY_MS })).toBe(true);
  });
  it('a time from a clock that has since been put back doesn’t hold the app back for longer than a week', () => {
    expect(may({ noRoomAt: NOW + 60_000 })).toBe(true);
    expect(may({ noRoomAt: NOW + 3 * NO_ROOM_RETRY_MS })).toBe(true);
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
