// Runs pose detection on a video file chosen from the phone, frame by frame.
// The file is read locally through an object URL, never uploaded, and the
// URL and video element are released as soon as processing ends.
import type { PoseFrame, PoseSequence } from '../engine/types';
import { detect, loadModel, timelineStart, toPoseFrame } from './runner';
import type { ModelVariant } from '../pose';
import { grabJpeg } from './snapshots';

/** Frames analysed per second of video. */
export const FILE_FPS = 20;
/** Longest video accepted, in seconds (one set). */
export const MAX_FILE_SECONDS = 180;

export interface FileProgress {
  done: number;
  total: number;
}

function once(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(event, on);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const on = () => {
      clearTimeout(timer);
      resolve();
    };
    target.addEventListener(event, on, { once: true });
  });
}

function frameReady(video: HTMLVideoElement): Promise<void> {
  if (!('requestVideoFrameCallback' in video)) return new Promise((r) => setTimeout(r, 30));
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 120);
    video.requestVideoFrameCallback(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Opens a local video file, runs `fn` with it, then releases everything.
 * The file is read through an object URL and never leaves the device.
 */
export async function withVideoFile<T>(file: File, fn: (video: HTMLVideoElement) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // Kept in the DOM but invisible: some mobile browsers won't decode
  // detached video elements.
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  try {
    video.src = url;
    await once(video, 'loadeddata', 15000).catch(() => {
      throw new Error('This video couldn’t be opened. Try a different file.');
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Couldn’t read the length of this video.');
    if (duration > MAX_FILE_SECONDS) throw new Error(`Videos up to ${MAX_FILE_SECONDS / 60} minutes are supported. Trim it to one set.`);
    // iOS only renders seeked frames after the video has played once.
    await video.play().catch(() => undefined);
    video.pause();
    return await fn(video);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}

async function seek(video: HTMLVideoElement, t: number) {
  video.currentTime = Math.min(video.duration - 0.001, Math.max(0, t));
  await once(video, 'seeked', 5000);
  await frameReady(video);
}

/** Pose landmarks for every 1/FILE_FPS seconds of the video. */
export async function landmarksFromVideo(
  video: HTMLVideoElement,
  opts: { variant: ModelVariant; signal?: AbortSignal; onProgress?: (p: FileProgress) => void },
): Promise<PoseSequence> {
  const model = await loadModel(opts.variant);
  const frames: PoseFrame[] = [];
  const total = Math.floor(video.duration * FILE_FPS);
  const base = timelineStart();
  for (let i = 0; i <= total; i++) {
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const t = i / FILE_FPS;
    await seek(video, t);
    frames.push(toPoseFrame(detect(model, video, base + t * 1000), Math.round(t * 1000)));
    opts.onProgress?.({ done: i + 1, total: total + 1 });
  }
  return { version: 1, width: video.videoWidth, height: video.videoHeight, source: 'file', frames };
}

/** JPEG snapshots of specific frames (by index into `seq`), for the results screen. */
export async function grabFrames(video: HTMLVideoElement, seq: PoseSequence, indices: number[]): Promise<Map<number, Blob>> {
  const shots = new Map<number, Blob>();
  for (const i of [...new Set(indices)].sort((a, b) => a - b)) {
    const f = seq.frames[i];
    if (!f) continue;
    await seek(video, f.t / 1000);
    const blob = await grabJpeg(video);
    if (blob) shots.set(i, blob);
  }
  return shots;
}
