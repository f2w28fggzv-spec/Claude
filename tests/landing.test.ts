// The landing page (about/index.html, src/landing/, scripts/landing-build.ts):
// its Content-Security-Policy and the sign-up config it follows, no URL to
// another site, the precache list leaving it out, and the hero drawing the
// library's own demos, starting from the frame written into the page.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXERCISES, EXERCISES_BY_ID } from '../src/data/exercises';
import { engagementFor } from '../src/data/engagement';
import { levelsAt, momentAt } from '../src/demo/engagement';
import { demoBounds, frameMarkup, viewBoxOf } from '../src/demo/render';
import { timeline } from '../src/demo/timeline';
import { heroFrame } from '../src/landing/frame';
import { LIFTS } from '../src/landing/lifts';
import { conditionals, heroData, libraryCounts, moltenTokens, renderPage, stageMarkup, toHtml } from '../src/landing/prerender';
import { landingCsp, PRESETS, SIGNUP, signupTarget, testSignupTarget, type SignupService } from '../src/landing/signup';
import { buildManifest, isListed, LANDING_DIR } from '../src/offline/manifest';
import { listFiles } from '../scripts/offline-build.ts';
import { buildLanding } from '../scripts/landing-build.ts';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const TEMPLATE = read('about/index.html');
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
/** Directive name → its value, from a CSP string. */
const directives = (csp: string) => Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...v]) => [name, v.join(' ')]));
/** http(s) URLs in a text. */
const urls = (text: string) => [...text.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)].map((m) => m[0]);

describe('the page’s Content-Security-Policy follows the sign-up config', () => {
  it('allows only this site’s own files, and no form target or frame while the list is closed', () => {
    expect(SIGNUP).toBeNull(); // the user chose "decide later": not connected yet
    const d = directives(landingCsp(signupTarget(null)));
    expect(d).toEqual({
      'default-src': "'none'",
      'script-src': "'self'",
      'style-src': "'self'",
      'img-src': "'self'",
      'font-src': "'self'",
      'connect-src': "'self'",
      'form-action': "'none'",
      'frame-src': "'none'",
      'object-src': "'none'",
      'base-uri': "'none'",
    });
  });

  it('opens form-action (and frame-src for the hidden frame) to the connected service’s origin only', () => {
    const ids: Record<SignupService, string> = { buttondown: 'fitee', mailerlite: '123456/987654', formspree: 'xyzabcd' };
    for (const service of Object.keys(PRESETS) as SignupService[]) {
      const target = signupTarget({ service, id: ids[service] })!;
      expect(new URL(target.action).origin).toBe(PRESETS[service].origin);
      const d = directives(landingCsp(target));
      expect(d['form-action']).toBe(PRESETS[service].origin);
      expect(d['frame-src']).toBe(target.mode === 'frame' ? PRESETS[service].origin : "'none'");
      expect(d['connect-src']).toBe("'self'");
      expect(d['script-src']).toBe("'self'");
      // A mode of the user's choosing changes the frame rule with it.
      const page = landingCsp(signupTarget({ service, id: ids[service], mode: 'page' }));
      expect(directives(page)['frame-src']).toBe("'none'");
      const frame = landingCsp(signupTarget({ service, id: ids[service], mode: 'frame' }));
      expect(directives(frame)['frame-src']).toBe(PRESETS[service].origin);
    }
    // Formspree posts top-level by default (a CAPTCHA would be lost in a hidden frame); the mailing lists into the frame.
    expect(signupTarget({ service: 'formspree', id: 'abc' })!.mode).toBe('page');
    expect(signupTarget({ service: 'buttondown', id: 'abc' })!.mode).toBe('frame');
    expect(signupTarget({ service: 'mailerlite', id: '1/2' })!.field).toBe('fields[email]');
  });

  it('never allows inline code, eval, data: URLs or any site', () => {
    for (const target of [null, signupTarget({ service: 'buttondown', id: 'x' }), signupTarget({ service: 'formspree', id: 'x' })]) {
      const csp = landingCsp(target);
      expect(csp).not.toMatch(/unsafe-|data:|blob:|\*|http:/);
    }
  });

  it('refuses a config the build can’t use, and a test service anywhere but localhost', () => {
    expect(() => signupTarget({ service: 'buttondown', id: 'bad id/../x' })).toThrow();
    expect(() => signupTarget({ service: 'mailerlite', id: 'not-a-form' })).toThrow();
    expect(() => signupTarget({ service: 'nope' as SignupService, id: 'x' })).toThrow();
    expect(() => testSignupTarget(JSON.stringify({ action: 'https://example.com/subscribe' }))).toThrow();
    expect(() => testSignupTarget(JSON.stringify({ action: 'http://evil.localhost.example/subscribe' }))).toThrow();
    const local = testSignupTarget(JSON.stringify({ action: 'http://localhost:4403/subscribe' }));
    expect(local.origin).toBe('http://localhost:4403');
    expect(directives(landingCsp(local))['form-action']).toBe('http://localhost:4403');
  });
});

describe('no URL to another site in the page’s code', () => {
  const files = [join(ROOT, 'about', 'index.html'), ...walk(join(ROOT, 'src', 'landing')).filter((f) => /\.(ts|css|html)$/.test(f))];

  it('has none outside the sign-up presets, and the presets only name their own service', () => {
    const origins = Object.values(PRESETS).map((p) => p.origin);
    for (const file of files) {
      const found = urls(readFileSync(file, 'utf8'));
      if (relative(ROOT, file) === join('src', 'landing', 'signup.ts')) {
        for (const u of found) expect(origins.some((o) => u === o || u.startsWith(o + '/'))).toBe(true);
      } else expect(found, relative(ROOT, file)).toEqual([]);
    }
  });
});

describe('the precache list leaves the landing page out', () => {
  it('never lists about/, whatever is in it', () => {
    const dir = tmp('fitee-landing-precache-');
    const files = {
      'index.html': '<!doctype html><title>fitee</title>',
      'assets/index-a1.js': 'console.log(1)',
      'about/index.html': '<!doctype html><title>fitee: technique feedback</title>',
      'about/assets/index-b2.js': 'console.log(2)',
      'about/assets/groups-light-480-c3.webp': 'webp',
      'about/licenses/bricolage-grotesque-OFL.txt': 'licence',
      'mediapipe/models/pose_landmarker_full.task': 'model',
    };
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), body);
    }
    const m = buildManifest(listFiles(dir));
    expect([...m.app, ...m.pose].map((e) => e.url).filter((u) => u.startsWith(LANDING_DIR))).toEqual([]);
    expect(m.app.map((e) => e.url)).toEqual(['assets/index-a1.js', 'index.html']);
    expect(isListed('about/index.html')).toBe(false);
    expect(isListed('about.html')).toBe(true);
    // The page can change without changing the app's version.
    writeFileSync(join(dir, 'about/index.html'), '<!doctype html><title>changed</title>');
    expect(buildManifest(listFiles(dir)).version).toBe(m.version);
  });
});

describe('the hero draws the library’s own demos', () => {
  it('shows every full-analysis lift, each the library’s demo frame for frame, both bodies, both ways', () => {
    const counts = libraryCounts();
    expect(counts.full).toBe(LIFTS.length);
    expect(counts.exercises).toBe(EXERCISES.length);
    for (const lift of LIFTS) {
      const e = EXERCISES_BY_ID.get(lift.id)!;
      expect(e.analysis).toBe('full');
      const mine = lift.demo();
      const box = demoBounds(e.demo);
      expect(viewBoxOf(demoBounds(mine))).toBe(viewBoxOf(box));
      const spec = engagementFor(e);
      const tl = timeline(e, e.demo.pauseFar);
      for (const body of ['male', 'female'] as const) {
        for (let k = 0; k <= 12; k++) {
          const t = (k / 12) * tl.total;
          const m = momentAt(e, tl, t);
          const levels = levelsAt(spec, m, t);
          const o = { id: 'x', back: m.phase === 'back', body };
          expect(frameMarkup(mine, m.s, levels, box, o), `${lift.id} ${body} t=${t.toFixed(2)}`).toBe(frameMarkup(e.demo, m.s, levels, box, o));
        }
      }
    }
  });

  it('hands the page the library’s timing, muscles and box for each lift', () => {
    const data = heroData();
    expect(data.lifts.map((l) => l.id)).toEqual(LIFTS.map((l) => l.id));
    for (const l of data.lifts) {
      const e = EXERCISES_BY_ID.get(l.id)!;
      expect(l.name).toBe(e.name);
      expect(l.tl).toEqual(timeline(e, e.demo.pauseFar));
      expect(l.box).toEqual(demoBounds(e.demo));
      expect(l.spec.muscles.map((m) => m.group).sort()).toEqual(engagementFor(e).muscles.map((m) => m.group).sort());
      expect(l.groups.length).toBe(engagementFor(e).muscles.length);
    }
  });

  it('writes into the page the frame the animation starts from, and every lift’s legend stacked in place', () => {
    const data = heroData();
    const stage = stageMarkup(data);
    const first = heroFrame(data.lifts[0], LIFTS[0].demo(), 0, data.body);
    expect(first.moment.s).toBe(0);
    expect(first.moment.phase).toBe('start');
    expect(stage.figure).toBe(`<svg viewBox="${viewBoxOf(data.lifts[0].box)}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${first.markup}</svg>`);
    // One legend and one name per lift; only the first is showing (the rest keep their room).
    for (const l of data.lifts) {
      expect(stage.legends).toContain(`data-for="${l.id}"`);
      expect(stage.names).toContain(`data-for="${l.id}"`);
      expect(stage.chips).toContain(`data-lift="${l.id}"`);
    }
    expect((stage.legends.match(/class="lg-list"/g) ?? []).length).toBe(1);
    expect((stage.legends.match(/class="lg-list is-off"/g) ?? []).length).toBe(data.lifts.length - 1);
    expect((stage.chips.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    // The legend bars are SVG attributes, not inline styles.
    expect(stage.legends).not.toMatch(/style=/);
  });
});

describe('the page’s template', () => {
  it('keeps or drops conditional parts, nested, and refuses unknown or unbalanced ones', () => {
    const t = 'a<!--fitee:if open-->B<!--fitee:if frame-->F<!--fitee:else-->P<!--fitee:end--><!--fitee:else-->C<!--fitee:end-->z';
    expect(conditionals(t, { open: false, frame: false })).toBe('aCz');
    expect(conditionals(t, { open: true, frame: true })).toBe('aBFz');
    expect(conditionals(t, { open: true, frame: false })).toBe('aBPz');
    expect(() => conditionals('<!--fitee:if nope-->x<!--fitee:end-->', {})).toThrow();
    expect(() => conditionals('<!--fitee:if open-->x', { open: true })).toThrow();
    expect(() => conditionals('x<!--fitee:end-->', {})).toThrow();
  });

  it('renders the app’s own components without inline styles', () => {
    expect(() => toHtml({ type: 'span', props: { style: { color: 'red' } } })).toThrow();
    expect(toHtml({ type: 'svg', props: { class: 'x', children: [{ type: 'rect', props: { width: 1 } }] } })).toBe('<svg class="x"><rect width="1"/></svg>');
  });

  it('with the list closed: no form, nothing to type into, and a privacy note that says no email is collected', () => {
    const html = renderPage(TEMPLATE, null);
    expect(html).not.toMatch(/<form|<input|<iframe/);
    expect(html).toContain('Sign-ups open soon');
    expect(html).toContain('No email is collected yet');
    expect(html).toContain('makes no requests to other sites');
    expect(html).toContain('class="soon-pill"');
    expect(html).not.toContain('data-join');
    expect(html).not.toMatch(/\{\{|<!--fitee:/);
  });

  it('once connected: a plain form post to the service, its name in the privacy note and the footer', () => {
    const target = signupTarget({ service: 'buttondown', id: 'fitee' })!;
    const html = renderPage(TEMPLATE, target);
    expect(html).toContain(`<form class="signup" action="${target.action}" method="post" data-mode="frame">`);
    expect(html).toMatch(/<label class="field-label" for="signup-email">Email<\/label>/);
    expect(html).toContain(`name="${target.field}"`);
    expect(html).toContain('<input type="hidden" name="embed" value="1" />');
    expect(html).toContain('aria-describedby="signup-status signup-fine"');
    expect(html).toContain('Sign-ups are handled by Buttondown.');
    expect(html).toContain('the form sends your email address to Buttondown');
    expect(html).not.toContain('makes no requests to other sites');
    expect(html).toContain('If your sign-up went through');
    // A hedged message only: the page can't know whether the address arrived.
    expect(html).not.toMatch(/you(’|')re on the list\.|subscribed|success/i);
    const formspree = renderPage(TEMPLATE, signupTarget({ service: 'formspree', id: 'abc' }));
    expect(formspree).toContain('data-mode="page"');
    expect(formspree).not.toContain('class="thanks"');
  });

  it('gives the panel the Molten tokens, the same as the pinned dark theme', () => {
    const tokens = read('src/tokens.css');
    const molten = moltenTokens(tokens);
    expect(molten).toContain('color-scheme: dark;');
    expect(molten).toContain('--bg: #151619;');
    expect(molten).toContain('--accent-text: #f48a32;');
    expect(molten.split(';').filter((d) => d.trim().startsWith('--')).length).toBeGreaterThan(50);
    expect(read('src/landing/landing.css')).toContain('/* fitee:molten-tokens */');
  });
});

describe('the built page', () => {
  let out = '';
  let html = '';
  beforeAll(async () => {
    out = tmp('fitee-landing-build-');
    await buildLanding(out);
    html = readFileSync(join(out, 'about', 'index.html'), 'utf8');
  }, 60_000);

  it('has the CSP, before anything it governs', () => {
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
    expect(csp?.[1].replace(/&#39;|&apos;/g, "'")).toBe(landingCsp(signupTarget(SIGNUP)));
    const at = html.indexOf('http-equiv="Content-Security-Policy"');
    for (const tag of ['<script', '<link', '<style', '<img']) {
      const i = html.indexOf(tag);
      if (i >= 0) expect(at).toBeLessThan(i);
    }
  });

  it('runs only its own files: no inline script, style or handler, and nothing from another site', () => {
    expect(html).not.toMatch(/<style|\sstyle="|\son[a-z]+="/i);
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      const [, attrs, body] = m;
      if (/type="module"/.test(attrs)) {
        expect(attrs).toMatch(/src="\.\.?\//);
        expect(body.trim()).toBe('');
      } else expect(attrs).toMatch(/type="application\/json"/);
    }
    const files = walk(join(out, 'about'));
    for (const f of files.filter((f) => /\.(html|js|css)$/.test(f))) expect(urls(readFileSync(f, 'utf8')), relative(out, f)).toEqual([]);
    // Every file the page loads is in about/ (nothing of the app's, nothing inlined as data:).
    for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      expect(m[1]).not.toMatch(/^(data:|https?:|\/\/)/);
      expect(new URL(m[1], 'https://example.org/Claude/about/').pathname.startsWith('/Claude/about/')).toBe(true);
    }
    expect(files.every((f) => relative(out, f).startsWith('about'))).toBe(true);
  });

  it('carries the hero’s data and its first frame, and the closed list', () => {
    const data = JSON.parse(/<script type="application\/json" id="hero-data">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(data.lifts.map((l: { id: string }) => l.id)).toEqual(LIFTS.map((l) => l.id));
    expect(html).toContain(stageMarkup(heroData()).figure);
    expect(html).toContain('data-state="closed"');
  });
});
