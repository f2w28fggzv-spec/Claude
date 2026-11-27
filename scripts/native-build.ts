// The iPhone app's build, and the guard that keeps native code out of the web build. vite.config.ts picks the
// plugins by mode: `vite build --mode native` (npm run build:native) uses nativeBuild() and writes dist-native/,
// which npm run native:sync copies into the Xcode project (ios/); every other build gets webHasNoNativeCode().
//
// The web build (the app, sw.js and about/) stays byte for byte the same when native code changes
// (tools/native-check/web-identity.sh proves it against the pull request's base). So:
// - __NATIVE__ (vite.config.ts `define`, declared in src/env.d.ts) is true only in the native build. A file the two
//   builds share changes for the app only in these forms, with the original code untouched inside them:
//     if (__NATIVE__) { … }               inserted before unchanged code (an early return, or work the app adds first)
//     __NATIVE__ ? <native> : <original>  around an unchanged expression or a whole JSX element (never a JSX text fragment)
//     !__NATIVE__ && <El />               and  __NATIVE__ || expr
//   The web build folds each one back to the original code.
// - Native-only code lives in src/native/, and shared code reaches it only through import() inside such a branch
//   (a dead branch's import() is dropped before it is resolved) or through NATIVE_SWAPS. Never a static import.
// - Native-only CSS is imported by a src/native/ module, so it becomes a file of its own in the native build.
// - __NATIVE__ never appears in a module the landing page (src/landing/main.ts, src/landing/prerender.ts), the
//   service worker (src/offline/sw.ts) or tools/landing-screens/seed.ts loads: their builds don't use
//   vite.config.ts, and Node would throw a ReferenceError.
// - webHasNoNativeCode() fails the web build if src/native/ or @capacitor/ gets in anyway.
//
// Node loads this file itself under `vite build --configLoader native` (web-identity.sh does): erasable TypeScript
// only, and JSON read with readFileSync rather than imported.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Native-only modules. */
const NATIVE_SRC = join(ROOT, 'src', 'native');

/** A module path from the repo root, with "/". */
const shown = (file: string) => relative(ROOT, file).split(sep).join('/');
/** A module id as a file path: absolute, without Vite's \0 prefix or a query. */
const fileOf = (id: string) => resolve(ROOT, id.replace(/^\0/, '').split('?')[0]);

/** Whether a module id (absolute or from the repo root, maybe with a query) is native-only code. */
export function isNativeOnly(id: string): boolean {
  const file = fileOf(id);
  return file.startsWith(NATIVE_SRC + sep) || file.split(sep).join('/').includes('/node_modules/@capacitor/');
}

const NATIVE_IN_WEB =
  "native-only code in the web build: reach src/native/ only through import() inside if (__NATIVE__) { … }, or through the native build's swaps (scripts/native-build.ts)";

/**
 * Web builds only: fails if a module from src/native/ or a @capacitor/ package is loaded, or ends up in the output
 * by any other way (an asset, a ?raw import). A dead `if (__NATIVE__)` branch's import() is dropped before
 * resolution, so a correct web build never gets here.
 */
export function webHasNoNativeCode(): Plugin {
  // Printed as well as thrown: a failed build still runs the other plugins' closeBundle, and on a fresh checkout
  // (no output folder yet) fitee-offline's error then takes this one's place in Vite's report.
  const fail = (id: string) => {
    const message = `${shown(fileOf(id))}: ${NATIVE_IN_WEB}`;
    console.error(`fitee-web-has-no-native-code: ${message}`);
    return message;
  };
  return {
    name: 'fitee-web-has-no-native-code',
    apply: 'build',
    load(id) {
      if (isNativeOnly(id)) this.error(fail(id));
      return null;
    },
    generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        const native = (out.type === 'chunk' ? out.moduleIds : out.originalFileNames).find(isNativeOnly);
        if (native) this.error(fail(native));
      }
    },
  };
}

/** The native build uses `to` in place of `from` (paths from the repo root); with `importer`, only where that module imports it. */
export interface NativeSwap {
  from: string;
  to: string;
  importer?: string;
}

/** Modules the native build replaces. A replacement exports at least the names and types the original's importers use. */
export const NATIVE_SWAPS: readonly NativeSwap[] = [
  // Saved sets become files left out of backups; calibration recordings (src/calibration/store.ts) keep src/db.ts.
  { from: 'src/db.ts', importer: 'src/sets/sets.ts', to: 'src/native/setsDb.ts' },
  // The app's own Terms of service and Privacy policy, with their own terms version.
  { from: 'src/screens/Legal.tsx', to: 'src/native/screens/Legal.tsx' },
  // A web view can't download: exports go through iOS's Save to Files panel.
  { from: 'src/ui/download.ts', to: 'src/native/download.ts' },
];

/** Points imports of a swapped module at its replacement (NATIVE_SWAPS). A replacement may still import the module it replaces. */
export function nativeSwaps(): Plugin {
  const swaps = NATIVE_SWAPS.map((s) => ({ from: join(ROOT, s.from), to: join(ROOT, s.to), importer: s.importer === undefined ? undefined : join(ROOT, s.importer) }));
  const stem = (path: string) => basename(path).replace(/\.[^.]*$/, '');
  const stems = new Set(swaps.map((s) => stem(s.from)));
  return {
    name: 'fitee-native-swaps',
    enforce: 'pre',
    async resolveId(source, importer) {
      // Only an import that may name a swapped module (its last part is db, Legal or download) is resolved here.
      if (!importer || source.includes('?') || !stems.has(stem(source))) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved || resolved.external) return null;
      const by = fileOf(importer);
      const swap = swaps.find((s) => s.from === fileOf(resolved.id) && (s.importer === undefined || s.importer === by) && s.to !== by);
      return swap ? swap.to : null;
    },
    // Shared code imports src/native/ modules with import() only to keep them out of the web build. In the app's build
    // some are in the main chunk anyway (a swap or the entry imports them), which Rolldown points out: expected.
    onLog(_level, log) {
      return !(log.code === 'INEFFECTIVE_DYNAMIC_IMPORT' && /src\/native\/\S+ is dynamically imported/.test(log.message));
    },
  };
}

/** The iPhone app's Content Security Policy. 'self' is the page's origin, capacitor://localhost. No 'unsafe-eval' (iOS 17 has 'wasm-unsafe-eval'), no workers, no frames. */
export const NATIVE_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' blob: data:; img-src 'self' blob: data:; media-src 'self' blob: mediastream:; style-src 'self' 'unsafe-inline'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";

/** A line of index.html, found by its tag and one attribute (name="…" or rel="…", so name="mobile-web-app-capable" never matches apple-mobile-web-app-capable). */
const tagLine = (tag: string, attr: string, value: string) => new RegExp(`^[ \\t]*<${tag} ${attr}="${value}"[^>]*>[ \\t]*\\r?\\n`, 'gm');

/** The edits to index.html. Each must match exactly once, so a later change to index.html fails the native build loudly. */
const HTML_EDITS: readonly { what: string; find: RegExp; to: string }[] = [
  { what: 'entry script /src/main.tsx', find: /<script type="module" src="\/src\/main\.tsx"><\/script>/g, to: '<script type="module" src="/src/native/entry.ts"></script>' },
  { what: 'home-screen comment', find: /^[ \t]*<!-- Added to the home screen[\s\S]*?-->[ \t]*\r?\n/gm, to: '' },
  { what: '<meta name="mobile-web-app-capable">', find: tagLine('meta', 'name', 'mobile-web-app-capable'), to: '' },
  { what: '<meta name="apple-mobile-web-app-capable">', find: tagLine('meta', 'name', 'apple-mobile-web-app-capable'), to: '' },
  { what: '<meta name="apple-mobile-web-app-status-bar-style">', find: tagLine('meta', 'name', 'apple-mobile-web-app-status-bar-style'), to: '' },
  { what: '<meta name="apple-mobile-web-app-title">', find: tagLine('meta', 'name', 'apple-mobile-web-app-title'), to: '' },
  { what: '<link rel="icon">', find: tagLine('link', 'rel', 'icon'), to: '' },
  { what: '<link rel="apple-touch-icon">', find: tagLine('link', 'rel', 'apple-touch-icon'), to: '' },
  { what: '<link rel="manifest">', find: tagLine('link', 'rel', 'manifest'), to: '' },
  {
    what: 'CSP comment',
    find: /<!-- Nothing may be sent off the device[\s\S]*?-->/g,
    to: '<!-- The iPhone app: everything comes from the app itself (capacitor://localhost); nothing may leave the device. -->',
  },
  { what: 'CSP', find: /(?<=<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*/g, to: NATIVE_CSP },
];

/** index.html for the iPhone app: the native entry (src/native/entry.ts), no home-screen tags, the native CSP. Pure. */
export function nativeIndexHtml(html: string): string {
  let out = html;
  for (const { what, find, to } of HTML_EDITS) {
    const found = out.match(find)?.length ?? 0;
    if (found !== 1) throw new Error(`native-build: index.html should have exactly one ${what}, found ${found}: update HTML_EDITS in scripts/native-build.ts`);
    out = out.replace(find, () => to);
  }
  return out;
}

/** The native index.html, applied before Vite reads the entry script, so the native entry is the one it builds. */
export function nativeHtml(): Plugin {
  return {
    name: 'fitee-native-html',
    transformIndexHtml: { order: 'pre', handler: (html) => nativeIndexHtml(html) },
  };
}

/** Files of public/ the app leaves out: the no-SIMD runtime (iOS 17 always has wasm SIMD) and the home-screen files. */
export const NATIVE_DROP: readonly string[] = [
  'mediapipe/wasm/vision_wasm_nosimd_internal.js',
  'mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
  'manifest.webmanifest',
  'favicon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

/** What dist-native/ holds at its top level; anything else fails the build (a new file in public/ is a choice to make for the app too). */
export const NATIVE_TOP: readonly string[] = ['assets', 'index.html', 'licenses', 'mediapipe'];

/** The pose files the app ships, by path in the build: size and SHA-256 (scripts/native-pose-files.json). */
export type PosePins = Record<string, { bytes: number; sha256: string }>;

export const POSE_PINS_FILE = join(ROOT, 'scripts', 'native-pose-files.json');

export const readPosePins = (file = POSE_PINS_FILE): PosePins => JSON.parse(readFileSync(file, 'utf8')) as PosePins;

/** Every file under `dir`, relative to it with "/", sorted; none if `dir` doesn't exist. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (sub: string) => {
    for (const name of readdirSync(join(dir, sub)).sort()) {
      const rel = sub ? `${sub}/${name}` : name;
      if (statSync(join(dir, rel)).isDirectory()) walk(rel);
      else out.push(rel);
    }
  };
  walk('');
  return out;
}

/** Throws unless the files under `<dir>/mediapipe/` are exactly the pinned ones, with their sizes and SHA-256s. */
export function checkPoseFiles(dir: string, pins: PosePins = readPosePins()): void {
  const found = filesUnder(join(dir, 'mediapipe')).map((f) => `mediapipe/${f}`);
  const problems = Object.keys(pins)
    .filter((name) => !found.includes(name))
    .map((name) => `${name} is missing`);
  for (const name of found) {
    const pin = pins[name];
    if (!pin) {
      problems.push(`${name} isn't pinned`);
      continue;
    }
    const bytes = readFileSync(join(dir, name));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== pin.bytes || sha256 !== pin.sha256) problems.push(`${name} is ${bytes.length} bytes with SHA-256 ${sha256} (pinned: ${pin.bytes} bytes, ${pin.sha256})`);
  }
  if (problems.length) {
    throw new Error(
      `native-build: ${problems.join('; ')}. The pose files differ from the ones this app version was tested with. If the new ones are intended, update scripts/native-pose-files.json in the same commit.`,
    );
  }
}

/** After the native build: drops NATIVE_DROP, then checks what's left (no service worker or landing page, nothing unexpected, the pinned pose files). */
export function nativeFiles(): Plugin {
  let outDir = '';
  let write = true;
  return {
    name: 'fitee-native-files',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      write = config.build.write !== false;
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        if (!write) return;
        for (const file of NATIVE_DROP) rmSync(join(outDir, file), { force: true });
        for (const web of ['sw.js', 'about']) {
          if (existsSync(join(outDir, web))) throw new Error(`native-build: ${web} is in ${outDir}: the iPhone app has no service worker and no landing page`);
        }
        const extra = readdirSync(outDir).filter((name) => !NATIVE_TOP.includes(name));
        if (extra.length) {
          throw new Error(`native-build: ${extra.join(', ')} in ${outDir} isn't part of the iPhone app: add it to NATIVE_DROP or NATIVE_TOP in scripts/native-build.ts`);
        }
        checkPoseFiles(outDir);
        const files = filesUnder(outDir);
        const bytes = files.reduce((n, f) => n + statSync(join(outDir, f)).size, 0);
        console.log(`native build: ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB (pose files as pinned in scripts/native-pose-files.json)`);
      },
    },
  };
}

/** The native build's plugins (vite.config.ts, mode native). */
export function nativeBuild(): Plugin[] {
  return [nativeSwaps(), nativeHtml(), nativeFiles()];
}
