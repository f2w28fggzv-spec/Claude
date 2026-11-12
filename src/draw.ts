import { PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { PLATE } from './ui/brand';

/** Below this visibility a landmark is drawn as unreliable. */
export const MIN_VISIBILITY = 0.5;

// Plate green and plate red from the fitee palette (src/ui/brand.ts).
const GOOD = PLATE.green;
const WEAK = PLATE.red;

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
): void {
  const { width: w, height: h } = ctx.canvas;
  const scale = Math.max(w, h) / 640;
  const ok = (lm: NormalizedLandmark) => (lm.visibility ?? 0) >= MIN_VISIBILITY;

  ctx.lineCap = 'round';
  ctx.lineWidth = 4 * scale;
  for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
    const a = landmarks[start];
    const b = landmarks[end];
    if (!a || !b) continue;
    ctx.strokeStyle = ok(a) && ok(b) ? GOOD : WEAK;
    ctx.globalAlpha = ok(a) && ok(b) ? 0.9 : 0.5;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const lm of landmarks) {
    ctx.fillStyle = ok(lm) ? '#ffffff' : WEAK;
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, 4 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}
