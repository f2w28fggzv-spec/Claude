import { useEffect, useState } from 'preact/hooks';

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

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const navigate = (to: string) => {
  location.hash = to;
};
