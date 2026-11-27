// CI's simulator check (tools/ios-check/simulator-check.sh, which .github/workflows/ios.yml runs on the macOS runner),
// run here against stub xcrun and plutil (tools/ios-check/stub/) that replay scripted consoles: a good run passes, and
// each way a bundle or a launch can go wrong fails with its ::error:: line. Also: the script stays bash-3.2-safe (the
// runner's bash), the simulator picker, the probe server, the PNG reader, and what the workflow must keep doing.
//
// IOS_CHECK_BASH names the bash to run the script with (default: bash on the PATH): the workflow runs this file on the
// macOS runner with /bin/bash, its bash 3.2, before it builds anything.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import config from '../capacitor.config.ts';
import { GATE_PROBES, MARKERS, PROBE_URL_ARG, SELF_TEST_ARG, type ReadyMarker, type RulesMarker, type SelfTestMarker } from '../src/native/bridge.ts';

const ROOT = join(__dirname, '..');
const TOOLS = join(ROOT, 'tools/ios-check');
const SCRIPT = join(TOOLS, 'simulator-check.sh');
const BASH = process.env.IOS_CHECK_BASH || 'bash';
const UDID = '0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0';
/** The iPad simulator: shut down until the script boots it (the stub's STUB_IPAD). */
const IPAD = 'A0B1C2D3-E4F5-4A6B-8C7D-9E0F1A2B3C4D';

const dirs: string[] = [];
const tmp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

// ---- the probe server (tools/ios-check/probe-server.cjs) ---------------------------------------------------------

let server: ChildProcess | undefined;
let PROBE = '';
beforeAll(async () => {
  const portFile = join(tmp('ios-probe-'), 'port');
  server = spawn(process.execPath, [join(TOOLS, 'probe-server.cjs'), portFile], { stdio: 'ignore' });
  const port = () => (existsSync(portFile) ? readFileSync(portFile, 'utf8').trim() : '');
  for (let i = 0; i < 100 && !port(); i++) await new Promise((r) => setTimeout(r, 50));
  PROBE = `http://localhost:${port()}/fitee-rules-probe`;
});
afterAll(() => {
  server?.kill();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

// ---- PNG files, for the stub's screenshots and the reader -------------------------------------------------------

type Rgb = readonly [number, number, number];

/** A PNG of `paint`, in colour type 2 (RGB), 6 (RGBA), 0 (grey) or 3 (palette), 8 or 16 bits, each row with the next of the five filters. */
function png(width: number, height: number, paint: (x: number, y: number) => Rgb, { type = 2, depth = 8 }: { type?: 0 | 2 | 3 | 6; depth?: 8 | 16 } = {}): Buffer {
  const chunk = (kind: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(kind, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const palette: Rgb[] = [];
  const index = (c: Rgb) => {
    const at = palette.findIndex((p) => p.every((v, i) => v === c[i]));
    return at >= 0 ? at : palette.push(c) - 1;
  };
  const channels = { 0: 1, 2: 3, 3: 1, 6: 4 }[type];
  const bytes = depth / 8;
  const bpp = channels * bytes;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * bpp);
    for (let x = 0; x < width; x++) {
      const c = paint(x, y);
      const samples = type === 3 ? [index(c)] : type === 0 ? [c[0]] : type === 6 ? [...c, 255] : [...c];
      samples.forEach((v, i) => {
        row[x * bpp + i * bytes] = v;
        if (bytes === 2) row[x * bpp + i * bytes + 1] = 0x5a;
      });
    }
    rows.push(row);
  }
  const filtered = rows.map((row, y) => {
    const filter = y % 5;
    const up = y ? rows[y - 1] : Buffer.alloc(row.length);
    const out = Buffer.alloc(row.length + 1);
    out[0] = filter;
    for (let x = 0; x < row.length; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = up[x];
      const c = x >= bpp ? up[x - bpp] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const predictor = [0, a, b, (a + b) >> 1, paeth][filter];
      out[x + 1] = (row[x] - predictor) & 255;
    }
    return out;
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = type;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...(type === 3 ? [chunk('PLTE', Buffer.from(palette.flat()))] : []),
    chunk('IDAT', deflateSync(Buffer.concat(filtered))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PAPER: Rgb = [0xf4, 0xec, 0xe2];
const INK: Rgb = [0x1e, 0x14, 0x12];
/** A Welcome screen, roughly: the page colour with a status bar, a headline, a button and a home indicator. */
const welcome = (x: number, y: number): Rgb => (y < 8 || y > 112 || (y > 30 && y < 50 && x > 10 && x < 50) || (y > 80 && y < 95) ? INK : PAPER);
const SCREEN = png(60, 120, welcome);
/** The launch colour alone, with the status bar and the home indicator a blank page still has. */
const BLANK = png(60, 120, (_, y) => (y < 8 || y > 112 ? INK : PAPER));

// ---- a scenario: two app bundles, five consoles, the screenshots --------------------------------------------------

const ready = (over: Partial<ReadyMarker> = {}): ReadyMarker => ({
  version: '1.0.0',
  build: '1',
  rules: true,
  gate: true,
  origin: 'capacitor://localhost',
  urlOrigin: 'capacitor://localhost',
  ownFile: 200,
  wasmType: 'application/wasm',
  outside: 'blocked',
  secure: true,
  camera: true,
  recorder: true,
  simd: true,
  sw: false,
  hash: '',
  ...over,
});

const PROBED = GATE_PROBES.map((p) => `${p.pluginId}.${p.method}`);
const VIDEO = { ok: true, type: 'video/mp4', bytes: 48211, listed: true, excluded: true, range: true, sha256: true, removed: true };
const selftest = (over: Partial<SelfTestMarker> = {}): SelfTestMarker => ({
  ok: true,
  video: { ok: true, folderExcluded: true, recorded: { ...VIDEO, played: true }, random: { ...VIDEO, bytes: 3145733 } },
  snapshot: { ok: true, rev: 3, revMatches: true, unitMatches: true, rotated: true },
  pose: { ok: true, delegate: 'GPU', ms: 4210 },
  csp: { ok: true, directive: 'img-src' },
  outside: { ok: true, result: 'blocked' },
  keepAwake: { ok: true },
  gate: { ok: true, silent: PROBED, answered: [], stateKept: true },
  ...over,
});
const rules = (over: Partial<RulesMarker> = {}): RulesMarker => ({ url: PROBE, withRules: 'blocked', withoutRules: 'loaded', ...over });

const info = (line: string) => `⚡️  [info] - ${line}`;
const readyLine = (over: Partial<ReadyMarker> = {}) => info(`${MARKERS.ready} ${JSON.stringify(ready(over))}`);

/** A Debug launch in an appearance, as Capacitor 8.6.3 and the app's Swift code print it (CAPLog to stdout). */
const lookConsole = (look: 'light' | 'dark', readyOver: Partial<ReadyMarker> = {}) => [
  '⚡️  Loading app at capacitor://localhost...',
  'fitee:statusbar default',
  '⚡️  WebView loaded',
  '⚡️  To Native ->  FiteeNative appInfo 71520343',
  '⚡️  TO JS {"version":"1.0.0","build":"1","debug":true,"selfTest":false,"rules":true,"gate":true}',
  '⚡️  To Native ->  FiteeNative readSnapshot 71520344',
  '⚡️  TO JS {}',
  '⚡️  To Native ->  FiteeNative setAppearance 71520345',
  '⚡️  To Native ->  SystemBars setStyle 71520346',
  `fitee:statusbar ${look === 'light' ? 'dark-text' : 'light-text'}`,
  readyLine(readyOver),
];

const selftestConsole = (marker: SelfTestMarker | string = selftest(), rulesMarker: RulesMarker | string = rules()) => [
  '⚡️  Loading app at capacitor://localhost...',
  'fitee:statusbar default',
  '⚡️  WebView loaded',
  `${MARKERS.rules} ${typeof rulesMarker === 'string' ? rulesMarker : JSON.stringify(rulesMarker)}`,
  '⚡️  To Native ->  FiteeNative appInfo 1020',
  'fitee:statusbar light-text',
  readyLine(),
  info(`${MARKERS.cspProbe} img-src http://127.0.0.1:9`),
  ...GATE_PROBES.map((p) => `${MARKERS.dropped} message ${p.pluginId}.${p.method}`),
  '⚡️  [error] - INFO: Created TensorFlow Lite XNNPACK delegate for CPU.',
  '⚡️  [error] - W0000 00:00:1764237600.214031       1 gl_context_webgl.cc:151] Successfully created a WebGL context with major version 3 and handle 3',
  '⚡️  [error] - I0000 00:00:1764237600.215402       1 gl_context.cc:369] GL version: 3.0 (OpenGL ES 3.0 (WebGL 2.0)), renderer: Apple GPU',
  '⚡️  [error] - E0000 00:00:1764237600.402277       1 gl_graph_runner_internal.cc:71] Falling back to the CPU',
  info(`${MARKERS.selftest} ${typeof marker === 'string' ? marker : JSON.stringify(marker)}`),
];

type Launch = 'light' | 'dark' | 'selftest' | 'ipad' | 'release';

interface Scenario {
  /** Replaces a launch's console. */
  consoles?: Partial<Record<Launch, string[]>>;
  /** Changes to the Debug or the Release bundle: Info.plist keys (undefined removes one), files (null removes one). */
  debug?: AppEdit;
  release?: AppEdit;
  screens?: Partial<Record<Launch, Buffer>>;
  env?: Record<string, string>;
  /** The probe URL passed to the script (default: the probe server's). */
  probe?: string;
  /** The script's arguments, in place of the usual six. */
  args?: string[];
}

interface AppEdit {
  info?: Record<string, unknown>;
  files?: Record<string, string | null>;
}

const MANIFEST = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>NSPrivacyTracking</key><false/></dict></plist>\n';

/** An App.app as Xcode builds it with the CocoaPods project: dynamic frameworks with their resource bundles. */
function makeApp(dir: string, edit: AppEdit = {}) {
  const plist: Record<string, unknown> = {
    CFBundleIdentifier: config.appId,
    CFBundleShortVersionString: '1.0.0',
    CFBundleVersion: '1',
    CFBundleDisplayName: 'fitee',
    MinimumOSVersion: '17.0',
    UIDeviceFamily: [1],
    NSCameraUsageDescription: 'fitee uses the camera to give technique feedback on your sets.',
    NSMicrophoneUsageDescription: 'fitee doesn’t record sound itself.',
    ITSAppUsesNonExemptEncryption: false,
    ...edit.info,
  };
  const files: Record<string, string | null> = {
    'Info.plist': JSON.stringify(plist),
    'PrivacyInfo.xcprivacy': MANIFEST,
    'capacitor.config.json': JSON.stringify({ appId: config.appId, appName: 'fitee', server: { hostname: 'localhost', iosScheme: 'capacitor' }, packageClassList: [] }),
    'config.xml': "<?xml version='1.0' encoding='utf-8'?>\n<widget version=\"1.0.0\"></widget>",
    'public/index.html': '<!doctype html><title>fitee</title>',
    'public/cordova.js': '',
    'public/cordova_plugins.js': '',
    'public/mediapipe/wasm/vision_wasm_internal.js': 'runtime',
    'public/mediapipe/wasm/vision_wasm_internal.wasm': 'wasm',
    'public/mediapipe/models/pose_landmarker_full.task': 'full',
    'public/mediapipe/models/pose_landmarker_lite.task': 'lite',
    'Frameworks/Capacitor.framework/Capacitor': 'binary',
    'Frameworks/Capacitor.framework/Capacitor.bundle/PrivacyInfo.xcprivacy': MANIFEST,
    'Frameworks/Cordova.framework/Cordova': 'binary',
    'Frameworks/Cordova.framework/CapacitorCordova.bundle/PrivacyInfo.xcprivacy': MANIFEST,
    ...edit.files,
  };
  for (const [file, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
}

interface Result {
  code: number | null;
  out: string;
  errors: string[];
  warnings: string[];
  calls: string[][];
  dir: string;
}

function run(scenario: Scenario = {}): Promise<Result> {
  const dir = tmp('ios-check-');
  const stubDir = join(dir, 'scenario');
  const state = join(dir, 'state');
  mkdirSync(stubDir);
  mkdirSync(state);
  const debugApp = join(dir, 'debug/App.app');
  const releaseApp = join(dir, 'release/App.app');
  makeApp(debugApp, scenario.debug);
  makeApp(releaseApp, scenario.release);
  const consoles: Record<Launch, string[]> = {
    light: lookConsole('light'),
    dark: lookConsole('dark'),
    selftest: selftestConsole(),
    ipad: lookConsole('light'),
    release: ['2026-11-27 09:41:00.000 App[4211:90210] a system message that says nothing about fitee'],
    ...scenario.consoles,
  };
  for (const [launch, lines] of Object.entries(consoles)) writeFileSync(join(stubDir, `console-${launch}.txt`), `${lines.join('\n')}\n`);
  writeFileSync(join(stubDir, 'screen.png'), SCREEN);
  for (const [launch, picture] of Object.entries(scenario.screens ?? {})) writeFileSync(join(stubDir, `screen-${launch}.png`), picture);

  const args = scenario.args ?? [UDID, debugApp, releaseApp, join(dir, 'out'), scenario.probe ?? PROBE, IPAD];
  const env = {
    ...process.env,
    PATH: `${join(TOOLS, 'stub')}:${process.env.PATH}`,
    STUB_DIR: stubDir,
    STUB_STATE: state,
    STUB_IPAD: IPAD,
    READY_TIMEOUT: '3',
    SELFTEST_TIMEOUT: '3',
    RELEASE_ALIVE_SECONDS: '1',
    SETTLE_SECONDS: '0',
    ...scenario.env,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(BASH, [SCRIPT, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => {
      const lines = out.split('\n');
      const callsFile = join(state, 'calls.log');
      const calls = existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]) : [];
      resolve({
        code,
        out,
        errors: lines.filter((l) => l.startsWith('::error::')),
        warnings: lines.filter((l) => l.startsWith('::warning::')),
        calls,
        dir,
      });
    });
  });
}

interface Judged {
  code: number | null;
  out: string;
  errors: string[];
}

/** The run, or check.cjs, failed, and one of its ::error:: lines says `what` (each listed piece, in that line). */
function expectError(result: Judged, ...what: string[]) {
  const hit = result.errors.find((line) => what.every((piece) => line.includes(piece)));
  expect(hit, `expected an ::error:: line with ${JSON.stringify(what)}; got:\n${result.errors.join('\n') || result.out}`).toBeDefined();
  expect(result.code, result.out).toBe(1);
}

async function fails(scenario: Scenario, ...what: string[]) {
  expectError(await run(scenario), ...what);
}

const replace = (lines: string[], from: string | RegExp, to: string | string[]) =>
  lines.flatMap((line) => ((typeof from === 'string' ? line.includes(from) : from.test(line)) ? to : [line]));

/**
 * tools/ios-check/check.cjs alone, as the script runs it for each check: the judging of a bundle or a console, without
 * the launches around it (a whole run of the script takes seconds; this, a tenth of one).
 */
function check(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<Judged & { warnings: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(TOOLS, 'check.cjs'), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => {
      const lines = out.split('\n');
      resolve({ code, out, errors: lines.filter((l) => l.startsWith('::error::')), warnings: lines.filter((l) => l.startsWith('::warning::')) });
    });
  });
}

/** check.cjs launch, on a console written as simctl's pseudo-terminal writes it (each line ending in \r\n). */
function judgeLaunch(kind: 'light' | 'dark' | 'ipad' | 'selftest', lines: string[]) {
  const dir = tmp('ios-launch-');
  writeFileSync(join(dir, 'console.log'), lines.map((line) => `${line}\r\n`).join(''));
  writeFileSync(join(dir, 'info.json'), JSON.stringify({ CFBundleIdentifier: config.appId, CFBundleShortVersionString: '1.0.0', CFBundleVersion: '1' }));
  return check(['launch', join(dir, 'console.log'), kind, join(dir, 'info.json'), ...(kind === 'selftest' ? [PROBE] : [])]);
}

/** check.cjs bundle on an App.app, with the stub plutil. */
function judgeBundle(edit: AppEdit, label = 'Debug') {
  const dir = tmp('ios-bundle-');
  makeApp(join(dir, 'App.app'), edit);
  return check(['bundle', join(dir, 'App.app'), label, join(dir, 'info.json')], { ...process.env, PATH: `${join(TOOLS, 'stub')}:${process.env.PATH}` });
}

const SLOW = { timeout: 30_000 };

// ---- whole runs of the script -------------------------------------------------------------------------------------

describe('the simulator check, on a good run', SLOW, () => {
  it('passes, launches light, dark, the self-test, the iPad and the Release build, and keeps every console and screenshot', async () => {
    const result = await run();
    expect(result.errors, result.out).toEqual([]);
    expect(result.warnings, result.out).toEqual([]);
    expect(result.code, result.out).toBe(0);

    const simctl = result.calls.filter((c) => c[0] === 'xcrun').map((c) => c.slice(1));
    const installs = simctl.filter((c) => c[1] === 'install').map((c) => [c[2], c[3]]);
    const debugApp = join(result.dir, 'debug/App.app');
    expect(installs).toEqual([
      [UDID, debugApp],
      [IPAD, debugApp],
      [UDID, join(result.dir, 'release/App.app')],
    ]);
    const launches = simctl.filter((c) => c[1] === 'launch');
    expect(launches).toHaveLength(5);
    for (const launch of launches) expect(launch.slice(2, 4)).toEqual(['--console-pty', '--terminate-running-process']);
    expect(launches.map((l) => [l[4], l[5]])).toEqual([...Array(3).fill([UDID, config.appId]), [IPAD, config.appId], [UDID, config.appId]]);
    expect(launches.map((l) => l.slice(6))).toEqual([[], [], [SELF_TEST_ARG, PROBE_URL_ARG, PROBE], [], []]);
    const looks = simctl.filter((c) => c[1] === 'ui').map((c) => [c[2], c[4]]);
    expect(looks).toEqual([
      [UDID, 'light'],
      [UDID, 'dark'],
      [IPAD, 'light'],
      [UDID, 'light'],
    ]);
    expect(simctl.filter((c) => c[1] === 'terminate').map((c) => c[2])).toEqual([UDID, UDID, UDID, IPAD, UDID]);
    // The iPad is booted (it starts shut down) before anything is installed on it.
    const ipadCalls = simctl.filter((c) => c.includes(IPAD)).map((c) => c[1]);
    expect(ipadCalls.slice(0, 3)).toEqual(['bootstatus', 'install', 'ui']);
    expect(simctl.find((c) => c[1] === 'bootstatus')).toEqual(['simctl', 'bootstatus', IPAD, '-b']);

    for (const file of ['console-light.log', 'console-dark.log', 'console-selftest.log', 'console-ipad.log', 'console-release.log', 'welcome-light.png', 'welcome-dark.png', 'welcome-ipad.png', 'release.png']) {
      expect(existsSync(join(result.dir, 'out', file)), file).toBe(true);
    }
    expect(result.out).toContain('iPad launch: 13 facts of fitee:ready as required, status bar dark-text');
    expect(readFileSync(join(result.dir, 'out/console-light.log'), 'utf8')).toContain(`${MARKERS.ready} `);
    // The consoles are printed with workflow commands off, so no line of theirs can act as one.
    expect(result.out).toMatch(/::stop-commands::(fitee-console-\d+-\d+)[\s\S]*?::\1::/);
    expect(result.out).toContain('::notice::Self-test launch: the pose model loaded with the GPU delegate');
  });

  it("warns, and still passes, when the probe can't show the difference or the simulator records no video", async () => {
    const skipped = selftest({
      video: { ok: true, folderExcluded: true, recorded: { ok: true, played: 'skipped', error: 'no canvas recording here' }, random: { ...VIDEO, bytes: 3145733 } },
    });
    const result = await run({ consoles: { selftest: selftestConsole(skipped, rules({ withoutRules: 'failed: no answer in 10 s' })) } });
    expect(result.errors, result.out).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.warnings.some((w) => w.includes('without the content rules') && w.includes('failed: no answer in 10 s'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('no recording could be made') && w.includes('no canvas recording here'))).toBe(true);
  });
});

describe.concurrent('the simulator check fails, in a whole run,', SLOW, () => {
  // A problem in each bundle and each launch reaches the run's output and its exit status.
  it('a Debug bundle that ships the no-SIMD runtime', () => fails({ debug: { files: { 'public/mediapipe/wasm/vision_wasm_nosimd_internal.wasm': 'x' } } }, 'Debug app', 'vision_wasm_nosimd_internal.wasm'));
  it("a Release bundle without Capacitor's privacy manifest", () =>
    fails({ release: { files: { 'Frameworks/Capacitor.framework/Capacitor.bundle/PrivacyInfo.xcprivacy': null } } }, 'Release app', 'no privacy manifest from Capacitor'));
  it('a Release build with another bundle ID', () => fails({ release: { info: { CFBundleIdentifier: 'com.example.other' } } }, "The Release build's bundle ID"));
  it('a light launch whose ready marker reports a blocked own file', () =>
    fails({ consoles: { light: lookConsole('light', { urlOrigin: 'null', ownFile: 'TypeError: Blocked request to null: this app never sends data off the device.' }) } }, 'Light launch', 'urlOrigin is "null"'));
  it('a dark launch with an uncaught error', () =>
    fails({ consoles: { dark: [...lookConsole('dark'), '⚡️  [error] - fitee:uncaught TypeError: x is undefined at capacitor://localhost/assets/index.js:1'] } }, 'Dark launch', 'uncaught error'));
  it('a self-test launch with a failed step', () =>
    fails({ consoles: { selftest: selftestConsole(selftest({ ok: false, pose: { ok: false, delegate: '', ms: 90000, error: 'createPoseLandmarker: no result within 90 s' } })) } }, 'Self-test launch', 'the pose step failed'));

  // The iPad: the same Debug build, on a simulator the script boots, launched once in the light appearance.
  it('an iPad launch whose ready marker reports a fact the light launch must not', () =>
    fails({ consoles: { ipad: lookConsole('light', { ownFile: 404 }) } }, 'iPad launch', 'ownFile is 404'));
  it('an iPad launch with the light text of a dark page', () =>
    fails({ consoles: { ipad: lookConsole('dark') } }, 'iPad launch', '"light-text"', 'expected "dark-text" in the light appearance'));
  it('an iPad launch that never logs its ready marker', () => fails({ consoles: { ipad: lookConsole('light').slice(0, -1) } }, 'iPad launch', 'no fitee:ready marker after 3 s'));
  it('an iPad launch whose app ends before it is ready', () =>
    fails({ consoles: { ipad: ['⚡️  Loading app at capacitor://localhost...', '⚡️  WebView process terminated', '@exit 1'] } }, 'iPad launch', 'the app ended before its fitee:ready marker'));
  it("an iPad simulator that can't boot, and still launches the Release build", async () => {
    const result = await run({ env: { STUB_FAIL: `bootstatus@${IPAD}` } });
    expectError(result, 'iPad launch', `the iPad simulator (${IPAD}) couldn't be booted`);
    expect(result.calls.some((c) => c[1] === 'simctl' && c[2] === 'install' && c[3] === IPAD)).toBe(false);
    expect(readFileSync(join(result.dir, 'out/console-release.log'), 'utf8')).toContain('a system message');
  });
  it("an iPad simulator the Debug build can't be installed on", () => fails({ env: { STUB_FAIL: `install@${IPAD}` } }, 'iPad launch', "couldn't be installed in the iPad simulator"));

  // What only a run can show: the launches' timing.
  it('a launch that never logs its ready marker', () => fails({ consoles: { light: lookConsole('light').slice(0, -1) } }, 'Light launch', 'no fitee:ready marker after 3 s'));
  it('a launch whose app ends before it is ready', () =>
    fails({ consoles: { dark: ['⚡️  Loading app at capacitor://localhost...', '⚡️  WebView loaded', '⚡️  WebView process terminated', '@exit 1'] } }, 'Dark launch', 'the app ended before its fitee:ready marker'));
  it('a launch whose app ends after it is ready', () =>
    fails({ consoles: { light: [...lookConsole('light'), '@sleep 0.5', '@exit 0'] }, env: { SETTLE_SECONDS: '1' } }, 'Light launch', 'the app ended after its fitee:ready marker'));
  it("a self-test whose marker doesn't come", () =>
    fails({ consoles: { selftest: selftestConsole().filter((l) => !l.includes(`${MARKERS.selftest} `)) } }, 'Self-test launch', 'no fitee:selftest and fitee:rules markers after 3 s'));
  it('a self-test whose app ends during it', () =>
    fails({ consoles: { selftest: [...selftestConsole().slice(0, 8), '⚡️  WebView process terminated', '@exit 1'] } }, 'Self-test launch', 'the app ended before the fitee:selftest'));
  it('a Release build that ends within 15 s', () => fails({ consoles: { release: ['@exit 0'] } }, 'Release launch', 'the app ended within 1 s'));
  it('a Release build whose screen is blank', () => fails({ screens: { release: BLANK } }, 'release.png is blank'));
  it("a Release build whose screenshot can't be read", () => fails({ screens: { release: Buffer.from('not a png') } }, "release.png: can't be read as an image"));
  it('a Release build that logs', () => fails({ consoles: { release: ['⚡️  Loading app at capacitor://localhost...'] } }, 'Release launch', 'logged 1 line'));

  it('when nothing answers at the probe URL', () => fails({ probe: 'http://localhost:9/fitee-rules-probe' }, 'Nothing answers at the rules probe'));
  it("by refusing a probe URL that isn't this machine, before any launch", async () => {
    const result = await run({ probe: 'https://example.com/fitee-rules-probe' });
    expect(result.code).toBe(2);
    expect(result.errors.join('\n')).toContain("isn't plain HTTP to this machine");
    expect(result.calls.filter((c) => c[0] === 'xcrun')).toEqual([]);
  });
  it('by asking for six arguments', async () => {
    const result = await run({ args: [UDID] });
    expect(result.code).toBe(2);
    expect(result.out).toContain('Usage:');
  });
  it('by refusing the iPhone simulator as the iPad, before any launch', async () => {
    const dir = tmp('ios-same-');
    const result = await run({ args: [UDID, join(dir, 'debug/App.app'), join(dir, 'release/App.app'), join(dir, 'out'), PROBE, UDID] });
    expect(result.code).toBe(2);
    expect(result.out).toContain('the iPad simulator must be another device');
    expect(result.calls).toEqual([]);
  });
});

// ---- the bundles (check.cjs bundle) ---------------------------------------------------------------------------------

describe.concurrent('a bundle', SLOW, () => {
  it('as Xcode builds it with use_frameworks! passes', async () => {
    const result = await judgeBundle({});
    expect(result.errors, result.out).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`Debug app: ${config.appId} 1.0.0 (1), privacy manifests: `);
  });

  it('passes with the privacy manifests wherever CocoaPods puts them: in the app itself with static linkage', async () => {
    const result = await judgeBundle({
      files: {
        'Frameworks/Capacitor.framework/Capacitor.bundle/PrivacyInfo.xcprivacy': null,
        'Frameworks/Cordova.framework/CapacitorCordova.bundle/PrivacyInfo.xcprivacy': null,
        'Capacitor.bundle/PrivacyInfo.xcprivacy': MANIFEST,
        'CapacitorCordova.bundle/PrivacyInfo.xcprivacy': MANIFEST,
      },
    });
    expect(result.errors, result.out).toEqual([]);
    expect(result.code).toBe(0);
  });

  const failing: [string, AppEdit, ...string[]][] = [
    ['ships the no-SIMD runtime', { files: { 'public/mediapipe/wasm/vision_wasm_nosimd_internal.js': 'x' } }, 'vision_wasm_nosimd_internal.js', "mustn't be"],
    ["ships the web app's service worker", { files: { 'public/sw.js': 'x' } }, 'public/sw.js'],
    ['ships the landing page', { files: { 'public/about/index.html': 'x' } }, 'public/about'],
    ["ships the web app's manifest", { files: { 'public/manifest.webmanifest': '{}' } }, 'public/manifest.webmanifest'],
    ['lacks the full pose model', { files: { 'public/mediapipe/models/pose_landmarker_full.task': null } }, 'pose_landmarker_full.task', 'missing'],
    ['lacks the lite pose model', { files: { 'public/mediapipe/models/pose_landmarker_lite.task': null } }, 'pose_landmarker_lite.task', 'missing'],
    ['has an empty pose runtime', { files: { 'public/mediapipe/wasm/vision_wasm_internal.wasm': '' } }, 'vision_wasm_internal.wasm', 'empty'],
    ['lacks the page', { files: { 'public/index.html': null } }, 'public/index.html', 'missing'],
    ['lacks cordova.js', { files: { 'public/cordova.js': null } }, 'public/cordova.js', 'missing'],
    ["lacks the app's privacy manifest", { files: { 'PrivacyInfo.xcprivacy': null } }, 'PrivacyInfo.xcprivacy', 'missing'],
    ["lacks Capacitor's privacy manifest", { files: { 'Frameworks/Capacitor.framework/Capacitor.bundle/PrivacyInfo.xcprivacy': null } }, 'no privacy manifest from Capacitor'],
    ["lacks Cordova's privacy manifest", { files: { 'Frameworks/Cordova.framework/CapacitorCordova.bundle/PrivacyInfo.xcprivacy': null } }, 'no privacy manifest from Cordova'],
    ["has a privacy manifest that isn't a property list", { files: { 'Frameworks/Capacitor.framework/Capacitor.bundle/PrivacyInfo.xcprivacy': 'not a plist' } }, 'Capacitor.bundle/PrivacyInfo.xcprivacy', "isn't a valid property list"],
    ['is for iOS 15', { info: { MinimumOSVersion: '15.0' } }, 'MinimumOSVersion', '"15.0"'],
    ['is for iPad too', { info: { UIDeviceFamily: [1, 2] } }, 'UIDeviceFamily', '[1,2]'],
    ['has no camera text', { info: { NSCameraUsageDescription: '' } }, 'NSCameraUsageDescription'],
    ['has no microphone text', { info: { NSMicrophoneUsageDescription: undefined } }, 'NSMicrophoneUsageDescription'],
    ['declares encryption', { info: { ITSAppUsesNonExemptEncryption: true } }, 'ITSAppUsesNonExemptEncryption', 'true'],
    ['has no build number', { info: { CFBundleVersion: undefined } }, 'CFBundleVersion'],
    ['whose Capacitor settings set server.url', { files: { 'capacitor.config.json': JSON.stringify({ appId: config.appId, server: { url: 'https://example.com' } }) } }, 'server.url'],
    ["whose Capacitor settings weren't synced", { files: { 'capacitor.config.json': JSON.stringify({ appId: 'com.example.other' }) } }, 'appId', 'npm run native:sync'],
    ["whose Capacitor settings aren't JSON", { files: { 'capacitor.config.json': '{' } }, "capacitor.config.json isn't JSON"],
    ["whose Info.plist plutil can't read", { files: { 'Info.plist': 'not a plist' } }, "plutil couldn't read Info.plist"],
  ];
  for (const [what, edit, ...message] of failing) {
    it(`fails when it ${what}`, async () => expectError(await judgeBundle(edit, 'Release'), 'Release app', ...message));
  }

  it("fails when there's no app", async () => expectError(await check(['bundle', join(tmp('ios-none-'), 'App.app'), 'Debug', join(tmp('ios-none-'), 'info.json')]), 'Debug app: there is no app at'));
});

// ---- the light and dark launches (check.cjs launch) -------------------------------------------------------------

describe.concurrent('a light or dark launch', SLOW, () => {
  const L = lookConsole('light');

  it('passes as the app logs it', async () => {
    for (const look of ['light', 'dark'] as const) {
      const result = await judgeLaunch(look, lookConsole(look));
      expect(result.errors, result.out).toEqual([]);
      expect(result.code).toBe(0);
    }
  });

  it("passes with parameters on the runtime's content type", async () => {
    const result = await judgeLaunch('light', lookConsole('light', { wasmType: 'application/wasm; charset=binary' }));
    expect(result.errors, result.out).toEqual([]);
  });

  const failing: [string, string[], ...string[]][] = [
    ['has a CSP violation', [...L, '⚡️  [error] - fitee:csp img-src https://example.com/x.png'], 'CSP blocked', 'img-src'],
    ['has an uncaught error', [...L, '⚡️  [error] - fitee:uncaught Unhandled rejection: nope'], 'uncaught error'],
    ['has an error line', [...L, '⚡️  [error] - something went wrong'], 'an error line', 'something went wrong'],
    ["has MediaPipe's error lines (allowed in the self-test only)", [...L, '⚡️  [error] - E0000 00:00:1764237600.402277 1 x.cc:1] nope'], 'an error line', 'E0000'],
    ['has a startup JS error', replace(L, 'WebView loaded', ['⚡️  WebView loaded', '', '⚡️  ------ STARTUP JS ERROR ------', '', "⚡️  ReferenceError: Can't find variable: __NATIVE__"]), 'JavaScript error', '__NATIVE__'],
    ["has the web view's process end", [...L, '⚡️  WebView process terminated'], "the web view's process ended"],
    ["has Capacitor's fatal error", ['⚡️ ❌  Capacitor: FATAL ERROR', ...L], "couldn't set up its JavaScript bridge"],
    ['misses cordova.js', ['ERROR: Required cordova.js file not found. Cordova plugins will not function!', ...L], 'missing or unreadable file'],
    ['calls a method the plugin lacks', [...L, '⚡️  Error calling method clearPickedFiles on plugin FiteeNative: No method found.'], "don't follow the same contract"],
    ['calls a plugin Capacitor lacks', [...L, '⚡️  Error loading plugin Fitee for call. Check that the pluginId is correct'], "a plugin Capacitor doesn't have"],
    ['has two bridges', ['⚡️  Loading app at capacitor://localhost...', ...L], '2 "Loading app at" lines'],
    ['has no bridge', L.filter((l) => !l.includes('Loading app at')), '0 "Loading app at" lines'],
    ['has two ready markers (a reload)', [...L, readyLine()], '2 fitee:ready markers'],
    ['has its ready marker cut', replace(L, `${MARKERS.ready} `, readyLine().slice(0, 80)), "isn't valid JSON"],
    ['has the wrong status bar text', replace(L, 'fitee:statusbar dark-text', 'fitee:statusbar light-text'), 'status bar', '"light-text"', '"dark-text"'],
    ['never sets the status bar', L.filter((l) => !l.startsWith('fitee:statusbar')), 'no fitee:statusbar line'],
    ['has a call the bridge gate dropped', [...L, `${MARKERS.dropped} message App.exitApp`], 'the bridge gate dropped a call', 'App.exitApp'],
    ["has a probed plugin reach Capacitor's own handler", [...L, '⚡️  To Native ->  CapacitorHttp request 71520399'], 'CapacitorHttp.request reached Capacitor', 'let it through'],
    ["reports another version than the bundle's", lookConsole('light', { build: '7' }), 'version', 'Info.plist'],
    ['is empty', [], 'the console is empty'],
  ];
  for (const [what, lines, ...message] of failing) {
    it(`fails when it ${what}`, async () => expectError(await judgeLaunch('light', lines), 'Light launch', ...message));
  }

  it('fails a dark launch whose status bar has dark text', async () =>
    expectError(await judgeLaunch('dark', replace(lookConsole('dark'), 'fitee:statusbar light-text', 'fitee:statusbar dark-text')), 'Dark launch', '"dark-text"', 'expected "light-text"'));

  it('judges an iPad launch as the light one: it passes as the app logs it, and fails as the light launch does', async () => {
    const passed = await judgeLaunch('ipad', lookConsole('light'));
    expect(passed.errors, passed.out).toEqual([]);
    expect(passed.code).toBe(0);
    expect(passed.out).toContain('iPad launch: 13 facts of fitee:ready as required, status bar dark-text');
    expectError(await judgeLaunch('ipad', lookConsole('light', { simd: false })), 'iPad launch', 'simd is false');
    expectError(await judgeLaunch('ipad', [...L, `${MARKERS.dropped} message App.exitApp`]), 'iPad launch', 'the bridge gate dropped a call');
    expectError(await judgeLaunch('ipad', replace(L, 'fitee:statusbar dark-text', 'fitee:statusbar light-text')), 'iPad launch', 'expected "dark-text" in the light appearance');
  });

  const facts: [Partial<ReadyMarker>, string][] = [
    [{ origin: 'null' }, 'origin is "null"'],
    [{ urlOrigin: 'null' }, 'urlOrigin is "null"'],
    [{ ownFile: 'TypeError: Blocked request to null: this app never sends data off the device.' }, 'ownFile is "TypeError: Blocked request'],
    [{ ownFile: 404 }, 'ownFile is 404'],
    [{ wasmType: 'application/octet-stream' }, 'wasmType is "application/octet-stream"'],
    [{ wasmType: 'failed: TypeError: Load failed' }, 'wasmType is "failed: TypeError: Load failed"'],
    [{ outside: 'loaded' }, 'outside is "loaded"'],
    [{ outside: 'failed: TypeError: Load failed' }, 'outside is "failed: TypeError: Load failed"'],
    [{ secure: false }, 'secure is false'],
    [{ camera: false }, 'camera is false'],
    [{ recorder: false }, 'recorder is false'],
    [{ simd: false }, 'simd is false'],
    [{ sw: true }, 'sw is true'],
    [{ rules: false }, 'rules is false'],
    [{ gate: false }, 'gate is false'],
  ];
  for (const [over, message] of facts) {
    it(`fails when its ready marker says ${JSON.stringify(over)}`, async () => expectError(await judgeLaunch('light', lookConsole('light', over)), 'Light launch', message));
  }
});

// ---- the self-test launch (check.cjs launch selftest) -----------------------------------------------------------

describe.concurrent('the self-test launch', SLOW, () => {
  it('passes as the app logs it, with MediaPipe\'s INFO, I, W and E lines', async () => {
    const result = await judgeLaunch('selftest', selftestConsole());
    expect(result.errors, result.out).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`the bridge gate dropped all ${GATE_PROBES.length} probes`);
  });

  const marker = (over: Partial<SelfTestMarker>) => selftestConsole(selftest(over));
  const [first] = GATE_PROBES;
  const failing: [string, string[], ...string[]][] = [
    ['a step failed', marker({ ok: false, csp: { ok: false, directive: '', error: 'no securitypolicyviolation within 2 s' } }), 'the csp step failed', 'no securitypolicyviolation within 2 s'],
    ['a step failed though the marker says ok', marker({ snapshot: { ok: false, rev: 0, revMatches: false, unitMatches: false, rotated: false, error: 'snapshot.json is missing' } }), 'the snapshot step failed'],
    [
      'the copy of the log wasn’t rotated',
      marker({ ok: false, snapshot: { ok: false, rev: 4, revMatches: true, unitMatches: true, rotated: false, error: 'snapshot.prev.json isn’t the copy written just before snapshot.json' } }),
      'the snapshot step failed',
      'snapshot.prev.json',
    ],
    ['the marker says not ok though every step passed', marker({ ok: false }), 'though every step passed'],
    // As the Chromium check's stand-in bridge reports it (tools/native-check/): never in the app.
    [
      'the gate step skipped itself',
      marker({ skipped: ['gate'], gate: { ok: true, skipped: 'no webkit.messageHandlers.bridge here: only the app has the bridge gate', silent: [], answered: [], stateKept: false } }),
      'the gate step was skipped',
      'only the app has the bridge gate',
    ],
    ['the marker lists a skipped step', marker({ skipped: ['csp'] }), 'lists skipped steps: csp'],
    ['the pose step names no delegate', marker({ pose: { ok: true, delegate: '', ms: 10 } }), 'without saying which delegate'],
    ['a gated call got an answer', marker({ ok: false, gate: { ok: false, silent: PROBED.slice(1), answered: [PROBED[0]], stateKept: true } }), 'got an answer', PROBED[0]],
    ["the gate step didn't try a probe", marker({ gate: { ok: true, silent: PROBED.slice(1), answered: [], stateKept: true } }), "didn't try", PROBED[0]],
    ['FiteeNative lost its state', marker({ ok: false, gate: { ok: false, silent: PROBED, answered: [], stateKept: false } }), 'lost its state'],
    ['a probe has no fitee:dropped line', selftestConsole().filter((l) => l !== `${MARKERS.dropped} message ${first.pluginId}.${first.method}`), `no "${MARKERS.dropped} message ${first.pluginId}.${first.method}" line`],
    ["the gate dropped a call the self-test didn't make", [...selftestConsole(), `${MARKERS.dropped} cordova Device.getDeviceInfo`], "a call the self-test didn't make", 'Device.getDeviceInfo'],
    ["a probe reached Capacitor's own handler", [...selftestConsole(), '⚡️  To Native ->  Capacitor.CAPHttpPlugin request 1031'], 'Capacitor.CAPHttpPlugin.request reached Capacitor'],
    ['a Cordova call got through', [...selftestConsole(), 'To Native Cordova ->  Device getDeviceInfo INVALID {options = ();}'], 'a Cordova call reached'],
    ['the content rules let the probe through', selftestConsole(selftest(), rules({ withRules: 'loaded' })), "with the app's content rules", '"loaded"'],
    ['the rules probe fetched another URL', selftestConsole(selftest(), rules({ url: 'http://localhost:9/x' })), 'the rules probe fetched "http://localhost:9/x"'],
    ["there's an error line that isn't MediaPipe's", [...selftestConsole(), '⚡️  [error] - {"message":"BAD_NAME"}'], 'only MediaPipe', 'BAD_NAME'],
    ["MediaPipe's fatal line shows", [...selftestConsole(), '⚡️  [error] - F0000 00:00:1764237600.402277 1 x.cc:1] Check failed'], 'only MediaPipe', 'F0000'],
    ["the rules marker doesn't come", selftestConsole().filter((l) => !l.includes(`${MARKERS.rules} `)), 'no fitee:rules marker'],
    ['the self-test marker was cut', selftestConsole(JSON.stringify(selftest()).slice(0, 200)), "isn't valid JSON"],
  ];
  for (const [what, lines, ...message] of failing) {
    it(`fails when ${what}`, async () => expectError(await judgeLaunch('selftest', lines), 'Self-test launch', ...message));
  }

  it('fails when a step is missing', async () => {
    const without: Partial<SelfTestMarker> = selftest();
    delete without.keepAwake;
    expectError(await judgeLaunch('selftest', selftestConsole(JSON.stringify(without))), 'Self-test launch', 'has no keepAwake step');
  });
});

// ---- the Release launch (check.cjs release) -------------------------------------------------------------------

describe.concurrent('the Release launch', SLOW, () => {
  const judge = (lines: string[]) => {
    const file = join(tmp('ios-release-'), 'console.log');
    writeFileSync(file, lines.map((l) => `${l}\r\n`).join(''));
    return check(['release', file]);
  };
  it("passes with the system's own lines", async () => {
    const result = await judge(['2026-11-27 09:41:00.000 App[4211:90210] a system message']);
    expect(result.code, result.out).toBe(0);
  });
  it("passes with simctl's own launch line, even when the bundle ID ends in fitee (the first macOS run)", async () => {
    const result = await judge([
      '2026-11-27 13:35:29.503 App[26190:109366] DiskCookieStorage changing policy from 2 to 0, cookie file: file:///Users/runner/Library/Cookies/app.fitee.binarycookies',
      'app.fitee: 26190',
      'com.example.fitee: 7',
    ]);
    expect(result.code, result.out).toBe(0);
  });
  it('fails on a Capacitor or fitee line: a Release build never logs', async () => {
    expectError(await judge(['⚡️  WebView loaded']), 'logged 1 line', 'WebView loaded');
    expectError(await judge(['fitee:statusbar dark-text', 'fitee:ready {}']), 'logged 2 lines');
  });
});

// ---- bash 3.2 ------------------------------------------------------------------------------------------------------

describe('tools/ios-check/simulator-check.sh', () => {
  const code = readFileSync(SCRIPT, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('starts as a bash script with errexit, nounset and pipefail', () => {
    expect(readFileSync(SCRIPT, 'utf8').startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(code).toContain('set -euo pipefail');
  });

  it('uses nothing bash 3.2 (the macOS runner\'s) lacks, nor GNU-only tools', () => {
    const newer: [RegExp, string][] = [
      [/\b(declare|local|typeset|readonly)\s+-[a-zA-Z]*[Anglu]/, 'associative arrays, namerefs, -g, case attributes (bash 4)'],
      [/\b(mapfile|readarray|coproc)\b/, 'mapfile, readarray, coproc (bash 4)'],
      [/\$\{[^}]*(\^\^?|,,?)\}/, 'case-changing expansions (bash 4)'],
      [/\$\{[^}]*@[QEPAaKkUuL]\}/, '${x@Q} transformations (bash 4.4)'],
      [/\bwait\s+-[a-z]*n/, 'wait -n (bash 4.3)'],
      [/\|&|&>>/, '|& and &>> (bash 4)'],
      [/;;&|;&/, 'case fall-through (bash 4)'],
      [/\[\[?\s+-v\s/, 'test -v (bash 4.2)'],
      [/\$\{?(EPOCHSECONDS|EPOCHREALTIME|BASHPID|READLINE_)/, 'variables from bash 4 and 5'],
      [/shopt\s+-s\s+(globstar|lastpipe|autocd|direxpand|checkjobs|globasciiranges|inherit_errexit)/, 'shopt options from bash 4 and 5'],
      [/\{[A-Za-z_][A-Za-z0-9_]*\}[<>]/, 'automatic file descriptors {fd}> (bash 4.1)'],
      [/\$\{[A-Za-z_][A-Za-z0-9_]*\[-\d+\]\}/, 'negative array indices (bash 4.3)'],
      [/\{-?\d+\.\.-?\d+\.\.-?\d+\}/, 'brace ranges with a step (bash 4)'],
      [/%\([^)]*\)T/, "printf's %(...)T (bash 4.2)"],
      [/\bread\b[^\n]*\s-[a-zA-Z]*[Ni]\b/, 'read -N and read -i (bash 4)'],
      [/(^|[;&|(]|&&|\|\||\bthen|\bdo|\belse)\s*timeout\s/m, 'GNU timeout (not on macOS)'],
      [/\bsed\b[^\n|;]*\s-[a-zA-Z]*i\b/, 'sed -i (GNU and BSD differ)'],
      [/\bgrep\b[^\n|;]*\s-[a-zA-Z]*P/, 'grep -P (GNU only)'],
      [/\bsed\b[^\n|;]*\s-r\b/, 'sed -r (GNU only; -E is portable)'],
      [/\breadlink\s+-f\b|\bstat\s+-c\b|\bdate\s+-d\b|-printf\b|\bxargs\s+-r\b|\bsha256sum\b|\btac\b|\bnproc\b|\bbase64\s+-w\b|\bsort\s+-V\b/, 'GNU-only tools and flags'],
    ];
    for (const [pattern, what] of newer) expect(pattern.test(code), `${what}: ${code.match(pattern)?.[0]}`).toBe(false);
    // Under set -u, bash 3.2 calls an empty "$@" or array expansion unbound: an empty list goes through ${1+"$@"}.
    for (const line of code.split('\n')) {
      if (line.includes('"$@"') && !line.includes('${1+"$@"}')) expect(line, 'an expansion of "$@" that may be empty').toMatch(/^\s*(node|for marker in) .*"\$@"/);
      expect(line, 'array expansions (empty ones break set -u in bash 3.2)').not.toMatch(/\$\{[A-Za-z_][A-Za-z0-9_]*\[[@*]\]\}/);
    }
  });

  it('passes bash -n', () => {
    const syntax = spawnSync(BASH, ['-n', SCRIPT], { encoding: 'utf8' });
    expect(syntax.status, syntax.stderr).toBe(0);
  });

  it('launches with the contract\'s arguments', () => {
    expect(code).toContain(`${SELF_TEST_ARG} ${PROBE_URL_ARG} "$probe_url"`);
    expect(code).toContain(`wait_for "$log" "$ready_timeout" ${MARKERS.ready} ||`);
    expect(code).toContain(`wait_for "$log" "$selftest_timeout" ${MARKERS.selftest} ${MARKERS.rules} ||`);
  });
});

// ---- the helpers -------------------------------------------------------------------------------------------------

describe('tools/ios-check/check.cjs screen', () => {
  const screen = (picture: Buffer, ...flags: string[]) => {
    const file = join(tmp('ios-screen-'), 'shot.png');
    writeFileSync(file, picture);
    return spawnSync(process.execPath, [join(TOOLS, 'check.cjs'), 'screen', file, 'shot.png', ...flags], { encoding: 'utf8' });
  };

  it('reads every kind of PNG the simulator might write, and every row filter', () => {
    for (const options of [{ type: 2 }, { type: 6 }, { type: 0 }, { type: 3 }, { type: 2, depth: 16 }, { type: 6, depth: 16 }] as const) {
      const result = screen(png(60, 120, welcome, options), '--require');
      expect(result.status, `${JSON.stringify(options)}: ${result.stdout}`).toBe(0);
      expect(result.stdout).toMatch(/^shot\.png: 60×120, \d+\.\d% of the screen differs/);
    }
  });

  it('measures how much of the screen differs from its main colour, between the status bar and the home indicator', () => {
    const half = screen(png(40, 100, (x) => (x < 20 ? PAPER : INK)));
    expect(half.stdout).toContain('50.0% of the screen differs');
    expect(screen(BLANK).stdout).toContain('0.0% of the screen differs from its main colour #f4ece2');
  });

  it('fails a blank screen only with --require', () => {
    expect(screen(BLANK).status).toBe(0);
    const required = screen(BLANK, '--require');
    expect(required.status).toBe(1);
    expect(required.stdout).toContain('::error::shot.png is blank');
  });
});

describe('tools/ios-check/pick-simulator.cjs', () => {
  const pick = (devices: Record<string, { name: string; udid: string; isAvailable?: boolean }[]>, name?: string) =>
    spawnSync(process.execPath, [join(TOOLS, 'pick-simulator.cjs'), ...(name ? [name] : [])], { input: JSON.stringify({ devices }), encoding: 'utf8' });
  const runtime = (v: string) => `com.apple.CoreSimulator.SimRuntime.iOS-${v}`;

  it('picks the named iPhone on the newest iOS that has it (26.10 after 26.5)', () => {
    const result = pick({
      [runtime('26-2')]: [{ name: 'iPhone 17', udid: 'A' }],
      [runtime('26-10')]: [{ name: 'iPhone 17', udid: 'C' }, { name: 'iPhone Air', udid: 'D' }],
      [runtime('26-5')]: [{ name: 'iPhone 17', udid: 'B' }],
      'com.apple.CoreSimulator.SimRuntime.watchOS-12-0': [{ name: 'iPhone 17', udid: 'W' }],
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('C');
  });

  it('picks the iPad for the iPad launch the same way, by its name', () => {
    const result = pick(
      {
        [runtime('26-5')]: [{ name: 'iPhone 17', udid: 'B' }, { name: 'iPad (A16)', udid: 'P' }, { name: 'iPad Pro 11-inch (M5)', udid: 'Q' }],
        [runtime('26-2')]: [{ name: 'iPad (A16)', udid: 'O' }],
      },
      'iPad (A16)',
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('P');
  });

  it('skips a device that is not available, and fails when there is none', () => {
    expect(pick({ [runtime('26-5')]: [{ name: 'iPhone 17', udid: 'B', isAvailable: false }], [runtime('26-2')]: [{ name: 'iPhone 17', udid: 'A' }] }).stdout.trim()).toBe('A');
    const none = pick({ [runtime('26-5')]: [{ name: 'iPhone Air', udid: 'D' }] }, 'iPhone 17');
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('No available "iPhone 17" simulator. Available: iPhone Air');
  });
});

describe('tools/ios-check/probe-server.cjs', () => {
  it('answers on localhost, which the probe URL names', async () => {
    const res = await fetch(PROBE, { cache: 'no-store' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('fitee probe\n');
  });
});

// ---- the workflow --------------------------------------------------------------------------------------------------

describe('.github/workflows/ios.yml', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/ios.yml'), 'utf8');
  const code = workflow
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('runs on pushes to claude/** branches and by hand, once per commit (no pull_request trigger)', () => {
    expect(code).toMatch(/^on:\n  push:\n    branches: \['claude\/\*\*'\]\n  workflow_dispatch:\n/m);
    expect(code).not.toMatch(/^\s*pull_request/m);
  });

  it('builds with Xcode 26.6 on macos-26, and names no bundle ID (the check reads it from the app)', () => {
    expect(code).toContain('DEVELOPER_DIR: /Applications/Xcode_26.6.app/Contents/Developer');
    expect(code.match(/runs-on: (\S+)/g)).toEqual(['runs-on: macos-26', 'runs-on: macos-26']);
    expect(workflow).not.toContain(config.appId);
    expect(code).toContain('bash --version');
  });

  it('builds Debug and Release for the simulator without signing, then runs the check with both, the probe server and an iPad', () => {
    for (const configuration of ['Debug', 'Release']) expect(code).toMatch(new RegExp(`-configuration ${configuration}[^\\n]*\\\\\\n[\\s\\S]*?CODE_SIGNING_ALLOWED=NO`));
    expect(code).toContain('npm run build:native');
    expect(code).toContain('npm run native:sync');
    expect(code).not.toMatch(/\bcap (copy|sync)\b|pod install/);
    expect(code).toContain('node tools/ios-check/probe-server.cjs');
    expect(code).toContain('PROBE_URL=http://localhost:');
    // An iPad that every iOS 26 runtime on the macos-26 image has, picked as the iPhone is; the check boots it.
    expect(code).toContain('IPAD_SIMULATOR: iPad (A16)');
    expect(code).toMatch(/node tools\/ios-check\/pick-simulator\.cjs "\$IPAD_SIMULATOR"\)\n\s+echo "IPAD_UDID=\$ipad" >> "\$GITHUB_ENV"/);
    expect(code).toMatch(
      /tools\/ios-check\/simulator-check\.sh "\$UDID" \\\n\s+"\$RUNNER_TEMP\/derived\/Build\/Products\/Debug-iphonesimulator\/App\.app" \\\n\s+"\$RUNNER_TEMP\/derived-release\/Build\/Products\/Release-iphonesimulator\/App\.app" \\\n\s+ios-check "\$PROBE_URL" "\$IPAD_UDID"/,
    );
    expect(code).toMatch(/if: always\(\)\n\s+uses: actions\/upload-artifact@v4\n\s+with:\n[\s\S]*?path: ios-check\//);
  });

  it('archives for TestFlight ad hoc by default, development-signed on request, and never with a certificate in the keychain', () => {
    expect(code).toMatch(/archive_signing:\n[\s\S]*?type: choice\n[\s\S]*?options: \[adhoc, development\]\n[\s\S]*?default: adhoc/);
    expect(code).toContain('CODE_SIGN_IDENTITY=- AD_HOC_CODE_SIGNING_ALLOWED=YES');
    expect(code).toContain('CURRENT_PROJECT_VERSION="$GITHUB_RUN_NUMBER"');
    expect(code).toContain("grep -q '^Signature=adhoc'");
    expect(code).not.toMatch(/security (import|create-keychain)|\.p12|provisioningProfiles|signingCertificate/);
    for (const key of ['method</key><string>app-store-connect', 'destination</key><string>upload', 'signingStyle</key><string>automatic', 'teamID</key><string>$APPLE_TEAM_ID', 'manageAppVersionAndBuildNumber</key><false/>', 'uploadSymbols</key><true/>']) {
      expect(code).toContain(key);
    }
    expect(code).toMatch(/-exportArchive[\s\S]*?-allowProvisioningUpdates[\s\S]*?-authenticationKeyPath "\$ASC_KEY_PATH"[\s\S]*?-authenticationKeyID "\$ASC_KEY_ID"[\s\S]*?-authenticationKeyIssuerID "\$ASC_ISSUER_ID"/);
    expect(code).toMatch(/- name: Remove the key\n\s+if: always\(\)\n\s+run: rm -f "\$RUNNER_TEMP"\/AuthKey_\*\.p8/);
  });
});
