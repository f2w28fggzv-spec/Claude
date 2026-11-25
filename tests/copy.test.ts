// Copy that mustn't come back: neither the app nor the landing page says
// "no account" (or "without an account", "no login"). A server with sign-ups
// is planned, so the user asked for every such line to go (CLAUDE.md, hard
// rules). Comments in the code may still talk about it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../src/landing/prerender';
import { signupTarget, type SignupConfig } from '../src/landing/signup';

const ROOT = join(__dirname, '..');
const NO_ACCOUNT = /\bno[\s-]+accounts?\b|\bwithout\s+(an\s+)?accounts?\b|\bno[\s-]+log[\s-]?ins?\b/i;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/** The code without its comments (block, line and HTML), so only what can reach the screen is checked. */
const withoutComments = (text: string) =>
  text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');

const hits = (text: string) => withoutComments(text).split('\n').filter((line) => NO_ACCOUNT.test(line));

describe('no "no account" in the copy', () => {
  it('catches the phrasings it is meant to', () => {
    for (const s of ['No account', 'no accounts', 'No-account', 'without an account', 'No login needed', 'no log-in']) expect(NO_ACCOUNT.test(s), s).toBe(true);
    for (const s of ['your account', 'ACCOUNT_ID', 'If the app ever adds accounts', 'log in later']) expect(NO_ACCOUNT.test(s), s).toBe(false);
  });

  it('the app: no screen, text or manifest says it', () => {
    const files = [
      ...walk(join(ROOT, 'src')).filter((f) => /\.(tsx?|json)$/.test(f)),
      join(ROOT, 'index.html'),
      join(ROOT, 'public', 'manifest.webmanifest'),
    ];
    const found = files.flatMap((f) => hits(readFileSync(f, 'utf8')).map((line) => `${relative(ROOT, f)}: ${line.trim()}`));
    expect(found).toEqual([]);
  });

  it('the landing page: not in its template, nor in the page the build writes, closed or connected', () => {
    const template = readFileSync(join(ROOT, 'about', 'index.html'), 'utf8');
    expect(hits(template)).toEqual([]);
    const configs: (SignupConfig | null)[] = [
      null,
      { service: 'buttondown', id: 'example' },
      { service: 'mailerlite', id: '123/456' },
      { service: 'formspree', id: 'abc123', contact: 'list@example.com' },
    ];
    for (const config of configs) {
      const page = renderPage(template, signupTarget(config), { poseBytes: 24_198_980 });
      expect(hits(page), config?.service ?? 'closed').toEqual([]);
    }
  });
});
