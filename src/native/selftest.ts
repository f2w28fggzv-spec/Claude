// Debug builds launched with SELF_TEST_ARG only (CI's self-test launch; src/native/entry.ts loads this when
// AppInfo.selfTest): proves on the simulator what Linux can't, then logs one `fitee:selftest {json}` marker
// (SelfTestMarker in src/native/bridge.ts). Every step has its own timeout, so the marker always comes. It touches only
// its own files and re-saves the unit as it is: it never deletes user data. Nothing here expects a rejection from
// native code: in Debug builds Capacitor logs every rejected call as an error line, which fails CI's launch.
import { createPoseLandmarker } from '../pose';
import type { AppInfo, FiteeNative, SelfTestMarker, SelfTestStep, SelfTestVideo } from './bridge';
import { capacitor, GATE_PROBES, MARKERS, native, PROBE_ORIGIN } from './bridge';
import { isProbeViolation, probe } from './ready';
import { extFor, uploadVideo, videoFile } from './setFiles';
import { reconciled } from './setsDb';
import { flushNow, localRevOf, parseCopy } from './snapshot';

const UNIT_KEY = 'formcheck.v1.unit';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const errText = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 200);

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no result within ${ms / 1000} s`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Runs one step; a throw or a timeout becomes ok: false with the error (and the step's other fields as given). */
async function step<T extends SelfTestStep>(what: string, ms: number, failed: Omit<T, 'ok' | 'error'>, work: () => Promise<T>): Promise<T> {
  try {
    return await withTimeout(work(), ms, what);
  } catch (err) {
    return { ...failed, ok: false, error: errText(err) } as T;
  }
}

// ---- snapshot --------------------------------------------------------------------------------------------------

async function snapshotStep(): Promise<SelfTestMarker['snapshot']> {
  const unit = localStorage.getItem(UNIT_KEY) ?? '"kg"';
  // Two copies, so the second moves the first to snapshot.prev.json (FiteeFiles.writeSnapshot's rename(2)s).
  for (let i = 0; i < 2; i++) {
    localStorage.setItem(UNIT_KEY, unit); // the same value: the copy writer schedules a write
    flushNow(); // posted at once, before the read below, and the bridge runs calls in order
  }
  const { current, prev } = await native().readSnapshot();
  const parsed = current === undefined ? undefined : parseCopy(current);
  const copy = parsed?.ok ? parsed.copy : undefined;
  const before = prev === undefined ? undefined : parseCopy(prev);
  const revMatches = !!copy && copy.rev === localRevOf(localStorage);
  const unitMatches = !!copy && JSON.stringify(copy.data[UNIT_KEY]) === JSON.stringify(JSON.parse(unit));
  const rotated = !!copy && !!before?.ok && before.copy.rev === copy.rev - 1;
  const error = !copy ? 'snapshot.json is missing or not a valid copy' : !rotated ? 'snapshot.prev.json isn’t the copy written just before snapshot.json' : undefined;
  return { ok: revMatches && unitMatches && rotated, rev: copy?.rev ?? 0, revMatches, unitMatches, rotated, ...(error ? { error } : {}) };
}

// ---- video -----------------------------------------------------------------------------------------------------

/** A 2 s recording of an animated 160×120 canvas (video/mp4 when MediaRecorder can make it). */
async function recordCanvas(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.captureStream !== 'function' || typeof MediaRecorder !== 'function') throw new Error('no canvas recording here');
  const stream = canvas.captureStream(30);
  const type = ['video/mp4', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('MediaRecorder failed'));
  });
  const start = performance.now();
  const draw = () => {
    const t = performance.now() - start;
    ctx.fillStyle = `hsl(${Math.round(t / 8) % 360} 70% 45%)`;
    ctx.fillRect(0, 0, 160, 120);
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(t / 15) % 140, 40, 20, 40);
  };
  draw();
  recorder.start(250);
  const frames = setInterval(draw, 33);
  await sleep(2000);
  clearInterval(frames);
  recorder.stop();
  await stopped;
  for (const track of stream.getTracks()) track.stop();
  const blob = new Blob(chunks, { type: recorder.mimeType || type || 'video/mp4' });
  if (!blob.size) throw new Error('the recording is empty');
  return blob;
}

/** 3 MiB and 5 bytes of random data, typed as an MP4. */
function randomVideo(): Blob {
  const bytes = new Uint8Array(3 * 1024 * 1024 + 5);
  for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536));
  return new Blob([bytes], { type: 'video/mp4' });
}

const hex = (digest: ArrayBuffer) => [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A muted, inline <video> on the URL loads its metadata, then seeks to the middle. */
function plays(url: string): Promise<boolean> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.append(video);
  const done = new Promise<boolean>((resolve, reject) => {
    video.onloadedmetadata = () => {
      video.onseeked = () => resolve(true);
      video.currentTime = Number.isFinite(video.duration) && video.duration > 0 ? video.duration / 2 : 0.5;
    };
    video.onerror = () => reject(new Error(`the video didn't load (${video.error?.code ?? '?'})`));
  });
  video.src = url;
  video.load();
  return withTimeout(done, 10_000, 'playback').finally(() => {
    video.removeAttribute('src');
    video.load();
    video.remove();
  });
}

/** Saves a video with uploadVideo, then checks its file: listed with its size and excluded from backup, served whole and by range, removed. */
async function checkVideo(n: FiteeNative, id: string, blob: Blob, play: boolean): Promise<SelfTestVideo & { played?: boolean }> {
  const name = videoFile(id, extFor(blob.type));
  const out: SelfTestVideo & { played?: boolean } = { ok: false, type: blob.type, bytes: blob.size, listed: false, excluded: false, range: false, sha256: false, removed: false };
  try {
    await uploadVideo(n, id, blob);
    const file = (await n.listSetFiles()).files.find((f) => f.name === name);
    out.listed = file?.bytes === blob.size;
    out.excluded = file?.excluded === true;
    const { url } = await n.videoUrl({ name });
    const head = new Uint8Array(await blob.slice(0, 100).arrayBuffer());
    const part = await fetch(url, { headers: { Range: 'bytes=0-99' } });
    const got = new Uint8Array(await part.arrayBuffer());
    out.range = part.status === 206 && got.length === head.length && got.every((b, i) => b === head[i]);
    const whole = await (await fetch(url)).arrayBuffer();
    out.sha256 = hex(await crypto.subtle.digest('SHA-256', whole)) === hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
    if (play) out.played = await plays(url);
  } catch (err) {
    out.error = errText(err);
  }
  try {
    await n.removeSetFiles({ names: [name] });
    out.removed = !(await n.listSetFiles()).files.some((f) => f.name === name);
  } catch (err) {
    out.error ??= errText(err);
  }
  out.ok = !out.error && out.listed && out.excluded && out.range && out.sha256 && out.removed && (!play || out.played === true);
  return out;
}

async function videoStep(): Promise<SelfTestMarker['video']> {
  const n = native();
  await reconciled(); // the launch's reconcile has run, so it can't take these files for orphans
  const stamp = Date.now();
  let recorded: SelfTestMarker['video']['recorded'];
  try {
    const blob = await withTimeout(recordCanvas(), 15_000, 'recording');
    const { played, ...checked } = await checkVideo(n, `selftest${stamp}a`, blob, true);
    recorded = { ...checked, played: played ?? false };
  } catch (err) {
    // No recording could be made here (checkVideo itself never throws): the random file's checks still run.
    recorded = { ok: true, played: 'skipped', error: errText(err) };
  }
  const random = await checkVideo(n, `selftest${stamp}b`, randomVideo(), false);
  const { folderExcluded } = await n.listSetFiles();
  return { ok: recorded.ok && random.ok && folderExcluded, folderExcluded, recorded, random };
}

// ---- the bridge gate --------------------------------------------------------------------------------------------

/**
 * The channel the bridge gate guards (FiteeViewController.swift: webkit.messageHandlers.bridge, which native-bridge.js
 * posts every call to). Only the app has it: the Chromium check's stand-in bridge (tools/native-check/) has none, and
 * there the gate step is reported as skipped rather than failed.
 */
const hasNativeBridge = () =>
  typeof (globalThis as { webkit?: { messageHandlers?: { bridge?: { postMessage?: unknown } } } }).webkit?.messageHandlers?.bridge?.postMessage === 'function';

/**
 * Runs `leave` (something that would take the page away, or the app to the background, if the bridge gate let it
 * through), then waits 2 s: true when the page stayed (no pagehide, and no visibilitychange to hidden).
 */
async function stays(leave: () => void): Promise<boolean> {
  let left = false;
  const onHide = () => {
    left = true;
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') left = true;
  };
  addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);
  try {
    leave();
    await sleep(2000);
  } finally {
    removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
  }
  return !left && document.visibilityState !== 'hidden';
}

async function gateStep(info: AppInfo): Promise<SelfTestMarker['gate']> {
  const none = { silent: [], answered: [], stateKept: false, prompt: false, window: false, navigation: false };
  if (!hasNativeBridge()) {
    return { ok: true, skipped: 'no webkit.messageHandlers.bridge here: only the app has the bridge gate', ...none };
  }
  const n = native();
  const send = capacitor()?.nativePromise;
  const target = { id: `selftest${Date.now()}g`, ext: 'mp4' as const };
  const out: Omit<SelfTestMarker['gate'], 'ok' | 'error'> = { ...none, silent: [], answered: [] };
  let error: string | undefined;
  try {
    if (!send) throw new Error('Capacitor.nativePromise is missing');
    await n.beginVideo({ ...target, bytes: 2 });
    // 1. Messages: each call to a plugin the page must never reach gets no answer.
    await Promise.all(
      GATE_PROBES.map(async ({ pluginId, method }) => {
        const call = send(pluginId, method, {}).then(
          () => 'answered',
          () => 'answered',
        );
        const outcome = await Promise.race([call, sleep(2000).then(() => 'silent')]);
        (outcome === 'silent' ? out.silent : out.answered).push(`${pluginId}.${method}`);
      }),
    );
    // 2. The UI delegate: a prompt carrying Capacitor's cookie request is answered with nothing, and no window opens.
    out.prompt = window.prompt(JSON.stringify({ type: 'CapacitorCookies.get' })) === null;
    const opened: { window: Window | null } = { window: null };
    const stayed = await stays(() => {
      opened.window = window.open(`${PROBE_ORIGIN}/fitee-window-probe`);
    });
    out.window = stayed && opened.window === null;
    // 3. Navigations: one to another site is cancelled, so the page stays.
    out.navigation = await stays(() => location.assign(`${PROBE_ORIGIN}/fitee-nav-probe`));
    // The page still runs, and the upload begun before the probes is still running: no second FiteeNative took the
    // first one's place.
    out.stateKept = (await n.appendVideo({ ...target, offset: 0, data: btoa('\u0000\u0001') })).length === 2;
  } catch (err) {
    error = errText(err);
  }
  try {
    await n.abortVideo(target);
  } catch {
    // Its part file is a leftover then, which the next launch deletes.
  }
  error ??= info.gate ? undefined : 'AppInfo.gate is false';
  const ok = !error && out.answered.length === 0 && out.prompt && out.window && out.navigation && out.stateKept;
  return { ok, ...out, ...(error ? { error } : {}) };
}

// ---- the rest ----------------------------------------------------------------------------------------------------

function cspStep(): Promise<SelfTestMarker['csp']> {
  return new Promise((resolve) => {
    const finish = (directive: string) => {
      clearTimeout(timer);
      document.removeEventListener('securitypolicyviolation', onViolation);
      resolve({ ok: directive !== '', directive, ...(directive ? {} : { error: 'no securitypolicyviolation within 2 s' }) });
    };
    const onViolation = (e: SecurityPolicyViolationEvent) => {
      if (isProbeViolation(e.blockedURI)) finish(e.effectiveDirective);
    };
    const timer = setTimeout(() => finish(''), 2000);
    document.addEventListener('securitypolicyviolation', onViolation);
    new Image().src = `${PROBE_ORIGIN}/fitee-csp-probe.png`;
  });
}

async function poseStep(): Promise<SelfTestMarker['pose']> {
  const start = performance.now();
  try {
    const { landmarker, delegate } = await withTimeout(createPoseLandmarker('full'), 90_000, 'createPoseLandmarker');
    landmarker.close();
    return { ok: true, delegate, ms: Math.round(performance.now() - start) };
  } catch (err) {
    return { ok: false, delegate: '', ms: Math.round(performance.now() - start), error: errText(err) };
  }
}

/** Runs every step one after another and logs the marker. */
export async function run(info: AppInfo): Promise<SelfTestMarker> {
  const snapshot = await step('snapshot', 10_000, { rev: 0, revMatches: false, unitMatches: false, rotated: false }, snapshotStep);
  const keepAwake = await step<SelfTestStep>('keepAwake', 5_000, {}, async () => {
    await native().setKeepAwake({ on: true });
    await native().setKeepAwake({ on: false });
    return { ok: true };
  });
  const outside = await step<SelfTestMarker['outside']>('outside', 5_000, { result: 'failed: timed out' }, async () => {
    const result = await probe(`${PROBE_ORIGIN}/`);
    return { ok: result === 'blocked', result };
  });
  const csp = await step('csp', 5_000, { directive: '' }, cspStep);
  const blank = { ok: false, type: '', bytes: 0, listed: false, excluded: false, range: false, sha256: false, removed: false };
  const video = await step('video', 90_000, { folderExcluded: false, recorded: { ok: false, played: false }, random: blank }, videoStep);
  const pose = await step('pose', 95_000, { delegate: '', ms: 0 }, poseStep);
  // Last: if a way out were open and took the app to the background, the marker still comes (the plugin's 5 s
  // background task covers it).
  const gate = await step('gate', 20_000, { silent: [], answered: [], stateKept: false, prompt: false, window: false, navigation: false }, () => gateStep(info));
  const steps = { video, snapshot, pose, csp, outside, keepAwake, gate };
  const skipped = Object.entries(steps)
    .filter(([, s]) => s.skipped !== undefined)
    .map(([name]) => name);
  const marker: SelfTestMarker = { ok: Object.values(steps).every((s) => s.ok), skipped, ...steps };
  console.info(`${MARKERS.selftest} ${JSON.stringify(marker)}`);
  return marker;
}
