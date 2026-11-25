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

/**
 * The landing page's folder (about/, built beside the app by
 * scripts/landing-build.ts). It is a page of its own, not part of the app:
 * never saved on the phone, so editing the page never updates the app.
 */
export const LANDING_DIR = 'about/';

/**
 * Files never listed: the service worker itself (the browser checks it for
 * updates), source maps, dotfiles, and the landing page (about/).
 */
export const isListed = (path: string) =>
  path !== 'sw.js' && !path.endsWith('.map') && !path.split('/').some((p) => p.startsWith('.')) && !path.startsWith(LANDING_DIR);

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
 * The cache that keeps one pose file, named by the file's own hash. Each pose
 * file has its own, so a deploy that changes one of them (e.g. a newer model)
 * leaves the others where they are: nothing is copied, and the update needs
 * room only for the file that changed.
 */
export const poseCacheName = (e: PrecacheEntry) => `${CACHE_PREFIX}pose-${e.hash}`;

/**
 * The caches a version uses: the app's, named by the hash of the app's files
 * (a deploy that changes only the app gets a new one and leaves the pose
 * files alone), and one per pose file.
 */
export function cacheNames(m: PrecacheManifest): { app: string; pose: string[] } {
  return { app: `${CACHE_PREFIX}app-${groupHash(m.app)}`, pose: m.pose.map(poseCacheName) };
}

/** This app's caches that the current version doesn't use (other caches are never touched). */
export const cachesToDelete = (existing: readonly string[], keep: readonly string[]) =>
  existing.filter((name) => name.startsWith(CACHE_PREFIX) && !keep.includes(name));

/**
 * After the phone couldn't keep a pose file (the browser refused to store it,
 * or its own estimate showed no room), nothing downloads that file again by
 * itself for this long: not the installed app's own save, not an update.
 */
export const NO_ROOM_RETRY_MS = 7 * 24 * 60 * 60_000;
/**
 * The same for one of the app's own files (an update that couldn't keep its
 * new code): they're small (about 0.9 MB in all), and an update shouldn't
 * wait a week once the phone has room again.
 */
export const APP_NO_ROOM_RETRY_MS = 24 * 60 * 60_000;

/** How long nothing downloads a file again by itself after the phone couldn't keep it. */
export const noRoomRetryMs = (e: PrecacheEntry) => (e.url.startsWith(POSE_DIR) ? NO_ROOM_RETRY_MS : APP_NO_ROOM_RETRY_MS);

const UNKEPT_PREFIX = `${CACHE_PREFIX}unkept-`;

/**
 * An empty cache whose name remembers that the phone couldn't keep a file,
 * and when: `fitee-unkept-<file hash>-<time in ms>`. It holds nothing; its
 * name outlives the service worker (which the browser stops when idle) and
 * a new version installing, which a note in memory wouldn't.
 */
export const unkeptCacheName = (hash: string, at: number) => `${UNKEPT_PREFIX}${hash}-${Math.max(0, Math.round(at))}`;

/** The file hash and time an unkept marker names, or undefined for any other cache. */
export function parseUnkept(name: string): { hash: string; at: number } | undefined {
  const m = /^fitee-unkept-([0-9a-f]{16})-(\d+)$/.exec(name);
  return m ? { hash: m[1], at: Number(m[2]) } : undefined;
}

/** Whether a cache is one of those markers (not a cache of files). */
export const isUnkeptCache = (name: string) => name.startsWith(UNKEPT_PREFIX);

/**
 * Whether the phone couldn't keep a file recently enough (within `period`: a
 * week for a pose file) that nothing downloads it again by itself yet. A
 * time ahead of now (a clock that has since been put back) doesn't count: it
 * would hold back for longer than that.
 */
export const unkeptRecently = (at: number | undefined, now: number, period = NO_ROOM_RETRY_MS): at is number =>
  at !== undefined && now >= at && now - at < period;

/**
 * Where to download a file from: a query with its hash gets past any copy in
 * the HTTP cache or on the CDN (GitHub Pages caches for 10 minutes) that is
 * older than this version. The copy is stored under the clean URL.
 */
export const networkPath = (e: PrecacheEntry) => `${e.url}?v=${e.hash}`;

/** First 16 hex digits of a SHA-256 digest. */
export const digestHex = (digest: ArrayBuffer) =>
  Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
