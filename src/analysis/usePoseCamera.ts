// Live camera + pose loop shared by the camera test and the analyze screen.
// Draws the skeleton overlay and hands each frame's landmarks to a callback.
// Frames are never stored here.
import { useEffect, useRef, useState } from 'preact/hooks';
import { closeCamera, openCamera, type Facing } from '../camera';
import { drawSkeleton } from '../draw';
import type { ModelVariant, Delegate } from '../pose';
import type { PoseFrame } from '../engine/types';
import { currentModel, detect, loadModel, toPoseFrame } from './runner';

export interface LiveFrame {
  /** Landmarks with `t` = performance.now() in ms. */
  frame: PoseFrame;
  video: HTMLVideoElement;
  width: number;
  height: number;
}

export interface CameraStats {
  fps: number;
  inferMs: number;
  delegate: Delegate;
  variant: ModelVariant;
  width: number;
  height: number;
}

export function cameraErrorMessage(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access in your browser settings and try again.';
  if (name === 'NotFoundError') return 'No camera found on this device.';
  if (name === 'NotReadableError') return 'The camera is in use by another app.';
  return (err as Error)?.message ?? String(err);
}

export function usePoseCamera(onFrame?: (f: LiveFrame) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState<ModelVariant>(currentModel()?.variant ?? 'full');
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [facing, setFacing] = useState<Facing>('environment');
  const [error, setError] = useState('');
  const [stats, setStats] = useState<CameraStats | null>(null);
  const cb = useRef(onFrame);
  cb.current = onFrame;
  const s = useRef({
    running: false,
    stream: undefined as MediaStream | undefined,
    lastVideoTime: -1,
    fps: 0,
    lastFrameAt: 0,
    inferMs: 0,
    lastStats: 0,
  });

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    loadModel(variant)
      .then(() => !cancelled && setReady(true))
      .catch((err) => !cancelled && setError(`Failed to load pose model: ${(err as Error).message ?? err}`));
    return () => {
      cancelled = true;
    };
  }, [variant]);

  const stop = () => {
    const st = s.current;
    st.running = false;
    setRunning(false);
    // Stop tracks via our own reference: on unmount the video ref is already
    // cleared, and the camera must still be released.
    st.stream?.getTracks().forEach((t) => t.stop());
    st.stream = undefined;
    if (videoRef.current) closeCamera(videoRef.current);
    const c = canvasRef.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  };

  useEffect(() => {
    const onHide = () => document.hidden && stop();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, []);

  const start = async (which: Facing = facing) => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const stage = stageRef.current!;
    const ctx = canvas.getContext('2d')!;
    setError('');
    // Show the stage before opening the camera: iOS may not start a hidden video.
    setRunning(true);
    const st = s.current;
    try {
      st.stream = await openCamera(video, which);
    } catch (err) {
      setRunning(false);
      setError(cameraErrorMessage(err));
      return;
    }
    st.running = true;
    st.lastVideoTime = -1;

    const schedule = () => {
      if (!st.running) return;
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onVideoFrame);
      else requestAnimationFrame(onVideoFrame);
    };
    const onVideoFrame = () => {
      if (!st.running) return;
      const model = currentModel();
      if (model && video.readyState >= 2 && video.currentTime !== st.lastVideoTime) {
        st.lastVideoTime = video.currentTime;
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
        }
        const t0 = performance.now();
        const result = detect(model, video, t0);
        const t1 = performance.now();
        st.inferMs = st.inferMs * 0.9 + (t1 - t0) * 0.1;
        if (st.lastFrameAt) st.fps = st.fps * 0.9 + (1000 / (t1 - st.lastFrameAt)) * 0.1;
        st.lastFrameAt = t1;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const pose = result.landmarks[0];
        if (pose) drawSkeleton(ctx, pose);
        cb.current?.({ frame: toPoseFrame(result, t0), video, width: video.videoWidth, height: video.videoHeight });
        if (t1 - st.lastStats > 250) {
          st.lastStats = t1;
          setStats({
            fps: st.fps,
            inferMs: st.inferMs,
            delegate: model.delegate,
            variant: model.variant,
            width: video.videoWidth,
            height: video.videoHeight,
          });
        }
      }
      schedule();
    };
    schedule();
  };

  const flip = async () => {
    const next: Facing = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    stop();
    await start(next);
  };

  return { videoRef, canvasRef, stageRef, ready, running, facing, error, stats, variant, setVariant, start, stop, flip };
}
