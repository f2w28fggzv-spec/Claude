// The service worker's logic (src/offline/worker.ts) run against an in-memory
// Cache Storage and a fake network: request routing, saving on use (one
// download per file), install (reusing unchanged files), cache names and
// clean-up across versions, a full phone (over quota, and a store refused
// with another error, as Chromium does on a really full disk: remembered
// across restarts and updates, an update that waits for room, the week
// without downloading again), a newer version on the site, and a failing
// Cache Storage.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  cacheNames,
  cachesToDelete,
  HASH_HEADER,
  NO_ROOM_RETRY_MS,
  parseUnkept,
  poseCacheName,
  unkeptCacheName,
  type PrecacheEntry,
  type PrecacheManifest,
} from '../src/offline/manifest';
import { activate, beginSave, install, respond, routeRequest, status, type FromWorker, type WorkerEnv } from '../src/offline/worker';

const BASE = 'https://example.github.io/Claude/';

/** What Chromium's Cache.put() throws on a really full disk (its storage estimate still shows plenty of room). */
const fullDisk = () => new DOMException('Unexpected internal error.', 'UnknownError');
/** Refuses to store the pose files, as on a really full disk. */
const refusePose = (url: string) => (url.includes('/mediapipe/') ? fullDisk() : undefined);

class FakeCache {
  readonly entries = new Map<string, Response>();
  constructor(private readonly owner: FakeCaches) {}
  async match(req: RequestInfo | URL): Promise<Response | undefined> {
    this.owner.check();
    return this.entries.get(String(req))?.clone();
  }
  async put(req: RequestInfo | URL, res: Response): Promise<void> {
    this.owner.check();
    // Like the real thing: the body is read now, and a full phone refuses it.
    const body = await res.arrayBuffer();
    const refused = this.owner.refuse?.(String(req));
    if (refused) throw refused;
    if (this.owner.used() + body.byteLength > this.owner.quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.entries.set(String(req), new Response(body, { status: res.status, headers: res.headers }));
  }
  async keys(): Promise<string[]> {
    return [...this.entries.keys()];
  }
  bytes(): number {
    return [...this.entries.values()].reduce((n, r) => n + Number(r.headers.get('content-length') ?? 0), 0);
  }
}

class FakeCaches {
  readonly stores = new Map<string, FakeCache>();
  /** Bytes this site may store in all (a full phone has little). */
  quota = Infinity;
  /** Refuses to store some files, with this error, whatever the quota (Chromium on a really full disk throws UnknownError). */
  refuse?: (url: string) => Error | undefined;
  /** Cache Storage itself fails (e.g. a damaged browser profile). */
  broken = false;
  check() {
    if (this.broken) throw new DOMException('Unexpected internal error.', 'UnknownError');
  }
  used(): number {
    return [...this.stores.values()].reduce((n, c) => n + c.bytes(), 0);
  }
  async open(name: string): Promise<FakeCache> {
    this.check();
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache(this));
    return this.stores.get(name)!;
  }
  async has(name: string) {
    this.check();
    return this.stores.has(name);
  }
  async delete(name: string) {
    this.check();
    return this.stores.delete(name);
  }
  async keys() {
    this.check();
    return [...this.stores.keys()];
  }
  async match(req: RequestInfo | URL, opts?: { cacheName?: string }): Promise<Response | undefined> {
    this.check();
    if (opts?.cacheName) return this.stores.get(opts.cacheName)?.match(req);
    for (const c of this.stores.values()) {
      const r = await c.match(req);
      if (r) return r;
    }
    return undefined;
  }
  /** Which files each cache holds. */
  summary(): Record<string, string[]> {
    return Object.fromEntries([...this.stores].map(([name, c]) => [name, [...c.entries.keys()].map((u) => u.slice(BASE.length))]));
  }
}

/**
 * A site: path → content, and a log of every request that reached it. In
 * front of it, the browser's HTTP cache (path with its query → what it holds,
 * possibly an older version), which `cache: 'only-if-cached'` reads without
 * the network, and which a download through it (`cache: 'default'`) fills, as
 * the site's max-age allows; one past it (`no-store`) leaves no copy.
 */
class FakeSite {
  files = new Map<string, string>();
  httpCache = new Map<string, string>();
  log: { url: string; init: RequestInit }[] = [];
  /** Lookups in the HTTP cache alone (they never reach the site). */
  cacheLookups: string[] = [];
  /** Every init the worker passed, lookups included. */
  inits: RequestInit[] = [];
  offline = false;
  /** Holds every download until released (to overlap requests). */
  gate?: Promise<void>;
  /** The next this many downloads answer 404 (e.g. mid-deploy). */
  failNext = 0;
  constructor(files: Record<string, string>) {
    this.set(files);
  }
  set(files: Record<string, string>) {
    for (const [k, v] of Object.entries(files)) this.files.set(k, v);
  }
  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    this.inits.push(init);
    const u = new URL(url);
    const path = u.pathname.slice(new URL(BASE).pathname.length);
    if (init.cache === 'only-if-cached') {
      // As in browsers: only allowed for same-origin requests; a miss is a network error.
      if (init.mode !== 'same-origin') throw new TypeError("'only-if-cached' can be set only with 'same-origin' mode");
      this.cacheLookups.push(path + u.search);
      const cached = this.httpCache.get(path + u.search);
      if (cached === undefined) throw new TypeError('Failed to fetch');
      return new Response(cached, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    this.log.push({ url, init });
    if (this.gate) await this.gate;
    if (this.offline) throw new TypeError('Failed to fetch');
    if (this.failNext > 0) {
      this.failNext--;
      return new Response('not found', { status: 404 });
    }
    const body = this.files.get(path);
    if (body === undefined) return new Response('not found', { status: 404 });
    if (init.cache === 'default') this.httpCache.set(path + u.search, body);
    return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
  };
  /** Paths requested, without the query. */
  paths = () => this.log.map((l) => new URL(l.url).pathname.slice(new URL(BASE).pathname.length));
}

const sha16 = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const manifestOf = (files: Record<string, string>): PrecacheManifest =>
  buildManifest(Object.entries(files).map(([url, body]) => ({ url, hash: sha16(body), size: Buffer.byteLength(body) })));

const V1 = {
  'index.html': '<!doctype html><title>fitee</title>',
  'assets/index-a1.js': 'console.log("app v1")',
  'assets/index-b2.css': 'body{}',
  'manifest.webmanifest': '{"name":"fitee"}',
  'mediapipe/wasm/vision_wasm_internal.js': 'loader',
  'mediapipe/wasm/vision_wasm_internal.wasm': 'wasm-simd',
  'mediapipe/wasm/vision_wasm_nosimd_internal.js': 'loader-nosimd',
  'mediapipe/wasm/vision_wasm_nosimd_internal.wasm': 'wasm-nosimd',
  'mediapipe/models/pose_landmarker_full.task': 'model-full',
  'mediapipe/models/pose_landmarker_lite.task': 'model-lite',
};

const DAY = 24 * 60 * 60_000;

/**
 * One worker running one version. Workers made with the same caches, site and
 * clock are the same phone: a restart (the browser stops an idle worker), or
 * another version installing.
 */
function setup(files: Record<string, string> = V1, caches = new FakeCaches(), site = new FakeSite(files), clock = { now: Date.UTC(2026, 10, 25, 9) }) {
  const waits: Promise<unknown>[] = [];
  /** What the browser estimates this site may still store (undefined: it can't tell). */
  const estimate: { room?: number } = {};
  /** What the worker told the open pages. */
  const notified: FromWorker[] = [];
  const env: WorkerEnv = {
    manifest: manifestOf(files),
    base: BASE,
    caches: caches as unknown as CacheStorage,
    fetch: site.fetch,
    waitUntil: (p) => void waits.push(p),
    saving: new Map(),
    room: async () => estimate.room,
    now: () => clock.now,
    notify: async (msg) => void notified.push(msg),
    state: { unkept: new Map(), retry: new Set(), newer: false },
  };
  const settle = () => Promise.all(waits);
  /** What the worker answers for a page's GET of a path. */
  const get = async (path: string, mode = 'cors') => {
    const route = routeRequest({ url: BASE + path, method: 'GET', mode }, BASE, env.manifest);
    if (route.kind === 'pass') throw new Error(`${path} passes through`);
    return respond(route, env);
  };
  /** The manifest entry of a file. */
  const entryOf = (path: string): PrecacheEntry => [...env.manifest.app, ...env.manifest.pose].find((e) => e.url === path)!;
  /** Whether a pose file is saved in its own cache. */
  const poseSaved = async (path: string) => !!(await caches.match(BASE + path, { cacheName: poseCacheName(entryOf(path)) }));
  /** The files the phone couldn't keep, by the markers (caches with nothing in them), with when. */
  const marked = () =>
    [...caches.stores.keys()].flatMap((name) => {
      const m = parseUnkept(name);
      const entry = m && [...env.manifest.app, ...env.manifest.pose].find((e) => e.hash === m.hash);
      return m ? [{ url: entry?.url ?? m.hash, at: m.at, empty: caches.stores.get(name)!.entries.size === 0 }] : [];
    });
  /** The same version in a new worker: the browser stopped the idle one (nothing in memory survives). */
  const restart = () => setup(files, caches, site, clock);
  return { env, caches, site, settle, get, estimate, entryOf, poseSaved, notified, clock, marked, restart };
}

const DEFAULT_POSE = ['mediapipe/models/pose_landmarker_full.task', 'mediapipe/wasm/vision_wasm_internal.js', 'mediapipe/wasm/vision_wasm_internal.wasm'];

describe('service worker routing', () => {
  const m = manifestOf(V1);
  const route = (url: string, method = 'GET', mode = 'cors') => routeRequest({ url, method, mode }, BASE, m).kind;

  it('opens the saved page for any visit to the app (routes live in the hash)', () => {
    for (const url of [BASE, `${BASE}index.html`, `${BASE}?source=home-screen`]) {
      const r = routeRequest({ url, method: 'GET', mode: 'navigate' }, BASE, m);
      expect(r.kind).toBe('app');
      expect(r.kind === 'app' && r.entry.url).toBe('index.html');
    }
  });

  it('serves the app’s files from the app cache and pose files from the pose cache', () => {
    expect(route(`${BASE}assets/index-a1.js`)).toBe('app');
    expect(route(`${BASE}manifest.webmanifest`)).toBe('app');
    expect(route(`${BASE}mediapipe/wasm/vision_wasm_internal.wasm`)).toBe('pose');
    expect(route(`${BASE}mediapipe/models/pose_landmarker_lite.task`)).toBe('pose');
  });

  it('passes everything else of this site to the network, untouched', () => {
    expect(route(`${BASE}sw.js`)).toBe('pass');
    expect(route(`${BASE}assets/old-chunk.js`)).toBe('pass');
    expect(route(`${BASE}assets/index-a1.js?x=1`)).toBe('pass');
    expect(route(`${BASE}somewhere`, 'GET', 'navigate')).toBe('pass');
    expect(route(`${BASE}assets/index-a1.js`, 'POST')).toBe('pass');
    expect(route(`${BASE}assets/index-a1.js`, 'HEAD')).toBe('pass');
    expect(route('https://example.github.io/other-project/')).toBe('pass');
  });

  it('refuses every request to another origin, whatever the method', () => {
    expect(route('https://odml.pa.googleapis.com/log', 'POST')).toBe('refuse');
    expect(route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm')).toBe('refuse');
    expect(route('http://example.github.io/Claude/index.html')).toBe('refuse');
    expect(route('https://example.github.io.evil.test/Claude/')).toBe('refuse');
    expect(route('not a url')).toBe('refuse');
  });
});

describe('service worker responses', () => {
  it('answers another origin with a network error', async () => {
    const { env } = setup();
    const res = await respond({ kind: 'refuse' }, env);
    expect(res.type).toBe('error');
    expect(res.status).toBe(0);
  });

  it('serves saved app files from the cache without touching the network', async () => {
    const t = setup();
    await install(t.env);
    t.site.log = [];
    const res = await t.get('assets/index-a1.js');
    expect(await res.text()).toBe(V1['assets/index-a1.js']);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    const page = await t.get('', 'navigate');
    expect(await page.text()).toBe(V1['index.html']);
    expect(t.site.log).toEqual([]);
  });

  it('saves a pose file the first time it is used, then serves it from the cache', async () => {
    const t = setup();
    await install(t.env);
    t.site.log = [];
    const res = await t.get('mediapipe/models/pose_landmarker_full.task');
    expect(await res.text()).toBe(V1['mediapipe/models/pose_landmarker_full.task']);
    // Downloaded past the HTTP cache and CDN: the hash as a query, no-store.
    const entry = t.env.manifest.pose.find((e) => e.url === 'mediapipe/models/pose_landmarker_full.task')!;
    expect(t.site.log.map((l) => l.url)).toEqual([`${BASE}mediapipe/models/pose_landmarker_full.task?v=${entry.hash}`]);
    expect(t.site.log[0].init.cache).toBe('no-store');
    await t.settle();
    // Stored under the clean URL, with its hash.
    const stored = await t.caches.match(`${BASE}mediapipe/models/pose_landmarker_full.task`, { cacheName: poseCacheName(entry) });
    expect(stored?.headers.get(HASH_HEADER)).toBe(entry.hash);
    expect(stored?.headers.get('content-type')).toBe('application/octet-stream');
    t.site.log = [];
    expect(await (await t.get('mediapipe/models/pose_landmarker_full.task')).text()).toBe(V1['mediapipe/models/pose_landmarker_full.task']);
    expect(t.site.log).toEqual([]);
  });

  it('serves a file that changed on the server but does not keep it, and reports that the site has a newer version', async () => {
    const t = setup();
    expect((await status(t.env)).newer).toBe(false);
    t.site.set({ 'mediapipe/models/pose_landmarker_lite.task': 'model-lite, newer deploy' });
    const res = await t.get('mediapipe/models/pose_landmarker_lite.task');
    expect(await res.text()).toBe('model-lite, newer deploy');
    await t.settle();
    const s = await status(t.env);
    expect(s.pose.find((p) => p.url.endsWith('lite.task'))?.saved).toBe(false);
    // Not a lack of room: the page updates first, then saves.
    expect(s.newer).toBe(true);
    expect(s.noRoom).toBe(false);
    // A save starting afresh forgets it.
    await beginSave(t.env, []);
    expect((await status(t.env)).newer).toBe(false);
  });

  it('a stale copy in the HTTP cache is not a newer version', async () => {
    const t = setup();
    await install(t.env);
    t.site.httpCache.set('mediapipe/models/pose_landmarker_full.task', 'model-full, an older build');
    await (await t.get('mediapipe/models/pose_landmarker_full.task')).arrayBuffer();
    await t.settle();
    const s = await status(t.env);
    expect(s.newer).toBe(false);
    expect(s.pose.find((p) => p.url.endsWith('full.task'))?.saved).toBe(true);
  });

  it('a download cut off half-way is neither a newer version nor a phone without room', async () => {
    const t = setup();
    await install(t.env);
    t.env.fetch = (url, init) => {
      if (init.cache === 'only-if-cached') return t.site.fetch(url, init);
      const body = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('model'));
          c.error(new TypeError('network error'));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    };
    await expect((await t.get('mediapipe/models/pose_landmarker_full.task')).arrayBuffer()).rejects.toThrow();
    await t.settle();
    const s = await status(t.env);
    expect(s.newer).toBe(false);
    expect(s.noRoom).toBe(false);
    expect(t.marked()).toEqual([]);
  });

  it('never keeps an error response (and an error is not a newer version)', async () => {
    const t = setup();
    t.site.files.delete('mediapipe/models/pose_landmarker_lite.task');
    const res = await t.get('mediapipe/models/pose_landmarker_lite.task');
    expect(res.status).toBe(404);
    await t.settle();
    expect(Object.keys(t.caches.summary()).filter((n) => n.startsWith('fitee-pose-'))).toEqual([]);
    expect((await status(t.env)).newer).toBe(false);
  });

  it('fails like the network when offline and the file is not saved', async () => {
    const t = setup();
    await install(t.env);
    t.site.offline = true;
    await expect(t.get('mediapipe/wasm/vision_wasm_internal.wasm')).rejects.toThrow(TypeError);
    // The app itself still opens.
    expect(await (await t.get('', 'navigate')).text()).toBe(V1['index.html']);
  });

  it('keeps a file still in the browser’s HTTP cache without downloading it, but never another version’s copy', async () => {
    const t = setup();
    await install(t.env);
    t.site.log = [];
    t.site.cacheLookups = [];
    // E.g. technique checks used before the app could keep files: the model is
    // this version's, the runtime an older one.
    t.site.httpCache.set('mediapipe/models/pose_landmarker_full.task', V1['mediapipe/models/pose_landmarker_full.task']);
    t.site.httpCache.set('mediapipe/wasm/vision_wasm_internal.wasm', 'wasm-simd, an older build');
    const model = await t.get('mediapipe/models/pose_landmarker_full.task');
    expect(await model.text()).toBe(V1['mediapipe/models/pose_landmarker_full.task']);
    expect(model.headers.get('content-type')).toBe('application/octet-stream');
    expect(t.site.log).toEqual([]);
    expect((await status(t.env)).pose.find((p) => p.url.endsWith('full.task'))?.saved).toBe(true);

    const wasm = await t.get('mediapipe/wasm/vision_wasm_internal.wasm');
    expect(await wasm.text()).toBe(V1['mediapipe/wasm/vision_wasm_internal.wasm']);
    expect(t.site.paths()).toEqual(['mediapipe/wasm/vision_wasm_internal.wasm']);
    expect((await status(t.env)).pose.find((p) => p.url.endsWith('internal.wasm'))?.saved).toBe(true);
    // The HTTP cache is asked for the file's own URL, then for its download URL (where a copy the phone couldn't keep lands).
    const wasmHash = t.entryOf('mediapipe/wasm/vision_wasm_internal.wasm').hash;
    expect(t.site.cacheLookups).toEqual([
      'mediapipe/models/pose_landmarker_full.task',
      'mediapipe/wasm/vision_wasm_internal.wasm',
      `mediapipe/wasm/vision_wasm_internal.wasm?v=${wasmHash}`,
    ]);
  });

  it('downloads a file once when a second request for it comes while the first is on its way', async () => {
    // E.g. a technique check opened while "Save for offline use" downloads the runtime.
    const t = setup();
    await install(t.env);
    t.site.log = [];
    let release!: () => void;
    t.site.gate = new Promise((r) => (release = r));
    const path = 'mediapipe/wasm/vision_wasm_internal.wasm';
    const first = t.get(path);
    const second = t.get(path);
    await new Promise((r) => setTimeout(r, 10));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(await a.text()).toBe(V1[path]);
    expect(await b.text()).toBe(V1[path]);
    expect(t.site.paths()).toEqual([path]);
    await t.settle();
    expect(await t.poseSaved(path)).toBe(true);
  });

  it('a request waiting for a download that fails tries for itself', async () => {
    const t = setup();
    await install(t.env);
    t.site.log = [];
    const path = 'mediapipe/models/pose_landmarker_lite.task';
    t.site.failNext = 1; // e.g. mid-deploy
    let release!: () => void;
    t.site.gate = new Promise((r) => (release = r));
    const first = t.get(path);
    const second = t.get(path);
    await new Promise((r) => setTimeout(r, 10));
    release();
    expect((await first).status).toBe(404);
    expect(await (await second).text()).toBe(V1[path]);
    expect(t.site.paths()).toEqual([path, path]);
    await t.settle();
    expect(await t.poseSaved(path)).toBe(true);
  });

  it('never follows a redirect, in downloads and in HTTP cache lookups alike', async () => {
    const t = setup();
    t.site.httpCache.set('assets/index-a1.js', V1['assets/index-a1.js']);
    await install(t.env);
    await (await t.get('mediapipe/models/pose_landmarker_full.task')).arrayBuffer();
    await t.settle();
    t.estimate.room = 0;
    await (await t.get('mediapipe/models/pose_landmarker_lite.task')).arrayBuffer();
    expect(t.site.inits.length).toBeGreaterThan(5);
    expect(t.site.inits.every((i) => i.redirect === 'error')).toBe(true);
  });

  it('still opens the app online when Cache Storage fails', async () => {
    const t = setup();
    await install(t.env);
    t.caches.broken = true;
    t.site.log = [];
    const page = await t.get('', 'navigate');
    expect(await page.text()).toBe(V1['index.html']);
    expect(await (await t.get('assets/index-a1.js')).text()).toBe(V1['assets/index-a1.js']);
    expect(await (await t.get('mediapipe/models/pose_landmarker_full.task')).text()).toBe(V1['mediapipe/models/pose_landmarker_full.task']);
    expect(t.site.paths()).toEqual(['index.html', 'assets/index-a1.js', 'mediapipe/models/pose_landmarker_full.task']);
    await t.settle();
    // And offline it fails like the network, rather than hanging.
    t.site.offline = true;
    await expect(t.get('assets/index-b2.css')).rejects.toThrow(TypeError);
  });

  it('with no room on the phone, serves a pose file without keeping it, and says why', async () => {
    const t = setup();
    await install(t.env);
    t.caches.quota = t.caches.used() + 4; // the phone is full
    t.site.log = [];
    const path = 'mediapipe/models/pose_landmarker_full.task';
    expect(await (await t.get(path)).text()).toBe(V1[path]);
    await t.settle();
    let s = await status(t.env);
    expect(s.noRoom).toBe(true);
    expect(s.newer).toBe(false);
    expect(s.pose.find((p) => p.url === path)?.unkeptAt).toBe(t.clock.now);
    expect(s.pose.some((p) => p.saved)).toBe(false);
    expect(t.site.log[0].init.cache).toBe('no-store');
    // When the browser can tell there's no room, a save says so before anything is downloaded…
    t.estimate.room = 3;
    t.site.log = [];
    expect(await beginSave(t.env, [path])).toBe(false);
    // …and a technique check meanwhile gets the file through the HTTP cache, like any web file.
    expect(await (await t.get(path)).text()).toBe(V1[path]);
    expect(t.site.log.map((l) => l.init.cache)).toEqual(['default']);
    expect(t.site.log[0].url).toContain('?v=');
    expect((await status(t.env)).noRoom).toBe(true);
    // Room again, and a save asks to try again: kept, from the copy the HTTP cache got meanwhile
    // (nothing downloaded again), and the status says so.
    t.caches.quota = Infinity;
    t.estimate.room = undefined;
    t.site.log = [];
    expect(await beginSave(t.env, [path])).toBe(true);
    await (await t.get(path)).arrayBuffer();
    await t.settle();
    expect(t.site.log).toEqual([]);
    s = await status(t.env);
    expect(s.noRoom).toBe(false);
    expect(await t.poseSaved(path)).toBe(true);
    expect(t.marked()).toEqual([]);
  });

  it('a store refused for any other reason (Chromium on a full disk: UnknownError, estimate showing room) counts as no room: remembered, then through the HTTP cache until a save asks to try again', async () => {
    const t = setup();
    await install(t.env);
    t.estimate.room = 2 ** 30; // Chromium's fixed headroom, however full the disk
    t.caches.refuse = refusePose;
    t.site.log = [];
    const path = 'mediapipe/models/pose_landmarker_full.task';
    // The page still gets the file.
    expect(await (await t.get(path)).text()).toBe(V1[path]);
    await t.settle();
    expect(t.site.log.map((l) => l.init.cache)).toEqual(['no-store']);
    let s = await status(t.env);
    expect(s.noRoom).toBe(true);
    expect(await t.poseSaved(path)).toBe(false);
    // Remembered by an empty marker cache, named for the file and the time.
    const first = t.clock.now;
    expect(t.marked()).toEqual([{ url: path, at: first, empty: true }]);
    // From then on it goes through the HTTP cache, unsaved, instead of past it at every technique check…
    t.clock.now += 60_000;
    t.site.log = [];
    expect(await (await t.get(path)).text()).toBe(V1[path]);
    await t.settle();
    expect(t.site.log.map((l) => l.init.cache)).toEqual(['default']);
    expect(t.site.log[0].url).toContain('?v=');
    // …so a repeat comes from the HTTP cache, where it has room for it, not the network.
    t.site.log = [];
    expect(await (await t.get(path)).text()).toBe(V1[path]);
    expect(t.site.log).toEqual([]);
    // A save ("Save for offline use", Try again, the auto-save) asks the worker to try once more:
    // still refused, so the week still runs from the first time.
    t.clock.now += DAY;
    expect(await beginSave(t.env, [path])).toBe(true);
    expect(await (await t.get(path)).text()).toBe(V1[path]);
    await t.settle();
    expect(t.marked()).toEqual([{ url: path, at: first, empty: true }]);
    expect((await status(t.env)).noRoom).toBe(true);
    // Once the phone can keep it, the next save keeps it, and the mark goes.
    t.caches.refuse = undefined;
    await beginSave(t.env, [path]);
    await (await t.get(path)).arrayBuffer();
    await t.settle();
    s = await status(t.env);
    expect(s.noRoom).toBe(false);
    expect(await t.poseSaved(path)).toBe(true);
    expect(t.marked()).toEqual([]);
  });

  it('remembers a pose file the phone couldn’t keep after the worker restarts: through the HTTP cache for a week, then it tries to keep it again', async () => {
    const t = setup();
    await install(t.env);
    t.caches.refuse = refusePose;
    const path = 'mediapipe/models/pose_landmarker_full.task';
    await (await t.get(path)).arrayBuffer();
    await t.settle();
    // The browser stops the idle worker; a technique check later that day starts a new one.
    t.clock.now += 6 * 60 * 60_000;
    let w = t.restart();
    w.site.log = [];
    const s = await status(w.env);
    expect(s.noRoom).toBe(true);
    expect(s.pose.find((p) => p.url === path)?.unkeptAt).toBe(t.clock.now - 6 * 60 * 60_000);
    w.site.httpCache.clear(); // a really full disk: the HTTP cache couldn't hold it either
    expect(await (await w.get(path)).text()).toBe(V1[path]);
    await w.settle();
    expect(w.site.log.map((l) => l.init.cache)).toEqual(['default']);
    // A week on, it's tried again (once): still refused, and that starts a new week.
    t.clock.now += NO_ROOM_RETRY_MS;
    w = t.restart();
    w.site.httpCache.clear();
    w.site.log = [];
    await (await w.get(path)).arrayBuffer();
    await w.settle();
    expect(w.site.log.map((l) => l.init.cache)).toEqual(['no-store']);
    expect(w.marked()).toEqual([{ url: path, at: t.clock.now, empty: true }]);
  });

  it('a save stops before downloading when the browser’s estimate shows no room for all it needs, and that counts as couldn’t keep', async () => {
    const t = setup();
    await install(t.env);
    t.site.log = [];
    t.estimate.room = 20; // room for the model (10 bytes) but not the runtime too
    const files = ['mediapipe/models/pose_landmarker_full.task', 'mediapipe/wasm/vision_wasm_internal.js', 'mediapipe/wasm/vision_wasm_internal.wasm'];
    expect(await beginSave(t.env, files)).toBe(false);
    expect(t.site.log).toEqual([]);
    expect(t.marked().map((m) => m.url).sort()).toEqual([...files].sort());
    expect((await status(t.env)).noRoom).toBe(true);
  });

  it('remembers only that the phone couldn’t keep an app file (it holds back an install), and doesn’t report it as the pose model', async () => {
    const t = setup();
    await install(t.env);
    // An app file missing from its cache (e.g. Cache Storage lost it) is fetched on use; the phone refuses to keep it.
    const appCache = t.caches.stores.get(cacheNames(t.env.manifest).app)!;
    appCache.entries.delete(`${BASE}assets/index-a1.js`);
    t.caches.refuse = (url) => (url.endsWith('/index-a1.js') ? fullDisk() : undefined);
    expect(await (await t.get('assets/index-a1.js')).text()).toBe(V1['assets/index-a1.js']);
    await t.settle();
    expect(t.marked().map((m) => m.url)).toEqual(['assets/index-a1.js']);
    expect((await status(t.env)).noRoom).toBe(false);
  });

  it('where Cache Storage can’t even hold a marker, remembers in memory while the worker runs', async () => {
    const t = setup();
    await install(t.env);
    t.caches.refuse = refusePose;
    const open = t.caches.open.bind(t.caches);
    t.caches.open = async (name: string) => {
      if (name.startsWith('fitee-unkept-')) throw fullDisk();
      return open(name);
    };
    const path = 'mediapipe/models/pose_landmarker_full.task';
    await (await t.get(path)).arrayBuffer();
    await t.settle();
    expect(t.marked()).toEqual([]);
    expect((await status(t.env)).pose.find((p) => p.url === path)?.unkeptAt).toBe(t.clock.now);
    t.site.log = [];
    t.site.httpCache.clear();
    await (await t.get(path)).arrayBuffer();
    expect(t.site.log.map((l) => l.init.cache)).toEqual(['default']);
  });

  it('reports saves still running once they land', async () => {
    const t = setup();
    await install(t.env);
    const res = await t.get('mediapipe/wasm/vision_wasm_internal.js');
    await res.text();
    const s = await status(t.env);
    expect(s.pose.find((p) => p.url === 'mediapipe/wasm/vision_wasm_internal.js')?.saved).toBe(true);
    expect(s.app).toEqual({ files: 4, saved: 4, bytes: t.env.manifest.app.reduce((n, e) => n + e.size, 0) });
  });
});

describe('service worker install, cache names and clean-up', () => {
  it('names the app’s cache by the hash of its files, and each pose file’s cache by that file’s hash', () => {
    const a = cacheNames(manifestOf(V1));
    expect(a.app).toMatch(/^fitee-app-[0-9a-f]{16}$/);
    expect(a.pose).toHaveLength(6);
    for (const name of a.pose) expect(name).toMatch(/^fitee-pose-[0-9a-f]{16}$/);
    expect(a.pose).toContain(`fitee-pose-${sha16(V1['mediapipe/models/pose_landmarker_full.task'])}`);
    expect(cacheNames(manifestOf(V1))).toEqual(a);
    const appChanged = cacheNames(manifestOf({ ...V1, 'index.html': 'v2' }));
    expect(appChanged.app).not.toBe(a.app);
    expect(appChanged.pose).toEqual(a.pose);
    // A new model changes that one file's cache and no other.
    const poseChanged = cacheNames(manifestOf({ ...V1, 'mediapipe/models/pose_landmarker_full.task': 'model-full v2' }));
    expect(poseChanged.app).toBe(a.app);
    expect(poseChanged.pose.filter((n) => !a.pose.includes(n))).toEqual([`fitee-pose-${sha16('model-full v2')}`]);
  });

  it('deletes only this app’s caches that the current version doesn’t use', () => {
    expect(cachesToDelete(['fitee-app-1', 'fitee-app-2', 'fitee-pose-1', 'workbox-precache', 'other'], ['fitee-app-2', 'fitee-pose-1'])).toEqual(['fitee-app-1']);
  });

  it('first install saves the app (each file once, past the HTTP cache) and no pose files', async () => {
    const t = setup();
    await install(t.env);
    expect(t.site.paths().sort()).toEqual(['assets/index-a1.js', 'assets/index-b2.css', 'index.html', 'manifest.webmanifest']);
    expect(t.site.log.every((l) => l.init.cache === 'no-store' && /\?v=[0-9a-f]{16}$/.test(l.url))).toBe(true);
    const s = await status(t.env);
    expect(s.app.saved).toBe(4);
    expect(s.pose.every((p) => !p.saved)).toBe(true);
    // Installing again (e.g. a retry) downloads nothing.
    t.site.log = [];
    await install(t.env);
    expect(t.site.log).toEqual([]);
  });

  it('first install keeps what the page just loaded from the browser’s HTTP cache, checked against its hash', async () => {
    const t = setup();
    // The page loaded its code and styles a moment ago; the HTTP cache also
    // holds an older manifest. The page itself was loaded as "/", not "index.html".
    t.site.httpCache.set('', V1['index.html']);
    t.site.httpCache.set('assets/index-a1.js', V1['assets/index-a1.js']);
    t.site.httpCache.set('assets/index-b2.css', V1['assets/index-b2.css']);
    t.site.httpCache.set('manifest.webmanifest', '{"name":"an older fitee"}');
    await install(t.env);
    expect(t.site.paths().sort()).toEqual(['index.html', 'manifest.webmanifest']);
    expect((await status(t.env)).app.saved).toBe(4);
    t.site.offline = true;
    expect(await (await t.get('manifest.webmanifest')).text()).toBe(V1['manifest.webmanifest']);
    expect(await (await t.get('assets/index-a1.js')).text()).toBe(V1['assets/index-a1.js']);
    expect(await (await t.get('', 'navigate')).text()).toBe(V1['index.html']);
  });

  it('an update downloads only the changed files and keeps the saved pose files without downloading them', async () => {
    const caches = new FakeCaches();
    const v1 = setup(V1, caches);
    await install(v1.env);
    await activate(v1.env);
    for (const p of ['mediapipe/wasm/vision_wasm_internal.js', 'mediapipe/wasm/vision_wasm_internal.wasm', 'mediapipe/models/pose_landmarker_full.task'])
      await (await v1.get(p)).arrayBuffer();
    await v1.settle();

    const V2 = { ...V1, 'index.html': '<!doctype html><title>fitee 2</title>', 'assets/index-c3.js': 'console.log("app v2")' };
    delete (V2 as Partial<typeof V2>)['assets/index-a1.js'];
    const v2 = setup(V2, caches, new FakeSite(V2));
    await install(v2.env);
    expect(v2.site.paths().sort()).toEqual(['assets/index-c3.js', 'index.html']);
    // Until it activates, the old version keeps working from its own caches.
    expect(await (await v1.get('assets/index-a1.js')).text()).toBe(V1['assets/index-a1.js']);

    const deleted = await activate(v2.env);
    expect(deleted).toEqual([cacheNames(v1.env.manifest).app]);
    expect((await caches.keys()).sort()).toEqual([cacheNames(v2.env.manifest).app, ...DEFAULT_POSE.map((p) => poseCacheName(v2.entryOf(p)))].sort());
    const s = await status(v2.env);
    expect(s.pose.filter((p) => p.saved).map((p) => p.url)).toEqual([
      'mediapipe/models/pose_landmarker_full.task',
      'mediapipe/wasm/vision_wasm_internal.js',
      'mediapipe/wasm/vision_wasm_internal.wasm',
    ]);
    v2.site.log = [];
    v2.site.offline = true;
    expect(await (await v2.get('mediapipe/models/pose_landmarker_full.task')).text()).toBe(V1['mediapipe/models/pose_landmarker_full.task']);
    expect(await (await v2.get('', 'navigate')).text()).toBe(V2['index.html']);
  });

  it('a changed pose file the phone had saved is downloaded again; ones it never saved are not', async () => {
    const caches = new FakeCaches();
    const v1 = setup(V1, caches);
    await install(v1.env);
    await activate(v1.env);
    for (const p of ['mediapipe/wasm/vision_wasm_internal.wasm', 'mediapipe/models/pose_landmarker_full.task']) await (await v1.get(p)).arrayBuffer();
    await v1.settle();

    const V2 = { ...V1, 'mediapipe/models/pose_landmarker_full.task': 'model-full v2', 'mediapipe/models/pose_landmarker_lite.task': 'model-lite v2' };
    const v2 = setup(V2, caches, new FakeSite(V2));
    await install(v2.env);
    // The full model was saved and changed: downloaded. The lite one was never saved: left alone.
    expect(v2.site.paths()).toEqual(['mediapipe/models/pose_landmarker_full.task']);
    // The runtime stayed where it was: its cache has the same name in both versions, nothing was copied.
    expect(caches.summary()[poseCacheName(v2.entryOf('mediapipe/wasm/vision_wasm_internal.wasm'))]).toEqual(['mediapipe/wasm/vision_wasm_internal.wasm']);
    await activate(v2.env);
    expect(await caches.has(poseCacheName(v1.entryOf('mediapipe/models/pose_landmarker_full.task')))).toBe(false);
    const saved = (await status(v2.env)).pose.filter((p) => p.saved).map((p) => p.url);
    expect(saved).toEqual(['mediapipe/models/pose_landmarker_full.task', 'mediapipe/wasm/vision_wasm_internal.wasm']);
  });

  it('a pose-file update needs room only for the file that changed', async () => {
    const caches = new FakeCaches();
    const v1 = setup(V1, caches);
    await install(v1.env);
    await activate(v1.env);
    for (const p of DEFAULT_POSE) await (await v1.get(p)).arrayBuffer();
    await v1.settle();
    // Room for one more model, not for a second copy of the runtime.
    caches.quota = caches.used() + Buffer.byteLength('model-full v2') + 2;
    const V2 = { ...V1, 'mediapipe/models/pose_landmarker_full.task': 'model-full v2' };
    const v2 = setup(V2, caches, new FakeSite(V2));
    await install(v2.env);
    await activate(v2.env);
    expect((await status(v2.env)).pose.filter((p) => p.saved).map((p) => p.url)).toEqual(DEFAULT_POSE);
  });

  /** A phone with the default pose files saved (v1 running), and an update (v2) to the same caches, site and clock. */
  async function savedThenUpdate(V2: Record<string, string>) {
    const caches = new FakeCaches();
    const v1 = setup(V1, caches);
    await install(v1.env);
    await activate(v1.env);
    for (const p of DEFAULT_POSE) await (await v1.get(p)).arrayBuffer();
    await v1.settle();
    const site = new FakeSite(V2);
    const v2 = () => setup(V2, caches, site, v1.clock);
    return { caches, v1, site, v2 };
  }

  it('an update that changes a pose file the phone had saved waits for room for the new copy: the current version keeps its copy and works offline, and the open pages are told what it needs', async () => {
    const V2 = { ...V1, 'index.html': 'v2 page!', 'mediapipe/models/pose_landmarker_full.task': 'model-full v2' };
    const { caches, v1, site, v2 } = await savedThenUpdate(V2);
    // Chromium on a really full disk: the estimate shows plenty of room, and the store is refused anyway.
    caches.refuse = refusePose;
    const w = v2();
    w.estimate.room = 2 ** 30;
    await expect(install(w.env)).rejects.toThrow(/couldn't keep mediapipe\/models\/pose_landmarker_full\.task/);
    // Downloaded once, couldn't be kept: the install fails, so the update never applies without it.
    expect(site.paths().sort()).toEqual(['index.html', 'mediapipe/models/pose_landmarker_full.task']);
    // The room it needs: everything it writes (its copy of the app, and the new model).
    const appBytes = w.env.manifest.app.reduce((n, e) => n + e.size, 0);
    expect(w.notified).toEqual([{ type: 'install-no-room', version: w.env.manifest.version, bytes: appBytes + Buffer.byteLength('model-full v2') }]);
    expect(w.marked()).toEqual([{ url: 'mediapipe/models/pose_landmarker_full.task', at: v1.clock.now, empty: true }]);
    // Its own app cache is gone again (room counts on a full phone); the running version's caches are untouched.
    expect(await caches.has(cacheNames(w.env.manifest).app)).toBe(false);
    expect((await status(v1.env)).pose.filter((p) => p.saved).map((p) => p.url)).toEqual(DEFAULT_POSE);
    v1.site.offline = true;
    expect(await (await v1.get('mediapipe/models/pose_landmarker_full.task')).text()).toBe(V1['mediapipe/models/pose_landmarker_full.task']);
    expect(await (await v1.get('', 'navigate')).text()).toBe(V1['index.html']);
  });

  it('a held update doesn’t download what the phone couldn’t keep again for a week (the browser tries at every launch); then it tries once more', async () => {
    const V2 = { ...V1, 'index.html': 'v2 page!', 'mediapipe/models/pose_landmarker_full.task': 'model-full v2' };
    const { caches, v1, site, v2 } = await savedThenUpdate(V2);
    caches.refuse = refusePose;
    await expect(install(v2().env)).rejects.toThrow(/couldn't keep/);
    const firstTry = v1.clock.now;
    // Launches over the next days: each is a new worker for the new version; nothing is downloaded.
    for (const days of [1, 3, 6]) {
      v1.clock.now = firstTry + days * DAY;
      site.log = [];
      const w = v2();
      await expect(install(w.env)).rejects.toThrow(/couldn't keep/);
      expect(site.log).toEqual([]);
      // The pages are still told, each time, what it needs (the page that opens may not have been there before).
      expect(w.notified.map((m) => m.bytes)).toEqual([w.env.manifest.app.reduce((n, e) => n + e.size, 0) + Buffer.byteLength('model-full v2')]);
    }
    // A week on: tried again, and still refused (a new week from now).
    v1.clock.now = firstTry + 7 * DAY;
    site.log = [];
    const w = v2();
    await expect(install(w.env)).rejects.toThrow(/couldn't keep/);
    expect(site.paths().sort()).toEqual(['index.html', 'mediapipe/models/pose_landmarker_full.task']);
    expect(w.marked()).toEqual([{ url: 'mediapipe/models/pose_landmarker_full.task', at: v1.clock.now, empty: true }]);
  });

  it('once there’s room and the marks are forgotten (Try again), the held update installs; when it applies, the old copy goes and nothing is left marked', async () => {
    const V2 = { ...V1, 'index.html': 'v2 page!', 'mediapipe/models/pose_landmarker_full.task': 'model-full v2' };
    const { caches, v1, site, v2 } = await savedThenUpdate(V2);
    caches.refuse = refusePose;
    await expect(install(v2().env)).rejects.toThrow(/couldn't keep/);
    // The user frees up space and taps Try again: the page deletes the markers (its worker for v2 isn't running).
    caches.refuse = undefined;
    for (const name of [...caches.stores.keys()]) if (parseUnkept(name)) await caches.delete(name);
    site.log = [];
    const w = v2();
    await install(w.env);
    expect(site.paths().sort()).toEqual(['index.html', 'mediapipe/models/pose_landmarker_full.task']);
    await activate(w.env);
    expect(await caches.has(poseCacheName(v1.entryOf('mediapipe/models/pose_landmarker_full.task')))).toBe(false);
    expect((await status(w.env)).pose.filter((p) => p.saved).map((p) => p.url)).toEqual(DEFAULT_POSE);
    expect(w.marked()).toEqual([]);
    w.site.offline = true;
    expect(await (await w.get('mediapipe/models/pose_landmarker_full.task')).text()).toBe('model-full v2');
  });

  it('with no room by the browser’s estimate for a changed pose file the phone had saved, the update waits without downloading it', async () => {
    const V2 = { ...V1, 'mediapipe/wasm/vision_wasm_internal.wasm': 'wasm-simd v2' };
    const { v1, site, v2 } = await savedThenUpdate(V2);
    const w = v2();
    w.estimate.room = 3;
    await expect(install(w.env)).rejects.toThrow(/couldn't keep mediapipe\/wasm\/vision_wasm_internal\.wasm/);
    expect(site.log).toEqual([]);
    expect(w.notified.map((m) => m.bytes)).toEqual([Buffer.byteLength('wasm-simd v2')]);
    // A deploy that changes only pose files keeps the app's cache name: the running version's, never deleted.
    expect(await (await v1.get('', 'navigate')).text()).toBe(V1['index.html']);
    expect((await status(v1.env)).app.saved).toBe(4);
  });

  it('an update that changes only the app, on a phone that can’t keep it, waits too, and isn’t downloaded again for a day (the app’s files are small)', async () => {
    const V2 = { ...V1, 'index.html': 'v2 page, new bundle', 'assets/index-j9.js': 'console.log("app v2, a new bundle")' };
    delete (V2 as Partial<typeof V2>)['assets/index-a1.js'];
    const caches = new FakeCaches();
    const v1 = setup(V1, caches);
    await install(v1.env);
    await activate(v1.env);
    caches.refuse = (url) => (url.endsWith('/index-j9.js') ? fullDisk() : undefined);
    const site = new FakeSite(V2);
    const w = setup(V2, caches, site, v1.clock);
    await expect(install(w.env)).rejects.toThrow(/couldn't keep assets\/index-j9\.js/);
    expect(w.notified.map((m) => m.bytes)).toEqual([w.env.manifest.app.reduce((n, e) => n + e.size, 0)]);
    expect(await caches.has(cacheNames(w.env.manifest).app)).toBe(false);
    // The next update checks that day download nothing.
    const firstTry = v1.clock.now;
    site.log = [];
    v1.clock.now = firstTry + DAY - 60_000;
    await expect(install(setup(V2, caches, site, v1.clock).env)).rejects.toThrow(/couldn't keep/);
    expect(site.log).toEqual([]);
    // The running version is untouched.
    expect(await (await v1.get('assets/index-a1.js')).text()).toBe(V1['assets/index-a1.js']);
    // A day on, it's tried again; with room by then, it installs.
    v1.clock.now = firstTry + DAY;
    caches.refuse = undefined;
    await install(setup(V2, caches, site, v1.clock).env);
    expect(site.paths().sort()).toEqual(['assets/index-j9.js', 'index.html']);
  });

  it('a first install on a phone that can’t keep the app tells the page, and the next launch that day downloads nothing (Try again does)', async () => {
    const caches = new FakeCaches();
    caches.refuse = (url) => (url.endsWith('/index-a1.js') ? fullDisk() : undefined);
    const t = setup(V1, caches);
    await expect(install(t.env)).rejects.toThrow(/couldn't keep assets\/index-a1\.js/);
    // It needs room for the whole app (the cache it made is gone again).
    expect(t.notified).toEqual([{ type: 'install-no-room', version: t.env.manifest.version, bytes: t.env.manifest.app.reduce((n, e) => n + e.size, 0) }]);
    t.site.log = [];
    const again = t.restart();
    await expect(install(again.env)).rejects.toThrow(/couldn't keep/);
    expect(t.site.log).toEqual([]);
    expect(again.notified).toHaveLength(1);
    // Try again, after making room: the page forgets the marks first.
    caches.refuse = undefined;
    for (const name of [...caches.stores.keys()]) if (parseUnkept(name)) await caches.delete(name);
    await install(t.restart().env);
    expect((await status(t.env)).app.saved).toBe(4);
  });

  it('pose files saved while an update that changes another pose file waits are still saved once it applies', async () => {
    const caches = new FakeCaches();
    const v1 = setup(V1, caches);
    await install(v1.env);
    await activate(v1.env);
    // The update (a new lite model) installs before anything was saved, and waits.
    const V2 = { ...V1, 'mediapipe/models/pose_landmarker_lite.task': 'model-lite v2' };
    const v2 = setup(V2, caches, new FakeSite(V2));
    await install(v2.env);
    // Meanwhile the running version saves the default pose files ("Save for offline use").
    for (const p of DEFAULT_POSE) await (await v1.get(p)).arrayBuffer();
    await v1.settle();
    await activate(v2.env);
    expect((await status(v2.env)).pose.filter((p) => p.saved).map((p) => p.url)).toEqual(DEFAULT_POSE);
    v2.site.offline = true;
    expect(await (await v2.get('mediapipe/models/pose_landmarker_full.task')).text()).toBe(V1['mediapipe/models/pose_landmarker_full.task']);
  });

  it('a failed install changes nothing the current version uses, and a retry picks up where it stopped', async () => {
    const caches = new FakeCaches();
    const v1 = setup(V1, caches);
    await install(v1.env);
    await activate(v1.env);
    const before = (await caches.keys()).sort();

    const V2 = { ...V1, 'index.html': 'v2 page', 'assets/index-b2.css': 'body{color:red}' };
    const site = new FakeSite(V2);
    site.files.delete('assets/index-b2.css'); // e.g. the site was mid-deploy
    const v2 = setup(V2, caches, site);
    await expect(install(v2.env)).rejects.toThrow(/index-b2\.css/);
    expect(await (await v1.get('', 'navigate')).text()).toBe(V1['index.html']);
    expect((await caches.keys()).filter((n) => before.includes(n)).sort()).toEqual(before);

    site.set({ 'assets/index-b2.css': 'body{color:red}' });
    site.log = [];
    await install(v2.env);
    expect(site.paths()).toEqual(['assets/index-b2.css']);
  });

  it('fails an install whose caches another version deleted meanwhile, so the browser tries again', async () => {
    const caches = new FakeCaches();
    const v1 = setup(V1, caches);
    await install(v1.env);
    await activate(v1.env);
    const V2 = { ...V1, 'index.html': 'v2 page' };
    const v2 = setup(V2, caches, new FakeSite(V2));
    // While v2 downloads, the version before it activates ("Update now") and
    // deletes the caches it doesn't use: v2's new app cache among them.
    const download = v2.env.fetch;
    let cleaned = false;
    v2.env.fetch = async (url, init) => {
      if (!cleaned && init.cache !== 'only-if-cached') {
        cleaned = true;
        await activate(v1.env);
      }
      return download(url, init);
    };
    await expect(install(v2.env)).rejects.toThrow(/wasn't kept/);
    await install(v2.env);
    const s = await status(v2.env);
    expect(s.app.saved).toBe(s.app.files);
  });

  it('fails an install with no room for the app itself (it is retried later), which says nothing about the pose model', async () => {
    const caches = new FakeCaches();
    caches.quota = 10;
    const t = setup(V1, caches);
    await expect(install(t.env)).rejects.toThrow(/couldn't keep/);
    expect((await status(t.env)).noRoom).toBe(false);
    // The cache it made is gone again (the 6-byte stylesheet that fitted with it), so it needs room for the whole app.
    expect(await caches.has(cacheNames(t.env.manifest).app)).toBe(false);
    expect(t.notified.map((m) => m.bytes)).toEqual([t.env.manifest.app.reduce((n, e) => n + e.size, 0)]);
  });

  it('fails an install when the phone refuses to store one of the app’s own files for any reason (they must all be there)', async () => {
    const first = new FakeCaches();
    first.refuse = (url) => (url.endsWith('/index.html') ? fullDisk() : undefined);
    const t = setup(V1, first);
    await expect(install(t.env)).rejects.toThrow(/couldn't keep index\.html/);
    expect((await status(t.env)).noRoom).toBe(false);
    // An update copying an unchanged app file from the old version's cache, refused too.
    const caches = new FakeCaches();
    const v1 = setup(V1, caches);
    await install(v1.env);
    await activate(v1.env);
    const V2 = { ...V1, 'index.html': 'v2 page' };
    const v2 = setup(V2, caches, new FakeSite(V2));
    caches.refuse = (url) => (url.endsWith('/index-b2.css') ? fullDisk() : undefined);
    await expect(install(v2.env)).rejects.toThrow(/couldn't keep assets\/index-b2\.css/);
  });

  it('refuses to keep a version whose files on the server are not the ones it lists', async () => {
    const site = new FakeSite({ ...V1, 'assets/index-a1.js': 'console.log("a newer deploy")' });
    const t = setup(V1, new FakeCaches(), site);
    await expect(install(t.env)).rejects.toThrow(/doesn't match/);
    expect((await status(t.env)).newer).toBe(true);
  });

  it('activation keeps the marks of its own pose files (the week carries on) and deletes every other mark', async () => {
    const caches = new FakeCaches();
    const v1 = setup(V1, caches);
    await install(v1.env);
    await activate(v1.env);
    const lite = v1.entryOf('mediapipe/models/pose_landmarker_lite.task');
    const old = unkeptCacheName('0123456789abcdef', v1.clock.now - DAY);
    await caches.open(unkeptCacheName(lite.hash, v1.clock.now - DAY));
    await caches.open(old);
    const V2 = { ...V1, 'index.html': 'v2 page' };
    const v2 = setup(V2, caches, new FakeSite(V2), v1.clock);
    await install(v2.env);
    const deleted = await activate(v2.env);
    expect(deleted).toContain(old);
    expect(v2.marked()).toEqual([{ url: lite.url, at: v1.clock.now - DAY, empty: true }]);
    // So the lite model still goes through the HTTP cache instead of being downloaded to keep.
    v2.site.log = [];
    await (await v2.get(lite.url)).arrayBuffer();
    expect(v2.site.log.map((l) => l.init.cache)).toEqual(['default']);
  });

  it('never touches caches that are not this app’s', async () => {
    const caches = new FakeCaches();
    await caches.open('someone-elses-cache');
    const t = setup(V1, caches);
    await install(t.env);
    await activate(t.env);
    expect(await caches.has('someone-elses-cache')).toBe(true);
  });
});
