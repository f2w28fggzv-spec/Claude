// Copies the MediaPipe WASM runtime and downloads the pose models into
// public/mediapipe/ so the app serves them itself (no CDN at runtime).
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'mediapipe');
mkdirSync(join(out, 'models'), { recursive: true });

// Only the classic-script loaders are used (SIMD + non-SIMD fallback);
// the ES-module variant would add ~14 MB for nothing.
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
mkdirSync(join(out, 'wasm'), { recursive: true });
for (const f of [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]) {
  cpSync(join(wasmSrc, f), join(out, 'wasm', f));
}

const MODELS = ['lite', 'full'];
for (const name of MODELS) {
  const dest = join(out, 'models', `pose_landmarker_${name}.task`);
  if (existsSync(dest)) continue;
  const url = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${name}/float16/latest/pose_landmarker_${name}.task`;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}
console.log('MediaPipe assets ready in public/mediapipe/');
