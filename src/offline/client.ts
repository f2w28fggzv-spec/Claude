// The app side of offline use. In production builds it registers the
// service worker (sw.js), keeps what Settings shows up to date, saves the
// pose files when asked (or by itself in an app opened from the home screen),
// and applies a new version only at a safe moment. It only talks to this
// site: the service worker, and the site's own pose files.
//
// Nothing runs when this module is imported; main.tsx calls startOffline().
import { FilesetResolver } from '@mediapipe/tasks-vision';
import { useEffect, useState } from 'preact/hooks';
import { loadActiveWorkout } from '../log/store';
import { poseFilesFor, type PoseVariant } from './manifest';
import { canApplyUpdate, poseSaved, RESUME_AFTER_MS, type OfflineOff } from './state';
import type { ToWorker, WorkerStatus } from './worker';

/** Chrome's install prompt (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface OfflineInfo {
  /** Why offline use is off, when it is. */
  off?: OfflineOff;
  /** What the service worker has saved (unknown until it answers). */
  status?: WorkerStatus;
  /** Whether this browser runs the SIMD pose runtime (decides which runtime is saved). */
  simd: boolean;
  /** Pose files being saved: bytes so far and in all. */
  saving?: { done: number; total: number };
  saveFailed: boolean;
  /** A new version has installed and is waiting. */
  updateReady: boolean;
  updating: boolean;
  online: boolean;
  /** Running as an installed app (home screen). */
  standalone: boolean;
  /** Installed from this page during this visit. */
  installed: boolean;
  /** Chrome's install prompt is available. */
  canPrompt: boolean;
}

type Nav = Navigator & { standalone?: boolean; connection?: { saveData?: boolean } };
const nav = () => navigator as Nav;

/** Opened from the home screen (or as an installed app on a computer). */
export function isStandalone(): boolean {
  try {
    if (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches) return true;
  } catch {
    // No matchMedia: fall through to Safari's flag.
  }
  return nav().standalone === true;
}

let info: OfflineInfo = { simd: true, saveFailed: false, updateReady: false, updating: false, online: true, standalone: false, installed: false, canPrompt: false };
const listeners = new Set<() => void>();

function set(patch: Partial<OfflineInfo>): void {
  info = { ...info, ...patch };
  for (const l of listeners) l();
}

/** The current state (for code outside components). */
export const offlineInfo = (): OfflineInfo => info;

/** The current state, re-rendering the component when it changes. */
export function useOffline(): OfflineInfo {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return info;
}

/** Whether the pose files for a technique check with this model are saved. */
export const poseFilesSaved = (variant: PoseVariant) => poseSaved(info.status, info.simd, variant);
/** Whether this browser can keep the app offline at all. */
export const offlineAvailable = () => !info.off;

let registration: ServiceWorkerRegistration | undefined;
let installPrompt: InstallPromptEvent | undefined;
let simdKnown: Promise<boolean> = Promise.resolve(true);
let launchedAt = 0;
let hiddenAt = 0;
let lastUpdateCheck = 0;
let reloadWhenActive = false;
let autoSaveTried = false;
let persistAsked = false;
/** How often to look for a new version while the app stays open. */
const UPDATE_CHECK_MS = 60 * 60_000;

export function startOffline(): void {
  launchedAt = performance.now();
  lastUpdateCheck = Date.now(); // the browser checks for a new version when the app opens
  set({ online: navigator.onLine, standalone: isStandalone() });
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep Chrome's prompt for the "Install fitee" button in Settings.
    e.preventDefault();
    installPrompt = e as InstallPromptEvent;
    set({ canPrompt: true });
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = undefined;
    set({ canPrompt: false, installed: true });
  });
  window.addEventListener('online', () => {
    set({ online: true });
    void refresh();
  });
  window.addEventListener('offline', () => set({ online: false }));
  document.addEventListener('visibilitychange', onVisibility);
  try {
    matchMedia('(display-mode: standalone)').addEventListener('change', () => set({ standalone: isStandalone() }));
  } catch {
    // Older browsers: the value from startup stays.
  }
  // MediaPipe loads its SIMD runtime when the browser supports it, else the no-SIMD one.
  simdKnown = FilesetResolver.isSimdSupported().catch(() => true);
  void simdKnown.then((simd) => set({ simd }));

  const off: OfflineOff | undefined = !import.meta.env.PROD
    ? 'dev'
    : !window.isSecureContext
      ? 'insecure'
      : !('serviceWorker' in navigator)
        ? 'unsupported'
        : undefined;
  if (off) return set({ off });
  // After the page has loaded, so saving the app doesn't slow its first start.
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}

async function register(): Promise<void> {
  const sw = navigator.serviceWorker;
  try {
    registration = await sw.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' });
  } catch {
    return set({ off: 'failed' });
  }
  const reg = registration;
  sw.addEventListener('controllerchange', () => {
    if (reloadWhenActive) {
      reloadWhenActive = false;
      location.reload();
    } else void refresh();
  });
  const watch = (worker: ServiceWorker | null) =>
    worker?.addEventListener('statechange', () => {
      // "installed" with a page already controlled = an update, waiting.
      if (worker.state === 'installed' && sw.controller) onUpdateReady();
      if (worker.state === 'activated') void refresh();
    });
  watch(reg.installing);
  reg.addEventListener('updatefound', () => watch(reg.installing));
  if (reg.waiting && sw.controller) onUpdateReady();
  void refresh();
}

const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** A new version is waiting: apply it now if that's safe, else offer it in Settings. */
function onUpdateReady(): void {
  set({ updateReady: true });
  const safe = canApplyUpdate({
    hash: location.hash,
    activeWorkout: loadActiveWorkout() !== null,
    typing: typing(),
    sinceLaunchMs: performance.now() - launchedAt,
  });
  if (safe) applyUpdate(false);
}

/**
 * Switches to the waiting version and reloads once it's in charge.
 * `byUser`: from "Update now" (also reloads if the switch takes too long).
 */
export function applyUpdate(byUser = true): void {
  const waiting = registration?.waiting;
  if (!waiting) return set({ updateReady: false, updating: false });
  reloadWhenActive = true;
  set({ updating: true });
  waiting.postMessage({ type: 'skip-waiting' } satisfies ToWorker);
  setTimeout(() => {
    if (!reloadWhenActive) return;
    // The switch didn't happen (e.g. an even newer version replaced it).
    // From the button, reload anyway; by itself, stand down, so a later
    // switch can't reload the page in the middle of something.
    if (byUser) location.reload();
    else {
      reloadWhenActive = false;
      set({ updating: false });
    }
  }, 5000);
}

function onVisibility(): void {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  const away = hiddenAt ? Date.now() - hiddenAt : 0;
  // Back after a long time: like opening the app again.
  if (away >= RESUME_AFTER_MS) launchedAt = performance.now();
  if (registration && navigator.onLine && Date.now() - lastUpdateCheck > UPDATE_CHECK_MS) {
    lastUpdateCheck = Date.now();
    void registration.update().catch(() => {});
  }
  if (info.updateReady && away >= RESUME_AFTER_MS) onUpdateReady();
}

/** Asks the service worker something; undefined if it doesn't answer in time. */
function ask<T>(msg: ToWorker, timeoutMs: number): Promise<T | undefined> {
  const target = navigator.serviceWorker?.controller ?? registration?.active;
  if (!target) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data as T);
    };
    target.postMessage(msg, [channel.port2]);
  });
}

/** Updates what's saved, from the service worker (Settings calls it when it opens). */
export const refreshOffline = () => refresh();

async function refresh(timeoutMs = 5000): Promise<void> {
  if (info.off) return;
  const status = await ask<WorkerStatus>({ type: 'status' }, timeoutMs);
  if (status) set({ status });
  maybeAutoSave();
}

/**
 * Installed apps save the pose model by themselves on their first launch
 * online (an iPhone home-screen app has its own storage, apart from Safari).
 * Not with Data Saver on: then Settings offers it instead.
 */
function maybeAutoSave(): void {
  if (autoSaveTried || !info.standalone || !navigator.onLine || nav().connection?.saveData) return;
  if (!info.status || !navigator.serviceWorker?.controller) return;
  autoSaveTried = true;
  void simdKnown.then((simd) => {
    if (poseSaved(info.status, simd)) void persist();
    else setTimeout(() => void savePoseFiles(), 1500);
  });
}

/**
 * Saves the pose runtime this browser uses and the default (full) model:
 * each file is loaded through the service worker, which keeps a copy. Shows
 * progress in Settings.
 */
export async function savePoseFiles(): Promise<void> {
  if (info.saving || !info.status || !navigator.serviceWorker?.controller) return;
  const simd = await simdKnown;
  const wanted = poseFilesFor(simd, 'full');
  const todo = info.status.pose.filter((p) => wanted.includes(p.url) && !p.saved);
  if (!todo.length) return;
  const total = todo.reduce((n, p) => n + p.size, 0);
  let done = 0;
  let shownAt = 0;
  set({ saving: { done, total }, saveFailed: false });
  try {
    for (const file of todo) {
      const res = await fetch(new URL(file.url, document.baseURI).href);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        done += chunk.value.byteLength;
        if (performance.now() - shownAt > 150) {
          shownAt = performance.now();
          set({ saving: { done, total } });
        }
      }
    }
    set({ saving: { done: total, total } });
    // The worker checks each file against its hash before keeping it.
    await refresh(30_000);
    const ok = poseSaved(info.status, simd);
    set({ saving: undefined, saveFailed: !ok });
    if (ok) void persist();
  } catch {
    set({ saving: undefined, saveFailed: true });
    void refresh();
  }
}

/** In an installed app, asks the browser to keep the saved files even when space runs low. */
async function persist(): Promise<void> {
  if (persistAsked || !info.standalone || !navigator.storage?.persist) return;
  persistAsked = true;
  try {
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // A request: the browser may say no.
  }
}

/** Shows Chrome's install prompt (the "Install fitee" button). */
export async function promptInstall(): Promise<void> {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = undefined;
  set({ canPrompt: false });
  try {
    await prompt.prompt();
    if ((await prompt.userChoice).outcome === 'accepted') set({ installed: true });
  } catch {
    // Dismissed or unavailable: Chrome may offer it again later.
  }
}
