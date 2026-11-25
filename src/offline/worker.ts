// The service worker's logic, as functions that take what they use (the
// caches, a fetch for this site's own files, the clock) so tests can run
// them with fakes. src/offline/sw.ts wires them to the worker's events.
//
// What it does, in short:
// - Installing a version saves the app itself (every file but the pose files)
//   in a cache named by the hash of those files, reusing unchanged files from
//   the previous version's cache instead of downloading them again. If that
//   fails, the install fails and the current version keeps running; the
//   browser tries again at its next update check.
// - Each pose file has a cache of its own, named by the file's hash, so an
//   update leaves unchanged pose files where they are. A changed one is
//   downloaded only if the phone had saved the old one, and the update
//   installs only once the new copy is kept: an update never leaves the
//   phone without a pose file it had saved (it would stop technique checks
//   working offline). Until there's room, the current version keeps running.
// - Before downloading a file it looks in the browser's own HTTP cache
//   (never the network): the page has usually just loaded the app's code,
//   and phones that used technique checks before may still have the pose
//   files there. A copy is only kept if its SHA-256 is this version's.
// - Requests to another origin get a network error, and no request the worker
//   makes follows a redirect: nothing leaves the phone.
// - Requests for the app's files are answered from the cache. Pose files are
//   answered from the cache, else downloaded once (a second request for a
//   file already on its way waits for it) and saved as they're used. If
//   Cache Storage itself fails, requests go to the network, so the app still
//   opens online. Anything else of this site's (other methods, unknown
//   files) goes to the network untouched and is never stored.
// - A file the phone couldn't keep (the browser refused to store it, for
//   lack of room or any other reason: on a really full disk Chromium says
//   "UnknownError", not "QuotaExceededError"; or its estimate showed no
//   room) is remembered by an empty marker cache (manifest.ts) that outlives
//   the worker: for a week nothing downloads it again by itself (a pose file
//   used meanwhile goes through the HTTP cache, unsaved; an update that needs
//   it waits), until the page asks to try again. Open pages are told when an
//   install fails for lack of room, and how much it needed.
// - A download that arrives but isn't this version's file means the site
//   already serves a newer version: reported, so the page can update first.
// - Activating a version deletes this app's caches that it doesn't use.
import {
  CACHE_PREFIX,
  cacheNames,
  cachesToDelete,
  digestHex,
  HASH_HEADER,
  isUnkeptCache,
  networkPath,
  noRoomRetryMs,
  parseUnkept,
  poseCacheName,
  unkeptCacheName,
  unkeptRecently,
  type PrecacheEntry,
  type PrecacheManifest,
} from './manifest';

export interface WorkerEnv {
  manifest: PrecacheManifest;
  /** The app's folder (the worker's scope), ending in "/". */
  base: string;
  caches: CacheStorage;
  /** Loads one of this site's own files; sw.ts refuses anything else. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Keeps the worker alive until a background save finishes. */
  waitUntil: (p: Promise<unknown>) => void;
  /**
   * Files on their way, by file: each resolves to the file's exact bytes once
   * downloaded and checked (kept, or not if there was no room), or undefined
   * if the download failed. A status request waits for them, and a second
   * request for the same file waits for the first instead of downloading it
   * again.
   */
  saving: Map<string, Promise<ArrayBuffer | undefined>>;
  /**
   * Bytes this site may still store (the browser's estimate); undefined when
   * it can't tell. Only a cheap first check: Chromium reports a fixed
   * headroom however full the disk is, so a refused store has the last word.
   */
  room: () => Promise<number | undefined>;
  /** The time, in ms (Date.now). */
  now: () => number;
  /** Tells every open page of the app something (the pages loaded past this worker too). */
  notify: (msg: FromWorker) => Promise<void>;
  /** Shared while the worker runs. */
  state: SaveState;
}

/** What the worker keeps in memory while it runs. */
export interface SaveState {
  /**
   * When the phone couldn't keep a file, by hash, where Cache Storage
   * couldn't even hold the marker (normally the marker caches say it).
   */
  unkept: Map<string, number>;
  /** Pose files a save asked to try once more to keep, even within the week after the phone couldn't. */
  retry: Set<string>;
  /** A download came back fine but wasn't this version's file: the site already serves a newer version. */
  newer: boolean;
}

/** What to do with one request. */
export type Route =
  /** Another origin: answered with a network error. */
  | { kind: 'refuse' }
  /** This site, but not a file of the app (another method, an unknown path): the network, never stored. */
  | { kind: 'pass' }
  /** A file of the app: from the app cache. */
  | { kind: 'app'; entry: PrecacheEntry }
  /** A pose file: from its cache, else downloaded and saved. */
  | { kind: 'pose'; entry: PrecacheEntry };

export interface RequestLike {
  url: string;
  method: string;
  /** "navigate" for a page load. */
  mode: string;
}

/**
 * Messages the app sends to the worker. "claim": take over a page loaded past
 * it (e.g. a hard reload). "save": the page is about to load these pose files
 * to save them; answered `{ go }` (go: false when the browser's estimate
 * already shows there's no room for them).
 */
export type ToWorker = { type: 'status' } | { type: 'skip-waiting' } | { type: 'claim' } | { type: 'save'; urls: string[] };

/**
 * Messages the worker sends to every open page. "install-no-room": a version
 * couldn't be installed because the phone couldn't keep files it needs (the
 * first one: the app isn't saved; an update: it waits, and the current version
 * keeps running); `bytes` is what it still needed.
 */
export type FromWorker = { type: 'install-no-room'; version: string; bytes: number };

/** What the worker has saved, as reported to the app. */
export interface WorkerStatus {
  version: string;
  app: { files: number; saved: number; bytes: number };
  /** `unkeptAt`: when the phone couldn't keep the file (it hasn't been kept since). */
  pose: { url: string; size: number; saved: boolean; unkeptAt?: number }[];
  /** A pose file couldn't be kept on the phone (and hasn't been kept since). */
  noRoom: boolean;
  /** A download showed the site already serves a newer version (since the last save began). */
  newer: boolean;
}

/**
 * How downloads go: past the HTTP cache, with no copy left in it (the Cache
 * Storage copy is the one kept). Never following a redirect, which could
 * lead to another site.
 */
const NETWORK: RequestInit = { cache: 'no-store', credentials: 'same-origin', redirect: 'error' };
/**
 * A pose file the phone can't keep: through the HTTP cache, like any web
 * file, so a repeat can come from there rather than the network (where the
 * HTTP cache has room for it).
 */
const UNKEPT: RequestInit = { cache: 'default', credentials: 'same-origin', redirect: 'error' };
/** Only the browser's HTTP cache, stale copies included; never the network. */
const HTTP_CACHE_ONLY: RequestInit = { cache: 'only-if-cached', mode: 'same-origin', credentials: 'same-origin', redirect: 'error' };

export function routeRequest(req: RequestLike, base: string, manifest: PrecacheManifest): Route {
  let url: URL;
  let own: URL;
  try {
    url = new URL(req.url);
    own = new URL(base);
  } catch {
    return { kind: 'refuse' };
  }
  if (url.origin !== own.origin) return { kind: 'refuse' };
  if (req.method !== 'GET') return { kind: 'pass' };
  if (!url.pathname.startsWith(own.pathname)) return { kind: 'pass' };
  let path: string;
  try {
    path = decodeURIComponent(url.pathname.slice(own.pathname.length));
  } catch {
    return { kind: 'pass' };
  }
  // Opening the app (with or without a query, e.g. from the home screen):
  // the saved page. Routes are in the hash, which never reaches here.
  if (req.mode === 'navigate' && (path === '' || path === 'index.html')) {
    const page = manifest.app.find((e) => e.url === 'index.html');
    return page ? { kind: 'app', entry: page } : { kind: 'pass' };
  }
  if (url.search) return { kind: 'pass' };
  const app = manifest.app.find((e) => e.url === path);
  if (app) return { kind: 'app', entry: app };
  const pose = manifest.pose.find((e) => e.url === path);
  if (pose) return { kind: 'pose', entry: pose };
  return { kind: 'pass' };
}

const absolute = (env: WorkerEnv, path: string) => new URL(path, env.base).href;

/** The saved copy of a file in one cache, if it's this version's. */
async function savedCopy(env: WorkerEnv, cacheName: string, entry: PrecacheEntry): Promise<Response | undefined> {
  const res = await env.caches.match(absolute(env, entry.url), { cacheName });
  return res && res.headers.get(HASH_HEADER) === entry.hash ? res : undefined;
}

/** The body, if it is exactly this version's file (size and SHA-256). */
async function exactBody(entry: PrecacheEntry, res: Response): Promise<ArrayBuffer | undefined> {
  const body = await res.arrayBuffer();
  if (body.byteLength !== entry.size) return undefined;
  return digestHex(await crypto.subtle.digest('SHA-256', body)) === entry.hash ? body : undefined;
}

/** The copy kept of a file: its exact bytes, the content type from the build and its hash. */
const keptResponse = (entry: PrecacheEntry, body: ArrayBuffer) =>
  new Response(body, { status: 200, headers: { 'content-type': entry.type, 'content-length': String(body.byteLength), [HASH_HEADER]: entry.hash } });

/** Cache Storage failed (e.g. a damaged browser profile): treated as not saved, so the request goes to the network. */
async function orNothing<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch {
    return undefined;
  }
}

/** The names of the markers for one file. */
async function markersOf(env: WorkerEnv, hash: string): Promise<string[]> {
  return ((await orNothing(env.caches.keys())) ?? []).filter((name) => parseUnkept(name)?.hash === hash);
}

/**
 * When the phone couldn't keep each file it couldn't keep (and hasn't kept
 * since), by hash: from the marker caches, and from memory where Cache
 * Storage couldn't hold a marker. The latest time for a file wins.
 */
async function unkeptMarks(env: WorkerEnv): Promise<Map<string, number>> {
  const out = new Map(env.state.unkept);
  for (const name of (await orNothing(env.caches.keys())) ?? []) {
    const m = parseUnkept(name);
    if (m && !((out.get(m.hash) ?? -1) >= m.at)) out.set(m.hash, m.at);
  }
  return out;
}

/**
 * Remembers that the phone couldn't keep a file. A recent mark (within the
 * file's period: a week for a pose file, a day for one of the app's) stays as
 * it is (the period runs from the first time); an older one gives way to a
 * new one. Only the marker cache's name holds it, so it usually fits where
 * the file didn't; if not, it's kept in memory.
 */
async function markUnkept(env: WorkerEnv, entry: PrecacheEntry): Promise<void> {
  const now = env.now();
  const period = noRoomRetryMs(entry);
  const marked = await markersOf(env, entry.hash);
  const recent = marked.some((name) => unkeptRecently(parseUnkept(name)?.at, now, period)) || unkeptRecently(env.state.unkept.get(entry.hash), now, period);
  for (const name of marked) if (!unkeptRecently(parseUnkept(name)?.at, now, period)) await orNothing(env.caches.delete(name));
  if (recent) return;
  try {
    await env.caches.open(unkeptCacheName(entry.hash, now));
    env.state.unkept.delete(entry.hash);
  } catch {
    env.state.unkept.set(entry.hash, now);
  }
}

/** The phone kept the file: forget that it couldn't. */
async function clearUnkept(env: WorkerEnv, entry: PrecacheEntry): Promise<void> {
  env.state.unkept.delete(entry.hash);
  for (const name of await markersOf(env, entry.hash)) await orNothing(env.caches.delete(name));
}

/**
 * Stores this version's exact copy of a file (it downloaded and matched).
 * Returns false when the browser refuses it, whatever the reason: the phone
 * couldn't keep it, and that's remembered. Over quota the browser says
 * QuotaExceededError, but on a really full disk Chromium says UnknownError
 * ("Unexpected internal error"), and a damaged Cache Storage fails too.
 */
async function store(env: WorkerEnv, cacheName: string, entry: PrecacheEntry, body: ArrayBuffer): Promise<boolean> {
  try {
    await (await env.caches.open(cacheName)).put(absolute(env, entry.url), keptResponse(entry, body));
  } catch {
    await markUnkept(env, entry);
    return false;
  }
  await clearUnkept(env, entry);
  return true;
}

/**
 * Whether there's room to keep a file this size, by the browser's own
 * estimate (true when it can't tell). Only a first check: it can say there's
 * room on a full phone (Chromium reports a fixed headroom), and then the
 * refused store says so. No room counts as the phone couldn't keep it.
 */
async function roomFor(env: WorkerEnv, entry: PrecacheEntry): Promise<boolean> {
  let room: number | undefined;
  try {
    room = await env.room();
  } catch {
    room = undefined;
  }
  if (room === undefined || room >= entry.size) return true;
  await markUnkept(env, entry);
  return false;
}

/**
 * Whether to try to keep a pose file now: not within a week after the phone
 * couldn't keep it (unless a save asked to try once more), and only if the
 * browser's estimate shows room for it.
 */
async function mayKeep(env: WorkerEnv, entry: PrecacheEntry): Promise<boolean> {
  const retry = env.state.retry.delete(entry.url);
  if (!retry && unkeptRecently((await unkeptMarks(env)).get(entry.hash), env.now(), noRoomRetryMs(entry))) return false;
  return roomFor(env, entry);
}

/**
 * This version's copy of a file from the browser's own HTTP cache, without
 * going to the network: the page has usually just loaded the app's code
 * (under the file's own URL), phones that used technique checks before may
 * still have the pose files there, and a pose file the phone couldn't keep
 * went through it under its download URL (`?v=<hash>`). Stale copies are
 * looked at too; only one with this version's hash is used.
 */
async function fromHttpCache(env: WorkerEnv, entry: PrecacheEntry): Promise<ArrayBuffer | undefined> {
  for (const path of [entry.url, networkPath(entry)]) {
    try {
      const res = await env.fetch(absolute(env, path), HTTP_CACHE_ONLY);
      const body = res.ok ? await exactBody(entry, res) : undefined;
      if (body) return body;
    } catch {
      // Not in the HTTP cache.
    }
  }
  return undefined;
}

/**
 * A file on its way: keeps the worker alive until it lands, lets a status
 * request wait for it, and lets a second request for the file wait for it.
 */
function track(env: WorkerEnv, url: string, work: Promise<ArrayBuffer | undefined>): Promise<ArrayBuffer | undefined> {
  const job = work.catch(() => undefined);
  env.saving.set(url, job);
  void job.then(() => {
    if (env.saving.get(url) === job) env.saving.delete(url);
  });
  env.waitUntil(job);
  return job;
}

/**
 * Answers a request for one of the app's files: the saved copy; else the
 * download of it already on its way (e.g. "Save for offline use" while a
 * technique check loads the model: one download, not two); else fetches it.
 */
export async function respond(route: Exclude<Route, { kind: 'pass' }>, env: WorkerEnv): Promise<Response> {
  if (route.kind === 'refuse') return Response.error();
  const { entry } = route;
  const cacheName = route.kind === 'app' ? cacheNames(env.manifest).app : poseCacheName(entry);
  const hit = await orNothing(savedCopy(env, cacheName, entry));
  if (hit) return hit;
  const onItsWay = env.saving.get(entry.url);
  if (onItsWay) {
    const body = await onItsWay;
    if (body) return (await orNothing(savedCopy(env, cacheName, entry))) ?? keptResponse(entry, body);
    // That one failed: this request tries for itself.
  }
  return fetchAndKeep(env, route.kind, cacheName, entry);
}

/**
 * The body of a download that arrived fine, if it is exactly this version's
 * file. If it isn't, the site already serves a newer version (a deploy since
 * this one): noted for the status, so the page can update before saving.
 */
async function downloadedBody(env: WorkerEnv, entry: PrecacheEntry, res: Response): Promise<ArrayBuffer | undefined> {
  const body = await exactBody(entry, res);
  if (!body) env.state.newer = true;
  return body;
}

/**
 * Gets a file that isn't saved: this version's copy from the browser's HTTP
 * cache, else the network, saving the file in the background as it's used
 * (only if it is exactly this version's file and the response is OK). A pose
 * file the phone couldn't keep in the past week isn't tried again (unless a
 * save asks): it's served from the HTTP cache, or fetched through it,
 * unsaved, like any web file; so is one the browser's estimate has no room
 * for. Registered at once, so a request for the same file meanwhile waits
 * for this one.
 */
function fetchAndKeep(env: WorkerEnv, kind: 'app' | 'pose', cacheName: string, entry: PrecacheEntry): Promise<Response> {
  let answered = false;
  let resolve!: (res: Response | Promise<Response>) => void;
  const response = new Promise<Response>((r) => (resolve = r));
  const answer = (res: Response | Promise<Response>) => {
    answered = true;
    resolve(res);
  };
  const work = (async (): Promise<ArrayBuffer | undefined> => {
    const keep = kind === 'app' || (await mayKeep(env, entry));
    const local = await fromHttpCache(env, entry);
    if (local) {
      // Saved before answering, then served like any saved file (from the cache, not from memory).
      const kept = keep && (await store(env, cacheName, entry, local));
      answer((kept && (await orNothing(savedCopy(env, cacheName, entry)))) || keptResponse(entry, local));
      return local;
    }
    if (!keep) {
      answer(env.fetch(absolute(env, networkPath(entry)), UNKEPT));
      return undefined;
    }
    const download = env.fetch(absolute(env, networkPath(entry)), NETWORK);
    answer(download);
    const res = await download;
    if (!res.ok) return undefined;
    // Cloned before the page reads it (this runs first once the response arrives).
    const body = await downloadedBody(env, entry, res.clone());
    if (body) await store(env, cacheName, entry, body);
    return body;
  })();
  void work.catch((err: unknown) => {
    if (!answered) answer(Promise.reject(err));
  });
  track(env, entry.url, work);
  return response;
}

/**
 * Runs `fn` over `items`, at most `n` at a time. Every item gets its turn
 * even when one fails (so a retry has less to do); then the first failure
 * is thrown.
 */
async function inParallel<T>(items: readonly T[], n: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item).catch((err: unknown) => failures.push(err));
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
  if (failures.length) throw failures[0];
}

/** The same file (same hash) in another of this app's caches. */
async function copyFromOtherCaches(env: WorkerEnv, ours: readonly string[], entry: PrecacheEntry): Promise<Response | undefined> {
  for (const name of ours) {
    const res = await savedCopy(env, name, entry);
    if (res) return res;
  }
  return undefined;
}

/** Whether any of this app's caches has a copy of the file, from any version. */
async function savedBefore(env: WorkerEnv, ours: readonly string[], entry: PrecacheEntry): Promise<boolean> {
  for (const cacheName of ours) if (await env.caches.match(absolute(env, entry.url), { cacheName })) return true;
  return false;
}

/** Downloads this version's exact copy of a file; throws if it can't, or if it isn't this version's. */
async function download(env: WorkerEnv, entry: PrecacheEntry): Promise<ArrayBuffer> {
  const res = await env.fetch(absolute(env, networkPath(entry)), NETWORK);
  if (!res.ok) throw new Error(`${entry.url}: HTTP ${res.status}`);
  const body = await downloadedBody(env, entry, res);
  if (!body) throw new Error(`${entry.url} doesn't match this version`);
  return body;
}

const bytesOf = (entries: readonly PrecacheEntry[]) => entries.reduce((n, e) => n + e.size, 0);

/**
 * Fails an install because the phone couldn't keep files it needs (now, or
 * within the past week): deletes the app cache this install made (on a full
 * phone its room counts; the next try copies the unchanged files again,
 * which downloads nothing), and tells the open pages how much room it needs:
 * everything it writes (`toWrite`, copies included). `unkept` names the files
 * it couldn't keep.
 */
async function hold(env: WorkerEnv, unkept: readonly PrecacheEntry[], toWrite: readonly PrecacheEntry[], madeCache?: string): Promise<never> {
  if (madeCache) await orNothing(env.caches.delete(madeCache));
  await orNothing(env.notify({ type: 'install-no-room', version: env.manifest.version, bytes: bytesOf(toWrite) }));
  throw new Error(`The phone couldn't keep ${unkept.map((e) => e.url).join(', ')}`);
}

/**
 * Saves a new version (the service worker's install step). Safe to run
 * again after a failure: files already saved are kept.
 */
export async function install(env: WorkerEnv): Promise<void> {
  const names = cacheNames(env.manifest);
  const existing = await env.caches.keys();
  const ours = existing.filter((name) => name.startsWith(CACHE_PREFIX) && !isUnkeptCache(name));
  // A deploy that changes only pose files keeps the app's cache name: never deleted here, it's the running version's.
  const madeCache = existing.includes(names.app) ? undefined : names.app;
  const app = await env.caches.open(names.app);
  // What this version still needs. App files: copied from the app's other
  // caches (no download), else from the browser's HTTP cache, else the
  // network. Pose files: a changed one only if the phone had saved the old
  // one, so it keeps working offline; an unchanged one is already in its own
  // cache.
  const copies: [PrecacheEntry, Response][] = [];
  const appToGet: PrecacheEntry[] = [];
  await inParallel(env.manifest.app, 4, async (entry) => {
    if ((await app.match(absolute(env, entry.url)))?.headers.get(HASH_HEADER) === entry.hash) return;
    const copy = await copyFromOtherCaches(env, ours, entry);
    if (copy) copies.push([entry, copy]);
    else appToGet.push(entry);
  });
  const kept: PrecacheEntry[] = [];
  const poseToGet: PrecacheEntry[] = [];
  for (const entry of env.manifest.pose) {
    if (await savedCopy(env, poseCacheName(entry), entry)) kept.push(entry);
    else if (await savedBefore(env, ours, entry)) poseToGet.push(entry);
  }
  // A file the phone couldn't keep recently (a pose file in the past week,
  // one of the app's in the past day) isn't written again (the browser tries
  // an update at every launch): the update waits, and the current version
  // keeps working, offline too. Everything this install writes is what it
  // needs room for.
  const toWrite = [...copies.map(([entry]) => entry), ...appToGet, ...poseToGet];
  const marks = await unkeptMarks(env);
  const marked = toWrite.filter((e) => unkeptRecently(marks.get(e.hash), env.now(), noRoomRetryMs(e)));
  if (marked.length) return hold(env, marked, toWrite, madeCache);
  // The app: all of it must be kept (any failure fails the install).
  const refused: PrecacheEntry[] = [];
  for (const [entry, copy] of copies) if (!(await store(env, names.app, entry, await copy.arrayBuffer()))) refused.push(entry);
  await inParallel(appToGet, 4, async (entry) => {
    if (!(await store(env, names.app, entry, (await fromHttpCache(env, entry)) ?? (await download(env, entry))))) refused.push(entry);
  });
  if (refused.length) return hold(env, refused, toWrite, madeCache);
  // Pose files, one at a time: if the phone can't keep one (the estimate
  // shows no room, or the browser refuses to store it, for whatever reason),
  // the rest aren't downloaded either.
  for (const entry of poseToGet) {
    const local = await fromHttpCache(env, entry);
    if ((local || (await roomFor(env, entry))) && (await store(env, poseCacheName(entry), entry, local ?? (await download(env, entry))))) kept.push(entry);
    else return hold(env, [entry], toWrite, madeCache);
  }
  // A version activating meanwhile (e.g. "Update now" on the one before
  // this) deletes the caches it doesn't use, these included, and the files
  // put since went nowhere. Check by name that everything is there; if not,
  // fail, so the browser tries again instead of installing an empty copy.
  const missing = [
    ...env.manifest.app.map((entry) => [names.app, entry] as const),
    ...kept.map((entry) => [poseCacheName(entry), entry] as const),
  ];
  for (const [cacheName, entry] of missing)
    if (!(await savedCopy(env, cacheName, entry))) throw new Error(`${entry.url} wasn't kept (its cache was deleted meanwhile)`);
}

/**
 * Deletes this app's caches the active version doesn't use, and returns their
 * names. The markers of its own pose files stay: the week without
 * downloading them again carries on (the room the deleted caches took often
 * comes back only after the browser restarts).
 */
export async function activate(env: WorkerEnv): Promise<string[]> {
  const names = cacheNames(env.manifest);
  const existing = await env.caches.keys();
  const ownPose = new Set(env.manifest.pose.map((e) => e.hash));
  const markers = existing.filter((name) => ownPose.has(parseUnkept(name)?.hash ?? ''));
  const doomed = cachesToDelete(existing, [names.app, ...names.pose, ...markers]);
  await Promise.all(doomed.map((name) => env.caches.delete(name)));
  return doomed;
}

/**
 * The page is about to load these pose files to save them ("Save for
 * offline use", Try again, or the installed app's auto-save): forget an
 * earlier sign of a newer version, and try once more to keep each file not
 * saved yet, even within the week after the phone couldn't (if it can't,
 * that week still runs from the first time). Returns false, without asking
 * for anything, when the browser's estimate already shows there's no room
 * for them all: that counts as the phone couldn't keep them.
 */
export async function beginSave(env: WorkerEnv, urls: readonly string[]): Promise<boolean> {
  env.state.newer = false;
  const todo: PrecacheEntry[] = [];
  for (const entry of env.manifest.pose)
    if (urls.includes(entry.url) && !(await orNothing(savedCopy(env, poseCacheName(entry), entry)))) todo.push(entry);
  let room: number | undefined;
  try {
    room = await env.room();
  } catch {
    room = undefined;
  }
  if (room !== undefined && room < bytesOf(todo)) {
    for (const entry of todo) await markUnkept(env, entry);
    return false;
  }
  for (const entry of todo) env.state.retry.add(entry.url);
  return true;
}

/** What is saved now (after any save still running). */
export async function status(env: WorkerEnv): Promise<WorkerStatus> {
  await Promise.all(env.saving.values());
  const names = cacheNames(env.manifest);
  const marks = await unkeptMarks(env);
  const app = await Promise.all(env.manifest.app.map((e) => orNothing(savedCopy(env, names.app, e))));
  const pose = await Promise.all(
    env.manifest.pose.map(async (e) => {
      const saved = !!(await orNothing(savedCopy(env, poseCacheName(e), e)));
      const unkeptAt = saved ? undefined : marks.get(e.hash);
      return unkeptAt === undefined ? { url: e.url, size: e.size, saved } : { url: e.url, size: e.size, saved, unkeptAt };
    }),
  );
  return {
    version: env.manifest.version,
    app: { files: app.length, saved: app.filter(Boolean).length, bytes: env.manifest.app.reduce((n, e) => n + e.size, 0) },
    pose,
    // Pose files only: an app file the phone couldn't keep holds back an install instead (the page is told then).
    noRoom: pose.some((p) => p.unkeptAt !== undefined),
    newer: env.state.newer,
  };
}
