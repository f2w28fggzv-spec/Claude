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
import { conditionals, fullList, heroData, libraryCounts, moltenTokens, renderPage, stageMarkup, toHtml } from '../src/landing/prerender';
import { landingCsp, PRESETS, SIGNUP, signupTarget, testSignupTarget, type SignupConfig, type SignupService } from '../src/landing/signup';
import { buildManifest, isListed, LANDING_DIR } from '../src/offline/manifest';
import { formatMB } from '../src/offline/state';
import { listFiles } from '../scripts/offline-build.ts';
import { buildLanding, landingFolder, notOwnCode, poseBytes } from '../scripts/landing-build.ts';

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
const urls = (text: string) => [...text.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)].map((m) => m[0].replace(/[;,.]+$/, ''));
/** What the build reads from its own files (the pose model's size), as a test page needs it. */
const FACTS = { poseBytes: 24_198_980 };
/** A valid config for each service (each needs a contact address). */
const CONFIGS: Record<SignupService, SignupConfig> = {
  buttondown: { service: 'buttondown', id: 'fitee', contact: 'list@fitee.example' },
  mailerlite: { service: 'mailerlite', id: '123456/987654', contact: 'list@fitee.example' },
  formspree: { service: 'formspree', id: 'xyzabcd', contact: 'list@fitee.example' },
};

describe('the page’s Content-Security-Policy follows the sign-up config', () => {
  it('allows only this site’s own files, and no form target or frame while the list is closed', () => {
    // SIGNUP stays null until a service is chosen (the user chose "decide later"); these tests hold either way.
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

  it('opens form-action (and frame-src when the answer shows in the frame) to the connected service’s origin only', () => {
    for (const service of Object.keys(PRESETS) as SignupService[]) {
      const target = signupTarget(CONFIGS[service])!;
      expect(new URL(target.action).origin).toBe(PRESETS[service].origin);
      const d = directives(landingCsp(target));
      expect(d['form-action']).toBe(PRESETS[service].origin);
      expect(d['frame-src']).toBe(target.mode === 'frame' ? PRESETS[service].origin : "'none'");
      expect(d['connect-src']).toBe("'self'");
      expect(d['script-src']).toBe("'self'");
      // A mode of the user's choosing changes the frame rule with it.
      const page = landingCsp(signupTarget({ ...CONFIGS[service], mode: 'page' }));
      expect(directives(page)['frame-src']).toBe("'none'");
      if (!PRESETS[service].framable) continue;
      const frame = landingCsp(signupTarget({ ...CONFIGS[service], mode: 'frame' }));
      expect(directives(frame)['frame-src']).toBe(PRESETS[service].origin);
    }
    // Buttondown and Formspree post top-level (their own page says what happened, and can show a check);
    // MailerLite answers with JSON, which shows in the sandboxed frame under the form.
    expect(signupTarget(CONFIGS.buttondown)!.mode).toBe('page');
    expect(signupTarget(CONFIGS.formspree)!.mode).toBe('page');
    expect(signupTarget(CONFIGS.mailerlite)!.mode).toBe('frame');
    expect(signupTarget(CONFIGS.mailerlite)!.field).toBe('fields[email]');
  });

  it('posts into the frame only where the answer is a short message (a check the service’s page asks for can’t run there)', () => {
    expect(() => signupTarget({ ...CONFIGS.formspree, mode: 'frame' })).toThrow(/frame/);
    expect(() => signupTarget({ ...CONFIGS.buttondown, mode: 'frame' })).toThrow(/frame/);
    expect(Object.entries(PRESETS).filter(([, p]) => p.framable).map(([s]) => s)).toEqual(['mailerlite']);
  });

  it('needs an address to write to for every service: to leave the list, ask what it holds, or have an address deleted', () => {
    for (const service of Object.keys(PRESETS) as SignupService[]) {
      // An unsubscribe link only stops the emails (and Formspree sends none of its own).
      expect(() => signupTarget({ service, id: CONFIGS[service].id } as SignupConfig), service).toThrow(/contact/);
      expect(() => signupTarget({ ...CONFIGS[service], contact: '  ' }), service).toThrow(/contact/);
      expect(signupTarget(CONFIGS[service])!.leave, service).toMatch(/To leave (the list )?at any time, to ask what (it|the list) holds about you, or to have your address deleted, write to list@fitee\.example\.$/);
    }
    expect(signupTarget(CONFIGS.buttondown)!.leave).toBe(
      'Every email from the list has a link to unsubscribe. To leave at any time, to ask what the list holds about you, or to have your address deleted, write to list@fitee.example.',
    );
    // An address, nothing else (the page shows it as text).
    for (const contact of ['not an address', 'https://example.com', 'a@b', '<x>@y.example']) {
      expect(() => signupTarget({ ...CONFIGS.buttondown, contact }), contact).toThrow(/contact/);
    }
  });

  it('never allows inline code, eval, data: URLs or any site', () => {
    for (const target of [null, ...Object.values(CONFIGS).map((c) => signupTarget(c))]) {
      const csp = landingCsp(target);
      expect(csp).not.toMatch(/unsafe-|data:|blob:|\*|http:/);
    }
  });

  it('refuses a config the build can’t use, and a test service anywhere but localhost', () => {
    const contact = 'list@fitee.example';
    expect(() => signupTarget({ service: 'buttondown', id: 'bad id/../x', contact })).toThrow(/valid Buttondown id/);
    expect(() => signupTarget({ service: 'mailerlite', id: 'not-a-form', contact })).toThrow(/valid MailerLite id/);
    expect(() => signupTarget({ service: 'nope' as SignupService, id: 'x', contact })).toThrow(/unknown service/);
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
    const html = renderPage(TEMPLATE, null, FACTS);
    expect(html).not.toMatch(/<form|<input|<iframe/);
    expect(html).toMatch(/Sign-ups<\/span> open soon/);
    expect(html).toContain('No email is collected yet');
    expect(html).toContain('makes no requests to other sites');
    // It promises only what the connected note says: the service, the use, and how to leave.
    expect(html).toContain('this note will name the service that keeps the list, and say what your email is used for (only news about fitee) and how to leave the list');
    expect(html).toContain('class="soon-pill"');
    expect(html).not.toContain('data-join');
    expect(html).not.toMatch(/\{\{|<!--fitee:/);
  });

  it('names every full-analysis lift in its text, from the library, as the hero’s chips name them', () => {
    const list = fullList();
    expect(list).toBe('Back squat, bench press, deadlift, overhead press, barbell row, Romanian deadlift, push-up and reverse lunge');
    const full = EXERCISES.filter((e) => e.analysis === 'full');
    expect(list.split(/, | and /)).toHaveLength(full.length);
    for (const e of full) expect(list.toLowerCase()).toContain(LIFTS.find((l) => l.id === e.id)!.short.toLowerCase());
    const html = renderPage(TEMPLATE, null, FACTS);
    expect(html).toContain(`<dt><span class="big">${full.length}</span> lifts with full analysis</dt>`);
    expect(html).toContain(`<dd>${list}. The checks follow`);
    expect(html).toContain(`Full technique analysis on ${full.length} lifts:`);
    expect((html.match(/class="chip"/g) ?? []).length).toBe(full.length);
  });

  it('puts the form gate where the coach has it: on adding weight to a full-analysis lift, not on every rep of one', () => {
    const html = renderPage(TEMPLATE, null, FACTS);
    // A plain push-up or reverse lunge progresses by reps (src/log/coach.ts, formGated): no check gates that.
    expect(html).toContain('Once every set reaches the top of your rep range, it adds weight, or asks for more reps or a harder variation on a bodyweight move with none added. On a lift with full analysis, it adds weight only after your latest check on that lift was clean.');
    expect(html).not.toMatch(/lifts with full analysis, it also waits/);
    // Repeated faults: about 10% lighter on a loaded set, fewer reps on a plain one (suggest()'s technique branch).
    expect(html).toContain('The same fault in two of your last three checks? A lighter load, or fewer reps on a bodyweight move with none added, plus an exercise that helps.');
  });

  it('says the pose model’s size as the app does, from the files the build ships', () => {
    expect(renderPage(TEMPLATE, null, FACTS)).toContain(`its ${formatMB(FACTS.poseBytes)} pose model`);
    expect(formatMB(FACTS.poseBytes)).toBe('24\u00a0MB');
    expect(() => renderPage(TEMPLATE, null, { poseBytes: 0 })).toThrow(/fetch-assets/);
    // From public/mediapipe: the runtime most browsers use and the full model.
    expect(poseBytes()).toBeGreaterThan(10e6);
  });

  it('once connected: a plain form post to the service, its name in the privacy note and the footer', () => {
    const target = signupTarget(CONFIGS.buttondown)!;
    const html = renderPage(TEMPLATE, target, FACTS);
    expect(html).toContain(`<form class="signup" action="${target.action}" method="post" data-mode="page">`);
    expect(html).toMatch(/<label class="field-label" for="signup-email">Email<\/label>/);
    expect(html).toContain(`name="${target.field}"`);
    expect(html).toContain('<input type="hidden" name="embed" value="1" />');
    expect(html).toContain('aria-describedby="signup-status signup-fine"');
    expect(html).toContain('Sign-ups are handled by Buttondown.');
    expect(html).toContain('the form sends your email address to Buttondown');
    // What any form post gives the service, and that it may set its own cookies.
    expect(html).toContain('Buttondown also receives your IP address and browser details, and it may set its own cookies');
    expect(html).not.toContain('makes no requests to other sites');
    expect(html).toContain('you’ll see its own page when you join');
    expect(html).not.toContain('its answer shows here');
    expect(html).toContain('Nothing else on this page sends anything to another site.');
    expect(html).not.toContain('The answer that shows under the form');
    // Posted top-level: no frame, and nothing on the page that says what happened.
    expect(html).not.toContain('class="answer"');
    expect(html).not.toMatch(/Check your inbox|you(’|')re on the list|subscribed|success/i);
  });

  it('with the answer in the frame: the service’s own answer under the form, never a done state of the page’s own', () => {
    const target = signupTarget(CONFIGS.mailerlite)!;
    const html = renderPage(TEMPLATE, target, FACTS);
    expect(html).toContain('data-mode="frame"');
    const answer = /<div class="answer" hidden data-title="([^"]*)" data-say="([^"]*)"><\/div>/.exec(html);
    expect(answer?.[1]).toBe('What came back from MailerLite');
    // Neutral words: the page can't read the answer, and an error page loads there too.
    // (A service that can't be reached leaves the frame blank: the browser's own error page needs script, which the frame doesn't run.)
    expect(answer?.[2]).toBe('Here’s what came back. If it says your sign-up went through, an email is on its way so you can confirm your address (look in your spam folder too). If it’s blank, the sign-up service couldn’t be reached: try again later.');
    expect(html).not.toMatch(/Check your inbox|class="thanks"|data-again|you(’|')re on the list|subscribed|success/i);
    expect(html).toContain('its answer shows here when you join');
    expect(html).not.toContain('you’ll see its own page');
    // The service's answer is its own page, which the page's CSP doesn't govern: the privacy note says so.
    expect(html).toContain('The answer that shows under the form is MailerLite’s own page, which may load files from other sites; apart from that, nothing on this page sends anything to another site.');
    expect(html).not.toContain('Nothing else on this page sends anything to another site.');
    // A service that sends no confirmation (the test stand-in can be one) says so.
    const quiet = renderPage(TEMPLATE, { ...target, confirms: false }, FACTS);
    expect(quiet).toContain('If it says your sign-up went through, we’ll email you when you can try fitee. If it’s blank,');
    expect(quiet).not.toContain('confirm your address');
  });

  it('names the contact address in the privacy note and the fine print', () => {
    const html = renderPage(TEMPLATE, signupTarget(CONFIGS.formspree), FACTS);
    const leave = 'To leave the list at any time, to ask what it holds about you, or to have your address deleted, write to list@fitee.example.';
    expect(html.split(leave).length - 1).toBe(2);
    expect(html).toContain('data-mode="page"');
    expect(html).not.toContain('its answer shows here');
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

  it('keeps the panel dark where color-mix() isn’t understood, with the app’s own panel text on it', () => {
    const css = read('src/landing/landing.css');
    const panel = /\n\.panel \{([\s\S]*?)\n\}/.exec(css)![1];
    // A var() in a declaration a browser can't parse voids the whole declaration: the panel's colour stands on its own,
    // so only the glow (background-image, with color-mix) can fail.
    expect(panel).toMatch(/\bbackground-color: var\(--panel-bg\);/);
    expect(panel).toMatch(/\bbackground-image: radial-gradient\([^;]*color-mix\(/);
    expect(panel).not.toMatch(/\bbackground:/);
    // Text as on the app's "Log a workout" panel (its panel text tokens, from the page's theme), after the Molten set.
    expect(panel.indexOf('--text: var(--panel-ink)')).toBeGreaterThan(panel.indexOf('/* fitee:molten-tokens */'));
    expect(css).toMatch(/\.list \.wrap \{[^}]*--panel-ink: var\(--panel-text\);[^}]*--panel-ink-muted: var\(--panel-muted\);/);
  });
});

describe('the page’s build', () => {
  it('never builds into the repo itself (replacing about/ there would delete the template)', () => {
    expect(() => landingFolder(ROOT)).toThrow(/repo/);
    expect(() => landingFolder(join(ROOT, '.'))).toThrow(/repo/);
    expect(landingFolder(join(ROOT, 'dist'))).toBe(join(ROOT, 'dist', 'about'));
    expect(landingFolder('/tmp/x')).toBe(join('/tmp/x', 'about'));
  });

  it('refuses code from outside this repo (the page shares the app’s origin)', () => {
    const src = (f: string) => join(ROOT, 'src', f);
    expect(notOwnCode({ modules: [join(ROOT, 'about', 'index.html'), src('landing/main.ts'), src('landing/landing.css')], sources: ['public/favicon.svg', 'node_modules/@fontsource-variable/bricolage-grotesque/files/x.woff2', 'src/landing/screens/a.webp'] })).toEqual([]);
    expect(notOwnCode({ modules: [join(ROOT, 'node_modules', 'left-pad', 'index.js'), '\0virtual:thing', src('landing/main.ts'), src('vendor/node_modules/x/index.js')], sources: ['node_modules/some-icons/a.svg', 'scripts/x.png'] })).toEqual([
      'node_modules/left-pad/index.js',
      '\0virtual:thing',
      join('src', 'vendor', 'node_modules', 'x', 'index.js'),
      'node_modules/some-icons/a.svg',
      'scripts/x.png',
    ]);
    // A package is a node_modules folder inside the repo: the folders the repo is checked out in may be called anything.
    const elsewhere = join('/home', 'me', 'node_modules_projects', 'fitee');
    expect(notOwnCode({ modules: [join(elsewhere, 'about', 'index.html'), join(elsewhere, 'src', 'landing', 'main.ts')], sources: [join(elsewhere, 'src', 'landing', 'screens', 'a.webp'), join(elsewhere, 'public', 'favicon.svg')] }, elsewhere)).toEqual([]);
    expect(notOwnCode({ modules: [join(elsewhere, 'node_modules', 'left-pad', 'index.js')], sources: [] }, elsewhere)).toEqual([join('node_modules', 'left-pad', 'index.js')]);
    // Styles: only the app's font and its own tokens are imported (postcss inlines them, so they aren't modules).
    const imports = [...read('src/landing/landing.css').matchAll(/@import\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports).toEqual(['@fontsource-variable/bricolage-grotesque/opsz.css', '../tokens.css']);
  });
});

describe('the built page', () => {
  let out = '';
  let html = '';
  let built: Awaited<ReturnType<typeof buildLanding>>;
  beforeAll(async () => {
    out = tmp('fitee-landing-build-');
    built = await buildLanding(out);
    html = readFileSync(join(out, 'about', 'index.html'), 'utf8');
  }, 60_000);

  it('is made of this repo’s own code: every module of its script from src/', () => {
    const js = built.modules.filter((m) => /\.[cm]?[jt]sx?$/.test(m));
    expect(js.length).toBeGreaterThan(10);
    for (const m of js) expect(relative(join(ROOT, 'src'), m), m).not.toMatch(/^\.\.|node_modules/);
    expect(notOwnCode(built)).toEqual([]);
    expect(built.files.every((f) => f.startsWith('about/'))).toBe(true);
  });

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
    // Once a service is connected its endpoint is the form's action: the only other site the page names.
    const connected = signupTarget(SIGNUP);
    for (const f of files.filter((f) => /\.(html|js|css)$/.test(f))) {
      const others = urls(readFileSync(f, 'utf8')).filter((u) => !(connected && (u === connected.origin || u.startsWith(connected.origin + '/'))));
      expect(others, relative(out, f)).toEqual([]);
    }
    // Every file the page loads is in about/ (nothing of the app's, nothing inlined as data:), pictures' srcset too.
    const loads = [
      ...[...html.matchAll(/\s(?:src|href)="([^"#]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((c) => c.trim().split(/\s+/)[0])),
    ];
    expect(loads.filter((u) => /\.webp$/.test(u)).length).toBeGreaterThan(40);
    for (const u of loads) {
      expect(u).not.toMatch(/^(data:|https?:|\/\/)/);
      expect(new URL(u, 'https://example.org/Claude/about/').pathname.startsWith('/Claude/about/'), u).toBe(true);
    }
    expect(files.every((f) => relative(out, f).startsWith('about'))).toBe(true);
  });

  it('reads none of the app’s data: its script names no storage of any kind (the app’s is on the same origin)', () => {
    const scripts = walk(join(out, 'about')).filter((f) => f.endsWith('.js'));
    expect(scripts.length).toBeGreaterThan(0);
    // Browser names, which minifying keeps as they are.
    const storage = /localStorage|sessionStorage|indexedDB|\bcaches\b|cookieStore|\.cookie\b|serviceWorker|navigator\.storage|StorageManager/;
    for (const f of scripts) expect(storage.exec(readFileSync(f, 'utf8'))?.[0], relative(out, f)).toBeUndefined();
  });

  it('carries the hero’s data and its first frame, and the list as the config says (closed while SIGNUP is null)', () => {
    const data = JSON.parse(/<script type="application\/json" id="hero-data">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(data.lifts.map((l: { id: string }) => l.id)).toEqual(LIFTS.map((l) => l.id));
    expect(html).toContain(stageMarkup(heroData()).figure);
    expect(html).toContain(`data-state="${SIGNUP ? 'open' : 'closed'}"`);
    expect(/<form/.test(html)).toBe(SIGNUP !== null);
    expect(html).toContain(`its ${formatMB(poseBytes())} pose model`);
  });
});
