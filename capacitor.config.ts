// The iPhone app's Capacitor settings. `npm run native:sync` (scripts/native-sync.ts) writes them, as
// ios/App/App/capacitor.config.json, with the native build (dist-native/) into the Xcode project.
//
// appId is the app's bundle ID and is defined only here: scripts/native-sync.ts writes it into
// ios/App/App.xcodeproj/project.pbxproj, and tests/native-project.test.ts fails if the two differ.
// 'app.fitee' is a placeholder until the App Store Connect record exists; it can't change after release.

/**
 * The settings this app sets, typed here: @capacitor/cli isn't a dependency (scripts/native-sync.ts does what
 * `cap copy ios` does). A subset of the CLI's `CapacitorConfig` (@capacitor/cli 8.6.3, dist/declarations.d.ts);
 * Capacitor reads each key in CAPInstanceDescriptor.swift and CapacitorBridge.swift (@capacitor/ios).
 */
export interface NativeConfig {
  appId: string;
  appName: string;
  webDir: string;
  loggingBehavior: 'none' | 'debug' | 'production';
  server: {
    hostname: string;
    iosScheme: string;
    /** Never set: the app would load its pages from that address instead of from inside the app. */
    url?: never;
  };
  ios: {
    contentInset: 'automatic' | 'scrollableAxes' | 'never' | 'always';
    allowsLinkPreview: boolean;
  };
  plugins: {
    CapacitorHttp: { enabled: boolean };
    CapacitorCookies: { enabled: boolean };
    SystemBars: { style: 'DARK' | 'LIGHT' | 'DEFAULT' };
  };
}

const config: NativeConfig = {
  appId: 'app.fitee',
  appName: 'fitee',
  webDir: 'dist-native',
  // Release builds (TestFlight, App Store) never log. Debug builds print console output to stdout,
  // which the simulator check in CI reads; they also log each plugin call, so they're never for real data.
  loggingBehavior: 'debug',
  server: {
    // The page's origin is capacitor://localhost, and the user's data lives under that origin:
    // never change these two, and never set server.url.
    hostname: 'localhost',
    iosScheme: 'capacitor',
  },
  ios: {
    // The page runs under the status bar and pads itself with env(safe-area-inset-*) (src/style.css).
    contentInset: 'never',
    // Rows and the tab bar are links: no previews or Copy/Share callouts on a long press.
    allowsLinkPreview: false,
  },
  plugins: {
    // fitee makes no network requests: Capacitor's fetch/XHR and cookie patches stay off. (The page can't
    // reach these plugins either: the bridge gate in FiteeViewController.swift drops every call to them.)
    CapacitorHttp: { enabled: false },
    CapacitorCookies: { enabled: false },
    // Until the page sets light or dark text (src/native/statusBar.ts), the status bar follows the phone.
    SystemBars: { style: 'DEFAULT' },
  },
};

export default config;
