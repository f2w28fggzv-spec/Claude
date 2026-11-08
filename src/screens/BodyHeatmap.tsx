import { useState } from 'preact/hooks';
import { MUSCLE_LABELS, type MuscleGroup } from '../data/types';
import { HEAT_LABELS, type HeatLevel, type MuscleWeek } from '../log/muscles';
import { BodyFigure } from './anatomy';

const LEVELS: HeatLevel[] = [0, 1, 2, 3, 4];
const fmt = (n: number) => String(Math.round(n * 2) / 2);

/**
 * Front and back of the body with each muscle group shaded by how much of
 * its weekly set target it got (one green, dim to bright). Tap a muscle or a
 * row for its sets and the exercises that trained it; the list is the same
 * data as text.
 */
export function BodyHeatmap({ weeks, compact = false }: { weeks: MuscleWeek[]; compact?: boolean }) {
  const [sel, setSel] = useState<MuscleGroup | null>(null);
  const by = new Map(weeks.map((w) => [w.group, w]));
  const cls = (g: MuscleGroup | null) => (g ? `heat-${by.get(g)?.level ?? 0}${g === sel ? ' heat-sel' : ''}` : 'heat-n');
  const pick = (g: MuscleGroup) => setSel((cur) => (cur === g ? null : g));
  const trained = weeks.filter((w) => w.sets > 0).length;
  const met = weeks.filter((w) => w.level === 4).length;
  const cur = sel ? by.get(sel) : undefined;
  const summary = `${trained} of ${weeks.length} muscle groups trained, ${met} at target`;

  const list = (
    <ul class="heat-list">
      {weeks.map((w, i) => (
        <li style={{ '--i': String(i) }}>
          <button type="button" class={sel === w.group ? 'on' : ''} aria-pressed={sel === w.group} onClick={() => pick(w.group)}>
            <span class="heat-name">{MUSCLE_LABELS[w.group]}</span>
            <span class="heat-bar" aria-hidden="true">
              <i class={`heat-${w.level}`} style={{ transform: `scaleX(${Math.min(1, w.share)})` }} />
            </span>
            <span class="heat-num">
              {fmt(w.sets)}/{w.target}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div class={`heatmap ${compact ? 'compact' : ''}`}>
      <div class="heat-figures" role="img" aria-label={`Body map: ${summary}.`}>
        <figure>
          <BodyFigure view="front" class="heat-body" muscleClass={cls} onPick={pick} />
          <figcaption>Front</figcaption>
        </figure>
        <figure>
          <BodyFigure view="back" class="heat-body" muscleClass={cls} onPick={pick} />
          <figcaption>Back</figcaption>
        </figure>
      </div>
      <div class="heat-legend" aria-hidden="true">
        {LEVELS.map((l) => (
          <span>
            <i class={`heat-sw heat-${l}`} />
            {HEAT_LABELS[l]}
          </span>
        ))}
      </div>
      <p class="heat-detail" aria-live="polite">
        {cur ? (
          <>
            <span>
              <strong>{MUSCLE_LABELS[cur.group]}</strong> · {fmt(cur.sets)} of {cur.target} sets ({HEAT_LABELS[cur.level].toLowerCase()})
            </span>
            <small>{cur.exercises.length ? cur.exercises.slice(0, 3).join(', ') : 'Not trained yet this week'}</small>
          </>
        ) : (
          <>
            <strong>{summary}</strong>
            <small>Tap a muscle to see its sets. Secondary muscles count as half a set.</small>
          </>
        )}
      </p>
      {compact ? (
        <details class="more small">
          <summary>Sets per muscle</summary>
          {list}
        </details>
      ) : (
        list
      )}
    </div>
  );
}
