// npm run native:sync: puts the iPhone app's web files into the Xcode project (ios/), after npm run build:native and
// before every xcodebuild. It does what the Capacitor CLI's `cap copy ios` does (@capacitor/cli 8.6.3,
// dist/tasks/copy.js:42-160), without the CLI as a dependency, and writes the bundle ID:
//
//   1. ios/App/App/public/ is replaced by a copy of the web build (webDir, dist-native/) (copy.js:136-148).
//   2. public/cordova.js and public/cordova_plugins.js are written empty, and public/plugins/ removed: fitee has no
//      Cordova plugins (cordova.js:136-149, 218-232).
//   3. ios/App/App/config.xml: the CLI's file for a project without Cordova plugins (cordova.js:150-208).
//   4. ios/App/App/capacitor.config.json: capacitor.config.ts's settings, with packageClassList [] (no Capacitor
//      plugin packages: fitee's own plugin is registered in code, FiteeViewController.swift), tab-indented with a
//      final newline, as the CLI writes it (copy.js:123-135, util/iosplugin.js:50-65). Capacitor reads it from the
//      app bundle (CAPInstanceDescriptor.m:14-21, CapacitorBridge.swift:333-363).
//   5. The bundle ID (appId in capacitor.config.ts) into both PRODUCT_BUNDLE_IDENTIFIER lines of
//      ios/App/App.xcodeproj/project.pbxproj; the file is written only if it changed.
//   Then it checks ios/App/App/public/index.html exists.
//
// The first four are git-ignored (ios/.gitignore). What this writes was compared once, file for file, with the real
// CLI's `cap copy ios` on the same project (byte for byte the same); tests/native-project.test.ts pins it.
//
// Node runs this file itself (type stripping): erasable TypeScript only, and node: modules.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import config, { type NativeConfig } from '../capacitor.config.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The Xcode project's paths, from the repo root. */
export const IOS = {
  app: 'ios/App/App',
  public: 'ios/App/App/public',
  config: 'ios/App/App/capacitor.config.json',
  configXml: 'ios/App/App/config.xml',
  pbxproj: 'ios/App/App.xcodeproj/project.pbxproj',
} as const;

/** config.xml as the CLI writes it for a project without Cordova plugins: no final newline. */
export const CONFIG_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  '<widget version="1.0.0" xmlns="http://www.w3.org/ns/widgets" xmlns:cdv="http://cordova.apache.org/ns/1.0">',
  '  <access origin="*" />',
  '  ',
  '  ',
  '</widget>',
].join('\n');

/** capacitor.config.json: the settings without any ios/android buildOptions (as the CLI drops them), then packageClassList []. */
export function capacitorConfigJson(settings: NativeConfig): string {
  const copy = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
  for (const platform of ['ios', 'android']) {
    const options = copy[platform];
    if (options && typeof options === 'object') delete (options as Record<string, unknown>).buildOptions;
  }
  copy.packageClassList = [];
  return `${JSON.stringify(copy, null, '\t')}\n`;
}

/** A bundle ID: reverse-DNS, letters, digits and hyphens between dots. */
export const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

const BUNDLE_ID_LINE = /PRODUCT_BUNDLE_IDENTIFIER = ("[^"\n]*"|[^;\n]*);/g;

/** The values of the PRODUCT_BUNDLE_IDENTIFIER lines in a project.pbxproj (quotes removed). */
export function bundleIds(pbxproj: string): string[] {
  return [...pbxproj.matchAll(BUNDLE_ID_LINE)].map((m) => m[1].replace(/^"(.*)"$/, '$1'));
}

/**
 * project.pbxproj with `appId` in both PRODUCT_BUNDLE_IDENTIFIER lines (the App target's Debug and Release). Throws
 * unless there are exactly two, or if `appId` isn't a bundle ID. Quoted only if it holds a hyphen, as Xcode writes it.
 */
export function setBundleId(pbxproj: string, appId: string): string {
  if (!BUNDLE_ID.test(appId)) throw new Error(`appId "${appId}" in capacitor.config.ts isn't a bundle ID (letters, digits and hyphens between dots)`);
  const found = bundleIds(pbxproj).length;
  if (found !== 2) throw new Error(`expected 2 PRODUCT_BUNDLE_IDENTIFIER lines in ${IOS.pbxproj}, found ${found}`);
  const value = appId.includes('-') ? `"${appId}"` : appId;
  return pbxproj.replace(BUNDLE_ID_LINE, `PRODUCT_BUNDLE_IDENTIFIER = ${value};`);
}

/** What a sync did. */
export interface SyncResult {
  /** The web build's folder, from the root. */
  webDir: string;
  /** Whether project.pbxproj had to change (a new appId). */
  pbxprojChanged: boolean;
}

/** Does the sync in the repo at `root` (a copy of the repo in tests) with `settings` (capacitor.config.ts's). */
export function nativeSync(root: string = ROOT, settings: NativeConfig = config): SyncResult {
  const at = (path: string) => join(root, path);
  const webDir = resolve(root, settings.webDir);
  const fromRoot = relative(root, webDir);
  if (!fromRoot || fromRoot.startsWith('..') || fromRoot.split(sep).includes('..')) {
    throw new Error(`webDir "${settings.webDir}" must be a folder inside the repo`);
  }
  if (!existsSync(join(webDir, 'index.html'))) {
    throw new Error(`${fromRoot}/index.html is missing: run npm run build:native first`);
  }
  if (!existsSync(at(IOS.app)) || !statSync(at(IOS.app)).isDirectory()) throw new Error(`${IOS.app} is missing`);

  // 1-2. The web files (the CLI removes the folder and copies webDir over), then the Cordova files.
  const publicDir = at(IOS.public);
  rmSync(publicDir, { recursive: true, force: true });
  cpSync(webDir, publicDir, { recursive: true });
  rmSync(join(publicDir, 'plugins'), { recursive: true, force: true });
  writeFileSync(join(publicDir, 'cordova.js'), '');
  writeFileSync(join(publicDir, 'cordova_plugins.js'), '');

  // 3-4. The two files Capacitor reads from the app bundle.
  mkdirSync(at(IOS.app), { recursive: true });
  writeFileSync(at(IOS.configXml), CONFIG_XML);
  writeFileSync(at(IOS.config), capacitorConfigJson(settings));

  // 5. The bundle ID.
  const pbxproj = readFileSync(at(IOS.pbxproj), 'utf8');
  const next = setBundleId(pbxproj, settings.appId);
  if (next !== pbxproj) writeFileSync(at(IOS.pbxproj), next);

  if (!existsSync(join(publicDir, 'index.html'))) throw new Error(`${IOS.public}/index.html is missing after the copy`);
  return { webDir: fromRoot, pbxprojChanged: next !== pbxproj };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = nativeSync();
    console.log(
      `native-sync: ${result.webDir}/ copied to ${IOS.public}/, ${IOS.config} and ${IOS.configXml} written; ` +
        `bundle ID ${config.appId} (${result.pbxprojChanged ? 'written into' : 'already in'} ${IOS.pbxproj})`,
    );
  } catch (err) {
    console.error(`native-sync: ${(err as Error).message}`);
    process.exit(1);
  }
}
