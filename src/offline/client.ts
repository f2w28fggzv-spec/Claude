// The app side of offline use. In production builds it registers the
// service worker (sw.js), keeps what Settings shows up to date, saves the
// pose files when asked (or by itself in an app opened from the home screen),
// and applies a new version only at a safe moment. It only talks to this
// site: the service worker, and the site's own pose files.
//
// Nothing runs when this module is imported; main.tsx calls startOffline().
import { FilesetResolver } from '@mediapipe/tasks-vision';
import { useEffect, useState } from 'preact/hooks';
import { DEVICE_KEYS_PREFIX, loadActiveWorkout } from '../log/store';
import { loadProfile, termsAccepted } from '../profile';
import { showToast } from '../ui/toast';
import type { PoseVariant } from './manifest';
import { canApplyUpdate, mayAutoSave, poseSaved, poseToSave, RESUME_AFTER_MS, type OfflineOff, type WorkerState } from './state';
import type { ToWorker, WorkerStatus } from './worker';

/** Chrome's install prompt (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface OfflineInfo {
  /** Why offline use is off, when it is. */
  off?: OfflineOff;
  /** The service worker, as far as this page knows (e.g. whether saving the app failed). */
  worker: WorkerState;
  /** What the service worker has saved (unknown until it answers). */
  status?: WorkerStatus;
  /** Whether this browser runs the SIMD pose runtime (decides which runtime is saved). */
  simd: boolean;
  /** Pose files being saved: bytes so far and in all. */
  saving?: { done: number; total: number };
  saveFailed: boolean;
  /** The last try found no room on the phone for the pose model. */
  noRoom: boolean;
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

let info: OfflineInfo = {
  worker: 'unknown',
  simd: true,
  saveFailed: false,
  noRoom: false,
  updateReady: false,
  updating: false,
  online: true,
  standalone: false,
  installed: false,
  canPrompt: false,
};
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

/**
 * When a save last found no room on the phone for the pose model (about this
 * phone, not the user: deleted with all data, never in a backup). The app
 * doesn't save it by itself for a while after, so a full phone doesn't
 * download it at every launch.
 */
const NO_ROOM_KEY = `${DEVICE_KEYS_PREFIX}offlineNoRoom`;

function noRoomAt(): number | undefined {
  try {
    const at = Number(localStorage.getItem(NO_ROOM_KEY));
    return at > 0 ? at : undefined;
  } catch {
    return undefined;
  }
}

function noteNoRoom(noRoom: boolean): void {
  try {
    if (noRoom) localStorage.setItem(NO_ROOM_KEY, String(Date.now()));
    else localStorage.removeItem(NO_ROOM_KEY);
  } catch {
    // Storage blocked: only this visit knows.
  }
  set({ noRoom });
}

/** Whether the phone has room for this many more bytes, by the browser's own estimate (true when it can't tell). */
async function roomFor(bytes: number): Promise<boolean> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return estimate?.quota === undefined || estimate.usage === undefined || estimate.quota - estimate.usage >= bytes;
  } catch {
    return true;
  }
}

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
  set({
    online: navigator.onLine,
    standalone: isStandalone(),
    noRoom: noRoomAt() !== undefined,
    worker: navigator.serviceWorker?.controller ? 'active' : 'unknown',
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    // Kept for the "Install fitee" button in Settings. Not prevented, so
    // Chrome still offers its own install banner too.
    installPrompt = e as InstallPromptEvent;
    set({ canPrompt: true });
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = undefined;
    set({ canPrompt: false, installed: true });
  });
  window.addEventListener('online', () => {
    set({ online: true });
    // Saving the app failed (e.g. the connection dropped): try again now.
    if (info.worker === 'failed') retryOffline();
    else void refresh();
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
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadWhenActive) {
      reloadWhenActive = false;
      location.reload();
    } else void refresh();
  });
  // After the page has loaded, so saving the app doesn't slow its first start.
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });
}

let registering: Promise<void> | undefined;
const watched = new WeakSet<ServiceWorkerRegistration>();

/** Registers sw.js (again, after a failed first save: the browser drops a registration whose first install failed). */
function register(): Promise<void> {
  registering ??= registerNow().finally(() => (registering = undefined));
  return registering;
}

async function registerNow(): Promise<void> {
  const sw = navigator.serviceWorker;
  let reg: ServiceWorkerRegistration;
  try {
    reg = await sw.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' });
  } catch (err) {
    // Refused outright (the browser doesn't allow it here): off. Anything
    // else, e.g. no connection when sw.js was fetched: tried again later.
    return set((err as { name?: unknown } | null)?.name === 'SecurityError' ? { off: 'failed' } : { worker: 'failed' });
  }
  registration = reg;
  if (!watched.has(reg)) {
    watched.add(reg);
    watch(reg, reg.installing);
    reg.addEventListener('updatefound', () => watch(reg, reg.installing));
  }
  noteWorker(reg);
  if (reg.waiting && sw.controller) onUpdateReady();
  void refresh();
}

const alive = (w: ServiceWorker | null) => !!w && w.state !== 'redundant';

/**
 * What the registration says about the offline copy: running, being saved
 * for the first time, or that first save failed (no worker left alive).
 */
function noteWorker(reg: ServiceWorkerRegistration): void {
  const worker: WorkerState = alive(reg.active) ? 'active' : alive(reg.installing) || alive(reg.waiting) ? 'installing' : 'failed';
  if (worker !== info.worker) set({ worker });
}

function watch(reg: ServiceWorkerRegistration, worker: ServiceWorker | null): void {
  worker?.addEventListener('statechange', () => {
    // "installed" with a page already controlled = an update, waiting.
    if (worker.state === 'installed' && navigator.serviceWorker.controller) onUpdateReady();
    noteWorker(reg);
    if (worker.state === 'activated') void refresh();
  });
}

/** Saving the app for offline use failed: try again ("Try again" in Settings, or back online). */
export function retryOffline(): void {
  if (info.off || info.worker !== 'failed') return;
  set({ worker: 'installing' });
  void register();
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
  if (!waiting) {
    // Nothing waits any more: the new version already took over from another
    // window (this page still runs the old one), so a reload shows it.
    if (byUser && info.updateReady) return location.reload();
    return set({ updateReady: false, updating: false });
  }
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
  if (info.worker === 'failed' && navigator.onLine) return retryOffline();
  if (registration && navigator.onLine && Date.now() - lastUpdateCheck > UPDATE_CHECK_MS) {
    lastUpdateCheck = Date.now();
    void registration.update().catch(() => {});
  }
  if (info.updateReady && away >= RESUME_AFTER_MS) onUpdateReady();
}

/**
 * Asks the service worker something; undefined if it doesn't answer in time.
 * `late` gets an answer that comes after that (the worker answers a status
 * request once the downloads it's finishing have landed).
 */
function ask<T>(msg: ToWorker, timeoutMs: number, late?: (answer: T) => void): Promise<T | undefined> {
  const target = navigator.serviceWorker?.controller ?? registration?.active;
  if (!target) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      resolve(undefined);
    }, timeoutMs);
    channel.port1.onmessage = (e) => {
      if (timedOut) return late?.(e.data as T);
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
  const status = await ask<WorkerStatus>({ type: 'status' }, timeoutMs, (s) => void noteStatus(s));
  if (status) await noteStatus(status);
  maybeAutoSave();
}

async function noteStatus(status: WorkerStatus): Promise<void> {
  set({ status });
  // Saved since (e.g. by a technique check): no room is old news.
  if (info.noRoom && poseSaved(status, await simdKnown)) noteNoRoom(false);
}

/**
 * Installed apps save the pose model by themselves once they're open online
 * (an iPhone home-screen app has its own storage, apart from Safari), after
 * the terms that describe it are accepted. Not where the browser reports
 * Data Saver (iPhones don't report Low Data Mode to websites), and not for a
 * week after a save that found no room: Settings offers it instead.
 */
function maybeAutoSave(): void {
  if (autoSaveTried || !info.status || !navigator.serviceWorker?.controller) return;
  const may = mayAutoSave({
    standalone: info.standalone,
    online: navigator.onLine,
    saveData: nav().connection?.saveData === true,
    termsAccepted: termsAccepted(loadProfile()),
    noRoomAt: noRoomAt(),
    now: Date.now(),
  });
  if (!may) return;
  autoSaveTried = true;
  void simdKnown.then((simd) => {
    if (poseSaved(info.status, simd)) void persist();
    else setTimeout(() => void savePoseFiles(), 1500);
  });
}

/**
 * A page loaded past the service worker (e.g. a hard reload) isn't
 * controlled, so its downloads wouldn't be saved: ask the worker to take it
 * over first.
 */
async function controlled(): Promise<boolean> {
  const sw = navigator.serviceWorker;
  const active = registration?.active;
  if (!sw || sw.controller) return !!sw?.controller;
  if (!active) return false;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3000);
    sw.addEventListener(
      'controllerchange',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    active.postMessage({ type: 'claim' } satisfies ToWorker);
  });
  return !!sw.controller;
}

let saveRunning = false;

/**
 * Saves the pose runtime this browser uses and the default (full) model:
 * each file is loaded through the service worker, which keeps a copy. Shows
 * progress in Settings.
 */
export async function savePoseFiles(): Promise<void> {
  if (saveRunning || !info.status) return;
  saveRunning = true;
  autoSaveTried = true; // one save per launch unless asked again
  try {
    await saveNow();
  } finally {
    saveRunning = false;
  }
}

async function saveNow(): Promise<void> {
  if (!(await controlled())) return set({ saveFailed: true });
  const simd = await simdKnown;
  const todo = poseToSave(info.status, simd);
  if (!todo.length) return;
  const total = todo.reduce((n, p) => n + p.size, 0);
  // A full phone: say so, rather than download what can't be kept.
  if (!(await roomFor(total))) {
    set({ saveFailed: false });
    return noteNoRoom(true);
  }
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
    // The worker checks each file against its hash before keeping it, and
    // says if one didn't fit.
    await refresh(30_000);
    const ok = poseSaved(info.status, simd);
    const noRoom = !ok && info.status?.noRoom === true;
    noteNoRoom(noRoom);
    set({ saving: undefined, saveFailed: !ok && !noRoom });
    if (ok) {
      showToast('Ready to use offline');
      void persist();
    }
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
