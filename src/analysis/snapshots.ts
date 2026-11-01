// Keeps small JPEG snapshots of the frames where a rep turns around, so the
// results screen can show them. They live in memory only and are dropped
// when the results screen closes. Nothing is written to storage.
import type { Extreme, ExtremeType } from '../engine/zigzag';

const MAX_SIDE = 540;

function drawScaled(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
  const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
}

const toJpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.75));

/** One small JPEG of the video's current frame (kept in memory only). */
export async function grabJpeg(video: HTMLVideoElement): Promise<Blob | null> {
  const c = document.createElement('canvas');
  drawScaled(c, video);
  const b = await toJpeg(c);
  c.width = c.height = 0;
  return b;
}

export class SnapshotKeeper {
  private canvases: Record<ExtremeType, HTMLCanvasElement>;
  private candidate: Record<ExtremeType, number> = { top: -1, bottom: -1 };
  private pending: Promise<void>[] = [];
  private lastPeriodic = -Infinity;
  readonly shots = new Map<number, Blob>();

  constructor() {
    this.canvases = { top: document.createElement('canvas'), bottom: document.createElement('canvas') };
  }

  private draw(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    drawScaled(canvas, video);
  }

  private save(canvas: HTMLCanvasElement, frameIndex: number) {
    // toBlob copies the canvas immediately, so the canvas can be redrawn
    // while the JPEG is still encoding.
    this.pending.push(
      toJpeg(canvas).then((b) => {
        if (b) this.shots.set(frameIndex, b);
      }),
    );
  }

  /** The current frame is the most extreme point so far in this direction. */
  candidateFrame(type: ExtremeType, frameIndex: number, video: HTMLVideoElement) {
    this.draw(this.canvases[type], video);
    this.candidate[type] = frameIndex;
  }

  /** A turning point was confirmed: keep its picture. */
  confirmed(e: Extreme) {
    if (this.candidate[e.type] === e.index) this.save(this.canvases[e.type], e.index);
  }

  /** For holds: a picture every `everyMs`. */
  periodic(frameIndex: number, t: number, video: HTMLVideoElement, everyMs = 1500) {
    if (t - this.lastPeriodic < everyMs) return;
    this.lastPeriodic = t;
    const c = document.createElement('canvas');
    this.draw(c, video);
    this.save(c, frameIndex);
  }

  /** Keeps the last unconfirmed candidates too, then waits for encoding. */
  async finish(): Promise<Map<number, Blob>> {
    for (const type of ['top', 'bottom'] as const) {
      if (this.candidate[type] >= 0 && !this.shots.has(this.candidate[type])) this.save(this.canvases[type], this.candidate[type]);
    }
    await Promise.all(this.pending);
    for (const c of Object.values(this.canvases)) c.width = c.height = 0;
    return this.shots;
  }
}

/** The stored snapshot closest in time to `frameIndex`, if within `maxMs`. */
export function nearestShot(
  shots: Map<number, Blob>,
  times: number[],
  frameIndex: number,
  maxMs: number,
): [number, Blob] | null {
  let best: [number, Blob] | null = null;
  let bestD = Infinity;
  for (const [i, b] of shots) {
    const d = Math.abs((times[i] ?? Infinity) - times[frameIndex]);
    if (d <= maxMs && d < bestD) {
      best = [i, b];
      bestD = d;
    }
  }
  return best;
}
