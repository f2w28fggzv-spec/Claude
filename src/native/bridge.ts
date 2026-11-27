// THE NATIVE CONTRACT. The page's only door to native code in the iPhone app, and the agreement between three parts
// built apart: the page (src/native/*), the app's Swift code (ios/App/App/: FiteeNativePlugin.swift, FiteeFiles.swift,
// FiteeViewController.swift, FiteeContentRules.swift) and CI's simulator check (tools/ios-check/simulator-check.sh).
// All three follow this file: change it, and change them with it.
//
// Native-only: shared code reaches this module only through import() inside `if (__NATIVE__)` (scripts/native-build.ts).
// Nothing here imports @capacitor/*: the page talks to Capacitor through window.Capacitor. Node's type stripping can
// load this file (only `import type`, erasable syntax), so tests and CI's tools can use its constants.
//
// HOW A CALL TRAVELS
// Capacitor injects native-bridge.js and a stub per registered plugin at document start (JSExport.swift:73-109):
// Capacitor.Plugins.FiteeNative.<method>(options) is Capacitor.nativePromise('FiteeNative', method, options), which
// posts {type: 'message', pluginId, methodName, options, callbackId} to webkit.messageHandlers.bridge
// (native-bridge.js:839-851, 880-916, 1001-1008). Calls run one at a time, in the order sent, on the bridge's serial
// queue (CapacitorBridge.swift:133, 535-560), so a video's chunks arrive in order; UIKit work hops to the main queue.
// A method resolves with the result typed below, or rejects with an Error whose `message` is a short sentence and
// whose `code` is a NativeErrorCode (CAPPluginCall.reject(message, code); JS.swift:85-112). Every name or id the page
// passes is checked natively too: a call never names a path.
//
// THE BRIDGE GATE (FiteeViewController.swift)
// A page has three ways to native code, all of them Capacitor's WebViewDelegationHandler, and in capacitorDidLoad(),
// before the page loads, the gate goes in front of each:
//   1. Messages: every plugin call native-bridge.js makes is posted to the "bridge" script message handler.
//      FiteeBridgeGate replaces Capacitor's handler on the web view's user content controller
//      (WebViewDelegationHandler.swift:18-22 adds it with add(_:name:), in the page's content world;
//      CAPBridgeViewController.swift:298 makes that controller the web view's) and forwards to Capacitor's own
//      (bridge.webViewDelegationHandler; userContentController(_:didReceive:) is open, :192) only:
//        - type 'message' whose pluginId is in GATE_ALLOWED: FiteeNative (this contract), Console (native-bridge.js sends
//          every console call there, native-bridge.js:771-788; only Debug builds print them) and SystemBars (the page
//          sets the status bar text, src/native/statusBar.ts);
//        - type 'js.error' (native-bridge.js's window.onerror in Debug builds, :852-874; printed, never answered).
//      Everything else is dropped, 'cordova' included, and gets no answer. native-bridge.js 8.6.3 calls nothing else by
//      itself: App (navigator.app.exitApp, a 'backbutton' listener) and WebView (Ionic.WebView.*) only when the page
//      calls them, and CapacitorHttp only when it's enabled (it's off: capacitor.config.ts). None of those, and nothing
//      that can make a request, set cookies or change the server path, is ever allowed.
//   2. Prompts and new windows: FiteeUIDelegate replaces Capacitor's as the web view's UI delegate. Capacitor's reads a
//      prompt() whose text is {"type": "CapacitorCookies.get" or ".set"} as a cookie request whatever the config
//      (WebViewDelegationHandler.swift:271-293), and hands a window.open's URL to iOS (Safari: :324-329). fitee's answers
//      every prompt with null and opens no window; alert(), confirm() and the camera's and motion's permissions go on to
//      Capacitor's handler, answered as before.
//   3. Navigations: FiteeNativePlugin.shouldOverrideLoad, which Capacitor asks before it would hand a top-level
//      navigation outside the app to iOS (:83-99, then :107-121), cancels every navigation that isn't to
//      capacitor://localhost (scheme capacitor, host localhost: the app's own pages).
// AppInfo.gate says all three are in place; the self-test's gate step proves each (GATE_PROBES, then a prompt, a
// window.open and a navigation). Outside the app (the Chromium check's stand-in bridge) there is no
// webkit.messageHandlers.bridge to test, and the step reports itself skipped (SelfTestStep.skipped).
//
// FILES (Library/Application Support/fitee/, FiteeFiles.swift; names in src/native/setFiles.ts)
//   data/  snapshot.json, snapshot.next.json, snapshot.prev.json: the copy of the log (src/native/snapshot.ts).
//          In the iPhone's backups.
//   sets/  index.json, <id>.replay.json, <id>.<ext> (ext in VIDEO_EXTS), <id>.<ext>.part while an upload runs, and
//          index.unreadable-<ms>.json (an index set aside because it couldn't be read). The folder and every file are
//          marked excluded from backup (isExcludedFromBackup, set again at every save: guidance to iOS).
//   tmp/   The app's temporary folder: fitee-export/<name> while Save to Files is open, and the copies iOS makes of a
//          video picked for a check or filmed with Take Video. Emptied at launch (before the web view exists), by
//          clearPickedFiles() and by deleteAllData().
//   Library/Application Support/fitee-deleting (beside fitee/, which it outlives): an empty file while Delete all my
//          data runs (AppInfo.deleting), excluded from backup.
// The Swift code uses no required-reason API (no creation or modification dates, attributesOfItem, stat, volume
// capacity keys, systemUptime or UserDefaults), so the app's privacy manifest declares none.
//
// CONSOLE MARKERS (what the native side prints and CI reads)
// Debug builds only: Release builds never log (loggingBehavior 'debug', capacitor.config.ts). The JS markers go
// through console.info or console.error, which native-bridge.js forwards to the Console plugin, printed to stdout as
//     ⚡️  [info] - <marker line>          ([error] for console.error; Console.swift)
// The Swift markers are printed with print() as the whole line. Find a marker by its name followed by a space,
// anywhere in a line; a JSON marker's JSON runs from that space to the end of the line (readMarker()). CAPLog cuts a
// printed item at 4,068 characters (CAPLog.swift), so a JSON marker stays well under 4,000.
//
//   fitee:ready {json}       JS, src/native/ready.ts, console.info: once per page load, after the first screen has
//                            rendered. ReadyMarker.
//   fitee:selftest {json}    JS, src/native/selftest.ts, console.info: once, in a Debug launch with SELF_TEST_ARG,
//                            after every step has finished or timed out. SelfTestMarker.
//   fitee:rules {json}       Swift, FiteeContentRules.probe, print: once, in a Debug launch with SELF_TEST_ARG.
//                            RulesMarker.
//   fitee:dropped <type> <pluginId>.<method>
//                            Swift, the bridge gate, print: one line per dropped message. <type> is the message's
//                            type; <pluginId>.<method> its pluginId and methodName (for 'cordova': service and action).
//                            A missing value prints as '-'; a body that isn't a dictionary as "fitee:dropped - -.-".
//                            The method follows the last dot (a plugin id can have dots):
//                            "fitee:dropped message Capacitor.CAPHttpPlugin.request".
//   fitee:statusbar <light-text|dark-text|default>
//                            Swift, FiteeViewController.setStatusBarStyle, print: each time the style is set.
//                            light-text = .lightContent (SystemBars DARK), dark-text = .darkContent (LIGHT),
//                            default = .default (DEFAULT).
//   fitee:uncaught <text>    JS, ready.ts, console.error: "<message> at <file>:<line>" for an error event,
//                            "<reason>" for an unhandled rejection.
//   fitee:csp <directive> <blocked URI>
//                            JS, ready.ts, console.error: a securitypolicyviolation (effectiveDirective, blockedURI).
//                            The self-test's own probe (a blocked URI on PROBE_ORIGIN, which WebKit may report as
//                            the origin alone: ContentSecurityPolicy::createURLForReporting) logs
//                            "fitee:csp-probe <directive> <blocked URI>" with console.info instead.
// A launch fails in CI on any "fitee:uncaught " or "fitee:csp " line, Capacitor's "STARTUP JS ERROR", or an [error]
// line, except, in the self-test launch only, MediaPipe's own stderr (messages starting "INFO:", or I, W or E and four
// digits). Each launch must print exactly one "Loading app at" line (one bridge).
import type { VideoExt } from './setFiles';

// ---- What the page reaches through the bridge ------------------------------------------------------------------

/** The only plugins the bridge gate lets the page reach (see the header). */
export const GATE_ALLOWED = ['FiteeNative', 'Console', 'SystemBars'] as const;

/**
 * The self-test's gate step: each is sent with Capacitor.nativePromise(pluginId, method, {}) and must get no answer
 * within 2 s (the gate drops it and prints "fitee:dropped message <pluginId>.<method>"). The other spellings of the
 * HTTP plugin's class would otherwise load the real plugin (NSClassFromString in CapacitorBridge.swift:499-509);
 * FiteeNativePlugin would load a second FiteeNative over the first. Each call is harmless if it ever got through: no
 * URL, a read, or a probe of a class that doesn't exist.
 */
export const GATE_PROBES: readonly { pluginId: string; method: string }[] = [
  { pluginId: 'CapacitorHttp', method: 'request' },
  { pluginId: 'CAPHttpPlugin', method: 'request' },
  { pluginId: 'Capacitor.CAPHttpPlugin', method: 'request' },
  { pluginId: '_TtC9Capacitor13CAPHttpPlugin', method: 'request' },
  { pluginId: 'CapacitorCookies', method: 'getCookies' },
  { pluginId: 'CAPCookiesPlugin', method: 'getCookies' },
  { pluginId: 'WebView', method: 'getServerBasePath' },
  { pluginId: 'CAPWebViewPlugin', method: 'getServerBasePath' },
  { pluginId: 'FiteeNativePlugin', method: 'appInfo' },
  { pluginId: 'FiteeRefusedPlugin', method: 'appInfo' },
];

/** Debug builds launched with this argument (CI's self-test launch) report AppInfo.selfTest and run the rules probe. */
export const SELF_TEST_ARG = '-fiteeSelfTest';

/** Followed by a loopback URL served by CI's job: what the rules probe's throwaway web views fetch (RulesMarker). */
export const PROBE_URL_ARG = '-fiteeProbeURL';

/**
 * An origin the page must never reach: src/privacy.ts and the CSP refuse it before any connection is tried (and
 * nothing listens on port 9). The ready marker's `outside` probe fetches PROBE_ORIGIN + '/fitee-probe'; the
 * self-test's csp step loads PROBE_ORIGIN + '/fitee-csp-probe.png' as an image, its outside step fetches PROBE_ORIGIN + '/'.
 */
export const PROBE_ORIGIN = 'http://127.0.0.1:9';

// ---- Results and errors ----------------------------------------------------------------------------------------

/** What a method that has nothing to report resolves with: {}. */
export type Empty = Record<string, never>;

/** The `code` of a native rejection. NO_ROOM is Cocoa's NSFileWriteOutOfSpaceError or POSIX ENOSPC. */
export const NATIVE_ERROR_CODES = [
  'BAD_NAME',
  'BAD_DATA',
  'BAD_OFFSET',
  'SIZE_MISMATCH',
  'NOT_FOUND',
  'NO_ROOM',
  'IO_ERROR',
  'UNAVAILABLE',
  'EXPORT_FAILED',
] as const;
export type NativeErrorCode = (typeof NATIVE_ERROR_CODES)[number];

/** The code of a native rejection, if it has one of NATIVE_ERROR_CODES. */
export function errorCode(err: unknown): NativeErrorCode | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && (NATIVE_ERROR_CODES as readonly string[]).includes(code) ? (code as NativeErrorCode) : undefined;
}

export interface AppInfo {
  /** CFBundleShortVersionString (MARKETING_VERSION), e.g. "1.0.0". */
  version: string;
  /** CFBundleVersion (CURRENT_PROJECT_VERSION): CI's run number in the builds it uploads. */
  build: string;
  /** A Debug build (#if DEBUG): it logs, and the page loads src/native/ready.ts. */
  debug: boolean;
  /** A Debug build launched with SELF_TEST_ARG: the page runs src/native/selftest.ts. */
  selfTest: boolean;
  /** The content rules (FiteeContentRules.swift) are on the web view. */
  rules: boolean;
  /**
   * The bridge gate is in place on all three ways out (see the header): Capacitor's "bridge" message handler replaced,
   * FiteeUIDelegate the web view's UI delegate (answering what it should: checked at run time) and FiteeNative
   * registered (it cancels navigations).
   */
  gate: boolean;
  /**
   * A Delete all my data began and didn't finish (the app or its page stopped part way: the marker
   * Library/Application Support/fitee-deleting is there). src/native/entry.ts then finishes it (deleteAllData again)
   * before anything reads the data, instead of putting the copy back, which would write the deleted data again.
   */
  deleting: boolean;
}

/** The look of what iOS draws over the page: the Appearance setting ('system' follows the phone). */
export type Appearance = 'light' | 'dark' | 'system';

/** The copy of the log's three files, each only if it exists. */
export interface SnapshotFiles {
  current?: string;
  next?: string;
  prev?: string;
}

/** A file in sets/. */
export interface SetFile {
  name: string;
  bytes: number;
  /** Marked excluded from backup. */
  excluded: boolean;
}

export interface SetFileList {
  files: SetFile[];
  /** The sets/ folder itself is marked excluded from backup. */
  folderExcluded: boolean;
}

/** Which video upload: set `id` (SET_ID) and extension `ext`; its file is sets/<id>.<ext> (sets/<id>.<ext>.part while it runs). */
export interface VideoTarget {
  id: string;
  ext: VideoExt;
}

// ---- The plugin --------------------------------------------------------------------------------------------------

/**
 * FiteeNative (Swift: @objc(FiteeNativePlugin), jsName "FiteeNative", every method CAPPluginReturnPromise). Codes on
 * rejection as listed per method; any method may also reject IO_ERROR for a file operation that failed otherwise.
 * Going to the background (UIScene.didEnterBackgroundNotification, as Capacitor observes, and UIApplication's), the
 * plugin turns the idle timer back on and holds a 5 s background task ("fitee: save a copy of your data"), so a copy
 * write the page posts on visibilitychange can finish.
 */
export interface FiteeNative {
  /**
   * The app's facts. src/native/entry.ts calls it first on every page load.
   * Native: version, build from the bundle's Info.plist; `deleting` (whether the marker exists) on the bridge queue;
   * `rules` and `gate` read on the main queue. Also turns the idle timer back on (isIdleTimerDisabled = false): a page
   * that reloaded after its web process died can't have left the screen awake. Errors: none.
   */
  appInfo(): Promise<AppInfo>;

  /**
   * Keeps the screen on while the camera is in use (`on: true`), or lets it sleep again.
   * Native: UIApplication.shared.isIdleTimerDisabled = on, on the main queue (going to the background, and appInfo,
   * turn it back off). Errors: none.
   */
  setKeepAwake(options: { on: boolean }): Promise<Empty>;

  /**
   * Makes what iOS draws over the page (confirm() alerts, the Save to Files panel, the file picker) follow the
   * Appearance setting. src/native/statusBar.ts calls it whenever the setting changes.
   * Native: the window's overrideUserInterfaceStyle = .light, .dark or .unspecified ('system'), on the main queue.
   * The launch screen can't follow a pinned appearance (it shows before any code runs). Errors: BAD_DATA (another style).
   */
  setAppearance(options: { style: Appearance }): Promise<Empty>;

  /**
   * Saves a file where the person picks, with iOS's Save to Files panel ("Back up my data"): a file saved on the
   * device, never an upload. `name` matches EXPORT_NAME; `text` is the file's content (UTF-8). Resolves when the panel
   * closes: `saved` false when it was cancelled.
   * Native: writes tmp/fitee-export/<name>, presents UIDocumentPickerViewController(forExporting: [url], asCopy: true)
   * from the bridge's view controller, and deletes the file when the panel closes.
   * Errors: BAD_NAME, BAD_DATA (no text), NO_ROOM, UNAVAILABLE (nothing to present the panel from), EXPORT_FAILED
   * (the panel couldn't be shown, or reported an error).
   */
  exportFile(options: { name: string; text: string }): Promise<{ saved: boolean }>;

  /**
   * Deletes the temporary copies iOS gave the app of videos picked for a technique check or filmed with Take Video
   * (iOS would keep them until it empties the folder). The page asks for it (src/native/setsDb.ts clearPickedFiles())
   * when a check on such a video ends: its results close, its analysis ends without results, or the check is left
   * while the video is analysed; and when the picker closes without a file. It's called only once no picked video is
   * in use (being analysed, shown in results or saved) and none was picked since: that check's own end calls it then.
   * Native: deletes everything in FileManager.default.temporaryDirectory except tmp/fitee-export/ while a Save to
   * Files panel is open. Errors: none (what can't be deleted now goes at the next launch).
   */
  clearPickedFiles(): Promise<Empty>;

  /**
   * The copy of the log: the text of data/snapshot.json (`current`), snapshot.next.json (`next`: a write whose renames
   * didn't happen) and snapshot.prev.json (`prev`). A file that exists but isn't UTF-8 comes back as '' (unreadable,
   * like bad JSON). Errors: IO_ERROR when a file exists but couldn't be read: the page must then not start as if
   * there were no copy (src/native/entry.ts shows its start-error screen).
   */
  readSnapshot(): Promise<SnapshotFiles>;

  /**
   * Writes a new copy of the log and keeps the one before. Resolves with the bytes written.
   * Native: writes data/snapshot.next.json ([.atomic, .completeFileProtectionUnlessOpen]); if snapshot.json exists,
   * POSIX rename(2) it to snapshot.prev.json; then rename snapshot.next.json to snapshot.json.
   * Errors: BAD_DATA (no text), NO_ROOM.
   */
  writeSnapshot(options: { text: string }): Promise<{ bytes: number }>;

  /**
   * Deletes data/snapshot.json only: a current copy that isn't valid, dropped before any write, so the rotation can't
   * push it over a good snapshot.prev.json. A missing file is fine. Errors: IO_ERROR.
   */
  dropSnapshot(): Promise<Empty>;

  /**
   * A JSON file in sets/: `name` matches SET_FILE_NAME and ends in .json (index.json, index.unreadable-<ms>.json,
   * <id>.replay.json). Resolves with its text, or without `text` if it doesn't exist.
   * Errors: BAD_NAME, BAD_DATA (it exists but isn't UTF-8).
   */
  readSetFile(options: { name: string }): Promise<{ text?: string }>;

  /**
   * Writes a JSON file in sets/ (names as readSetFile).
   * Native: atomic write with .completeFileProtectionUnlessOpen, then marks the file excluded from backup (again at
   * every save, as Apple asks); sets/ itself is created excluded. Errors: BAD_NAME (not a .json name), BAD_DATA (no text), NO_ROOM.
   */
  writeSetFile(options: { name: string; text: string }): Promise<Empty>;

  /**
   * Renames a file in sets/ (both names match SET_FILE_NAME), replacing `to` if it exists: POSIX rename(2). Sets an
   * unreadable index.json aside as index.unreadable-<ms>.json, so no saved set is deleted on its account; the renamed
   * file stays excluded from backup. Errors: BAD_NAME, NOT_FOUND (`from` doesn't exist).
   */
  renameSetFile(options: { from: string; to: string }): Promise<Empty>;

  /**
   * Deletes files in sets/ (any SET_FILE_NAME, videos too). Missing files are fine. Every name is checked before
   * anything is deleted. Errors: BAD_NAME.
   */
  removeSetFiles(options: { names: string[] }): Promise<Empty>;

  /**
   * What sets/ holds, for the launch's reconcile (src/native/setsDb.ts) and the self-test.
   * Native: first deletes every *.part whose upload isn't running (not in activeParts); then lists the names that
   * match SET_FILE_NAME (anything else is left alone, unlisted), each with its size (fileSizeKey) and backup flag
   * (isExcludedFromBackupKey), and the folder's flag. An absent folder lists nothing. Errors: IO_ERROR.
   */
  listSetFiles(): Promise<SetFileList>;

  /**
   * Starts uploading a saved set's video, `bytes` long. Resolves with `chunk`: the most bytes one appendVideo may
   * carry (CHUNK, 1,048,576).
   * Native: creates an empty sets/<id>.<ext>.part (file protection completeUnlessOpen), replacing a part of that name,
   * and adds it to activeParts (in memory: a part not in it is a leftover).
   * Errors: BAD_NAME (id or ext), BAD_DATA (bytes isn't a whole number of 0 or more), NO_ROOM.
   */
  beginVideo(options: VideoTarget & { bytes: number }): Promise<{ chunk: number }>;

  /**
   * Appends the next chunk: `data` is base64 of at most `chunk` bytes, written at `offset`, which must be the part's
   * size so far. Resolves with the part's size after it (`length`).
   * Native: the part must be in activeParts; Data(base64Encoded:); a FileHandle whose seekToEnd() equals offset;
   * write(contentsOf:); close. Errors: BAD_NAME, NOT_FOUND (no upload running for it), BAD_DATA (not base64, or over
   * `chunk` bytes), BAD_OFFSET, NO_ROOM.
   */
  appendVideo(options: VideoTarget & { offset: number; data: string }): Promise<{ length: number }>;

  /**
   * Ends an upload: the part must hold exactly `bytes`. It then replaces sets/<id>.<ext> (rename(2)), is marked
   * excluded from backup and leaves activeParts. Resolves with the video's size.
   * Errors: BAD_NAME, NOT_FOUND (no upload running for it), SIZE_MISMATCH (the part stays, for abortVideo).
   */
  finishVideo(options: VideoTarget & { bytes: number }): Promise<{ bytes: number }>;

  /** Gives up an upload: deletes its part (a missing one is fine) and removes it from activeParts. Errors: BAD_NAME. */
  abortVideo(options: VideoTarget): Promise<Empty>;

  /**
   * The URL of a saved video (`name` is a video's SET_FILE_NAME), for <video src> and fetch, Range requests
   * included: capacitor://localhost/_capacitor_file_<absolute path>, served by Capacitor's own handler
   * (WebViewAssetHandler.swift:71-89). Ask each time and never store it: the app's folder moves between versions.
   * Native: bridge.portablePath(fromLocalURL:) (CapacitorBridge.swift:762-768). Errors: BAD_NAME, NOT_FOUND.
   */
  videoUrl(options: { name: string }): Promise<{ url: string }>;

  /**
   * Settings → Delete all my data (and, at launch, the end of one that didn't finish: AppInfo.deleting). Resolves once
   * everything the app stored is gone; the page then reloads to the Welcome screen and deletes nothing itself. Pause
   * the copy writer first (src/native/snapshot.ts): a write after this would bring the data back.
   * Native: writes the marker Library/Application Support/fitee-deleting (as well as it can: a phone too full for it
   * still gets its data deleted), removes the whole fitee/ folder and everything in tmp/, clears activeParts, then
   * WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince:
   * .distantPast) (localStorage, IndexedDB and the web view's other stores), then HTTPCookieStorage.shared's cookies
   * (Capacitor copies the web view's there), then removes the marker, and resolves.
   * Errors: IO_ERROR (fitee/ couldn't be removed: the web view's data is then left as it was; or the marker couldn't be
   * removed). Either way the marker stays, so the next launch finishes the delete.
   */
  deleteAllData(): Promise<Empty>;
}

/** Capacitor's built-in SystemBars plugin (CAP Plugins/SystemBars.swift): DARK = light text for a dark page, LIGHT = dark text. */
export interface SystemBarsPlugin {
  setStyle(options: { style: 'DARK' | 'LIGHT' | 'DEFAULT' }): Promise<void>;
}

/** window.Capacitor as this app uses it: native-bridge.js and the plugin stubs. Tests and the Chromium check set globalThis.Capacitor. */
export interface CapacitorGlobal {
  Plugins?: { FiteeNative?: FiteeNative; SystemBars?: SystemBarsPlugin };
  /** native-bridge.js: posts one call; resolves or rejects with the answer, if one ever comes (the gate step uses it). */
  nativePromise?: (pluginId: string, methodName: string, options?: object) => Promise<unknown>;
}

/** window.Capacitor (globalThis.Capacitor in tests), if there is one. */
export const capacitor = (): CapacitorGlobal | undefined => (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;

/** The FiteeNative plugin. Throws if the bridge is missing (src/native/entry.ts then shows its start-error screen). */
export function native(): FiteeNative {
  const plugin = capacitor()?.Plugins?.FiteeNative;
  if (!plugin) throw new Error('fitee’s native bridge is missing');
  return plugin;
}

/** Capacitor's SystemBars plugin, if the bridge has it. */
export const systemBars = (): SystemBarsPlugin | undefined => capacitor()?.Plugins?.SystemBars;

// ---- Console markers -----------------------------------------------------------------------------------------------

export const MARKERS = {
  ready: 'fitee:ready',
  selftest: 'fitee:selftest',
  rules: 'fitee:rules',
  dropped: 'fitee:dropped',
  statusbar: 'fitee:statusbar',
  uncaught: 'fitee:uncaught',
  csp: 'fitee:csp',
  cspProbe: 'fitee:csp-probe',
} as const;

/** A probe's outcome: the request was refused ('blocked'), went through ('loaded'), or the probe itself couldn't run. */
export type ProbeResult = 'blocked' | 'loaded' | `failed: ${string}`;

/**
 * `fitee:ready {json}`. "CI:" is what the simulator check requires in its light and dark launches.
 * `model` below is new URL(poseModelPath('full'), document.baseURI).href (src/offline/manifest.ts).
 */
export interface ReadyMarker {
  /** AppInfo.version. */
  version: string;
  /** AppInfo.build. */
  build: string;
  /** AppInfo.rules. CI: true. */
  rules: boolean;
  /** AppInfo.gate. CI: true. */
  gate: boolean;
  /** location.origin. CI: "capacitor://localhost". */
  origin: string;
  /** new URL(model).origin: what src/privacy.ts compares with location.origin. CI: "capacitor://localhost". */
  urlOrigin: string;
  /** The status of fetch(model, { cache: 'no-store' }) through src/privacy.ts, or the error's text. CI: 200. */
  ownFile: number | string;
  /** The content-type of a fetch of mediapipe/wasm/vision_wasm_internal.wasm (against document.baseURI), or "failed: <error>". CI: "application/wasm". */
  wasmType: string;
  /** fetch(PROBE_ORIGIN + '/fitee-probe'): 'blocked' when it rejects with src/privacy.ts's message ("this app never sends data off the device"). CI: 'blocked'. */
  outside: ProbeResult;
  /** isSecureContext. CI: true. */
  secure: boolean;
  /** !!navigator.mediaDevices?.getUserMedia. CI: true. */
  camera: boolean;
  /** typeof MediaRecorder === 'function'. CI: true. */
  recorder: boolean;
  /** await FilesetResolver.isSimdSupported() (false if it throws). CI: true. */
  simd: boolean;
  /** 'serviceWorker' in navigator. CI: false. */
  sw: boolean;
  /** location.hash. */
  hash: string;
}

/** A self-test step's outcome; `error` says why it failed (or, for a skipped part, why it was skipped). */
export interface SelfTestStep {
  ok: boolean;
  error?: string;
  /**
   * Why the whole step didn't run here, with ok true: set only outside the app, where what it tests isn't there (the
   * gate step without webkit.messageHandlers.bridge, in the Chromium check's stand-in bridge, tools/native-check/).
   * Never in the app: CI fails a skipped step.
   */
  skipped?: string;
}

/** One video of the self-test's video step, saved with uploadVideo under the id "selftest<ms>a" (recorded) or "…b" (random). */
export interface SelfTestVideo extends SelfTestStep {
  /** The Blob's type and size. */
  type: string;
  bytes: number;
  /** listSetFiles() listed <id>.<ext> with the Blob's size. */
  listed: boolean;
  /** That entry's excluded was true. */
  excluded: boolean;
  /** fetch(videoUrl, { headers: { Range: 'bytes=0-99' } }) answered 206 with the Blob's first 100 bytes. */
  range: boolean;
  /** A full fetch of videoUrl gave the Blob's SHA-256 (crypto.subtle). */
  sha256: boolean;
  /** After removeSetFiles, listSetFiles() no longer listed it. */
  removed: boolean;
}

/**
 * `fitee:selftest {json}`. Every step runs, each with its own timeout, so the marker always comes. It touches only its
 * own files and re-saves the unit as it is: it never deletes user data. CI: `ok` true and `skipped` empty; a warning
 * if video.recorded.played is 'skipped'.
 */
export interface SelfTestMarker {
  /** Every step's ok (a skipped step's is true). */
  ok: boolean;
  /**
   * The steps that were skipped (SelfTestStep.skipped), in order: [] in the app, ["gate"] in the Chromium check.
   * selftest.ts always sends it; optional so that a reader written before it (CI's test fixtures) still types.
   */
  skipped?: string[];
  /**
   * Two videos: `recorded`, a 160×120 canvas animated for 2 s, canvas.captureStream(30) → MediaRecorder (video/mp4
   * when supported) → Blob; `random`, 3 MiB + 5 random bytes as video/mp4. ok: both passed and folderExcluded.
   */
  video: SelfTestStep & {
    /** listSetFiles().folderExcluded. */
    folderExcluded: boolean;
    /**
     * `played`: a muted <video playsinline> on its URL reached loadedmetadata, then seeked after currentTime =
     * duration / 2 (10 s). 'skipped' when no recording could be made (ok stays true, `error` says why, the other fields
     * are absent): the random file's checks still run.
     */
    recorded: Partial<SelfTestVideo> & SelfTestStep & { played: boolean | 'skipped' };
    random: SelfTestVideo;
  };
  /**
   * setItem('formcheck.v1.unit', its value or '"kg"') and flushNow(), twice (so the second write rotates the first copy
   * into snapshot.prev.json), then readSnapshot(): current parses (rev: its rev), its rev equals
   * formcheck.v1.device.snapshotRev, its data has the unit, and `rotated`: prev parses and its rev is one less.
   */
  snapshot: SelfTestStep & { rev: number; revMatches: boolean; unitMatches: boolean; rotated: boolean };
  /** createPoseLandmarker('full') (src/pose.ts) resolved, GPU or CPU, then closed: judged by that, not by MediaPipe's log lines. ms: how long it took. */
  pose: SelfTestStep & { delegate: 'GPU' | 'CPU' | ''; ms: number };
  /** new Image().src = PROBE_ORIGIN + '/fitee-csp-probe.png' raised a securitypolicyviolation within 2 s (its effectiveDirective). */
  csp: SelfTestStep & { directive: string };
  /** fetch(PROBE_ORIGIN + '/'): ok when 'blocked' by src/privacy.ts. */
  outside: SelfTestStep & { result: ProbeResult };
  /** setKeepAwake({ on: true }), then { on: false }, resolved. */
  keepAwake: SelfTestStep;
  /**
   * The bridge gate, on its three ways out (see the header), the self-test's last step (if a way out were open and the
   * app went to the background, the marker still comes): each GATE_PROBES call got no answer within 2 s (`silent`; any
   * answer goes in `answered`); then `prompt`, `window` and `navigation`; and an upload begun with beginVideo before
   * all of them still took an appendVideo after them (`stateKept`: the page still runs and no second FiteeNative
   * replaced the first; then aborted). ok: answered empty, prompt, window, navigation, stateKept and AppInfo.gate. CI
   * also requires a "fitee:dropped message <pluginId>.<method>" line for each probe.
   */
  gate: SelfTestStep & {
    silent: string[];
    answered: string[];
    stateKept: boolean;
    /** prompt(JSON.stringify({ type: 'CapacitorCookies.get' })) returned null (Capacitor's UI delegate would answer it with the cookies). */
    prompt: boolean;
    /**
     * window.open(PROBE_ORIGIN + '/fitee-window-probe') returned null and the page stayed (no pagehide, and no
     * visibilitychange to hidden, within 2 s; Capacitor's UI delegate would hand the URL to Safari). WebKit's own popup
     * blocker also stops a window.open without a tap: this guards the case where it wouldn't.
     */
    window: boolean;
    /** location.href = PROBE_ORIGIN + '/fitee-nav-probe': the page stayed (no pagehide, and no visibilitychange to hidden, within 2 s): the navigation was cancelled. */
    navigation: boolean;
  };
}

/** `fitee:rules {json}`: the content rules tried in throwaway web views (a non-persistent data store, a blank page) fetching `url`. */
export interface RulesMarker {
  /** The URL after PROBE_URL_ARG (a loopback server CI's job runs; never another site), or '' without one (both results then "failed: no probe URL"). */
  url: string;
  /** With the app's content rules: CI requires 'blocked'. */
  withRules: ProbeResult;
  /** Without them: 'loaded' shows the probe can tell the difference (CI warns otherwise). */
  withoutRules: ProbeResult;
}

/** The JSON of a `fitee:ready`, `fitee:selftest` or `fitee:rules` marker in a console line (with Capacitor's "⚡️  [info] - " in front or not), or undefined. */
export function readMarker(line: string, marker: typeof MARKERS.ready | typeof MARKERS.selftest | typeof MARKERS.rules): unknown {
  const at = line.indexOf(`${marker} `);
  if (at < 0) return undefined;
  try {
    return JSON.parse(line.slice(at + marker.length + 1)) as unknown;
  } catch {
    return undefined;
  }
}
