// Anatomical figure (front and back) with individual muscles, each tagged
// with the training group it belongs to (or none, e.g. forearms and shins).
// Shared by the small muscle icons and the weekly body map.
//
// Shapes are authored for the viewer's left half in a 100 × 220 box (figure
// about 8 heads tall) and mirrored; outlines are smoothed with Catmull-Rom
// splines. Muscles are drawn over a darker body so the gaps between them read
// as the separations you see on an anatomy chart.
import type { JSX } from 'preact';
import type { MuscleGroup } from '../data/types';

type Pt = [number, number] | [number, number, 1];
export type View = 'front' | 'back';

/**
 * Closed smooth path through points (Catmull-Rom → cubic Bézier). A point
 * with a third value of 1 is a corner (where a muscle tapers into a tendon).
 */
function smooth(input: Pt[]): string {
  const pts: [number, number][] = input.flatMap((p): [number, number][] => (p.length === 3 ? [[p[0], p[1]], [p[0], p[1]]] : [[p[0], p[1]]]));
  const n = pts.length;
  const at = (i: number) => pts[(i + n) % n];
  let d = `M${at(0)[0].toFixed(2)} ${at(0)[1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return `${d}Z`;
}
const mirror = (pts: Pt[]): Pt[] => pts.map((p) => (p.length === 3 ? [100 - p[0], p[1], 1] : [100 - p[0], p[1]]));
/** One shape on each side of the body. */
const both = (pts: Pt[]) => [smooth(pts), smooth(mirror(pts))];
/** A single shape crossing the midline, from its left half (top to bottom, x ≤ 50). */
const centre = (half: Pt[]) => [smooth([...half, ...mirror(half).reverse()])];

// ── Silhouette (shared by both views) ────────────────────────────────────
const HEAD = centre([[50, 5.2], [45.6, 6.2], [42.6, 9.8], [41.8, 15.2], [42.4, 20.6], [44.2, 25], [47, 28.2], [50, 29]]);
const NECK = centre([[50, 25], [45.4, 25.6], [45, 30.6], [44, 35], [50, 37]]);
const TORSO = centre([
  [50, 33], [46, 32.4], [41, 34.6], [35, 37.6], [30.4, 39.6], [27.6, 42.6], [27.4, 47.4], [28.6, 54], [29.6, 60],
  [30.6, 66], [32.2, 74], [34.4, 82], [35.2, 86], [34.8, 92], [33.4, 98], [32.2, 104], [32.4, 110], [35.6, 113.8],
  [41, 116], [46, 118.2], [50, 119],
]);
const ARM = both([
  [29.8, 38.2], [25.6, 40.4], [23, 44.8], [22, 51], [21.6, 58], [21.4, 66], [21.2, 74], [20.6, 80], [19.2, 86],
  [18.6, 92], [18.2, 99], [17.6, 106], [17.2, 112.4], [16, 117], [15, 122.6], [15.8, 128.8], [18, 131.2], [20, 128],
  [20.8, 122], [21.6, 116.4], [22.8, 110], [24.4, 102], [25.8, 94], [26.8, 86], [27.4, 80], [28.4, 72], [29.4, 64],
  [30.2, 57], [30.6, 50],
]);
const LEG = both([
  [33.4, 100], [31.4, 108], [30.6, 118], [30.8, 128], [31.6, 138], [32.8, 147], [33.8, 154], [33.6, 160], [32.8, 167],
  [32.8, 175], [33.6, 184], [35, 194], [36, 202], [35.4, 207], [36, 211.6], [38.6, 213.8], [43, 213.8], [44.6, 211.4],
  [43.6, 206], [43.2, 198], [43.8, 188], [45, 178], [45.6, 169], [45, 162], [45.6, 156], [46.8, 147], [48, 136],
  [49, 126], [49.6, 118], [50, 112],
]);
const BODY = [...ARM, ...LEG, ...TORSO, ...NECK, ...HEAD];

export interface Muscle {
  name: string;
  group: MuscleGroup | null;
  d: string[];
}

const m = (name: string, group: MuscleGroup | null, d: string[]): Muscle => ({ name, group, d });

// Forearms look much the same from both sides at this scale.
const FOREARM = [
  m('Brachioradialis', null, both([[22.6, 77.4, 1], [21, 81], [19.6, 86.4], [19, 92.4], [18.8, 99], [18.6, 105, 1], [19.8, 104.2], [20.8, 97], [22.2, 90], [23.6, 84.4], [24, 80.2]])),
  m('Forearm flexors', null, both([[26.6, 81.6, 1], [24.8, 83.4], [23.4, 88.6], [21.8, 96], [20.6, 104], [20, 110.6, 1], [21.6, 110], [23.4, 103.6], [25.2, 96.4], [26.4, 89.4], [27, 84.6]])),
];

const FRONT: Muscle[] = [
  m('Sternocleidomastoid', null, both([[44.6, 23.6], [43.8, 25.2], [45.8, 30.2], [47.8, 35.6, 1], [48.8, 34.8], [46.6, 28.6]])),
  m('Trapezius', 'back', both([[45.2, 30.2, 1], [44, 33.4], [40.6, 35.6], [36, 37.8], [31.6, 39.4, 1], [35.6, 39.6], [40.4, 38.6], [44.6, 37.4], [47.4, 37, 1]])),
  m('Triceps (outer head)', 'triceps', both([[23.4, 57.6, 1], [22.4, 61.6], [22, 66.6], [22.4, 70.6, 1], [23.6, 67], [24.2, 62]])),
  m('Brachialis', 'biceps', both([[24, 66.4, 1], [22.6, 70.6], [22.4, 75.6], [23.4, 80], [25.2, 81.2, 1], [24.6, 76.4], [24.2, 71.2]])),
  m('Biceps', 'biceps', both([[29.6, 58.4, 1], [26.4, 61], [24.8, 65], [24.2, 70.4], [24.6, 75.8], [25.8, 80, 1], [27, 80.6], [28.4, 77], [29.2, 71], [29.6, 64.4]])),
  m('Deltoid', 'shoulders', both([[31.6, 39.4, 1], [27.4, 41], [24.6, 44.6], [23, 50], [22.6, 55.6], [23.6, 60.4], [25.6, 63.6, 1], [27.2, 61], [28.6, 57], [29.8, 54.6], [30.8, 50.2], [32.8, 45.2], [35.6, 40, 1]])),
  m('Pectoralis major', 'chest', both([[49.3, 39, 1], [43, 39.2], [37.4, 40.2], [35.4, 41.4, 1], [33.2, 45.6], [31.4, 50], [29.8, 53.2, 1], [31.6, 56.4], [34.6, 59.2], [38.4, 61], [42.8, 61.8], [47, 61.4], [49.3, 60, 1]])),
  ...FOREARM,
  m('External oblique', 'core', both([[31, 58.6, 1], [33.4, 59.8], [37.6, 61.4, 1], [42, 62.4, 1], [42.5, 69.6], [42.5, 78.2], [42.4, 87], [42.9, 94.6], [44.6, 101.4, 1], [39.8, 98.6], [35.2, 95.4, 1], [34.8, 91], [35, 85], [33.8, 79], [32, 72.6], [30.6, 66], [29.8, 60.8]])),
  m(
    'Serratus anterior',
    'core',
    [58.8, 62.6, 66.4, 70.2].flatMap((y) => both([[30.2 + (y - 58.8) * 0.14, y], [33.4, y + 0.3], [35.8, y + 1.6, 1], [33.6, y + 2.9], [30.6 + (y - 58.8) * 0.14, y + 2.9]])),
  ),
  m('Rectus abdominis', 'core', [
    ...[
      [62.2, 69.6],
      [69.6, 78.2],
      [78.2, 87],
    ].flatMap(([y0, y1]) => both([[49.3, y0, 1], [42.4, y0 + 0.2, 1], [42.6, (y0 + y1) / 2], [42.5, y1, 1], [45.8, y1 - 0.6], [49.3, y1 + 0.2, 1]])),
    ...both([[49.3, 87.2, 1], [42.4, 87, 1], [42.9, 94.6], [44.6, 101.4], [46.8, 106.4], [49.3, 109, 1]]),
  ]),
  m('Adductors', null, both([[43, 106.4, 1], [46.6, 108.8], [49.4, 112.6], [49.4, 118.4], [48.8, 126], [48, 133.6, 1], [46.8, 126.4], [45.2, 118.4], [43, 111]])),
  m('Tensor fasciae latae', 'glutes', both([[35, 96.4, 1], [33.4, 100.2], [32, 105.6], [31.6, 111], [32.4, 114.6, 1], [34, 111.4], [35.6, 106.2], [36.4, 100.6]])),
  m('Vastus lateralis', 'quads', both([[32.6, 114.8, 1], [31.4, 121], [31.4, 129], [32.2, 137.6], [33.6, 145.4], [35.4, 151.4], [37.8, 154.2, 1], [39.4, 149.4], [38, 141.4], [36.8, 132.4], [36, 123], [35.6, 115.2]])),
  m('Rectus femoris', 'quads', both([[37.6, 104.6, 1], [36.4, 110], [36.6, 118], [37.4, 127], [38.6, 136], [40.2, 144.4], [41.8, 149.6, 1], [43, 145.6], [43.6, 137.6], [43.2, 128.4], [41.8, 119.6], [39.6, 110.8]])),
  m('Vastus medialis', 'quads', both([[44.8, 134, 1], [44, 140.4], [43.4, 146.6], [44, 151.6], [45.6, 155, 1], [47, 152.6], [46.4, 146.6], [46, 140]])),
  m('Sartorius', null, both([[36, 98.4, 1], [38.2, 99.2], [41.4, 106.6], [44.2, 114.6], [46.2, 123.4], [47.4, 133], [47.8, 143], [47.4, 152.4, 1], [46, 147.6], [45.4, 137.4], [44.2, 127.4], [42.4, 119], [39.8, 110.4], [37, 103]])),
  m('Peroneus longus', 'calves', both([[34.4, 161.4, 1], [33.4, 167], [33.4, 174], [34.2, 181], [35.4, 187.6, 1], [35.6, 180], [34.8, 172.6], [34.8, 166]])),
  m('Tibialis anterior', null, both([[37, 160.6, 1], [35.4, 165.6], [35, 172.6], [35.8, 180.6], [37, 188], [38.2, 194.8, 1], [39, 190], [39.4, 181], [39.2, 171.6], [38.6, 164]])),
  m('Gastrocnemius (inner)', 'calves', both([[43.6, 158, 1], [42.2, 163.6], [41.6, 171], [41.8, 179], [42.8, 185.6, 1], [44.4, 181.6], [45.4, 174], [45.4, 166], [44.8, 160.6]])),
  m('Soleus', 'calves', both([[41.8, 186.2, 1], [41.6, 191], [42.4, 196.4, 1], [43.4, 192], [43.8, 187]])),
];

const BACK: Muscle[] = [
  m('Triceps (outer head)', 'triceps', both([[24.6, 58.2, 1], [22.6, 62.4], [21.8, 68.6], [22.2, 75.2], [23.8, 80.2, 1], [25, 74.6], [25.2, 67], [25.2, 61.6]])),
  m('Triceps (long head)', 'triceps', both([[29.6, 58, 1], [27.2, 59.6], [25.6, 63.4], [25.4, 69.4], [25.8, 75.6], [27, 80.4, 1], [28.6, 77.4], [29.4, 71], [29.8, 64.4]])),
  m('Deltoid', 'shoulders', both([[31.6, 39, 1], [27.4, 40.6], [24.6, 44], [23, 49.4], [22.6, 55.4], [23.6, 60.4], [25.6, 63.8, 1], [27.4, 60.6], [29, 55.6], [31, 50.6], [33.2, 46.4], [34.8, 42, 1]])),
  ...FOREARM,
  m('Latissimus dorsi', 'back', both([[30.4, 59.4, 1], [30.8, 64.4], [32.2, 70.4], [34, 77], [35.6, 83.2], [38.4, 88.8], [42.4, 92.6], [46.4, 94, 1], [46.8, 88], [46.4, 80], [45.6, 72], [44.4, 64], [42.6, 58], [38.6, 57.2], [34.6, 58.6]])),
  m('Erector spinae', 'back', both([[49, 63, 1], [47, 66], [45.8, 74], [45.4, 84], [45.8, 93], [47, 99.4], [49, 101.4, 1]])),
  m('Teres major', 'back', both([[31.4, 53, 1], [30.6, 56.4], [32, 59], [35.2, 59.2], [37.6, 57, 1], [34.6, 55.4]])),
  m('Infraspinatus', 'back', both([[35.4, 42.6], [33.6, 46.8], [32.8, 51], [34, 54.4], [37.4, 55.4], [41, 53.4], [43.6, 49.6, 1], [42.4, 46], [39.4, 43.2]])),
  m('Trapezius', 'back', centre([[50, 24.4, 1], [46.6, 26.6], [45.4, 30.4], [41.6, 33.8], [36, 36.8], [31.6, 39, 1], [34.6, 40.8], [38.8, 42], [42.6, 45.4], [44.8, 51], [46.6, 58.2], [48.4, 66], [50, 72, 1]])),
  m('External oblique', 'core', both([[33.8, 78.4], [34.8, 85], [35, 91], [36.6, 95, 1], [38.6, 92.8], [37, 86], [35.4, 80.4]])),
  m('Gluteus medius', 'glutes', both([[34.6, 92.8], [33.2, 97], [33.6, 101, 1], [37.6, 100.4], [42, 97.8, 1], [40.6, 94.6], [37.6, 92.8]])),
  m('Gluteus maximus', 'glutes', both([[35, 101], [33, 106], [32.8, 112], [34.6, 117.6], [39, 121.6], [44.6, 122.6], [48.6, 120.2], [49.4, 113], [49.2, 104.6, 1], [47, 100.2], [42.4, 98.6], [38.2, 99.6]])),
  m('Adductor magnus', null, both([[46.6, 122.2], [46.2, 127.4], [47.4, 134, 1], [49.2, 128.6], [49.4, 122.8]])),
  m('Vastus lateralis', 'quads', both([[31, 117.6, 1], [30.4, 126], [30.8, 136], [31.6, 142.4, 1], [32, 132], [32.2, 122]])),
  m('Biceps femoris', 'hamstrings', both([[33, 123], [31.6, 130], [31.8, 139], [33.2, 147], [35.4, 153.6, 1], [37.8, 152.8], [38.6, 145], [38.4, 135], [37.6, 126], [35.4, 122.6]])),
  m('Semitendinosus', 'hamstrings', both([[40, 123.4], [39.2, 131], [39.4, 140], [40.6, 148], [42.4, 154.4, 1], [45.4, 153.4], [46.6, 145], [46.8, 135], [46.2, 127], [44.2, 123]])),
  m('Soleus', 'calves', [...both([[34, 176], [34.2, 185], [35.6, 193.6, 1], [37.4, 193.6], [37.6, 186], [36.6, 180]]), ...both([[45.2, 181], [42.8, 186.6], [42.2, 193.6], [43.4, 196, 1], [44.8, 190]])]),
  m('Gastrocnemius', 'calves', [
    ...both([[34.6, 157.6], [33, 163], [32.8, 170], [33.8, 177], [36.2, 182.4, 1], [38.8, 180.4], [39.6, 172], [39.2, 164], [37.4, 158.4]]),
    ...both([[40.6, 157.6], [40, 165], [40.4, 173], [42, 181], [43.8, 185, 1], [45.6, 180], [46, 170], [45.2, 162], [43, 157.4]]),
  ]),
];

export const ANATOMY: Record<View, Muscle[]> = { front: FRONT, back: BACK };

/** The view that shows a group best. */
export const VIEW_OF: Record<MuscleGroup, View> = {
  chest: 'front',
  shoulders: 'front',
  biceps: 'front',
  core: 'front',
  quads: 'front',
  back: 'back',
  triceps: 'back',
  glutes: 'back',
  hamstrings: 'back',
  calves: 'back',
};

interface FigureProps {
  view: View;
  /** Class for each muscle (by its group; null = not a training group). */
  muscleClass: (group: MuscleGroup | null) => string;
  /** Called with a muscle's group when it is tapped. */
  onPick?: (group: MuscleGroup) => void;
  class?: string;
  width?: number;
  /** Crop to the figure (icons) or keep the full box (side-by-side maps). */
  crop?: boolean;
  label?: string;
  children?: JSX.Element | JSX.Element[];
}

/** One view of the figure with every muscle drawn and classed by its group. */
export function BodyFigure({ view, muscleClass, onPick, class: cls = '', width, crop = true, label, children }: FigureProps) {
  const box = crop ? '11 4 78 212' : '0 0 100 220';
  const [, , w, h] = box.split(' ').map(Number);
  return (
    <svg class={`anatomy ${cls}`} viewBox={box} width={width} height={width ? (width * h) / w : undefined} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      <g class="an-body">
        {BODY.map((d) => (
          <path d={d} />
        ))}
        {view === 'back' ? (
          <path class="an-hair" d="M42.4 15.2 Q41.6 5.2 50 5 Q58.4 5.2 57.6 15.2 Q56.4 22.4 50 23 Q43.6 22.4 42.4 15.2Z" />
        ) : (
          <>
            <ellipse class="an-ear" cx={41.8} cy={17.4} rx={1.3} ry={2.6} />
            <ellipse class="an-ear" cx={58.2} cy={17.4} rx={1.3} ry={2.6} />
          </>
        )}
      </g>
      {ANATOMY[view].map((mu) => (
        <g
          class={`an-muscle ${muscleClass(mu.group)}`}
          data-group={mu.group ?? undefined}
          onClick={mu.group && onPick ? () => onPick(mu.group!) : undefined}
        >
          <title>{mu.name}</title>
          {mu.d.map((d) => (
            <path d={d} />
          ))}
        </g>
      ))}
      {children}
    </svg>
  );
}
