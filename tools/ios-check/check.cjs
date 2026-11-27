// The judging half of CI's simulator check: tools/ios-check/simulator-check.sh drives xcrun and runs this for every
// check. It reads the app bundles, the console of each launch and the screenshots, and prints one GitHub annotation
// per problem ("::error::…", "::warning::…"). Everything that parses is here, in Node, because the macOS runner's bash
// is 3.2.
//
// The console markers, the bridge gate's probes and readMarker() come from src/native/bridge.ts (the native
// contract), loaded with Node's type stripping, so the check follows the contract as it changes.
//
//   check.cjs probe-url <url>                       the rules probe's URL: plain HTTP to this machine, and it answers
//   check.cjs bundle <App.app> <label> <info.json>  Info.plist, the files in the bundle, the privacy manifests;
//                                                   writes Info.plist as JSON to <info.json>
//   check.cjs bundle-id <info.json>                 prints CFBundleIdentifier
//   check.cjs launch <console> <light|dark|ipad|selftest> <info.json> [<probe url>]
//                                                   a Debug launch's console (see launch() below); ipad is the
//                                                   iPad's launch in the light appearance, judged as the light one
//   check.cjs release <console>                     the Release build logged nothing
//   check.cjs screen <png> <label> [--require]      how much of a screenshot isn't its background; --require fails a
//                                                   blank one
//
// Exit status: 0 when every check passed (warnings allowed), 1 when one failed, 2 for a usage error.
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTRACT = path.join(ROOT, 'src', 'native', 'bridge.ts');

let failed = false;

/** A workflow command's message must be one line; % starts an escape (as GitHub's own toolkit escapes it). */
const escapeData = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const error = (message) => {
  failed = true;
  console.log(`::error::${escapeData(message)}`);
};
const warning = (message) => console.log(`::warning::${escapeData(message)}`);
const notice = (message) => console.log(`::notice::${escapeData(message)}`);
const quote = (line, max = 240) => JSON.stringify(line.length > max ? `${line.slice(0, max)}…` : line);
const show = (value) => JSON.stringify(value) ?? String(value);

function usage(message) {
  console.error(`check.cjs: ${message}`);
  process.exit(2);
}

/** The console of a launch, line by line (the pseudo-terminal ends each line with \r\n). */
function readConsole(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.replace(/\r+$/, ''));
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// ---- probe-url ------------------------------------------------------------------------------------------------------

/** The hosts a rules-probe URL may name: this machine only, never another site (the review's nit 6). */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function probeUrl(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    url = undefined;
  }
  if (!url || url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || !url.port) {
    error(`The rules probe's URL ${quote(text)} isn't plain HTTP to this machine with a port (http://localhost:<port>/…): the probe never fetches another site`);
    process.exit(2);
  }
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 5000 }, (res) => {
      res.resume();
      if (res.statusCode === 200) console.log(`The rules probe's server answers at ${url.href} (HTTP 200)`);
      else error(`The rules probe's server at ${url.href} answered HTTP ${res.statusCode}, not 200`);
      resolve();
    });
    request.on('timeout', () => request.destroy(new Error('no answer in 5 s')));
    request.on('error', (err) => {
      error(`Nothing answers at the rules probe's URL ${url.href} (${err.message}): the workflow starts tools/ios-check/probe-server.cjs for it`);
      resolve();
    });
  });
}

// ---- bundle ---------------------------------------------------------------------------------------------------------

/** Files the app needs, relative to App.app; `empty` when the file may be empty. */
const REQUIRED = [
  { file: 'public/index.html', what: "the app's page" },
  { file: 'public/cordova.js', what: 'Capacitor injects it (written empty by npm run native:sync)', empty: true },
  { file: 'public/cordova_plugins.js', what: 'Capacitor injects it (written empty by npm run native:sync)', empty: true },
  { file: 'public/mediapipe/wasm/vision_wasm_internal.js', what: 'the pose runtime' },
  { file: 'public/mediapipe/wasm/vision_wasm_internal.wasm', what: 'the pose runtime' },
  { file: 'public/mediapipe/models/pose_landmarker_full.task', what: 'the full pose model' },
  { file: 'public/mediapipe/models/pose_landmarker_lite.task', what: 'the lite pose model (the camera test offers it)' },
  { file: 'capacitor.config.json', what: "Capacitor's settings (npm run native:sync)" },
  { file: 'config.xml', what: "Capacitor's Cordova settings (npm run native:sync)" },
  { file: 'PrivacyInfo.xcprivacy', what: "the app's privacy manifest" },
];

/** What the app mustn't ship (scripts/native-build.ts drops or never builds them). */
const FORBIDDEN = [
  { file: 'public/mediapipe/wasm/vision_wasm_nosimd_internal.wasm', what: 'the no-SIMD pose runtime (iOS 17 always has SIMD)' },
  { file: 'public/mediapipe/wasm/vision_wasm_nosimd_internal.js', what: 'the no-SIMD pose runtime (iOS 17 always has SIMD)' },
  { file: 'public/sw.js', what: "the web app's service worker" },
  { file: 'public/about', what: 'the landing page' },
  { file: 'public/manifest.webmanifest', what: "the web app's manifest" },
];

/**
 * The SDK privacy manifests: Capacitor.podspec and CapacitorCordova.podspec ship theirs as resource bundles named
 * Capacitor and CapacitorCordova. Where CocoaPods puts a bundle depends on how the pods link (inside the framework
 * with use_frameworks!, in the app itself with static linkage), so they are looked for anywhere in the app.
 */
const SDK_MANIFESTS = [
  { bundle: 'Capacitor.bundle', sdk: 'Capacitor' },
  { bundle: 'CapacitorCordova.bundle', sdk: 'Cordova (CapacitorCordova)' },
];

/** Every PrivacyInfo.xcprivacy under `dir`, as paths relative to it (symbolic links aren't followed). */
function privacyManifests(dir, rel = '') {
  const found = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...privacyManifests(dir, child));
    else if (entry.isFile() && entry.name === 'PrivacyInfo.xcprivacy') found.push(child);
  }
  return found;
}

function plutil(args) {
  return execFileSync('plutil', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const failText = (err) => String((err.stderr || err.stdout || err.message || err)).trim().split('\n')[0];

function bundle(app, label, infoOut) {
  const name = `${label} app`;
  if (!fs.existsSync(app) || !fs.statSync(app).isDirectory()) return error(`${name}: there is no app at ${app}`);

  let info;
  try {
    info = JSON.parse(plutil(['-convert', 'json', '-o', '-', path.join(app, 'Info.plist')]));
  } catch (err) {
    return error(`${name}: plutil couldn't read Info.plist as JSON: ${failText(err)}`);
  }
  fs.writeFileSync(infoOut, `${JSON.stringify(info, null, 2)}\n`);

  const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
  const keys = [
    ['CFBundleIdentifier', nonEmpty, 'a bundle ID'],
    ['CFBundleShortVersionString', nonEmpty, 'a version (MARKETING_VERSION)'],
    ['CFBundleVersion', nonEmpty, 'a build number (CURRENT_PROJECT_VERSION)'],
    ['MinimumOSVersion', (v) => v === '17.0', '"17.0" (IPHONEOS_DEPLOYMENT_TARGET)'],
    ['UIDeviceFamily', (v) => isDeepStrictEqual(v, [1]), '[1]: iPhone only (TARGETED_DEVICE_FAMILY = 1)'],
    ['NSCameraUsageDescription', nonEmpty, 'a text: iOS ends an app that opens the camera without one'],
    ['NSMicrophoneUsageDescription', nonEmpty, 'a text: iOS ends the app if Take Video records sound without one'],
    ['ITSAppUsesNonExemptEncryption', (v) => v === false, 'false: no export-compliance questions at every upload'],
  ];
  for (const [key, ok, expected] of keys) {
    if (!ok(info[key])) error(`${name}: Info.plist ${key} is ${show(info[key])}, expected ${expected}`);
  }

  for (const { file, what, empty } of REQUIRED) {
    const at = path.join(app, file);
    if (!fs.existsSync(at) || !fs.statSync(at).isFile()) error(`${name}: ${file} is missing (${what})`);
    else if (!empty && fs.statSync(at).size === 0) error(`${name}: ${file} is empty (${what})`);
  }
  for (const { file, what } of FORBIDDEN) {
    if (fs.existsSync(path.join(app, file))) error(`${name}: ${file} is in the app, and mustn't be (${what})`);
  }

  const manifests = privacyManifests(app);
  for (const { bundle: folder, sdk } of SDK_MANIFESTS) {
    if (!manifests.some((m) => m.split('/').includes(folder))) {
      error(`${name}: no privacy manifest from ${sdk} (PrivacyInfo.xcprivacy in a ${folder}, wherever CocoaPods puts it); found: ${manifests.join(', ') || 'none'}`);
    }
  }
  for (const manifest of manifests) {
    try {
      plutil(['-lint', path.join(app, manifest)]);
    } catch (err) {
      error(`${name}: ${manifest} isn't a valid property list: ${failText(err)}`);
    }
  }

  const configFile = path.join(app, 'capacitor.config.json');
  if (fs.existsSync(configFile)) {
    let config;
    try {
      config = readJson(configFile);
    } catch (err) {
      error(`${name}: capacitor.config.json isn't JSON (${err.message})`);
    }
    if (config && config.server && config.server.url !== undefined) {
      error(`${name}: capacitor.config.json sets server.url (${show(config.server.url)}): the app would load its page from there instead of from inside the app`);
    }
    if (config && config.appId !== info.CFBundleIdentifier) {
      error(`${name}: capacitor.config.json's appId ${show(config.appId)} isn't the app's bundle ID ${show(info.CFBundleIdentifier)}: run npm run native:sync before building`);
    }
  }

  console.log(`${name}: ${info.CFBundleIdentifier} ${info.CFBundleShortVersionString} (${info.CFBundleVersion}), privacy manifests: ${manifests.join(', ') || 'none'}`);
}

// ---- launch ---------------------------------------------------------------------------------------------------------

const TITLES = { light: 'Light launch', dark: 'Dark launch', ipad: 'iPad launch', selftest: 'Self-test launch' };

/** The appearance each launch with a ready marker runs in (the iPad's: light). */
const LOOK = { light: 'light', dark: 'dark', ipad: 'light' };

/** Capacitor's console line for a console.* call in the page: "⚡️  [level] - message" (Plugins/Console.swift). */
const CONSOLE_CALL = /\[(debug|error|info|log|trace|warn)\] - /;

/** MediaPipe's own stderr, which Emscripten writes with console.error: "INFO: …" and glog lines ("W1127 …", "E0000 …"). */
const MEDIAPIPE = /^(INFO:|[IWE]\d{4}(\s|$))/;

/** Lines Capacitor prints only when something is wrong (CapacitorBridge.swift, CAPBridgeViewController.swift, JSExport.swift, WebViewDelegationHandler.swift). */
const CAPACITOR_FAILURES = [
  [/Capacitor: FATAL ERROR/, "Capacitor couldn't set up its JavaScript bridge"],
  [/^(⚡️? +)?ERROR: /, 'Capacitor reported a missing or unreadable file'],
  [/WebView process terminated/, "the web view's process ended (Capacitor reloads the page)"],
  [/WebView failed (to load|provisional navigation)/, "the app's page didn't load"],
  [/Unable to (find|parse) (capacitor\.config\.json|config\.xml)/, "the bundle's Capacitor settings are missing or broken (npm run native:sync)"],
  [/Error loading plugin |Unable to load plugin /, "a call named a plugin Capacitor doesn't have"],
  [/Error calling method |does not respond to method call/, "a call named a method its plugin doesn't have: the page and the Swift code don't follow the same contract"],
  [/Unable to serialize plugin response/, "a plugin's answer couldn't be sent to the page"],
];

/** The facts of the ready marker CI requires (ReadyMarker in src/native/bridge.ts). */
const READY_FACTS = [
  ['origin', (v) => v === 'capacitor://localhost', '"capacitor://localhost": the user\'s data lives under that origin'],
  ['urlOrigin', (v) => v === 'capacitor://localhost', '"capacitor://localhost": src/privacy.ts compares it with location.origin, and blocks the app\'s own files otherwise'],
  ['ownFile', (v) => v === 200, '200: the full pose model, fetched through src/privacy.ts'],
  ['wasmType', (v) => typeof v === 'string' && v.split(';')[0].trim().toLowerCase() === 'application/wasm', '"application/wasm": the content type the pose runtime is served with'],
  ['outside', (v) => v === 'blocked', '"blocked": src/privacy.ts must refuse a request that would leave the app'],
  ['secure', (v) => v === true, 'true: the camera needs a secure context'],
  ['camera', (v) => v === true, 'true (navigator.mediaDevices.getUserMedia)'],
  ['recorder', (v) => v === true, 'true (MediaRecorder)'],
  ['simd', (v) => v === true, 'true: the app ships only the SIMD pose runtime'],
  ['sw', (v) => v === false, 'false: a WKWebView app has no service worker'],
  ['rules', (v) => v === true, 'true: the content rules (FiteeContentRules.swift) must be on the web view'],
  ['gate', (v) => v === true, "true: the bridge gate (FiteeViewController.swift) must be in front of Capacitor's message handler"],
];

/** The status bar text the page must leave in each appearance: dark text on Paper, light text on Molten. */
const STATUS_BAR = { light: 'dark-text', dark: 'light-text' };

/** The steps of SelfTestMarker in src/native/bridge.ts. */
const SELF_TEST_STEPS = ['video', 'snapshot', 'pose', 'csp', 'outside', 'keepAwake', 'gate'];

/** The text after `marker ` in a line, if the line has it. */
function after(line, marker) {
  const at = line.indexOf(`${marker} `);
  return at < 0 ? undefined : line.slice(at + marker.length + 1).trim();
}

/** The one JSON marker of a kind in a console: its parsed value, or undefined after reporting why there isn't one. */
function oneMarker(lines, c, marker, title, { many = 'error' } = {}) {
  const found = lines.filter((line) => line.includes(`${marker} `));
  if (found.length === 0) {
    error(`${title}: no ${marker} marker`);
    return undefined;
  }
  if (found.length > 1) {
    const message = `${title}: ${found.length} ${marker} markers (the page loaded more than once?)`;
    if (many === 'error') error(message);
    else warning(message);
  }
  const value = c.readMarker(found[found.length - 1], marker);
  if (value === undefined || value === null || typeof value !== 'object') {
    error(`${title}: the ${marker} marker isn't valid JSON (Capacitor cuts a printed line at 4,068 characters): ${quote(found[found.length - 1])}`);
    return undefined;
  }
  return value;
}

/** What every Debug launch must show: one bridge, no error of any kind, nothing past the bridge gate it shouldn't. */
function commonChecks(lines, c, kind, title) {
  const loads = lines.filter((line) => line.includes('Loading app at')).length;
  if (loads !== 1) error(`${title}: ${loads} "Loading app at" lines, expected exactly one (one bridge, one page load)`);

  for (const [index, line] of lines.entries()) {
    if (line.includes(`${c.MARKERS.uncaught} `)) error(`${title}: an uncaught error in the page: ${quote(line)}`);
    if (line.includes(`${c.MARKERS.csp} `)) error(`${title}: the page's CSP blocked something: ${quote(line)}`);
    if (line.includes('STARTUP JS ERROR')) {
      const detail = lines.slice(index + 1).find((next) => next.trim() !== '') ?? '';
      error(`${title}: Capacitor reported a JavaScript error: ${quote(detail)}`);
    }
    if (line.includes('[error]')) {
      const call = CONSOLE_CALL.exec(line);
      const text = call ? line.slice(call.index + call[0].length) : line;
      if (!(kind === 'selftest' && MEDIAPIPE.test(text))) {
        error(`${title}: an error line in the console${kind === 'selftest' ? ' (only MediaPipe\'s own INFO, I, W and E lines are allowed here)' : ''}: ${quote(line)}`);
      }
    }
    for (const [pattern, why] of CAPACITOR_FAILURES) {
      if (pattern.test(line)) error(`${title}: ${why}: ${quote(line)}`);
    }
  }

  // The bridge gate: nothing it must drop may reach Capacitor's own handler, which prints "To Native ->  <plugin> <method> <id>".
  const probed = new Set(c.GATE_PROBES.map((p) => p.pluginId));
  for (const line of lines) {
    const passed = /To Native -> +(\S+) (\S+)/.exec(line);
    if (passed && probed.has(passed[1])) error(`${title}: ${passed[1]}.${passed[2]} reached Capacitor's own handler: the bridge gate let it through: ${quote(line)}`);
    if (line.includes('To Native Cordova -> ')) error(`${title}: a Cordova call reached Capacitor's own handler: the bridge gate let it through: ${quote(line)}`);
  }

  const dropped = lines.map((line) => after(line, c.MARKERS.dropped)).filter((v) => v !== undefined);
  if (kind === 'selftest') {
    const expected = c.GATE_PROBES.map((p) => `message ${p.pluginId}.${p.method}`);
    for (const probe of expected) {
      if (!dropped.includes(probe)) error(`${title}: no "${c.MARKERS.dropped} ${probe}" line: the bridge gate must drop that call (GATE_PROBES in src/native/bridge.ts)`);
    }
    for (const line of new Set(dropped.filter((d) => !expected.includes(d)))) {
      error(`${title}: the bridge gate dropped a call the self-test didn't make: ${quote(`${c.MARKERS.dropped} ${line}`)} (the page, or native-bridge.js, called a plugin the gate doesn't allow)`);
    }
  } else {
    for (const line of new Set(dropped)) {
      error(`${title}: the bridge gate dropped a call: ${quote(`${c.MARKERS.dropped} ${line}`)}: the page, or native-bridge.js, called a plugin the gate doesn't allow, and that call never gets an answer`);
    }
  }
}

function readyChecks(lines, c, kind, title, info) {
  const ready = oneMarker(lines, c, c.MARKERS.ready, title);
  if (ready) {
    for (const [key, ok, expected] of READY_FACTS) {
      if (!ok(ready[key])) error(`${title}: ${c.MARKERS.ready} ${key} is ${show(ready[key])}, expected ${expected}`);
    }
    if (ready.version !== info.CFBundleShortVersionString || ready.build !== info.CFBundleVersion) {
      error(`${title}: ${c.MARKERS.ready} reports version ${show(ready.version)} (${show(ready.build)}), but Info.plist says ${show(info.CFBundleShortVersionString)} (${show(info.CFBundleVersion)}): appInfo must read them from the bundle`);
    }
  }
  const bars = lines.map((line) => after(line, c.MARKERS.statusbar)).filter((v) => v !== undefined);
  const want = STATUS_BAR[LOOK[kind]];
  if (bars.length === 0) error(`${title}: no ${c.MARKERS.statusbar} line: the page never set the status bar style (src/native/statusBar.ts)`);
  else if (bars[bars.length - 1] !== want) {
    error(`${title}: the status bar ends with ${show(bars[bars.length - 1])} text, expected ${show(want)} in the ${LOOK[kind]} appearance (all: ${bars.join(', ')})`);
  }
  if (ready && !failed) console.log(`${title}: ${READY_FACTS.length + 1} facts of ${c.MARKERS.ready} as required, status bar ${want}, one bridge, no error lines`);
}

function selfTestChecks(lines, c, title, url) {
  const marker = oneMarker(lines, c, c.MARKERS.selftest, title);
  if (marker) {
    for (const name of SELF_TEST_STEPS) {
      const step = marker[name];
      if (!step || typeof step !== 'object') error(`${title}: the ${c.MARKERS.selftest} marker has no ${name} step (src/native/selftest.ts and the contract disagree)`);
      else if (step.ok !== true) error(`${title}: the ${name} step failed: ${step.error ?? show(step)}`);
      // A step skips itself only outside the app, where what it tests isn't there (SelfTestStep.skipped): never here.
      else if (step.skipped !== undefined) error(`${title}: the ${name} step was skipped (${show(step.skipped)}): in the app every step must run`);
    }
    if (Array.isArray(marker.skipped) && marker.skipped.length) error(`${title}: ${c.MARKERS.selftest} lists skipped steps: ${marker.skipped.join(', ')}`);
    if (marker.ok !== true && SELF_TEST_STEPS.every((name) => marker[name] && marker[name].ok === true)) {
      error(`${title}: ${c.MARKERS.selftest} says ok ${show(marker.ok)}, though every step passed`);
    }

    const pose = marker.pose;
    if (pose && pose.ok === true) {
      if (pose.delegate === 'GPU' || pose.delegate === 'CPU') notice(`${title}: the pose model loaded with the ${pose.delegate} delegate in ${pose.ms} ms`);
      else error(`${title}: the pose step passed without saying which delegate the model runs on: ${show(pose.delegate)}`);
    }

    const gate = marker.gate;
    if (gate && typeof gate === 'object') {
      const silent = Array.isArray(gate.silent) ? gate.silent : [];
      const answered = Array.isArray(gate.answered) ? gate.answered : [];
      if (answered.length) error(`${title}: calls the bridge gate must drop got an answer: ${answered.join(', ')}`);
      for (const p of c.GATE_PROBES) {
        const call = `${p.pluginId}.${p.method}`;
        if (!silent.includes(call) && !answered.includes(call)) error(`${title}: the gate step didn't try ${call} (GATE_PROBES)`);
      }
      if (gate.stateKept !== true) error(`${title}: after the gate's probes FiteeNative had lost its state (a second FiteeNative took its place?)`);
    }

    const recorded = marker.video && marker.video.recorded;
    if (recorded && recorded.played === 'skipped') {
      warning(`${title}: no recording could be made from a canvas here (${recorded.error ?? 'no reason given'}), so the playback of a recorded video wasn't checked; the random file's checks ran`);
    }
  }

  const rules = oneMarker(lines, c, c.MARKERS.rules, title);
  if (rules) {
    if (rules.url !== url) error(`${title}: the rules probe fetched ${show(rules.url)}, not the URL it was given after ${c.PROBE_URL_ARG} (${show(url)})`);
    if (rules.withRules !== 'blocked') error(`${title}: with the app's content rules the probe's request was ${show(rules.withRules)}, expected "blocked" (FiteeContentRules.swift)`);
    if (rules.withoutRules !== 'loaded') {
      warning(`${title}: without the content rules the probe's request was ${show(rules.withoutRules)}, not "loaded", so the probe can't show what the rules change`);
    }
  }
  if (marker && rules && !failed) console.log(`${title}: every self-test step passed, the content rules blocked the probe, and the bridge gate dropped all ${c.GATE_PROBES.length} probes`);
}

async function launch(file, kind, infoFile, url) {
  const title = TITLES[kind];
  if (!title) usage(`unknown launch "${kind}" (light, dark, ipad or selftest)`);
  if (kind === 'selftest' && !url) usage('the self-test launch needs the probe URL');
  const c = await import(pathToFileURL(CONTRACT).href);
  const lines = readConsole(file);
  if (lines.every((line) => line.trim() === '')) error(`${title}: the console is empty`);
  commonChecks(lines, c, kind, title);
  if (kind === 'selftest') selfTestChecks(lines, c, title, url);
  else {
    let info = {};
    try {
      info = readJson(infoFile);
    } catch {
      error(`${title}: Info.plist's JSON (${infoFile}) can't be read`);
    }
    readyChecks(lines, c, kind, title, info);
  }
}

// ---- release ----------------------------------------------------------------------------------------------------

/** A Release build never logs (loggingBehavior 'debug' in capacitor.config.ts; the fitee: prints are Debug-only). */
function release(file) {
  const logged = readConsole(file).filter((line) => line.includes('⚡') || line.includes('fitee:'));
  if (logged.length) {
    error(`Release launch: the Release build logged ${logged.length} line${logged.length === 1 ? '' : 's'}, and must log nothing (Debug builds only): ${logged.slice(0, 3).map((l) => quote(l, 120)).join(' ')}`);
  } else console.log('Release launch: kept running and logged nothing');
}

// ---- screen -------------------------------------------------------------------------------------------------------

/** Decodes a PNG (non-interlaced; grey, RGB, palette, grey + alpha or RGBA; 8 or 16 bits) into an RGB reader. */
function decodePng(buf) {
  const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let interlace = 0;
  let palette;
  const data = [];
  for (let at = 8; at + 8 <= buf.length; ) {
    const length = buf.readUInt32BE(at);
    const kind = buf.toString('latin1', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (kind === 'PLTE') palette = body;
    else if (kind === 'IDAT') data.push(body);
    else if (kind === 'IEND') break;
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!width || !height || !channels) throw new Error(`no image header, or colour type ${type}`);
  if (interlace) throw new Error('an interlaced PNG');
  if (type === 3 ? depth !== 8 || !palette : depth !== 8 && depth !== 16) throw new Error(`colour type ${type} at ${depth} bits`);
  const bpp = (channels * depth) / 8;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(data));
  if (raw.length < height * (stride + 1)) throw new Error('the image data is cut short');
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = up[x];
      const c = x >= bpp ? up[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`filter ${filter} on row ${y}`);
      out[x] = v & 255;
    }
  }
  const step = depth / 8; // the high byte of a 16-bit sample comes first
  const rgb = (x, y) => {
    const i = y * stride + x * bpp;
    if (type === 3) return [palette[pixels[i] * 3], palette[pixels[i] * 3 + 1], palette[pixels[i] * 3 + 2]];
    if (type === 0 || type === 4) return [pixels[i], pixels[i], pixels[i]];
    return [pixels[i], pixels[i + step], pixels[i + 2 * step]];
  };
  return { width, height, rgb };
}

/** A screenshot shows something when this much of it differs from its commonest colour. */
const MIN_SHARE = 0.005;

/**
 * How much of the screen between the status bar and the home indicator (the middle 80% of the height) differs from
 * that part's commonest colour by more than 40 in a channel. A page that never painted, a blank web view or the
 * launch colour alone gives about 0; the Welcome screen several percent.
 */
function screenShare(png) {
  const top = Math.floor(png.height * 0.1);
  const bottom = Math.ceil(png.height * 0.9);
  const counts = new Map();
  const samples = [];
  for (let y = top; y < bottom; y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      const [r, g, b] = png.rgb(x, y);
      const key = (r << 16) | (g << 8) | b;
      samples.push(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let main = 0;
  let most = -1;
  for (const [key, n] of counts) {
    if (n > most) {
      most = n;
      main = key;
    }
  }
  const far = (key) => Math.max(Math.abs((key >> 16) - (main >> 16)), Math.abs(((key >> 8) & 255) - ((main >> 8) & 255)), Math.abs((key & 255) - (main & 255))) > 40;
  const differs = samples.filter(far).length;
  return { share: samples.length ? differs / samples.length : 0, main: `#${main.toString(16).padStart(6, '0')}`, colours: counts.size };
}

function screen(file, label, required) {
  let png;
  try {
    png = decodePng(fs.readFileSync(file));
  } catch (err) {
    const message = `${label}: can't be read as an image (${err.message})`;
    if (required) error(`${message}, so it can't be shown not to be blank`);
    else warning(message);
    return;
  }
  const { share, main, colours } = screenShare(png);
  console.log(`${label}: ${png.width}×${png.height}, ${(share * 100).toFixed(1)}% of the screen differs from its main colour ${main} (${colours} colours)`);
  if (required && share < MIN_SHARE) {
    error(`${label} is blank: only ${share.toFixed(4)} of the screen between the status bar and the home indicator differs from ${main} (at least ${MIN_SHARE} expected): the page didn't paint`);
  }
}

// ---- main -------------------------------------------------------------------------------------------------------

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'probe-url' && args.length === 1) await probeUrl(args[0]);
  else if (command === 'bundle' && args.length === 3) bundle(args[0], args[1], args[2]);
  else if (command === 'bundle-id' && args.length === 1) {
    let id;
    try {
      id = readJson(args[0]).CFBundleIdentifier;
    } catch (err) {
      usage(`${args[0]} can't be read (${err.message})`);
    }
    if (typeof id !== 'string' || !id) usage(`${args[0]} has no CFBundleIdentifier`);
    console.log(id);
  } else if (command === 'launch' && (args.length === 3 || args.length === 4)) await launch(args[0], args[1], args[2], args[3]);
  else if (command === 'release' && args.length === 1) release(args[0]);
  else if (command === 'screen' && (args.length === 2 || (args.length === 3 && args[2] === '--require'))) screen(args[0], args[1], args.length === 3);
  else usage(`unknown command or arguments: ${process.argv.slice(2).join(' ')} (see the header of tools/ios-check/check.cjs)`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.log(`::error::${escapeData(`tools/ios-check/check.cjs failed: ${err && err.stack ? err.stack : err}`)}`);
  process.exitCode = 1;
});
