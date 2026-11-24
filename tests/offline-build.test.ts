// The build step that lists every file of a build with its hash and writes
// the service worker (scripts/offline-build.ts, src/offline/manifest.ts).
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildManifest, contentType, isListed, poseFilesFor, poseModelPath, poseRuntimeFiles } from '../src/offline/manifest';
import { listFiles, writeServiceWorker } from '../scripts/offline-build.ts';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function fakeBuild(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'fitee-offline-build-'));
  dirs.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

const BUILD = {
  'index.html': '<!doctype html><title>fitee</title>',
  'assets/index-a1.js': 'console.log(1)',
  'assets/index-b2.css': 'body{}',
  'assets/font-latin.woff2': 'font',
  'assets/index-a1.js.map': '{}',
  'icon-512.png': 'png',
  'manifest.webmanifest': '{}',
  'licenses/bricolage-grotesque-OFL.txt': 'licence',
  'mediapipe/wasm/vision_wasm_internal.js': 'loader',
  'mediapipe/wasm/vision_wasm_internal.wasm': 'wasm',
  'mediapipe/models/pose_landmarker_full.task': 'model',
  'sw.js': '// an older service worker',
  '.DS_Store': 'junk',
};

describe('precache manifest', () => {
  it('lists every file the build wrote, with a SHA-256 prefix and size, in a stable order', () => {
    const files = listFiles(fakeBuild(BUILD));
    expect(files.map((f) => f.url)).toContain('licenses/bricolage-grotesque-OFL.txt');
    const js = files.find((f) => f.url === 'assets/index-a1.js')!;
    expect(js.hash).toBe(createHash('sha256').update('console.log(1)').digest('hex').slice(0, 16));
    expect(js.size).toBe(14);
    expect(listFiles(fakeBuild(BUILD))).toEqual(files);
  });

  it('splits the app from the pose files and leaves out the worker, source maps and dotfiles', () => {
    const m = buildManifest(listFiles(fakeBuild(BUILD)));
    expect(m.app.map((e) => e.url)).toEqual([
      'assets/font-latin.woff2',
      'assets/index-a1.js',
      'assets/index-b2.css',
      'icon-512.png',
      'index.html',
      'licenses/bricolage-grotesque-OFL.txt',
      'manifest.webmanifest',
    ]);
    expect(m.pose.map((e) => e.url)).toEqual([
      'mediapipe/models/pose_landmarker_full.task',
      'mediapipe/wasm/vision_wasm_internal.js',
      'mediapipe/wasm/vision_wasm_internal.wasm',
    ]);
    expect(isListed('sw.js')).toBe(false);
    expect(isListed('assets/a.js.map')).toBe(false);
    expect(isListed('.well-known/x')).toBe(false);
  });

  it('gives each file the content type it needs offline', () => {
    expect(contentType('mediapipe/wasm/vision_wasm_internal.wasm')).toBe('application/wasm');
    expect(contentType('manifest.webmanifest')).toBe('application/manifest+json');
    expect(contentType('index.html')).toMatch(/^text\/html/);
    expect(contentType('assets/x.js')).toMatch(/^text\/javascript/);
    expect(contentType('assets/x.woff2')).toBe('font/woff2');
    expect(contentType('mediapipe/models/pose_landmarker_full.task')).toBe('application/octet-stream');
  });

  it('changes version whenever any file changes, and only then', () => {
    const a = buildManifest(listFiles(fakeBuild(BUILD)));
    expect(buildManifest(listFiles(fakeBuild(BUILD))).version).toBe(a.version);
    expect(buildManifest(listFiles(fakeBuild({ ...BUILD, 'licenses/bricolage-grotesque-OFL.txt': 'licence 2' }))).version).not.toBe(a.version);
    expect(buildManifest(listFiles(fakeBuild({ ...BUILD, 'mediapipe/models/pose_landmarker_full.task': 'model 2' }))).version).not.toBe(a.version);
    // The old sw.js and source maps aren't part of it.
    expect(buildManifest(listFiles(fakeBuild({ ...BUILD, 'sw.js': 'other', 'assets/index-a1.js.map': '[]' }))).version).toBe(a.version);
  });

  it('names the pose files the way MediaPipe and the asset script do', () => {
    expect(poseRuntimeFiles(true)).toEqual(['mediapipe/wasm/vision_wasm_internal.js', 'mediapipe/wasm/vision_wasm_internal.wasm']);
    expect(poseFilesFor(false, 'lite')).toEqual([
      'mediapipe/wasm/vision_wasm_nosimd_internal.js',
      'mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
      'mediapipe/models/pose_landmarker_lite.task',
    ]);
    const fetchAssets = readFileSync(join(__dirname, '..', 'scripts', 'fetch-assets.mjs'), 'utf8');
    for (const f of [...poseRuntimeFiles(true), ...poseRuntimeFiles(false)]) expect(fetchAssets).toContain(`'${f.split('/').pop()}'`);
    expect(fetchAssets).toContain('pose_landmarker_${name}.task');
    expect(poseModelPath('full')).toBe('mediapipe/models/pose_landmarker_full.task');
  });
});

describe('service worker build', () => {
  it('writes sw.js as one classic script with this build’s file list in it', async () => {
    const dir = fakeBuild(BUILD);
    const m = await writeServiceWorker(dir);
    const code = readFileSync(join(dir, 'sw.js'), 'utf8');
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
    expect(code).not.toContain('__FITEE_PRECACHE__');
    expect(code).toContain(`"version": "${m.version}"`);
    expect(code).toContain('"url": "assets/index-a1.js"');
    expect(code).not.toContain('"url": "sw.js"');
    // The same files give the same sw.js, so an unchanged deploy isn't an update.
    await writeServiceWorker(dir);
    expect(readFileSync(join(dir, 'sw.js'), 'utf8')).toBe(code);
  });

  it('refuses a folder without the app’s page', async () => {
    const dir = fakeBuild({ 'assets/a.js': '1' });
    await expect(writeServiceWorker(dir)).rejects.toThrow(/index\.html/);
  });
});
