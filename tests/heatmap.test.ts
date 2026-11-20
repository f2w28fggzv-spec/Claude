import { describe, expect, it } from 'vitest';
import { heatAt, heatColour, heatStrength } from '../src/screens/BodyHeatmap';
import { resolveTheme } from '../src/theme';

describe('weekly body map heat ramp', () => {
  it('keeps untrained groups grey and starts any training at amber', () => {
    expect(heatColour({ sets: 0, share: 0 })).toBe('var(--hm0)');
    expect(heatColour(undefined)).toBe('var(--hm0)');
    expect(heatColour({ sets: 1, share: 0 })).toBe('var(--amber)');
  });

  it('reaches red at the weekly target and stays there above it', () => {
    expect(heatColour({ sets: 10, share: 1 })).toBe('var(--red)');
    expect(heatColour({ sets: 20, share: 2 })).toBe('var(--red)');
  });

  it('blends between neighbouring stops, getting hotter with more sets', () => {
    expect(heatAt(0.3 + 0.7 / 3)).toBe('var(--orange)');
    expect(heatAt(0.3 + (0.7 / 3) * 1.5)).toBe('color-mix(in oklab, var(--flame) 50%, var(--orange))');
    const strengths = [0.1, 0.4, 0.7, 1].map((share) => heatStrength({ sets: 1, share }));
    expect(strengths).toEqual([...strengths].sort((a, b) => a - b));
  });
});

describe('theme preference', () => {
  it('follows the phone for "system" and pins light or dark otherwise', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
