import { useEffect, useRef, useState } from 'preact/hooks';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Exercise } from '../data/types';
import { drawSkeleton } from '../draw';
import type { PoseFrame } from '../engine/types';
import type { SavedSetData } from '../sets/sets';
import { Icon } from './icons';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Index of the frame nearest to `t` (ms); frames are in time order. */
export function nearestFrame(frames: PoseFrame[], t: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(frames[lo - 1].t - t) < Math.abs(frames[lo].t - t)) return lo - 1;
  return lo;
}

const toLandmarks = (lm: NonNullable<PoseFrame['lm']>): NormalizedLandmark[] => lm.map(([x, y, z, visibility]) => ({ x, y, z, visibility }));

/**
 * Plays a saved set: the video with the skeleton drawn over it, or the
 * skeleton alone when no video was saved. Shows which rep is playing and any
 * faults in it. `jump` seeks to a frame (change `n` to jump again).
 */
export function SetPlayer({
  exercise,
  data,
  videoUrl,
  offsetMs,
  mirrored,
  jump,
}: {
  exercise?: Exercise;
  data: SavedSetData;
  videoUrl?: string;
  offsetMs: number;
  mirrored: boolean;
  jump?: { frame: number; n: number };
}) {
  const { seq, result } = data;
  const frames = seq.frames;
  const duration = Math.max(0.1, (frames.at(-1)?.t ?? 0) / 1000);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const st = useRef({ raf: 0, startedAt: 0, base: 0, playing: false });

  // Frame time (ms since the recording started) shown right now.
  const frameTime = () => {
    const v = videoRef.current;
    if (videoUrl && v) return v.currentTime * 1000 + offsetMs;
    const s = st.current;
    return s.playing ? s.base + (performance.now() - s.startedAt) : s.base;
  };

  const draw = (t: number) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const f = frames[nearestFrame(frames, t)];
    if (f?.lm) drawSkeleton(ctx, toLandmarks(f.lm));
  };

  const tick = () => {
    const s = st.current;
    const t = frameTime();
    if (!videoUrl && t >= duration * 1000) {
      s.playing = false;
      s.base = duration * 1000;
      setPlaying(false);
    }
    draw(Math.min(t, duration * 1000));
    setTime(Math.min(t, duration * 1000) / 1000);
    if (s.playing) s.raf = requestAnimationFrame(tick);
  };

  const seek = (seconds: number) => {
    const t = Math.max(0, Math.min(duration, seconds)) * 1000;
    const v = videoRef.current;
    if (videoUrl && v) v.currentTime = Math.max(0, (t - offsetMs) / 1000);
    st.current.base = t;
    st.current.startedAt = performance.now();
    draw(t);
    setTime(t / 1000);
  };

  const play = () => {
    const s = st.current;
    if (time >= duration - 0.05) seek(0);
    s.playing = true;
    s.startedAt = performance.now();
    s.base = frameTime();
    setPlaying(true);
    if (videoUrl) void videoRef.current?.play().catch(() => undefined);
    cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame(tick);
  };
  const pause = () => {
    const s = st.current;
    s.base = frameTime();
    s.playing = false;
    setPlaying(false);
    videoRef.current?.pause();
    cancelAnimationFrame(s.raf);
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (c) {
      c.width = seq.width;
      c.height = seq.height;
    }
    draw(0);
    return () => cancelAnimationFrame(st.current.raf);
  }, [data]);

  useEffect(() => {
    if (!jump) return;
    pause();
    seek(frames[jump.frame]?.t / 1000 || 0);
  }, [jump?.n]);

  const idx = nearestFrame(frames, time * 1000);
  const rep = result.reps.find((r) => idx >= r.startFrame && idx <= r.endFrame);
  const faults = rep ? rep.checks.filter((c) => c.status === 'fail') : [];
  const faultLabel = (id?: string) => exercise?.faults.find((f) => f.id === id)?.label ?? 'Fault';

  return (
    <div class="player">
      <div class={`stage player-stage ${mirrored ? 'mirrored' : ''}`} style={{ aspectRatio: `${seq.width} / ${seq.height}` }}>
        {videoUrl && <video ref={videoRef} src={videoUrl} playsInline muted preload="auto" onEnded={pause} onLoadedData={() => seek(time)} />}
        <canvas ref={canvasRef} />
      </div>
      <div class="player-status" aria-live="polite">
        {rep ? (
          <>
            <strong>Rep {rep.index + 1}</strong>
            {faults.length ? (
              faults.map((c) => <span class="fault-chip">{faultLabel(c.fault)}</span>)
            ) : (
              <span class="ok-chip">
                <Icon name="check" size={12} /> No faults
              </span>
            )}
          </>
        ) : (
          <span class="muted">{result.hold ? 'Hold' : 'Between reps'}</span>
        )}
      </div>
      <div class="player-controls">
        <button type="button" class="icon-btn play-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => (playing ? pause() : play())}>
          {playing ? <span class="pause-glyph" aria-hidden="true" /> : <Icon name="play" size={20} />}
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.05}
          value={time}
          aria-label="Position in the set"
          onInput={(e) => {
            pause();
            seek(Number(e.currentTarget.value));
          }}
        />
        <span class="player-time">
          {clock(time)} / {clock(duration)}
        </span>
      </div>
    </div>
  );
}
