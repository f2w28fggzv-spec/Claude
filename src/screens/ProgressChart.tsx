import { useState } from 'preact/hooks';

export interface ChartPoint {
  date: string;
  /** In display units (kg or lb, reps, seconds). */
  value: number;
  detail: string;
}

const W = 340;
const H = 180;
const PAD = { l: 40, r: 12, t: 12, b: 26 };

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  // Ticks enclose the data so no marker sits below the lowest grid line.
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v < max + step - 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Single-series line chart of one measure over time (estimated one-rep max,
 * most reps or longest hold), with a
 * crosshair that snaps to the nearest session (pointer and arrow keys).
 * The history list under it is the table view.
 */
export function ProgressChart({ points, format, title }: { points: ChartPoint[]; format: (v: number) => string; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const ticks = niceTicks(lo - (hi - lo || hi * 0.1) * 0.15, hi + (hi - lo || hi * 0.1) * 0.15);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const t0 = new Date(points[0].date).getTime();
  const t1 = new Date(points[points.length - 1].date).getTime();
  const x = (i: number) =>
    PAD.l + (t1 === t0 ? (W - PAD.l - PAD.r) / 2 : ((new Date(points[i].date).getTime() - t0) / (t1 - t0)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  const nearest = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    return best;
  };
  const a = active ?? null;

  return (
    <figure class="chart">
      <figcaption>{title}</figcaption>
      <div class="chart-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title}: ${points.length} sessions, from ${format(points[0].value)} to ${format(points[points.length - 1].value)}`}
          tabIndex={0}
          onPointerMove={(e) => setActive(nearest(e.clientX, (e.currentTarget as SVGSVGElement).getBoundingClientRect()))}
          onPointerLeave={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setActive(Math.min(points.length - 1, (a ?? -1) + 1));
            else if (e.key === 'ArrowLeft') setActive(Math.max(0, (a ?? points.length) - 1));
            else return;
            e.preventDefault();
          }}
          onBlur={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g class="grid">
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
              <text x={PAD.l - 6} y={y(t) + 3.5} text-anchor="end">
                {Number(t.toFixed(1))}
              </text>
            </g>
          ))}
          <text class="axis" x={PAD.l} y={H - 6}>
            {shortDate(points[0].date)}
          </text>
          {points.length > 1 && (
            <text class="axis" x={W - PAD.r} y={H - 6} text-anchor="end">
              {shortDate(points[points.length - 1].date)}
            </text>
          )}
          {a !== null && <line class="crosshair" x1={x(a)} x2={x(a)} y1={PAD.t} y2={H - PAD.b} />}
          <path class="series" d={d} />
          {vals.map((v, i) => (
            <circle class={`marker ${a === i ? 'on' : ''}`} cx={x(i)} cy={y(v)} r={a === i ? 6 : 4.5} />
          ))}
        </svg>
        {a !== null && (
          <div
            class={`chart-tip ${y(vals[a]) < H / 2 ? 'below' : ''}`}
            style={{ left: `${Math.min(80, Math.max(20, (x(a) / W) * 100))}%` }}
          >
            <strong>{format(points[a].value)}</strong>
            <span>{new Date(points[a].date).toLocaleDateString()}</span>
            <span>{points[a].detail}</span>
          </div>
        )}
      </div>
    </figure>
  );
}
