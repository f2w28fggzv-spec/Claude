#!/usr/bin/env node
// End-to-end check of the landing page (about/, served at /Claude/about/),
// with the real production build in Chromium (Playwright). A dev tool, not
// part of `npm test` (which stays browser-free).
//
//   npm run landing:check -- --work DIR --port 4402
//
// It builds the app and the page as `npm run build` does (without the
// typecheck) into DIR/build, and the page again with a stand-in sign-up
// service connected (FITEE_LANDING_TEST_SIGNUP, a test-only override that
// accepts localhost only) into DIR/connected. It serves a build under
// http://localhost:<port>/Claude/ like GitHub Pages (server.cjs: a folder's
// index.html, a folder without its slash redirected) and runs the stand-in
// service on <port + 1>. Then it checks:
//   1. the build: the page's CSP, its JavaScript and first-load weight, the
//      app's precache list (sw.js) leaving about/ out, and sw.js unchanged
//      when only the page changes;
//   2. at 390 and 1280 px, light and dark, without and then with the app's
//      service worker installed (the app opened first in the same context):
//      the page loads, its hero runs (the app's demo renderer), the list is
//      in its closed state (no form, nothing to type into), nothing scrolls
//      sideways, no request leaves localhost, no console errors, no cookies
//      or storage; with the worker the page is controlled, still loads every
//      file, and none of them lands in the app's offline copy; every kind of
//      text passes WCAG AA against the pixels behind it; full-page
//      screenshots at device scale 2;
//   3. at 320 px nothing scrolls sideways; keyboard focus is visible on
//      everything Tab reaches; the hero keeps one height for every lift and
//      the layout doesn't shift while it tours the lifts (CLS); the Female
//      / Male radio group moves its tab stop; reduced motion shows two stills
//      and nothing plays; without JavaScript the first frame and the closed
//      list are there;
//   4. with the stand-in service connected (with and without the app's
//      worker): the hero's Join button goes to the email field; an empty or
//      malformed address gets an inline error (aria-invalid, announced) and
//      sends nothing; offline, it says so and sends nothing; a good address
//      is posted as a plain form navigation into the hidden frame (never
//      fetch) and the page says what happens next, without claiming the
//      address arrived; Try again brings the form back; a service that never
//      answers gets a timeout message.
// It prints PASS/FAIL lines, writes report.json and screenshots to DIR, and
// exits 1 if any check fails.
//
// Needs Playwright with Chromium (a dev tool, not a dependency of the app).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createServer } = require('../offline-check/server.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const PORT = Number(opt('port', 4402));
const SERVICE_PORT = PORT + 1;
const WORK = path.resolve(opt('work', '') || fs.mkdtempSync(path.join(os.tmpdir(), 'fitee-landing-check-')));
const BUILD = path.join(WORK, 'build');
const CONNECTED = path.join(WORK, 'connected');
const SHOTS = path.join(WORK, 'shots');
const ORIGIN = `http://localhost:${PORT}`;
const APP = `${ORIGIN}/Claude/`;
const PAGE = `${ORIGIN}/Claude/about/`;
const SERVICE = `http://localhost:${SERVICE_PORT}`;
/** How long the page waits for the service's answer (src/landing/list.ts). */
const ANSWER_TIMEOUT_MS = 20_000;
const JS_BUDGET_GZIP = 120 * 1024;
const FIRST_LOAD_BUDGET = 700 * 1024;

const results = [];
const report = { work: WORK, checks: results, weight: {}, cls: {}, notes: [] };
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const walk = (dir) =>
  fs.readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return fs.statSync(full).isDirectory() ? walk(full) : [full];
  });

function build() {
  console.log(`Building into ${WORK} …`);
  execFileSync('npx', ['vite', 'build', '--outDir', BUILD, '--emptyOutDir', '--logLevel', 'warn'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  fs.rmSync(CONNECTED, { recursive: true, force: true });
  fs.cpSync(BUILD, CONNECTED, { recursive: true });
  execFileSync(process.execPath, ['scripts/landing-build.ts', CONNECTED], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, FITEE_LANDING_TEST_SIGNUP: JSON.stringify({ action: `${SERVICE}/subscribe` }) },
  });
}

/** The stand-in sign-up service: logs what reaches it; answers with a page, or (hang) never. */
function startService() {
  const log = [];
  let hang = false;
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      log.push({ method: req.method, path: req.url, body, dest: req.headers['sec-fetch-dest'], mode: req.headers['sec-fetch-mode'], type: req.headers['content-type'], origin: req.headers.origin });
      if (hang) return; // never answers
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>stand-in</title><p>The stand-in service got the form.</p>');
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  return {
    log,
    setHang: (v) => (hang = v),
    listen: () => new Promise((resolve, reject) => server.once('error', reject).listen(SERVICE_PORT, '127.0.0.1', resolve)),
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

// In-page helpers.
const scrollThrough = (page) =>
  page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 350) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 90));
    }
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))));
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Text that must pass WCAG AA: its colour against the pixels behind it (with the text, borders, icons and dots hidden). */
const CONTRAST_SELECTORS = ['.eyebrow', '.lead', '.soon-pill', '.phase b', '.body-pick button', '.key', '.lg-name', '.lg-role', '.lg-what', '.lifts-label', '.chip', '.stage figcaption', '.hero-facts li', '.kicker', '.pillar-text', '.rule-n', '.step-n', '.step p', '.step .sample', '.v-pass', '.v-fail', '.v-unknown', '.depth dd', '.section-lead', '.device figcaption', '.no-signal', '.facts p', '.vision-body p', '.soon-tag', '.panel-lede', '.privacy p', '.site-foot .small', '.head-link', '.field-label', '.fine', '.button'];
const HIDE_PROPS = ['color', 'border-color', 'outline-color'];
/** Set with the hiding, so no transition is caught half way. */
const STILL_PROPS = ['transition'];
const luminance = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrastOf = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** Every sampled text's lowest contrast against what's behind it. `decoder` is a blank page (the landing page's CSP allows no data: images). */
async function contrast(page, decoder) {
  const out = [];
  // Hold the hero still (a paused demo keeps one Lowering / Lifting pill lit and one lift picked), so nothing changes between reading a colour and taking the picture.
  const paused = await page.evaluate(() => {
    const pause = document.querySelector('.demo-pause');
    if (!pause || pause.getAttribute('aria-pressed') !== 'false' || getComputedStyle(pause).display === 'none') return false;
    pause.click();
    return true;
  });
  await sleep(400);
  for (const sel of CONTRAST_SELECTORS) {
    for (const el of (await page.$$(sel)).slice(0, 3)) {
      const info = await el.evaluate((e) => {
        const s = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return { color: s.color, shown: s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !e.closest('.is-off, [hidden]'), size: parseFloat(s.fontSize), weight: Number(s.fontWeight) };
      });
      const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)/.exec(info.color);
      if (!info.shown || !m) continue;
      await el.scrollIntoViewIfNeeded();
      await el.evaluate(
        (e, [hide, still]) => {
          for (const k of [e, ...e.querySelectorAll('*')]) {
            for (const p of still) k.style.setProperty(p, 'none', 'important');
            for (const p of hide) k.style.setProperty(p, 'transparent', 'important');
          }
          for (const k of e.querySelectorAll('svg, i, img, .dot, .v-icon')) k.style.setProperty('visibility', 'hidden', 'important');
        },
        [HIDE_PROPS, STILL_PROPS],
      );
      const png = await el.screenshot({ animations: 'disabled' });
      await el.evaluate((e, props) => {
        for (const k of [e, ...e.querySelectorAll('*')]) for (const p of props) k.style.setProperty(p, '');
      }, [...HIDE_PROPS, ...STILL_PROPS, 'visibility']);
      const pixels = await decoder.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        // Inside the element's rounded ends (a pill's corners show what's behind it).
        const ix = Math.min(Math.round(c.height / 2) + 2, Math.floor(c.width / 3));
        const iy = Math.min(2, Math.floor(c.height / 3));
        const d = x.getImageData(ix, iy, Math.max(1, c.width - 2 * ix), Math.max(1, c.height - 2 * iy)).data;
        const px = [];
        for (let i = 0; i < d.length; i += 4 * 7) px.push([d[i], d[i + 1], d[i + 2]]);
        return px;
      }, png.toString('base64'));
      const fg = [Number(m[1]), Number(m[2]), Number(m[3])];
      const ratio = Math.min(...pixels.map((p) => contrastOf(fg, p)));
      const large = info.size >= 24 || (info.size >= 18.66 && info.weight >= 700);
      out.push({ sel, ratio: Math.round(ratio * 100) / 100, need: large ? 3 : 4.5 });
    }
  }
  // And play again, as the visitor left it.
  if (paused) await page.click('.demo-pause');
  return out;
}
const listState = (page) =>
  page.evaluate(() => {
    const panel = document.querySelector('#list .panel');
    return { state: panel?.dataset.state, form: !!document.querySelector('form'), inputs: document.querySelectorAll('input, textarea, select').length, iframes: document.querySelectorAll('iframe').length, soon: !!document.querySelector('.soon-tag'), pill: !!document.querySelector('.soon-pill'), join: !!document.querySelector('[data-join]') };
  });
const heroState = (page) =>
  page.evaluate(() => {
    const stage = document.querySelector('.stage');
    const svg = document.querySelector('.stage-figure svg');
    return { live: stage.classList.contains('is-live'), still: stage.classList.contains('is-still'), markup: svg ? svg.innerHTML : '', svgs: document.querySelectorAll('.stage-figure svg').length, showing: stage.dataset.showing, height: stage.getBoundingClientRect().height };
  });

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('landing:check needs Playwright (npm i -D playwright, or NODE_PATH to a global install).');
    process.exit(1);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  build();

  // ── 1. The build ──
  const html = fs.readFileSync(path.join(BUILD, 'about', 'index.html'), 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1].replace(/&#39;/g, "'") ?? '';
  // The repo's own config: closed until a service is set in src/landing/signup.ts (then the page's form posts to it).
  const repoOpen = /data-state="open"/.test(html);
  if (repoOpen) report.notes.push('src/landing/signup.ts connects a sign-up service: the main build is checked open');
  const ownOnly = /default-src 'none'/.test(csp) && /script-src 'self'/.test(csp) && /connect-src 'self'/.test(csp) && !/unsafe/.test(csp);
  if (repoOpen) check("the page has its CSP: only its own files, and the connected service's origin as the one form target", ownOnly && /form-action https:\/\/[^ ;]+;/.test(csp), csp);
  else check('the page has its CSP: only its own files, no form target or frame while the list is closed', ownOnly && /form-action 'none'/.test(csp) && /frame-src 'none'/.test(csp), csp);
  const connectedHtml = fs.readFileSync(path.join(CONNECTED, 'about', 'index.html'), 'utf8');
  const cspOpen = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(connectedHtml)?.[1].replace(/&#39;/g, "'") ?? '';
  check('connected, the CSP allows that one service as form target and frame', cspOpen.includes(`form-action ${SERVICE}`) && cspOpen.includes(`frame-src ${SERVICE}`), cspOpen);
  const pageFiles = walk(path.join(BUILD, 'about'));
  const js = pageFiles.filter((f) => f.endsWith('.js'));
  const jsGzip = js.reduce((n, f) => n + zlib.gzipSync(fs.readFileSync(f)).length, 0);
  report.weight.jsGzip = jsGzip;
  check(`the page's JavaScript is at most ${kb(JS_BUDGET_GZIP)} gzipped`, jsGzip <= JS_BUDGET_GZIP, kb(jsGzip));
  const sw = fs.readFileSync(path.join(BUILD, 'sw.js'), 'utf8');
  check("the app's precache list (sw.js) leaves about/ out", !/"url":"about\//.test(sw) && pageFiles.length > 0, `${pageFiles.length} files in about/`);
  execFileSync(process.execPath, ['scripts/offline-build.ts', CONNECTED], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  check('a different page (the connected build) gives the same sw.js', fs.readFileSync(path.join(CONNECTED, 'sw.js'), 'utf8') === sw);
  const appSame = walk(BUILD)
    .filter((f) => !path.relative(BUILD, f).startsWith('about'))
    .every((f) => fs.readFileSync(f).equals(fs.readFileSync(path.join(CONNECTED, path.relative(BUILD, f)))));
  check("and the same app files: the app doesn't depend on the page", appSame);

  const server = createServer({ port: PORT });
  server.setRoot(BUILD);
  await server.listen();
  const service = startService();
  await service.listen();
  const browser = await chromium.launch();
  const offsite = [];
  const consoleErrors = [];
  const track = (context, label) => {
    context.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname !== 'localhost' && !['data:', 'blob:', 'about:'].includes(u.protocol)) offsite.push(`${label}: ${r.url()}`);
    });
    context.on('page', (p) => watch(p, label));
  };
  const watch = (p, label) => {
    p.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`${label}: ${m.text()}`);
    });
    p.on('pageerror', (e) => consoleErrors.push(`${label}: ${e.message}`));
  };
  // Service workers stay allowed everywhere (Playwright's "block" touches navigator.serviceWorker in every frame,
  // which throws in the sandboxed sign-up frame): "without the app's worker" is a fresh context where the app
  // was never opened, and the page itself never registers one.
  const contextFor = async (label, { width = 390, theme = 'light', dpr = 2, sw = false, ...rest } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 800 }, deviceScaleFactor: dpr, colorScheme: theme, ...rest });
    track(ctx, label);
    return ctx;
  };
  /** Opens the app first and waits for its service worker to control it (it then controls /Claude/about/ too). */
  const installApp = async (ctx) => {
    const p = await ctx.newPage();
    await p.goto(APP);
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload();
    await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
    await p.close();
  };

  try {
    // ── 2. The page in each width and theme, without and with the app's worker ──
    for (const sw of [false, true]) {
      for (const width of [390, 1280]) {
        for (const theme of ['light', 'dark']) {
          const label = `${width} ${theme}${sw ? ' with the app' : ''}`;
          const ctx = await contextFor(label, { width, theme, sw });
          if (sw) await installApp(ctx);
          const page = await ctx.newPage();
          const bytes = { initial: 0, total: 0 };
          let phase = 'initial';
          page.on('response', async (r) => {
            try {
              const n = Number((await r.allHeaders())['content-length'] ?? 0) || (await r.body()).length;
              bytes.total += n;
              if (phase === 'initial') bytes.initial += n;
            } catch {
              // a response without a body (e.g. a redirect)
            }
          });
          await page.goto(PAGE, { waitUntil: 'load' });
          await sleep(1500);
          phase = 'scroll';
          const h0 = await heroState(page);
          await sleep(1200);
          const h1 = await heroState(page);
          const title = await page.title();
          check(`${label}: the page loads, and its hero runs the app's demo`, /fitee/.test(title) && h0.live && h1.markup !== h0.markup && h0.markup.length > 1000, title);
          const list = await listState(page);
          if (repoOpen) check(`${label}: the interest list is open (a service is connected): its form, and the Join button`, list.state === 'open' && list.form && list.join && !list.pill);
          else check(`${label}: the interest list is closed: no form, nothing to type into`, list.state === 'closed' && !list.form && list.inputs === 0 && list.iframes === 0 && list.soon && list.pill && !list.join);
          await scrollThrough(page);
          check(`${label}: nothing scrolls sideways`, await noSideScroll(page));
          if (sw) {
            const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
            const cached = await page.evaluate(async () => {
              const out = [];
              for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname);
              return out;
            });
            check(`${label}: the app's worker controls the page, which still loads, and keeps none of its files`, controlled && cached.length > 0 && !cached.some((p) => p.includes('/about/')), `${cached.length} files in the app's caches`);
          } else {
            const stored = await page.evaluate(async () => ({
              storage: localStorage.length + sessionStorage.length,
              worker: !!navigator.serviceWorker.controller || (await navigator.serviceWorker.getRegistrations()).length > 0,
              caches: (await caches.keys()).length,
            }));
            const cookies = await ctx.cookies();
            check(`${label}: no cookies, nothing stored, no service worker of its own`, stored.storage === 0 && !stored.worker && stored.caches === 0 && cookies.length === 0, JSON.stringify(stored));
          }
          if (!sw) {
            const decoder = await ctx.newPage();
            const samples = await contrast(page, decoder);
            await decoder.close();
            await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
            const worst = samples.reduce((a, b) => (b.ratio / b.need < a.ratio / a.need ? b : a), samples[0]);
            const low = samples.filter((x) => x.ratio < x.need);
            report.contrast = { ...(report.contrast ?? {}), [label]: { lowest: worst, samples: samples.length } };
            check(
              `${label}: text passes WCAG AA against the pixels behind it`,
              samples.length > 60 && low.length === 0,
              low.length ? low.map((x) => `${x.sel} ${x.ratio}:1`).join(', ') : `${samples.length} samples, lowest ${worst.ratio}:1 (${worst.sel})`,
            );
          }
          if (!sw) {
            // The picture: the back squat started again and caught near the bottom of its first rep, muscles warm.
            await page.click('.chip[data-lift="back-squat"]');
            await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
            await sleep(2500);
            await page.screenshot({ path: path.join(SHOTS, `landing-${width}-${theme}.png`), fullPage: true });
            report.weight[label] = bytes;
            if (width === 1280 && theme === 'light') check(`${label}: everything the page loads, scrolled to the end, is at most ${kb(FIRST_LOAD_BUDGET)}`, bytes.total <= FIRST_LOAD_BUDGET, `first screen ${kb(bytes.initial)}, all ${kb(bytes.total)}`);
          } else await page.screenshot({ path: path.join(SHOTS, `landing-${width}-${theme}-with-app.png`) });
          await ctx.close();
        }
      }
    }

    // A phone with a sharp screen loads the larger pictures: still within the budget.
    {
      const ctx = await contextFor('390 dpr 3', { width: 390, dpr: 3 });
      const page = await ctx.newPage();
      const bytes = { initial: 0, total: 0 };
      let phase = 'initial';
      page.on('response', async (r) => {
        try {
          const n = (await r.body()).length;
          bytes.total += n;
          if (phase === 'initial') bytes.initial += n;
        } catch {
          // no body
        }
      });
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(1000);
      phase = 'scroll';
      await scrollThrough(page);
      const sharp = await page.evaluate(() => [...document.images].filter((i) => /-(780|716)-/.test(i.currentSrc)).length);
      report.weight['390 dpr 3'] = bytes;
      check(`390 px at device scale 3: sharp pictures (780 px), everything at most ${kb(FIRST_LOAD_BUDGET)}`, sharp > 0 && bytes.total <= FIRST_LOAD_BUDGET, `${sharp} sharp pictures, first screen ${kb(bytes.initial)}, all ${kb(bytes.total)}`);
      await ctx.close();
    }

    // ── 3. Narrow screens, keyboard, the hero's height and layout shift, reduced motion, no script ──
    {
      const ctx = await contextFor('320', { width: 320, dpr: 2 });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await scrollThrough(page);
      check('320 px: nothing scrolls sideways', await noSideScroll(page));
      await page.screenshot({ path: path.join(SHOTS, 'landing-320-light-top.png') });
      await ctx.close();
    }
    {
      const ctx = await contextFor('keyboard', { width: 390, dpr: 2 });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(600);
      const seen = [];
      let invisible = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        const f = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const label = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
          return { label, outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2, onScreen: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' };
        });
        if (!f) break;
        seen.push(f.label);
        if (!f.outline || !f.onScreen) invisible.push(f.label);
        if (i === 0) await page.screenshot({ path: path.join(SHOTS, 'focus-skip-link.png') });
      }
      check('keyboard: every stop Tab reaches shows a visible focus ring', seen.length >= 12 && invisible.length === 0, `${seen.length} stops${invisible.length ? `; no ring on: ${invisible.join(', ')}` : ''}`);
      // The Female / Male radio group: arrow keys choose, and the chosen one is the tab stop.
      await page.focus('[data-body-pick="female"]');
      await page.keyboard.press('ArrowRight');
      const radios = await page.evaluate(() => [...document.querySelectorAll('[data-body-pick]')].map((r) => [r.dataset.bodyPick, r.getAttribute('aria-checked'), r.tabIndex]));
      const focused = await page.evaluate(() => document.activeElement?.dataset.bodyPick);
      check('the figure radio group: the arrow key picks Male, which becomes the tab stop', JSON.stringify(radios) === JSON.stringify([['female', 'false', -1], ['male', 'true', 0]]) && focused === 'male', JSON.stringify(radios));
      await page.locator('.chip').first().focus();
      await page.screenshot({ path: path.join(SHOTS, 'focus-chip.png') });
      await ctx.close();
    }
    for (const width of [320, 390, 1280]) {
      const ctx = await contextFor(`hero ${width}`, { width, dpr: 1 });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(500);
      const heights = [];
      for (const chip of await page.locator('.chip').all()) {
        await chip.click();
        await sleep(350);
        heights.push(Math.round((await heroState(page)).height * 10) / 10);
      }
      check(`${width} px: the hero keeps one height for all six lifts`, heights.length === 6 && new Set(heights).size === 1, heights.join(', '));
      await ctx.close();
    }
    {
      // The judges' case: a phone with the hero part way in view while it tours the lifts by itself.
      const ctx = await contextFor('cls', { width: 390, dpr: 1 });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await page.evaluate(() => {
        window.__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
        const stage = document.querySelector('.stage');
        window.scrollTo({ top: stage.getBoundingClientRect().top + window.scrollY - innerHeight / 2, behavior: 'instant' });
      });
      const before = await heroState(page);
      await sleep(26_000);
      const after = await heroState(page);
      const cls = await page.evaluate(() => window.__cls);
      report.cls['390 touring'] = cls;
      check('390 px, the hero half in view for 26 s while it tours the lifts: no layout shift', before.showing !== after.showing && cls < 0.01, `CLS ${cls.toFixed(4)}, ${before.showing} → ${after.showing}`);
      await ctx.close();
    }
    {
      const ctx = await contextFor('reduced motion', { width: 390, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(400);
      const a = await heroState(page);
      await sleep(1500);
      const b = await heroState(page);
      const pause = await page.evaluate(() => getComputedStyle(document.querySelector('.demo-pause')).display);
      check('reduced motion: the start and the turnaround side by side, nothing plays', a.still && a.svgs === 2 && a.markup === b.markup && pause === 'none');
      await page.locator('.stage').screenshot({ path: path.join(SHOTS, 'hero-reduced-motion.png') });
      await ctx.close();
    }
    {
      const ctx = await contextFor('no script', { width: 390, javaScriptEnabled: false });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(1200); // the headline and the demo settle in (a CSS entrance, no script needed)
      const s = await page.evaluate(() => ({
        figure: (document.querySelector('.stage-figure svg')?.innerHTML.length ?? 0) > 1000,
        controls: getComputedStyle(document.querySelector('.stage .lifts')).visibility,
        closed: document.querySelector('#list .panel')?.dataset.state,
      }));
      check('without JavaScript: the first frame is there, the controls are hidden, the list is closed', s.figure && s.controls === 'hidden' && s.closed === 'closed', JSON.stringify(s));
      await page.screenshot({ path: path.join(SHOTS, 'hero-no-script.png') });
      await ctx.close();
    }

    // ── 4. With a stand-in service connected ──
    server.setRoot(CONNECTED);
    for (const sw of [false, true]) {
      const label = `connected${sw ? ' with the app' : ''}`;
      const ctx = await contextFor(label, { width: 390, sw });
      if (sw) await installApp(ctx);
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(500);
      const posts = () => service.log.filter((e) => e.method === 'POST').length;
      if (!sw) {
        const s = await listState(page);
        check(`${label}: the hero's hot button reads Join, the list has its form and a visible Email label`, s.state === 'open' && s.form && s.join && !s.pill && (await page.locator('label[for="signup-email"]').isVisible()));
        await page.click('[data-join]');
        await sleep(900);
        check(`${label}: Join goes to the email field`, await page.evaluate(() => document.activeElement?.id === 'signup-email'));
        await page.locator('.panel').screenshot({ path: path.join(SHOTS, 'list-connected-open.png') });
        // An empty address, then a malformed one: an inline error in words, announced, the field marked, nothing sent.
        const n0 = posts();
        await page.click('form.signup button[type=submit]');
        await sleep(300);
        const empty = await page.evaluate(() => ({ text: document.querySelector('.signup-status').textContent, invalid: document.querySelector('#signup-email').getAttribute('aria-invalid'), focus: document.activeElement?.id, role: document.querySelector('.signup-status').getAttribute('role'), described: document.querySelector('#signup-email').getAttribute('aria-describedby') }));
        await page.fill('#signup-email', 'not an address');
        await page.press('#signup-email', 'Enter');
        await sleep(300);
        const bad = await page.evaluate(() => ({ text: document.querySelector('.signup-status').textContent, invalid: document.querySelector('#signup-email').getAttribute('aria-invalid') }));
        check(
          `${label}: an empty or malformed address gets an inline error (aria-invalid, announced, focus on the field) and sends nothing`,
          /Enter your email/.test(empty.text) && empty.invalid === 'true' && empty.focus === 'signup-email' && empty.role === 'status' && /signup-status/.test(empty.described) && /doesn’t look like an email/.test(bad.text) && bad.invalid === 'true' && posts() === n0,
          `${empty.text} / ${bad.text}`,
        );
        await page.locator('.panel').screenshot({ path: path.join(SHOTS, 'list-connected-error.png') });
        await page.fill('#signup-email', 'someone@example.com');
        await sleep(100);
        check(`${label}: typing clears the error`, await page.evaluate(() => !document.querySelector('#signup-email').hasAttribute('aria-invalid') && !document.querySelector('.signup-status').textContent));
        // Offline: told so, nothing sent.
        await ctx.setOffline(true);
        await page.click('form.signup button[type=submit]');
        await sleep(400);
        const off = await page.evaluate(() => document.querySelector('.signup-status').textContent);
        await ctx.setOffline(false);
        check(`${label}: offline, it says so and sends nothing`, /offline/i.test(off) && posts() === n0, off);
      } else {
        check(`${label}: the app's worker controls the page`, await page.evaluate(() => !!navigator.serviceWorker.controller));
        await page.fill('#signup-email', 'someone@example.com');
      }
      // A good address: a plain form post into the hidden frame, and a hedged message.
      const n1 = posts();
      await page.click('form.signup button[type=submit]');
      await page.waitForFunction(() => !document.querySelector('.thanks').hidden, null, { timeout: 15000 }).catch(() => undefined);
      const post = service.log.filter((e) => e.method === 'POST').at(-1);
      const done = await page.evaluate(() => ({ shown: !document.querySelector('.thanks').hidden, formHidden: document.querySelector('form.signup').hidden, focus: document.activeElement?.classList.contains('thanks'), text: document.querySelector('.thanks').innerText, frame: document.querySelector('iframe')?.getAttribute('sandbox'), url: location.href }));
      check(
        `${label}: a good address is posted to the service as a form navigation into the hidden frame (not fetch)`,
        posts() === n1 + 1 && post.path === '/subscribe' && post.type === 'application/x-www-form-urlencoded' && /email=someone%40example\.com/.test(post.body) && post.dest === 'iframe' && post.mode === 'navigate' && done.frame === '' && done.url.startsWith(PAGE),
        post ? `${post.method} ${post.path} dest=${post.dest} mode=${post.mode} body=${post.body}` : 'no post',
      );
      check(`${label}: the page says what happens next, without claiming the address arrived`, done.shown && done.formHidden && done.focus && /If your sign-up went through/.test(done.text) && !/you(’|')re (now )?on the list|subscribed|success/i.test(done.text), done.text.replace(/\s+/g, ' ').slice(0, 90));
      if (!sw) {
        await page.locator('.panel').screenshot({ path: path.join(SHOTS, 'list-connected-sent.png') });
        await page.click('[data-again]');
        await sleep(200);
        check(`${label}: Try again brings the form back, with the field focused`, await page.evaluate(() => !document.querySelector('form.signup').hidden && document.querySelector('.thanks').hidden && document.activeElement?.id === 'signup-email'));
        // A service that never answers.
        service.setHang(true);
        const t0 = Date.now();
        await page.click('form.signup button[type=submit]');
        await sleep(500);
        const sending = await page.evaluate(() => [document.querySelector('.signup-status').textContent, document.querySelector('form.signup button[type=submit]').disabled]);
        await page.waitForFunction(() => /didn’t answer/.test(document.querySelector('.signup-status').textContent), null, { timeout: ANSWER_TIMEOUT_MS + 10000 }).catch(() => undefined);
        const late = await page.evaluate(() => [document.querySelector('.signup-status').textContent, document.querySelector('form.signup button[type=submit]').disabled, document.querySelector('.thanks').hidden]);
        service.setHang(false);
        check(`${label}: a service that never answers: "Sending…", then a timeout message, the form usable again`, /Sending/.test(sending[0]) && sending[1] === true && /didn’t answer/.test(late[0]) && late[1] === false && late[2] === true && Date.now() - t0 >= ANSWER_TIMEOUT_MS - 1000, `${late[0]} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      }
      await ctx.close();
    }
    server.setRoot(BUILD);
  } finally {
    await browser.close();
    await server.close();
    await service.close();
  }

  check('no request left localhost', offsite.length === 0, offsite.slice(0, 5).join(' '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  report.service = service.log;
  fs.writeFileSync(path.join(WORK, 'report.json'), JSON.stringify(report, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Report and screenshots in ${WORK}`);
  for (const [k, v] of Object.entries(report.weight)) if (typeof v === 'object') console.log(`  ${k}: first screen ${kb(v.initial)}, scrolled to the end ${kb(v.total)}`);
  console.log(`  JavaScript: ${kb(report.weight.jsGzip)} gzipped`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
