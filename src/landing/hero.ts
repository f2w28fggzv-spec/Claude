// The landing page's live demo: the app's own renderer (src/demo) drawing
// the full-analysis lifts frame by frame, the muscles glowing on the heat
// ramp as they work, with the same timing and engagement model as the app's
// exercise page. It paints only while it's on screen and the page is visible.
// Until the visitor picks a lift (or pauses), it moves on to the next lift
// every two reps. With reduced motion it shows the start and the turnaround
// side by side instead, and nothing plays; it follows that setting when it
// changes while the page is open. On a phone (or a small processor)
// it paints at most 30 frames a second: each frame rewrites the figure's SVG,
// and half the frames halve that work while the movement reads the same.
//
// The stage never changes height: every lift's legend and name are already
// in the page (written at build time, stacked in one place), and this only
// shows the current one. The page starts with the first lift's first frame
// (src/landing/prerender.ts), the frame this starts from.
import type { BodyKind } from '../demo/body';
import { levelsAt, peakLevels, type Levels, type Moment } from '../demo/engagement';
import { frameMarkup, viewBoxOf } from '../demo/render';
import type { Demo } from '../demo/types';
import { barFill, heroMarkup, heroState, stageLabel } from './frame';
import { LIFTS } from './lifts';
import type { HeroData, HeroLift } from './types';

/** Reps of one lift before the tour moves on to the next. */
const REPS_PER_LIFT = 2;
/** The shortest time between two painted frames: about 30 a second on phones and small processors, else every frame. */
const MIN_FRAME_MS = lowPower() ? 1000 / 30 - 2 : 0;
const AT_START: Moment = { phase: 'start', s: 0, u: 0, action: 'holding' };
const AT_FAR: Moment = { phase: 'far', s: 1, u: 0, action: 'holding' };

/** The reduced-motion setting, which can change while the page is open (null where it can't be read). */
function reducedMotion(): MediaQueryList | null {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return null;
  }
}

function lowPower(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;
  } catch {
    return false;
  }
}

export function startHero(stage: HTMLElement, data: HeroData): void {
  const figure = stage.querySelector<HTMLElement>('.stage-figure');
  const pause = stage.querySelector<HTMLButtonElement>('.demo-pause');
  if (!figure || !pause) return;
  const chips = [...stage.querySelectorAll<HTMLButtonElement>('.chip[data-lift]')];
  const radios = [...stage.querySelectorAll<HTMLButtonElement>('[data-body-pick]')];
  const legends = new Map([...stage.querySelectorAll<HTMLElement>('.lg-list[data-for]')].map((el) => [el.dataset.for!, el]));
  const names = [...stage.querySelectorAll<HTMLElement>('.dn[data-for]')];
  const lowering = stage.querySelector<HTMLElement>('[data-act="lowering"]');
  const lifting = stage.querySelector<HTMLElement>('[data-act="lifting"]');
  const demos = new Map<string, Demo>();
  const demoOf = (id: string) => {
    let d = demos.get(id);
    if (!d) {
      const lift = LIFTS.find((l) => l.id === id);
      if (!lift) throw new Error(`landing: no demo for ${id}`);
      d = lift.demo();
      demos.set(id, d);
    }
    return d;
  };

  const motion = reducedMotion();
  /** Reduced motion: the start and the turnaround, and nothing plays. */
  let still = !!motion?.matches;
  stage.classList.toggle('is-still', still);
  let index = 0;
  let body: BodyKind = data.body;
  /** The visitor's play / pause (it plays only when motion is allowed, too). */
  let playing = true;
  /** Until the visitor picks a lift or pauses, the demo moves on by itself (only while it plays). */
  let touring = true;
  /** Seconds of animation shown for the current lift, kept across pauses. */
  let clock = 0;
  let painted = '';
  const lift = (): HeroLift => data.lifts[index];

  /** The current legend's bars, in row order (the lift's `groups`). */
  let bars: SVGRectElement[] = [];
  const setBars = (levels: Levels) => {
    lift().groups.forEach((g, i) => {
      const rect = bars[i];
      if (!rect) return;
      const { width, fill } = barFill(levels[g]);
      rect.setAttribute('width', width);
      rect.setAttribute('fill', fill);
    });
  };

  /** One SVG per picture: the live figure, or the start and the turnaround. */
  const pictures = () => [...figure.querySelectorAll<SVGSVGElement>('svg')];
  const layout = () => {
    const box = viewBoxOf(lift().box);
    // A lift drawn wider than tall (the push-up, on the floor): on a phone its stills stack (landing.css).
    figure.classList.toggle('is-wide', lift().box.w > lift().box.h);
    if (!still) {
      // The page's own frame, or (back from the stills) a new one.
      const svg = figure.querySelector<SVGSVGElement>(':scope > svg');
      if (svg) svg.setAttribute('viewBox', box);
      else figure.innerHTML = `<svg viewBox="${box}" preserveAspectRatio="xMidYMax meet" aria-hidden="true"></svg>`;
      return;
    }
    // Reduced motion: the HTML parser makes the SVG elements, so this needs no SVG namespace of its own.
    figure.innerHTML = ['Start', 'Turnaround']
      .map((cap) => `<div class="still"><svg viewBox="${box}" preserveAspectRatio="xMidYMax meet" aria-hidden="true"></svg><span class="still-cap">${cap}</span></div>`)
      .join('');
  };

  const describe = () => {
    const l = lift();
    figure.setAttribute('aria-label', stageLabel(l, still ? 'still' : 'live'));
    for (const c of chips) c.setAttribute('aria-pressed', String(c.dataset.lift === l.id));
    for (const [id, el] of legends) el.classList.toggle('is-off', id !== l.id);
    for (const el of names) el.classList.toggle('is-off', el.dataset.for !== l.id);
    bars = [...(legends.get(l.id)?.querySelectorAll<SVGRectElement>('rect.lg-fill') ?? [])];
    // A radio group: the checked option is the one Tab reaches (roving tabindex).
    for (const r of radios) {
      const on = r.dataset.bodyPick === body;
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on ? 0 : -1;
    }
    stage.dataset.body = body;
    stage.dataset.showing = l.id;
  };

  /** On a phone the chips scroll sideways: the lift the tour moves on to comes into view in the row (the row scrolls, never the page). */
  const revealChip = () => {
    const chip = chips.find((c) => c.dataset.lift === lift().id);
    const row = chip?.parentElement;
    if (!chip || !row || row.scrollWidth <= row.clientWidth) return;
    const c = chip.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (c.left >= r.left && c.right <= r.right) return;
    // Its left edge where the row's scroll-padding puts it, so the chip before it peeks in.
    const peek = parseFloat(getComputedStyle(row).scrollPaddingLeft) || 0;
    row.scrollTo({ left: row.scrollLeft + c.left - r.left - peek, behavior: 'smooth' });
  };

  const paint = () => {
    const l = lift();
    const demo = demoOf(l.id);
    if (still) {
      const [a, b] = pictures();
      if (a) a.innerHTML = frameMarkup(demo, 0, levelsAt(l.spec, AT_START), l.box, { id: 'hero-a', body });
      if (b) b.innerHTML = frameMarkup(demo, 1, levelsAt(l.spec, AT_FAR), l.box, { id: 'hero-b', body });
      // Each muscle at its own hardest point, as the app's still pictures show it.
      setBars(peakLevels(l.spec));
      return;
    }
    const f = heroState(l, clock);
    // Skips the drawing while nothing changes (the pauses of a rep), as the app does.
    const key = `${l.id}|${body}|${f.moment.s.toFixed(4)}|${f.moment.phase === 'back'}|${l.groups.map((g) => barFill(f.levels[g]).fill).join()}`;
    if (key !== painted) {
      painted = key;
      const svg = pictures()[0];
      if (svg) svg.innerHTML = heroMarkup(l, demo, f, body);
      setBars(f.levels);
    }
    // An assisted way back (Engagement.returnShare) isn't the lift itself: neither label lights (as in the app).
    const assisted = f.moment.phase === 'back' && l.spec.returnShare !== undefined;
    lowering?.classList.toggle('on', f.moment.action === 'lowering' && !assisted);
    lifting?.classList.toggle('on', f.moment.action === 'lifting' && !assisted);
  };

  let swap = 0;
  const show = (next: number, fade: boolean) => {
    const go = () => {
      swap = 0;
      index = next;
      clock = 0;
      painted = '';
      layout();
      describe();
      paint();
      figure.classList.remove('fading');
      if (touring && !still) revealChip();
    };
    window.clearTimeout(swap);
    if (fade && !still) {
      figure.classList.add('fading');
      swap = window.setTimeout(go, 220);
    } else go();
  };

  // The animation loop: only while the demo is on screen and the page is visible.
  let raf = 0;
  let last = 0;
  let lastPaint = 0;
  let visible = true;
  const tick = (now: number) => {
    // Long gaps (a tab in the background) don't jump the animation ahead.
    if (last) clock += Math.min(0.1, (now - last) / 1000);
    last = now;
    if (touring && !swap && clock >= REPS_PER_LIFT * lift().tl.total) show((index + 1) % data.lifts.length, true);
    else if (!swap && now - lastPaint >= MIN_FRAME_MS) {
      lastPaint = now;
      paint();
    }
    raf = requestAnimationFrame(tick);
  };
  const start = () => {
    if (raf || still || !playing || !visible || document.hidden) return;
    last = 0;
    lastPaint = 0;
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    }).observe(figure);
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  // A button that says what it does (its label and icon change with it), not a toggle that is "pressed".
  const setPlaying = (on: boolean) => {
    playing = on;
    pause.setAttribute('aria-label', on ? 'Pause the demo' : 'Play the demo');
    stage.classList.toggle('is-paused', !on);
    if (on) start();
    else stop();
  };

  // Reduced motion switched on or off while the page is open: the stills, or the animation, from the same lift.
  const setStill = (on: boolean) => {
    if (on === still) return;
    still = on;
    stop();
    window.clearTimeout(swap);
    swap = 0;
    figure.classList.remove('fading');
    stage.classList.toggle('is-still', still);
    clock = 0;
    painted = '';
    layout();
    describe();
    paint();
    start();
  };
  if (motion) {
    const follow = () => setStill(motion.matches);
    if (typeof motion.addEventListener === 'function') motion.addEventListener('change', follow);
    else motion.addListener(follow); // Safari before 14
  }

  for (const c of chips) {
    // A pick shows that lift from its start; a paused demo stays paused (its play button plays it).
    c.addEventListener('click', () => {
      touring = false;
      const next = data.lifts.findIndex((l) => l.id === c.dataset.lift);
      if (next >= 0) show(next, next !== index);
    });
    // On a phone the chips scroll sideways: a chip that gets keyboard focus comes fully into view (with its
    // neighbour peeking in, from the row's scroll-padding), as the browser doesn't always scroll it there itself.
    c.addEventListener('focus', () => c.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
  const pick = (r: HTMLButtonElement) => {
    const next: BodyKind = r.dataset.bodyPick === 'male' ? 'male' : 'female';
    if (next === body) return;
    body = next;
    painted = '';
    describe();
    paint();
  };
  radios.forEach((r, i) => {
    r.addEventListener('click', () => pick(r));
    // Arrow keys move to the other option and choose it, as in any radio group.
    r.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const other = radios[(i + step + radios.length) % radios.length];
      pick(other);
      other.focus();
    });
  });
  pause.addEventListener('click', () => {
    touring = false;
    setPlaying(!playing);
  });

  stage.classList.add('is-live');
  // Same lift, same frame as the page's own markup: nothing jumps as this takes over.
  layout();
  describe();
  paint();
  setPlaying(playing);
}
