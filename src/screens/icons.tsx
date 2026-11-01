// Inline SVG icons (no icon font or third-party assets, so nothing is fetched).
import type { JSX } from 'preact';
import type { MuscleGroup } from '../data/types';

type Shape = JSX.Element;

// ── Muscle pictograms ─────────────────────────────────────────────────────
// A simple body figure (front or back view) with the muscle highlighted.

const BACK_VIEW: ReadonlySet<MuscleGroup> = new Set(['back', 'triceps', 'glutes', 'hamstrings', 'calves']);

const pair = (make: (side: -1 | 1) => Shape): Shape => (
  <>
    {make(-1)}
    {make(1)}
  </>
);
const at = (side: -1 | 1, x: number) => 50 + side * (50 - x);

const REGIONS: Record<MuscleGroup, Shape> = {
  chest: pair((s) => <ellipse cx={at(s, 41)} cy={41} rx={9.5} ry={7} />),
  shoulders: pair((s) => <circle cx={at(s, 30)} cy={34} r={8} />),
  biceps: pair((s) => <ellipse cx={at(s, 26.5)} cy={48} rx={5.4} ry={10.5} transform={`rotate(${s * -14} ${at(s, 26.5)} 48)`} />),
  triceps: pair((s) => <ellipse cx={at(s, 26.5)} cy={48} rx={5.4} ry={10.5} transform={`rotate(${s * -14} ${at(s, 26.5)} 48)`} />),
  core: <rect x={41} y={48} width={18} height={25} rx={6} />,
  back: <path d="M33 35 Q50 31 67 35 L62 66 Q50 71 38 66 Z" />,
  glutes: pair((s) => <circle cx={at(s, 43)} cy={84} r={8.5} />),
  quads: pair((s) => <ellipse cx={at(s, 41)} cy={99} rx={6.6} ry={13.5} transform={`rotate(${s * 3} ${at(s, 41)} 99)`} />),
  hamstrings: pair((s) => <ellipse cx={at(s, 41)} cy={101} rx={6.4} ry={13} transform={`rotate(${s * 3} ${at(s, 41)} 101)`} />),
  calves: pair((s) => <ellipse cx={at(s, 40)} cy={121} rx={5.4} ry={9.5} />),
};

/** Body pictogram with one muscle group highlighted. */
export function MuscleIcon({ group, size = 64 }: { group: MuscleGroup; size?: number }) {
  const back = BACK_VIEW.has(group);
  return (
    <svg class="muscle-icon" viewBox="0 0 100 140" width={size} height={size * 1.4} aria-hidden="true">
      <g class="mi-body">
        <circle cx={50} cy={14} r={10} />
        <path d="M29 30 Q50 25 71 30 L66 73 Q50 79 34 73 Z" />
        <rect x={35} y={70} width={30} height={17} rx={7} />
        <g class="mi-limbs">
          {pair((s) => (
            <>
              <polyline points={`${at(s, 30)},33 ${at(s, 23)},60 ${at(s, 20)},84`} />
              <polyline points={`${at(s, 42)},84 ${at(s, 40)},110 ${at(s, 40)},133`} />
            </>
          ))}
        </g>
        {back ? (
          <line class="mi-detail" x1={50} y1={31} x2={50} y2={70} />
        ) : (
          <polyline class="mi-detail" points="44,29 50,34 56,29" />
        )}
      </g>
      <g class="mi-region">{REGIONS[group]}</g>
    </svg>
  );
}

// ── Line icons ────────────────────────────────────────────────────────────

const ICONS = {
  plan: (
    <>
      <rect x={4} y={5} width={16} height={15} rx={2} />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
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
