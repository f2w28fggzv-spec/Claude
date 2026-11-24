// The service worker's logic (src/offline/worker.ts) run against an in-memory
// Cache Storage and a fake network: request routing, saving on use, install
// (reusing unchanged files), cache names and clean-up across versions.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildManifest, cacheNames, cachesToDelete, HASH_HEADER, type PrecacheManifest } from '../src/offline/manifest';
import { activate, install, respond, routeRequest, status, type WorkerEnv } from '../src/offline/worker';

const BASE = 'https://example.github.io/Claude/';

class FakeCache {
  readonly entries = new Map<string, Response>();
  async match(req: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(String(req))?.clone();
  }
  async put(req: RequestInfo | URL, res: Response): Promise<void> {
    // Like the real thing: the body is read now.
    this.entries.set(String(req), new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers }));
  }
  async keys(): Promise<string[]> {
    return [...this.entries.keys()];
  }
}

class FakeCaches {
  readonly stores = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async has(name: string) {
    return this.stores.has(name);
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async match(req: RequestInfo | URL, opts?: { cacheName?: string }): Promise<Response | undefined> {
    if (opts?.cacheName) return this.stores.get(opts.cacheName)?.match(req);
    for (const c of this.stores.values()) {
      const r = await c.match(req);
      if (r) return r;
    }
    return undefined;
  }
}

/** A site: path → content, and a log of every request that reached it. */
class FakeSite {
  files = new Map<string, string>();
  log: { url: string; init: RequestInit }[] = [];
  offline = false;
  constructor(files: Record<string, string>) {
    this.set(files);
  }
  set(files: Record<string, string>) {
    for (const [k, v] of Object.entries(files)) this.files.set(k, v);
  }
  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    this.log.push({ url, init });
    if (this.offline) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const path = u.pathname.slice(new URL(BASE).pathname.length);
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
  const env: WorkerEnv = {
    manifest: manifestOf(files),
    base: BASE,
    caches: caches as unknown as CacheStorage,
    fetch: site.fetch,
    waitUntil: (p) => void waits.push(p),
    pending: new Map(),
  };
  const settle = () => Promise.all(waits);
  /** What the worker answers for a page's GET of a path. */
  const get = async (path: string, mode = 'cors') => {
    const route = routeRequest({ url: BASE + path, method: 'GET', mode }, BASE, env.manifest);
    if (route.kind === 'pass') throw new Error(`${path} passes through`);
    return respond(route, env);
  };
  return { env, caches, site, settle, get };
}

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
    const stored = await t.caches.match(`${BASE}mediapipe/models/pose_landmarker_full.task`, { cacheName: cacheNames(t.env.manifest).pose });
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
    expect(t.caches.stores.get(cacheNames(t.env.manifest).pose)?.entries.size ?? 0).toBe(0);
  });

  it('fails like the network when offline and the file is not saved', async () => {
    const t = setup();
    await install(t.env);
    t.site.offline = true;
    await expect(t.get('mediapipe/wasm/vision_wasm_internal.wasm')).rejects.toThrow(TypeError);
    // The app itself still opens.
    expect(await (await t.get('', 'navigate')).text()).toBe(V1['index.html']);
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
  it('names each cache by the hash of its own files', () => {
    const a = cacheNames(manifestOf(V1));
    expect(a.app).toMatch(/^fitee-app-[0-9a-f]{16}$/);
    expect(a.pose).toMatch(/^fitee-pose-[0-9a-f]{16}$/);
    expect(cacheNames(manifestOf(V1))).toEqual(a);
    const appChanged = cacheNames(manifestOf({ ...V1, 'index.html': 'v2' }));
    expect(appChanged.app).not.toBe(a.app);
    expect(appChanged.pose).toBe(a.pose);
    const poseChanged = cacheNames(manifestOf({ ...V1, 'mediapipe/models/pose_landmarker_full.task': 'model-full v2' }));
    expect(poseChanged.app).toBe(a.app);
    expect(poseChanged.pose).not.toBe(a.pose);
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
    expect((await caches.keys()).sort()).toEqual(Object.values(cacheNames(v2.env.manifest)).sort());
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
    await activate(v2.env);
    expect(await caches.has(cacheNames(v1.env.manifest).pose)).toBe(false);
    const saved = (await status(v2.env)).pose.filter((p) => p.saved).map((p) => p.url);
    expect(saved).toEqual(['mediapipe/models/pose_landmarker_full.task', 'mediapipe/wasm/vision_wasm_internal.wasm']);
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
