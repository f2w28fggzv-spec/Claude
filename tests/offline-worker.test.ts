// The service worker's logic (src/offline/worker.ts) run against an in-memory
// Cache Storage and a fake network: request routing, saving on use (one
// download per file), install (reusing unchanged files), cache names and
// clean-up across versions, a full phone, and a failing Cache Storage.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildManifest, cacheNames, cachesToDelete, HASH_HEADER, poseCacheName, type PrecacheEntry, type PrecacheManifest } from '../src/offline/manifest';
import { activate, install, respond, routeRequest, status, type WorkerEnv } from '../src/offline/worker';

const BASE = 'https://example.github.io/Claude/';

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
 * front of it, the browser's HTTP cache (path → what it holds, possibly an
 * older version), which `cache: 'only-if-cached'` reads without the network.
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
      const cached = this.httpCache.get(path);
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
    return body === undefined ? new Response('not found', { status: 404 }) : new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
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

function setup(files: Record<string, string> = V1, caches = new FakeCaches(), site = new FakeSite(files)) {
  const waits: Promise<unknown>[] = [];
  /** What the browser estimates this site may still store (undefined: it can't tell). */
  const estimate: { room?: number } = {};
  const env: WorkerEnv = {
    manifest: manifestOf(files),
    base: BASE,
    caches: caches as unknown as CacheStorage,
    fetch: site.fetch,
    waitUntil: (p) => void waits.push(p),
    saving: new Map(),
    room: async () => estimate.room,
    state: { noRoom: new Set() },
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
  return { env, caches, site, settle, get, estimate, entryOf, poseSaved };
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

  it('serves a file that changed on the server but does not keep it', async () => {
    const t = setup();
    t.site.set({ 'mediapipe/models/pose_landmarker_lite.task': 'model-lite, newer deploy' });
    const res = await t.get('mediapipe/models/pose_landmarker_lite.task');
    expect(await res.text()).toBe('model-lite, newer deploy');
    await t.settle();
    expect((await status(t.env)).pose.find((p) => p.url.endsWith('lite.task'))?.saved).toBe(false);
  });

  it('never keeps an error response', async () => {
    const t = setup();
    t.site.files.delete('mediapipe/models/pose_landmarker_lite.task');
    const res = await t.get('mediapipe/models/pose_landmarker_lite.task');
    expect(res.status).toBe(404);
    await t.settle();
    expect(Object.keys(t.caches.summary()).filter((n) => n.startsWith('fitee-pose-'))).toEqual([]);
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
    // The HTTP cache is only ever asked for the clean URL.
    expect(t.site.cacheLookups).toEqual(['mediapipe/models/pose_landmarker_full.task', 'mediapipe/wasm/vision_wasm_internal.wasm']);
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
    expect(s.pose.some((p) => p.saved)).toBe(false);
    expect(t.site.log[0].init.cache).toBe('no-store');
    // When the browser can tell there's no room, the file isn't even tried: it goes through the
    // HTTP cache like any web file, so a repeat is checked, not downloaded again.
    t.estimate.room = 3;
    t.site.log = [];
    expect(await (await t.get(path)).text()).toBe(V1[path]);
    expect(t.site.log.map((l) => l.init.cache)).toEqual(['default']);
    expect(t.site.log[0].url).toContain('?v=');
    // Room again: saved, and the status says so.
    t.caches.quota = Infinity;
    t.estimate.room = undefined;
    await (await t.get(path)).arrayBuffer();
    await t.settle();
    s = await status(t.env);
    expect(s.noRoom).toBe(false);
    expect(await t.poseSaved(path)).toBe(true);
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

  it('with no room for a changed pose file, the update still installs and the file is saved later', async () => {
    const caches = new FakeCaches();
    const v1 = setup(V1, caches);
    await install(v1.env);
    await activate(v1.env);
    for (const p of DEFAULT_POSE) await (await v1.get(p)).arrayBuffer();
    await v1.settle();
    const V2 = { ...V1, 'index.html': 'v2 page!', 'mediapipe/models/pose_landmarker_full.task': 'model-full v2' };
    // Room for the new version of the app, not for the new model.
    caches.quota = caches.used() + manifestOf(V2).app.reduce((n, e) => n + e.size, 0) + 5;
    const site = new FakeSite(V2);
    const v2 = setup(V2, caches, site);
    await install(v2.env);
    expect(site.paths().sort()).toEqual(['index.html', 'mediapipe/models/pose_landmarker_full.task']);
    expect((await status(v2.env)).noRoom).toBe(true);
    // Once it applies, the old model goes, which makes room for the new one: saved on use.
    await activate(v2.env);
    caches.quota = Infinity;
    expect(await v2.poseSaved('mediapipe/models/pose_landmarker_full.task')).toBe(false);
    expect(await (await v2.get('mediapipe/models/pose_landmarker_full.task')).text()).toBe('model-full v2');
    await v2.settle();
    expect(await v2.poseSaved('mediapipe/models/pose_landmarker_full.task')).toBe(true);
    expect((await status(v2.env)).noRoom).toBe(false);
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

  it('fails an install with no room for the app itself (it is retried later)', async () => {
    const caches = new FakeCaches();
    caches.quota = 10;
    const t = setup(V1, caches);
    await expect(install(t.env)).rejects.toThrow(/room/);
    expect((await status(t.env)).noRoom).toBe(true);
  });

  it('refuses to keep a version whose files on the server are not the ones it lists', async () => {
    const site = new FakeSite({ ...V1, 'assets/index-a1.js': 'console.log("a newer deploy")' });
    const t = setup(V1, new FakeCaches(), site);
    await expect(install(t.env)).rejects.toThrow(/doesn't match/);
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
