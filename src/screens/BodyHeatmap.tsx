import { useState } from 'preact/hooks';
import { MUSCLE_LABELS, type MuscleGroup } from '../data/types';
import { HEAT_LABELS, type MuscleWeek } from '../log/muscles';
import { BodyFigure } from './anatomy';

const fmt = (n: number) => String(Math.round(n * 2) / 2);

// A heat map: untrained muscles stay grey; any training starts at amber and
// gets hotter (orange, flame, red) as the group nears its weekly target. One
// colour family (the brand's four plates), so "more" always reads as "hotter".
// The stops are theme variables, so the map follows light and dark.
const START = 0.3;
const STOPS = ['var(--amber)', 'var(--orange)', 'var(--flame)', 'var(--red)'];

/** Shading strength 0–1 for a group's week. */
export function heatStrength(w: Pick<MuscleWeek, 'sets' | 'share'> | undefined): number {
  if (!w || w.sets <= 0) return 0;
  return START + (1 - START) * Math.min(1, w.share);
}
/** CSS colour for a group's week: `var(--hm0)` untrained, else a blend between two heat stops. */
export function heatColour(w: Pick<MuscleWeek, 'sets' | 'share'> | undefined): string {
  return heatAt(heatStrength(w));
}

/** CSS colour at a shading strength (0 = untrained, START..1 = amber to red). */
export function heatAt(strength: number): string {
  if (strength <= 0) return 'var(--hm0)';
  const t = (Math.max(START, Math.min(1, strength)) - START) / (1 - START) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t));
  const f = Math.round((t - i) * 100);
  if (f === 0) return STOPS[i];
  if (f === 100) return STOPS[i + 1];
  return `color-mix(in oklab, ${STOPS[i + 1]} ${f}%, ${STOPS[i]})`;
}

/** Legend: untrained grey, then the four heat stops. */
const LEGEND = 'linear-gradient(90deg, var(--hm0) 0%, var(--hm0) 8%, var(--amber) 12%, var(--orange) 41%, var(--flame) 70%, var(--red) 100%)';

/**
 * Front and back of the body, each muscle group shaded hotter the more of
 * its weekly set target it got. Tap a muscle or a row for its sets and the
 * exercises that trained it; the list is the same data as text.
 */
export function BodyHeatmap({ weeks, compact = false }: { weeks: MuscleWeek[]; compact?: boolean }) {
  const [sel, setSel] = useState<MuscleGroup | null>(null);
  const by = new Map(weeks.map((w) => [w.group, w]));
  const pick = (g: MuscleGroup) => setSel((cur) => (cur === g ? null : g));
  const trained = weeks.filter((w) => w.sets > 0).length;
  const met = weeks.filter((w) => w.level === 4).length;
  const cur = sel ? by.get(sel) : undefined;
  const summary = `${trained} of ${weeks.length} muscle groups trained, ${met} at target`;
  const figure = (view: 'front' | 'back') => (
    <BodyFigure
      view={view}
      class="heat-body"
      muscleClass={(g) => (g ? (g === sel ? 'heat-sel' : '') : 'heat-n')}
      muscleFill={(g) => (g ? heatColour(by.get(g)) : undefined)}
      onPick={pick}
    />
  );

  const list = (
    <ul class="heat-list">
      {weeks.map((w, i) => (
        <li style={{ '--i': String(i) }}>
          <button type="button" class={sel === w.group ? 'on' : ''} aria-pressed={sel === w.group} onClick={() => pick(w.group)}>
            <span class="heat-name">{MUSCLE_LABELS[w.group]}</span>
            <span class="heat-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${Math.min(1, w.share)})`, background: heatColour(w) }} />
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
          {figure('front')}
          <figcaption>Front</figcaption>
        </figure>
        <figure>
          {figure('back')}
          <figcaption>Back</figcaption>
        </figure>
      </div>
      <div class="heat-scale" aria-hidden="true">
        <span>Not trained</span>
        <i style={{ background: LEGEND }} />
        <span>Weekly target</span>
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
            <small>The more sets a muscle gets, the hotter it glows. Tap one for details.</small>
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
