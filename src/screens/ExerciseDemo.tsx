import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { engagementFor } from '../data/engagement';
import { MUSCLE_LABELS, type Exercise } from '../data/types';
import { ROLE_LABEL, engageColour, levelsAt, momentAt, peakLevels, type Engagement, type Levels, type Moment, type MuscleRole, type MuscleUse } from '../demo/engagement';
import { demoBounds, frameMarkup, viewBoxOf } from '../demo/render';
import { timeline } from '../demo/timeline';

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const ROLE_ORDER: Record<MuscleRole, number> = { main: 0, assist: 1, stabilize: 2 };
/** Muscles as the legend lists them: the ones that move the weight first, hardest-working first. */
export function legendOrder(spec: Engagement): MuscleUse[] {
  return [...spec.muscles].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.peak - a.peak);
}

/** "quads and glutes (main), hamstrings (assists), core (steadies)" for screen readers. */
function musclesInWords(muscles: MuscleUse[]): string {
  const parts: string[] = [];
  for (const role of ['main', 'assist', 'stabilize'] as const) {
    const names = muscles.filter((m) => m.role === role).map((m) => MUSCLE_LABELS[m.group].toLowerCase());
    if (names.length) parts.push(`${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]} (${ROLE_LABEL[role].toLowerCase()})`);
  }
  return parts.join(', ');
}

const AT_START: Moment = { phase: 'start', s: 0, u: 0, action: 'holding' };
const AT_FAR: Moment = { phase: 'far', s: 1, u: 0, action: 'holding' };
let instances = 0;

/** The list under the figure: each working muscle, what it does, and a bar for how hard it works right now. */
function MuscleLegend({ muscles, levels, bars }: { muscles: MuscleUse[]; levels: Levels; bars?: { current: (HTMLElement | null)[] } }) {
  return (
    <div class="demo-muscles">
      <div class="dm-head">
        <strong>Muscles working</strong>
        <span class="dm-key" aria-hidden="true">
          Resting <i /> Hardest
        </span>
      </div>
      <ul>
        {muscles.map((m, i) => (
          <li>
            <span class="dm-name">{MUSCLE_LABELS[m.group]}</span>
            <span class="dm-role">{ROLE_LABEL[m.role]}</span>
            <span class="dm-bar" aria-hidden="true">
              <i
                ref={(el) => {
                  if (bars) bars.current[i] = el;
                }}
                style={{ transform: `scaleX(${levels[m.group].toFixed(3)})`, background: engageColour(levels[m.group]) }}
              />
            </span>
          </li>
        ))}
      </ul>
      <p class="muted small dm-note">Brighter and longer means working harder at that point of the rep. A guide to typical muscle use, not a measurement.</p>
    </div>
  );
}

/**
 * Animated demo of the exercise, drawn from the same camera angle the setup
 * check asks for: a figure whose working muscles glow hotter the harder they
 * work through the rep. Tap to pause. With reduced motion: the start and the
 * turnaround side by side.
 */
export function ExerciseDemo({ exercise, compact = false }: { exercise: Exercise; compact?: boolean }) {
  const demo = exercise.demo;
  const hold = exercise.tracking.kind === 'hold';
  const box = useMemo(() => demoBounds(demo), [demo]);
  const tl = useMemo(() => timeline(exercise, demo.pauseFar), [exercise]);
  const spec = useMemo(() => engagementFor(exercise), [exercise]);
  const muscles = useMemo(() => legendOrder(spec), [spec]);
  const still = useMemo(reducedMotion, []);
  const uid = useMemo(() => `demo${++instances}`, []);
  const [playing, setPlaying] = useState(true);
  const svg = useRef<SVGSVGElement>(null);
  const bars = useRef<(HTMLElement | null)[]>([]);
  const lowering = useRef<HTMLElement>(null);
  const lifting = useRef<HTMLElement>(null);
  /** Seconds of animation shown so far, kept across pauses. */
  const clock = useRef(0);

  const view = demo.view === 'side' ? 'side view' : 'front view';
  const viewBox = viewBoxOf(box);
  const words = musclesInWords(muscles);

  // Paints the frame for the current clock. Skips the work while nothing changes (the pauses of a rep).
  const painted = useRef('');
  const paint = () => {
    const el = svg.current;
    if (!el) return;
    const t = clock.current;
    const m = momentAt(exercise, tl, t);
    const levels = levelsAt(spec, m, t);
    const colours = muscles.map((u) => engageColour(levels[u.group]));
    const key = `${m.s.toFixed(4)}|${colours.join()}`;
    if (key !== painted.current) {
      painted.current = key;
      el.innerHTML = frameMarkup(demo, m.s, levels, box, uid);
      muscles.forEach((u, i) => {
        const bar = bars.current[i];
        if (!bar) return;
        bar.style.transform = `scaleX(${levels[u.group].toFixed(3)})`;
        bar.style.background = colours[i];
      });
    }
    lowering.current?.classList.toggle('on', m.action === 'lowering');
    lifting.current?.classList.toggle('on', m.action === 'lifting');
  };

  useLayoutEffect(() => {
    if (still) return;
    painted.current = '';
    paint();
  }, [still, exercise, box]);

  useEffect(() => {
    if (still || !playing) return;
    const el = svg.current;
    if (!el) return;
    let raf = 0;
    let last = 0;
    let visible = true;
    const tick = (now: number) => {
      // Long gaps (tab in the background) don't jump the animation ahead.
      if (last) clock.current += Math.min(0.1, (now - last) / 1000);
      last = now;
      paint();
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (raf || !visible || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    // Only animate while the demo is on screen.
    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible) start();
            else stop();
          })
        : null;
    io?.observe(el);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [still, playing, exercise, box]);

  if (still) {
    // Reduced motion: still pictures, each muscle at the level it has in that position.
    const shots = hold ? [{ label: 'Hold', s: 0, levels: peakLevels(spec) }] : [{ label: 'Start', s: 0, levels: levelsAt(spec, AT_START) }, { label: 'Turnaround', s: 1, levels: levelsAt(spec, AT_FAR) }];
    return (
      <figure class={`demo ${compact ? 'compact' : ''}`} aria-label={`${exercise.name}: demo, ${view}. Muscles working: ${words}.`}>
        <div class="demo-pair">
          {shots.map((shot, k) => (
            <svg viewBox={viewBox} role="img" aria-label={shot.label} dangerouslySetInnerHTML={{ __html: frameMarkup(demo, shot.s, shot.levels, box, `${uid}-${k}`) }} />
          ))}
        </div>
        {!compact && <MuscleLegend muscles={muscles} levels={peakLevels(spec)} />}
        <figcaption class="muted small">
          {hold ? 'The hold' : 'Start and turnaround'} · {view}
        </figcaption>
      </figure>
    );
  }

  return (
    <figure class={`demo ${compact ? 'compact' : ''}`}>
      <button
        type="button"
        class="demo-stage"
        aria-label={`${exercise.name}: animated demo, ${view}. Muscles working: ${words}. ${playing ? 'Tap to pause' : 'Tap to play'}`}
        onClick={() => setPlaying(!playing)}
      >
        <svg ref={svg} viewBox={viewBox} role="img" aria-hidden="true" />
        <span class="demo-phase" aria-hidden="true">
          {hold ? (
            <b class="on">Hold</b>
          ) : (
            <>
              <b ref={lowering}>Lowering</b>
              <b ref={lifting}>Lifting</b>
            </>
          )}
        </span>
        {!playing && <span class="demo-paused">Paused</span>}
      </button>
      {!compact && <MuscleLegend muscles={muscles} levels={levelsAt(spec, hold ? { phase: 'hold', s: 0, u: 0, action: 'holding' } : AT_START)} bars={bars} />}
      {!compact && (
        <figcaption class="muted small">
          {demo.view === 'side' ? 'Side view' : 'Front view'}, the way your camera should see you · tap to {playing ? 'pause' : 'play'}
        </figcaption>
      )}
    </figure>
  );
}
