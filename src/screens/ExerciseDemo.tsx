import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Exercise } from '../data/types';
import { attachPoints } from '../demo/attach';
import { add, solve, type Figure, type Side, type Vec } from '../demo/figure';
import { FLOOR } from '../demo/patterns';
import { progressAt, timeline } from '../demo/timeline';
import type { Demo, Prop } from '../demo/types';

const LIMB = 0.034;
const TORSO = 0.05;

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Bounding box over the whole movement, so the view doesn't jump. */
function bounds(demo: Demo): { x: number; y: number; w: number; h: number } {
  const pts: Vec[] = [];
  for (let k = 0; k <= 8; k++) {
    const f = solve(demo.view, demo.pose(k / 8));
    for (const side of [f.a, f.b]) pts.push(...Object.values(side));
    pts.push(add(f.head, { x: -0.07, y: -0.07 }), add(f.head, { x: 0.07, y: 0.07 }));
    for (const p of demo.props ?? []) {
      if ('at' in p && typeof p.at === 'string') {
        const r = p.kind === 'barbell' ? (p.plate ?? 0.125) : 0.06;
        for (const q of attachPoints(f, p.at)) pts.push(add(q, { x: -r, y: -r }), add(q, { x: r, y: r }));
      }
    }
  }
  for (const p of demo.props ?? []) {
    if (p.kind === 'bench') pts.push(...p.points);
    if (p.kind === 'box') pts.push({ x: p.x, y: p.y }, { x: p.x + p.w, y: p.y + p.h });
    if (p.kind === 'bar') pts.push(p.at);
    if (p.kind === 'cable' || p.kind === 'band') pts.push(p.from);
    if (p.kind === 'line') pts.push(p.from, p.to);
    if (p.kind === 'wall') pts.push({ x: p.x, y: p.top });
  }
  const floor = demo.floor === undefined ? FLOOR : demo.floor;
  if (floor !== null) pts.push({ x: pts[0].x, y: floor });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = 0.08;
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

const pts = (...p: Vec[]) => p.map((q) => `${q.x.toFixed(4)},${q.y.toFixed(4)}`).join(' ');

function Limbs({ s, cls }: { s: Side; cls: string }) {
  return (
    <g class={cls}>
      <polyline points={pts(s.hip, s.knee, s.ankle)} stroke-width={LIMB} />
      <polyline points={pts(s.heel, s.toe)} stroke-width={LIMB * 0.8} />
      <polyline points={pts(s.shoulder, s.elbow, s.wrist)} stroke-width={LIMB * 0.85} />
    </g>
  );
}

function PropShape({ p, f, floor }: { p: Prop; f: Figure; floor: number | null }) {
  switch (p.kind) {
    case 'barbell':
      return (
        <g>
          {attachPoints(f, p.at).map((c) => (
            <>
              <circle class="plate" cx={c.x} cy={c.y} r={p.plate ?? 0.125} stroke-width={0.012} />
              <circle class="hub" cx={c.x} cy={c.y} r={0.018} />
            </>
          ))}
        </g>
      );
    case 'dumbbell':
      return (
        <g>
          {attachPoints(f, p.at).map((c) => {
            const [w, h] = p.upright || f.view === 'front' ? [0.05, 0.1] : [0.1, 0.05];
            return <rect class="weight" x={c.x - w / 2} y={c.y - h / 2} width={w} height={h} rx={0.012} />;
          })}
        </g>
      );
    case 'kettlebell':
      return (
        <g>
          {attachPoints(f, p.at).map((c) => (
            <>
              <circle class="handle" cx={c.x} cy={c.y + 0.03} r={0.028} stroke-width={0.012} fill="none" />
              <circle class="weight" cx={c.x} cy={c.y + 0.085} r={0.05} />
            </>
          ))}
        </g>
      );
    case 'bench':
      return (
        <g class="equip">
          <polyline points={pts(...p.points)} stroke-width={0.045} />
          {p.legs !== false && floor !== null && (
            <>
              <line x1={p.points[0].x} y1={p.points[0].y} x2={p.points[0].x} y2={floor} stroke-width={0.02} />
              <line x1={p.points[p.points.length - 1].x} y1={p.points[p.points.length - 1].y} x2={p.points[p.points.length - 1].x} y2={floor} stroke-width={0.02} />
            </>
          )}
        </g>
      );
    case 'box':
      return <rect class="box" x={p.x} y={p.y} width={p.w} height={p.h} rx={0.01} />;
    case 'bar':
      return <circle class="hub" cx={p.at.x} cy={p.at.y} r={0.024} />;
    case 'wall':
      return <line class="equip" x1={p.x} y1={p.top} x2={p.x} y2={floor ?? 0} stroke-width={0.025} />;
    case 'cable':
    case 'band':
      return (
        <g class={p.kind}>
          {attachPoints(f, p.at).map((c) => (
            <line x1={p.from.x} y1={p.from.y} x2={c.x} y2={c.y} stroke-width={0.008} />
          ))}
          {p.kind === 'cable' && <circle class="hub" cx={p.from.x} cy={p.from.y} r={0.025} />}
        </g>
      );
    case 'pad':
      return (
        <g>
          {attachPoints(f, p.at).map((c) => (
            <circle class="padc" cx={c.x + (p.offset?.x ?? 0)} cy={c.y + (p.offset?.y ?? 0)} r={0.035} />
          ))}
        </g>
      );
    case 'attached':
      return (
        <g class="equip">
          {attachPoints(f, p.at).map((c) => (
            <line x1={c.x + p.from.x} y1={c.y + p.from.y} x2={c.x + p.to.x} y2={c.y + p.to.y} stroke-width={p.width ?? 0.02} />
          ))}
        </g>
      );
    case 'line':
      return <line class="equip" x1={p.from.x} y1={p.from.y} x2={p.to.x} y2={p.to.y} stroke-width={p.width ?? 0.02} />;
  }
}

const IN_FRONT = new Set<Prop['kind']>(['barbell', 'dumbbell', 'kettlebell', 'cable', 'band', 'pad', 'attached']);

/** One frame of a demo as SVG content. */
export function DemoFrame({ demo, s, box }: { demo: Demo; s: number; box: ReturnType<typeof bounds> }) {
  const f = solve(demo.view, demo.pose(s));
  const floor = demo.floor === undefined ? FLOOR : demo.floor;
  const props = demo.props ?? [];
  const side = demo.view === 'side';
  return (
    <g>
      {floor !== null && <line class="floor" x1={box.x} y1={floor} x2={box.x + box.w} y2={floor} stroke-width={0.01} />}
      {props.filter((p) => !IN_FRONT.has(p.kind)).map((p) => (
        <PropShape p={p} f={f} floor={floor} />
      ))}
      <Limbs s={f.b} cls={side ? 'far' : 'near'} />
      {side ? (
        <line class="body" x1={(f.a.hip.x + f.b.hip.x) / 2} y1={(f.a.hip.y + f.b.hip.y) / 2} x2={f.a.shoulder.x} y2={f.a.shoulder.y} stroke-width={TORSO} />
      ) : (
        <polygon class="trunk" points={pts(f.a.shoulder, f.b.shoulder, f.b.hip, f.a.hip)} />
      )}
      <circle class="head" cx={f.head.x} cy={f.head.y} r={0.058} />
      {side && <circle class="nose" cx={f.nose.x} cy={f.nose.y} r={0.012} />}
      <Limbs s={f.a} cls="near" />
      {props.filter((p) => IN_FRONT.has(p.kind)).map((p) => (
        <PropShape p={p} f={f} floor={floor} />
      ))}
    </g>
  );
}

/**
 * Animated demo of the exercise, drawn from the same camera angle the setup
 * check asks for. Tap to pause. With reduced motion: start and turnaround
 * side by side.
 */
export function ExerciseDemo({ exercise, compact = false }: { exercise: Exercise; compact?: boolean }) {
  const demo = exercise.demo;
  const box = useMemo(() => bounds(demo), [demo]);
  const tl = useMemo(() => timeline(exercise, demo.pauseFar), [exercise]);
  const still = useMemo(reducedMotion, []);
  const [playing, setPlaying] = useState(true);
  const [s, setS] = useState(0);

  useEffect(() => {
    if (still || !playing || exercise.tracking.kind === 'hold') return;
    let raf = 0;
    const start = performance.now() - tl.total * 1000 * 0.0;
    const tick = (now: number) => {
      setS(progressAt(tl, (now - start) / 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [still, playing, tl]);

  const viewBox = `${box.x} ${box.y} ${box.w} ${box.h}`;
  const label = `${exercise.name}: animated demo, ${demo.view === 'side' ? 'side view' : 'front view'}`;
  if (still && exercise.tracking.kind !== 'hold') {
    return (
      <figure class={`demo ${compact ? 'compact' : ''}`} aria-label={label}>
        <div class="demo-pair">
          {[0, 1].map((k) => (
            <svg viewBox={viewBox} role="img" aria-label={k === 0 ? 'Start' : 'Turnaround'}>
              <DemoFrame demo={demo} s={k} box={box} />
            </svg>
          ))}
        </div>
        <figcaption class="muted small">Start and turnaround · {demo.view === 'side' ? 'side view' : 'front view'}</figcaption>
      </figure>
    );
  }
  return (
    <figure class={`demo ${compact ? 'compact' : ''}`}>
      <button type="button" class="demo-stage" aria-label={`${label}. ${playing ? 'Tap to pause' : 'Tap to play'}`} onClick={() => setPlaying(!playing)}>
        <svg viewBox={viewBox} role="img" aria-hidden="true">
          <DemoFrame demo={demo} s={s} box={box} />
        </svg>
        {!playing && <span class="demo-paused">Paused</span>}
      </button>
      {!compact && (
        <figcaption class="muted small">
          {demo.view === 'side' ? 'Side view' : 'Front view'}, the way your camera should see you · tap to {playing ? 'pause' : 'play'}
        </figcaption>
      )}
    </figure>
  );
}

export { bounds };
