#!/usr/bin/env node
// End-to-end check of installing fitee and using it offline, with the real
// production build in Chromium (Playwright). A dev tool, not part of
// `npm test` (which stays browser-free).
//
//   npm run offline:check
//   npm run offline:check -- --work DIR --port 4180
//
// It builds the app into a temporary folder (--work to choose it), makes
// four "deploys" of it that differ only in a marker in index.html and one
// whose lite pose model changed too, and serves them under
// http://localhost:<port>/Claude/ (localhost is a secure context, so the
// service worker registers). Then it checks:
//   1. the manifest has no installability errors, and maskable icons keep
//      the logo inside the safe zone; Chrome's own install banner isn't
//      suppressed (the "Install fitee" button in Settings is offered too);
//   2. a first visit in a tab saves the app but not the pose files, and the
//      service worker itself refuses a request to another origin (checked
//      with the page's CSP bypassed, against a control without the worker),
//      and doesn't follow a redirect to another origin;
//   3. offline (context.setOffline, and the server dropping every
//      connection), reloaded: every tab, an exercise page with its animated
//      demo, and Settings open; a technique check says plainly that the pose
//      model isn't saved;
//   4. "Save for offline use" in Settings saves the pose files, with pose
//      files sent slowly and a technique check opened meanwhile: each file is
//      downloaded once, and the check's screen says the save is running;
//   5. an installed app (iOS's navigator.standalone) downloads nothing while
//      the terms aren't accepted, then saves the pose files by itself and
//      says so on the Train tab; then a technique check's camera starts
//      offline (fake camera) with the model from the cache, and the camera
//      test's Lite model (not saved) points to the Full one;
//   6. the standalone layout keeps clear of the status bar and home indicator;
//   7. updates: B installs, is offered, applies on "Update now", deletes the
//      old caches and downloads neither unchanged app files nor pose files;
//      C waits during a technique check and applies at the next cold open; D
//      applies by itself right after the app opens on a safe screen; E
//      fails half-way (a file missing on the server): the current version
//      keeps working, offline too, and a later check installs E, downloading
//      only what it hadn't saved; P (a new lite model) waits while the pose
//      files are saved, and they're still saved once it applies;
//   8. a first install that fails says so in Settings, and Try again saves
//      the app; with no room on the phone (a small quota), Settings says so
//      and the next launch doesn't download the pose model again;
//   9. no request leaves localhost at any point.
// It prints PASS/FAIL lines and the bytes each scenario downloads, and writes
// report.json and screenshots (Settings at 390 px, light and dark) to the
// work folder. Exits 1 if any check fails.
//
// Needs Playwright with Chromium (a dev tool, not a dependency of the app).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createServer } = require('./server.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const PORT = Number(opt('port', 4180));
const WORK = path.resolve(opt('work', '') || fs.mkdtempSync(path.join(os.tmpdir(), 'fitee-offline-check-')));
const ORIGIN = `http://localhost:${PORT}`;
const BASE = `${ORIGIN}/Claude/`;
const SHOTS = path.join(WORK, 'shots');
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const NOT_SAVED =
  'The pose model isn’t saved on this phone yet. Connect to the internet and keep fitee open while it loads; after that, technique checks work offline.';
/** The app may apply a new version by itself this soon after it opens (src/offline/state.ts). */
const LAUNCH_WINDOW_MS = 15_000;
const DEFAULT_POSE = ['mediapipe/models/pose_landmarker_full.task', 'mediapipe/wasm/vision_wasm_internal.js', 'mediapipe/wasm/vision_wasm_internal.wasm'];
const LITE = 'mediapipe/models/pose_landmarker_lite.task';
/** Pose files at about this many bytes a second where a scenario needs time (a phone's connection). */
const PHONE_SPEED = 4_000_000;
const slowPose = (e) => (e.path.includes('/mediapipe/') ? PHONE_SPEED : 0);

const results = [];
const report = { work: WORK, checks: results, bytes: {}, sizes: {}, notes: [] };
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;

/**
 * Builds the app, then four deploys that differ only in a marker in
 * index.html, and one (p) whose lite pose model changed too, as when CI
 * fetches a newer model.
 */
function buildAll() {
  const builds = { a: path.join(WORK, 'build-a') };
  execFileSync('npx', ['vite', 'build', '--outDir', builds.a, '--emptyOutDir', '--logLevel', 'warn'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  for (const marker of ['b', 'c', 'd', 'e', 'p']) {
    const dir = path.join(WORK, `build-${marker}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.cpSync(builds.a, dir, { recursive: true });
    const index = path.join(dir, 'index.html');
    fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('<head>', `<head>\n    <meta name="fitee-build" content="${marker}" />`));
    if (marker === 'p') fs.appendFileSync(path.join(dir, LITE), Buffer.from([0]));
    execFileSync(process.execPath, ['scripts/offline-build.ts', dir], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    builds[marker] = dir;
  }
  return builds;
}

/** Sizes of a build, and roughly what GitHub Pages sends (it gzips text). */
function sizesOf(dir) {
  const out = { app: 0, appGzip: 0, pose: {}, files: 0 };
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else {
        const rel = path.relative(dir, full).split(path.sep).join('/');
        const bytes = fs.readFileSync(full);
        if (rel === 'sw.js') out.sw = bytes.length;
        else if (rel.startsWith('mediapipe/')) out.pose[rel] = bytes.length;
        else {
          out.files++;
          out.app += bytes.length;
          out.appGzip += /\.(html|js|css|json|webmanifest|svg|txt)$/.test(rel) ? zlib.gzipSync(bytes).length : bytes.length;
        }
      }
    }
  };
  walk(dir);
  return out;
}

// In-page helpers.
const cacheSummary = (page) =>
  page.evaluate(async () => {
    const out = {};
    for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname.replace(/^\/Claude\//, '')).sort();
    return out;
  });
const swStatus = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const c = navigator.serviceWorker.controller;
        if (!c) return resolve(null);
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data);
        c.postMessage({ type: 'status' }, [ch.port2]);
        setTimeout(() => resolve(null), 20000);
      }),
  );
const marker = async (page) => {
  for (let i = 0; i < 50; i++) {
    try {
      return await page.evaluate(() => document.querySelector('meta[name="fitee-build"]')?.getAttribute('content') ?? 'a');
    } catch {
      await sleep(200); // mid-reload
    }
  }
  return '?';
};
const go = (page, hash) => page.evaluate((h) => (location.hash = h), hash);
async function until(fn, timeoutMs, stepMs = 250) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // e.g. the page is reloading
    }
    if (Date.now() > end) return undefined;
    await sleep(stepMs);
  }
}
const poseIn = (summary) => Object.entries(summary).filter(([name]) => name.startsWith('fitee-pose-')).flatMap(([, files]) => files);
const appCacheNames = (summary) => Object.keys(summary).filter((n) => n.startsWith('fitee-app-'));
const bytesIn = (server, phase) => server.requests(phase).reduce((n, e) => n + e.bytes, 0);
const listOf = (server, phase) => server.requests(phase).map((e) => `${e.path.replace('/Claude/', '')}${e.query}`);

/**
 * While offline, nothing of the app's may reach the network. The browser's
 * own update check of sw.js runs outside the page (Playwright's offline
 * emulation doesn't cover it), so the server sees it and drops it: allowed.
 */
function offlineOnly(server, phase) {
  const seen = server.requests(phase);
  const other = seen.filter((e) => e.path !== '/Claude/sw.js');
  check(
    'offline, nothing but the browser’s own update check of sw.js tried the network (and it failed)',
    other.length === 0 && seen.every((e) => e.status === 'dropped'),
    `${seen.length} attempt(s): ${seen.map((e) => e.path).join(', ') || 'none'}`,
  );
}

/** Waits for page transitions and other finite animations to finish (at most 2 s). */
const settled = (page) =>
  page
    .evaluate(() =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        ),
        new Promise((r) => setTimeout(r, 2000)),
      ]),
    )
    .then(() => sleep(150))
    .catch(() => {});

/** Phone-sized screenshots, light and dark, scrolled to `focus` (default: the Settings section). */
async function screenshot(page, name, focus = 'h2.field:text("Install and offline")') {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page
    .locator(focus)
    .first()
    .evaluate((el) => el.scrollIntoView({ block: 'start' }))
    .catch(() => {});
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await settled(page);
    await page.screenshot({ path: path.join(SHOTS, `${name}.${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('This tool needs Playwright with Chromium (the pre-installed one; it does not install browsers).');
    process.exit(1);
  }
  fs.mkdirSync(WORK, { recursive: true });
  console.log(`Building into ${WORK} …`);
  const builds = buildAll();
  const sizes = sizesOf(builds.a);
  report.sizes = {
    appFiles: sizes.files,
    appBytes: sizes.app,
    appGzipBytes: sizes.appGzip,
    swBytes: sizes.sw,
    pose: sizes.pose,
    poseDefaultBytes: DEFAULT_POSE.reduce((n, f) => n + (sizes.pose[f] ?? 0), 0),
    poseAllBytes: Object.values(sizes.pose).reduce((a, b) => a + b, 0),
  };
  console.log(
    `App ${sizes.files} files ${mb(sizes.app)} (about ${mb(sizes.appGzip)} gzipped); sw.js ${sizes.sw} bytes; pose model by default ${mb(report.sizes.poseDefaultBytes)}, all pose files ${mb(report.sizes.poseAllBytes)}`,
  );

  const server = createServer({ port: PORT });
  server.setRoot(builds.a);
  await server.listen();
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const requests = [];
  const pageErrors = [];
  const track = (context, label) => {
    context.on('request', (r) => requests.push({ context: label, url: r.url(), method: r.method(), worker: !!r.serviceWorker() }));
  };
  const watchErrors = (page, label) => page.on('pageerror', (e) => pageErrors.push(`${label}: ${e.message}`));

  try {
    // ── 1–2. A first visit in a browser tab ────────────────────────────────
    server.setPhase('tab-first-visit');
    const tab = await browser.newContext(PHONE);
    track(tab, 'tab');
    const p = await tab.newPage();
    watchErrors(p, 'tab');
    await p.goto(BASE);
    await p.getByRole('button', { name: 'Skip for now' }).click();
    const controlled = await until(() => p.evaluate(() => !!navigator.serviceWorker.controller), 30000);
    check('the service worker registers and takes over the first page', controlled);
    const st1 = await until(async () => {
      const s = await swStatus(p);
      return s && s.app.saved === s.app.files ? s : null;
    }, 30000);
    check('a first visit in a tab saves the app', st1, st1 ? `${st1.app.files} files, ${mb(st1.app.bytes)}` : 'not saved');
    const c1 = await cacheSummary(p);
    const tabFirst = server.requests('tab-first-visit');
    check(
      'a first visit in a tab does not download the pose files',
      poseIn(c1).length === 0 && !tabFirst.some((e) => e.path.includes('/mediapipe/')),
      `${tabFirst.length} requests, ${mb(bytesIn(server, 'tab-first-visit'))}`,
    );
    report.bytes.firstVisitTab = bytesIn(server, 'tab-first-visit');
    report.firstVisitRequests = listOf(server, 'tab-first-visit');

    const cdp = await tab.newCDPSession(p);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    check('Chromium finds no installability errors', installabilityErrors.length === 0, JSON.stringify(installabilityErrors));
    const appManifest = await cdp.send('Page.getAppManifest');
    const manifest = JSON.parse(appManifest.data);
    check('the manifest parses without errors', appManifest.errors.length === 0, JSON.stringify(appManifest.errors));
    const purposes = manifest.icons.map((i) => i.purpose);
    check(
      'the manifest has an id, separate any and maskable icons, and no orientation lock',
      manifest.id && purposes.includes('any') && purposes.includes('maskable') && !purposes.some((x) => x.includes(' ')) && !manifest.orientation,
      `id ${manifest.id}; purposes ${purposes.join(', ')}`,
    );
    const safe = await p.evaluate(async (icons) => {
      const out = [];
      for (const icon of icons) {
        const img = new Image();
        img.src = icon.src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
        const bg = [data[0], data[1], data[2]];
        let max = 0;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 24)
              max = Math.max(max, Math.hypot(x - (width - 1) / 2, y - (height - 1) / 2));
          }
        out.push({ src: icon.src, size: width, logoRadius: +(max / width).toFixed(3) });
      }
      return out;
    }, manifest.icons.filter((i) => i.purpose === 'maskable').map((i) => ({ src: new URL(i.src, appManifest.url).href })));
    check(
      'maskable icons keep the logo inside the safe zone (40% of the size from the centre)',
      safe.length > 0 && safe.every((s) => s.logoRadius <= 0.4),
      safe.map((s) => `${s.size}px: ${s.logoRadius}`).join(', '),
    );
    // An attached CDP session stops Playwright's offline emulation from
    // reaching navigator.onLine after a reload: detach before going offline.
    await cdp.detach();

    // ── 2b. The service worker's own guard against other origins ─────────
    // privacy.ts covers fetch, XHR and beacons, and the CSP everything else.
    // With the CSP bypassed, an image from another origin (a second local
    // server) is stopped only by the service worker. Control: the same page
    // without its service worker, where the image does load.
    server.setPhase('probe');
    const probe = createServer({ port: PORT + 1 });
    probe.setRoot(builds.a);
    await probe.listen();
    const PROBE = `http://localhost:${PORT + 1}/Claude/icon-192.png`;
    const loadImage = (page, src) =>
      page.evaluate(
        (u) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve('loaded');
            img.onerror = () => resolve('error');
            img.src = u;
            setTimeout(() => resolve('timeout'), 10000);
          }),
        src,
      );
    try {
      const bare = await browser.newContext({ ...PHONE, bypassCSP: true, serviceWorkers: 'block' });
      const bp = await bare.newPage();
      await bp.goto(BASE);
      const without = await loadImage(bp, `${PROBE}?without-worker`);
      await bare.close();
      const guarded = await browser.newContext({ ...PHONE, bypassCSP: true });
      const gp = await guarded.newPage();
      await gp.goto(BASE);
      const ready = await until(() => gp.evaluate(() => !!navigator.serviceWorker.controller), 30000);
      const withWorker = ready ? await loadImage(gp, `${PROBE}?with-worker`) : 'no service worker';
      await guarded.close();
      const reached = probe.log.map((e) => e.query);
      check(
        'the service worker answers a request to another origin with a network error (page CSP bypassed for this check)',
        without === 'loaded' && withWorker === 'error' && reached.includes('?without-worker') && !reached.includes('?with-worker'),
        `without the worker the image ${without}; with it: ${withWorker}; requests that reached the other origin: ${reached.join(', ') || 'none'}`,
      );
      report.probe = { without, withWorker, reached };

      // A redirect to another origin (GitHub Pages sends one for every file once
      // a site moves to a custom domain, with Access-Control-Allow-Origin: *):
      // the worker's download must stop there, not follow it.
      server.setPhase('redirect');
      const before = probe.log.length;
      server.setRedirect((e) => (e.path === `/Claude/${LITE}` && e.query.startsWith('?v=') ? `http://localhost:${PORT + 1}${e.path}${e.query}` : null));
      const fetched = await p.evaluate((u) => fetch(u).then((r) => `HTTP ${r.status}`, (err) => `failed (${err.name})`), LITE);
      await sleep(500);
      server.setRedirect(null);
      const followed = probe.log.slice(before).map((e) => e.path);
      const liteSaved = (await swStatus(p))?.pose.find((x) => x.url === LITE)?.saved;
      check(
        'the service worker doesn’t follow a redirect to another origin (nothing reaches it, nothing is kept)',
        fetched.startsWith('failed') && followed.length === 0 && liteSaved === false && server.requests('redirect').some((e) => e.status === 302),
        `the page's fetch ${fetched}; requests that reached the other origin: ${followed.join(', ') || 'none'}; lite model saved: ${liteSaved}`,
      );
    } finally {
      await probe.close();
    }

    // Chrome's own install banner isn't suppressed; the button in Settings is offered as well.
    const pp = await tab.newPage();
    await pp.goto(`${BASE}#/settings`);
    await until(() => pp.evaluate(() => !!navigator.serviceWorker.controller), 10000);
    const prevented = await pp.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = async () => {};
      e.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    const installButton = await until(() => pp.locator('li[data-install="prompt"] button').isVisible(), 5000);
    check('Chrome’s install banner isn’t suppressed, and Settings offers “Install fitee” too', !prevented && installButton, `beforeinstallprompt prevented: ${prevented}`);
    await screenshot(pp, 'settings-install-prompt');
    await pp.close();

    // ── 3. Offline in the tab ──────────────────────────────────────────────
    server.setPhase('tab-offline');
    await tab.setOffline(true);
    server.setDown(true);
    await p.reload();
    const opened = await until(() => p.locator('nav.tabs').isVisible(), 15000);
    check('offline, the app opens from the cache', opened);
    const tabs = [];
    for (const [hash, label] of [
      ['#/', 'Train'],
      ['#/log', 'Log'],
      ['#/library', 'Exercises'],
    ]) {
      await p.locator(`nav.tabs a[href="${hash}"]`).click();
      const title = await until(async () => {
        const t = await p.locator('main h1').first().textContent();
        return (await p.locator('nav.tabs a.on').textContent())?.includes(label) ? t : null;
      }, 5000);
      tabs.push(`${label}: "${title ?? '?'}"`);
      check(`offline, the ${label} tab opens`, title);
    }
    await go(p, '#/exercise/back-squat');
    const frames = await until(async () => {
      const a = await p.locator('.demo-stage svg').innerHTML();
      await sleep(400);
      const b = await p.locator('.demo-stage svg').innerHTML();
      return a.length > 1000 && a !== b ? [a.length, b.length] : null;
    }, 8000);
    check('offline, an exercise page plays its animated demo', frames, frames ? `frame markup ${frames[0]} → ${frames[1]} chars` : '');
    const screens = [];
    for (const [hash, title] of [
      ['#/groups', 'What do you want to train?'],
      ['#/build', 'How do you train?'],
      ['#/profile', 'Profile'],
      ['#/routine/new', 'New routine'],
      ['#/edit/new?date=2026-11-20', 'Past workout'],
      ['#/library', 'Exercises'],
      ['#/terms', 'Terms of service'],
      ['#/privacy', 'Privacy policy'],
      ['#/camera', 'Camera test'],
    ]) {
      await go(p, hash);
      // The page's own title, not the one before it fading out.
      const ok = await until(async () => (await p.locator('main h1').allTextContents()).some((t) => t.trim() === title), 5000);
      screens.push(`${hash} ${ok ? '✓' : `✗ (no “${title}”)`}`);
    }
    check('offline, the other screens open too', screens.every((x) => x.endsWith('✓')), screens.join(', '));
    const font = await p.evaluate(() => document.fonts.check('16px "Bricolage Grotesque Variable"'));
    check('offline, the app’s own font is there', font);
    await go(p, '#/settings');
    const appOnly = p.locator('li[data-offline="app-only"]');
    await appOnly.waitFor({ timeout: 10000 }).catch(() => {});
    const appOnlyText = (await appOnly.textContent().catch(() => '')) ?? '';
    const saveDisabled = await appOnly.locator('button').isDisabled().catch(() => false);
    check('offline, Settings opens and says the app works offline but the pose model isn’t saved', appOnlyText.includes('The app works offline') && saveDisabled, appOnlyText.replace(/\s+/g, ' ').trim());
    await screenshot(p, 'settings-offline-app-only');
    await go(p, '#/analyze/back-squat');
    const note = await until(() => p.locator('p.note').textContent(), 30000);
    check('offline without the pose files, a technique check says so plainly', note?.trim() === NOT_SAVED, note?.trim());
    await screenshot(p, 'analyze-offline-not-saved', 'p.note');
    offlineOnly(server, 'tab-offline');

    // ── 4. "Save for offline use" in Settings ──────────────────────────────
    server.setDown(false);
    await tab.setOffline(false);
    server.setPhase('tab-hard-reload');
    await go(p, '#/settings');
    // A hard reload loads the page past the service worker; saving must still go through it.
    const hard = await tab.newCDPSession(p);
    await hard.send('Page.reload', { ignoreCache: true });
    await hard.detach();
    await p.waitForLoadState('load');
    const pastWorker = await p.evaluate(() => !navigator.serviceWorker.controller);
    server.setPhase('tab-save-button');
    // At a phone's speed, with a technique check opened while it saves: the
    // check waits for the files on their way instead of downloading them again,
    // and its screen says the save is running (closing fitee would stop it).
    server.setSlow(slowPose);
    const saveButton = p.locator('li[data-offline="app-only"] button');
    await until(() => saveButton.isEnabled(), 10000);
    await saveButton.click();
    await until(() => p.locator('li[data-offline="saving-pose"]').isVisible(), 10000);
    await screenshot(p, 'settings-saving-pose');
    await sleep(1000);
    await go(p, '#/analyze/back-squat');
    const noteOnCheck = await until(() => p.locator('.save-note').textContent(), 5000);
    await screenshot(p, 'save-note-on-check', 'main');
    const checkReady = await until(() => p.getByRole('button', { name: 'Start camera' }).isEnabled(), 90000, 500);
    await go(p, '#/settings');
    const ready = await until(() => p.locator('li[data-offline="ready"]').isVisible(), 90000);
    server.setSlow(null);
    const c2 = await cacheSummary(p);
    const saved = server.requests('tab-save-button').filter((e) => e.path.includes('/mediapipe/'));
    check(
      '“Save for offline use” saves the SIMD runtime and the full model, each downloaded once, with a technique check opened meanwhile (after a hard reload)',
      ready && checkReady && JSON.stringify(poseIn(c2).sort()) === JSON.stringify(DEFAULT_POSE) && saved.length === 3 && saved.every((e) => e.query.startsWith('?v=')),
      `${saved.map((e) => e.path.split('/').pop()).join(', ')}; ${mb(bytesIn(server, 'tab-save-button'))}; page outside the service worker before saving: ${pastWorker}; check ready: ${!!checkReady}`,
    );
    check('while it saves, other screens say so (“Keep fitee open”)', /Saving for offline use.*Keep fitee open/.test(noteOnCheck ?? ''), (noteOnCheck ?? 'no note').replace(/\s+/g, ' ').trim());
    report.bytes.saveButton = bytesIn(server, 'tab-save-button');
    await screenshot(p, 'settings-ready-tab');

    // "Delete all my data" deletes the user's data and keeps the offline copy (it holds none).
    let confirmText = '';
    p.once('dialog', (d) => {
      confirmText = d.message();
      void d.accept();
    });
    await p.getByRole('button', { name: 'Delete all my data' }).click();
    const welcome = await until(() => p.getByRole('button', { name: 'Skip for now' }).isVisible(), 10000);
    const c3 = await cacheSummary(p);
    const left = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('formcheck.v1.')));
    check(
      '“Delete all my data” deletes the user’s data, keeps the offline copy, and says so',
      welcome && left.length === 0 && JSON.stringify(c3) === JSON.stringify(c2) && /offline copy stays/.test(confirmText),
      `confirm: “${confirmText}”`,
    );
    await tab.close();

    // ── 5. The installed app (iOS home screen) ─────────────────────────────
    server.setPhase('installed-first-launch');
    const inst = await browser.newContext(PHONE);
    await inst.grantPermissions(['camera'], { origin: ORIGIN });
    await inst.addInitScript(() => {
      // Opened from the iPhone home screen; and count requests for persistent storage.
      Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
      const persist = StorageManager.prototype.persist;
      StorageManager.prototype.persist = function () {
        window.__persistCalls = (window.__persistCalls ?? 0) + 1;
        return persist.call(this);
      };
    });
    track(inst, 'installed');
    let q = await inst.newPage();
    watchErrors(q, 'installed');
    // At a phone's speed, so the note on the Train tab can be seen.
    server.setSlow(slowPose);
    await q.goto(BASE);
    // The terms (which describe the download) come first: nothing is downloaded while they show.
    await until(() => q.evaluate(() => !!navigator.serviceWorker.controller), 30000);
    await sleep(4000);
    const beforeTerms = server.requests('installed-first-launch').filter((e) => e.path.includes('/mediapipe/')).length;
    await q.getByRole('button', { name: 'Skip for now' }).click();
    const noteOnTrain = await until(() => q.locator('.save-note').textContent(), 10000);
    await screenshot(q, 'save-note-on-train', 'main');
    const st2 = await until(async () => {
      const s = await swStatus(q);
      return s && DEFAULT_POSE.every((u) => s.pose.find((x) => x.url === u)?.saved) ? s : null;
    }, 90000);
    server.setSlow(null);
    const launch = server.requests('installed-first-launch');
    check(
      'installed, nothing is downloaded while the terms show; then the first launch saves the pose model by itself, saying so on the Train tab',
      beforeTerms === 0 && st2 && launch.filter((e) => e.path.includes('/mediapipe/')).length === 3 && /Keep fitee open/.test(noteOnTrain ?? ''),
      `pose requests before the terms were accepted: ${beforeTerms}; ${launch.length} requests, ${mb(bytesIn(server, 'installed-first-launch'))}; note: ${(noteOnTrain ?? 'none').replace(/\s+/g, ' ').trim()}`,
    );
    report.bytes.firstLaunchInstalled = bytesIn(server, 'installed-first-launch');
    const persistCalls = await until(() => q.evaluate(() => window.__persistCalls ?? 0), 10000);
    const persisted = await q.evaluate(() => navigator.storage.persisted());
    check('the installed app asks once for persistent storage after saving the pose files', persistCalls === 1, `asked ${persistCalls ?? 0} time(s); granted: ${persisted}`);
    report.notes.push(`navigator.storage.persisted() after asking in the installed app: ${persisted} (the browser decides)`);
    await go(q, '#/settings');
    const readyText = await until(() => q.locator('li[data-offline="ready"]').textContent(), 10000);
    const installedText = await q.locator('li[data-install="installed"]').textContent().catch(() => '');
    check('Settings says it is installed and ready to use offline, with the size', readyText && installedText?.includes('Installed on this phone'), (readyText ?? '').replace(/\s+/g, ' '));
    await screenshot(q, 'settings-ready-installed');

    // Layout in standalone mode: clear of the status bar and the home indicator.
    const qc = await inst.newCDPSession(q);
    const layout = {};
    for (const [label, top] of [
      ['status bar style default (top inset 0)', 0],
      ['edge to edge (top inset 47)', 47],
    ]) {
      await qc.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, bottom: 34, left: 0, right: 0 } });
      await go(q, '#/');
      await sleep(400);
      const m = await q.evaluate(() => {
        const tabs = document.querySelector('nav.tabs');
        const main = document.querySelector('main');
        const firstTab = tabs.querySelector('a');
        return {
          tabsPadBottom: getComputedStyle(tabs).paddingBottom,
          tabLabelBottom: Math.round(firstTab.getBoundingClientRect().bottom),
          viewport: innerHeight,
          mainPadTop: getComputedStyle(main).paddingTop,
        };
      });
      await go(q, '#/groups');
      await sleep(400);
      m.actionPadBottom = await q.evaluate(() => getComputedStyle(document.querySelector('.action-bar')).paddingBottom);
      await q.screenshot({ path: path.join(SHOTS, `standalone-groups.top${top}.png`) });
      await go(q, '#/');
      await sleep(300);
      await q.screenshot({ path: path.join(SHOTS, `standalone-train.top${top}.png`) });
      layout[label] = m;
      check(
        `standalone layout, ${label}: tab bar and action bar clear the home indicator, header clears the status bar`,
        m.tabsPadBottom === '34px' && m.tabLabelBottom <= m.viewport - 34 && m.actionPadBottom === '48px' && parseFloat(m.mainPadTop) >= Math.max(16, top),
        JSON.stringify(m),
      );
    }
    await qc.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0, left: 0, right: 0 } });
    await qc.detach();
    report.layout = layout;

    // ── 5b. Offline technique check in the installed app ───────────────────
    server.setPhase('installed-offline');
    await inst.setOffline(true);
    server.setDown(true);
    await go(q, '#/analyze/back-squat');
    await q.reload();
    let lastLaunch = Date.now();
    const startBtn = q.getByRole('button', { name: 'Start camera' });
    const modelReady = await until(() => startBtn.isEnabled(), 90000, 500);
    check('offline, a technique check loads the pose model from the cache', modelReady);
    await startBtn.click();
    const live = await until(
      () =>
        q.evaluate(() => {
          const v = document.querySelector('.stage video');
          const c = document.querySelector('.stage canvas');
          return v && c && v.readyState >= 2 && c.width > 0 && c.width === v.videoWidth ? `${c.width}x${c.height}` : null;
        }),
      30000,
    );
    const badge = await q.locator('.stage-badge').textContent().catch(() => '');
    check('offline, the technique check’s camera starts and the model runs on its frames (fake camera)', live, `${live} · "${badge}"`);
    await q.screenshot({ path: path.join(SHOTS, 'analyze-offline-live.png') });
    await q.getByRole('button', { name: 'Cancel' }).click();
    await go(q, '#/camera');
    await q.getByRole('button', { name: 'Start camera' }).click();
    const readout = (variant) =>
      until(async () => {
        const t = await q.locator('pre.debug').textContent();
        return new RegExp(`${variant} model ·`).test(t ?? '') ? t.split('\n').slice(0, 2).join(' · ') : null;
      }, 30000);
    const debug = await readout('full');
    check('offline, the camera test tracks with the saved model', debug, debug ?? '');
    // The Lite model isn't saved: choosing it says so while the camera runs, and Full can be chosen again.
    const picker = q.locator('label.inline select');
    await picker.selectOption('lite');
    const liteNote = await until(() => q.locator('p.note').textContent(), 30000);
    const pickerFree = await until(() => picker.isEnabled(), 5000);
    await q.screenshot({ path: path.join(SHOTS, 'camera-offline-lite.png') });
    await picker.selectOption('full');
    const back = await readout('full');
    check(
      'offline, the camera test’s Lite model (not saved) says to choose Full, and Full tracks again',
      /Lite model isn’t saved on this phone, but the Full one is/.test(liteNote ?? '') && pickerFree && back,
      `${(liteNote ?? 'no note').trim()} · then: ${back ?? 'no tracking'}`,
    );
    await q.getByRole('button', { name: 'Stop' }).click();
    offlineOnly(server, 'installed-offline');

    // ── 7. Update B: offered, "Update now", old caches gone, nothing unchanged re-downloaded ──
    server.setDown(false);
    await inst.setOffline(false);
    const before = await cacheSummary(q);
    const versionA = (await swStatus(q))?.version;
    server.setPhase('update-b-wait');
    await go(q, '#/settings');
    // The browser's own update check can run as soon as the connection is
    // back (it couldn't while offline). Made explicit here, so it always
    // happens before B is deployed: then it finds nothing new.
    await q.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update())).catch(() => {});
    // Past the launch window before B is deployed, so the update waits to be
    // offered. (Deploying it first let that check find B inside the window,
    // where the app rightly applies it by itself.)
    await sleep(Math.max(0, LAUNCH_WINDOW_MS + 1000 - (Date.now() - lastLaunch)));
    server.setRoot(builds.b);
    server.setPhase('update-b');
    await q.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
    const offered = await until(() => q.locator('li[data-update="ready"]').isVisible(), 60000);
    check('a new version installs in the background and is offered in Settings', offered && (await marker(q)) === 'a', `running ${await marker(q)}`);
    await screenshot(q, 'settings-update-ready');
    const updateB = server.requests('update-b');
    check(
      'the update downloads only sw.js and the changed file (no unchanged app files, no pose files)',
      updateB.every((e) => e.path.endsWith('/sw.js') || e.path.endsWith('/index.html')) && updateB.some((e) => e.path.endsWith('/index.html')),
      `${listOf(server, 'update-b').join(', ')}; ${mb(bytesIn(server, 'update-b'))}`,
    );
    report.bytes.updateUnchangedPose = bytesIn(server, 'update-b');
    // A missing row is a failed check, not a crash: the later scenarios still run.
    await Promise.all([q.waitForEvent('load', { timeout: 30000 }), q.locator('li[data-update="ready"] button').click({ timeout: 10000 })]).catch((err) =>
      report.notes.push(`“Update now” couldn’t be pressed: ${err.message.split('\n')[0]}`),
    );
    const mB = await marker(q);
    const after = await cacheSummary(q);
    check('“Update now” applies it', mB === 'b', `now running ${mB}`);
    const versionB = (await swStatus(q))?.version;
    check(
      'the update deletes the old app cache and keeps the pose cache with its files',
      appCacheNames(after).length === 1 &&
        !appCacheNames(before).some((n) => n in after) &&
        JSON.stringify(poseIn(after).sort()) === JSON.stringify(DEFAULT_POSE) &&
        Object.keys(after).filter((n) => n.startsWith('fitee-pose-')).every((n) => n in before) &&
        versionB !== versionA,
      `caches before: ${Object.keys(before).join(', ')}; after: ${Object.keys(after).join(', ')}`,
    );

    // ── Update C: never reloads during a technique check; applies at the next cold open ──
    server.setRoot(builds.c);
    server.setPhase('update-c');
    await go(q, '#/analyze/back-squat');
    await q.reload();
    let loads = 0;
    q.on('load', () => loads++);
    const waiting = await until(() => q.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.waiting)), 60000);
    await sleep(3000);
    check('a new version found during a technique check waits: no reload', waiting && loads === 0 && (await marker(q)) === 'b', `waiting ${!!waiting}, reloads ${loads}`);
    await q.close();
    await sleep(500);
    q = await inst.newPage();
    watchErrors(q, 'installed');
    await q.goto(BASE);
    const mC = await marker(q);
    check('it applies the next time the app is opened from cold', mC === 'c', `now running ${mC}`);
    const afterC = await cacheSummary(q);
    check('…and the previous version’s app cache is deleted', appCacheNames(afterC).length === 1 && !appCacheNames(after).some((n) => n in afterC), Object.keys(afterC).join(', '));

    // ── Update D: applies by itself right after the app opens, on a safe screen ──
    await q.close();
    server.setRoot(builds.d);
    server.setPhase('update-d');
    q = await inst.newPage();
    watchErrors(q, 'installed');
    await q.goto(`${BASE}#/log`);
    const mD = await until(async () => ((await marker(q)) === 'd' ? 'd' : null), 30000, 500);
    check('a new version found just after opening, on the Log tab, applies by itself', mD === 'd', `now running ${mD ?? (await marker(q))}`);

    // ── Update E fails half-way, then installs at a later check ──
    // A file of E is missing on the server (as if mid-deploy): the install
    // fails, D keeps working (offline too) and nothing is offered. A later
    // update check, with the file there, installs E and downloads only what
    // the failed attempt hadn't saved.
    server.setRoot(builds.e);
    server.setFail((e) => e.path === '/Claude/index.html' && e.query.startsWith('?v='));
    server.setPhase('update-e-fails');
    const tryUpdate = () =>
      q.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg.update();
        const w = reg.installing;
        if (!w) return reg.waiting ? 'installed' : 'no update found';
        return new Promise((resolve) => {
          const done = () => ['redundant', 'installed', 'activating', 'activated'].includes(w.state) && resolve(w.state);
          w.addEventListener('statechange', done);
          done();
        });
      });
    const failed = await tryUpdate().catch((err) => `error: ${err.message}`);
    await go(q, '#/settings');
    await sleep(500);
    const offeredAfterFail = await q.locator('li[data-update="ready"]').count();
    const failRequests = listOf(server, 'update-e-fails');
    server.setPhase('update-e-offline');
    await inst.setOffline(true);
    server.setDown(true);
    await q.reload();
    const stillWorks = await until(() => q.locator('nav.tabs').isVisible(), 15000);
    const mFail = await marker(q);
    check(
      'an update that fails half-way leaves the current version working, offline too, and offers nothing',
      failed === 'redundant' && offeredAfterFail === 0 && stillWorks && mFail === 'd',
      `install ${failed}; requests ${failRequests.join(', ')}; offline afterwards: running ${mFail}`,
    );
    server.setDown(false);
    await inst.setOffline(false);
    server.setFail(null);
    server.setPhase('update-e-retry');
    await go(q, '#/settings');
    // The page may apply it by itself (just reopened, on a safe screen) and reload mid-evaluate.
    const retried = await tryUpdate().catch(() => 'installed (the page reloaded into it)');
    const mE = await until(
      async () => {
        if ((await marker(q)) === 'e') return 'e';
        const button = q.locator('li[data-update="ready"] button');
        if ((await button.isVisible()) && (await button.isEnabled())) await button.click({ timeout: 2000 });
        return null;
      },
      45000,
      500,
    );
    const retry = server.requests('update-e-retry');
    check(
      '…and a later update check installs it, downloading only what the failed attempt hadn’t saved',
      mE === 'e' && retry.every((e) => e.path.endsWith('/sw.js') || e.path.endsWith('/index.html')),
      `install ${retried}; ${listOf(server, 'update-e-retry').join(', ')}; now running ${mE ?? (await marker(q))}`,
    );
    await inst.close();

    // ── Update P changes the lite model; the pose files saved while it waits stay saved ──
    // Each pose file has its own cache, named by its hash: files saved by the
    // running version while P waits are P's files too (only the lite model changed).
    server.setRoot(builds.e);
    server.setPhase('update-p-first-visit');
    const pc = await browser.newContext(PHONE);
    await pc.grantPermissions(['camera'], { origin: ORIGIN });
    track(pc, 'pose-change');
    let r = await pc.newPage();
    watchErrors(r, 'pose-change');
    await r.goto(BASE);
    const rOpened = Date.now();
    await r.getByRole('button', { name: 'Skip for now' }).click();
    await until(async () => {
      const s = await swStatus(r);
      return s && s.app.saved === s.app.files;
    }, 30000);
    await go(r, '#/settings');
    await sleep(Math.max(0, LAUNCH_WINDOW_MS + 1000 - (Date.now() - rOpened)));
    server.setRoot(builds.p);
    server.setPhase('update-p');
    await r.evaluate(() => navigator.serviceWorker.getRegistration().then((reg) => reg?.update()));
    const pWaits = await until(() => r.locator('li[data-update="ready"]').isVisible(), 60000);
    await r.locator('li[data-offline="app-only"] button').click();
    const pSaved = await until(() => r.locator('li[data-offline="ready"]').isVisible(), 90000);
    await r.close();
    await sleep(500);
    r = await pc.newPage();
    watchErrors(r, 'pose-change');
    await r.goto(`${BASE}#/settings`);
    const mP = await marker(r);
    server.setPhase('update-p-offline');
    await pc.setOffline(true);
    server.setDown(true);
    const pReady = await until(() => r.locator('li[data-offline="ready"]').isVisible(), 15000);
    await go(r, '#/analyze/back-squat');
    const pCheck = await until(() => r.getByRole('button', { name: 'Start camera' }).isEnabled(), 60000, 500);
    server.setDown(false);
    check(
      'pose files saved while an update with a new lite model waits are still saved once it applies (offline technique check)',
      pWaits && pSaved && mP === 'p' && pReady && pCheck,
      `offered ${!!pWaits}; saved while it waited ${!!pSaved}; now running ${mP}; offline: Settings ready ${!!pReady}, check ready ${!!pCheck}; caches ${Object.keys(await cacheSummary(r)).join(', ')}`,
    );
    await pc.close();

    // ── 8a. A first install that fails says so, and Try again saves the app ──
    server.setRoot(builds.e);
    server.setPhase('first-install-fails');
    server.setFail((e) => e.path === '/Claude/icon-512.png' && e.query.startsWith('?v='));
    const fc = await browser.newContext(PHONE);
    track(fc, 'first-install-fails');
    const f = await fc.newPage();
    watchErrors(f, 'first-install-fails');
    await f.goto(BASE);
    await f.getByRole('button', { name: 'Skip for now' }).click();
    await go(f, '#/settings');
    const failedRow = await until(() => f.locator('li[data-offline="app-failed"]').isVisible(), 30000);
    await screenshot(f, 'settings-app-failed');
    server.setFail(null);
    server.setPhase('first-install-retry');
    await f.locator('li[data-offline="app-failed"] button').click().catch(() => {});
    const recovered = await until(() => f.locator('li[data-offline="app-only"]').isVisible(), 30000);
    const reinstalled = listOf(server, 'first-install-retry');
    check(
      'a first install that fails says so in Settings (not “Saving the app…” for good), and Try again saves the app',
      failedRow && recovered && reinstalled.every((x) => x === 'sw.js' || x.startsWith('icon-512.png?v=')),
      `failed: ${!!failedRow}; after Try again: ${!!recovered}; requests ${reinstalled.join(', ')}`,
    );
    await fc.close();

    // ── 8b. No room on the phone ──────────────────────────────────────────
    // A small quota (CDP) makes Cache Storage refuse the pose files. The
    // browser's estimate doesn't see this override, so it's the worker's
    // refused save that has to tell: Settings says there's no room (not
    // "check your connection"), and the next launch doesn't download again.
    server.setPhase('no-room-launch-1');
    const nc = await browser.newContext(PHONE);
    await nc.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }));
    track(nc, 'no-room');
    const n = await nc.newPage();
    watchErrors(n, 'no-room');
    const ncdp = await nc.newCDPSession(n);
    await ncdp.send('Storage.overrideQuotaForOrigin', { origin: ORIGIN, quotaSize: 8_000_000 });
    await n.goto(BASE);
    await n.getByRole('button', { name: 'Skip for now' }).click();
    await go(n, '#/settings');
    const noRoomText = await until(async () => {
      const t = (await n.locator('li[data-offline="app-only"]').textContent().catch(() => '')) ?? '';
      return /isn’t room/.test(t) ? t.replace(/\s+/g, ' ').trim() : null;
    }, 90000);
    await screenshot(n, 'settings-no-room');
    server.setPhase('no-room-launch-2');
    await n.reload();
    await sleep(6000);
    await go(n, '#/settings');
    const secondText = await until(async () => {
      const t = (await n.locator('li[data-offline="app-only"]').textContent().catch(() => '')) ?? '';
      return /isn’t room/.test(t) ? t : null;
    }, 10000);
    const secondPose = server.requests('no-room-launch-2').filter((e) => e.path.includes('/mediapipe/'));
    check(
      'with no room for the pose model, Settings says so, and the next launch doesn’t download it again',
      noRoomText && secondText && secondPose.length === 0,
      `${noRoomText ?? 'no message'}; launch 1 ${mb(bytesIn(server, 'no-room-launch-1'))}, launch 2 pose requests: ${secondPose.length}`,
    );
    await ncdp.detach().catch(() => {});
    await nc.close();

    // ── 9. Nothing left the device ────────────────────────────────────────
    const outside = requests.filter((r) => !r.url.startsWith(`${ORIGIN}/`) && !/^(data|blob):/.test(r.url));
    check(
      'no request left localhost at any point (pages and the service worker)',
      outside.length === 0,
      `${requests.length} requests seen (${requests.filter((r) => r.worker).length} from the service worker); outside: ${outside.map((r) => r.url).join(', ') || 'none'}`,
    );
    check('no uncaught errors in the pages', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
  } finally {
    await browser.close().catch(() => {});
    await server.close();
  }

  // Roughly what GitHub Pages would send: it gzips text (html, js, css, json, svg, txt).
  const gz = new Map();
  const gzipOf = (e) => {
    if (!e.bytes || !/\.(html|js|css|json|webmanifest|svg|txt)$/.test(e.path)) return e.bytes;
    const key = e.path;
    if (!gz.has(key)) {
      const rel = e.path.replace('/Claude/', '') || 'index.html';
      const file = path.join(builds.a, rel);
      gz.set(key, fs.existsSync(file) ? zlib.gzipSync(fs.readFileSync(file)).length : e.bytes);
    }
    return gz.get(key);
  };
  report.requestsByPhase = Object.fromEntries(
    [...new Set(server.log.map((e) => e.phase))].map((ph) => [
      ph,
      { requests: server.requests(ph).length, bytes: bytesIn(server, ph), gzipBytes: server.requests(ph).reduce((n, e) => n + gzipOf(e), 0), files: listOf(server, ph) },
    ]),
  );
  const over = (ph) => report.requestsByPhase[ph]?.gzipBytes ?? 0;
  fs.writeFileSync(path.join(WORK, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\nBytes downloaded (as served; about, with GitHub Pages gzipping text):');
  console.log(`  first visit in a tab:            ${mb(report.bytes.firstVisitTab ?? 0)}  (about ${mb(over('tab-first-visit'))})`);
  console.log(`  first launch, installed:         ${mb(report.bytes.firstLaunchInstalled ?? 0)}  (about ${mb(over('installed-first-launch'))})`);
  console.log(`  "Save for offline use":          ${mb(report.bytes.saveButton ?? 0)}  (about ${mb(over('tab-save-button'))})`);
  console.log(`  update (pose files unchanged):   ${mb(report.bytes.updateUnchangedPose ?? 0)}  (about ${mb(over('update-b'))})`);
  for (const n of report.notes) console.log(`Note: ${n}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Report and screenshots in ${WORK}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
