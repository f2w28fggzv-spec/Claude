// Pure helpers for the app side of offline use: what Settings says about
// installing and offline use, the message when the pose model can't load,
// whether the app may save the pose model by itself, and when a new version
// may apply by itself. Tested in tests/offline-state.test.ts.
import { poseFilesFor, type PoseVariant } from './manifest';
import type { WorkerStatus } from './worker';

/** How Settings helps people install the app. */
export type InstallHint =
  /** Running from the home screen, or installed this visit. */
  | 'installed'
  /** Chrome offers its install prompt: an "Install fitee" button. */
  | 'prompt'
  /** iPhone or iPad Safari: Share, then Add to Home Screen. */
  | 'ios-safari'
  /** Another browser on iPhone or iPad. */
  | 'ios-other'
  /** Anything else: a one-line hint. */
  | 'other';

export function installHint(f: { standalone: boolean; installed: boolean; canPrompt: boolean; userAgent: string; maxTouchPoints: number }): InstallHint {
  if (f.standalone || f.installed) return 'installed';
  if (f.canPrompt) return 'prompt';
  // iPadOS Safari presents itself as a Mac; a touch screen gives it away.
  const ios = /iPhone|iPad|iPod/.test(f.userAgent) || (/Macintosh/.test(f.userAgent) && f.maxTouchPoints > 1);
  if (!ios) return 'other';
  return /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|YaBrowser/.test(f.userAgent) ? 'ios-other' : 'ios-safari';
}

/** Why offline use is off. */
export type OfflineOff =
  /** Development server: the service worker is only registered in production builds. */
  | 'dev'
  /** Plain http (not localhost): browsers only run service workers on secure pages. */
  | 'insecure'
  /** No service worker support (e.g. some private browsing modes). */
  | 'unsupported'
  /** The browser refused to register it. */
  | 'failed';

/**
 * The service worker, as far as the page knows: not known yet, saving the
 * app for the first time, running, or that first save failed (then the
 * browser drops it, and nothing is saved until the app registers it again).
 */
export type WorkerState = 'unknown' | 'installing' | 'active' | 'failed';

/**
 * Why the pose model isn't saved after a try: the download failed (most
 * likely the connection), the phone couldn't keep it (the browser refused to
 * store it, most likely for lack of space), or the site already serves a
 * newer version of it (update first, then save).
 */
export type SaveProblem = 'failed' | 'no-room' | 'newer';

export interface OfflineFacts {
  off?: OfflineOff;
  worker: WorkerState;
  /** What the service worker reports as saved (unknown until it answers). */
  status?: WorkerStatus;
  /** Whether this browser runs MediaPipe's SIMD runtime (decides which runtime to save). */
  simd: boolean;
  saving?: { done: number; total: number };
  /** Why the last try didn't save the pose model (or that a technique check couldn't keep it). */
  problem?: SaveProblem;
  /** A new version has installed and is waiting. */
  updateReady: boolean;
  online: boolean;
}

export type OfflineView =
  | { kind: 'off'; reason: OfflineOff }
  /** Waiting for the service worker to say what's saved. */
  | { kind: 'checking' }
  | { kind: 'saving-app' }
  /** The first save of the app failed: nothing is saved yet. */
  | { kind: 'app-failed'; online: boolean }
  | { kind: 'saving-pose'; done: number; total: number }
  /**
   * The app is saved; the pose model isn't (yet). `poseBytes`: what saving it
   * downloads; `updateWaiting`: a new version waits (saving applies it first).
   */
  | { kind: 'app-only'; poseBytes: number; problem?: SaveProblem; updateWaiting: boolean; online: boolean }
  | { kind: 'ready'; bytes: number };

/** Whether the pose files one technique check needs are saved (the default full model unless given). */
export function poseSaved(status: WorkerStatus | undefined, simd: boolean, variant: PoseVariant = 'full'): boolean {
  if (!status) return false;
  return poseFilesFor(simd, variant).every((url) => status.pose.some((p) => p.url === url && p.saved));
}

/** The pose files a technique check needs that aren't saved yet, and their size. */
export function poseToSave(status: WorkerStatus | undefined, simd: boolean): { url: string; size: number }[] {
  const wanted = poseFilesFor(simd, 'full');
  return (status?.pose ?? []).filter((p) => wanted.includes(p.url) && !p.saved);
}

/** What the offline row in Settings shows. */
export function offlineView(f: OfflineFacts): OfflineView {
  if (f.off) return { kind: 'off', reason: f.off };
  const s = f.status;
  if (!s) return f.worker === 'failed' ? { kind: 'app-failed', online: f.online } : f.worker === 'installing' ? { kind: 'saving-app' } : { kind: 'checking' };
  if (s.app.saved < s.app.files) return { kind: 'saving-app' };
  if (f.saving) return { kind: 'saving-pose', done: f.saving.done, total: f.saving.total };
  if (!poseSaved(s, f.simd)) {
    const poseBytes = poseToSave(s, f.simd).reduce((n, p) => n + p.size, 0);
    return { kind: 'app-only', poseBytes, problem: f.problem, updateWaiting: f.updateReady, online: f.online };
  }
  return { kind: 'ready', bytes: s.app.bytes + s.pose.filter((p) => p.saved).reduce((n, p) => n + p.size, 0) };
}

/** What the offline row says when the app is saved but the pose model isn't. */
export function appOnlyMessage(v: { poseBytes: number; problem?: SaveProblem }): string {
  switch (v.problem) {
    case 'no-room':
      return `This phone couldn’t keep the pose model (${formatMB(v.poseBytes)}), most likely for lack of space. Free up some space, then try again.`;
    case 'newer':
      return 'A new version of fitee is out. Update it, then save the pose model.';
    case 'failed':
      return 'Couldn’t save the pose model. Check your connection and try again.';
    default:
      return `Technique checks need the pose model. Save it (${formatMB(v.poseBytes)}) to check your technique with no signal.`;
  }
}

/**
 * The save button: "Update and save" whenever a new version is waiting (it
 * applies first, then saves its files), else "Try again" after a problem,
 * else "Save for offline use".
 */
export function saveButtonLabel(v: { problem?: SaveProblem; updateWaiting: boolean }): string {
  if (v.updateWaiting) return 'Update and save';
  return v.problem ? 'Try again' : 'Save for offline use';
}

/** After the phone couldn't keep the pose model, the app doesn't try again by itself for this long. */
export const NO_ROOM_RETRY_MS = 7 * 24 * 60 * 60_000;

/**
 * Whether an app opened from the home screen may save the pose model by
 * itself now: online, once the terms (which describe it) are accepted, not
 * when the browser reports Data Saver, and not for a week after the phone
 * couldn't keep it (so a full phone doesn't download it at every launch).
 * Settings offers it otherwise.
 */
export function mayAutoSave(o: { standalone: boolean; online: boolean; saveData: boolean; termsAccepted: boolean; noRoomAt?: number; now: number }): boolean {
  if (!o.standalone || !o.online || o.saveData || !o.termsAccepted) return false;
  return o.noRoomAt === undefined || noRoomSince(o.noRoomAt, o.now) !== o.noRoomAt;
}

/**
 * When that week starts: at the first time the phone couldn't keep the pose
 * model. Later failures within the week (every status while the worker runs
 * says so again) don't push it back; one after it has run out (or a time
 * from a clock that has since been put back) starts a new week.
 */
export function noRoomSince(previous: number | undefined, now: number): number {
  return previous !== undefined && now >= previous && now - previous < NO_ROOM_RETRY_MS ? previous : now;
}

/** Megabytes for people: "0.9 MB", "24 MB". */
export function formatMB(bytes: number): string {
  const mb = bytes / 1e6;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export const POSE_NOT_SAVED =
  'The pose model isn’t saved on this phone yet. Connect to the internet and keep fitee open while it loads; after that, technique checks work offline.';
export const POSE_NEEDS_CONNECTION = 'Couldn’t load the pose model. Technique checks need an internet connection in this browser.';

const VARIANT_NAME: Record<PoseVariant, string> = { lite: 'Lite', full: 'Full' };

/** A model that isn't saved when the other one is (the camera test, where people choose). */
export const variantNotSaved = (variant: PoseVariant, saved: PoseVariant) =>
  `The ${VARIANT_NAME[variant]} model isn’t saved on this phone, but the ${VARIANT_NAME[saved]} one is: choose ${VARIANT_NAME[saved]}, or connect to the internet to load ${VARIANT_NAME[variant]}.`;

/** A failed download: fetch's TypeError, a script that didn't load (an Event), or MediaPipe's wording for either. */
export function looksLikeNetworkError(err: unknown): boolean {
  if (typeof Event !== 'undefined' && err instanceof Event) return true;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /fetch|network|load failed|failed to load|internet/i.test(message);
}

/**
 * What a technique check says when the pose model won't load. Offline (or on
 * a failed download) without the model saved, it says so plainly instead of
 * showing a raw error; where people choose the model (the camera test) and
 * the other one is saved, it says to choose that.
 */
export function modelErrorMessage(o: {
  online: boolean;
  saved: boolean;
  offlineAvailable: boolean;
  error: unknown;
  /** The model that didn't load, and another that is saved, when people can choose (the camera test). */
  choice?: { variant: PoseVariant; saved: PoseVariant };
}): string {
  if (!o.saved && (!o.online || looksLikeNetworkError(o.error))) {
    if (!o.offlineAvailable) return POSE_NEEDS_CONNECTION;
    return o.choice ? variantNotSaved(o.choice.variant, o.choice.saved) : POSE_NOT_SAVED;
  }
  const detail = o.error instanceof Error ? o.error.message : typeof o.error === 'string' ? o.error : '';
  return detail ? `Couldn’t load the pose model: ${detail}` : 'Couldn’t load the pose model. Try again.';
}

/**
 * Screens where reloading would interrupt something: a technique check or
 * the camera test, a workout being logged or edited, a routine, the profile
 * or a plan being made, and the hidden developer pages.
 */
const BUSY_SCREENS = new Set(['analyze', 'camera', 'workout', 'edit', 'routine', 'profile', 'groups', 'build', 'dev']);
/** A new version found this soon after the app opens may apply by itself. */
export const LAUNCH_WINDOW_MS = 15_000;
/** Coming back after this long counts as opening the app again. */
export const RESUME_AFTER_MS = 30 * 60_000;

/**
 * Whether a waiting version may apply by itself now (a quick reload): only
 * just after the app opened, never on a busy screen, never while a workout
 * is in progress, never while typing. Otherwise it waits for "Update now" in
 * Settings or the next time the app opens.
 */
export function canApplyUpdate(o: { hash: string; activeWorkout: boolean; typing: boolean; sinceLaunchMs: number }): boolean {
  const screen = o.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return !BUSY_SCREENS.has(screen) && !o.activeWorkout && !o.typing && o.sinceLaunchMs < LAUNCH_WINDOW_MS;
}
