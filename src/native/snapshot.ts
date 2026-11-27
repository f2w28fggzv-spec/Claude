// The durable copy of the log in the iPhone app. localStorage stays the working store (every module reads and writes
// it as in the web app), and a copy of the user's keys is kept in a file in the app's own folder (data/snapshot.json,
// FiteeNative.writeSnapshot), which the iPhone's backups include. WebKit's storage in an app is best-effort: iOS can
// clear it when the phone runs low on space. At launch, before the app starts, restoreBeforeStart() puts the copy
// back when localStorage lost it; from then on startWriter() copies every change.
//
// The copy is a backup file in the format of exportAll() (src/log/store.ts) plus `rev`, so importAll() restores it.
// `rev` grows with every write, and localStorage remembers the newest it asked to save (REV_KEY, a device key: never
// copied or backed up), so the launch can tell a localStorage that lost changes (copy.rev > its rev) from one that
// has changes not yet copied.
import { ALL_KEYS_PREFIX, DEVICE_KEYS_PREFIX } from '../log/store';
import { showToast } from '../ui/toast';
import type { FiteeNative, SnapshotFiles } from './bridge';

/** A key of the user's data: what exportAll() backs up and the copy holds. */
export const isUserKey = (k: string) => k.startsWith(ALL_KEYS_PREFIX) && !k.startsWith(DEVICE_KEYS_PREFIX);

/** The newest revision localStorage asked to save (a device key). */
export const REV_KEY = 'formcheck.v1.device.snapshotRev';

export const RESTORED_TOAST = 'Your data was restored from fitee’s copy on this iPhone';
export const NEWER_TOAST = 'Your data was saved by a newer version of fitee: update the app from the App Store';
export const COPY_FAILED_TOAST = 'Couldn’t keep a copy of your data: your iPhone may be out of space';

export interface Copy {
  app: 'fitee';
  version: 1;
  exportedAt: string;
  data: Record<string, unknown>;
  rev: number;
}

/** The user's keys in a storage. */
function userKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null && isUserKey(k)) keys.push(k);
  }
  return keys;
}

/** The copy of a storage's user keys, each value parsed. A value that isn't JSON is left out (exportAll() would stop there). */
export function buildCopy(storage: Storage, rev: number, now: Date): Copy {
  const data: Record<string, unknown> = {};
  for (const k of userKeys(storage).sort()) {
    try {
      data[k] = JSON.parse(storage.getItem(k) ?? 'null');
    } catch {
      // Not JSON: no module writes such a value; leaving it out keeps the rest of the copy.
    }
  }
  return { app: 'fitee', version: 1, exportedAt: now.toISOString(), data, rev };
}

const isRev = (rev: unknown): rev is number => typeof rev === 'number' && Number.isInteger(rev) && rev > 0;

/** A copy file's text: a valid copy, or not, and then whether it's a copy in a newer format (from a newer app version). */
export function parseCopy(text: string): { ok: true; copy: Copy } | { ok: false; newer: boolean } {
  let value: Partial<Copy> & { version?: unknown };
  try {
    value = JSON.parse(text) as Partial<Copy>;
  } catch {
    return { ok: false, newer: false };
  }
  if (!value || typeof value !== 'object' || value.app !== 'fitee') return { ok: false, newer: false };
  if (typeof value.version === 'number' && value.version > 1) return { ok: false, newer: true };
  const { data } = value;
  const valid = value.version === 1 && !!data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).every(isUserKey) && isRev(value.rev);
  return valid ? { ok: true, copy: value as Copy } : { ok: false, newer: false };
}

/**
 * The copy to use from the three files: the valid one with the highest rev (a leftover snapshot.next.json is the
 * newest complete write). `currentInvalid`: snapshot.json exists and is neither valid nor newer (it's dropped before
 * any write). `newer`: some file is in a newer format.
 */
export function pickCopy(files: SnapshotFiles): { copy?: Copy; currentInvalid: boolean; newer: boolean } {
  let copy: Copy | undefined;
  let newer = false;
  let currentInvalid = false;
  for (const which of ['current', 'next', 'prev'] as const) {
    const text = files[which];
    if (text === undefined) continue;
    const parsed = parseCopy(text);
    if (parsed.ok) {
      if (!copy || parsed.copy.rev > copy.rev) copy = parsed.copy;
    } else if (parsed.newer) newer = true;
    else if (which === 'current') currentInvalid = true;
  }
  return { copy, currentInvalid, newer };
}

export type StartAction = 'hold' | 'fresh' | 'restore' | 'keep' | 'replace';

/**
 * What the launch does (spec 7.3, with the copy written again when its rev equals localStorage's but the data
 * differs: changes made before a write started never got a rev of their own).
 */
export function decideStart(s: { hasUserKeys: boolean; localRev: number; copy?: Copy; newer: boolean; sameData: boolean }): { action: StartAction; writeNow: boolean } {
  if (s.newer) return { action: 'hold', writeNow: false };
  if (!s.hasUserKeys) return s.copy ? { action: 'restore', writeNow: false } : { action: 'fresh', writeNow: false };
  if (!s.copy) return { action: 'keep', writeNow: true };
  if (s.copy.rev > s.localRev) return { action: 'replace', writeNow: false };
  return { action: 'keep', writeNow: s.copy.rev < s.localRev || !s.sameData };
}

/** localStorage's rev: REV_KEY when it's a positive integer, else 0. */
export function localRevOf(storage: Storage): number {
  const rev = Number(storage.getItem(REV_KEY));
  return isRev(rev) ? rev : 0;
}

/** The same JSON values (key order ignored, as the copy sorts its keys). */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export interface StartResult {
  action: StartAction;
  /** The chosen copy's rev (0 without one). */
  copyRev: number;
  /** Write a copy as soon as the writer starts. */
  writeNow: boolean;
  /** A toast for after the app has rendered. */
  toast?: string;
}

/**
 * Before the app starts (src/native/entry.ts): reads the copy, decides (decideStart) and applies it to `storage`.
 * The Storage hook isn't installed yet, so these writes schedule nothing. A failed readSnapshot rejects: the app must
 * then not start, since starting empty could later write over a good copy.
 */
export async function restoreBeforeStart(n: Pick<FiteeNative, 'readSnapshot' | 'dropSnapshot'>, storage: Storage, now = new Date()): Promise<StartResult> {
  const { copy, currentInvalid, newer } = pickCopy(await n.readSnapshot());
  const keys = userKeys(storage);
  const sameData = !!copy && sameJson(buildCopy(storage, 1, now).data, copy.data);
  const { action, writeNow } = decideStart({ hasUserKeys: keys.length > 0, localRev: localRevOf(storage), copy, newer, sameData });
  // An unreadable snapshot.json goes before any write, so the rotation can't push it over a good snapshot.prev.json.
  // A newer one is never dropped or written over.
  if (currentInvalid && action !== 'hold') await n.dropSnapshot();
  if ((action === 'restore' || action === 'replace') && copy) {
    for (const k of keys) storage.removeItem(k); // e.g. a workout in progress the copy doesn't have
    for (const [k, v] of Object.entries(copy.data)) storage.setItem(k, JSON.stringify(v));
    storage.setItem(REV_KEY, String(copy.rev));
  }
  const toast = action === 'restore' ? RESTORED_TOAST : action === 'hold' ? NEWER_TOAST : undefined;
  return { action, copyRev: copy?.rev ?? 0, writeNow, toast };
}

// ---- The writer ----------------------------------------------------------------------------------------------------

/** Wait this long after the last change before writing a copy, */
export const DEBOUNCE_MS = 1500;
/** but no longer than this after the first change not yet copied. */
export const MAX_WAIT_MS = 10_000;

export interface WriterDeps {
  storage: Storage;
  proto: { setItem: Storage['setItem']; removeItem: Storage['removeItem']; clear: Storage['clear'] };
  events: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  doc: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { readonly hidden: boolean };
  timers: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
  toast: (message: string) => void;
  now: () => number;
}

interface Writer {
  /** Writes now if a change is waiting (or always, with force). */
  flush(force?: boolean): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

let writer: Writer | undefined;

/**
 * Starts copying every change of the user's keys (spec 7.3). Wraps Storage.prototype's setItem, removeItem and clear
 * (as src/privacy.ts wraps fetch): after the real call, a change of a user key in `storage` (or a clear) schedules a
 * write. sessionStorage and device keys never do. With result.action 'hold' (a newer copy) nothing is ever written.
 * Returns a function that undoes it (for tests).
 */
export function startWriter(n: Pick<FiteeNative, 'writeSnapshot'>, result: StartResult, deps: Partial<WriterDeps> = {}): () => void {
  writer?.stop();
  if (result.action === 'hold') return () => undefined;
  const d: WriterDeps = {
    storage: deps.storage ?? localStorage,
    proto: deps.proto ?? Storage.prototype,
    events: deps.events ?? window,
    doc: deps.doc ?? document,
    timers: deps.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) },
    toast: deps.toast ?? showToast,
    now: deps.now ?? (() => Date.now()),
  };
  const { setItem, removeItem, clear } = d.proto;
  let lastRev = 0;
  let firstPending: number | undefined; // when the oldest change not yet copied was made
  let timer: unknown;
  let paused = false;
  let warned = false;

  const cancel = () => {
    if (timer !== undefined) d.timers.clearTimeout(timer);
    timer = undefined;
  };
  const write = () => {
    cancel();
    firstPending = undefined;
    // Only Delete all my data empties it, and that deletes the copy first: never write an empty copy over a good one.
    if (paused || userKeys(d.storage).length === 0) return;
    const rev = Math.max(lastRev, localRevOf(d.storage)) + 1;
    setItem.call(d.storage, REV_KEY, String(rev)); // first: localStorage always knows the newest rev it asked to save
    lastRev = rev;
    // Built and sent at once, so a flush on pagehide is posted before the page goes (the native side finishes it).
    void n.writeSnapshot({ text: JSON.stringify(buildCopy(d.storage, rev, new Date(d.now()))) }).catch(() => {
      firstPending ??= d.now(); // the next change or flush tries again
      if (!warned) d.toast(COPY_FAILED_TOAST);
      warned = true;
    });
  };
  const schedule = () => {
    if (paused) return;
    const now = d.now();
    firstPending ??= now;
    cancel();
    timer = d.timers.setTimeout(write, Math.max(0, Math.min(DEBOUNCE_MS, firstPending + MAX_WAIT_MS - now)));
  };
  const onPageHide = () => w.flush();
  const onVisibility = () => {
    if (d.doc.hidden) w.flush();
  };
  const w: Writer = {
    flush(force = false) {
      if (!paused && (force || firstPending !== undefined)) write();
    },
    pause() {
      paused = true;
      cancel();
      firstPending = undefined;
    },
    resume() {
      paused = false;
    },
    stop() {
      cancel();
      d.proto.setItem = setItem;
      d.proto.removeItem = removeItem;
      d.proto.clear = clear;
      d.events.removeEventListener('pagehide', onPageHide);
      d.doc.removeEventListener('visibilitychange', onVisibility);
      if (writer === w) writer = undefined;
    },
  };
  d.proto.setItem = function (this: Storage, key: string, value: string) {
    setItem.call(this, key, value);
    if (this === d.storage && isUserKey(String(key))) schedule();
  };
  d.proto.removeItem = function (this: Storage, key: string) {
    removeItem.call(this, key);
    if (this === d.storage && isUserKey(String(key))) schedule();
  };
  d.proto.clear = function (this: Storage) {
    clear.call(this);
    if (this === d.storage) schedule();
  };
  d.events.addEventListener('pagehide', onPageHide);
  d.doc.addEventListener('visibilitychange', onVisibility);
  writer = w;
  if (result.writeNow) w.flush(true);
  return w.stop;
}

/** Writes the copy now if a change is waiting (the self-test; also run on pagehide and when the page is hidden). */
export function flushNow(): void {
  writer?.flush();
}

/** While paused (Delete all my data), changes schedule nothing and a waiting write is dropped. */
export function pauseWriter(): void {
  writer?.pause();
}

export function resumeWriter(): void {
  writer?.resume();
}
