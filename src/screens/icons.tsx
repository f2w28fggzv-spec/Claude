// Inline SVG icons (no icon font or third-party assets, so nothing is fetched).
import type { JSX } from 'preact';
import type { MuscleGroup } from '../data/types';
import { BodyFigure, VIEW_OF } from './anatomy';

type Shape = JSX.Element;

// ── Muscle icon ───────────────────────────────────────────────────────────
// The anatomical figure (see anatomy.tsx) with one group highlighted, shown
// from the side that shows that group best.

/** Human figure with one muscle group highlighted (front or back view). */
export function MuscleIcon({ group, size = 64 }: { group: MuscleGroup; size?: number }) {
  return <BodyFigure view={VIEW_OF[group]} class="muscle-icon" width={size} muscleClass={(g) => (g === group ? 'mi-on' : 'mi-off')} />;
}

// ── Line icons ────────────────────────────────────────────────────────────

const ICONS = {
  exercises: (
    <>
      <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
      <circle cx={12} cy={13} r={3.5} />
    </>
  ),
  video: (
    <>
      <rect x={3} y={6} width={13} height={12} rx={2} />
      <path d="M16 10l5-3v10l-5-3z" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  back: <path d="M15 5l-7 7 7 7" />,
  barbell: (
    <>
      <path d="M2 12h20M5 7v10M8 5.5v13M19 7v10M16 5.5v13" />
    </>
  ),
  dumbbell: (
    <>
      <path d="M7 8v8M17 8v8M4.5 10v4M19.5 10v4M7 12h10" />
    </>
  ),
  body: (
    <>
      <circle cx={12} cy={4.5} r={2} />
      <path d="M12 7.5v7M7 10.5l5-1.5 5 1.5M9 21l3-6.5 3 6.5" />
    </>
  ),
  side: (
    <>
      <circle cx={12} cy={4.5} r={2} />
      <path d="M12 7.5v7l-2 6.5M12 14.5l3 6.5M12 9.5l3 3" />
    </>
  ),
  front: (
    <>
      <circle cx={12} cy={4.5} r={2} />
      <path d="M12 7.5v7M7 9l5 1.5L17 9M9 21l3-6.5 3 6.5" />
    </>
  ),
  height: (
    <>
      <path d="M6 21h12M9 21V9h6v12" />
      <rect x={10} y={4} width={4} height={6} rx={1} />
    </>
  ),
  distance: <path d="M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3" />,
  phone: (
    <>
      <rect x={7} y={3} width={10} height={18} rx={2} />
      <path d="M11 18h2" />
    </>
  ),
  phoneSideways: (
    <>
      <rect x={3} y={7} width={18} height={10} rx={2} />
      <path d="M18 11v2" />
    </>
  ),
  tip: (
    <>
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  calendar: (
    <>
      <rect x={4} y={5} width={16} height={15} rx={2} />
      <path d="M4 10h16M9 3v4M15 3v4M8 14h2M12 14h2M16 14h0M8 17h2M12 17h2" />
    </>
  ),
  plan: (
    <>
      <path d="M8 6h11M8 12h11M8 18h11" />
      <circle cx={4.5} cy={6} r={1} />
      <circle cx={4.5} cy={12} r={1} />
      <circle cx={4.5} cy={18} r={1} />
    </>
  ),
  trophy: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3M12 13v4M8.5 20h7M10 17h4v3h-4z" />,
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />,
  play: <path d="M8 5.5v13l10-6.5z" />,
  trash: <path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" />,
  settings: (
    <>
      <circle cx={12} cy={12} r={3} />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  minus: <path d="M5 12h14" />,
  flip: <path d="M4.5 10.5A7.5 7.5 0 0 1 18 7l1.5 1.5M19.5 4v4.5H15M19.5 13.5A7.5 7.5 0 0 1 6 17l-1.5-1.5M4.5 20v-4.5H9" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
} satisfies Record<string, Shape>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/** Signal-style bars for experience level (1–3 filled). */
export function LevelIcon({ level, size = 28 }: { level: 1 | 2 | 3; size?: number }) {
  return (
    <svg class="icon level" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <rect x={4 + i * 6} y={16 - i * 5} width={4} height={5 + i * 5} rx={1} class={i < level ? 'on' : 'off'} />
      ))}
    </svg>
  );
}
