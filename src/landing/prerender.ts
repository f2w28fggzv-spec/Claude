// The build-time half of the landing page: turns the app's own code into the
// page's static HTML. Never part of the page's script. scripts/landing-build.ts
// runs it in Node through Vite's module runner, and the tests call it too.
//
//   - the hero's data for the six full-analysis lifts, from the library
//     (src/data/exercises.ts, src/data/engagement.ts), written into the page
//     as JSON for src/landing/hero.ts;
//   - the hero's first frame as static SVG (the frame the animation starts
//     from, so the figure is there before any script runs, and without one);
//   - every lift's legend and name, stacked in place so the hero keeps one
//     height whichever lift it shows;
//   - the logo mark (src/ui/Logo.tsx), the browser-bar colours
//     (src/theme.ts) and the Content-Security-Policy (src/landing/signup.ts);
//   - the interest list in its closed or connected form.
import { engagementFor } from '../data/engagement';
import { EXERCISES, EXERCISES_BY_ID } from '../data/exercises';
import { MUSCLE_LABELS, type Exercise } from '../data/types';
import type { BodyKind } from '../demo/body';
import { ROLE_LABEL, levelsAt, type Engagement, type Levels } from '../demo/engagement';
import { demoBounds, viewBoxOf } from '../demo/render';
import { timeline } from '../demo/timeline';
import { legendOrder, musclesInWords } from '../screens/ExerciseDemo';
import { THEME_COLOR } from '../theme';
import { LogoMark } from '../ui/Logo';
import { barFill, heroFrame } from './frame';
import { LIFTS } from './lifts';
import { landingCsp, type SignupTarget } from './signup';
import type { HeroData, HeroLift } from './types';

/** The figure the hero starts with (a toggle on the page switches it). */
export const FIRST_BODY: BodyKind = 'female';

/** As the app's exercise page says it (src/screens/ExerciseDemo.tsx). */
const viewOf = (e: Exercise) => (e.demo.view === 'side' ? 'side view' : e.placement.tiltDown ? 'front view from above' : 'front view');

/** The hero's six lifts, from the library. Throws if one is missing or isn't a full-analysis lift. */
export function heroData(): HeroData {
  const lifts = LIFTS.map((lift): HeroLift => {
    const e = EXERCISES_BY_ID.get(lift.id);
    if (!e) throw new Error(`landing: ${lift.id} isn't in the exercise library`);
    if (e.analysis !== 'full') throw new Error(`landing: ${lift.id} isn't a full-analysis lift`);
    const spec = engagementFor(e);
    const order = legendOrder(spec);
    // Only what the page's script reads: the muscles' notes are written into the legends, the "why" is for maintainers.
    const slim: Engagement = {
      profile: spec.profile,
      ...(spec.restAtStart !== undefined && { restAtStart: spec.restAtStart }),
      ...(spec.lowering !== undefined && { lowering: spec.lowering }),
      ...(spec.returnShare !== undefined && { returnShare: spec.returnShare }),
      muscles: spec.muscles.map(({ group, role, peak, profile }) => ({ group, role, peak, ...(profile && { profile }) })),
    };
    return {
      id: e.id,
      name: e.name,
      view: viewOf(e),
      tracking: e.tracking,
      tl: timeline(e, e.demo.pauseFar),
      box: demoBounds(e.demo),
      spec: slim,
      groups: order.map((m) => m.group),
      words: musclesInWords(order),
    };
  });
  return { lifts, body: FIRST_BODY };
}

// ── HTML ───────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON that is safe inside a <script type="application/json"> element. */
export const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

/** SVG elements written as <tag/> when they have no children. */
const SELF_CLOSING = new Set(['rect', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'stop', 'use']);

interface VNodeLike {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

/**
 * A Preact element tree as static HTML, for the app's own components that
 * the page shows (the logo mark). Elements and function components only;
 * the page allows no inline styles, so a `style` prop is an error.
 */
export function toHtml(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return esc(String(node));
  if (Array.isArray(node)) return node.map(toHtml).join('');
  const v = node as VNodeLike;
  if (typeof v.type === 'function') return toHtml((v.type as (p: unknown) => unknown)(v.props));
  if (typeof v.type !== 'string') throw new Error('landing: toHtml can only render elements and function components');
  let attrs = '';
  for (const [name, value] of Object.entries(v.props)) {
    if (name === 'children' || name === 'key' || name === 'ref' || value === false || value === null || value === undefined) continue;
    if (name === 'style' || name === 'dangerouslySetInnerHTML') throw new Error(`landing: the page allows no ${name} (Content-Security-Policy)`);
    if (typeof value === 'function') throw new Error(`landing: event handler ${name} can't be written as HTML`);
    attrs += value === true ? ` ${name}` : ` ${name === 'className' ? 'class' : name}="${esc(String(value))}"`;
  }
  const inner = toHtml(v.props.children);
  return inner === '' && SELF_CLOSING.has(v.type) ? `<${v.type}${attrs}/>` : `<${v.type}${attrs}>${inner}</${v.type}>`;
}

/** The app's logo mark (src/ui/Logo.tsx) as static SVG. */
export const logoMark = (height: number) => toHtml(LogoMark({ height }));

/** A legend bar: the heat-ramp fill over its track. SVG attributes, so the page needs no inline style. */
export function legendBar(level: number): string {
  const { width, fill } = barFill(level);
  return `<svg class="lg-bar" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"><rect class="lg-fill" width="${width}" height="1" fill="${esc(fill)}"/></svg>`;
}

/** One lift's legend: each working muscle, its role, a bar for how hard it works, and what it does. */
function legendList(e: Exercise, levels: Levels, on: boolean): string {
  const rows = legendOrder(engagementFor(e))
    .map(
      (m) =>
        `<li><span class="lg-name">${esc(MUSCLE_LABELS[m.group])} <span class="lg-role">${esc(ROLE_LABEL[m.role])}</span></span>` +
        legendBar(levels[m.group]) +
        (m.note ? `<span class="lg-what">${esc(m.note)}</span>` : '') +
        `</li>`,
    )
    .join('');
  return `<ul class="lg-list${on ? '' : ' is-off'}" data-for="${esc(e.id)}">${rows}</ul>`;
}

/** The figure's description for screen readers (the script keeps it up to date). */
export const stageLabel = (lift: HeroLift, how: 'still' | 'live' | 'static') =>
  `${lift.name}: ${how === 'live' ? 'animated how-to demo' : how === 'still' ? 'how-to demo, the start and the turnaround' : 'how-to demo'}, ${lift.view}. Muscles working: ${lift.words}.`;

export interface Stage {
  /** The first lift's first frame, as an <svg>. */
  figure: string;
  /** Every lift's legend, the first one showing. */
  legends: string;
  /** Every lift's name and view, the first one showing. */
  names: string;
  /** A chip per lift. */
  chips: string;
  /** The first lift's description. */
  label: string;
}

/** The hero's static markup: what the page shows before (and without) its script. */
export function stageMarkup(data: HeroData): Stage {
  const first = data.lifts[0];
  const frame = heroFrame(first, LIFTS[0].demo(), 0, data.body);
  const legends = data.lifts
    .map((lift, i) => {
      const e = EXERCISES_BY_ID.get(lift.id)!;
      // The first lift at the moment the animation starts; the others as they'll start.
      const levels = i === 0 ? frame.levels : levelsAt(lift.spec, { phase: 'start', s: 0, u: 0, action: 'holding' });
      return legendList(e, levels, i === 0);
    })
    .join('');
  const names = data.lifts.map((l, i) => `<span class="dn${i === 0 ? '' : ' is-off'}" data-for="${esc(l.id)}">${esc(l.name)} · ${esc(l.view)}</span>`).join('');
  const chips = LIFTS.map((l, i) => `<button type="button" class="chip" data-lift="${esc(l.id)}" aria-pressed="${i === 0}">${esc(l.short)}</button>`).join('');
  return {
    figure: `<svg viewBox="${viewBoxOf(first.box)}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${frame.markup}</svg>`,
    legends,
    names,
    chips,
    label: stageLabel(first, 'static'),
  };
}

// ── The page ───────────────────────────────────────────────────────────────

/**
 * Keeps or drops the template's conditional parts:
 * <!--fitee:if NAME-->…<!--fitee:else-->…<!--fitee:end-->, nested as needed.
 */
export function conditionals(html: string, when: Record<string, boolean>): string {
  const stack: { on: boolean; inElse: boolean }[] = [];
  const showing = () => stack.every((f) => f.on !== f.inElse);
  let out = '';
  let last = 0;
  for (const m of html.matchAll(/<!--fitee:(if [a-z]+|else|end)-->/g)) {
    if (showing()) out += html.slice(last, m.index);
    last = m.index + m[0].length;
    const token = m[1];
    if (token.startsWith('if ')) {
      const name = token.slice(3);
      if (!(name in when)) throw new Error(`landing: unknown condition "${name}"`);
      stack.push({ on: when[name], inElse: false });
    } else if (token === 'else') {
      const top = stack[stack.length - 1];
      if (!top || top.inElse) throw new Error('landing: <!--fitee:else--> without an open if');
      top.inElse = true;
    } else if (!stack.pop()) throw new Error('landing: <!--fitee:end--> without an open if');
  }
  if (stack.length) throw new Error('landing: a <!--fitee:if--> is never closed');
  if (showing()) out += html.slice(last);
  return out;
}

/** How many exercises the library has, and how many of them get full analysis (the hero shows every one of those). */
export function libraryCounts(): { exercises: number; full: number } {
  const full = EXERCISES.filter((e) => e.analysis === 'full');
  const missing = full.filter((e) => !LIFTS.some((l) => l.id === e.id));
  if (missing.length) throw new Error(`landing: add ${missing.map((e) => e.id).join(', ')} to src/landing/lifts.ts (and the page's text): every full-analysis lift is in the hero`);
  return { exercises: EXERCISES.length, full: full.length };
}

/**
 * The page's HTML from its template (about/index.html):
 *   <!--fitee:head-->              the CSP and the browser-bar colours
 *   <!--fitee:logo-mark 28-->      the logo mark, 28 px tall
 *   <!--fitee:hero-figure-->, <!--fitee:hero-legends-->, <!--fitee:hero-names-->,
 *   <!--fitee:hero-chips-->, <!--fitee:hero-data-->, {{HERO_LABEL}}
 *   <!--fitee:if closed-->…<!--fitee:else-->…<!--fitee:end-->: the interest
 *     list closed (no service yet) or open; also if open, if confirms (the
 *     service emails a link to confirm), if frame / if page (how the form posts)
 *   {{SIGNUP_ACTION}}, {{SIGNUP_FIELD}}, {{SIGNUP_NAME}}, {{SIGNUP_MODE}},
 *   {{SIGNUP_LEAVE}}, {{LIST_STATE}} (closed or open), <!--fitee:signup-extra-->
 *   {{EXERCISE_COUNT}}, {{FULL_COUNT}}: from the library
 * Throws if anything is left unfilled.
 */
export function renderPage(template: string, target: SignupTarget | null): string {
  const data = heroData();
  const stage = stageMarkup(data);
  const counts = libraryCounts();
  const when: Record<string, boolean> = {
    open: target !== null,
    closed: target === null,
    confirms: !!target?.confirms,
    frame: target?.mode === 'frame',
    page: target?.mode === 'page',
  };
  let html = conditionals(template, when);
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${esc(landingCsp(target))}" />`,
    `<meta name="theme-color" content="${THEME_COLOR.light}" media="(prefers-color-scheme: light)" />`,
    `<meta name="theme-color" content="${THEME_COLOR.dark}" media="(prefers-color-scheme: dark)" />`,
  ].join('\n    ');
  const blocks: Record<string, (arg: string) => string> = {
    head: () => head,
    'logo-mark': (arg) => logoMark(Number(arg) || 24),
    'hero-figure': () => stage.figure,
    'hero-legends': () => stage.legends,
    'hero-names': () => stage.names,
    'hero-chips': () => stage.chips,
    'hero-data': () => `<script type="application/json" id="hero-data">${safeJson(data)}</script>`,
    'signup-extra': () =>
      Object.entries(target?.extra ?? {})
        .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`)
        .join(''),
  };
  for (const name of ['head', 'hero-figure', 'hero-legends', 'hero-names', 'hero-chips', 'hero-data']) {
    if (!html.includes(`<!--fitee:${name}-->`)) throw new Error(`landing: the template has no <!--fitee:${name}-->`);
  }
  html = html.replace(/<!--fitee:([a-z-]+)(?: ([^>]*?))?-->/g, (m, name: string, arg = '') => {
    const block = blocks[name];
    if (!block) throw new Error(`landing: unknown block ${m}`);
    return block(arg.trim());
  });
  const values: Record<string, string> = {
    HERO_LABEL: stage.label,
    SIGNUP_ACTION: target?.action ?? '',
    SIGNUP_FIELD: target?.field ?? '',
    SIGNUP_NAME: target?.name ?? '',
    SIGNUP_MODE: target?.mode ?? '',
    SIGNUP_LEAVE: target?.leave ?? '',
    LIST_STATE: target ? 'open' : 'closed',
    EXERCISE_COUNT: String(counts.exercises),
    FULL_COUNT: String(counts.full),
  };
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (m, name: string) => {
    if (!(name in values)) throw new Error(`landing: unknown value ${m}`);
    return esc(values[name]);
  });
  const left = /<!--fitee:[^>]*-->|\{\{[A-Z_]+\}\}/.exec(html);
  if (left) throw new Error(`landing: unfilled ${left[0]}`);
  return html;
}

/**
 * The Molten tokens (tokens.css, the pinned dark set), for the interest
 * list's panel: it is a Molten surface in both themes, as the app's "Log a
 * workout" panel is, so everything on it uses the dark set.
 */
export function moltenTokens(tokensCss: string): string {
  const start = tokensCss.indexOf(":root[data-theme='dark'] {");
  if (start < 0) throw new Error("landing: no :root[data-theme='dark'] block in tokens.css");
  const end = tokensCss.indexOf('\n}', start);
  return tokensCss
    .slice(tokensCss.indexOf('{', start) + 1, end)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('--') || l.startsWith('color-scheme'))
    .join(' ');
}
