// The design tokens (src/tokens.css): the two dark copies stay the same, and
// field text that shows before anything is typed (placeholders) passes WCAG AA
// (4.5:1) on every fill a field uses, in both themes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const TOKENS = read('src/tokens.css');
const STYLE = read('src/style.css');

/** The custom properties declared in one block of CSS. */
const declarations = (block: string) =>
  Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const block = (re: RegExp) => {
  const m = re.exec(TOKENS);
  if (!m) throw new Error(`tokens.css: no block for ${re}`);
  return declarations(m[1]);
};
const LIGHT = block(/^:root \{([\s\S]*?)\n\}/m);
const DARK_SYSTEM = block(/:root:not\(\[data-theme='light'\]\) \{([\s\S]*?)\n {2}\}/);
const DARK_PINNED = block(/^:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/m);

type RGB = [number, number, number];
/** A colour token's value: #rrggbb, or rgba() laid over `under` (what the eye sees on that surface). */
const rgb = (value: string, under?: RGB): RGB => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as RGB;
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (rgba && under) {
    const a = Number(rgba[4]);
    return [1, 2, 3].map((i, k) => Math.round(Number(rgba[i]) * a + under[k] * (1 - a))) as RGB;
  }
  throw new Error(`not a colour this test reads: ${value}`);
};
const luminance = (c: RGB) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('design tokens', () => {
  it('declares the dark set twice, the same both times (system dark, and the pinned Dark setting)', () => {
    expect(Object.keys(DARK_SYSTEM).length).toBeGreaterThan(50);
    expect(DARK_PINNED).toEqual(DARK_SYSTEM);
  });

  for (const [theme, t] of [
    ['light', LIGHT],
    ['dark', DARK_PINNED],
  ] as const) {
    it(`${theme}: placeholder text passes 4.5:1 on every field fill (cards, sunken set boxes)`, () => {
      const placeholder = rgb(t['--placeholder']);
      for (const fill of ['--card', '--sunken']) {
        expect(contrast(placeholder, rgb(t[fill])), `${t['--placeholder']} on ${fill} ${t[fill]}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: a ticked set's empty box ("BW") reads in the text colour, 4.5:1 or more on its fill`, () => {
      // The ticked fill is --accent-soft, laid over the exercise card it sits on.
      const fill = rgb(t['--accent-soft'], rgb(t['--card']));
      expect(contrast(rgb(t['--text']), fill)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('every field uses the placeholder token (not the browser’s lighter default), and a ticked set the text colour', () => {
    expect(STYLE).toMatch(/\n::placeholder \{ color: var\(--placeholder\); opacity: 1; \}/);
    expect(STYLE).toContain('.set-row.done input::placeholder { color: var(--text); }');
    // No placeholder rule in the app or on the landing page sets a colour of its own.
    for (const css of [STYLE, read('src/landing/landing.css')]) {
      for (const m of css.matchAll(/::placeholder \{([^}]*)\}/g)) expect(m[1]).toMatch(/color: var\(--(placeholder|text)\)/);
    }
  });
});
