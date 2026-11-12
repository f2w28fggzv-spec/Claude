import { useState } from 'preact/hooks';
import { MUSCLE_LABELS, type MuscleGroup } from '../data/types';
import { HEAT_LABELS, type MuscleWeek } from '../log/muscles';
import { BodyFigure } from './anatomy';

const fmt = (n: number) => String(Math.round(n * 2) / 2);

// One colour, blended from the untrained muscle grey to plate green by how
// much of the weekly target a group got. Any training at all starts at 30% so
// a single set is visible; the target (or more) is full strength.
const OFF: [number, number, number] = [0xcd, 0xd1, 0xd7];
const ON: [number, number, number] = [0x1e, 0x9a, 0x55];
const START = 0.3;
const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (t: number) => hex(OFF.map((o, i) => o + (ON[i] - o) * t));

/** Shading strength 0–1 for a group's week. */
export function heatStrength(w: Pick<MuscleWeek, 'sets' | 'share'> | undefined): number {
  if (!w || w.sets <= 0) return 0;
  return START + (1 - START) * Math.min(1, w.share);
}
export const heatColour = (w: Pick<MuscleWeek, 'sets' | 'share'> | undefined) => mix(heatStrength(w));

/**
 * Front and back of the body, each muscle group shaded greener the more of
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
        <i style={{ background: `linear-gradient(90deg, ${mix(0)} 0%, ${mix(0)} 8%, ${mix(START)} 12%, ${mix(1)} 100%)` }} />
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
            <small>The more sets a muscle gets, the greener it is. Tap one for details.</small>
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
