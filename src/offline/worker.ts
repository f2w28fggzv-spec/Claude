// The service worker's logic, as functions that take what they use (the
// caches, a fetch for this site's own files) so tests can run them with
// fakes. src/offline/sw.ts wires them to the worker's events.
//
// What it does, in short:
// - Installing a version saves the app itself (every file but the pose files)
//   in a cache named by the hash of those files, reusing unchanged files from
//   the previous version's cache instead of downloading them again. If that
//   fails, the install fails and the current version keeps running; the
//   browser tries again at its next update check.
// - Each pose file has a cache of its own, named by the file's hash, so an
//   update leaves unchanged pose files where they are. A changed one is
//   downloaded only if the phone had saved the old one; if there's no room
//   for it, it's left to be saved later rather than holding up the update.
// - Before downloading a file it looks in the browser's own HTTP cache
//   (never the network): the page has usually just loaded the app's code,
//   and phones that used technique checks before may still have the pose
//   files there. A copy is only kept if its SHA-256 is this version's.
// - Requests to another origin get a network error, and no request the worker
//   makes follows a redirect: nothing leaves the phone.
// - Requests for the app's files are answered from the cache. Pose files are
//   answered from the cache, else downloaded once (a second request for a
//   file already on its way waits for it) and saved as they're used; when
//   there's no room to keep one, it goes through the HTTP cache like any web
//   file. If Cache Storage itself fails, requests go to the network, so the
//   app still opens online. Anything else of this site's (other methods,
//   unknown files) goes to the network untouched and is never stored.
// - Activating a version deletes this app's caches that it doesn't use.
import {
  CACHE_PREFIX,
  cacheNames,
  cachesToDelete,
  digestHex,
  HASH_HEADER,
  networkPath,
  poseCacheName,
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
  /** Bytes this site may still store (the browser's estimate); undefined when it can't tell. */
  room: () => Promise<number | undefined>;
  /** Shared while the worker runs: files it couldn't keep for lack of room on the phone (until one is kept). */
  state: { noRoom: Set<string> };
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

/** Messages the app sends to the worker. "claim": take over a page loaded past it (e.g. a hard reload). */
export type ToWorker = { type: 'status' } | { type: 'skip-waiting' } | { type: 'claim' };

/** What the worker has saved, as reported to the app. */
export interface WorkerStatus {
  version: string;
  app: { files: number; saved: number; bytes: number };
  pose: { url: string; size: number; saved: boolean }[];
  /** A file the worker tried to keep didn't fit on the phone (and hasn't been kept since). */
  noRoom: boolean;
}

/**
 * How downloads go: past the HTTP cache, with no copy left in it (the Cache
 * Storage copy is the one kept). Never following a redirect, which could
 * lead to another site.
 */
const NETWORK: RequestInit = { cache: 'no-store', credentials: 'same-origin', redirect: 'error' };
/** A pose file there's no room to keep: through the HTTP cache, like any web file, so a repeat is checked rather than downloaded again. */
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

/** The browser refused to store something for lack of room. */
const isNoRoom = (err: unknown) => (err as { name?: unknown } | null)?.name === 'QuotaExceededError';

/**
 * Stores this version's exact copy of a file. Returns false when the phone
 * has no room for it (noted for the status); other failures throw.
 */
async function store(env: WorkerEnv, cacheName: string, entry: PrecacheEntry, body: ArrayBuffer): Promise<boolean> {
  try {
    await (await env.caches.open(cacheName)).put(absolute(env, entry.url), keptResponse(entry, body));
  } catch (err) {
    if (!isNoRoom(err)) throw err;
    env.state.noRoom.add(entry.url);
    return false;
  }
  env.state.noRoom.delete(entry.url);
  return true;
}

/**
 * Whether there's room to keep a file this size, by the browser's own
 * estimate (true when it can't tell: then a failed store says so).
 */
async function roomFor(env: WorkerEnv, entry: PrecacheEntry): Promise<boolean> {
  let room: number | undefined;
  try {
    room = await env.room();
  } catch {
    room = undefined;
  }
  if (room === undefined || room >= entry.size) return true;
  env.state.noRoom.add(entry.url);
  return false;
}

/**
 * This version's copy of a file from the browser's own HTTP cache, without
 * going to the network: the page has usually just loaded the app's code, and
 * phones that used technique checks before may still have the pose files.
 * Stale copies are looked at too; only one with this version's hash is used.
 */
async function fromHttpCache(env: WorkerEnv, entry: PrecacheEntry): Promise<ArrayBuffer | undefined> {
  try {
    const res = await env.fetch(absolute(env, entry.url), HTTP_CACHE_ONLY);
    return res.ok ? await exactBody(entry, res) : undefined;
  } catch {
    return undefined; // not in the HTTP cache
  }
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

/** Cache Storage failed (e.g. a damaged browser profile): treated as not saved, so the request goes to the network. */
async function orNothing<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch {
    return undefined;
  }
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
 * Gets a file that isn't saved: this version's copy from the browser's HTTP
 * cache (saved first), else the network, saving the file in the background
 * as it's used (only if it is exactly this version's file and the response
 * is OK; through the HTTP cache, unsaved, when there's no room to keep it).
 * Registered at once, so a request for the same file meanwhile waits for
 * this one.
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
    const local = await fromHttpCache(env, entry);
    if (local) {
      // Saved before answering, then served like any saved file (from the cache, not from memory).
      await store(env, cacheName, entry, local).catch(() => false);
      answer((await orNothing(savedCopy(env, cacheName, entry))) ?? keptResponse(entry, local));
      return local;
    }
    if (kind === 'pose' && !(await roomFor(env, entry))) {
      answer(env.fetch(absolute(env, networkPath(entry)), UNKEPT));
      return undefined;
    }
    const download = env.fetch(absolute(env, networkPath(entry)), NETWORK);
    answer(download);
    const res = await download;
    if (!res.ok) return undefined;
    // Cloned before the page reads it (this runs first once the response arrives).
    const body = await exactBody(entry, res.clone());
    if (body) await store(env, cacheName, entry, body).catch(() => false);
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
  const body = await exactBody(entry, res);
  if (!body) throw new Error(`${entry.url} doesn't match this version`);
  return body;
}

/** Throws unless the file is stored: a full phone fails the install like any other error. */
async function storeOrThrow(env: WorkerEnv, cacheName: string, entry: PrecacheEntry, body: ArrayBuffer): Promise<void> {
  if (!(await store(env, cacheName, entry, body))) throw new Error(`No room on the phone for ${entry.url}`);
}

/**
 * Saves a new version (the service worker's install step). Safe to run
 * again after a failure: files already saved are kept.
 */
export async function install(env: WorkerEnv): Promise<void> {
  const names = cacheNames(env.manifest);
  const ours = (await env.caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX));
  const app = await env.caches.open(names.app);
  await inParallel(env.manifest.app, 4, async (entry) => {
    if ((await app.match(absolute(env, entry.url)))?.headers.get(HASH_HEADER) === entry.hash) return;
    // This version's copy: from the app's other caches, else the browser's HTTP cache, else the network.
    const copy = await copyFromOtherCaches(env, ours, entry);
    if (copy) return app.put(absolute(env, entry.url), copy);
    await storeOrThrow(env, names.app, entry, (await fromHttpCache(env, entry)) ?? (await download(env, entry)));
  });
  // Pose files: an unchanged one is already in its own cache. A changed one
  // is downloaded only if the phone had saved the old one, so it keeps
  // working offline; with no room for it, it's skipped (saved later, on use
  // or from Settings) instead of failing the update, which would then never
  // apply.
  const kept: PrecacheEntry[] = [];
  for (const entry of env.manifest.pose) {
    const cacheName = poseCacheName(entry);
    if (await savedCopy(env, cacheName, entry)) kept.push(entry);
    else if (await savedBefore(env, ours, entry)) {
      const local = await fromHttpCache(env, entry);
      if (!local && !(await roomFor(env, entry))) continue;
      if (await store(env, cacheName, entry, local ?? (await download(env, entry)))) kept.push(entry);
    }
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

/** Deletes this app's caches the active version doesn't use. Returns their names. */
export async function activate(env: WorkerEnv): Promise<string[]> {
  const names = cacheNames(env.manifest);
  const doomed = cachesToDelete(await env.caches.keys(), [names.app, ...names.pose]);
  await Promise.all(doomed.map((name) => env.caches.delete(name)));
  return doomed;
}

/** What is saved now (after any save still running). */
export async function status(env: WorkerEnv): Promise<WorkerStatus> {
  await Promise.all(env.saving.values());
  const names = cacheNames(env.manifest);
  const app = await Promise.all(env.manifest.app.map((e) => orNothing(savedCopy(env, names.app, e))));
  const pose = await Promise.all(
    env.manifest.pose.map(async (e) => ({ url: e.url, size: e.size, saved: !!(await orNothing(savedCopy(env, poseCacheName(e), e))) })),
  );
  return {
    version: env.manifest.version,
    app: { files: app.length, saved: app.filter(Boolean).length, bytes: env.manifest.app.reduce((n, e) => n + e.size, 0) },
    pose,
    noRoom: env.state.noRoom.size > 0,
  };
}
