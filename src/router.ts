import { useEffect, useRef, useState } from 'preact/hooks';

/** Hash routes work on GitHub Pages without server rewrites. */
export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const hash = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = hash.split('?');
  return { path: p.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

/** How deep a screen sits, to pick the transition direction. Tabs are 0. */
const DEPTH: Record<string, number> = {
  '': 0,
  library: 0,
  log: 0,
  groups: 1,
  exercise: 1,
  program: 1,
  session: 1,
  progress: 1,
  settings: 1,
  camera: 1,
  dev: 1,
  build: 2,
  analyze: 2,
  workout: 2,
};
const depthOf = (r: Route) => DEPTH[r.path[0] ?? ''] ?? 1;

export type NavDirection = 'forward' | 'back' | 'tab';

export function navDirection(from: Route, to: Route): NavDirection {
  const a = depthOf(from);
  const b = depthOf(to);
  if (b > a) return 'forward';
  if (b < a) return 'back';
  if (a === 0) return 'tab';
  // Same depth (e.g. one exercise to another): treat as going forward.
  return 'forward';
}

export const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

type ViewTransitionDoc = Document & { startViewTransition?: (update: () => Promise<void> | void) => unknown };

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  const current = useRef(route);
  useEffect(() => {
    const on = () => {
      const next = parse();
      const dir = navDirection(current.current, next);
      current.current = next;
      document.documentElement.dataset.nav = dir;
      const apply = () => {
        setRoute(next);
        window.scrollTo(0, 0);
      };
      const doc = document as ViewTransitionDoc;
      if (doc.startViewTransition && !prefersReducedMotion()) {
        // The browser snapshots the old page, we render the new one (Preact
        // renders on the next microtask), then it animates between them.
        doc.startViewTransition(() => {
          apply();
          return new Promise<void>((resolve) => setTimeout(resolve, 0));
        });
      } else {
        apply();
      }
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const navigate = (to: string) => {
  location.hash = to;
};
