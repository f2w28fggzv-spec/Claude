import { useEffect, useState } from 'preact/hooks';
import { getExercise } from '../data/exercises';
import { formRating } from '../log/form';
import { navigate } from '../router';
import { deleteSet, deleteSetVideo, loadSetData, loadSets, loadSetVideo, type SavedSetData, type SavedSetMeta } from '../sets/sets';
import { showToast } from '../ui/toast';
import { Icon } from './icons';
import { Screen } from './Layout';
import { SetPlayer } from './SetPlayer';

const ICON = { pass: '✓', fail: '✗', unknown: '?' } as const;
const mb = (bytes: number) => `${Math.max(0.1, bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;

type Loaded = { meta: SavedSetMeta; data: SavedSetData; url?: string };

/** A saved set: the video or skeleton replay, the form rating and every rep's checks. */
export function SetScreen({ id }: { id: string }) {
  const [state, setState] = useState<'loading' | 'missing' | Loaded>('loading');
  const [jump, setJump] = useState<{ frame: number; n: number }>();

  useEffect(() => {
    let url: string | undefined;
    let alive = true;
    void (async () => {
      const meta = (await loadSets()).find((m) => m.id === id);
      const data = meta ? await loadSetData(id) : undefined;
      if (!alive) return;
      if (!meta || !data) return setState('missing');
      const blob = meta.video ? await loadSetVideo(id) : undefined;
      if (!alive) return;
      url = blob ? URL.createObjectURL(blob) : undefined;
      setState({ meta, data, url });
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  if (state === 'loading') {
    return (
      <Screen title="Saved set" back="log" tab="log">
        <p class="muted">Loading…</p>
      </Screen>
    );
  }
  if (state === 'missing') {
    return (
      <Screen title="Saved set" back="log" tab="log">
        <p class="muted">This set isn’t saved on this phone any more. Older replays are removed to save space; sets with a saved video are kept.</p>
      </Screen>
    );
  }

  const { meta, data, url } = state;
  const ex = getExercise(meta.exerciseId);
  const { result } = data;
  const rating = meta.reps > 0 ? formRating(meta.cleanReps, meta.reps) : result.hold ? formRating(meta.cleanReps, 1) : null;
  const when = new Date(meta.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const removeVideo = async () => {
    if (!confirm('Delete this video? The skeleton replay and results stay.')) return;
    await deleteSetVideo(meta.id);
    if (url) URL.revokeObjectURL(url);
    setState({ meta: { ...meta, video: undefined }, data });
    showToast('Video deleted');
  };
  const removeSet = async () => {
    if (!confirm('Delete this saved set, including any video? Your logged workouts stay.')) return;
    await deleteSet(meta.id);
    showToast('Saved set deleted');
    navigate('/log');
  };

  return (
    <Screen title={ex?.name ?? 'Saved set'} subtitle={`${when} · ${url ? 'video' : 'skeleton replay'}`} back="log" tab="log">
      <SetPlayer exercise={ex} data={data} videoUrl={url} offsetMs={meta.video?.offsetMs ?? 0} mirrored={meta.mirrored} jump={jump} />

      {rating && (
        <section class={`card form-card ${rating.tone}`}>
          <div class="form-score">
            <strong>{rating.pct}%</strong>
            <span>{rating.label}</span>
          </div>
          <p class="muted small">
            {result.hold
              ? `Hold of ${meta.holdSec ?? result.hold.durationSec.toFixed(1)} s, ${meta.cleanReps ? 'no faults' : 'with faults'}.`
              : `${meta.cleanReps} of ${meta.reps} reps had no faults.`}{' '}
            Form rating = share of reps with no faults.
          </p>
        </section>
      )}

      {Object.keys(meta.faults).length > 0 && ex && (
        <section class="card">
          <h2>Remember for next time</h2>
          <ul class="tips">
            {Object.entries(meta.faults).map(([fid, n]) => {
              const f = ex.faults.find((x) => x.id === fid);
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
                        Practice with <a href={`#/exercise/${corrective.id}`}>{corrective.name.toLowerCase()}</a>.
                      </small>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {result.reps.length > 0 && (
        <section class="card">
          <h2>Every rep</h2>
          <ul class="set-reps">
            {result.reps.map((rep) => (
              <li>
                <div class="set-rep-head">
                  <strong>Rep {rep.index + 1}</strong>
                  <span class="muted small">{rep.durationSec.toFixed(1)} s</span>
                  <button type="button" class="link small" onClick={() => setJump({ frame: rep.startFrame, n: Date.now() })}>
                    <Icon name="play" size={14} /> Watch
                  </button>
                </div>
                <ul class="verdicts">
                  {rep.checks.map((c) => (
                    <li class={c.status}>
                      <span class="icon">{ICON[c.status]}</span>
                      <span>
                        {c.label}
                        <small>{c.status === 'unknown' ? (c.reason ?? 'Couldn’t judge') : (c.measured ?? c.target)}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p class="muted small">
        {url
          ? `Video saved on this phone (${mb(meta.video?.bytes ?? 0)}). It’s never uploaded.`
          : 'Skeleton replay: the movement of your body as numbers, no video. Save the video right after a technique check to keep it.'}
      </p>
      <div class="stack">
        {url && (
          <button type="button" class="secondary" onClick={() => void removeVideo()}>
            <Icon name="trash" size={18} /> Delete video
          </button>
        )}
        <button type="button" class="link danger center" onClick={() => void removeSet()}>
          Delete this saved set
        </button>
      </div>
    </Screen>
  );
}
