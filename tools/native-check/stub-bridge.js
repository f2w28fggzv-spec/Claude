// The Chromium check's stand-in for what Capacitor injects into the iPhone app's web view at document start
// (tools/native-check/check.cjs adds it as an init script, before any of the page's own code): window.Capacitor as
// JSExport.swift and native-bridge.js set it up on iOS, with the native side played by Node.
//
//   - Capacitor.Plugins: a stub per plugin the app's bridge exports (JSExport.exportJS: one function per method,
//     each `Capacitor.nativePromise(jsName, method, options)`): FiteeNative with the contract's methods
//     (src/native/bridge.ts), Console, SystemBars, and Capacitor's own CapacitorHttp, CapacitorCookies and WebView.
//   - Capacitor.nativePromise / nativeCallback / toNative, as native-bridge.js has them, with "native" behind them:
//       FiteeNative  goes to Node through the binding __fiteeNative(method, options, userKeys), where an instance
//                    of tests/fixtures/fakeNative.ts answers (one per launch, kept across reloads). userKeys is the
//                    page's count of user keys in localStorage when it called (the fake logs it);
//       SystemBars   setStyle prints "fitee:statusbar <light-text|dark-text|default>" as FiteeViewController does in
//                    a Debug build (DARK = light text, LIGHT = dark text: Plugins/SystemBars.swift:74-89);
//       Console      prints the line Console.swift prints;
//       anything else is what the app's bridge gate does with it (FiteeBridgeGate, src/native/bridge.ts): dropped,
//                    never answered, and "fitee:dropped message <pluginId>.<method>" printed.
//     What "native" prints goes to Node through the binding __fiteeConsole(line): the console a Debug build of the app
//     shows (CAPLog.print, each printed item cut at 4,068 characters: "⚡️  To Native -> " for each call that passes
//     the gate, "⚡️  TO JS" and 256 characters of each answer), which the check reads as CI reads the simulator's.
//   - console.debug/error/info/log/trace/warn forward to Console.log, as native-bridge.js patches them on iOS
//     (initLogger), so console.info('fitee:ready …') prints "⚡️  [info] - fitee:ready …".
//   - A rejected call is logged as a Debug build's native-bridge.js logs it (logFromNative: a collapsed group around
//     console.error(result.error), so "[error] - {json}"; and natively "ERROR MESSAGE:  {json}", JS.swift:92-100):
//     a rejection the app doesn't expect fails the check, as it fails CI.
//   - A Debug build's window.onerror, which prints Capacitor's "STARTUP JS ERROR" block.
//   - convertFileSrc, getServerUrl, getPlatform ('ios': what the app sees on an iPhone), isNativePlatform,
//     isPluginAvailable, DEBUG and isLoggingEnabled.
//   - __fiteeWebsiteDataRemoved(): what WKWebsiteDataStore's removeData does to the page's stores, for the fake's
//     deleteAllData.
// There is no window.webkit.messageHandlers.bridge, the channel the app's bridge gate guards: only the app has it,
// so the self-test reports its gate step as skipped here (src/native/selftest.ts). With FITEE_STUB.gate the stub
// puts an inert one there, so that one launch of the check runs that step against the stub's imitation of the gate
// (above: calls to other plugins dropped, never answered), to prove the step's own code before CI runs it.
//
// The check puts `var FITEE_STUB = { debug, gate, plugins: { <jsName>: { promise: [methods], none: [methods] } } };`
// in front of this file (debug false: a Release build, which prints nothing).
/* global FITEE_STUB */
(function fiteeStubBridge(config) {
  'use strict';
  // Capacitor's user scripts are for the main frame only (forMainFrameOnly: true).
  if (window.top !== window) return;
  const debug = config.debug !== false;
  const MAX_ITEM = 4068; // CAPLog.print cuts each printed item there
  const print = (...items) => {
    if (!debug) return; // loggingBehavior 'debug': a Release build prints nothing
    const line = items.map((item) => String(item).slice(0, MAX_ITEM)).join(' ');
    try {
      void window.__fiteeConsole(line);
    } catch {
      // No binding (a page the check didn't set up): nothing to print to.
    }
  };

  class CapacitorException extends Error {
    constructor(message, code, data) {
      super(message);
      this.message = message;
      this.code = code;
      this.data = data;
    }
  }

  const serializeConsoleMessage = (msg) => {
    try {
      if (typeof msg === 'object') msg = JSON.stringify(msg);
      return String(msg);
    } catch {
      return '';
    }
  };

  /** The page's user keys in localStorage (src/native/snapshot.ts isUserKey), counted when a call is made. */
  const userKeys = () => {
    try {
      let n = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('formcheck.v1.') && !k.startsWith('formcheck.v1.device.')) n++;
      }
      return n;
    } catch {
      return undefined;
    }
  };

  const original = {};
  for (const method of ['debug', 'error', 'info', 'log', 'trace', 'warn']) original[method] = console[method].bind(console);

  let callbackIdCount = Math.floor(Math.random() * 134217728);
  const STATUS_TEXT = { DARK: 'light-text', LIGHT: 'dark-text', DEFAULT: 'default' };

  /** What the native side does with one call; resolves or rejects as the bridge would answer it, or never. */
  function nativeCall(pluginId, methodName, options, callbackId) {
    if (pluginId === 'Console') {
      if (methodName === 'log') print(`⚡️  [${options.level ?? 'log'}] - ${options.message ?? ''}`);
      return new Promise(() => {}); // CAPPluginReturnNone: never answered
    }
    if (pluginId === 'SystemBars') {
      print('⚡️  To Native -> ', pluginId, methodName, callbackId);
      if (methodName === 'setStyle') {
        const style = String(options.style ?? '').toUpperCase();
        print(`fitee:statusbar ${STATUS_TEXT[style] ?? 'default'}`);
      }
      return Promise.resolve({ success: true, data: {} });
    }
    if (pluginId === 'FiteeNative') {
      print('⚡️  To Native -> ', pluginId, methodName, callbackId);
      return window.__fiteeNative(methodName, options, userKeys()).then((answer) =>
        answer && answer.ok
          ? { success: true, data: answer.value ?? {} }
          : { success: false, error: { message: answer?.message ?? 'Failed', errorMessage: answer?.message ?? 'Failed', ...(answer?.code ? { code: answer.code } : {}) } },
      );
    }
    // The bridge gate: dropped, never answered.
    print(`fitee:dropped message ${pluginId}.${methodName}`);
    return new Promise(() => {});
  }

  const cap = window.Capacitor || {};
  cap.DEBUG = debug;
  cap.isLoggingEnabled = debug;
  cap.Plugins = cap.Plugins || {};
  cap.Exception = CapacitorException;
  window.WEBVIEW_SERVER_URL = location.origin;
  window.CapacitorNativeConfig = { cookiesEnabled: false, httpEnabled: false };
  cap.getServerUrl = () => window.WEBVIEW_SERVER_URL;
  cap.convertFileSrc = (filePath) => {
    if (typeof filePath === 'string') {
      if (filePath.startsWith('/')) return `${window.WEBVIEW_SERVER_URL}/_capacitor_file_${filePath}`;
      if (filePath.startsWith('file://')) return window.WEBVIEW_SERVER_URL + filePath.replace('file://', '/_capacitor_file_');
    }
    return filePath;
  };
  cap.getPlatform = () => 'ios';
  cap.isNativePlatform = () => true;
  cap.isPluginAvailable = (name) => Object.prototype.hasOwnProperty.call(cap.Plugins, name);

  cap.toNative = (pluginName, methodName, options, storedCallback) => {
    const answered = !!storedCallback && (typeof storedCallback.callback === 'function' || typeof storedCallback.resolve === 'function');
    const callbackId = answered ? String(++callbackIdCount) : '-1';
    nativeCall(pluginName, methodName, options || {}, callbackId).then(
      (result) => {
        if (result.success) {
          print('⚡️  TO JS', JSON.stringify(result.data ?? {}).slice(0, 256)); // CapacitorBridge.toJs
          storedCallback?.resolve?.(result.data);
          storedCallback?.callback?.(result.data);
          return;
        }
        // native-bridge.js's returnResult, with a Debug build's logFromNative first.
        print('ERROR MESSAGE: ', JSON.stringify(result.error).slice(0, 512));
        if (cap.isLoggingEnabled) {
          console.groupCollapsed(`%cresult %c${pluginName}.${methodName} (#${callbackId})`, 'font-style: italic; font-weight: lighter; color: red', 'font-style: italic; font-weight: bold; color: #444');
          console.error(result.error);
          console.groupEnd();
        }
        const err = Object.keys(result.error).reduce((e, key) => {
          e[key] = result.error[key];
          return e;
        }, new CapacitorException(''));
        storedCallback?.reject?.(err);
        storedCallback?.callback?.(null, err);
      },
      (err) => {
        // The binding itself failed (the check went away): no answer, as an app whose native side is gone.
        original.warn('native-check stub: no answer from Node', err);
      },
    );
    return callbackId;
  };
  cap.nativeCallback = (pluginName, methodName, options, callback) => cap.toNative(pluginName, methodName, options, { callback });
  cap.nativePromise = (pluginName, methodName, options) => new Promise((resolve, reject) => cap.toNative(pluginName, methodName, options, { resolve, reject }));

  // JSExport.exportJS: one stub per registered plugin, a function per method.
  for (const [jsName, plugin] of Object.entries(config.plugins)) {
    const t = (cap.Plugins[jsName] = {});
    for (const name of plugin.promise ?? []) t[name] = (_options) => cap.nativePromise(jsName, name, _options);
    for (const name of plugin.none ?? []) t[name] = (_options) => cap.nativeCallback(jsName, name, _options);
  }

  // native-bridge.js's initLogger on iOS: every console call is sent to the Console plugin too.
  for (const method of ['debug', 'error', 'info', 'log', 'trace', 'warn']) {
    Object.defineProperty(console, method, {
      configurable: true,
      writable: true,
      value: (...args) => {
        cap.toNative('Console', 'log', { level: method, message: args.map(serializeConsoleMessage).join(' ') });
        return original[method](...args);
      },
    });
  }

  // A Debug build's window.onerror (native-bridge.js handleWindowError): console.error(err), then the js.error
  // message, which the bridge gate forwards and Capacitor prints (WebViewDelegationHandler.logJSError).
  if (debug) {
    window.onerror = (msg, url, lineNo, columnNo, err) => {
      if (String(msg).toLowerCase().includes('script error')) return false;
      if (err !== null) console.error(err);
      const file = String(url ?? '').slice(String(url ?? '').lastIndexOf('/') + 1);
      print('\n⚡️  ------ STARTUP JS ERROR ------\n');
      print(`⚡️  ${msg}`);
      print(`⚡️  URL: ${url ?? ''}`);
      print(`⚡️  ${file}:${lineNo ?? ''}:${columnNo ?? ''}`);
      print('\n⚡️  See above for help with debugging blank-screen issues');
      return false;
    };
  }

  // What WKWebsiteDataStore.removeData(ofTypes: allWebsiteDataTypes(), …) does to the page's own stores, for the
  // fake's deleteAllData (the check calls it from Node): localStorage, sessionStorage, IndexedDB and Cache Storage
  // cleared beneath the page, not through its Storage methods (which the app's copy writer wraps). Kept from
  // document start, before the app's code runs.
  const clearStorage = Storage.prototype.clear;
  Object.defineProperty(window, '__fiteeWebsiteDataRemoved', {
    value: async () => {
      clearStorage.call(localStorage);
      clearStorage.call(sessionStorage);
      const databases = (await indexedDB.databases?.()) ?? [];
      await Promise.all(
        databases.map(
          (d) =>
            new Promise((resolve) => {
              const request = indexedDB.deleteDatabase(d.name);
              request.onsuccess = request.onerror = request.onblocked = () => resolve();
            }),
        ),
      );
      if (typeof caches === 'object') for (const key of await caches.keys()) await caches.delete(key);
    },
  });

  // The stand-in for the gate's channel (see the header): inert, since every call above goes through toNative.
  if (config.gate) {
    Object.defineProperty(window, 'webkit', { configurable: true, value: { messageHandlers: { bridge: { postMessage() {} } } } });
  }

  window.Capacitor = cap;
})(typeof FITEE_STUB === 'object' && FITEE_STUB ? FITEE_STUB : { plugins: {}, debug: true });
