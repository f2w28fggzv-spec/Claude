import { useEffect, useRef, useState } from 'preact/hooks';
import { getExercise } from '../data/exercises';
import type { Exercise, Placement } from '../data/types';
import { analyze } from '../engine/analyze';
import { point, type Reader } from '../engine/landmarks';
import { ProportionMeter, mergeProportions } from '../engine/personalize';
import { OnlineRepCounter } from '../engine/reps';
import { SetupStabilizer, checkSetup, type SetupStatus } from '../engine/setup';
import { median } from '../engine/signal';
import type { PoseFrame, PoseSequence } from '../engine/types';
import { beep, keepAwake, unlockAudio } from '../analysis/feedback';
import { grabFrames, landmarksFromVideo, withVideoFile, type FileProgress } from '../analysis/fileSource';
import { SnapshotKeeper } from '../analysis/snapshots';
import { usePoseCamera, type LiveFrame } from '../analysis/usePoseCamera';
import { loadHandsFree, loadProportions, saveHandsFree, saveProportions } from '../storage';
import { CameraStage } from './CameraStage';
import { Results } from './Results';
import { PRIVACY, Screen } from './Layout';
import { Icon, type IconName } from './icons';
import { ExerciseDemo } from './ExerciseDemo';

type Stage =
  | { kind: 'intro' }
  | { kind: 'live' }
  | { kind: 'processing'; progress: FileProgress | null }
  | { kind: 'results'; seq: PoseSequence; shots: Map<number, Blob> };

type Phase = 'setup' | 'countdown' | 'recording' | 'finishing';

const COUNTDOWN_MS = 3000;
const MAX_RECORDING_MS = 3 * 60 * 1000;
/** Hands-free stop: out of view this long. */
const ABSENT_STOP_MS = 2000;
/** Hands-free stop: back at the start position and still this long after a rep. */
const STILL_STOP_MS = 3000;
const HOLD_STOP_GRACE_MS = 2000;

export function Analyze({ id }: { id: string }) {
  const exercise = getExercise(id);
  if (!exercise) {
    return (
      <Screen title="Exercise not found" back="library">
        <p>No exercise with that name.</p>
      </Screen>
    );
  }
  return <AnalyzeExercise exercise={exercise} />;
}

function AnalyzeExercise({ exercise }: { exercise: Exercise }) {
  const [stage, setStage] = useState<Stage>({ kind: 'intro' });
  const [error, setError] = useState('');
  const [handsFree, setHandsFree] = useState(loadHandsFree);
  const [phase, setPhase] = useState<Phase>('setup');
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [stable, setStable] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [repCount, setRepCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [measuredLegs, setMeasuredLegs] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  // Per-frame state lives in a ref so the camera loop sees it immediately.
  const live = useRef({
    phase: 'setup' as Phase,
    stabilizer: new SetupStabilizer(),
    meter: new ProportionMeter(),
    torso: [] as number[],
    countdownEnd: 0,
    lastReadyAt: 0,
    lastUiAt: 0,
    lastBeepSecond: -1,
    recStart: 0,
    frames: [] as PoseFrame[],
    width: 0,
    height: 0,
    reader: null as Reader | null,
    counter: null as OnlineRepCounter | null,
    keeper: null as SnapshotKeeper | null,
    lastSeenAt: 0,
    stillSince: 0,
    handsFree,
  });
  live.current.handsFree = handsFree;

  const setLivePhase = (p: Phase) => {
    live.current.phase = p;
    setPhase(p);
  };

  const cam = usePoseCamera((f) => onFrame(f));

  useEffect(() => () => void keepAwake(false), []);

  const resetLive = () => {
    const l = live.current;
    l.stabilizer.reset();
    l.meter = new ProportionMeter();
    l.torso = [];
    l.frames = [];
    l.counter = null;
    l.keeper = null;
    setRepCount(0);
    setElapsed(0);
    setStable(false);
    setSetup(null);
    setMeasuredLegs(false);
    setLivePhase('setup');
  };

  const startCamera = async () => {
    unlockAudio();
    resetLive();
    setError('');
    setStage({ kind: 'live' });
    void keepAwake(true);
    await cam.start();
  };

  const cancelLive = () => {
    cam.stop();
    void keepAwake(false);
    resetLive();
    setStage({ kind: 'intro' });
  };

  const beginRecording = (t: number) => {
    const l = live.current;
    const proportions = l.meter.result();
    if (proportions) saveProportions(mergeProportions(loadProportions(), proportions));
    l.frames = [];
    l.recStart = t;
    l.lastSeenAt = t;
    l.stillSince = 0;
    l.keeper = new SnapshotKeeper();
    const torso = median(l.torso);
    l.counter =
      exercise.tracking.kind === 'reps' && Number.isFinite(torso) ? new OnlineRepCounter(exercise.tracking, torso) : null;
    setRepCount(0);
    setLivePhase('recording');
    beep(1320, 250);
  };

  const finishRecording = async () => {
    const l = live.current;
    if (l.phase !== 'recording') return;
    setLivePhase('finishing');
    beep(660, 300);
    cam.stop();
    void keepAwake(false);
    const shots = (await l.keeper?.finish()) ?? new Map<number, Blob>();
    const seq: PoseSequence = { version: 1, width: l.width, height: l.height, source: 'camera', frames: l.frames };
    l.frames = [];
    l.keeper = null;
    setStage({ kind: 'results', seq, shots });
  };

  function onFrame({ frame, video, width, height }: LiveFrame) {
    const l = live.current;
    l.width = width;
    l.height = height;
    const t = frame.t;

    if (l.phase === 'setup' || l.phase === 'countdown') {
      const status = checkSetup(frame, exercise, width, height);
      const steady = l.stabilizer.push(t, status.ready);
      if (status.ready) {
        l.lastReadyAt = t;
        if (Number.isFinite(status.torsoPx)) l.torso.push(status.torsoPx);
        if (l.torso.length > 90) l.torso.shift();
        l.reader = { width, height, view: exercise.placement.view, side: status.side };
        l.meter.push(frame, l.reader);
      }
      if (l.phase === 'setup' && steady && l.handsFree) {
        l.countdownEnd = t + COUNTDOWN_MS;
        l.lastBeepSecond = -1;
        setLivePhase('countdown');
      }
      if (l.phase === 'countdown') {
        if (t - l.lastReadyAt > 600) {
          setLivePhase('setup'); // moved out of position: start over
        } else {
          const left = Math.ceil((l.countdownEnd - t) / 1000);
          if (left !== l.lastBeepSecond && left > 0) {
            l.lastBeepSecond = left;
            beep(880, 100);
          }
          setCountdown(Math.max(0, left));
          if (t >= l.countdownEnd) beginRecording(t);
        }
      }
      if (t - l.lastUiAt > 150) {
        l.lastUiAt = t;
        setSetup(status);
        setStable(steady);
        setMeasuredLegs(l.meter.legsReady);
      }
      return;
    }

    if (l.phase !== 'recording') return;
    const index = l.frames.length;
    l.frames.push({ t: Math.round(t - l.recStart), lm: frame.lm });
    if (frame.lm) l.lastSeenAt = t;

    if (exercise.tracking.kind === 'reps' && l.counter && l.reader) {
      const p = point(frame, exercise.tracking.joint, l.reader);
      const y = p && p.v >= 0.5 ? p.y : NaN;
      const before = l.counter.count;
      const { confirmed, candidate } = l.counter.push(index, y);
      if (candidate) l.keeper?.candidateFrame(candidate.type, index, video);
      if (confirmed) l.keeper?.confirmed(confirmed);
      if (l.counter.count > before) {
        setRepCount(l.counter.count);
        beep(1100, 60);
      }
      if (l.handsFree && l.counter.count > 0 && l.counter.nearHome(y)) {
        if (!l.stillSince) l.stillSince = t;
        else if (t - l.stillSince > STILL_STOP_MS) void finishRecording();
      } else {
        l.stillSince = 0;
      }
    } else {
      l.keeper?.periodic(index, t, video);
    }

    const absentFor = t - l.lastSeenAt;
    const limit = exercise.tracking.kind === 'hold' ? HOLD_STOP_GRACE_MS : ABSENT_STOP_MS;
    if ((l.handsFree && absentFor > limit) || t - l.recStart > MAX_RECORDING_MS) void finishRecording();
    if (t - l.lastUiAt > 250) {
      l.lastUiAt = t;
      setElapsed((t - l.recStart) / 1000);
    }
  }

  const pickFile = () => {
    setError('');
    fileInput.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    const controller = new AbortController();
    abort.current = controller;
    setStage({ kind: 'processing', progress: null });
    try {
      const out = await withVideoFile(file, async (video) => {
        const seq = await landmarksFromVideo(video, {
          variant: cam.variant,
          signal: controller.signal,
          onProgress: (progress) => setStage({ kind: 'processing', progress }),
        });
        const result = analyze(exercise, seq, { proportions: loadProportions() ?? undefined });
        const wanted = result.hold
          ? [Math.round((result.hold.startFrame + result.hold.endFrame) / 2)]
          : result.reps.map((r) => r.turnFrame);
        const shots = await grabFrames(video, seq, wanted);
        return { seq, shots };
      });
      setStage({ kind: 'results', ...out });
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') setError((err as Error).message ?? String(err));
      setStage({ kind: 'intro' });
    } finally {
      abort.current = null;
    }
  };

  const title = `${exercise.name}`;

  if (stage.kind === 'results') {
    return (
      <Screen title={title} subtitle="Technique check" back={`exercise/${exercise.id}`}>
        <Results exercise={exercise} seq={stage.seq} shots={stage.shots} onAgain={() => setStage({ kind: 'intro' })} />
      </Screen>
    );
  }

  if (stage.kind === 'processing') {
    const p = stage.progress;
    const pct = p ? Math.round((p.done / p.total) * 100) : 0;
    return (
      <Screen title={title} subtitle="Technique check" back={`exercise/${exercise.id}`}>
        <section class="card">
          <h2>Analyzing your video…</h2>
          <progress max={100} value={pct} />
          <p class="muted small">{p ? `${pct}%` : 'Loading video'} · runs on this phone, nothing is uploaded</p>
          <button type="button" class="secondary" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        </section>
      </Screen>
    );
  }

  const inLive = stage.kind === 'live';
  return (
    <Screen title={title} subtitle="Technique check" back={`exercise/${exercise.id}`}>
      {!inLive && (
        <>
          <ExerciseDemo exercise={exercise} compact />
          <h2>Set up your phone</h2>
          <PlacementTiles exercise={exercise} />
          {exercise.placement.notes && <p class="muted small">{exercise.placement.notes}</p>}
          <label class="switch-row">
            <span>
              <strong>Hands-free</strong>
              <small>Starts when you’re in position, stops when you finish</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={handsFree}
              onChange={(e) => {
                setHandsFree(e.currentTarget.checked);
                saveHandsFree(e.currentTarget.checked);
              }}
            />
          </label>
          <button type="button" class="big" disabled={!cam.ready} onClick={startCamera}>
            <Icon name="camera" size={22} /> {cam.ready ? 'Start camera' : 'Loading…'}
          </button>
          <button type="button" class="link center" disabled={!cam.ready} onClick={pickFile}>
            <Icon name="video" size={18} /> Use a video instead
          </button>
          <input ref={fileInput} type="file" accept="video/*" hidden onChange={(e) => void onFile(e.currentTarget.files?.[0])} />
          <p class="privacy small center">{PRIVACY}</p>
        </>
      )}

      <CameraStage cam={cam}>
        {inLive && (
          <div class={`stage-badge ${phase}`}>
            {phase === 'setup' && (setup?.ready ? (stable ? 'In position' : 'Hold still…') : (setup?.nudge ?? 'Starting…'))}
            {phase === 'countdown' && <span class="count">{countdown}</span>}
            {phase === 'recording' &&
              (exercise.tracking.kind === 'reps' ? `● Recording · ${repCount} rep${repCount === 1 ? '' : 's'}` : `● Recording · ${elapsed.toFixed(0)} s`)}
            {phase === 'finishing' && 'Analyzing…'}
          </div>
        )}
      </CameraStage>

      {inLive && (phase === 'setup' || phase === 'countdown') && (
        <>
          <ul class="checks setup">
            {(setup?.items ?? []).map((i) => (
              <li class={i.ok ? 'pass' : i.blocking ? 'fail' : 'unknown'}>
                <span class="icon">{i.ok ? '✓' : i.blocking ? '✗' : '!'}</span>
                <span>{i.label}</span>
              </li>
            ))}
            {exercise.placement.view === 'side' && (
              <li class={measuredLegs ? 'pass' : 'unknown'}>
                <span class="icon">{measuredLegs ? '✓' : '…'}</span>
                <span>{measuredLegs ? 'Body proportions measured' : 'Stand tall for a moment to measure your proportions'}</span>
              </li>
            )}
          </ul>
          <div class="controls">
            <button type="button" disabled={!stable} onClick={() => beginRecording(performance.now())}>
              Record now
            </button>
            <button type="button" class="secondary" onClick={cancelLive}>
              Cancel
            </button>
          </div>
          {handsFree && <p class="muted small">Hands-free is on: recording starts by itself once you’re in position.</p>}
        </>
      )}

      {inLive && phase === 'recording' && (
        <div class="controls">
          <button type="button" onClick={() => void finishRecording()}>
            Stop and analyze
          </button>
          <button type="button" class="secondary" onClick={cancelLive}>
            Discard
          </button>
        </div>
      )}
      {inLive && phase === 'recording' && handsFree && (
        <p class="muted small">
          {exercise.tracking.kind === 'reps'
            ? 'Stops by itself when you stay still at the start position or step out of view.'
            : 'Stops by itself when you step out of view.'}
        </p>
      )}

      {(error || cam.error) && <p class="error">{error || cam.error}</p>}
    </Screen>
  );
}

const HEIGHT_TEXT: Record<Placement['phoneHeight'], string> = {
  floor: 'On the floor',
  knee: 'Knee height',
  hip: 'Hip height',
  chest: 'Chest height',
};

/** Camera placement as four glanceable tiles. */
function PlacementTiles({ exercise }: { exercise: Exercise }) {
  const p = exercise.placement;
  const tiles: [IconName, string][] = [
    [p.view === 'side' ? 'side' : 'front', p.view === 'side' ? 'Film from the side' : 'Face the camera'],
    ['height', HEIGHT_TEXT[p.phoneHeight]],
    ['distance', `${p.distanceM[0]}–${p.distanceM[1]} m away`],
    [p.orientation === 'portrait' ? 'phone' : 'phoneSideways', p.orientation === 'portrait' ? 'Phone upright, 1x' : 'Phone sideways, 1x'],
  ];
  return (
    <div class="place-grid">
      {tiles.map(([icon, text]) => (
        <div class="place">
          <Icon name={icon} size={26} />
          <span>{text}</span>
        </div>
      ))}
    </div>
  );
}
