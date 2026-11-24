// The service worker's logic, as functions that take what they use (the
// caches, a fetch for this site's own files) so tests can run them with
// fakes. src/offline/sw.ts wires them to the worker's events.
//
// What it does, in short:
// - Installing a version saves the app itself (every file but the pose files)
//   in a cache named by the hash of those files, reusing unchanged files from
//   the previous version's cache instead of downloading them again, and keeps
//   whichever pose files the phone had saved (downloading only those that
//   changed). If anything fails, the install fails and the current version
//   keeps running; the browser tries again at its next update check.
// - Requests to another origin get a network error: nothing leaves the phone.
// - Requests for the app's files are answered from the cache. Pose files are
//   answered from the cache, else downloaded and saved as they're used.
//   Anything else of this site's (other methods, unknown files) goes to the
//   network untouched and is never stored.
// - Activating a version deletes this app's caches that it doesn't use.
import {
  CACHE_PREFIX,
  cacheNames,
  cachesToDelete,
  digestHex,
  HASH_HEADER,
  networkPath,
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
  /** Saves still running, by file, so a status request waits for them. */
  pending: Map<string, Promise<boolean>>;
}

/** What to do with one request. */
export type Route =
  /** Another origin: answered with a network error. */
  | { kind: 'refuse' }
  /** This site, but not a file of the app (another method, an unknown path): the network, never stored. */
  | { kind: 'pass' }
  /** A file of the app: from the app cache. */
  | { kind: 'app'; entry: PrecacheEntry }
  /** A pose file: from the pose cache, else downloaded and saved. */
  | { kind: 'pose'; entry: PrecacheEntry };

export interface RequestLike {
  url: string;
  method: string;
  /** "navigate" for a page load. */
  mode: string;
}

/** Messages the app sends to the worker. */
export type ToWorker = { type: 'status' } | { type: 'skip-waiting' };

/** What the worker has saved, as reported to the app. */
export interface WorkerStatus {
  version: string;
  app: { files: number; saved: number; bytes: number };
  pose: { url: string; size: number; saved: boolean }[];
}

/** How downloads go: past the HTTP cache, with no copy left in it (the Cache Storage copy is the one kept). */
const NETWORK: RequestInit = { cache: 'no-store', credentials: 'same-origin' };

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

/**
 * Stores a downloaded file if it is exactly this version's (size and hash),
 * under its clean URL, with the content type from the build. Returns false
 * (and stores nothing) when it isn't, e.g. the site changed mid-download.
 */
export async function keepIfExact(cache: Cache, env: WorkerEnv, entry: PrecacheEntry, res: Response): Promise<boolean> {
  const body = await res.arrayBuffer();
  if (body.byteLength !== entry.size) return false;
  if (digestHex(await crypto.subtle.digest('SHA-256', body)) !== entry.hash) return false;
  const headers = { 'content-type': entry.type, 'content-length': String(body.byteLength), [HASH_HEADER]: entry.hash };
  await cache.put(absolute(env, entry.url), new Response(body, { status: 200, headers }));
  return true;
}

/**
 * Answers a request for one of the app's files: the saved copy, else the
 * network, saving the file in the background as it's used (only if it is
 * exactly this version's file and the response is OK).
 */
export async function respond(route: Exclude<Route, { kind: 'pass' }>, env: WorkerEnv): Promise<Response> {
  if (route.kind === 'refuse') return Response.error();
  const names = cacheNames(env.manifest);
  const cacheName = route.kind === 'app' ? names.app : names.pose;
  const hit = await savedCopy(env, cacheName, route.entry);
  if (hit) return hit;
  const res = await env.fetch(absolute(env, networkPath(route.entry)), NETWORK);
  if (!res.ok) return res;
  const copy = res.clone();
  const url = route.entry.url;
  const save = env.caches
    .open(cacheName)
    .then((cache) => keepIfExact(cache, env, route.entry, copy))
    .catch(() => false);
  env.pending.set(url, save);
  void save.then(() => {
    if (env.pending.get(url) === save) env.pending.delete(url);
  });
  env.waitUntil(save);
  return res;
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

async function hasExact(cache: Cache, env: WorkerEnv, entry: PrecacheEntry): Promise<boolean> {
  return (await cache.match(absolute(env, entry.url)))?.headers.get(HASH_HEADER) === entry.hash;
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

async function download(cache: Cache, env: WorkerEnv, entry: PrecacheEntry): Promise<void> {
  const res = await env.fetch(absolute(env, networkPath(entry)), NETWORK);
  if (!res.ok) throw new Error(`${entry.url}: HTTP ${res.status}`);
  if (!(await keepIfExact(cache, env, entry, res))) throw new Error(`${entry.url} doesn't match this version`);
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
    if (await hasExact(app, env, entry)) return;
    const copy = await copyFromOtherCaches(env, ours, entry);
    if (copy) await app.put(absolute(env, entry.url), copy);
    else await download(app, env, entry);
  });
  // Pose files: never downloaded here unless the phone had saved them
  // before (then a changed file is downloaded again, so it keeps working
  // offline). Unchanged ones are already in the pose cache, which only gets
  // a new name when a pose file changes.
  const pose = await env.caches.open(names.pose);
  for (const entry of env.manifest.pose) {
    if (await hasExact(pose, env, entry)) continue;
    const copy = await copyFromOtherCaches(env, ours, entry);
    if (copy) await pose.put(absolute(env, entry.url), copy);
    else if (await savedBefore(env, ours, entry)) await download(pose, env, entry);
  }
}

/** Deletes this app's caches the active version doesn't use. Returns their names. */
export async function activate(env: WorkerEnv): Promise<string[]> {
  const names = cacheNames(env.manifest);
  const doomed = cachesToDelete(await env.caches.keys(), [names.app, names.pose]);
  await Promise.all(doomed.map((name) => env.caches.delete(name)));
  return doomed;
}

/** What is saved now (after any save still running). */
export async function status(env: WorkerEnv): Promise<WorkerStatus> {
  await Promise.all(env.pending.values());
  const names = cacheNames(env.manifest);
  const app = await Promise.all(env.manifest.app.map((e) => savedCopy(env, names.app, e)));
  const pose = await Promise.all(
    env.manifest.pose.map(async (e) => ({ url: e.url, size: e.size, saved: !!(await savedCopy(env, names.pose, e)) })),
  );
  return {
    version: env.manifest.version,
    app: { files: app.length, saved: app.filter(Boolean).length, bytes: env.manifest.app.reduce((n, e) => n + e.size, 0) },
    pose,
  };
}
