// fitee's landing page (about/index.html): its own script, and nothing else.
// The page shares its origin with the app, so it runs no third-party code and
// reads none of the app's data. The hero's live demo (the app's own renderer),
// the interest list (once a sign-up service is connected) and the chapter rules.
import { startHero } from './hero';
import { startList } from './list';
import { startRules } from './rules';
import type { HeroData } from './types';

const run = (name: string, start: () => void) => {
  try {
    start();
  } catch (e) {
    // One part failing leaves the rest (and the page's static markup) as they are.
    console.error(`landing: ${name}`, e);
  }
};

run('hero', () => {
  const stage = document.querySelector<HTMLElement>('.stage');
  const data = document.getElementById('hero-data')?.textContent;
  if (stage && data) startHero(stage, JSON.parse(data) as HeroData);
});
run('list', () => startList(document));
run('rules', () => startRules(document));
