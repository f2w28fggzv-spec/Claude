// What the service worker keeps on the phone for offline use, and under
// which cache names. Shared by the build (scripts/offline-build.ts writes the
// list into sw.js), the service worker (src/offline/worker.ts) and the app
// (src/offline/client.ts). Pure: no DOM, no Node, no imports, so Node can
// load it straight from the build script.

/** One file of the app, as listed in sw.js. */
export interface PrecacheEntry {
  /** Path from the app's folder (the service worker's scope), e.g. "assets/index-abc.js". */
  url: string;
  /** First 16 hex digits of the file's SHA-256: changes whenever the file does. */
  hash: string;
  /** Size in bytes. */
  size: number;
  /** Content type, from the file name (stored with the copy, whatever the server said). */
  type: string;
}

/** Every file of one build of the app. */
export interface PrecacheManifest {
  /** Changes whenever any file changes. */
  version: string;
  /** The app itself (page, code, styles, fonts, icons, manifest, licences): saved when the service worker installs. */
  app: PrecacheEntry[];
  /** The pose runtime and models (public/mediapipe/): saved when used, or when the app asks. */
  pose: PrecacheEntry[];
}

/** Every cache this app makes starts with this; nothing else is ever touched. */
export const CACHE_PREFIX = 'fitee-';
/** Stored with each saved copy: the hash it was checked against. */
export const HASH_HEADER = 'x-fitee-hash';
/** Pose runtime and models live under this folder of the build. */
export const POSE_DIR = 'mediapipe/';
export const POSE_WASM_DIR = 'mediapipe/wasm';

export type PoseVariant = 'lite' | 'full';

/** The pose model file for a variant (full is the default; lite is on the camera test page). */
export const poseModelPath = (variant: PoseVariant) => `mediapipe/models/pose_landmarker_${variant}.task`;

/**
 * The MediaPipe runtime files a browser loads: the SIMD build when it supports
 * WebAssembly SIMD, else the slower no-SIMD build (MediaPipe's own naming).
 */
export const poseRuntimeFiles = (simd: boolean) =>
  ['js', 'wasm'].map((ext) => `${POSE_WASM_DIR}/vision_wasm${simd ? '' : '_nosimd'}_internal.${ext}`);

/** Everything one technique check loads: the runtime this browser uses plus one model. */
export const poseFilesFor = (simd: boolean, variant: PoseVariant) => [...poseRuntimeFiles(simd), poseModelPath(variant)];

/** Files never listed: the service worker itself (the browser checks it for updates) and source maps. */
export const isListed = (path: string) => path !== 'sw.js' && !path.endsWith('.map') && !path.split('/').some((p) => p.startsWith('.'));

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  woff: 'font/woff',
  txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
  task: 'application/octet-stream',
};

/** Content type by file extension (WebAssembly must be application/wasm to compile while it streams). */
export function contentType(path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  return TYPES[ext] ?? 'application/octet-stream';
}

/** A 64-bit hash of a string (two 32-bit lanes, cyrb53-style), as 16 hex digits. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** One hash for a set of files: changes when any file is added, removed or changed. */
export const groupHash = (entries: readonly PrecacheEntry[]) => hashText(entries.map((e) => `${e.url} ${e.hash}`).join('\n'));

const byUrl = (a: { url: string }, b: { url: string }) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);

/**
 * The manifest for the files a build wrote (paths relative to the output
 * folder, with their hashes). Deterministic: the same files give the same
 * manifest, in the same order.
 */
export function buildManifest(files: readonly { url: string; hash: string; size: number }[]): PrecacheManifest {
  const listed = files
    .filter((f) => isListed(f.url))
    .map((f) => ({ url: f.url, hash: f.hash, size: f.size, type: contentType(f.url) }))
    .sort(byUrl);
  const app = listed.filter((f) => !f.url.startsWith(POSE_DIR));
  const pose = listed.filter((f) => f.url.startsWith(POSE_DIR));
  return { version: groupHash([...app, ...pose]), app, pose };
}

/**
 * Cache names, one per group, each named by the hash of its own files: a
 * deploy that changes only the app gets a new app cache and keeps the pose
 * cache as it is, so the pose files aren't copied or downloaded again.
 */
export function cacheNames(m: PrecacheManifest): { app: string; pose: string } {
  return { app: `${CACHE_PREFIX}app-${groupHash(m.app)}`, pose: `${CACHE_PREFIX}pose-${groupHash(m.pose)}` };
}

/** This app's caches that the current version doesn't use (other caches are never touched). */
export const cachesToDelete = (existing: readonly string[], keep: readonly string[]) =>
  existing.filter((name) => name.startsWith(CACHE_PREFIX) && !keep.includes(name));

/**
 * Where to download a file from: a query with its hash gets past any copy in
 * the HTTP cache or on the CDN (GitHub Pages caches for 10 minutes) that is
 * older than this version. The copy is stored under the clean URL.
 */
export const networkPath = (e: PrecacheEntry) => `${e.url}?v=${e.hash}`;

/** First 16 hex digits of a SHA-256 digest. */
export const digestHex = (digest: ArrayBuffer) =>
  Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
