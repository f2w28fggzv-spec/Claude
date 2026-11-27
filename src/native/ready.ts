// Debug builds only (src/native/entry.ts loads this when AppInfo.debug): the console markers CI's simulator check and
// the Chromium check read (formats in src/native/bridge.ts). Release builds carry this chunk but never load it, and
// never log anything.
import { FilesetResolver } from '@mediapipe/tasks-vision';
import { POSE_WASM_DIR, poseModelPath } from '../offline/manifest';
import type { AppInfo, ProbeResult, ReadyMarker } from './bridge';
import { MARKERS, PROBE_ORIGIN } from './bridge';

/** src/privacy.ts refused a request (its message ends so). */
export const isPrivacyBlock = (err: unknown) => String((err as Error)?.message ?? err).includes('this app never sends data off the device');

/** What a fetch that must never leave the app did: refused by src/privacy.ts, got through, or failed otherwise. */
export async function probe(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    void res.body?.cancel();
    return 'loaded';
  } catch (err) {
    return isPrivacyBlock(err) ? 'blocked' : `failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`;
  }
}

/**
 * A CSP violation caused by the self-test's own probe (an image on PROBE_ORIGIN). WebKit reports a blocked
 * cross-origin URL in full for img-src, but may cut it to its origin, so the origin is what's matched.
 */
export const isProbeViolation = (blockedURI: string) => blockedURI === PROBE_ORIGIN || blockedURI.startsWith(`${PROBE_ORIGIN}/`);

let watching = false;

/** Logs uncaught errors, unhandled rejections and CSP violations as markers (from before the app starts). */
export function watch(): void {
  if (watching) return;
  watching = true;
  addEventListener('error', (e) => console.error(`${MARKERS.uncaught} ${e.message} at ${e.filename}:${e.lineno}`));
  addEventListener('unhandledrejection', (e) => console.error(`${MARKERS.uncaught} ${String(e.reason)}`));
  document.addEventListener('securitypolicyviolation', (e) => {
    if (isProbeViolation(e.blockedURI)) console.info(`${MARKERS.cspProbe} ${e.effectiveDirective} ${e.blockedURI}`);
    else console.error(`${MARKERS.csp} ${e.effectiveDirective} ${e.blockedURI}`);
  });
}

/** The status of a fetch of one of the app's own files (headers only; the body is dropped), or the error's text. */
async function ownFile(url: string): Promise<{ status: number | string; type: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    void res.body?.cancel();
    return { status: res.status, type: res.headers.get('content-type') ?? '' };
  } catch (err) {
    const text = String((err as Error)?.message ?? err).slice(0, 200);
    return { status: text, type: `failed: ${text}` };
  }
}

/** The facts CI checks, for the ready marker. */
export async function readyFacts(info: AppInfo): Promise<ReadyMarker> {
  const model = new URL(poseModelPath('full'), document.baseURI).href;
  const wasm = new URL(`${POSE_WASM_DIR}/vision_wasm_internal.wasm`, document.baseURI).href;
  const [own, runtime, outside, simd] = await Promise.all([
    ownFile(model),
    ownFile(wasm),
    probe(`${PROBE_ORIGIN}/fitee-probe`),
    FilesetResolver.isSimdSupported().catch(() => false),
  ]);
  return {
    version: info.version,
    build: info.build,
    rules: info.rules,
    gate: info.gate,
    origin: location.origin,
    urlOrigin: new URL(model).origin,
    ownFile: own.status,
    wasmType: runtime.type,
    outside,
    secure: isSecureContext,
    camera: !!navigator.mediaDevices?.getUserMedia,
    recorder: typeof MediaRecorder === 'function',
    simd,
    sw: 'serviceWorker' in navigator,
    hash: location.hash,
  };
}

/** Logs `fitee:ready {json}` once the first screen has rendered. */
export async function report(info: AppInfo): Promise<void> {
  console.info(`${MARKERS.ready} ${JSON.stringify(await readyFacts(info))}`);
}
