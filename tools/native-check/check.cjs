#!/usr/bin/env node
// End-to-end check of the iPhone app's web build (dist-native/) in Chromium (Playwright), with a stand-in for the
// native side. A dev tool, not part of `npm test` (which stays browser-free); CI's simulator check
// (tools/ios-check/) is what runs the real app.
//
//   npm run native:check -- --work DIR --port 4460 [--keep-build yes]
//
// It builds the app's copy (npm run build:native, unless --keep-build yes and dist-native/ exists), serves it at
// http://127.0.0.1:<port>/ (server.cjs: the app's files as Capacitor's scheme handler serves them, Range requests
// answered 206, a saved set's files at /__files__/, and /__blank.html, an empty page of the same origin) and drives
// Chromium, cut off from every site but this machine (../offline-check/local-only.cjs, proved first), with a fake
// camera. Each launch gets stub-bridge.js before the page's own code: window.Capacitor as the app's bridge sets it
// up, FiteeNative answered in Node by an instance of tests/fixtures/fakeNative.ts (the native contract,
// src/native/bridge.ts, in memory; kept across reloads), and the console a Debug build prints, which the check reads
// as CI reads the simulator's (markers through readMarker(), "[error]" lines, "fitee:dropped" lines). Then:
//   1. the build: index.html with the native entry and the native CSP, no home-screen tags; dist-native/ without a
//      service worker, landing page, web manifest or no-SIMD runtime, and no file with the web's "Video is never
//      uploaded" or "It’s never uploaded";
//   2. first launch with nothing stored: Welcome; fitee:ready with the page's own origin for the pose model too,
//      the model fetched (200), the runtime as application/wasm, the outside probe blocked by src/privacy.ts, SIMD;
//      the status strip over the safe area's top (an iPhone's, emulated) in the page colour;
//   3. "Skip for now": the app's own terms version; the Train tab's privacy line (the app's); within 2.5 s a copy
//      whose rev is the one localStorage remembers; revs strictly increase; hiding the page, or the page going
//      (pagehide), with a change waiting writes at once, and a change made just before a reload is in the copy
//      after the next launch;
//   4. restore: localStorage cleared (no write follows), reload: the Train tab, "Your data was restored…", keys back;
//   5. a newer copy replaces localStorage (Pounds in Settings), an older one loses and a write with the next rev
//      follows, an equal rev with other data is written again, an equal one with the same data isn't;
//   6. an unreadable current copy with a good previous one and nothing stored: restored from it, dropped first;
//   7. the copy can't be read, or there's no bridge: the start-error screen, no app; Try again starts it;
//   8. a copy in a newer format (version 2): its toast, and no copy written that session;
//   9. Settings: no "Install and offline", the iPhone's saved-sets, your-data and privacy texts, footer "fitee 1.0.0 (1)",
//      five taps on it go nowhere; #/dev/* and ?calibrate don't open the developer pages; the profile (in Settings and
//      on first launch) kept on this iPhone and in its backups;
//  10. Back up my data: Save to Files (exportFile) with fitee-backup-<today>.json, whose text Restore from a backup
//      takes back; the failure toast;
//  11. a copy that can't be written: one toast per session, later writes go on;
//  12. Delete all my data: the confirm's text, deleteAllData called while the page still had its keys, then the
//      reload to Welcome with "All data deleted", nothing left (localStorage, the fake's files), no copy written
//      after it; cancelled: nothing deleted; failed before the web view's stores: its toast, no marker, the copy
//      written again at once and the writer still on, and the next launch deleting nothing; failed at the end (the
//      marker left): the page reloads and that launch finishes it; stopped part way (the marker, AppInfo.deleting):
//      the next launch deletes again before it reads the copy, then Welcome;
//  13. status bar and Appearance: a launch on a dark phone starts with light text; dark text on a light phone,
//      light text on a dark one, a pinned Appearance wins over the phone's, setAppearance follows it, and a pinned
//      theme is right from the first style set;
//  14. a saved set: the <video> plays from the fake's videoUrl (loadedmetadata, Range requests), the note under it
//      says fitee never uploads it, Delete video removes every extension and clears the index's video, Delete this
//      saved set removes the replay and the entry, and its page then says why it's gone; the launch's reconcile: an
//      unreadable index rebuilt from the replays and set aside, no file that isn't newer than it deleted, and on a
//      "restored phone" a missing video cleared from its entry, a leftover part and an orphan replay removed;
//  15. a technique check: the camera keeps the screen on (setKeepAwake) and leaving lets it sleep; a picked video
//      checked to its results, then a video the app can't read: the temporary copies deleted after each
//      (clearPickedFiles); the app's privacy line; the picker closing without a file (its cancel event) and a check
//      left while its video is analysed (the analysis stops, its hidden <video> goes): deleted too; the camera test
//      runs the full pose model under the native CSP;
//  16. the self-test (AppInfo.selfTest): fitee:selftest ok, every step passing but the bridge gate's, which only
//      the app can test and which is reported as skipped here; nothing of the user's touched; then once more with
//      an inert webkit.messageHandlers.bridge, so the gate step's own code runs against the stub's imitation of
//      the gate: every probe unanswered, one fitee:dropped line each, the prompt answered with null, no window, the
//      navigation cancelled (no request sent), FiteeNative's upload still running after;
//  17. a Release build (AppInfo.debug false): nothing printed, the Debug-only chunks never loaded;
//  18. Terms and Privacy: section 7 lists every licence and opens each to its full text; section 6 names each
//      check's skeleton replay; the picked video's temporary copy; no browser, home screen, offline copy, service
//      worker or GitHub wording;
//  and in every launch: no uncaught error, fitee:uncaught or fitee:csp line, no "[error]" line or browser error
//  (MediaPipe's own INFO, I, W and E lines only where the pose model loads; expected rejections only where a
//  failure is injected), no call the bridge gate would drop, no file the server didn't have, and no request but
//  to the app's own origin, blob: and data: (the self-test's CSP probe aside, which the CSP blocks).
// It prints PASS/FAIL lines, writes report.json, markers.txt (the fitee:ready and fitee:selftest lines as the
// console showed them: the light, dark and self-test launches' ready markers, then the self-test's two markers, its
// gate step skipped and then run against the stand-in) and screenshots to DIR/shots/ (390 x 844, device scale 2,
// light and dark, with an iPhone's safe areas; *-full: the whole page, on a phone as tall as the page), and exits 1
// if any check fails. Needs Playwright with Chromium (the pre-installed one; it never installs browsers).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./server.cjs');
const { launchLocalOnly, proveLocalOnly } = require('../offline-check/local-only.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const PORT = Number(opt('port', 4460));
const WORK = path.resolve(opt('work', '') || fs.mkdtempSync(path.join(os.tmpdir(), 'fitee-native-check-')));
const KEEP_BUILD = opt('keep-build', '') === 'yes';
const DIST = path.join(ROOT, 'dist-native');
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/`;
const SHOTS = path.join(WORK, 'shots');
const MEDIA = path.join(WORK, 'media');
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
/** The safe area's top on an iPhone with the Dynamic Island, in portrait (the status bar the page runs under). */
const SAFE_TOP = 59;
const STUB_SOURCE = fs.readFileSync(path.join(__dirname, 'stub-bridge.js'), 'utf8');
/** MediaPipe's own stderr, which Emscripten writes with console.error: "INFO: …" and glog lines ("W1127 …", "E0000 …"). */
const MEDIAPIPE = /^(INFO:|[IWE]\d{4}(\s|$))/;

const results = [];
const report = { work: WORK, checks: results, launches: [], markers: {}, notes: [] };
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const note = (text) => {
  report.notes.push(text);
  console.log(`NOTE  ${text}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10_000, every = 100) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return undefined;
    await sleep(every);
  }
}
const short = (v, n = 300) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n)}…` : s;
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** `export const NAME = '…'` in a source file: the check follows the app's own texts and keys. */
function sourceConst(rel, name) {
  const m = new RegExp(`export const ${name}\\s*=\\s*\\n?\\s*'([^']*)'`).exec(read(rel));
  if (!m) throw new Error(`native-check: no ${name} in ${rel}`);
  return m[1];
}

// ---- The app's contract and texts --------------------------------------------------------------------------------

let C; // src/native/bridge.ts
let Fake; // tests/fixtures/fakeNative.ts
let Files; // src/native/setFiles.ts
let NATIVE_CSP;
const T = {};

async function loadContract() {
  C = await import(path.join(ROOT, 'src/native/bridge.ts'));
  Fake = await import(path.join(ROOT, 'tests/fixtures/fakeNative.ts'));
  Files = await import(path.join(ROOT, 'src/native/setFiles.ts'));
  ({ NATIVE_CSP } = await import(path.join(ROOT, 'scripts/native-build.ts')));
  T.termsVersion = sourceConst('src/profile.ts', 'NATIVE_TERMS_VERSION');
  T.revKey = sourceConst('src/native/snapshot.ts', 'REV_KEY');
  T.restored = sourceConst('src/native/snapshot.ts', 'RESTORED_TOAST');
  T.newer = sourceConst('src/native/snapshot.ts', 'NEWER_TOAST');
  T.copyFailed = sourceConst('src/native/snapshot.ts', 'COPY_FAILED_TOAST');
  T.deleteConfirm = sourceConst('src/native/data.ts', 'DELETE_CONFIRM');
  T.deleteFailed = sourceConst('src/native/data.ts', 'DELETE_FAILED_TOAST');
  T.deleted = sourceConst('src/native/data.ts', 'DELETED_TOAST');
  T.exportFailed = sourceConst('src/native/download.ts', 'EXPORT_FAILED_TOAST');
  T.updated = sourceConst('src/native/screens/Legal.tsx', 'NATIVE_UPDATED');
  // The app's privacy line (the native branch in place of PRIVACY on the technique check and the Train tab, one wording;
  // Settings says the same), and its profile note.
  const privacyLines = ['src/screens/Analyze.tsx', 'src/screens/Home.tsx'].map((f) => /__NATIVE__ \? '([^']+)' : PRIVACY/.exec(read(f))?.[1]);
  if (!privacyLines[0] || privacyLines.some((line) => line !== privacyLines[0])) throw new Error('native-check: src/screens/Analyze.tsx and Home.tsx need the same native privacy line');
  T.nativePrivacy = privacyLines[0];
  T.profileNote = 'Your profile stays on this iPhone and in its own backups (iCloud or a computer); fitee sends nothing anywhere.';
  T.licences = [...read('src/native/screens/Legal.tsx').matchAll(/\{ file: '([^']+)', name: '([^']+)', licence: '([^']+)' \}/g)].map((m) => ({ file: m[1], name: m[2], licence: m[3] }));
}

/**
 * What stub-bridge.js exports for each plugin (JSExport: the plugins Capacitor registers, and the app's own); `gate`:
 * an inert webkit.messageHandlers.bridge, so the self-test's gate step runs against the stub's imitation of the gate.
 */
const stubConfig = (debug, gate = false) => ({
  debug,
  gate,
  plugins: {
    FiteeNative: { promise: [...Fake.FAKE_METHODS] },
    Console: { none: ['log'] },
    SystemBars: { promise: ['setStyle', 'setAnimation', 'show', 'hide'] },
    CapacitorHttp: { promise: ['request', 'get', 'post', 'put', 'patch', 'delete'] },
    CapacitorCookies: { promise: ['getCookies', 'setCookie', 'deleteCookie', 'clearCookies', 'clearAllCookies'] },
    WebView: { promise: ['setServerAssetPath', 'setServerBasePath', 'getServerBasePath', 'persistServerBasePath'] },
  },
});

/** A copy of the log as src/native/snapshot.ts writes it. */
const copyText = (data, rev, extra = {}) => JSON.stringify({ app: 'fitee', version: 1, exportedAt: new Date().toISOString(), data, rev, ...extra });
const ACCEPTED = () => ({ termsAcceptedAt: new Date(Date.now() - 86_400_000).toISOString(), termsVersion: T.termsVersion });

// ---- Launches ----------------------------------------------------------------------------------------------------

let browser;
let server;
let currentFake;

/**
 * A launch: a fresh browser context (a phone), the stub bridge over `fake`, and everything it prints and asks for,
 * kept for the common checks. `allow`: what this launch may show besides a clean console: mediapipe (MediaPipe's
 * own stderr lines), codes (rejections injected on purpose, by code), cspProbe (the self-test's probe image),
 * dropped (the "<pluginId>.<method>" calls the gate may drop, each once: the self-test's gate probes).
 */
async function launch(name, { fake = new Fake.FakeNative({ fileBase: ORIGIN }), colorScheme = 'light', debug = true, stub = true, gate = false, allow = {} } = {}) {
  server.setPhase(name);
  currentFake = fake;
  const run = { name, native: [], console: [], logEntries: [], pageErrors: [], requests: [], failed: [], allow, fake };
  report.launches.push(run);
  const ctx = await browser.newContext({ ...PHONE, colorScheme });
  ctx.on('request', (r) => run.requests.push({ url: r.url(), method: r.method() }));
  ctx.on('requestfailed', (r) => run.failed.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
  if (stub) {
    await ctx.exposeBinding('__fiteeNative', async (_source, method, options, userKeys) => {
      try {
        return { ok: true, value: await fake.call(method, options, userKeys) };
      } catch (err) {
        // A rejection's code doesn't survive the binding as an Error: sent as data, and the stub rebuilds it.
        return { ok: false, message: String(err?.message ?? err), code: err?.code };
      }
    });
    await ctx.exposeBinding('__fiteeConsole', (_source, line) => void run.native.push(line));
    await ctx.addInitScript({ content: `var FITEE_STUB = ${JSON.stringify(stubConfig(debug, gate))};\n${STUB_SOURCE}` });
  }
  const page = await ctx.newPage();
  page.on('console', (m) => run.console.push({ type: m.type(), text: m.text().slice(0, 2000) }));
  page.on('pageerror', (e) => run.pageErrors.push(String(e.message ?? e)));
  // Messages from the browser itself (a file that didn't load, a CSP violation): console.* calls arrive on the
  // stub's console instead, as on the phone.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Log.enable');
  cdp.on('Log.entryAdded', ({ entry }) => run.logEntries.push({ level: entry.level, source: entry.source, text: entry.text, url: entry.url ?? '' }));
  // An iPhone's safe areas (portrait, with the Dynamic Island): the web view runs under the status bar
  // (contentInset "never"), so the page pads with env(safe-area-inset-*) and the status strip fills the top.
  run.safeTop = await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: SAFE_TOP, topMax: SAFE_TOP, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 } }).then(
    () => SAFE_TOP,
    () => {
      note('this Chromium can’t emulate safe-area insets: screenshots without them');
      return 0;
    },
  );
  return { ctx, page, run, fake };
}

/** The message of a native console line "⚡️  [level] - message", or undefined for another kind of line. */
function consoleCall(line) {
  const m = /\[(debug|error|info|log|trace|warn)\] - /.exec(line);
  return m ? { level: m[1], text: line.slice(m.index + m[0].length) } : undefined;
}

const isOwn = (url) => url.startsWith(BASE) || url.startsWith('blob:') || url.startsWith('data:');
const CSP_PROBE = () => `${C.PROBE_ORIGIN}/fitee-csp-probe.png`;

/** The checks every launch must pass (see the header), after its context closed. */
function commonChecks(run) {
  const problems = [];
  for (const e of run.pageErrors) problems.push(`uncaught: ${e}`);
  for (const line of run.native) {
    if (line.includes(`${C.MARKERS.uncaught} `)) problems.push(line);
    if (line.includes(`${C.MARKERS.csp} `)) problems.push(line);
    if (line.includes('STARTUP JS ERROR')) problems.push(line);
    if (line.includes(`${C.MARKERS.dropped} `)) {
      // Only the calls this launch expects the gate to drop (the self-test's probes), each once.
      const call = line.startsWith(`${C.MARKERS.dropped} message `) ? line.slice(`${C.MARKERS.dropped} message `.length) : undefined;
      const once = run.native.filter((l) => l === line).length === 1;
      if (!call || !(run.allow.dropped ?? []).includes(call) || !once) problems.push(`the bridge gate would drop: ${line}`);
    }
    const call = consoleCall(line);
    if (call && call.level === 'error') {
      if (run.allow.mediapipe && MEDIAPIPE.test(call.text)) continue;
      let code;
      try {
        code = JSON.parse(call.text)?.code;
      } catch {
        code = undefined;
      }
      if (code && (run.allow.codes ?? []).includes(code)) continue;
      problems.push(short(line, 400));
    }
  }
  for (const e of run.logEntries) {
    if (e.level !== 'error') continue;
    if (run.allow.cspProbe && e.text.includes(CSP_PROBE())) continue;
    problems.push(`browser ${e.source}: ${short(e.text, 300)}`);
  }
  for (const r of run.requests) {
    if (isOwn(r.url)) continue;
    // Chromium reports the blocked image as a request that failed with "csp" (net::ERR_BLOCKED_BY_CSP): never sent.
    if (run.allow.cspProbe && r.url === CSP_PROBE() && run.failed.some((f) => f.url === r.url && /^csp$|BLOCKED_BY_CSP/i.test(f.error))) continue;
    problems.push(`a request to ${r.url}`);
  }
  for (const e of server.requests(run.name)) if (e.status >= 400) problems.push(`${e.status} for ${e.path}`);
  check(
    `${run.name}: no uncaught error, CSP report, [error] line, browser error, call the gate would drop, missing file or request off the app's origin`,
    problems.length === 0,
    problems.length ? problems.slice(0, 6).join(' | ') : `${run.native.length} console lines, ${run.requests.length} requests`,
  );
}

async function finish(l) {
  await l.ctx.close().catch(() => {});
  commonChecks(l.run);
}

// ---- Page helpers ------------------------------------------------------------------------------------------------

/** The native console lines with a marker. */
const markerLines = (run, marker) => run.native.filter((line) => line.includes(`${marker} `));
/** Waits for the n-th fitee:ready marker of a launch (one per page load in a Debug build) and parses it. */
async function ready(run, n = 1, ms = 30_000) {
  const line = await until(() => markerLines(run, C.MARKERS.ready)[n - 1], ms);
  return line ? { line, value: C.readMarker(line, C.MARKERS.ready) } : undefined;
}
/** Goes to the app (or a route of it) as a new page load and waits for its ready marker. */
async function open(l, route = '') {
  const before = markerLines(l.run, C.MARKERS.ready).length;
  await l.page.goto(BASE + route);
  return ready(l.run, before + 1);
}
async function reload(l) {
  const before = markerLines(l.run, C.MARKERS.ready).length;
  await l.page.reload();
  return ready(l.run, before + 1);
}
/** Writes localStorage on /__blank.html (where no copy writer runs), so the next launch starts with it. */
async function seedLocal(l, items) {
  await l.page.goto(`${BASE}__blank.html`);
  await l.page.evaluate((items) => {
    localStorage.clear();
    sessionStorage.clear();
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
  }, items);
}
const local = (page) =>
  page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) out[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    return out;
  });
const visible = (page, text, ms = 5000) =>
  page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: ms })
    .then(
      () => true,
      () => false,
    );
const heading = (page, name, ms = 10_000) =>
  page
    .getByRole('heading', { name })
    .first()
    .waitFor({ state: 'visible', timeout: ms })
    .then(
      () => true,
      () => false,
    );
/** Counts each toast that appears with a text (Preact makes a new element per message). */
const watchToasts = (page) =>
  page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && n.matches('.toast')) window.__toasts.push(n.textContent);
    }).observe(document.body, { childList: true, subtree: true });
  });
const toasts = (page) => page.evaluate(() => window.__toasts ?? []);
/** Waits for the copy writer's next write after `count` writes so far. */
const nextWrite = (fake, count, ms = 4000) => until(() => fake.callsTo('writeSnapshot')[count], ms, 50);
const writes = (fake) => fake.callsTo('writeSnapshot');
const lastStatusBar = (run) =>
  run.native
    .map((line) => (line.startsWith(`${C.MARKERS.statusbar} `) ? line.slice(C.MARKERS.statusbar.length + 1) : undefined))
    .filter(Boolean)
    .at(-1);
const appearances = (fake) => fake.callsTo('setAppearance').map((c) => c.args.style);

async function settled(page) {
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await sleep(350);
}
/**
 * Phone-sized screenshots, light and dark (the page follows the phone unless Appearance is pinned), as the page is
 * scrolled now. `full`: the whole page, on a phone as tall as the page (Playwright's fullPage would draw the fixed
 * status strip and tab bar where the viewport happens to be scrolled, over the content). The pointer is moved off
 * the page's controls first: a phone has none, and a :hover left by the last click isn't what it shows.
 */
async function shoot(page, name, { full = false } = {}) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(1, 1);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await settled(page);
    const file = path.join(SHOTS, `${name}.${scheme}.png`);
    if (!full) {
      await page.screenshot({ path: file });
      continue;
    }
    const y = await page.evaluate(() => scrollY);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: PHONE.viewport.width, height: Math.max(height, PHONE.viewport.height) });
    await settled(page);
    await page.screenshot({ path: file });
    await page.setViewportSize(PHONE.viewport);
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await settled(page);
}
/**
 * Scrolls so the element matching `selector` (the first whose text is `text`, if given) starts `gap` px below the
 * status strip (a negative gap puts it under the strip).
 */
const scrollToIt = (page, selector, { text, gap = 16 } = {}) =>
  page.evaluate(
    ([s, t, g]) => {
      const el = [...document.querySelectorAll(s)].find((e) => t === undefined || e.textContent.trim() === t);
      if (!el) throw new Error(`native-check: nothing matches ${s}${t === undefined ? '' : ` "${t}"`}`);
      const inset = parseFloat(getComputedStyle(document.querySelector('.status-strip')).height) || 0;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - inset - g, behavior: 'instant' });
    },
    [selector, text, gap],
  );
const skip = async (page) => {
  await page.getByRole('button', { name: 'Skip for now' }).click();
  return heading(page, 'Today');
};

// ---- Videos and a saved set, made once ---------------------------------------------------------------------------

/** The pose landmark pairs drawn as limbs in the sample set's video (the overlay draws the same skeleton). */
const LIMBS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 31],
  [28, 32],
];

/**
 * Records videos in the browser (MediaRecorder on a canvas, as the app's own recordings are made): the sample set's
 * movement drawn as a figure (MP4, as an iPhone records), a 2 s MP4 to pick for a check, and a 2 s WebM, whose
 * length Chromium can't tell, which the app says it can't read.
 */
async function makeVideos(seq) {
  fs.mkdirSync(MEDIA, { recursive: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}__blank.html`);
  const record = (spec) =>
    page.evaluate(async ({ spec, limbs }) => {
      const type = spec.types.find((t) => MediaRecorder.isTypeSupported(t));
      if (!type) throw new Error(`no MediaRecorder type of ${spec.types.join(', ')}`);
      const canvas = document.createElement('canvas');
      canvas.width = spec.width;
      canvas.height = spec.height;
      document.body.append(canvas);
      const g = canvas.getContext('2d');
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_500_000 });
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      const start = performance.now();
      const draw = () => {
        const t = performance.now() - start;
        if (!spec.seq) {
          g.fillStyle = `hsl(${Math.round(t / 6) % 360} 60% 40%)`;
          g.fillRect(0, 0, spec.width, spec.height);
          g.fillStyle = '#fff';
          g.fillRect(Math.round(t / 12) % (spec.width - 20), spec.height / 3, 20, spec.height / 3);
          return;
        }
        const frames = spec.seq.frames;
        const f = frames[Math.min(frames.length - 1, Math.round(t / 50))];
        g.fillStyle = '#26282c';
        g.fillRect(0, 0, spec.width, spec.height);
        g.fillStyle = '#34373c';
        g.fillRect(0, spec.height * 0.86, spec.width, spec.height * 0.14);
        if (!f.lm) return;
        const at = (i) => [f.lm[i][0] * spec.width, f.lm[i][1] * spec.height];
        g.strokeStyle = '#c9c4bc';
        g.lineCap = 'round';
        g.lineWidth = spec.width / 26;
        for (const [a, b] of limbs) {
          g.beginPath();
          g.moveTo(...at(a));
          g.lineTo(...at(b));
          g.stroke();
        }
        const [hx, hy] = at(0);
        g.beginPath();
        g.arc(hx, hy, spec.width / 22, 0, Math.PI * 2);
        g.fillStyle = '#c9c4bc';
        g.fill();
      };
      draw();
      recorder.start(250);
      const timer = setInterval(draw, 33);
      await new Promise((r) => setTimeout(r, spec.ms));
      clearInterval(timer);
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || type });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { type: blob.type, base64: btoa(bin) };
    }, { spec, limbs: LIMBS });
  const ms = seq.frames.at(-1).t + 400;
  const set = await record({ seq, width: 360, height: 640, ms, types: ['video/mp4;codecs=avc1', 'video/mp4'] });
  const pickMp4 = await record({ width: 320, height: 240, ms: 2000, types: ['video/mp4;codecs=avc1', 'video/mp4'] });
  const pickWebm = await record({ width: 320, height: 240, ms: 2000, types: ['video/webm'] });
  await ctx.close();
  const save = (name, v) => {
    const file = path.join(MEDIA, name);
    fs.writeFileSync(file, Buffer.from(v.base64, 'base64'));
    return { file, type: v.type, bytes: fs.statSync(file).size };
  };
  return { set: save('sample-set.mp4', set), pickMp4: save('picked.mp4', pickMp4), pickWebm: save('picked.webm', pickWebm) };
}

/** A back squat set made from the demo's own movement and analysed by the app's engine (Vite's module runner, in Node). */
async function sampleSet() {
  const { runnerImport } = await import('vite');
  const load = async (rel) => (await runnerImport(path.join(ROOT, rel), { configFile: false, root: ROOT, logLevel: 'error' })).module;
  const [lib, demo, engine, form] = await Promise.all([load('src/data/exercises.ts'), load('tests/fixtures/demoSeq.ts'), load('src/engine/analyze.ts'), load('src/log/form.ts')]);
  const exercise = lib.getExercise('back-squat');
  const seq = demo.demoSequence(exercise, { reps: 2 });
  // A pose model places every landmark; the demo's sequence leaves the face's and hands' at 0, 0, which the replay
  // would draw as lines to the corner. Here they sit on the nose and the wrists.
  for (const f of seq.frames) {
    if (!f.lm) continue;
    for (const i of [1, 2, 3, 4, 5, 6, 9, 10]) f.lm[i] = [...f.lm[0]];
    for (const [i, wrist] of [
      [17, 15],
      [19, 15],
      [21, 15],
      [18, 16],
      [20, 16],
      [22, 16],
    ])
      f.lm[i] = [...f.lm[wrist]];
  }
  const result = engine.analyze(exercise, seq);
  const checks = result.reps.map((r) => r.checks);
  return { seq, result, faults: form.faultReps(checks), cleanReps: checks.filter((c) => c.every((x) => x.status !== 'fail')).length };
}

// ---- The scenarios -----------------------------------------------------------------------------------------------

async function checkBuild() {
  const html = await (await fetch(BASE)).text();
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  const src = /src="\.\/(assets\/[^"]+\.js)"/.exec(scripts[0] ?? '')?.[1];
  const entry = src && fs.existsSync(path.join(DIST, src)) ? fs.readFileSync(path.join(DIST, src), 'utf8') : '';
  const csp = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1];
  check(
    "build: index.html loads the native entry (src/native/entry.ts) as its one module script",
    scripts.length === 1 && /type="module"/.test(scripts[0]) && entry.includes('fitee couldn’t open your data') && entry.includes('status-strip'),
    scripts.join(' '),
  );
  check("build: index.html's CSP is the native CSP (no 'unsafe-eval', no workers, no frames)", csp === NATIVE_CSP && !csp.includes("'unsafe-eval'"), csp);
  check(
    'build: no home-screen tags (manifest, icons, apple-mobile-web-app metas)',
    !/rel="(manifest|icon|apple-touch-icon)"|name="(mobile-web-app-capable|apple-mobile-web-app-[a-z-]+)"/.test(html),
  );
  const top = fs.readdirSync(DIST).sort();
  const wasm = fs.readdirSync(path.join(DIST, 'mediapipe', 'wasm')).sort();
  check(
    'build: dist-native/ has no service worker, landing page, web manifest or no-SIMD runtime',
    JSON.stringify(top) === JSON.stringify(['assets', 'index.html', 'licenses', 'mediapipe']) && JSON.stringify(wasm) === JSON.stringify(['vision_wasm_internal.js', 'vision_wasm_internal.wasm']),
    `${top.join(', ')}; mediapipe/wasm: ${wasm.join(', ')}`,
  );
  // No screen of the app can say what the web says of video ("Video is never uploaded", "It’s never uploaded"): the app
  // says what fitee does instead (it can't promise more of iOS's backups).
  const assets = fs.readdirSync(path.join(DIST, 'assets')).filter((f) => /\.(js|css|html)$/.test(f));
  const webLines = assets.filter((f) => /Video is never uploaded|It’s never uploaded/.test(fs.readFileSync(path.join(DIST, 'assets', f), 'utf8')));
  check('build: no file of the app holds the web’s "Video is never uploaded" or "It’s never uploaded"', assets.length > 0 && webLines.length === 0, webLines.join(', ') || `${assets.length} files`);
}

/** 2–4: first launch, "Skip for now" and the copy writer, restore. */
async function firstLaunch() {
  const l = await launch('first launch');
  const { page, run, fake } = l;
  await page.goto(BASE);
  const welcome = await heading(page, 'Welcome to fitee');
  const r = await ready(run);
  check('first launch: Welcome shows with nothing stored', welcome);
  const v = r?.value ?? {};
  check(
    'first launch: fitee:ready parses from the console line, the pose model on the page’s own origin (urlOrigin === origin)',
    !!r && v.origin === ORIGIN && v.urlOrigin === v.origin,
    r ? `origin ${v.origin}, urlOrigin ${v.urlOrigin}, ${r.line.length} characters` : 'no marker',
  );
  check(
    'first launch: fitee:ready ownFile 200, wasmType application/wasm, outside blocked, simd, secure, camera, recorder, rules, gate',
    v.ownFile === 200 && v.wasmType === 'application/wasm' && v.outside === 'blocked' && v.simd === true && v.secure === true && v.camera === true && v.recorder === true && v.rules === true && v.gate === true,
    short(v),
  );
  check('first launch: fitee:ready reports the app’s version and build, and an empty hash', v.version === '1.0.0' && v.build === '1' && v.hash === '', `${v.version} (${v.build}) ${JSON.stringify(v.hash)}`);
  if (v.sw === true) note('fitee:ready sw is true in Chromium (a WKWebView app has no service worker: CI requires false there)');
  report.markers.readyLight = r?.line;
  const strip = await page.evaluate(() => {
    const s = document.querySelector('.status-strip');
    const css = s ? getComputedStyle(s) : undefined;
    const rect = s?.getBoundingClientRect();
    return {
      native: document.documentElement.classList.contains('native'),
      strip: !!s,
      hidden: s?.getAttribute('aria-hidden'),
      first: document.body.firstElementChild === s,
      position: css?.position,
      top: rect?.top,
      height: rect?.height,
      zIndex: css?.zIndex,
      pointerEvents: css?.pointerEvents,
      sameColour: css?.backgroundColor === getComputedStyle(document.body).backgroundColor,
      viewTransitionName: css?.viewTransitionName,
    };
  });
  check(
    `first launch: html.native and the status strip: first in the body, aria-hidden, fixed over the safe area’s top (${run.safeTop} px here) in the page colour, above the bars (z-index 20), its own view transition`,
    strip.native && strip.strip && strip.hidden === 'true' && strip.first && strip.position === 'fixed' && strip.top === 0 && strip.height === run.safeTop && strip.zIndex === '20' && strip.pointerEvents === 'none' && strip.sameColour && strip.viewTransitionName === 'status-strip',
    JSON.stringify(strip),
  );
  check('first launch: appInfo was the first call, then the copy was read before anything else', fake.calls[0]?.method === 'appInfo' && fake.calls[1]?.method === 'readSnapshot', fake.calls.slice(0, 4).map((c) => c.method).join(', '));
  check('first launch: nothing stored, nothing written', writes(fake).length === 0 && Object.keys(await local(page)).every((k) => !k.startsWith('formcheck.v1.') || k.startsWith('formcheck.v1.device.')), `${writes(fake).length} writes`);
  const workers = await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.())?.length ?? 0);
  check('first launch: no service worker registered (the app carries every file)', workers === 0 && !server.requests('first launch').some((e) => e.path.endsWith('/sw.js')), `${workers} registrations`);
  await shoot(page, 'welcome');

  // 3. Skip for now: the app's own terms version, and the copy.
  const clicked = Date.now();
  check('skip: "Skip for now" opens the Train tab', await skip(page));
  const today = await page.locator('main').innerText();
  check(
    'train tab: with no plan, the privacy line under "Create my plan" is the app’s (fitee never uploads video), not "Video is never uploaded"',
    (await visible(page, T.nativePrivacy)) && today.includes('Create my plan') && !today.includes('Video is never uploaded'),
    short(today.slice(today.indexOf('Create my plan')), 200),
  );
  const profile = JSON.parse((await local(page))['formcheck.v1.profile'] ?? '{}');
  check('skip: the profile accepts the app’s own terms (NATIVE_TERMS_VERSION)', profile.termsVersion === T.termsVersion && !!profile.termsAcceptedAt, JSON.stringify(profile));
  const first = await nextWrite(fake, 0, 4000);
  const copy1 = fake.currentCopy();
  const rev1 = Number((await local(page))[T.revKey]);
  check(
    'skip: within 2.5 s a copy holding that profile, whose rev is the one localStorage remembers',
    !!first && first.at - clicked <= 2500 && JSON.stringify(copy1?.data['formcheck.v1.profile']) === JSON.stringify(profile) && copy1?.rev === rev1 && first.args.rev === rev1,
    first ? `written after ${first.at - clicked} ms, rev ${copy1?.rev}, ${T.revKey} ${rev1}` : 'no write',
  );
  check('skip: the copy holds no device key', !!copy1 && Object.keys(copy1.data).every((k) => !k.startsWith('formcheck.v1.device.')), Object.keys(copy1?.data ?? {}).join(', '));

  // More changes: the next writes, a hidden page and a page that goes.
  await page.goto(`${BASE}#/settings`);
  await page.getByRole('button', { name: /Pounds/ }).click();
  await nextWrite(fake, 1);
  await page.getByRole('button', { name: /Kilograms/ }).click();
  const n = writes(fake).length;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenWrite = await nextWrite(fake, n, 600);
  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
  });
  check('copy writer: hiding the page with a change waiting writes at once (not after 1.5 s)', !!hiddenWrite, hiddenWrite ? `rev ${hiddenWrite.args.rev}` : 'no write within 600 ms');
  // The page going (pagehide). In the app the bridge posts the write synchronously and the native side finishes it;
  // Playwright drops a binding call from a page that is already gone, so the event is dispatched here, and a real
  // reload below checks what happens when a write never reaches native.
  await page.getByRole('button', { name: /Pounds/ }).click();
  const m = writes(fake).length;
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  const hideWrite = await nextWrite(fake, m, 600);
  check('copy writer: the page going (pagehide) with a change waiting writes at once', !!hideWrite, hideWrite ? `rev ${hideWrite.args.rev}` : 'no write within 600 ms');
  // A change whose write may not have reached native before the page went (a reload right after it): at the next
  // launch localStorage's rev is ahead of the copy's, so the copy is written again, and it ends with the change.
  await page.getByRole('button', { name: /Kilograms/ }).click();
  const reloadAt = fake.calls.length;
  await reload(l);
  const caughtUp = await until(async () => {
    const copy = fake.currentCopy();
    return copy?.data['formcheck.v1.unit'] === 'kg' && copy.rev === Number((await local(page))[T.revKey]) ? copy : undefined;
  }, 4000);
  const lostOnTheWay = fake.calls.slice(reloadAt).findIndex((c) => c.method === 'writeSnapshot') > fake.calls.slice(reloadAt).findIndex((c) => c.method === 'appInfo');
  check(
    'copy writer: a change made just before a reload is in the copy after the next launch, at the rev localStorage remembers',
    !!caughtUp,
    caughtUp ? `rev ${caughtUp.rev}${lostOnTheWay ? ': the pagehide write never reached the fake (Playwright), and the next launch wrote it' : ''}` : short(fake.currentCopy()?.data),
  );
  const revs = writes(fake).map((c) => c.args.rev);
  check('copy writer: revs strictly increase from write to write', revs.length >= 5 && revs.every((rev, i) => i === 0 || rev > revs[i - 1]), revs.join(', '));

  // 4. Restore: WebKit's storage lost, the copy brings it back.
  await page.goto(BASE);
  await heading(page, 'Today');
  const before = writes(fake).length;
  const kept = await local(page);
  await page.evaluate(() => localStorage.clear());
  await sleep(2000);
  check('restore: clearing localStorage writes no copy (never an empty copy over a good one)', writes(fake).length === before, `${writes(fake).length - before} writes`);
  const loaded = reload(l);
  const toast = visible(page, T.restored, 8000);
  await loaded;
  const train = await heading(page, 'Today');
  check('restore: the Train tab shows (the terms accepted, from the copy)', train && (await page.locator('nav.tabs').count()) === 1);
  check(`restore: the toast "${T.restored}"`, await toast);
  const back = await local(page);
  const userKeys = (o) => Object.keys(o).filter((k) => k.startsWith('formcheck.v1.') && !k.startsWith('formcheck.v1.device.'));
  check(
    'restore: every user key is back, and localStorage remembers the copy’s rev',
    userKeys(kept).length > 0 && userKeys(kept).every((k) => back[k] === kept[k]) && Number(back[T.revKey]) === fake.currentCopy()?.rev,
    `${userKeys(back).length} of ${userKeys(kept).length} keys, rev ${back[T.revKey]}`,
  );
  check('restore: no copy written by the restore itself', writes(fake).length === before, `${writes(fake).length - before} writes`);
  await shoot(page, 'restored');
  await finish(l);
}

/** 5: which side wins at launch: a newer copy, an older one, equal revs with other data, and with the same data. */
async function copyRules() {
  const profile = JSON.stringify(ACCEPTED());
  const cases = [
    { name: 'a newer copy wins', copyRev: 5, copyUnit: 'lb', want: { unit: 'lb', rev: 5, writeRev: undefined, button: 'Pounds' } },
    { name: 'an older copy loses', copyRev: 2, copyUnit: 'lb', want: { unit: 'kg', rev: 4, writeRev: 4, button: 'Kilograms' } },
    { name: 'an equal rev with other data is written again', copyRev: 3, copyUnit: 'lb', want: { unit: 'kg', rev: 4, writeRev: 4, button: 'Kilograms' } },
    { name: 'an equal rev with the same data stays as it is', copyRev: 3, copyUnit: 'kg', want: { unit: 'kg', rev: 3, writeRev: undefined, button: 'Kilograms' } },
  ];
  for (const c of cases) {
    const fake = new Fake.FakeNative({ fileBase: ORIGIN });
    const l = await launch(`launch rules: ${c.name}`, { fake });
    await seedLocal(l, { 'formcheck.v1.profile': profile, 'formcheck.v1.unit': '"kg"', [T.revKey]: '3' });
    fake.snapshot = { current: copyText({ 'formcheck.v1.profile': JSON.parse(profile), 'formcheck.v1.unit': c.copyUnit }, c.copyRev) };
    await open(l, '#/settings');
    await heading(l.page, 'Settings');
    await sleep(300);
    const stored = await local(l.page);
    const pressed = await l.page.getByRole('button', { name: new RegExp(c.want.button) }).getAttribute('aria-pressed');
    const w = writes(fake);
    check(
      `launch rules: ${c.name} (copy rev ${c.copyRev} "${c.copyUnit}", localStorage rev 3 "kg")`,
      stored['formcheck.v1.unit'] === JSON.stringify(c.want.unit) && Number(stored[T.revKey]) === c.want.rev && pressed === 'true' && (c.want.writeRev === undefined ? w.length === 0 : w.length === 1 && w[0].args.rev === c.want.writeRev),
      `unit ${stored['formcheck.v1.unit']}, rev ${stored[T.revKey]}, ${c.want.button} pressed ${pressed}, writes ${w.map((x) => x.args.rev).join(',') || 'none'}`,
    );
    await finish(l);
  }
}

/** 6: an unreadable snapshot.json with a good snapshot.prev.json. */
async function invalidCurrent() {
  const fake = new Fake.FakeNative({ fileBase: ORIGIN });
  fake.snapshot = { current: '{"app":"fitee","version":1,"data":', prev: copyText({ 'formcheck.v1.profile': ACCEPTED(), 'formcheck.v1.unit': 'lb' }, 2) };
  const l = await launch('invalid current copy', { fake });
  const loaded = open(l);
  const toast = visible(l.page, T.restored, 8000);
  await loaded;
  const stored = await local(l.page);
  const drop = fake.calls.findIndex((c) => c.method === 'dropSnapshot');
  const write = fake.calls.findIndex((c) => c.method === 'writeSnapshot');
  check(
    'invalid current copy: restored from snapshot.prev.json, the toast shown, the Train tab',
    (await toast) && stored['formcheck.v1.unit'] === '"lb"' && Number(stored[T.revKey]) === 2 && (await heading(l.page, 'Today')),
    `unit ${stored['formcheck.v1.unit']}, rev ${stored[T.revKey]}`,
  );
  check('invalid current copy: dropSnapshot called before any write', drop >= 0 && (write < 0 || drop < write) && fake.snapshot.current === undefined, `drop at ${drop}, first write at ${write}`);
  await finish(l);
}

/** 7: the start-error screen. */
async function startError() {
  const fake = new Fake.FakeNative({ fileBase: ORIGIN });
  fake.failNext('readSnapshot', 'IO_ERROR', 'The copy couldn’t be read');
  const l = await launch('start error', { fake, allow: { codes: ['IO_ERROR'] } });
  await l.page.goto(BASE);
  const shown = await heading(l.page, 'fitee couldn’t open your data');
  const text = await l.page.locator('#app').innerText();
  check(
    'start error: a copy that can’t be read shows the start-error screen and no app',
    shown && text.includes('starting without it could replace your data') && (await l.page.locator('nav.tabs').count()) === 0 && !text.includes('Welcome to fitee'),
    short(text, 200),
  );
  check('start error: nothing written, nothing stored', writes(fake).length === 0 && Object.keys(await local(l.page)).length === 0);
  await shoot(l.page, 'start-error');
  const again = l.page.getByRole('button', { name: 'Try again' });
  const before = markerLines(l.run, C.MARKERS.ready).length;
  await again.click();
  const restarted = await heading(l.page, 'Welcome to fitee');
  check('start error: Try again reloads, and the app starts once the copy can be read', restarted && !!(await ready(l.run, before + 1)), `${fake.callsTo('readSnapshot').length} reads`);
  await finish(l);

  const n = await launch('no bridge', { stub: false });
  await n.page.goto(BASE);
  check('no bridge: without window.Capacitor the start-error screen shows, not the app', (await heading(n.page, 'fitee couldn’t open your data')) && (await n.page.locator('nav.tabs').count()) === 0);
  await finish(n);
}

/** 8: a copy written by a newer version of the app. */
async function holdNewer() {
  const fake = new Fake.FakeNative({ fileBase: ORIGIN });
  const newer = JSON.stringify({ app: 'fitee', version: 2, exportedAt: new Date().toISOString(), data: { 'formcheck.v1.unit': 'lb', future: true }, rev: 9 });
  fake.snapshot = { current: newer };
  const l = await launch('newer copy (hold)', { fake });
  const loaded = open(l);
  const toast = visible(l.page, T.newer, 8000);
  await loaded;
  check(`newer copy: the toast "${T.newer}"`, await toast);
  check('newer copy: the app starts with localStorage as it is (Welcome)', await heading(l.page, 'Welcome to fitee'));
  await skip(l.page);
  await l.page.goto(`${BASE}#/settings`);
  await l.page.getByRole('button', { name: /Pounds/ }).click();
  await sleep(3000);
  check(
    'newer copy: no copy written that session, the newer file never dropped or replaced',
    writes(fake).length === 0 && fake.callsTo('dropSnapshot').length === 0 && fake.snapshot.current === newer,
    `${writes(fake).length} writes, ${fake.callsTo('dropSnapshot').length} drops`,
  );
  await finish(l);
}

/** 9–10: Settings, and Back up my data with Restore from a backup. */
async function settings() {
  const l = await launch('settings');
  const { page, fake, run } = l;
  await open(l);
  await skip(page);
  await page.goto(`${BASE}#/settings`);
  await heading(page, 'Settings');
  const savedSets = await visible(
    page,
    '0 saved sets on this iPhone, 0 with video (0.0 MB). Replays are kept for your last 60 checks; videos until you delete them. fitee asks iOS to leave saved sets out of your iPhone’s backups.',
  );
  const body = await page.locator('main').innerText();
  check('settings: no "Install and offline" section', !body.includes('Install and offline') && (await page.getByRole('heading', { name: 'Install and offline' }).count()) === 0);
  check('settings: the saved-sets text says what fitee does about backups', savedSets);
  check(
    'settings: the your-data text says where the data is, the copy, and the backups',
    body.includes('Your plan, log, profile and settings are kept in fitee on this iPhone, with a copy in the app’s own folder in case iOS clears its web storage. Your iPhone’s backups (iCloud or a computer) include them; fitee asks iOS to leave saved sets and videos out.'),
  );
  check(
    'settings: the privacy line says what fitee does (never uploads video), not "Video is never uploaded"',
    body.includes(T.nativePrivacy) && !body.includes('Video is never uploaded'),
  );
  const footer = page.locator('p.footer');
  const footerText = (await footer.innerText()).trim();
  check('settings: the footer says "fitee 1.0.0 (1)" (the app’s version and build), not a button', footerText === 'fitee 1.0.0 (1)' && (await footer.locator('button').count()) === 0, footerText);
  for (let i = 0; i < 5; i++) await footer.click();
  await sleep(500);
  check('settings: five taps on the footer stay on Settings (no hidden developer pages)', (await page.evaluate(() => location.hash)) === '#/settings');
  // As it opens; scrolled, with the saved-sets text going under the status strip; and the whole page.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await shoot(page, 'settings');
  await scrollToIt(page, 'h2', { text: 'Your data', gap: -40 });
  await shoot(page, 'settings-scrolled');
  await shoot(page, 'settings-full', { full: true });
  const dev = [];
  for (const route of ['#/dev/calibrate', '#/dev/demos', '#/dev/anatomy']) {
    await page.goto(BASE + route);
    dev.push(`${route}: ${(await heading(page, 'Today', 5000)) ? 'Train tab' : 'something else'}`);
  }
  check('settings: #/dev/calibrate, #/dev/demos and #/dev/anatomy show the Train tab', dev.every((d) => d.endsWith('Train tab')), dev.join('; '));
  await page.goto(`${BASE}#/analyze/back-squat?calibrate`);
  await heading(page, 'Back squat');
  const subtitle = await page.locator('main').innerText();
  check('settings: #/analyze/<id>?calibrate is a plain technique check', subtitle.includes('Technique check') && !subtitle.includes('Calibration recording'));
  // The profile, in Settings and on first launch: kept on this iPhone and in its backups (the copy of the log holds it).
  const profileTexts = [];
  for (const route of ['#/profile', '#/profile?setup']) {
    await page.goto(BASE + route);
    await heading(page, route.endsWith('setup') ? 'About you' : 'Profile');
    profileTexts.push(await page.locator('main').innerText());
  }
  check(
    'profile: says it stays on this iPhone and in its backups and that fitee sends nothing, never "only on this phone" or "Nothing is sent anywhere"',
    profileTexts.every((t) => t.includes(T.profileNote) && !/Kept only on this phone|Everything stays on this phone|Nothing is sent anywhere/.test(t)) &&
      (await page.goto(`${BASE}#/profile`).then(() => visible(page, 'Kept on this iPhone and in its backups'))),
    profileTexts.map((t) => short(t.slice(t.indexOf('How this is used')), 160)).join(' | '),
  );

  // Back up my data: Save to Files.
  await page.goto(`${BASE}#/settings`);
  await page.getByRole('button', { name: /Pounds/ }).click();
  await watchToasts(page);
  await page.getByRole('button', { name: 'Back up my data' }).click();
  const exported = await until(() => fake.exports[0], 3000);
  const today = new Date().toISOString().slice(0, 10);
  let backup;
  try {
    backup = JSON.parse(exported?.text ?? '');
  } catch {
    backup = undefined;
  }
  check(
    `backup: Save to Files (exportFile) with fitee-backup-${today}.json, no share sheet`,
    exported?.name === `fitee-backup-${today}.json` && fake.callsTo('exportFile').length === 1,
    exported ? exported.name : 'no exportFile call',
  );
  check(
    'backup: a fitee backup of the user’s keys (app fitee, version 1, no device key)',
    backup?.app === 'fitee' && backup.version === 1 && backup.data['formcheck.v1.unit'] === 'lb' && backup.data['formcheck.v1.profile']?.termsVersion === T.termsVersion && Object.keys(backup.data).every((k) => !k.startsWith('formcheck.v1.device.')),
    Object.keys(backup?.data ?? {}).join(', '),
  );
  await sleep(400);
  check('backup: saved, so nothing to say (no toast)', (await toasts(page)).length === 0, (await toasts(page)).join(' | '));
  fake.failNext('exportFile', 'EXPORT_FAILED', 'The panel couldn’t be shown');
  run.allow.codes = ['EXPORT_FAILED'];
  await page.getByRole('button', { name: 'Back up my data' }).click();
  check(`backup: a failure shows "${T.exportFailed}"`, await visible(page, T.exportFailed, 4000));
  await finish(l);

  // Restore from a backup, on another phone: the backup's text is what importAll() takes.
  const file = path.join(MEDIA, `fitee-backup-${today}.json`);
  fs.mkdirSync(MEDIA, { recursive: true });
  fs.writeFileSync(file, exported?.text ?? '');
  const r = await launch('restore from a backup');
  await open(r);
  await skip(r.page);
  await r.page.goto(`${BASE}#/settings`);
  await r.page.locator('input[type=file][accept*="json"]').setInputFiles(file);
  const restoredToast = await visible(r.page, /Restored \d+ items?/, 4000);
  await ready(r.run, 2, 10_000); // the app reloads after the restore
  await r.page.goto(`${BASE}#/settings`);
  await heading(r.page, 'Settings');
  const pressed = await r.page.getByRole('button', { name: /Pounds/ }).getAttribute('aria-pressed');
  const copied = await until(() => r.fake.currentCopy()?.data['formcheck.v1.unit'] === 'lb', 4000);
  check('backup: Restore from a backup takes the file back ("Restored … items", Pounds again) and the copy follows', restoredToast && pressed === 'true' && !!copied, `Pounds pressed ${pressed}, copy unit ${JSON.stringify(r.fake.currentCopy()?.data['formcheck.v1.unit'])}`);
  await finish(r);
}

/** 11: a copy that can't be written (a full iPhone): one toast per session. */
async function copyFails() {
  const l = await launch('copy fails', { allow: { codes: ['NO_ROOM'] } });
  const { page, fake } = l;
  await open(l);
  await skip(page);
  await nextWrite(fake, 0);
  await page.goto(`${BASE}#/settings`);
  await watchToasts(page);
  fake.failNext('writeSnapshot', 'NO_ROOM', 'No room');
  fake.failNext('writeSnapshot', 'NO_ROOM', 'No room');
  await page.getByRole('button', { name: /Pounds/ }).click();
  const shown = await visible(page, T.copyFailed, 4000);
  await nextWrite(fake, 1);
  await sleep(2700); // the toast goes
  await page.getByRole('button', { name: /Kilograms/ }).click();
  await nextWrite(fake, 2);
  await sleep(500);
  await page.getByRole('button', { name: /Pounds/ }).click();
  const third = await nextWrite(fake, 3);
  await sleep(300);
  const seen = (await toasts(page)).filter((t) => t === T.copyFailed).length;
  check(`copy fails: "${T.copyFailed}" once in a session, though two writes failed`, shown && seen === 1, `${seen} toasts`);
  check('copy fails: the next change is written again (rev goes on)', !!third && fake.currentCopy()?.data['formcheck.v1.unit'] === 'lb' && fake.currentCopy()?.rev === third.args.rev, third ? `rev ${third.args.rev}` : 'no write');
  await finish(l);
}

/** 12: Delete all my data. */
async function deleteAll() {
  const holder = {};
  const fake = new Fake.FakeNative({ fileBase: ORIGIN, onDeleteAll: () => holder.page?.evaluate(() => window.__fiteeWebsiteDataRemoved?.()) });
  fake.sets.set('index.json', Buffer.from('[]'));
  const l = await launch('delete all', { fake, allow: { codes: ['IO_ERROR'] } });
  holder.page = l.page;
  const { page } = l;
  await open(l);
  await skip(page);
  await nextWrite(fake, 0);
  await page.goto(`${BASE}#/settings`);
  await heading(page, 'Settings');

  // Cancelled: nothing happens.
  page.once('dialog', (d) => void d.dismiss());
  await page.getByRole('button', { name: 'Delete all my data' }).click();
  await sleep(500);
  check('delete all: cancelled, nothing is deleted', fake.callsTo('deleteAllData').length === 0 && Object.keys(await local(page)).some((k) => k === 'formcheck.v1.profile'));

  // Failed before the web view's stores were touched (fitee/ couldn't be removed): no marker left, its toast, the copy
  // written again at once and later changes copied; and the next launch keeps the data, deleting nothing.
  fake.failNext('deleteAllData', 'IO_ERROR', 'Couldn’t remove the folder');
  const n0 = writes(fake).length;
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete all my data' }).click();
  const failedToast = await visible(page, T.deleteFailed, 4000);
  const rewritten = await nextWrite(fake, n0, 2000);
  const n = writes(fake).length;
  await page.getByRole('button', { name: /Pounds/ }).click();
  const after = await nextWrite(fake, n);
  check(
    `delete all: a failure before the web view's stores shows "${T.deleteFailed}", leaves no marker, keeps the data, writes the copy again at once and copies later changes`,
    failedToast && fake.deleting === false && !!rewritten && !!after && Object.keys(await local(page)).includes('formcheck.v1.profile'),
    `marker ${fake.deleting}; copy written again ${!!rewritten}; next change copied ${!!after}`,
  );
  const deletes = fake.callsTo('deleteAllData').length;
  await reload(l);
  await heading(page, 'Settings');
  const kept = await local(page);
  check(
    'delete all: after that failure the next launch deletes nothing and starts with the data (Pounds still picked)',
    fake.callsTo('deleteAllData').length === deletes && Object.keys(kept).includes('formcheck.v1.profile') && kept['formcheck.v1.unit'] === '"lb"' && (await page.getByRole('button', { name: /Pounds/ }).getAttribute('aria-pressed')) === 'true',
    `${fake.callsTo('deleteAllData').length - deletes} deletes at launch; unit ${kept['formcheck.v1.unit']}`,
  );

  // Done: the native side deletes everything, then the page reloads to Welcome.
  let message = '';
  page.once('dialog', (d) => {
    message = d.message();
    void d.accept();
  });
  const before = markerLines(l.run, C.MARKERS.ready).length;
  await page.getByRole('button', { name: 'Delete all my data' }).click();
  const toast = visible(page, T.deleted, 10_000);
  const reloaded = await ready(l.run, before + 1, 10_000);
  const toastShown = await toast;
  if (toastShown) await shoot(page, 'deleted'); // while the toast shows
  check('delete all: the confirm asks with the app’s text (backups stay until replaced)', message === T.deleteConfirm, short(message, 160));
  const call = fake.callsTo('deleteAllData').at(-1);
  check('delete all: deleteAllData called while the page still had its user keys (no JS deletes first)', !!call && call.userKeys > 0, call ? `${call.userKeys} user keys` : 'not called');
  check(`delete all: the page reloads to Welcome with "${T.deleted}"`, !!reloaded && (await heading(page, 'Welcome to fitee')) && toastShown);
  const left = await local(page);
  check(
    'delete all: nothing left: no formcheck.v1. key, the fake’s files and copy gone, the hash back to #/',
    Object.keys(left).every((k) => !k.startsWith('formcheck.v1.')) && fake.sets.size === 0 && Object.keys(fake.snapshot).length === 0 && (await page.evaluate(() => location.hash)) === '#/',
    `keys: ${Object.keys(left).join(', ') || 'none'}; files ${fake.sets.size}; hash ${await page.evaluate(() => location.hash)}`,
  );
  const callIndex = fake.calls.lastIndexOf(call);
  await sleep(2500);
  check('delete all: no copy written after it', !fake.calls.slice(callIndex).some((c) => c.method === 'writeSnapshot'), `${fake.calls.slice(callIndex).filter((c) => c.method === 'writeSnapshot').length} writes`);
  await finish(l);

  // Failed at the end (everything deleted, the web view's stores too, but the marker couldn't be removed): the delete
  // isn't over, so the page reloads, and that launch finishes it: Welcome with "All data deleted", no copy written.
  const holder3 = {};
  const fake3 = new Fake.FakeNative({ fileBase: ORIGIN, onDeleteAll: () => holder3.page?.evaluate(() => window.__fiteeWebsiteDataRemoved?.()) });
  const s3 = await launch('delete all, failed at the end', { fake: fake3, allow: { codes: ['IO_ERROR'] } });
  holder3.page = s3.page;
  await open(s3);
  await skip(s3.page);
  await nextWrite(fake3, 0);
  await s3.page.goto(`${BASE}#/settings`);
  await heading(s3.page, 'Settings');
  fake3.failMarkerRemovalNext();
  const loads3 = markerLines(s3.run, C.MARKERS.ready).length;
  const writes3 = writes(fake3).length;
  s3.page.once('dialog', (d) => void d.accept());
  await s3.page.getByRole('button', { name: 'Delete all my data' }).click();
  const toast3 = visible(s3.page, T.deleted, 15_000);
  const reloaded3 = await ready(s3.run, loads3 + 1, 15_000); // Welcome's (the load that finishes the delete renders nothing)
  const shown3 = await toast3;
  const order3 = fake3.calls.slice(fake3.calls.indexOf(fake3.callsTo('deleteAllData')[0])).map((c) => c.method);
  check(
    'delete all, failed at the end: the page reloads and the launch finishes the delete (deleteAllData again before the copy is read), then Welcome with "All data deleted"; no copy written',
    !!reloaded3 &&
      shown3 &&
      (await heading(s3.page, 'Welcome to fitee')) &&
      fake3.callsTo('deleteAllData').length === 2 &&
      order3.indexOf('deleteAllData', 1) < order3.indexOf('readSnapshot') &&
      fake3.deleting === false &&
      writes(fake3).length === writes3 &&
      Object.keys(await local(s3.page)).every((k) => !k.startsWith('formcheck.v1.')),
    `${order3.join(', ')}; marker ${fake3.deleting}; ${writes(fake3).length - writes3} writes`,
  );
  await finish(s3);

  // Stopped part way (the marker still there): fitee/ was removed, the web view's stores weren't. The next launch
  // finishes the delete before it reads the copy, and starts at Welcome with "All data deleted".
  const holder2 = {};
  const fake2 = new Fake.FakeNative({ fileBase: ORIGIN, onDeleteAll: () => holder2.page?.evaluate(() => window.__fiteeWebsiteDataRemoved?.()) });
  const s2 = await launch('delete all, stopped part way', { fake: fake2 });
  holder2.page = s2.page;
  await seedLocal(s2, { 'formcheck.v1.profile': JSON.stringify(ACCEPTED()), 'formcheck.v1.unit': '"lb"', 'formcheck.v1.device.snapshotRev': '4' });
  fake2.deleting = true;
  const before2 = markerLines(s2.run, C.MARKERS.ready).length;
  await s2.page.goto(BASE);
  const toast2 = visible(s2.page, T.deleted, 15_000);
  const reloaded2 = await ready(s2.run, before2 + 1, 15_000);
  const shown2 = await toast2;
  const order2 = fake2.calls.map((c) => c.method);
  check(
    'delete all, stopped part way: the next launch deletes again before reading the copy, then Welcome with "All data deleted"; nothing left, no copy written',
    order2[0] === 'appInfo' &&
      order2[1] === 'deleteAllData' &&
      order2.indexOf('readSnapshot') > 1 &&
      !!reloaded2 &&
      shown2 &&
      (await heading(s2.page, 'Welcome to fitee')) &&
      fake2.deleting === false &&
      Object.keys(await local(s2.page)).every((k) => !k.startsWith('formcheck.v1.')) &&
      writes(fake2).length === 0,
    `${order2.slice(0, 4).join(', ')}; marker ${fake2.deleting}; ${writes(fake2).length} writes`,
  );
  await finish(s2);
}

/** 13: the status bar's text and what iOS draws over the page follow the theme. */
async function statusBar() {
  // A launch on a dark phone, as CI's dark launch.
  const d = await launch('dark launch', { colorScheme: 'dark' });
  const dr = await open(d);
  await sleep(300);
  const bars = d.run.native.filter((line) => line.startsWith(`${C.MARKERS.statusbar} `));
  check(
    'dark launch: light text on the dark page from the first style set, the appearance following the phone',
    !!dr && bars.length > 0 && bars.every((line) => line.endsWith(' light-text')) && JSON.stringify(appearances(d.fake)) === JSON.stringify(['system']),
    `${bars.join(', ')}; setAppearance ${appearances(d.fake).join(', ')}`,
  );
  report.markers.readyDark = dr?.line;
  await finish(d);

  const fake = new Fake.FakeNative({ fileBase: ORIGIN });
  const l = await launch('status bar', { fake, colorScheme: 'light' });
  const { page, run } = l;
  await open(l);
  await sleep(300);
  const rows = [];
  const row = async (what, wantBar, wantAppearance) => {
    await sleep(300);
    const bar = lastStatusBar(run);
    const style = appearances(fake).at(-1);
    rows.push({ what, ok: bar === wantBar && style === wantAppearance, got: `${bar}, ${style}` });
  };
  await row('a light phone', 'dark-text', 'system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await row('a dark phone', 'light-text', 'system');
  await page.emulateMedia({ colorScheme: 'light' });
  await skip(page);
  await page.goto(`${BASE}#/settings`);
  await page.getByRole('radio', { name: 'Dark' }).click();
  await row('Appearance Dark on a light phone', 'light-text', 'dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('radio', { name: 'Light' }).click();
  await row('Appearance Light on a dark phone', 'dark-text', 'light');
  await page.getByRole('radio', { name: 'Automatic' }).click();
  await row('Appearance Automatic on a dark phone', 'light-text', 'system');
  for (const r of rows) check(`status bar: ${r.what}: ${r.ok ? 'right' : 'wrong'} text and appearance`, r.ok, r.got);
  // A pinned theme is right from the start: the first style set after a reload is the pinned one.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('radio', { name: 'Dark' }).click();
  await sleep(300);
  const from = run.native.length;
  const calls = fake.calls.length;
  await reload(l);
  await sleep(300);
  const firstBar = run.native.slice(from).find((line) => line.startsWith(`${C.MARKERS.statusbar} `));
  const firstAppearance = fake.calls.slice(calls).find((c) => c.method === 'setAppearance')?.args.style;
  check(
    'status bar: with Dark pinned on a light phone the app starts with light text and a dark appearance (no light flash)',
    firstBar === `${C.MARKERS.statusbar} light-text` && firstAppearance === 'dark',
    `${firstBar}, ${firstAppearance}`,
  );
  await finish(l);
}

/** 14: a saved set with its video. */
async function savedSet(sample, video) {
  const fake = new Fake.FakeNative({ fileBase: ORIGIN });
  const id = `s${(Date.now() - 3_600_000).toString(36)}nc1`;
  const meta = {
    id,
    exerciseId: 'back-squat',
    at: new Date(Date.now() - 3_600_000).toISOString(),
    source: 'camera',
    durationSec: Math.round(sample.seq.frames.at(-1).t / 100) / 10,
    reps: sample.result.reps.length,
    cleanReps: sample.cleanReps,
    faults: sample.faults,
    mirrored: false,
    video: { bytes: video.bytes, type: video.type, offsetMs: 0 },
  };
  const ext = Files.extFor(video.type);
  fake.sets.set('index.json', Buffer.from(JSON.stringify([meta])));
  fake.sets.set(`${id}.replay.json`, Buffer.from(JSON.stringify({ seq: sample.seq, result: sample.result })));
  fake.sets.set(`${id}.${ext}`, fs.readFileSync(video.file));
  const l = await launch('saved set', { fake });
  const { page } = l;
  await seedLocal(l, { 'formcheck.v1.profile': JSON.stringify(ACCEPTED()) });
  await open(l, `#/set/${id}`);
  await heading(page, 'Back squat');
  const playing = await page
    .waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1, null, { timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  const src = await page.evaluate(() => document.querySelector('video')?.currentSrc ?? '');
  check(
    'saved set: the <video> plays from the native videoUrl (the fake’s file URL), and reaches loadedmetadata',
    playing && src === `${ORIGIN}/__files__/${id}.${ext}` && fake.callsTo('videoUrl').some((c) => c.args.name === `${id}.${ext}`),
    `${src}; ${video.type}, ${video.bytes} bytes`,
  );
  check('saved set: the launch’s reconcile listed the files before the first read', fake.calls.find((c) => c.method === 'listSetFiles' || c.method === 'readSetFile')?.method === 'listSetFiles');
  check(
    'saved set: the note under the video says fitee never uploads it, not "It’s never uploaded"',
    (await visible(page, 'fitee never uploads it.')) && !(await page.locator('main').innerText()).includes('It’s never uploaded'),
  );
  const ranged = server.requests(l.run.name).filter((e) => e.path === `/__files__/${id}.${ext}`);
  check('saved set: the video was read with Range requests (206), as from Capacitor’s file route', ranged.length > 0 && ranged.every((e) => e.status === 206), ranged.map((e) => `${e.status} ${e.range}`).join(', '));
  const subtitle = await page.locator('header').first().innerText();
  check('saved set: the page says it’s a video, with every rep listed', subtitle.includes('video') && (await page.locator('.set-reps > li').count()) === sample.result.reps.length, short(subtitle, 120));
  // Paused at the bottom of the first rep (the scrub bar is in seconds), for the screenshots.
  await page.evaluate((t) => {
    const r = document.querySelector('.player-controls input[type=range]');
    if (!r) return;
    r.value = String(t);
    r.dispatchEvent(new Event('input', { bubbles: true }));
  }, sample.seq.frames[sample.result.reps[0].turnFrame].t / 1000);
  await sleep(600);
  await shoot(page, 'set');
  await scrollToIt(page, '.form-card');
  await shoot(page, 'set-reps');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

  // Delete video: every extension goes, the index keeps the set without it.
  const removes = fake.callsTo('removeSetFiles').length;
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete video' }).click();
  const deletedVideo = await visible(page, 'Video deleted', 4000);
  const videoRemove = fake.callsTo('removeSetFiles')[removes];
  const index1 = JSON.parse(fake.file('index.json')?.toString() ?? '[]');
  check(
    'saved set: Delete video removes the video under every extension, and the index keeps the set without it',
    deletedVideo && JSON.stringify(videoRemove?.args.names) === JSON.stringify(Files.VIDEO_EXTS.map((e) => `${id}.${e}`)) && !fake.file(`${id}.${ext}`) && index1.length === 1 && index1[0].video === undefined,
    `${JSON.stringify(videoRemove?.args.names)}; index ${short(index1, 120)}`,
  );
  check('saved set: then a skeleton replay', (await page.locator('header').first().innerText()).includes('skeleton replay') && (await page.locator('video').count()) === 0);
  // Delete this saved set: the replay and the entry go.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete this saved set' }).click();
  const deletedSet = await visible(page, 'Saved set deleted', 4000);
  const index2 = JSON.parse(fake.file('index.json')?.toString() ?? 'null');
  check(
    'saved set: Delete this saved set removes the replay and the entry, and goes to the Log tab',
    deletedSet && !fake.file(`${id}.replay.json`) && Array.isArray(index2) && index2.length === 0 && (await page.evaluate(() => location.hash)) === '#/log',
    `files: ${[...fake.sets.keys()].join(', ')}`,
  );
  // The set is gone: its page says so in the app's words (fitee asks iOS to leave saved sets out of backups).
  await page.goto(`${BASE}#/set/${id}`);
  const missing = await visible(
    page,
    'This set isn’t saved on this iPhone any more. Older replays are removed to save space, sets with a saved video are kept, and fitee asks iOS to leave saved sets out of iPhone backups, so a restored phone doesn’t have them.',
    5000,
  );
  check('saved set: a set that isn’t saved any more says why, in the app’s words', missing, short(await page.locator('main').innerText(), 200));
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  check('saved set: saved sets are files only: no IndexedDB database was opened', databases.length === 0, databases.join(', '));
  await finish(l);
}

/**
 * 14b: the launch's reconcile through the app. An index that exists but can't be read is rebuilt from the replays and
 * set aside (S2); while it's set aside, a file no entry names goes only if its id time is later than the set-aside's.
 * An index naming a video that isn't there (sets/ isn't restored from an iPhone backup) loses the video; a leftover
 * upload part and a file no entry names go.
 */
async function reconcile(sample, video) {
  const ext = Files.extFor(video.type);
  const stamp = (ms) => `s${(Date.now() - ms).toString(36)}rc1`;
  const replay = Buffer.from(JSON.stringify({ seq: sample.seq, result: sample.result }));

  const fake = new Fake.FakeNative({ fileBase: ORIGIN });
  const a = stamp(7_200_000);
  fake.sets.set('index.json', Buffer.from('[{"id":"'));
  fake.sets.set(`${a}.replay.json`, replay);
  fake.sets.set(`${a}.${ext}`, fs.readFileSync(video.file));
  fake.sets.set(`stray.${ext}`, Buffer.from('not a set'));
  const l = await launch('reconcile: unreadable index', { fake });
  await seedLocal(l, { 'formcheck.v1.profile': JSON.stringify(ACCEPTED()) });
  await open(l, '#/settings');
  const mb = (video.bytes / 1e6).toFixed(1);
  const listed = await visible(l.page, `1 saved set on this iPhone, 1 with video (${mb} MB).`, 8000);
  const names = [...fake.sets.keys()];
  const aside = names.filter((n) => /^index\.unreadable-\d+\.json$/.test(n));
  const index = JSON.parse(fake.file('index.json')?.toString() ?? 'null');
  check(
    'reconcile: an unreadable index is set aside and rebuilt from the replays, its video found again (S2)',
    listed && aside.length === 1 && fake.file(aside[0])?.toString() === '[{"id":"' && index?.length === 1 && index[0].id === a && index[0].video?.type === Files.typeForExt(ext) && index[0].video?.bytes === video.bytes && index[0].reps === sample.result.reps.length,
    `${aside.join(', ') || 'nothing set aside'}; index ${short(index, 160)}`,
  );
  check(
    'reconcile: while an index is set aside, a file no entry names is deleted only if its id time is later than the set-aside (here none is: a file with no id time and the rebuilt set’s stay)',
    names.includes(`stray.${ext}`) && names.includes(`${a}.replay.json`) && names.includes(`${a}.${ext}`),
    names.join(', '),
  );
  await l.page.goto(`${BASE}#/set/${a}`);
  const plays = await l.page
    .waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1, null, { timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  check('reconcile: the rebuilt set opens and plays its video', plays);
  await finish(l);

  const fake2 = new Fake.FakeNative({ fileBase: ORIGIN });
  const b = stamp(3_600_000);
  const meta = { id: b, exerciseId: 'back-squat', at: new Date(Date.now() - 3_600_000).toISOString(), source: 'camera', durationSec: 9.3, reps: 2, cleanReps: 2, faults: {}, mirrored: false, video: { bytes: video.bytes, type: video.type, offsetMs: 0 } };
  fake2.sets.set('index.json', Buffer.from(JSON.stringify([meta])));
  fake2.sets.set(`${b}.replay.json`, replay);
  fake2.sets.set(`${b}.${ext}.part`, Buffer.from('half an upload'));
  fake2.sets.set(`sorphan01.replay.json`, replay);
  const r = await launch('reconcile: restored phone', { fake: fake2 });
  await seedLocal(r, { 'formcheck.v1.profile': JSON.stringify(ACCEPTED()) });
  await open(r, '#/settings');
  const shown = await visible(r.page, '1 saved set on this iPhone, 0 with video (0.0 MB).', 8000);
  const left = [...fake2.sets.keys()].sort();
  const index2 = JSON.parse(fake2.file('index.json')?.toString() ?? 'null');
  check(
    'reconcile: a set whose video isn’t there keeps its replay without the video; a leftover part and an orphan replay go',
    shown && JSON.stringify(left) === JSON.stringify([`${b}.replay.json`, 'index.json'].sort()) && index2?.length === 1 && index2[0].video === undefined,
    `files: ${left.join(', ')}`,
  );
  await finish(r);
}

/** 15: the technique check: keep awake, picked videos (their temporary copies), and the camera test's model. */
async function techniqueCheck(media) {
  const fake = new Fake.FakeNative({ fileBase: ORIGIN });
  const l = await launch('technique check', { fake, allow: { mediapipe: true } });
  const { page } = l;
  await seedLocal(l, { 'formcheck.v1.profile': JSON.stringify(ACCEPTED()) });
  await open(l, '#/analyze/back-squat');
  const start = page.getByRole('button', { name: 'Start camera' });
  const loaded = await start.waitFor({ state: 'visible', timeout: 60_000 }).then(
    () => until(() => start.isEnabled(), 60_000),
    () => false,
  );
  check('technique check: the pose model loads (Start camera enabled)', !!loaded);
  await start.click();
  const awake = await until(() => fake.callsTo('setKeepAwake').some((c) => c.args.on === true), 5000);
  const running = await page
    .waitForFunction(() => {
      const v = document.querySelector('video');
      return !!v && v.readyState >= 2 && !v.paused;
    }, null, { timeout: 20_000 })
    .then(
      () => true,
      () => false,
    );
  check('technique check: the camera starts (fake camera) and keeps the screen on (setKeepAwake on)', !!awake && running && fake.keepAwake === true);
  await page.locator('a.back').first().click();
  const asleep = await until(() => fake.callsTo('setKeepAwake').at(-1)?.args.on === false, 5000);
  check('technique check: leaving it lets the screen sleep again (setKeepAwake off)', !!asleep && fake.keepAwake === false, fake.callsTo('setKeepAwake').map((c) => c.args.on).join(', '));

  // A picked video, checked to its results: its temporary copy goes when the results close.
  await page.goto(`${BASE}#/analyze/back-squat`);
  const useVideo = page.getByRole('button', { name: 'Use a video instead' });
  await until(() => useVideo.isEnabled(), 60_000);
  await page.locator('input[type=file][accept="video/*"]').setInputFiles(media.pickMp4.file);
  const results = await page
    .locator('.results')
    .waitFor({ state: 'visible', timeout: 90_000 })
    .then(
      () => true,
      () => false,
    );
  const clearedBefore = fake.callsTo('clearPickedFiles').length;
  await page.getByRole('button', { name: 'Record another set' }).click();
  const cleared = await until(() => fake.callsTo('clearPickedFiles').length > clearedBefore, 5000);
  check('picked video: checked to its results, then the temporary copy is deleted as they close (clearPickedFiles)', results && clearedBefore === 0 && !!cleared, `${fake.callsTo('clearPickedFiles').length} calls`);
  // A video the app can't read: the same.
  await until(() => useVideo.isEnabled(), 30_000);
  await page.locator('input[type=file][accept="video/*"]').setInputFiles(media.pickWebm.file);
  const refused = await visible(page, 'Couldn’t read the length of this video.', 30_000);
  const cleared2 = await until(() => fake.callsTo('clearPickedFiles').length === 2, 5000);
  check('picked video: one the app can’t read says so, and its temporary copy is deleted too', refused && !!cleared2, `${fake.callsTo('clearPickedFiles').length} calls`);
  check('picked video: nothing saved for a check with no reps (no set files written)', fake.callsTo('writeSetFile').length === 0);
  check('technique check: the privacy line under "Use a video instead" says fitee never uploads video', await visible(page, T.nativePrivacy));
  // The picker closes without a file (the input's cancel event): what an earlier clear left in tmp/ goes now.
  const beforeCancel = fake.callsTo('clearPickedFiles').length;
  await page.locator('input[type=file][accept="video/*"]').dispatchEvent('cancel');
  const cancelled = await until(() => fake.callsTo('clearPickedFiles').length > beforeCancel, 5000);
  check('picked video: the picker closing without a file deletes the temporary copies (clearPickedFiles)', !!cancelled, `${fake.callsTo('clearPickedFiles').length} calls`);
  // Left while the video is analysed: the analysis stops (its hidden <video> goes) and the temporary copy is deleted.
  await page.locator('input[type=file][accept="video/*"]').setInputFiles(media.set.file);
  const analysing = await visible(page, 'Analyzing your video…', 10_000);
  const beforeLeave = fake.callsTo('clearPickedFiles').length;
  await page.locator('a.back').first().click();
  const left = await heading(page, 'Back squat');
  const cleared3 = await until(() => fake.callsTo('clearPickedFiles').length > beforeLeave, 20_000);
  const stopped = await until(async () => ((await page.evaluate(() => document.querySelectorAll('video').length)) === 0 ? true : undefined), 20_000);
  check(
    'picked video: leaving while it is analysed stops the analysis (its hidden <video> removed) and deletes the temporary copy (clearPickedFiles)',
    analysing && left && !!cleared3 && !!stopped,
    `analysing ${analysing}; ${fake.callsTo('clearPickedFiles').length - beforeLeave} clears after leaving; video elements gone ${!!stopped}`,
  );
  await finish(l);

  // The camera test: the full model, under the native CSP (no 'unsafe-eval').
  const c = await launch('camera test', { allow: { mediapipe: true } });
  await seedLocal(c, { 'formcheck.v1.profile': JSON.stringify(ACCEPTED()) });
  await open(c, '#/camera');
  const startCam = c.page.getByRole('button', { name: 'Start camera' });
  await until(() => startCam.isEnabled().catch(() => false), 60_000);
  await startCam.click();
  const stats = await c.page
    .locator('pre.debug')
    .filter({ hasText: /full model · (GPU|CPU)/ })
    .first()
    .innerText({ timeout: 30_000 })
    .catch(() => '');
  check('camera test: the full pose model runs on the camera under the native CSP', /full model · (GPU|CPU)/.test(stats), short(stats.split('\n')[0], 120));
  await c.page.getByRole('button', { name: 'Stop' }).click();
  await finish(c);
}

/** 16: the self-test. */
/** A launch that runs the self-test (AppInfo.selfTest), with its marker once it came (240 s at most). */
async function runSelfTest(name, gate) {
  const fake = new Fake.FakeNative({ fileBase: ORIGIN, appInfo: { selfTest: true } });
  const dropped = gate ? C.GATE_PROBES.map((p) => `${p.pluginId}.${p.method}`) : [];
  const l = await launch(name, { fake, gate, allow: { mediapipe: true, cspProbe: true, dropped } });
  await l.page.goto(BASE);
  const readyLine = await ready(l.run);
  const line = await until(() => markerLines(l.run, C.MARKERS.selftest)[0], 240_000, 250);
  return { l, fake, readyLine, line, m: line ? C.readMarker(line, C.MARKERS.selftest) : undefined };
}

async function selfTest() {
  const { l, fake, readyLine, line, m } = await runSelfTest('self-test', false);
  const { run } = l;
  report.markers.readySelfTest = readyLine?.line;
  report.markers.selftest = line;
  report.selftest = m;
  check('self-test: one fitee:selftest marker, parsed from the console line as CI parses it, under CAPLog’s 4,068 characters', !!m && markerLines(run, C.MARKERS.selftest).length === 1 && line.length < 4068, line ? `${line.length} characters` : 'no marker');
  if (!m) return finish(l);
  const steps = ['video', 'snapshot', 'pose', 'csp', 'outside', 'keepAwake', 'gate'];
  const skipped = steps.filter((s) => m[s]?.skipped);
  check(
    'self-test: ok, with only the bridge gate (native-only: no webkit.messageHandlers.bridge here) reported as skipped',
    m.ok === true && JSON.stringify(skipped) === JSON.stringify(['gate']) && JSON.stringify(m.skipped) === JSON.stringify(['gate']) && m.gate.ok === true && typeof m.gate.skipped === 'string',
    `ok ${m.ok}; skipped ${JSON.stringify(m.skipped)}: ${m.gate?.skipped}`,
  );
  const failedSteps = steps.filter((s) => m[s]?.ok !== true);
  check('self-test: every other step passed', failedSteps.length === 0, failedSteps.map((s) => `${s}: ${m[s]?.error ?? short(m[s], 120)}`).join(' | ') || steps.filter((s) => s !== 'gate').join(', '));
  const rec = m.video?.recorded ?? {};
  check(
    'self-test: video: a canvas recording and a random 3 MiB + 5 file, each saved in chunks, listed, excluded, served by range and whole, and removed; the recording plays',
    m.video?.ok === true && rec.played === true && rec.listed && rec.range && rec.sha256 && rec.removed && m.video.random.listed && m.video.random.range && m.video.random.sha256 && m.video.random.removed && m.video.folderExcluded,
    `recorded ${rec.type} ${rec.bytes} bytes, played ${rec.played}; random ${m.video?.random?.bytes} bytes`,
  );
  check('self-test: snapshot (two copies, the first rotated to snapshot.prev.json), pose (GPU or CPU), csp (img-src), outside (blocked), keepAwake', m.snapshot?.revMatches && m.snapshot?.unitMatches && m.snapshot?.rotated === true && ['GPU', 'CPU'].includes(m.pose?.delegate) && m.csp?.directive === 'img-src' && m.outside?.result === 'blocked' && m.keepAwake?.ok, `pose ${m.pose?.delegate} in ${m.pose?.ms} ms, csp ${m.csp?.directive}, outside ${m.outside?.result}`);
  const probe = run.native.find((l2) => l2.includes(`${C.MARKERS.cspProbe} `));
  check('self-test: its CSP probe logs fitee:csp-probe (info), never fitee:csp', !!probe && consoleCall(probe)?.level === 'info' && !run.native.some((l2) => l2.includes(`${C.MARKERS.csp} `)), short(probe, 160));
  const leftovers = [...fake.sets.keys()].filter((k) => k.startsWith('selftest'));
  check('self-test: it leaves no file of its own behind, and no upload running', leftovers.length === 0 && fake.activeParts.size === 0, leftovers.join(', '));
  await finish(l);
}

/**
 * 16b: the self-test's gate step, whose code CI runs, against the stub's imitation of the gate (only the app has
 * the real one): the probes get no answer, and FiteeNative keeps its state.
 */
async function selfTestGate() {
  const g = await runSelfTest('self-test, stand-in gate', true);
  report.markers.selftestStandInGate = g.line;
  const probes = C.GATE_PROBES.map((p) => `${p.pluginId}.${p.method}`).sort();
  const prefix = `${C.MARKERS.dropped} message `;
  const dropped = g.l.run.native.filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length)).sort();
  const gate = g.m?.gate ?? {};
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(
    'self-test, stand-in gate: the gate step runs here (nothing skipped): every probe silent for 2 s, none answered, the prompt answered with null, no window, the navigation cancelled, the upload begun before them still running after, one fitee:dropped line each',
    g.m?.ok === true &&
      same(g.m.skipped, []) &&
      gate.ok === true &&
      gate.skipped === undefined &&
      same([...(gate.silent ?? [])].sort(), probes) &&
      same(gate.answered, []) &&
      gate.prompt === true &&
      gate.window === true &&
      gate.navigation === true &&
      gate.stateKept === true &&
      same(dropped, probes),
    g.m
      ? `ok ${g.m.ok}, skipped ${JSON.stringify(g.m.skipped)}; silent ${gate.silent?.length ?? 0}, answered ${JSON.stringify(gate.answered)}, prompt ${gate.prompt}, window ${gate.window}, navigation ${gate.navigation}, stateKept ${gate.stateKept}; ${dropped.length} dropped lines${gate.error ? `; ${gate.error}` : ''}`
      : 'no marker',
  );
  const sent = g.l.run.requests.filter((r) => /fitee-(window|nav)-probe/.test(r.url));
  check('self-test, stand-in gate: the window and navigation probes sent no request', sent.length === 0, sent.map((r) => r.url).join(', '));
  const left = [...g.fake.sets.keys()].filter((k) => k.startsWith('selftest'));
  check('self-test, stand-in gate: no file of its own behind (the gate step’s upload aborted), no upload running', left.length === 0 && g.fake.activeParts.size === 0, left.join(', '));
  await finish(g.l);
}

/** 17: a Release build prints nothing and never loads the Debug-only chunks. */
async function release() {
  const fake = new Fake.FakeNative({ fileBase: ORIGIN, appInfo: { debug: false } });
  const l = await launch('release build', { fake, debug: false });
  await l.page.goto(BASE);
  const welcome = await heading(l.page, 'Welcome to fitee');
  await sleep(1500);
  const chunks = server.requests(l.run.name).filter((e) => /\/assets\/(ready|selftest)-[^/]*\.js$/.test(e.path));
  const markers = l.run.console.filter((m) => /fitee:[a-z-]+ /.test(m.text));
  check(
    'release build: the app starts, never loads ready.ts or selftest.ts, and logs no marker',
    welcome && chunks.length === 0 && markers.length === 0,
    `${chunks.map((e) => e.path).join(', ') || 'no Debug chunks'}; ${markers.length} markers`,
  );
  const debugChunks = fs.readdirSync(path.join(DIST, 'assets')).filter((f) => /^(ready|selftest)-.*\.js$/.test(f));
  check('release build: ready.ts and selftest.ts are chunks of their own (shipped, only loaded in Debug builds)', debugChunks.length === 2, debugChunks.join(', '));
  await finish(l);
}

/** 18: Terms and Privacy. */
async function legal() {
  const l = await launch('terms and privacy');
  const { page } = l;
  await open(l, '#/terms');
  await heading(page, 'Terms of service');
  const terms = await page.locator('main').innerText();
  check(`terms: open before accepting, "Last updated ${T.updated}"`, terms.includes(`Last updated ${T.updated}`) && terms.includes('7. Ownership and licences'));
  const items = page.locator('.licences > li');
  const count = await items.count();
  const files = fs.readdirSync(path.join(ROOT, 'src/native/licenses')).filter((f) => f.endsWith('.txt'));
  check('terms: section 7 lists every licence in src/native/licenses/', count === T.licences.length && count === files.length && T.licences.every((x) => files.includes(x.file)), `${count} listed, ${files.length} files`);
  const wrong = [];
  for (let i = 0; i < count; i++) {
    const item = T.licences[i];
    const summary = items.nth(i).locator('summary');
    const label = (await summary.innerText()).trim();
    await summary.click();
    const pre = items.nth(i).locator('pre.licence');
    const want = fs.readFileSync(path.join(ROOT, 'src/native/licenses', item.file), 'utf8');
    const got = await until(async () => {
      const text = await pre.textContent();
      return text && text !== 'Loading…' ? text : undefined;
    }, 5000);
    if (label !== `${item.name} · ${item.licence}` || got !== want) wrong.push(`${item.file}: ${label === `${item.name} · ${item.licence}` ? 'text differs' : `label ${label}`}`);
  }
  check('terms: each licence opens to its full text (loaded when opened)', wrong.length === 0, wrong.join('; ') || `${count} opened`);
  // The licence list's text (the app's own CSS, src/native/native.css) against the page, with every opacity above it.
  const contrast = [];
  await page.mouse.move(1, 1); // no summary left hovered (it turns to the text colour)
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await sleep(400); // summaries change colour over 200 ms
    const worst = await page.evaluate(() => {
      const rgb = (c) => (c.match(/[\d.]+/g) ?? []).map(Number);
      const lum = (c) => {
        const [r, g, b] = c.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const bg = rgb(getComputedStyle(document.body).backgroundColor);
      let min = Infinity;
      let what = '';
      for (const el of document.querySelectorAll('.licences summary, .licences pre.licence')) {
        const [r, g, b, a = 1] = rgb(getComputedStyle(el).color);
        let alpha = a;
        for (let n = el; n; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity);
        const seen = [r, g, b].map((v, i) => v * alpha + bg[i] * (1 - alpha));
        const [hi, lo] = [lum(seen), lum(bg)].sort((x, y) => y - x);
        const ratio = (hi + 0.05) / (lo + 0.05);
        if (ratio < min) [min, what] = [ratio, el.tagName.toLowerCase()];
      }
      return { ratio: Math.round(min * 100) / 100, what };
    });
    contrast.push({ scheme, ...worst });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  check(
    'terms: the licence list’s text passes WCAG AA (4.5:1) on the page in both themes',
    contrast.every((c) => c.ratio >= 4.5),
    contrast.map((c) => `${c.scheme}: lowest ${c.ratio}:1 (${c.what})`).join(', '),
  );
  // Section 7 with its list, and then the first licence open (each scrolled to just below the status strip).
  await page.evaluate(() => document.querySelectorAll('.licences details').forEach((d) => (d.open = false)));
  await scrollToIt(page, '.legal h2', { text: '7. Ownership and licences' });
  await shoot(page, 'terms-licences');
  await page.evaluate(() => (document.querySelector('.licences details').open = true));
  await scrollToIt(page, '.licences');
  await shoot(page, 'terms-licence-open');
  await page.goto(`${BASE}#/privacy`);
  await heading(page, 'Privacy policy');
  const privacy = await page.locator('main').innerText();
  const WEB = /browser|home screen|offline copy|service worker|github/i;
  check('privacy: no browser, home screen, offline copy, service worker or GitHub wording (terms neither)', !WEB.test(privacy) && !WEB.test(terms), (WEB.exec(privacy) ?? WEB.exec(terms) ?? [''])[0]);
  check(
    'privacy: says what happens to a picked video’s temporary copy',
    privacy.includes('iOS gives the app a temporary copy of it. fitee deletes that copy when you leave that technique check, even before its results show') &&
      privacy.includes('the next time it starts, and when you delete all your data.'),
  );
  check(
    'terms: section 6 says each check’s skeleton replay is kept, not only what you choose to save, and never "only" on this iPhone',
    terms.includes('a skeleton replay of each technique check (kept for your last 60 checks') && !/stored only in the app/.test(terms),
  );
  await shoot(page, 'privacy-full', { full: true });
  await page.goto(BASE);
  await heading(page, 'Welcome to fitee');
  const welcome = await page.locator('main').innerText();
  check('welcome: "Your data stays on this iPhone and in your own backups", no web wording', welcome.includes('Your data stays on this iPhone and in your own backups') && !WEB.test(welcome));
  await finish(l);
}

// ---- Main --------------------------------------------------------------------------------------------------------

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('This tool needs Playwright with Chromium (the pre-installed one: NODE_PATH=/opt/node22/lib/node_modules:/usr/local/lib/node_modules_global; it does not install browsers).');
    process.exit(1);
  }
  fs.mkdirSync(WORK, { recursive: true });
  if (!KEEP_BUILD || !fs.existsSync(path.join(DIST, 'index.html'))) {
    console.log('Building the app’s copy (npm run build:native) …');
    execFileSync('npm', ['run', 'build:native', '--silent'], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
  }
  await loadContract();
  const sample = await sampleSet();

  server = createServer({ port: PORT, files: (name) => currentFake?.file(name) });
  server.setRoot(DIST);
  await server.listen();
  browser = await launchLocalOnly(chromium, { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const cutOff = await proveLocalOnly(browser).then(
    (m) => ({ ok: true, m }),
    (e) => ({ ok: false, m: e.message }),
  );
  check("the check's browser can't reach another site (a request to one fails on this machine)", cutOff.ok, cutOff.m);
  try {
    server.setPhase('build');
    await checkBuild();
    server.setPhase('media');
    const media = await makeVideos(sample.seq);
    report.media = { set: [media.set.type, media.set.bytes], pickMp4: [media.pickMp4.type, media.pickMp4.bytes], pickWebm: [media.pickWebm.type, media.pickWebm.bytes] };
    console.log(`Videos: the sample set ${media.set.type} ${media.set.bytes} bytes; picked ${media.pickMp4.type} and ${media.pickWebm.type}`);
    await firstLaunch();
    await copyRules();
    await invalidCurrent();
    await startError();
    await holdNewer();
    await settings();
    await copyFails();
    await deleteAll();
    await statusBar();
    await savedSet(sample, media.set);
    await reconcile(sample, media.set);
    await techniqueCheck(media);
    await selfTest();
    await selfTestGate();
    await release();
    await legal();
  } finally {
    await browser.close().catch(() => {});
    await server.close();
  }

  // In this order: the ready markers of the light, dark and self-test launches, then the self-test's marker (its
  // gate step skipped, as Chromium reports it) and the one from the run with the stand-in gate.
  const lines = [report.markers.readyLight, report.markers.readyDark, report.markers.readySelfTest, report.markers.selftest, report.markers.selftestStandInGate].filter(Boolean);
  fs.writeFileSync(path.join(WORK, 'markers.txt'), `${lines.join('\n')}\n`);
  for (const run of report.launches) delete run.fake;
  fs.writeFileSync(path.join(WORK, 'report.json'), JSON.stringify(report, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Report, markers.txt and screenshots in ${WORK}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
