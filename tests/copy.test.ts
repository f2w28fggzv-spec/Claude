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
const NO_ACCOUNT_ALL = new RegExp(NO_ACCOUNT.source, 'gi');

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

/**
 * The words as a reader gets them, so a phrase split across lines (JSX joins them with a space), by a tag, by
 * JSX's {' '} or by a no-break space (a character, an HTML entity or a string escape) is still one phrase.
 */
const asRead = (text: string) =>
  withoutComments(text)
    .replace(/&nbsp;|&#160;|&#x0*a0;|\\u00a0|\\xa0|\\u\{a0\}/gi, ' ')
    .replace(/\{\s*(['"`])\s*\1\s*\}/g, ' ')
    .replace(/<\/?[a-z][\w.:-]*(?:\s[^<>]*)?\/?>/gi, ' ');

/** Each place the phrase occurs, with a little of the text around it. */
const hits = (text: string) => {
  const read = asRead(text);
  return [...read.matchAll(NO_ACCOUNT_ALL)].map((m) => read.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, ' ').trim());
};

describe('no "no account" in the copy', () => {
  it('catches the phrasings it is meant to', () => {
    for (const s of ['No account', 'no accounts', 'No-account', 'without an account', 'No login needed', 'no log-in']) expect(NO_ACCOUNT.test(s), s).toBe(true);
    for (const s of ['your account', 'ACCOUNT_ID', 'If the app ever adds accounts', 'log in later']) expect(NO_ACCOUNT.test(s), s).toBe(false);
    // However the words are split in the source: across a line break, by a tag or JSX's {' '}, or by a no-break space.
    for (const s of [
      '<p>Train with a plan, log every set, check your technique. No\n            account needed.</p>',
      '<p class="muted">Free to try, no&nbsp;account needed.</p>',
      'no&#160;account',
      "const s = 'no\\u00a0account';",
      'No{\' \'}\n      account needed',
      'No <span class="nowrap">account</span> needed',
      'without\nan account',
    ]) {
      expect(hits(s), s).toHaveLength(1);
    }
    for (const s of ['<p>Your account</p>', 'const x = a < b; // no account here, a comment', '<!-- no account -->']) expect(hits(s), s).toEqual([]);
  });

  it('the app: no screen, text or manifest says it', () => {
    const files = [
      ...walk(join(ROOT, 'src')).filter((f) => /\.(tsx?|json)$/.test(f)),
      join(ROOT, 'index.html'),
      join(ROOT, 'public', 'manifest.webmanifest'),
    ];
    const found = files.flatMap((f) => hits(readFileSync(f, 'utf8')).map((hit) => `${relative(ROOT, f)}: ${hit}`));
    expect(found).toEqual([]);
  });

  it('the landing page: not in its template, nor in the page the build writes, closed or connected', () => {
    const template = readFileSync(join(ROOT, 'about', 'index.html'), 'utf8');
    expect(hits(template)).toEqual([]);
    const configs: (SignupConfig | null)[] = [
      null,
      { service: 'buttondown', id: 'example', contact: 'list@example.com' },
      { service: 'mailerlite', id: '123/456', contact: 'list@example.com' },
      { service: 'formspree', id: 'abc123', contact: 'list@example.com' },
    ];
    for (const config of configs) {
      const page = renderPage(template, signupTarget(config), { poseBytes: 24_198_980 });
      expect(hits(page), config?.service ?? 'closed').toEqual([]);
    }
  });
});
