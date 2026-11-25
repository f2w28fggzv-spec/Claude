// Pure helpers for the app side of offline use: what Settings says about
// installing and offline use, the message when the pose model can't load,
// whether the app may save the pose model by itself, and when a new version
// may apply by itself. Tested in tests/offline-state.test.ts.
import { NO_ROOM_RETRY_MS, poseFilesFor, unkeptRecently, type PoseVariant } from './manifest';
import type { WorkerStatus } from './worker';

export { NO_ROOM_RETRY_MS };

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
 * Why the pose model isn't saved: the last try's download failed (most
 * likely the connection), the phone couldn't keep it (the browser refused to
 * store it, most likely for lack of space; the service worker remembers
 * that), or the site already serves a newer version of it (update first,
 * then save).
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
  /** Why the pose model isn't saved, when something went wrong. */
  problem?: SaveProblem;
  /** A new version has installed and is waiting. */
  updateReady: boolean;
  /** A new version couldn't install for lack of room on the phone: what it still needed, in bytes. */
  updateHeld?: number;
  /** The first save of the app failed for lack of room on the phone: what it still needed, in bytes. */
  installNoRoom?: number;
  online: boolean;
}

export type OfflineView =
  | { kind: 'off'; reason: OfflineOff }
  /** Waiting for the service worker to say what's saved. */
  | { kind: 'checking' }
  | { kind: 'saving-app' }
  /** The first save of the app failed: nothing is saved yet. `noRoomBytes`: it failed for lack of room, needing this much. */
  | { kind: 'app-failed'; online: boolean; noRoomBytes?: number }
  | { kind: 'saving-pose'; done: number; total: number }
  /**
   * The app is saved; the pose model isn't (yet). `poseBytes`: what saving it
   * downloads; `updateWaiting`: a new version waits (saving applies it
   * first); `updateHeld`: a new version couldn't install for lack of room.
   */
  | { kind: 'app-only'; poseBytes: number; problem?: SaveProblem; updateWaiting: boolean; updateHeld: boolean; online: boolean }
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

/**
 * When the phone last couldn't keep one of the pose files a technique check
 * needs (and it hasn't kept it since), from the service worker's status;
 * undefined if it could, or hasn't tried. The week without saving them by
 * itself runs from this.
 */
export function poseUnkeptAt(status: WorkerStatus | undefined, simd: boolean, variant: PoseVariant = 'full'): number | undefined {
  let at: number | undefined;
  for (const url of poseFilesFor(simd, variant)) {
    const p = status?.pose.find((x) => x.url === url);
    if (p && !p.saved && typeof p.unkeptAt === 'number' && (at === undefined || p.unkeptAt > at)) at = p.unkeptAt;
  }
  return at;
}

/** What the offline row in Settings shows. */
export function offlineView(f: OfflineFacts): OfflineView {
  if (f.off) return { kind: 'off', reason: f.off };
  const s = f.status;
  if (!s) {
    if (f.worker === 'failed') return f.installNoRoom === undefined ? { kind: 'app-failed', online: f.online } : { kind: 'app-failed', online: f.online, noRoomBytes: f.installNoRoom };
    return f.worker === 'installing' ? { kind: 'saving-app' } : { kind: 'checking' };
  }
  if (s.app.saved < s.app.files) return { kind: 'saving-app' };
  if (f.saving) return { kind: 'saving-pose', done: f.saving.done, total: f.saving.total };
  if (!poseSaved(s, f.simd)) {
    const poseBytes = poseToSave(s, f.simd).reduce((n, p) => n + p.size, 0);
    return { kind: 'app-only', poseBytes, problem: f.problem, updateWaiting: f.updateReady, updateHeld: f.updateHeld !== undefined, online: f.online };
  }
  return { kind: 'ready', bytes: s.app.bytes + s.pose.filter((p) => p.saved).reduce((n, p) => n + p.size, 0) };
}

/** The heading of the offline row when the app is saved but the pose model isn't: the problem, if there is one. */
export const appOnlyHeading = (v: { problem?: SaveProblem }) => (v.problem ? 'The pose model isn’t saved' : 'The app works offline');

/**
 * What the offline row says when the app is saved but the pose model isn't.
 * With a new version waiting, the button is “Update and save”, and the
 * words point to it; the new version itself is announced once, in its own
 * row (“A new version is ready”).
 */
export function appOnlyMessage(v: { poseBytes: number; problem?: SaveProblem; updateWaiting?: boolean; updateHeld?: boolean }): string {
  const then = v.updateWaiting ? 'then tap Update and save' : 'then try again';
  switch (v.problem) {
    case 'no-room':
      return `This phone couldn’t keep the pose model (${formatMB(v.poseBytes)}), most likely for lack of space. Free up some space, ${then}.`;
    case 'newer':
      if (v.updateWaiting) return 'The new version has a new pose model: tap Update and save to get it.';
      if (v.updateHeld) return 'The new version has a new pose model, and it needs more space on this phone first. Free up some space, then try again.';
      return 'The pose model has changed online, but the new version of fitee isn’t on this phone yet. Try again in a few minutes.';
    case 'failed':
      return `Couldn’t save the pose model. Check your connection, ${then}.`;
    default:
      return `Technique checks need the pose model. Save it (${formatMB(v.poseBytes)}) to check your technique with no signal.`;
  }
}

/** What the offline row says when the first save of the app failed. */
export function appFailedMessage(v: { online: boolean; noRoomBytes?: number }): string {
  if (v.noRoomBytes !== undefined)
    return `This phone couldn’t keep it (${formatMB(v.noRoomBytes)}), most likely for lack of space. Free up some space, then try again.`;
  return v.online
    ? 'The connection may have dropped. Try again, or it tries by itself the next time you open fitee.'
    : 'It tries again when you’re back online. Until then, fitee needs a connection to open.';
}

/** A new version that couldn't install for lack of room (its own row in Settings, with Try again). */
export const UPDATE_HELD_HEADING = 'A new version needs more space';
export const updateHeldMessage = (bytes: number) =>
  `It needs about ${formatMB(bytes)} more on this phone. Until then this version keeps working, offline too. Free up some space, then try again.`;

/**
 * The save button: "Update and save" whenever a new version is waiting (it
 * applies first, then saves its files), else "Try again" after a problem,
 * else "Save for offline use".
 */
export function saveButtonLabel(v: { problem?: SaveProblem; updateWaiting: boolean }): string {
  if (v.updateWaiting) return 'Update and save';
  return v.problem ? 'Try again' : 'Save for offline use';
}

/**
 * Whether an app opened from the home screen may save the pose model by
 * itself now: online, once the terms (which describe it) are accepted, not
 * when the browser reports Data Saver, and not for a week after the phone
 * couldn't keep it (`noRoomAt`, from `poseUnkeptAt`: so a full phone doesn't
 * download it at every launch; a time from a clock that has since been put
 * back doesn't hold it back). Settings offers it otherwise.
 */
export function mayAutoSave(o: { standalone: boolean; online: boolean; saveData: boolean; termsAccepted: boolean; noRoomAt?: number; now: number }): boolean {
  if (!o.standalone || !o.online || o.saveData || !o.termsAccepted) return false;
  return !unkeptRecently(o.noRoomAt, o.now);
}

/**
 * Megabytes for people: "0.9 MB", "24 MB" (with a no-break space, so the unit
 * stays with its number). Never "0.0 MB" for something: at least "0.1 MB".
 */
export function formatMB(bytes: number): string {
  const mb = bytes > 0 ? Math.max(bytes / 1e6, 0.1) : 0;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}\u00a0MB`;
}

export const POSE_NOT_SAVED =
  'The pose model isn’t saved on this phone yet. Connect to the internet and keep fitee open while it loads; after that, technique checks work offline.';
/** The phone couldn't keep the pose model: staying online with fitee open won't save it there. */
export const POSE_NOT_KEPT =
  'This phone couldn’t keep the pose model (most likely for lack of space), so technique checks need a connection here. Free up some space, then save it in Settings.';
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
 * showing a raw error: that it isn't saved yet, or, where the phone couldn't
 * keep it, that technique checks need a connection there; where people
 * choose the model (the camera test) and the other one is saved, it says to
 * choose that.
 */
export function modelErrorMessage(o: {
  online: boolean;
  saved: boolean;
  offlineAvailable: boolean;
  error: unknown;
  /** The model that didn't load, and another that is saved, when people can choose (the camera test). */
  choice?: { variant: PoseVariant; saved: PoseVariant };
  /** The phone couldn't keep the model's files (the service worker says so). */
  notKept?: boolean;
}): string {
  if (!o.saved && (!o.online || looksLikeNetworkError(o.error))) {
    if (!o.offlineAvailable) return POSE_NEEDS_CONNECTION;
    if (o.choice) return variantNotSaved(o.choice.variant, o.choice.saved);
    return o.notKept ? POSE_NOT_KEPT : POSE_NOT_SAVED;
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
