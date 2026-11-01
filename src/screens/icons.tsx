// Inline SVG icons (no icon font or third-party assets, so nothing is fetched).
import type { JSX } from 'preact';
import type { MuscleGroup } from '../data/types';

type Shape = JSX.Element;

// ── Muscle map ────────────────────────────────────────────────────────────
// A human figure (front or back view) with the major muscles drawn as shapes.
// All muscles are shown in a muted tone and the selected group is highlighted.
// Shapes are authored for the figure's left half in a 100 × 200 box and
// mirrored; outlines are smoothed with Catmull-Rom splines.

type Pt = [number, number];

/** Closed smooth path through points (Catmull-Rom → cubic Bézier). */
function smooth(pts: Pt[]): string {
  const n = pts.length;
  const at = (i: number) => pts[(i + n) % n];
  let d = `M${at(0)[0].toFixed(2)} ${at(0)[1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return `${d}Z`;
}
const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [100 - x, y]);
/** One shape on each side of the body. */
const both = (pts: Pt[]) => [smooth(pts), smooth(mirror(pts))];
/** A single shape crossing the midline, from its left half (top to bottom on x ≤ 50). */
const centre = (half: Pt[]) => [smooth([...half, ...mirror(half).reverse()])];

// Silhouette parts (shared by both views).
const TORSO = centre([
  [50, 30.5], [43.5, 31], [36, 33.5], [30, 36.5], [28, 41.5], [29.5, 52], [31, 64], [33.8, 77],
  [33.6, 88], [32, 97], [33.5, 104], [41, 107.5], [50, 109],
]);
const ARM = both([
  [28.5, 38], [24.5, 42], [22, 50], [21, 60], [20, 70], [19.4, 79], [17.4, 91], [15.8, 103], [14.2, 110],
  [14.4, 118], [16.8, 123], [19.4, 120], [20.6, 112], [21.6, 105], [23.8, 94], [25.8, 82], [28, 71], [30, 60], [31, 50],
]);
const LEG = both([
  [32.5, 96], [30.6, 110], [31, 125], [32.8, 137], [33, 146], [32.2, 156], [33.6, 169], [35.6, 181], [35, 188],
  [36.4, 194], [45.4, 194.4], [45.2, 189], [43.4, 181.5], [43.6, 169], [45.2, 156], [44.6, 146], [45.4, 137],
  [47.2, 125], [49.2, 111], [50, 106],
]);
const NECK = centre([[50, 23], [45.2, 24], [44.6, 29], [43, 33], [50, 34]]);

type MuscleShapes = Partial<Record<MuscleGroup, string[]>> & { other: string[] };

const FRONT: MuscleShapes = {
  chest: both([[49, 40], [43, 37.6], [36, 38], [31.4, 42], [31.4, 48.5], [35.2, 53.2], [42, 55], [48.6, 53]]),
  shoulders: both([[32.6, 35.4], [27.6, 38.2], [24, 44], [23.4, 51], [25, 56.4], [28.4, 55.4], [31, 49.6], [32.8, 42.6]]),
  biceps: both([[29, 57.6], [25, 59.6], [22.6, 66], [22.4, 74], [24.4, 78.4], [27.2, 77], [29.2, 69], [30.2, 61.4]]),
  core: [
    ...[
      [57, 64.2],
      [65.6, 72.6],
      [74.2, 81.2],
      [82.8, 93],
    ].flatMap(([y0, y1]) => both([[48.9, y0], [44.6, y0 + 0.4], [44.2, (y0 + y1) / 2], [44.6, y1 - 0.3], [48.9, y1]])),
    ...both([[34, 60], [31.8, 66], [33.2, 77], [36.2, 86], [40, 90], [42.6, 84], [42.2, 70], [39.4, 62]]),
  ],
  quads: [
    ...both([[33.4, 104], [31.8, 114], [32.2, 126], [34.6, 135], [37, 128], [37.4, 115], [36, 106]]),
    ...both([[41, 106], [37.8, 115], [37.6, 128], [39.6, 137], [43, 128], [44.2, 115]]),
    ...both([[44.6, 124], [42.4, 131], [43.2, 137.4], [45.6, 138], [47, 132]]),
  ],
  other: [
    // Upper trapezius, forearms, adductors, shins.
    ...both([[44, 31.4], [37.4, 33.6], [32.4, 35.6], [39.6, 36.2], [45, 34.4]]),
    ...both([[23, 81], [20.2, 88], [18.6, 98], [19.6, 104], [21.6, 98], [24, 88]]),
    ...both([[47.2, 108], [44.8, 115], [45.6, 122], [48.6, 112]]),
    ...both([[35.2, 146], [34.6, 158], [37, 171], [39, 160], [38.6, 148]]),
    ...both([[40.6, 147], [40.2, 158], [42.2, 166], [44.2, 157], [43.6, 148]]),
  ],
};

const BACK: MuscleShapes = {
  back: [
    ...centre([[50, 26.5], [45, 29.4], [37.6, 33], [31, 37], [37, 40.2], [43.4, 47], [47.4, 57], [50, 61.5]]),
    ...both([[31, 54], [30.6, 62], [33, 74], [37, 84], [42, 90], [46, 86], [45, 72], [41, 60], [35, 55]]),
    ...both([[33, 42.4], [31.2, 50], [34, 55], [40, 52.4], [42, 46], [37.4, 41.4]]),
    ...both([[46, 66], [44.6, 76], [44.6, 88], [47, 95], [49.3, 90], [49.3, 72]]),
  ],
  triceps: both([[29.2, 56.6], [24.8, 58.6], [22.2, 65], [21.8, 73], [23.6, 78.6], [26.6, 78], [28.8, 70], [30.2, 61.4]]),
  glutes: both([[34, 96.4], [32.6, 104], [35, 113], [42, 116.4], [48.6, 113], [49, 103], [45, 96], [38, 94.4]]),
  hamstrings: [
    ...both([[33.2, 117.4], [32.2, 127], [34, 137], [37.6, 138], [39, 128], [37.6, 118]]),
    ...both([[40.2, 117.4], [39.6, 128], [41, 138], [44.6, 137], [46, 127], [45.6, 117.4]]),
  ],
  calves: [
    ...both([[34.2, 145], [32.6, 153], [34, 162.4], [37.6, 163.4], [38.6, 153], [37.2, 145]]),
    ...both([[39.6, 145], [39.2, 154], [41, 165.4], [44.6, 163.4], [45.6, 153], [43.6, 146]]),
  ],
  other: [
    // Rear deltoids, forearms, back of the knees and Achilles.
    ...both([[32.4, 35.6], [27.6, 38.4], [24, 44.2], [23.4, 51], [25, 55.8], [28.2, 55], [31, 49], [32.6, 42.4]]),
    ...both([[23, 81], [20.2, 88], [18.6, 98], [19.6, 104], [21.6, 98], [24, 88]]),
    ...both([[37, 168], [37.6, 178], [40.4, 178], [41, 168]]),
  ],
};

const BACK_VIEW: ReadonlySet<MuscleGroup> = new Set(['back', 'triceps', 'glutes', 'hamstrings', 'calves']);

/** Human figure with one muscle group highlighted (front or back view). */
export function MuscleIcon({ group, size = 64 }: { group: MuscleGroup; size?: number }) {
  const back = BACK_VIEW.has(group);
  const map = back ? BACK : FRONT;
  const muscles = Object.entries(map) as [MuscleGroup | 'other', string[]][];
  return (
    <svg class="muscle-icon" viewBox="8 2 84 196" width={size} height={(size * 196) / 84} aria-hidden="true">
      <g class="mi-body">
        {[...ARM, ...LEG, ...TORSO, ...NECK].map((d) => (
          <path d={d} />
        ))}
        <ellipse cx={50} cy={15.5} rx={8.6} ry={11} />
        {back ? (
          <path class="mi-hair" d="M41.6 14 Q41 4.6 50 4.4 Q59 4.6 58.4 14 Q57 21 50 21.6 Q43 21 41.6 14Z" />
        ) : (
          <>
            <ellipse class="mi-ear" cx={41.4} cy={16} rx={1.4} ry={2.6} />
            <ellipse class="mi-ear" cx={58.6} cy={16} rx={1.4} ry={2.6} />
          </>
        )}
      </g>
      {muscles.map(([g, paths]) => (
        <g class={g === group ? 'mi-on' : 'mi-off'}>
          {paths.map((d) => (
            <path d={d} />
          ))}
        </g>
      ))}
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
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
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
