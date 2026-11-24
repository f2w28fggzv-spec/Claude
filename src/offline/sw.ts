// fitee's service worker: keeps a copy of the app (and, when used or asked
// for, the pose model) in this browser so it opens and works with no signal.
// A classic script at the root of the build (sw.js), written by
// scripts/offline-build.ts, which bundles this file with the list of every
// file in the build and its hash. The logic is in worker.ts (tested).
//
// It never sends anything anywhere: the only requests it makes are for this
// site's own files (to install a version, and to save pose files as they're
// used; it looks in the browser's HTTP cache first, which never touches the
// network), it never follows a redirect (which could lead to another site),
// and it answers every request to another origin with a network error, a
// third layer after src/privacy.ts and the page's CSP. No analytics, logging
// or beacons.
import type { PrecacheManifest } from './manifest';
import { activate, install, respond, routeRequest, status, type ToWorker, type WorkerEnv } from './worker';

/** Filled in by the build: every file of this version with its hash. */
declare const __FITEE_PRECACHE__: PrecacheManifest;

const worker = self as unknown as ServiceWorkerGlobalScope;
const manifest = __FITEE_PRECACHE__;
const base = new URL('./', worker.location.href).href;
const saving: WorkerEnv['saving'] = new Map();
const state: WorkerEnv['state'] = { noRoom: new Set() };

/** The only way this worker loads anything: this site's own files, never through a redirect. */
async function ownFetch(url: string, init: RequestInit): Promise<Response> {
  const target = new URL(url, base);
  if (target.origin !== worker.location.origin) throw new TypeError('fitee only loads its own files.');
  const res = await fetch(target.href, { ...init, redirect: 'error' });
  if (res.redirected || (res.url && new URL(res.url).origin !== worker.location.origin)) throw new TypeError('fitee only loads its own files.');
  return res;
}

/** How much more this site may store, by the browser's estimate (undefined when it can't tell). */
async function room(): Promise<number | undefined> {
  const estimate = await worker.navigator.storage?.estimate?.();
  return estimate?.quota !== undefined && estimate.usage !== undefined ? estimate.quota - estimate.usage : undefined;
}

const env = (waitUntil: (p: Promise<unknown>) => void): WorkerEnv => ({ manifest, base, caches: worker.caches, fetch: ownFetch, waitUntil, saving, room, state });

worker.addEventListener('install', (event) => {
  // A new version waits until the app is next opened, or "Update now".
  event.waitUntil(install(env((p) => event.waitUntil(p))));
});

worker.addEventListener('activate', (event) => {
  // Take over the page that installed the first version, so pose files it
  // loads from now on are saved as they're used.
  event.waitUntil(activate(env((p) => event.waitUntil(p))).then(() => worker.clients.claim()));
});

worker.addEventListener('fetch', (event) => {
  const route = routeRequest(event.request, base, manifest);
  // Not one of the app's files: the browser handles it as usual, uncached.
  if (route.kind === 'pass') return;
  event.respondWith(respond(route, env((p) => event.waitUntil(p))));
});

worker.addEventListener('message', (event) => {
  const msg = event.data as ToWorker | null;
  if (msg?.type === 'skip-waiting') void worker.skipWaiting();
  else if (msg?.type === 'claim') event.waitUntil(worker.clients.claim());
  else if (msg?.type === 'status') {
    const port = event.ports[0];
    event.waitUntil(status(env((p) => event.waitUntil(p))).then((s) => port?.postMessage(s)));
  }
});
