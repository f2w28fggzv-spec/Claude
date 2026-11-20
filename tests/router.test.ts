import { describe, expect, it } from 'vitest';
import { lastTab, rememberTab, type Route } from '../src/router';

const route = (hash: string): Route => {
  const [p, q = ''] = hash.split('?');
  return { path: p.split('/').filter(Boolean), query: new URLSearchParams(q) };
};

describe('last tab (where Settings goes back to)', () => {
  it('remembers the tab screens and ignores everything else', () => {
    rememberTab(route('library'));
    expect(lastTab()).toBe('library');
    rememberTab(route('settings'));
    rememberTab(route('terms'));
    rememberTab(route('exercise/back-squat'));
    expect(lastTab()).toBe('library');
    rememberTab(route('log'));
    expect(lastTab()).toBe('log');
    rememberTab(route(''));
    expect(lastTab()).toBe('');
  });

  it("doesn't treat a deeper Log route as the Log tab", () => {
    rememberTab(route(''));
    rememberTab(route('log/extra'));
    expect(lastTab()).toBe('');
  });
});
