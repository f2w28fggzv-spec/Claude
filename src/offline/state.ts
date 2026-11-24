// Pure helpers for the app side of offline use: what Settings says about
// installing and offline use, the message when the pose model can't load,
// and when a new version may apply by itself. Tested in tests/offline.test.ts.
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

export interface OfflineFacts {
  off?: OfflineOff;
  /** What the service worker reports as saved (unknown until it answers). */
  status?: WorkerStatus;
  /** Whether this browser runs MediaPipe's SIMD runtime (decides which runtime to save). */
  simd: boolean;
  saving?: { done: number; total: number };
  saveFailed: boolean;
  online: boolean;
}

export type OfflineView =
  | { kind: 'off'; reason: OfflineOff }
  | { kind: 'saving-app' }
  | { kind: 'saving-pose'; done: number; total: number }
  /** The app is saved; the pose model isn't (yet). */
  | { kind: 'app-only'; poseBytes: number; failed: boolean; online: boolean }
  | { kind: 'ready'; bytes: number };

/** Whether the pose files one technique check needs are saved (the default full model unless given). */
export function poseSaved(status: WorkerStatus | undefined, simd: boolean, variant: PoseVariant = 'full'): boolean {
  if (!status) return false;
  return poseFilesFor(simd, variant).every((url) => status.pose.some((p) => p.url === url && p.saved));
}

/** What the offline row in Settings shows. */
export function offlineView(f: OfflineFacts): OfflineView {
  if (f.off) return { kind: 'off', reason: f.off };
  const s = f.status;
  if (!s || s.app.saved < s.app.files) return { kind: 'saving-app' };
  if (f.saving) return { kind: 'saving-pose', done: f.saving.done, total: f.saving.total };
  const wanted = poseFilesFor(f.simd, 'full');
  const poseBytes = s.pose.filter((p) => wanted.includes(p.url)).reduce((n, p) => n + p.size, 0);
  if (!poseSaved(s, f.simd)) return { kind: 'app-only', poseBytes, failed: f.saveFailed, online: f.online };
  return { kind: 'ready', bytes: s.app.bytes + s.pose.filter((p) => p.saved).reduce((n, p) => n + p.size, 0) };
}

/** Megabytes for people: "0.9 MB", "24 MB". */
export function formatMB(bytes: number): string {
  const mb = bytes / 1e6;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export const POSE_NOT_SAVED = 'The pose model isn’t saved on this phone yet. Connect to the internet once, then technique checks work offline.';
export const POSE_NEEDS_CONNECTION = 'Couldn’t load the pose model. Technique checks need an internet connection in this browser.';

/** A failed download: fetch's TypeError, a script that didn't load (an Event), or MediaPipe's wording for either. */
export function looksLikeNetworkError(err: unknown): boolean {
  if (typeof Event !== 'undefined' && err instanceof Event) return true;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /fetch|network|load failed|failed to load|internet/i.test(message);
}

/**
 * What a technique check says when the pose model won't load. Offline (or on
 * a failed download) without the model saved, it says so plainly instead of
 * showing a raw error.
 */
export function modelErrorMessage(o: { online: boolean; saved: boolean; offlineAvailable: boolean; error: unknown }): string {
  if (!o.saved && (!o.online || looksLikeNetworkError(o.error))) return o.offlineAvailable ? POSE_NOT_SAVED : POSE_NEEDS_CONNECTION;
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
