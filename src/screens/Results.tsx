import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getExercise } from '../data/exercises';
import { jointsOf } from '../data/helpers';
import type { Check, Exercise, RelativeHeightCheck } from '../data/types';
import { analyze } from '../engine/analyze';
import { landmarkIndex } from '../engine/landmarks';
import type { AnalysisResult, CheckResult, PoseSequence } from '../engine/types';
import { drawSkeleton } from '../draw';
import { nearestShot } from '../analysis/snapshots';
import { loadOverrides, loadProportions, saveOverride } from '../storage';
import { saveTechnique } from '../log/store';
import { newSetId, saveSet, saveSetVideo } from '../sets/sets';
import { showToast } from '../ui/toast';
import type { RecordedVideo } from './Analyze';
import { Icon } from './icons';

interface Props {
  exercise: Exercise;
  seq: PoseSequence;
  /** In-memory JPEGs by frame index. Dropped when this screen closes. */
  shots: Map<number, Blob>;
  /** The set's video, in memory until saved or this screen closes. */
  video?: RecordedVideo;
  onAgain: () => void;
}

const ICON = { pass: '✓', fail: '✗', unknown: '?' } as const;
const STATUS_TEXT = { pass: 'Pass', fail: 'Fault', unknown: 'Couldn’t judge' } as const;

const mb = (bytes: number) => `${Math.max(0.1, bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;

export function Results({ exercise, seq, shots, video, onAgain }: Props) {
  const [overrides, setOverrides] = useState(loadOverrides);
  const proportions = useMemo(loadProportions, []);
  const result = useMemo(() => analyze(exercise, seq, { proportions: proportions ?? undefined, overrides }), [exercise, seq, overrides]);

  // Pictures are only ever in memory; release them when leaving results.
  useEffect(() => () => shots.clear(), [shots]);

  // Save the outcome to the training log (numbers only) so the coach can use
  // it, and keep a skeleton replay of the set (landmarks + analysis).
  const [saved, setSaved] = useState(false);
  const [setId, setSetId] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<'none' | 'saving' | 'saved'>('none');
  useEffect(() => {
    if (result.reps.length === 0 && !result.hold) return;
    const id = newSetId();
    const at = new Date().toISOString();
    const faults: Record<string, number> = {};
    for (const list of result.hold ? [result.hold.checks] : result.reps.map((r) => r.checks)) {
      for (const c of list) if (c.status === 'fail' && c.fault) faults[c.fault] = (faults[c.fault] ?? 0) + 1;
    }
    const cleanReps = result.hold
      ? Number(result.hold.checks.every((c) => c.status !== 'fail'))
      : result.reps.filter((r) => r.checks.every((c) => c.status !== 'fail')).length;
    if (result.reps.length > 0) saveTechnique({ exerciseId: exercise.id, at, reps: result.reps.length, faults, cleanReps, setId: id });
    void saveSet(
      {
        id,
        exerciseId: exercise.id,
        at,
        source: seq.source === 'file' ? 'file' : 'camera',
        durationSec: Math.round((seq.frames.at(-1)?.t ?? 0) / 100) / 10,
        reps: result.reps.length,
        cleanReps,
        holdSec: result.hold ? Math.round(result.hold.durationSec * 10) / 10 : undefined,
        faults,
        mirrored: video?.mirrored ?? false,
      },
      { seq, result },
    ).then(() => setSetId(id));
    setSaved(true);
    // Saved once per recording, with the thresholds as they were when it finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  const keepVideo = async () => {
    if (!video || !setId) return;
    setVideoState('saving');
    try {
      await saveSetVideo(setId, video.blob, video.offsetMs);
      setVideoState('saved');
      showToast('Video saved on this phone');
    } catch {
      setVideoState('none');
      showToast('Couldn’t save the video: the phone may be out of storage');
    }
  };

  const faultsSeen = new Map<string, number>();
  const checks = result.hold ? [result.hold.checks] : result.reps.map((r) => r.checks);
  for (const list of checks) for (const c of list) if (c.status === 'fail' && c.fault) faultsSeen.set(c.fault, (faultsSeen.get(c.fault) ?? 0) + 1);

  const depthChecks = exercise.checks.filter((c): c is RelativeHeightCheck => c.type === 'relativeHeight');
  const far = exercise.tracking.kind === 'reps' && exercise.tracking.firstMove === 'down' ? 'Bottom' : 'Top';

  return (
    <div class="results">
      <Summary exercise={exercise} result={result} />

      {result.warnings.map((w) => (
        <p class="note">{w}</p>
      ))}

      {faultsSeen.size > 0 && (
        <section class="card">
          <h2>What to work on</h2>
          <ul class="tips">
            {[...faultsSeen].map(([id, n]) => {
              const f = exercise.faults.find((x) => x.id === id);
              if (!f) return null;
              const corrective = getExercise(f.corrective);
              return (
                <li>
                  <Icon name="tip" size={20} />
                  <span>
                    <strong>{f.label}</strong> <span class="muted small">· {n} rep{n === 1 ? '' : 's'}</span>
                    <br />
                    {f.cue}
                    {corrective && (
                      <small>
                        {' '}
                        Practice with <a href={`#/exercise/${f.corrective}`}>{corrective.name.toLowerCase()}</a>.
                      </small>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {result.hold && (
        <section class="card rep">
          <h2>Hold · {result.hold.durationSec.toFixed(1)} s</h2>
          <RepPicture
            exercise={exercise}
            seq={seq}
            shots={shots}
            frame={Math.round((result.hold.startFrame + result.hold.endFrame) / 2)}
            maxMs={3000}
            checks={result.hold.checks}
            side={result.side}
          />
          <RepChecks checks={result.hold.checks} />
        </section>
      )}

      {result.reps.map((rep) => (
        <section class="card rep">
          <h2>
            Rep {rep.index + 1} <span class="muted small">· {rep.durationSec.toFixed(1)} s</span>
          </h2>
          <RepPicture
            exercise={exercise}
            seq={seq}
            shots={shots}
            frame={rep.turnFrame}
            maxMs={350}
            checks={rep.checks}
            side={result.side}
            caption={`${far} of the rep`}
          />
          <RepChecks checks={rep.checks} />
        </section>
      ))}

      {depthChecks.length > 0 && result.reps.length > 0 && (
        <details class="more">
          <summary>Adjust depth strictness</summary>
          {depthChecks.map((c) => {
            const value = overrides[exercise.id]?.[c.id]?.margin ?? c.margin;
            return (
              <label class="slider">
                <span>
                  {c.label}: <strong>{describeMargin(value, c)}</strong>
                </span>
                <input
                  type="range"
                  min={-0.2}
                  max={0.2}
                  step={0.01}
                  value={value}
                  onInput={(e) => setOverrides(saveOverride(exercise.id, c.id, 'margin', Number(e.currentTarget.value)))}
                />
                <span class="muted small">Left is more forgiving, right is stricter. Saved on this phone.</span>
                {value !== c.margin && (
                  <button type="button" class="link" onClick={() => setOverrides(saveOverride(exercise.id, c.id, 'margin', null))}>
                    Reset to default
                  </button>
                )}
              </label>
            );
          })}
        </details>
      )}

      {saved && (
        <section class="card keep-set">
          <p class="saved-note">
            <Icon name="check" size={16} /> Saved to your log with a skeleton replay. The coach uses it to adjust your weights.
          </p>
          {video && videoState !== 'saved' && (
            <button type="button" class={`secondary ${videoState === 'saving' ? 'loading' : ''}`} disabled={!setId || videoState === 'saving'} onClick={() => void keepVideo()}>
              <Icon name="video" size={18} /> Save video on this phone ({mb(video.blob.size)})
            </button>
          )}
          {videoState === 'saved' && (
            <p class="saved-note">
              <Icon name="check" size={16} /> Video saved on this phone. It’s never uploaded.
            </p>
          )}
          {setId && (
            <a class="link center" href={`#/set/${setId}`}>
              <Icon name="play" size={16} /> Watch {videoState === 'saved' ? 'the video' : 'the replay'}
            </a>
          )}
        </section>
      )}
      <p class="muted small center">
        Feedback is still being tuned, so treat it as a guide. {video && videoState !== 'saved' ? 'The video is deleted when you leave unless you save it.' : 'Pictures are deleted when you leave.'}
      </p>
      <div class="stack">
        <button type="button" onClick={onAgain}>
          Record another set
        </button>
        <a class="button secondary" href={`#/exercise/${exercise.id}`}>
          Done
        </a>
      </div>
    </div>
  );
}

function describeMargin(m: number, c: RelativeHeightCheck): string {
  const pct = Math.round(Math.abs(m) * 100);
  if (pct === 0) return `${c.point} level with ${c.reference} counts`;
  const dir = c.relation === 'atOrBelow' ? 'below' : 'above';
  return m > 0 ? `${c.point} must be ${pct}% of torso ${dir} ${c.reference}` : `${c.point} may stop ${pct}% of torso short`;
}

function Summary({ exercise, result }: { exercise: Exercise; result: AnalysisResult }) {
  if (result.kind === 'hold' && !result.hold) {
    return (
      <section class="summary">
        <div class="big">–</div>
        <div class="muted">No hold found</div>
      </section>
    );
  }
  if (result.hold) {
    const c = result.hold.checks[0];
    return (
      <section class="summary">
        <div class="big">{result.hold.durationSec.toFixed(1)} s</div>
        <div class="muted">hold{c ? ` · ${STATUS_TEXT[c.status].toLowerCase()}` : ''}</div>
      </section>
    );
  }
  const n = result.reps.length;
  const clean = result.reps.filter((r) => r.checks.every((c) => c.status === 'pass')).length;
  const perCheck = exercise.checks.map((check) => {
    const all = result.reps.map((r) => r.checks.find((c) => c.checkId === check.id)!);
    return {
      check,
      pass: all.filter((c) => c.status === 'pass').length,
      unknown: all.filter((c) => c.status === 'unknown').length,
    };
  });
  return (
    <section class="summary">
      <div class="big">{n}</div>
      <div class="muted">
        rep{n === 1 ? '' : 's'}
        {n > 0 && exercise.checks.length > 0 && ` · ${clean} of ${n} with no faults`}
      </div>
      {n > 0 && perCheck.length > 0 && perCheck.every((c) => c.pass === n) && <p class="all-good">Every check passed on every rep</p>}
      {n > 0 && perCheck.some((c) => c.pass < n) && (
        <table class="volume">
          <tbody>
            {perCheck.filter((c) => c.pass < n).map(({ check, pass, unknown }) => (
              <tr>
                <th>{check.label}</th>
                <td>
                  {pass}/{n}
                </td>
                <td class="muted small">{unknown ? `${unknown} couldn’t judge` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Only what needs attention; everything else behind "Show all checks". */
function RepChecks({ checks }: { checks: CheckResult[] }) {
  const issues = checks.filter((c) => c.status !== 'pass');
  return (
    <>
      {issues.length === 0 ? (
        checks.length > 0 && <p class="all-good">All checks passed</p>
      ) : (
        <CheckList checks={issues} />
      )}
      {checks.length > issues.length && (
        <details class="more small">
          <summary>Show all checks</summary>
          <CheckList checks={checks} />
        </details>
      )}
    </>
  );
}

function CheckList({ checks }: { checks: CheckResult[] }) {
  return (
    <ul class="checks">
      {checks.map((c) => (
        <li class={c.status}>
          <span class="icon" aria-label={STATUS_TEXT[c.status]}>
            {ICON[c.status]}
          </span>
          <span>
            <strong>{c.label}</strong>
            <span class="muted small">
              {c.status === 'unknown' ? c.reason : `${c.measured}${c.target ? ` · target ${c.target}` : ''}`}
            </span>
            {c.adjustment && <span class="muted small">{c.adjustment}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RepPicture(props: {
  exercise: Exercise;
  seq: PoseSequence;
  shots: Map<number, Blob>;
  frame: number;
  /** How far in time the picture may be from `frame`. */
  maxMs: number;
  checks: CheckResult[];
  side: AnalysisResult['side'];
  caption?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const times = useMemo(() => props.seq.frames.map((f) => f.t), [props.seq]);
  const shot = nearestShot(props.shots, times, props.frame, props.maxMs);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!shot || !ref.current) return;
    const [index, blob] = shot;
    let cancelled = false;
    createImageBitmap(blob)
      .then((bmp) => {
        const canvas = ref.current;
        if (cancelled || !canvas) return bmp.close();
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const lm = props.seq.frames[index]?.lm;
        if (lm) {
          drawSkeleton(ctx, lm.map(([x, y, z, v]) => ({ x, y, z, visibility: v })));
          highlight(ctx, lm, props.exercise, props.checks, props.side);
        }
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [shot?.[0]]);

  if (!shot || failed) return <p class="muted small">No picture for this rep.</p>;
  return (
    <figure class="shot">
      <canvas ref={ref} />
      {props.caption && <figcaption class="muted small">{props.caption}</figcaption>}
    </figure>
  );
}

/** Rings the joints each check used: green for pass, red for a fault. */
function highlight(
  ctx: CanvasRenderingContext2D,
  lm: [number, number, number, number][],
  exercise: Exercise,
  checks: CheckResult[],
  side: AnalysisResult['side'],
) {
  const { width: w, height: h } = ctx.canvas;
  const r = Math.max(w, h) / 45;
  const sides = side === 'both' ? (['left', 'right'] as const) : ([side] as const);
  const colour = new Map<number, string>();
  for (const result of checks) {
    if (result.status === 'unknown') continue;
    const check = exercise.checks.find((c: Check) => c.id === result.checkId);
    if (!check) continue;
    const joints = check.type === 'torsoAngle' ? (['shoulder', 'hip'] as const) : jointsOf(check);
    for (const j of joints)
      for (const s of sides) {
        const i = landmarkIndex(j, s);
        if (result.status === 'fail' || !colour.has(i)) colour.set(i, result.status === 'fail' ? '#ff5c5c' : '#3ddc84');
      }
  }
  ctx.lineWidth = r / 3;
  for (const [i, c] of colour) {
    const p = lm[i];
    if (!p || p[3] < 0.5) continue;
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.arc(p[0] * w, p[1] * h, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}
