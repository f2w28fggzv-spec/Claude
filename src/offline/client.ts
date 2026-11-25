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
import { isUnkeptCache, type PoseVariant } from './manifest';
import { canApplyUpdate, mayAutoSave, poseSaved, poseToSave, poseUnkeptAt, RESUME_AFTER_MS, type OfflineOff, type SaveProblem, type WorkerState } from './state';
import type { FromWorker, ToWorker, WorkerStatus } from './worker';

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
  /** Why the pose model isn't saved, when something went wrong (the phone couldn't keep it: from the worker's status). */
  problem?: SaveProblem;
  /** A new version has installed and is waiting. */
  updateReady: boolean;
  /** A new version couldn't install for lack of room on the phone (the worker said so): what it still needed, in bytes. */
  updateHeld?: number;
  /** The first save of the app failed for lack of room on the phone: what it still needed, in bytes. */
  installNoRoom?: number;
  /** Switching to a new version, or looking for one. */
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
/** Whether the phone couldn't keep the pose files for a technique check with this model (the service worker remembers). */
export const poseFilesNotKept = (variant: PoseVariant) => poseUnkeptAt(info.status, info.simd, variant) !== undefined;
/** Whether this browser can keep the app offline at all. */
export const offlineAvailable = () => !info.off;

/**
 * Forgets which files the phone couldn't keep (the service worker's empty
 * marker caches), so the next try downloads them again: Try again, after
 * freeing up space, for a new version or the app's first save, whose
 * worker isn't running to ask.
 */
async function forgetUnkept(): Promise<void> {
  try {
    for (const name of await caches.keys()) if (isUnkeptCache(name)) await caches.delete(name);
  } catch {
    // No Cache Storage here: nothing was remembered.
  }
}

/**
 * "Update and save" reloads the page into the waiting version; this carries
 * the save across the reload (this tab only; about the phone, never backed up).
 */
const SAVE_AFTER_UPDATE_KEY = `${DEVICE_KEYS_PREFIX}saveAfterUpdate`;

function rememberSaveAfterUpdate(): void {
  try {
    sessionStorage.setItem(SAVE_AFTER_UPDATE_KEY, '1');
  } catch {
    // Storage blocked: the update still applies; the save is one more tap.
  }
}

function forgetSaveAfterUpdate(): void {
  try {
    sessionStorage.removeItem(SAVE_AFTER_UPDATE_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/** Whether a save was asked for before the reload; removed as it's read, so it runs once. */
function takeSaveAfterUpdate(): boolean {
  try {
    const asked = sessionStorage.getItem(SAVE_AFTER_UPDATE_KEY) !== null;
    sessionStorage.removeItem(SAVE_AFTER_UPDATE_KEY);
    return asked;
  } catch {
    return false;
  }
}

let registration: ServiceWorkerRegistration | undefined;
let installPrompt: InstallPromptEvent | undefined;
let simdKnown: Promise<boolean> = Promise.resolve(true);
let launchedAt = 0;
let hiddenAt = 0;
let lastUpdateCheck = 0;
let reloadWhenActive = false;
/** After "Update and save" reloaded the page before the new version took over: waiting for it, then the page reloads and saves. */
let waitingToSave = false;
let autoSaveTried = false;
/** A save asked for just before an update reloaded the page: runs once the worker has said what's saved. */
let saveAfterUpdate = false;
let persistAsked = false;
/** How often to look for a new version while the app stays open. */
const UPDATE_CHECK_MS = 60 * 60_000;

export function startOffline(): void {
  launchedAt = performance.now();
  lastUpdateCheck = Date.now(); // the browser checks for a new version when the app opens
  saveAfterUpdate = takeSaveAfterUpdate();
  set({
    online: navigator.onLine,
    standalone: isStandalone(),
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
    // Saving the app failed (e.g. the connection dropped): try again now. Not
    // when the phone had no room for it: then at the next launch, or Try again.
    if (info.worker === 'failed') {
      if (info.installNoRoom === undefined) void retryOffline(false);
    } else void refresh();
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
  // Why an install failed, when it was for lack of room (the worker tells every open page).
  navigator.serviceWorker.addEventListener('message', (e) => void onWorkerMessage(e.data as FromWorker | null));
  navigator.serviceWorker.startMessages?.();
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
  if (worker !== info.worker) set(worker === 'active' ? { worker, installNoRoom: undefined } : { worker });
}

function watch(reg: ServiceWorkerRegistration, worker: ServiceWorker | null): void {
  worker?.addEventListener('statechange', () => {
    // "installed" with a page already controlled = an update, waiting.
    if (worker.state === 'installed' && navigator.serviceWorker.controller) onUpdateReady();
    noteWorker(reg);
    if (worker.state === 'activated') void refresh();
    // An update that failed no longer holds back the installed app's own save.
    else if (worker.state === 'redundant') maybeAutoSave();
  });
}

/**
 * A version couldn't install for lack of room (the worker says so, and how
 * much it needed, just before the install fails). With a version running,
 * that's an update: it waits, and Settings says how much room it needs.
 * Without one, the app's first save failed: Settings says why, and it isn't
 * tried again by itself until the next launch.
 */
async function onWorkerMessage(msg: FromWorker | null): Promise<void> {
  if (msg?.type !== 'install-no-room' || typeof msg.bytes !== 'number') return;
  const reg = registration ?? (await navigator.serviceWorker.getRegistration().catch(() => undefined));
  if (reg?.active || navigator.serviceWorker.controller) set({ updateHeld: msg.bytes });
  else set({ installNoRoom: msg.bytes });
}

/**
 * Saving the app for offline use failed: try again ("Try again" in Settings,
 * `byUser`, which also forgets which files the phone couldn't keep, as the
 * user may have made room; or by itself when back online).
 */
export async function retryOffline(byUser = true): Promise<void> {
  if (info.off || info.worker !== 'failed') return;
  set({ worker: 'installing', installNoRoom: undefined });
  if (byUser) await forgetUnkept();
  void register();
}

/**
 * Looks for a new version now and waits for it to install: true if one is
 * then waiting (it may have been waiting already). An install that fails
 * for lack of room says so first (`updateHeld`).
 */
async function findUpdate(): Promise<boolean> {
  const reg = registration;
  if (!reg) return false;
  try {
    await reg.update();
  } catch {
    return !!reg.waiting;
  }
  const installing = reg.installing;
  if (installing)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, 120_000);
      function done() {
        if (installing!.state === 'installing') return;
        clearTimeout(timer);
        installing!.removeEventListener('statechange', done);
        resolve();
      }
      installing.addEventListener('statechange', done);
      done();
    });
  return !!reg.waiting;
}

/**
 * "Try again" for a new version that couldn't install for lack of room:
 * forgets which files the phone couldn't keep (the user may have made room),
 * looks for it again, and applies it once it's saved, like "Update now".
 */
export async function retryUpdate(): Promise<void> {
  if (info.updating) return;
  set({ updating: true, updateHeld: undefined });
  await forgetUnkept();
  if (await findUpdate()) return applyUpdate();
  set({ updating: false });
}

const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** A new version is waiting: apply it now if that's safe, else offer it in Settings. */
function onUpdateReady(): void {
  set({ updateReady: true, updateHeld: undefined });
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
    if (!reloadWhenActive || waitingToSave) return;
    // The switch didn't happen (e.g. an even newer version replaced it, or
    // the running version is busy). From the button, reload anyway; by
    // itself, stand down, so a later switch can't reload the page in the
    // middle of something.
    if (byUser) location.reload();
    else {
      reloadWhenActive = false;
      set({ updating: false });
    }
  }, 5000);
}

/**
 * "Update and save" reloaded the page, but the new version hasn't taken
 * over (the running one was busy, e.g. sending a file to another tab): the
 * save mustn't run on this version, which can't keep a pose file the update
 * changed. Asks the new version again and waits for it to take over; then
 * the page reloads into it and saves. If it still hasn't after a minute,
 * stands down, and the button offers it again.
 */
function updateThenSave(waiting: ServiceWorker): void {
  rememberSaveAfterUpdate();
  waitingToSave = true;
  reloadWhenActive = true;
  set({ updateReady: true, updating: true });
  waiting.postMessage({ type: 'skip-waiting' } satisfies ToWorker);
  setTimeout(() => {
    if (!waitingToSave) return;
    waitingToSave = false;
    reloadWhenActive = false;
    forgetSaveAfterUpdate();
    set({ updating: false });
  }, 60_000);
}

function onVisibility(): void {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  const away = hiddenAt ? Date.now() - hiddenAt : 0;
  // Back after a long time: like opening the app again.
  if (away >= RESUME_AFTER_MS) launchedAt = performance.now();
  // The app's first save failed (not for lack of room: then at the next launch, or Try again).
  if (info.worker === 'failed' && navigator.onLine) {
    if (info.installNoRoom === undefined) void retryOffline(false);
    return;
  }
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

/** Asks the service worker what's saved and notes it; returns its answer (undefined if none came in time). */
async function refresh(timeoutMs = 5000): Promise<WorkerStatus | undefined> {
  if (info.off) return undefined;
  const status = await ask<WorkerStatus>({ type: 'status' }, timeoutMs, (s) => void noteStatus(s).then(afterStatus));
  if (status) await noteStatus(status);
  afterStatus();
  return status;
}

async function noteStatus(status: WorkerStatus): Promise<void> {
  set({ status });
  const simd = await simdKnown;
  if (poseSaved(status, simd)) {
    // Saved since (e.g. by a technique check): an earlier problem is old news.
    if (info.problem) set({ problem: undefined });
  } else if (!saveRunning) {
    // The worker remembers when the phone couldn't keep them (a save, a
    // technique check, an earlier visit): say so. A newer version on the
    // site says more (update first).
    const notKept = poseUnkeptAt(status, simd) !== undefined;
    if (notKept && info.problem !== 'newer') set({ problem: 'no-room' });
    else if (!notKept && info.problem === 'no-room') set({ problem: undefined });
  }
}

/**
 * Once the worker has said what's saved: the save asked for just before an
 * update reloaded the page ("Update and save"), else the installed app's own.
 */
function afterStatus(): void {
  if (!info.status) return;
  if (saveAfterUpdate) {
    // Not while the Welcome screen shows (the new version may bring new terms):
    // once they're accepted; and only once it's known whether the update applied.
    if (!termsAccepted(loadProfile()) || !registration) return;
    saveAfterUpdate = false;
    const waiting = registration.waiting;
    if (waiting) updateThenSave(waiting);
    else void savePoseFiles('after-update');
  } else maybeAutoSave();
}

/** A new version is installing or waiting. */
const updateOnItsWay = () => !!(registration?.installing || registration?.waiting);

/**
 * Installed apps save the pose model by themselves once they're open online
 * (an iPhone home-screen app has its own storage, apart from Safari), after
 * the terms that describe it are accepted. Not where the browser reports
 * Data Saver (iPhones don't report Low Data Mode to websites), not for a
 * week after the phone couldn't keep it (Settings offers it instead), and
 * not while a new version installs or waits (a pose file it changes
 * couldn't be kept by this one): then it runs once the update has applied (a
 * fresh page) or at the next launch.
 */
function maybeAutoSave(): void {
  if (autoSaveTried || !info.status || !navigator.serviceWorker?.controller || updateOnItsWay()) return;
  const may = mayAutoSave({
    standalone: info.standalone,
    online: navigator.onLine,
    saveData: nav().connection?.saveData === true,
    termsAccepted: termsAccepted(loadProfile()),
    // From the worker, which remembers it across restarts and launches (a technique check in a tab counts too).
    noRoomAt: poseUnkeptAt(info.status, info.simd),
    now: Date.now(),
  });
  if (!may) return;
  autoSaveTried = true;
  void simdKnown.then((simd) => {
    if (poseSaved(info.status, simd)) void persist();
    else setTimeout(() => void savePoseFiles('auto'), 1500);
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
 * How a save starts: the button in Settings, the installed app by itself,
 * or the button's save carried on after "Update and save" reloaded the page.
 */
type SaveStart = 'button' | 'auto' | 'after-update';

/**
 * Saves the pose runtime this browser uses and the default (full) model:
 * each file is loaded through the service worker, which keeps a copy. Shows
 * progress in Settings. From the button while a new version waits, it
 * switches to that version first and carries on after the reload ("Update
 * and save"): this one couldn't keep a pose file the update changed. When
 * the site already serves a newer version that this phone hasn't found yet,
 * the button looks for it instead, and downloads nothing until it's here.
 */
export async function savePoseFiles(start: SaveStart = 'button'): Promise<void> {
  if (saveRunning || !info.status || info.updating) return;
  // A save carried on after the reload never applies an update again, so it can't loop.
  if (start === 'button' && info.updateReady) {
    rememberSaveAfterUpdate();
    return applyUpdate();
  }
  if (start === 'button' && info.problem === 'newer') return saveNewVersion();
  if (start === 'auto' && updateOnItsWay()) {
    autoSaveTried = false; // tried again once the update has applied, or if it fails
    return;
  }
  saveRunning = true;
  autoSaveTried = true; // one save per launch unless asked again
  try {
    await saveNow();
  } finally {
    saveRunning = false;
  }
}

/**
 * The site serves a newer version than this one (its files changed): look
 * for it, and once it's here, "Update and save". If it isn't on this phone
 * yet (GitHub Pages' CDN can serve the old sw.js for a few minutes after a
 * deploy), nothing is downloaded and Settings says to try again later; if it
 * couldn't install for lack of room, Settings says so.
 */
async function saveNewVersion(): Promise<void> {
  set({ updating: true });
  // The user may have made room since a try that couldn't keep its files.
  if (info.updateHeld !== undefined) {
    set({ updateHeld: undefined });
    await forgetUnkept();
  }
  // Remembered now: the update may apply by itself as it arrives (just after the app opened).
  rememberSaveAfterUpdate();
  if (await findUpdate()) return applyUpdate();
  forgetSaveAfterUpdate();
  set({ updating: false });
}

async function saveNow(): Promise<void> {
  if (!(await controlled())) return set({ problem: 'failed' });
  const simd = await simdKnown;
  const todo = poseToSave(info.status, simd);
  if (!todo.length) return;
  const total = todo.reduce((n, p) => n + p.size, 0);
  const version = info.status?.version;
  // The worker stops trying to keep files the phone couldn't keep (they go
  // through the HTTP cache instead, for a week): ask it to try once more. It
  // says first if the browser's own estimate shows there's no room, rather
  // than download what can't be kept. (Often it can't tell; then the
  // worker's refused store says so after the download.)
  const begun = await ask<{ go?: boolean } | true>({ type: 'save', urls: todo.map((f) => f.url) }, 3000);
  if (typeof begun === 'object' && begun.go === false) {
    await refresh();
    return set({ problem: 'no-room' });
  }
  let done = 0;
  let shownAt = 0;
  set({ saving: { done, total }, problem: undefined });
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
  } catch {
    // A download failed (most likely the connection): the worker says what it kept.
  }
  // The worker checks each file against its hash before keeping it, and says
  // if the phone couldn't keep one, or if the site already has a newer version.
  const status = await refresh(30_000);
  if (poseSaved(status, simd)) {
    set({ saving: undefined, problem: undefined });
    showToast('Ready to use offline');
    void persist();
  } else if (status && version && status.version !== version) {
    // A newer version took over during the save (e.g. from another window):
    // this page still runs the old one, so a reload shows it ("Update and save").
    set({ saving: undefined, problem: 'newer', updateReady: true });
  } else if (status?.newer) {
    // This version's files are gone from the site (whatever room the phone
    // has, this version can't save them): fetch the new version, then
    // "Update and save".
    set({ saving: undefined, problem: 'newer' });
    void registration?.update().catch(() => {});
  } else if (poseUnkeptAt(status, simd) !== undefined) set({ saving: undefined, problem: 'no-room' });
  else set({ saving: undefined, problem: 'failed' });
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
