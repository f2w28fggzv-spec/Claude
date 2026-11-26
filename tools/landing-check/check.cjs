#!/usr/bin/env node
// End-to-end check of the landing page (about/, served at /Claude/about/),
// with the real production build in Chromium (Playwright). A dev tool, not
// part of `npm test` (which stays browser-free).
//
//   npm run landing:check -- --work DIR --port 4402
//
// It builds the app and the page as `npm run build` does (without the
// typecheck) into DIR/build, the app alone without the page
// (app-only.config.mjs, into DIR/app-only), and the page twice more with a
// stand-in sign-up service connected (FITEE_LANDING_TEST_SIGNUP, a test-only
// override that accepts localhost only): its answer in the sandboxed frame
// (DIR/connected) and as its own page (DIR/connected-page). It serves a build under
// http://localhost:<port>/Claude/ like GitHub Pages (server.cjs: a folder's
// index.html, a folder without its slash redirected) and runs the stand-in
// service on <port + 1>. Its Chromium is cut off from every site but this
// machine (../offline-check/local-only.cjs), so a request to another site
// fails here and is still reported. Then it checks:
//   1. the build: the page's CSP, its JavaScript and first-load weight, the
//      app's precache list (sw.js) leaving about/ out, sw.js unchanged when
//      only the page changes, and the app's files and sw.js byte for byte the
//      same built without the page;
//   2. at 390 and 1280 px, light and dark, without and then with the app's
//      service worker installed (the app opened first in the same context):
//      the page loads, its hero runs (the app's demo renderer), the list is
//      in its closed state (no form, nothing to type into), nothing scrolls
//      sideways, no request leaves localhost, no console errors, no cookies
//      or storage (IndexedDB too), and the page's own code touches no storage
//      API at all (it reads none of the app's data); with the worker the page
//      is controlled, still loads every file, and none of them lands in the
//      app's offline copy; every kind of
//      text passes WCAG AA against the pixels behind it; full-page
//      screenshots at device scale 2;
//   3. layout and access: 320 px with nothing scrolling sideways; "sign-ups"
//      never broken at its hyphen; the first screen on a phone says the
//      figure is a how-to demo; keyboard focus visible on everything Tab
//      reaches, every lift chip on a phone fully in view with its whole ring,
//      and on a wide screen the headline's column before the demo's; the
//      hero's one height for every lift (as many as the page says get full
//      analysis) and no layout shift while it tours (CLS), each toured lift's
//      chip in view in the phone's sideways row through to the last (the page
//      never scrolled by it); the Female / Male radio group's tab stop; the
//      pause button saying what it does, and a lift picked while paused
//      staying paused; the Lowering / Lifting pills telling on from off by
//      shape; forced colours still showing what's picked, with outlines on
//      the buttons and the legend key's ramp; text at 200% and the WCAG
//      text-spacing values without side scroll or empty legend bars; two
//      columns of steps with no empty cell; steps 4 and 5's card over the
//      phone's edge only (720 to 1440 px); pictures fetched no larger than
//      the screen needs; the rep list readable on a phone; reduced motion
//      (and switched on and off while the page is open, the pause button
//      there whenever anything moves; on a phone each lift's stills as large
//      as the stage allows, the push-up's one above the other; from 560 px the
//      stills across the stage, with no layout shift as the script takes
//      over); no JavaScript
//      (the controls leave no gaps);
//   4. with the stand-in service connected (with and without the app's
//      worker): the hero's Join button goes to the email field; an empty or
//      malformed address gets an inline error (aria-invalid, announced) and
//      sends nothing; offline, it says so and sends nothing; a good address
//      is posted as a plain form navigation into the sandboxed frame (never
//      fetch), and whatever comes back (an answer, the service's error page,
//      or the browser's own when the service can't be reached) shows in the
//      frame under the form while the page says only what happens next if
//      the sign-up went through: never a done state of its own, the form
//      still there to try again, each post in a frame of its own (trying
//      again adds no step to Back); a service that never answers gets a
//      message, the button busy meanwhile with keyboard focus still on it;
//      the field's example address at 4.5:1 or more; the Join button's
//      outline in forced colours; and posted as its own page, the visitor
//      goes to the service, and coming Back (from the browser's back-forward
//      cache) finds the line under the field cleared.
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
const { launchLocalOnly, proveLocalOnly } = require('../offline-check/local-only.cjs');

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
const APP_ONLY = path.join(WORK, 'app-only');
const CONNECTED = path.join(WORK, 'connected');
const CONNECTED_PAGE = path.join(WORK, 'connected-page');
const SHOTS = path.join(WORK, 'shots');
const ORIGIN = `http://localhost:${PORT}`;
const APP = `${ORIGIN}/Claude/`;
const PAGE = `${ORIGIN}/Claude/about/`;
const SERVICE = `http://localhost:${SERVICE_PORT}`;
/** How long the page waits for the service's answer (src/landing/list.ts). */
const ANSWER_TIMEOUT_MS = 20_000;
const JS_BUDGET_GZIP = 120 * 1024;
const FIRST_LOAD_BUDGET = 700 * 1024;
/** What the page says once something came back from the service (src/landing/list.ts, about/index.html). */
const CAME_BACK = /^Here’s what came back\. If it says your sign-up went through, /;
/** A done state of the page's own, which it can't know: never shown. */
const DONE_CLAIM = /check your inbox|you(’|')re (now )?on the list|subscribed|success|thanks for/i;

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
  // The app on its own: its Vite config without the page's build.
  execFileSync('npx', ['vite', 'build', '--config', path.join(__dirname, 'app-only.config.mjs'), '--outDir', APP_ONLY, '--emptyOutDir', '--logLevel', 'warn'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  for (const [dir, mode] of [
    [CONNECTED, 'frame'],
    [CONNECTED_PAGE, 'page'],
  ]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.cpSync(BUILD, dir, { recursive: true });
    execFileSync(process.execPath, ['scripts/landing-build.ts', dir], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, FITEE_LANDING_TEST_SIGNUP: JSON.stringify({ action: `${SERVICE}/subscribe`, mode }) },
    });
  }
}

/** The stand-in sign-up service: logs what reaches it; answers with a page ('ok'), an error page ('error'), or never ('hang'). It can also be stopped, so its port is closed. */
function startService() {
  const log = [];
  let mode = 'ok';
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      log.push({ method: req.method, path: req.url, body, dest: req.headers['sec-fetch-dest'], mode: req.headers['sec-fetch-mode'], type: req.headers['content-type'], origin: req.headers.origin });
      if (mode === 'hang') return; // never answers
      if (mode === 'error') {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<!doctype html><title>stand-in error</title><p>The stand-in service had an error.</p>');
      }
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
    setMode: (m) => (mode = m),
    listen: () => new Promise((resolve, reject) => server.once('error', reject).listen(SERVICE_PORT, '127.0.0.1', resolve)),
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/**
 * Run before the page's own scripts (an init script): wraps every storage API
 * the page could read the app's data through (it shares the app's origin) and
 * notes each use in the page's own window. The check reads the notes before
 * it looks at storage itself.
 */
function storageAudit() {
  const used = (window.__storageUsed = []);
  const wrap = (target, name, label) => {
    const d = Object.getOwnPropertyDescriptor(target, name);
    if (!d || !d.get || !d.configurable) return;
    Object.defineProperty(target, name, {
      ...d,
      get() {
        used.push(label);
        return d.get.call(this);
      },
      ...(d.set && {
        set(v) {
          used.push(`${label}=`);
          d.set.call(this, v);
        },
      }),
    });
  };
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore']) wrap(window, name, name);
  wrap(Document.prototype, 'cookie', 'document.cookie');
  for (const name of ['serviceWorker', 'storage']) wrap(Navigator.prototype, name, `navigator.${name}`);
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
const sideScroll = (page) => page.evaluate(() => `${document.documentElement.scrollWidth}/${document.documentElement.clientWidth}`);

/** Text that must pass WCAG AA: its colour against the pixels behind it (with the text, borders, icons and dots hidden). */
const CONTRAST_SELECTORS = ['.eyebrow', '.lead', '.soon-pill', '.stage-tag', '.phase b', '.body-pick button', '.key', '.legend-note', '.lg-name', '.lg-role', '.lg-what', '.lifts-label', '.chip', '.stage figcaption', '.hero-facts li', '.kicker', '.pillar-text', '.rule-n', '.panel .rule-n', '.step-n', '.step p', '.step .sample', '.v-pass', '.v-fail', '.v-unknown', '.depth dd', '.section-lead', '.device figcaption', '.no-signal', '.facts p', '.vision-body p', '.soon-tag', '.panel-lede', '.privacy p', '.site-foot .small', '.head-link', '.field-label', '.fine', '.button'];
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
    if (!pause || document.querySelector('.stage').classList.contains('is-paused') || getComputedStyle(pause).display === 'none') return false;
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
          // (The phase pills' dots are drawn in currentColor, so they go with the text.)
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
/** The interest list after a post: the frame with what came back, what the page says, and whether the form is still usable. */
const answerState = (page) =>
  page.evaluate(() => {
    const answer = document.querySelector('.answer');
    // The frame on show (the next post's frame waits hidden beside it).
    const frame = answer?.querySelector('iframe:not([hidden])');
    const r = frame?.getBoundingClientRect();
    const form = document.querySelector('form.signup');
    return {
      shown: !!answer && !answer.hidden && !!r && r.height > 100 && r.width > 200,
      status: document.querySelector('.signup-status').textContent,
      error: document.querySelector('.signup-status').classList.contains('is-error'),
      formShown: !form.hidden && form.getBoundingClientRect().height > 0,
      enabled: form.querySelector('button[type=submit]').getAttribute('aria-disabled') !== 'true' && !form.querySelector('button[type=submit]').disabled,
      sandbox: frame?.getAttribute('sandbox'),
      panelText: document.querySelector('#list .panel').innerText,
      url: location.href,
    };
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
  const cspOf = (text) => /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(text)?.[1].replace(/&#39;/g, "'") ?? '';
  const csp = cspOf(html);
  // The repo's own config: closed until a service is set in src/landing/signup.ts (then the page's form posts to it).
  const repoOpen = /data-state="open"/.test(html);
  if (repoOpen) report.notes.push('src/landing/signup.ts connects a sign-up service: the main build is checked open');
  const ownOnly = /default-src 'none'/.test(csp) && /script-src 'self'/.test(csp) && /connect-src 'self'/.test(csp) && !/unsafe/.test(csp);
  if (repoOpen) check("the page has its CSP: only its own files, and the connected service's origin as the one form target", ownOnly && /form-action https:\/\/[^ ;]+;/.test(csp), csp);
  else check('the page has its CSP: only its own files, no form target or frame while the list is closed', ownOnly && /form-action 'none'/.test(csp) && /frame-src 'none'/.test(csp), csp);
  const connectedHtml = fs.readFileSync(path.join(CONNECTED, 'about', 'index.html'), 'utf8');
  const cspOpen = cspOf(connectedHtml);
  check('connected, the CSP allows that one service as form target and frame', cspOpen.includes(`form-action ${SERVICE}`) && cspOpen.includes(`frame-src ${SERVICE}`), cspOpen);
  const cspPage = cspOf(fs.readFileSync(path.join(CONNECTED_PAGE, 'about', 'index.html'), 'utf8'));
  check("connected as the service's own page, the CSP allows that one form target and no frame", cspPage.includes(`form-action ${SERVICE}`) && cspPage.includes("frame-src 'none'"), cspPage);
  const pageFiles = walk(path.join(BUILD, 'about'));
  const js = pageFiles.filter((f) => f.endsWith('.js'));
  const jsGzip = js.reduce((n, f) => n + zlib.gzipSync(fs.readFileSync(f)).length, 0);
  report.weight.jsGzip = jsGzip;
  check(`the page's JavaScript is at most ${kb(JS_BUDGET_GZIP)} gzipped`, jsGzip <= JS_BUDGET_GZIP, kb(jsGzip));
  const sw = fs.readFileSync(path.join(BUILD, 'sw.js'), 'utf8');
  // Every file the list names (pretty-printed in sw.js: "url": "…").
  const listed = [...sw.matchAll(/"url":\s*"([^"]+)"/g)].map((m) => m[1]);
  check("the app's precache list (sw.js) leaves about/ out", listed.length > 10 && !listed.some((u) => u.startsWith('about/')) && pageFiles.length > 0, `${listed.length} files listed, ${pageFiles.length} in about/`);
  execFileSync(process.execPath, ['scripts/offline-build.ts', CONNECTED], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  check('a different page (the connected build) gives the same sw.js', fs.readFileSync(path.join(CONNECTED, 'sw.js'), 'utf8') === sw);
  // The app built on its own (no page at all): the same files, byte for byte, sw.js too.
  const appFiles = walk(BUILD).map((f) => path.relative(BUILD, f)).filter((f) => !f.startsWith(`about${path.sep}`)).sort();
  const aloneFiles = walk(APP_ONLY).map((f) => path.relative(APP_ONLY, f)).sort();
  const differ = appFiles.filter((f) => !aloneFiles.includes(f) || !fs.readFileSync(path.join(BUILD, f)).equals(fs.readFileSync(path.join(APP_ONLY, f))));
  check(
    "the app built without the page gives the same files byte for byte, sw.js too: the app doesn't depend on the page",
    appFiles.includes('sw.js') && JSON.stringify(appFiles) === JSON.stringify(aloneFiles) && differ.length === 0,
    differ.length ? `differ: ${differ.join(', ')}` : `${appFiles.length} files${appFiles.length !== aloneFiles.length ? `, ${aloneFiles.length} built alone` : ''}`,
  );

  const server = createServer({ port: PORT });
  server.setRoot(BUILD);
  await server.listen();
  const service = startService();
  await service.listen();
  // Cut off from every site but this machine: a request to another site fails here (and is still reported below).
  const browser = await launchLocalOnly(chromium);
  const cutOff = await proveLocalOnly(browser).then((m) => ({ ok: true, m }), (e) => ({ ok: false, m: e.message }));
  check("the check's browser can't reach another site (a request to one fails on this machine)", cutOff.ok, cutOff.m);
  const offsite = [];
  const consoleErrors = [];
  const track = (context, label) => {
    context.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname !== 'localhost' && !['data:', 'blob:', 'about:'].includes(u.protocol)) offsite.push(`${label}: ${r.url()}`);
    });
    context.on('page', (p) => watch(p, label));
  };
  // The browser's own page for a site it can't reach logs its error to the console: expected in the "service down" case only.
  const expectedErrors = new Set();
  const watch = (p, label) => {
    p.on('console', (m) => {
      if (m.type() === 'error' && !expectedErrors.has(label)) consoleErrors.push(`${label}: ${m.text()}`);
    });
    p.on('pageerror', (e) => consoleErrors.push(`${label}: ${e.message}`));
  };
  // Service workers stay allowed everywhere (Playwright's "block" touches navigator.serviceWorker in every frame,
  // which throws in the sandboxed sign-up frame): "without the app's worker" is a fresh context where the app
  // was never opened, and the page itself never registers one.
  const contextFor = async (label, { width = 390, height, theme = 'light', dpr = 2, sw = false, ...rest } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: height ?? (width < 600 ? 844 : 800) }, deviceScaleFactor: dpr, colorScheme: theme, ...rest });
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
          await ctx.addInitScript(storageAudit);
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
          // Read before the check looks at storage itself.
          const used = await page.evaluate(() => window.__storageUsed ?? null);
          check(`${label}: the page's own code touches no storage API (it reads none of the app's data)`, Array.isArray(used) && used.length === 0, used === null ? 'the audit didn’t run' : used.join(', '));
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
              idb: (await indexedDB.databases()).length,
              worker: !!navigator.serviceWorker.controller || (await navigator.serviceWorker.getRegistrations()).length > 0,
              caches: (await caches.keys()).length,
            }));
            const cookies = await ctx.cookies();
            check(`${label}: no cookies, nothing stored (IndexedDB too), no service worker of its own`, stored.storage === 0 && stored.idb === 0 && !stored.worker && stored.caches === 0 && cookies.length === 0, JSON.stringify(stored));
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

    // ── 3. Layout and access ──
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
      // "sign-ups" stays whole wherever it wraps (300 to 360 px, where the hero's pill wraps).
      const ctx = await contextFor('hyphen', { width: 300, dpr: 1 });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      const broken = [];
      for (let w = 300; w <= 360; w += 2) {
        await page.setViewportSize({ width: w, height: 844 });
        const n = await page.evaluate(() => [...document.querySelectorAll('.nowrap')].map((e) => e.getClientRects().length).filter((k) => k > 1).length);
        if (n) broken.push(w);
      }
      check('"sign-ups" never breaks at its hyphen (300 to 360 px)', broken.length === 0, broken.length ? `broken at ${broken.join(', ')} px` : '31 widths');
      await ctx.close();
    }
    for (const [w, h] of [
      [390, 844],
      [375, 667],
    ]) {
      // The first screen with the moving figure says it's a how-to demo, not a reading of anyone's muscles.
      const ctx = await contextFor(`first screen ${w}`, { width: w, height: h, dpr: 1 });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(800);
      const s = await page.evaluate((hh) => {
        const top = (sel) => document.querySelector(sel).getBoundingClientRect().top;
        return { tag: document.querySelector('.stage-tag').textContent, tagTop: top('.stage-tag'), figureTop: top('.stage-figure'), note: top('.legend-note') < hh };
      }, h);
      check(`${w} x ${h}: the first screen with the figure labels it a how-to demo`, /how-to demo/i.test(s.tag) && s.tagTop < h && s.tagTop < s.figureTop, `label at ${Math.round(s.tagTop)} px${s.note ? ', and "a guide, not a measurement" too' : ''}`);
      await ctx.close();
    }
    {
      const ctx = await contextFor('keyboard', { width: 390, dpr: 2 });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(600);
      const seen = [];
      const invisible = [];
      const chipsCut = [];
      const chipsReached = [];
      const chipCount = await page.locator('.chip').count();
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        await sleep(60);
        const f = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const label = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
          const ring = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
          // A chip in the sideways scroller: wholly inside the scroller's view, ring and all.
          let cut = '';
          const box = el.closest('.chips');
          if (el.classList.contains('chip') && box && getComputedStyle(box).overflowX !== 'visible') {
            const b = box.getBoundingClientRect();
            const sb = getComputedStyle(box);
            const roomY = Math.min(r.top - b.top, b.bottom - r.bottom);
            if (r.left < b.left || r.right > b.right) cut = `${label}: not wholly in view`;
            else if (roomY < ring) cut = `${label}: ring cut (${roomY.toFixed(1)} px of ${ring} px)`;
            void sb;
          }
          return { label, chip: el.classList.contains('chip') ? el.dataset.lift : '', outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2, onScreen: r.width > 0 && r.height > 0 && s.visibility !== 'hidden', cut };
        });
        if (!f) break;
        seen.push(f.label);
        if (f.chip) chipsReached.push(f.chip);
        if (!f.outline || !f.onScreen) invisible.push(f.label);
        if (f.cut) chipsCut.push(f.cut);
        if (i === 0) await page.screenshot({ path: path.join(SHOTS, 'focus-skip-link.png') });
      }
      check('keyboard: every stop Tab reaches shows a visible focus ring', seen.length >= 12 && invisible.length === 0, `${seen.length} stops${invisible.length ? `; no ring on: ${invisible.join(', ')}` : ''}`);
      check(
        'keyboard, 390 px: each lift chip in the sideways row comes wholly into view, its ring uncut',
        chipsCut.length === 0 && chipCount >= 2 && new Set(chipsReached).size === chipCount,
        `${new Set(chipsReached).size} of ${chipCount} chips reached${chipsCut.length ? `; ${chipsCut.join('; ')}` : ''}`,
      );
      // The Female / Male radio group: arrow keys choose, and the chosen one is the tab stop.
      await page.focus('[data-body-pick="female"]');
      await page.keyboard.press('ArrowRight');
      const radios = await page.evaluate(() => [...document.querySelectorAll('[data-body-pick]')].map((r) => [r.dataset.bodyPick, r.getAttribute('aria-checked'), r.tabIndex]));
      const focused = await page.evaluate(() => document.activeElement?.dataset.bodyPick);
      check('the figure radio group: the arrow key picks Male, which becomes the tab stop', JSON.stringify(radios) === JSON.stringify([['female', 'false', -1], ['male', 'true', 0]]) && focused === 'male', JSON.stringify(radios));
      // The pause button says what it does (no "pressed" state on top of a changing name).
      const before = await page.evaluate(() => [document.querySelector('.demo-pause').getAttribute('aria-label'), document.querySelector('.demo-pause').hasAttribute('aria-pressed'), document.querySelector('.demo-pause').hidden]);
      await page.click('.demo-pause');
      const after = await page.evaluate(() => [document.querySelector('.demo-pause').getAttribute('aria-label'), document.querySelector('.demo-pause').hasAttribute('aria-pressed'), document.querySelector('.stage').classList.contains('is-paused')]);
      await page.click('.demo-pause');
      check('the pause button says what it does: "Pause the demo", then "Play the demo", never "pressed"', before[0] === 'Pause the demo' && !before[1] && !before[2] && after[0] === 'Play the demo' && !after[1] && after[2], `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      // Lowering / Lifting: the lit one has a filled dot, the other a ring (not colour alone). Read while one is lit (a
      // rep pauses at its ends, when neither is).
      await page.waitForFunction(() => !!document.querySelector('.phase b.on'), null, { timeout: 4000 }).catch(() => undefined);
      const dots = await page.evaluate(() =>
        [...document.querySelectorAll('.phase b')].map((b) => {
          const s = getComputedStyle(b, '::before');
          return { on: b.classList.contains('on'), fill: s.backgroundColor, ring: s.borderTopWidth };
        }),
      );
      const filled = (d) => !/rgba\(0, 0, 0, 0\)|transparent/.test(d.fill);
      check('the Lowering / Lifting pills tell on from off by shape: a filled dot against a ring', dots.length === 2 && dots.some((d) => d.on) && dots.every((d) => filled(d) === d.on && parseFloat(d.ring) > 0), JSON.stringify(dots));
      // A lift picked while the demo is paused shows from its start and stays paused (the play button plays it).
      await page.click('.demo-pause');
      await page.click('.chip[data-lift="deadlift"]');
      await sleep(500);
      const p0 = await heroState(page);
      await sleep(800);
      const p1 = await heroState(page);
      const stays = await page.evaluate(() => document.querySelector('.stage').classList.contains('is-paused') && document.querySelector('.demo-pause').getAttribute('aria-label') === 'Play the demo');
      await page.click('.demo-pause');
      check('a lift picked while the demo is paused shows from its start and stays paused', stays && p0.showing === 'deadlift' && p0.markup === p1.markup, `${p0.showing}, paused ${stays}`);
      await page.locator('.chip').first().focus();
      await page.screenshot({ path: path.join(SHOTS, 'focus-chip.png') });
      await ctx.close();
    }
    {
      // Wide screens: the headline's column comes first, then the demo's (Tab and the eye go the same way).
      const ctx = await contextFor('keyboard 1280', { width: 1280, dpr: 1 });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(400);
      const xs = [];
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        const f = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const r = el.getBoundingClientRect();
          return { label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24), x: Math.round(r.left), inStage: !!el.closest('.stage'), inCopy: !!el.closest('.hero-copy') };
        });
        if (f) xs.push(f);
      }
      const copy = xs.findIndex((f) => f.inCopy);
      const stage = xs.findIndex((f) => f.inStage);
      check('1280 px: Tab reaches the headline column (left) before the demo (right)', copy >= 0 && stage > copy && xs[copy].x < xs[stage].x, xs.map((f) => `${f.label}@${f.x}`).join(' → '));
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
      // As many lifts as the page says get full analysis (the build counts them in the library), each with its chip.
      const stated = Number(/on (\d+) lifts/.exec(await page.textContent('.lifts-label'))?.[1]);
      report.heroHeights = { ...report.heroHeights, [width]: heights };
      check(`${width} px: the hero keeps one height for all ${stated} lifts`, stated >= 2 && heights.length === stated && new Set(heights).size === 1, heights.join(', '));
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
      const y0 = await page.evaluate(() => scrollY);
      // Meanwhile, each lift the tour moves on to: its chip comes wholly into view in the sideways row (which scrolls
      // smoothly, so a moment after the change), and the page itself never scrolls.
      const chips = new Map();
      const t0 = Date.now();
      // Through to the last lift (the far end of the row): two reps of each (src/landing/hero.ts), from the page's own timings.
      const tour = await page.evaluate(() => {
        const lifts = JSON.parse(document.getElementById('hero-data').textContent).lifts;
        return { n: lifts.length, ms: lifts.reduce((t, l) => t + 2 * l.tl.total * 1000 + 250, 0) };
      });
      while (Date.now() - t0 < tour.ms + 6000 && chips.size < tour.n) {
        const id = await page.evaluate(() => document.querySelector('.chip[aria-pressed="true"]').dataset.lift);
        if (!chips.has(id)) {
          await sleep(900);
          chips.set(
            id,
            await page.evaluate(() => {
              const c = document.querySelector('.chip[aria-pressed="true"]');
              const r = c.parentElement.getBoundingClientRect();
              const b = c.getBoundingClientRect();
              return b.left >= r.left - 0.5 && b.right <= r.right + 0.5;
            }),
          );
        }
        await sleep(300);
      }
      const after = await heroState(page);
      const y1 = await page.evaluate(() => scrollY);
      const cls = await page.evaluate(() => window.__cls);
      report.cls['390 touring'] = cls;
      check('390 px, the hero half in view while it tours the lifts: no layout shift', before.showing !== after.showing && cls < 0.01, `CLS ${cls.toFixed(4)}, ${before.showing} → ${after.showing}`);
      check(
        '390 px: each lift the tour moves on to has its chip wholly in view in the sideways row (all of them, the last too), and the page never scrolls',
        chips.size === tour.n && [...chips.values()].every(Boolean) && y0 === y1,
        [...chips].map(([id, ok]) => `${id} ${ok ? 'in view' : 'NOT in view'}`).join(', '),
      );
      await ctx.close();
    }
    {
      // Forced colours (Windows High Contrast): the picked lift and figure still stand out.
      const ctx = await contextFor('forced colours', { width: 390, dpr: 1, forcedColors: 'active' });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(500);
      const s = await page.evaluate(() => {
        const cs = (sel) => getComputedStyle(document.querySelector(sel));
        const bg = (sel) => cs(sel).backgroundColor;
        const edge = (sel) => (cs(sel).borderTopStyle === 'solid' ? parseFloat(cs(sel).borderTopWidth) : 0);
        return { chip: bg('.chip[aria-pressed="true"]'), other: bg('.chip[aria-pressed="false"]'), radio: bg('[data-body-pick][aria-checked="true"]'), otherRadio: bg('[data-body-pick][aria-checked="false"]'), stage: cs('.stage').borderTopWidth, pause: edge('.demo-pause'), otherRadioEdge: edge('[data-body-pick][aria-checked="false"]'), key: cs('.key i').backgroundImage };
      });
      check('forced colours: the picked lift and the picked figure stand out from the rest, and the demo keeps its edge', s.chip !== s.other && s.radio !== s.otherRadio && parseFloat(s.stage) >= 1, JSON.stringify({ chip: s.chip, other: s.other, radio: s.radio, otherRadio: s.otherRadio, stage: s.stage }));
      check("forced colours: the pause button and the figure option not picked keep an outline, and the legend's key keeps its heat ramp", s.pause >= 1 && s.otherRadioEdge >= 1 && /gradient/.test(s.key), `pause ${s.pause} px, other option ${s.otherRadioEdge} px, key ${s.key.slice(0, 24)}…`);
      await page.locator('.stage').screenshot({ path: path.join(SHOTS, 'hero-forced-colours.png') });
      await ctx.close();
    }
    {
      // Text at 200% (WCAG 1.4.4) and the WCAG 1.4.12 text spacing: no side scroll, and the legend's bars keep their room.
      // (The reader's own styles, added as a style sheet: past the page's CSP, as a browser's settings are.)
      const ctx = await contextFor('large text', { width: 320, dpr: 1, bypassCSP: true });
      const page = await ctx.newPage();
      const out = [];
      for (const width of [320, 390, 1280]) {
        for (const how of ['text 200%', 'text spacing']) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(PAGE, { waitUntil: 'load' });
          await page.addStyleTag({
            content:
              how === 'text 200%'
                ? 'html { font-size: 200% !important; }'
                : '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
          });
          await sleep(300);
          const bars = await page.evaluate(() => [...document.querySelectorAll('.lg-list:not(.is-off) .lg-bar')].map((b) => Math.round(b.getBoundingClientRect().width)));
          const ok = (await noSideScroll(page)) && bars.length > 0 && bars.every((w) => w >= 24);
          out.push({ width, how, ok, sw: await sideScroll(page), bars });
        }
      }
      check('text at 200% and the WCAG text spacing: no side scroll at 320, 390 or 1280 px, legend bars at least 24 px', out.every((o) => o.ok), out.filter((o) => !o.ok).map((o) => `${o.how} ${o.width}: ${o.sw}, bars ${o.bars.join('/')}`).join('; ') || `${out.length} cases`);
      await ctx.close();
    }
    {
      // Two columns of steps (720 to 1023 px): no card stands alone beside an empty cell.
      const ctx = await contextFor('steps', { width: 720, dpr: 1 });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      const holes = [];
      for (const width of [720, 768, 834, 1000, 1023, 1024, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await sleep(150);
        const gap = await page.evaluate(() => {
          const grid = document.querySelector('.steps').getBoundingClientRect();
          const steps = [...document.querySelectorAll('.steps > .step')].map((e) => e.getBoundingClientRect());
          // A row's cards, side by side: an empty cell is a row whose cards stop well short of the grid's right edge.
          const rows = new Map();
          for (const r of steps) rows.set(Math.round(r.top), [...(rows.get(Math.round(r.top)) ?? []), r]);
          return [...rows.values()].map((row) => Math.round(grid.right - Math.max(...row.map((r) => r.right)))).filter((g) => g > 40);
        });
        if (gap.length) holes.push(`${width}: ${gap.join(', ')} px empty`);
      }
      check('steps, 720 to 1280 px: every row of cards spans the grid (no empty cell)', holes.length === 0, holes.join('; ') || '7 widths');
      // Steps 4 and 5: the card from another screen lies over the phone's edge only (the replay's title and skeleton stay in view).
      const covers = [];
      for (const width of [720, 768, 900, 1023, 1024, 1100, 1179, 1180, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await sleep(150);
        const worst = await page.evaluate(() =>
          Math.max(
            ...[...document.querySelectorAll('.phones.duo')].map((d) => {
              const phone = d.querySelector('.phone img').getBoundingClientRect();
              const card = d.querySelector('.shot-card img').getBoundingClientRect();
              const w = Math.max(0, Math.min(phone.right, card.right) - Math.max(phone.left, card.left));
              const h = Math.max(0, Math.min(phone.bottom, card.bottom) - Math.max(phone.top, card.top));
              return (w * h) / (phone.width * phone.height);
            }),
          ),
        );
        covers.push([width, Math.round(worst * 100)]);
      }
      check("steps 4 and 5, 720 to 1440 px: the card covers 15% of the phone's screen or less", covers.every(([, k]) => k <= 15), covers.map(([w, k]) => `${w}: ${k}%`).join(', '));
      await page.setViewportSize({ width: 768, height: 1000 });
      await page.locator('.steps > .step').nth(2).scrollIntoViewIfNeeded();
      await sleep(300);
      await page.locator('.steps > .step').nth(2).screenshot({ path: path.join(SHOTS, 'step3-768.png') });
      await ctx.close();
    }
    for (const [width, dpr] of [
      [320, 2],
      [390, 2],
      [390, 3],
      [768, 2],
      [1440, 2],
    ]) {
      // Pictures: each one the smallest file that covers its width on this screen (its `sizes` match the layout).
      const ctx = await contextFor(`pictures ${width}@${dpr}`, { width, dpr });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await scrollThrough(page);
      const picks = await page.evaluate((d) =>
        [...document.images].map((img) => {
          const shown = img.getBoundingClientRect().width;
          const files = img.srcset.split(',').map((c) => Number(/ (\d+)w/.exec(c.trim())[1])).sort((a, b) => a - b);
          // The smallest file that covers the picture at this density, allowing the layout 3% either way at a file's edge.
          const fit = (need) => files.find((f) => f >= need) ?? files[files.length - 1];
          const ok = [0.97, 1, 1.03].map((k) => fit(shown * d * k));
          const picked = Number((/-(\d+)-[\w-]+\.webp$/.exec(img.currentSrc) ?? [])[1]);
          return { name: (/assets\/([a-z]+-[a-z]+)/.exec(img.currentSrc) ?? [])[1], shown: Math.round(shown), picked, best: ok[1], fine: ok.includes(picked) };
        }),
        dpr,
      );
      const wrong = picks.filter((p) => !p.fine);
      check(`${width} px at device scale ${dpr}: every picture is the smallest file that covers it`, picks.length >= 10 && wrong.length === 0, wrong.map((p) => `${p.name} shown ${p.shown}, got ${p.picked}, needs ${p.best}`).join('; ') || `${picks.length} pictures`);
      await ctx.close();
    }
    for (const width of [320, 390]) {
      // The rep list laid over the replay, and the coach's card: big enough to read on a phone (the app's 15 px text at 9 px or more).
      const ctx = await contextFor(`cards ${width}`, { width, dpr: 2 });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      const scale = await page.evaluate(() => [...document.querySelectorAll('.duo .shot-card img')].map((i) => i.getBoundingClientRect().width / 358));
      check(`${width} px: the rep list and the coach's card show at 60% of the app's size or more`, scale.length === 2 && scale.every((k) => k >= 0.6), scale.map((k) => `${Math.round(k * 100)}%`).join(', '));
      if (width === 390) {
        await page.locator('.steps > .step').nth(3).scrollIntoViewIfNeeded();
        await sleep(300);
        await page.locator('.steps > .step').nth(3).screenshot({ path: path.join(SHOTS, 'step4-390.png') });
      }
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
      // Each lift's stills drawn as large as the stage allows: one drawn much wider than tall (the push-up, on the floor)
      // one above the other at the stage's width, the rest side by side; whichever, the stage keeps its height. Measured
      // both ways (the page's arrangement, then the other) on the drawing's own box.
      const ids = await page.evaluate(() => [...document.querySelectorAll('.chip')].map((c) => c.dataset.lift));
      const arranged = [];
      for (const id of ids) {
        await page.click(`.chip[data-lift="${id}"]`);
        await sleep(350);
        arranged.push(
          await page.evaluate(() => {
            const fig = document.querySelector('.stage-figure');
            const lift = JSON.parse(document.getElementById('hero-data').textContent).lifts.find((l) => l.id === document.querySelector('.stage').dataset.showing);
            const scale = () => {
              const r = document.querySelector('.still svg').getBoundingClientRect();
              return Math.min(r.width / lift.box.w, r.height / lift.box.h);
            };
            const stills = [...document.querySelectorAll('.still')].map((e) => e.getBoundingClientRect());
            const stacked = stills.length === 2 && stills[1].top >= stills[0].bottom && stills.every((r) => r.width >= fig.getBoundingClientRect().width - 1);
            const mine = scale();
            fig.classList.toggle('is-wide');
            const other = scale();
            fig.classList.toggle('is-wide');
            return { id: lift.id, stacked, mine, other, height: document.querySelector('.stage').getBoundingClientRect().height };
          }),
        );
        if (arranged[arranged.length - 1].stacked) await page.locator('.stage').screenshot({ path: path.join(SHOTS, `hero-reduced-motion-${id}.png`) });
      }
      await page.click('.chip[data-lift="back-squat"]');
      await sleep(400);
      check(
        'reduced motion, 390 px: each lift’s stills drawn as large as the stage allows (the push-up’s one above the other, the rest side by side), at one stage height',
        arranged.some((x) => x.id === 'push-up' && x.stacked) && arranged.every((x) => x.mine >= x.other - 0.5) && new Set(arranged.map((x) => x.height.toFixed(1))).size === 1,
        arranged.map((x) => `${x.id} ${x.stacked ? 'stacked' : 'side by side'} ${Math.round(x.mine)} (other way ${Math.round(x.other)})`).join('; ') + `; stage ${arranged[0]?.height.toFixed(1)} px`,
      );
      // Switched off and on again while the page is open: the demo plays (with its pause button), then stops again.
      const motion = async () => {
        const x = await heroState(page);
        await sleep(800);
        const y = await heroState(page);
        return { still: y.still, svgs: y.svgs, moving: x.markup !== y.markup, pause: await page.evaluate(() => getComputedStyle(document.querySelector('.demo-pause')).display !== 'none') };
      };
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await sleep(300);
      const on = await motion();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await sleep(300);
      const off = await motion();
      check(
        'reduced motion switched off while the page is open: the demo plays, with its pause button; switched on again: the stills, nothing moves, no pause button',
        !on.still && on.svgs === 1 && on.moving && on.pause && off.still && off.svgs === 2 && !off.moving && !off.pause,
        `${JSON.stringify(on)} → ${JSON.stringify(off)}`,
      );
      await ctx.close();
    }
    {
      // Reduced motion on a wide screen: the stills span the stage (the legend under them), and the stage is laid out so before the script runs too.
      const ctx = await contextFor('reduced motion 1024', { width: 1024, dpr: 1, reducedMotion: 'reduce' });
      await ctx.addInitScript(() => {
        window.__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(600);
      const s = await page.evaluate(() => {
        const stills = [...document.querySelectorAll('.still svg')].map((e) => e.getBoundingClientRect());
        const legend = document.querySelector('.legend').getBoundingClientRect();
        return { widths: stills.map((r) => Math.round(r.width)), below: stills.every((r) => legend.top >= r.bottom), cls: window.__cls };
      });
      check('reduced motion, 1024 px: the stills span the stage with the legend under them, and nothing shifts as the script takes over', s.widths.length === 2 && s.widths.every((w) => w >= 180) && s.below && s.cls < 0.01, `stills ${s.widths.join(' and ')} px wide, CLS ${s.cls.toFixed(4)}`);
      await page.locator('.stage').screenshot({ path: path.join(SHOTS, 'hero-reduced-motion-1024.png') });
      await ctx.close();
    }
    {
      const ctx = await contextFor('no script', { width: 390, javaScriptEnabled: false });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(1200); // the headline and the demo settle in (a CSS entrance, no script needed)
      const s = await page.evaluate(() => ({
        figure: (document.querySelector('.stage-figure svg')?.innerHTML.length ?? 0) > 1000,
        controls: ['.stage .lifts', '.stage .stage-tools', '.stage .phase'].map((sel) => getComputedStyle(document.querySelector(sel)).display),
        closed: document.querySelector('#list .panel')?.dataset.state,
      }));
      check('without JavaScript: the first frame is there, the controls are left out (no empty bands), the list is closed', s.figure && s.controls.every((d) => d === 'none') && s.closed === 'closed', JSON.stringify(s));
      await page.screenshot({ path: path.join(SHOTS, 'hero-no-script.png') });
      await ctx.close();
    }

    // ── 4. With a stand-in service connected ──
    server.setRoot(CONNECTED);
    const posts = () => service.log.filter((e) => e.method === 'POST').length;
    for (const sw of [false, true]) {
      const label = `connected${sw ? ' with the app' : ''}`;
      const ctx = await contextFor(label, { width: 390, sw });
      if (sw) await installApp(ctx);
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(500);
      const arrival = await page.evaluate(() => history.length);
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
        // The field's example address against the field (a Molten surface in both themes).
        const [hint, field] = await page.evaluate(() => {
          const i = document.querySelector('#signup-email');
          return [getComputedStyle(i, '::placeholder').color, getComputedStyle(i).backgroundColor];
        });
        const rgb = (c) => /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)/.exec(c).slice(1, 4).map(Number);
        const hintRatio = contrastOf(rgb(hint), rgb(field));
        check(`${label}: the field's example address passes WCAG AA against the field`, hintRatio >= 4.5, `${hintRatio.toFixed(2)}:1`);
        await page.emulateMedia({ forcedColors: 'active' });
        const join = await page.evaluate(() => {
          const b = getComputedStyle(document.querySelector('form.signup .button'));
          return b.borderTopStyle === 'solid' ? parseFloat(b.borderTopWidth) : 0;
        });
        await page.emulateMedia({ forcedColors: 'none' });
        check(`${label}: in forced colours the Join button keeps an outline (its fill is gone)`, join >= 1, `${join} px`);
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
      // A good address, and whatever comes back: a plain form post into the sandboxed frame; the answer shows there and the page claims nothing.
      const cases = sw ? ['ok'] : ['ok', 'error', 'down'];
      for (const how of cases) {
        service.setMode(how === 'error' ? 'error' : 'ok');
        // The frame's error page (the service's 500, or the browser's own) logs a console error of its own: expected here.
        if (how !== 'ok') expectedErrors.add(label);
        if (how === 'down') await service.close();
        const n1 = posts();
        await page.evaluate(() => {
          // A fresh start for each case: the status cleared, so a new answer is seen as new.
          document.querySelector('.signup-status').textContent = '';
        });
        await page.click('form.signup button[type=submit]');
        await page.waitForFunction((re) => new RegExp(re).test(document.querySelector('.signup-status').textContent), CAME_BACK.source, { timeout: 15000 }).catch(() => undefined);
        const done = await answerState(page);
        const frame = await (await page.$('.answer iframe:not([hidden])'))?.contentFrame();
        const frameUrl = frame?.url() ?? '';
        const post = service.log.filter((e) => e.method === 'POST').at(-1);
        const said = CAME_BACK.test(done.status) && !done.error;
        const claims = DONE_CLAIM.test(done.panelText);
        if (how === 'ok') {
          check(
            `${label}: a good address is posted to the service as a form navigation into the sandboxed frame (not fetch)`,
            posts() === n1 + 1 && post.path === '/subscribe' && post.type === 'application/x-www-form-urlencoded' && /email=someone%40example\.com/.test(post.body) && post.dest === 'iframe' && post.mode === 'navigate' && done.sandbox === '' && done.url.startsWith(PAGE),
            post ? `${post.method} ${post.path} dest=${post.dest} mode=${post.mode} body=${post.body}` : 'no post',
          );
          check(`${label}: the service's answer shows in the frame under the form; the page says only what happens next if it went through`, done.shown && said && !claims && done.formShown && done.enabled && frameUrl.startsWith(SERVICE), done.status);
          if (!sw) await page.locator('.panel').screenshot({ path: path.join(SHOTS, 'list-connected-answer.png') });
        } else if (how === 'error') {
          check(`${label}, the service answers with an error (HTTP 500): its error shows in the frame, and the page claims nothing`, posts() === n1 + 1 && done.shown && said && !claims && done.formShown && done.enabled, done.status);
          expectedErrors.delete(label);
        } else {
          // The browser's own error page needs script, which the sandboxed frame doesn't run: the frame is blank, and the page's words say what blank means.
          check(`${label}, the service can't be reached (its port closed): nothing is sent, the frame holds the browser's error (blank), the page says what blank means and claims nothing`, posts() === n1 && done.shown && said && /If it’s blank, the sign-up service couldn’t be reached/.test(done.status) && !claims && done.formShown && done.enabled && /^chrome-error:/.test(frameUrl), `${done.status} (frame: ${frameUrl})`);
          await page.locator('.panel').screenshot({ path: path.join(SHOTS, 'list-connected-service-down.png') });
          await service.listen();
          expectedErrors.delete(label);
          service.setMode('ok');
        }
      }
      if (!sw) {
        // Each post went into a frame of its own: trying again adds no step to the browser's Back.
        const now = await page.evaluate(() => history.length);
        check(`${label}: three posts, each into a fresh frame, add no step to Back`, now === arrival, `history ${arrival} → ${now}`);
        // A service that never answers, sent from the keyboard: the button looks busy and keeps focus.
        service.setMode('hang');
        const t0 = Date.now();
        await page.focus('form.signup button[type=submit]');
        await page.keyboard.press('Enter');
        await sleep(500);
        const sending = await page.evaluate(() => {
          const b = document.querySelector('form.signup button[type=submit]');
          return [document.querySelector('.signup-status').textContent, b.getAttribute('aria-disabled') === 'true', document.activeElement === b];
        });
        await page.waitForFunction(() => /No answer from the sign-up service yet/.test(document.querySelector('.signup-status').textContent), null, { timeout: ANSWER_TIMEOUT_MS + 10000 }).catch(() => undefined);
        const late = await answerState(page);
        service.setMode('ok');
        check(
          `${label}: a service that never answers: "Sending…" with the button busy and keyboard focus still on it, then a message, the form usable again, nothing claimed`,
          /Sending/.test(sending[0]) && sending[1] === true && sending[2] === true && /No answer from the sign-up service yet/.test(late.status) && late.error && late.enabled && late.formShown && !DONE_CLAIM.test(late.panelText) && Date.now() - t0 >= ANSWER_TIMEOUT_MS - 1000,
          `${late.status} after ${((Date.now() - t0) / 1000).toFixed(1)} s${sending[2] ? '' : '; focus left the button'}`,
        );
      }
      await ctx.close();
    }
    // Posted as the service's own page: the visitor goes there (a top-level form navigation), and sees its answer.
    {
      server.setRoot(CONNECTED_PAGE);
      const label = 'connected, the service’s own page';
      const ctx = await contextFor(label, { width: 390 });
      const page = await ctx.newPage();
      await page.goto(PAGE, { waitUntil: 'load' });
      await sleep(400);
      await page.fill('#signup-email', 'someone@example.com');
      const n = posts();
      await Promise.all([page.waitForURL((u) => u.href.startsWith(SERVICE), { timeout: 15000 }).catch(() => undefined), page.click('form.signup button[type=submit]')]);
      const post = service.log.filter((e) => e.method === 'POST').at(-1);
      check(`${label}: a good address goes to the service as a top-level form navigation, and the visitor sees its page`, posts() === n + 1 && post.dest === 'document' && post.mode === 'navigate' && page.url().startsWith(SERVICE) && !(await page.evaluate(() => !!document.querySelector('iframe'))), `${post?.dest} ${post?.mode} → ${page.url()}`);
      await ctx.close();
    }
    {
      // Back from the service's page: the browser keeps this page as it was (its back-forward cache, which Playwright turns
      // off unless the full Chromium is launched without its default flag), and "Opening the sign-up page…" goes.
      const label = 'connected, back from the service’s own page';
      const keeping = await launchLocalOnly(chromium, { channel: 'chromium', ignoreDefaultArgs: ['--disable-back-forward-cache'] });
      try {
        const ctx = await keeping.newContext({ viewport: { width: 390, height: 844 } });
        track(ctx, label);
        await ctx.addInitScript(() => addEventListener('pageshow', (e) => e.persisted && (window.__kept = true)));
        const page = await ctx.newPage();
        await page.goto(PAGE, { waitUntil: 'load' });
        await page.fill('#signup-email', 'someone@example.com');
        await Promise.all([page.waitForURL((u) => u.href.startsWith(SERVICE), { timeout: 15000 }), page.click('form.signup button[type=submit]')]);
        await page.goBack({ waitUntil: 'commit' });
        await sleep(800);
        const back = await page.evaluate(() => ({ kept: !!window.__kept, status: document.querySelector('.signup-status').textContent, email: document.querySelector('#signup-email').value }));
        check(`${label}: the page comes back as it was, the line under the field cleared`, back.kept && back.status === '' && back.email === 'someone@example.com', JSON.stringify(back));
        await ctx.close();
      } finally {
        await keeping.close();
      }
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
