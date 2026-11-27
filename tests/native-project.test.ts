// The iPhone app's Xcode project (ios/), checked on Linux, where nothing can build it (CI's macOS runner does):
// capacitor.config.ts, the pbxproj (parsed), the scheme, the CocoaPods files, Info.plist, the privacy manifest, the
// icon, the launch screen and its colours, the Swift code against the native contract (src/native/bridge.ts and
// src/native/setFiles.ts: method names, arguments, results, error codes, patterns, markers), and what
// npm run native:sync (scripts/native-sync.ts) writes, which was compared once with the Capacitor CLI's `cap copy ios`.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { crc32 } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import config from '../capacitor.config';
import { BUNDLE_ID, CONFIG_XML, IOS, bundleIds, capacitorConfigJson, nativeSync, setBundleId } from '../scripts/native-sync';
import { GATE_ALLOWED, MARKERS, NATIVE_ERROR_CODES, PROBE_URL_ARG, SELF_TEST_ARG } from '../src/native/bridge';
import { CHUNK, EXPORT_NAME, SET_FILE_NAME, SET_ID, VIDEO_EXTS } from '../src/native/setFiles';

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const APP = 'ios/App/App';
const SWIFT = ['AppDelegate.swift', 'SceneDelegate.swift', 'FiteeViewController.swift', 'FiteeContentRules.swift', 'FiteeNativePlugin.swift', 'FiteeFiles.swift'];
const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');

/** Every file under a folder (from the repo root), skipping folders named in `skip`. */
const walk = (dir: string, skip: string[] = []): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (skip.includes(name)) return [];
    return statSync(join(ROOT, path)).isDirectory() ? walk(path, skip) : [path];
  });

// ---- A strict XML parser (for plists, the storyboard, the scheme and the workspace) --------------------------------

interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: (XmlElement | string)[];
}

/** Parses XML 1.0 strictly enough for these files: one root, matched tags, quoted attributes, known entities, no `--` in a comment. Throws on anything else. */
function parseXml(text: string): XmlElement {
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`XML: ${what} at offset ${i} (${JSON.stringify(text.slice(i, i + 30))})`);
  };
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) fail('a control character');
  const space = () => {
    while (i < text.length && ' \t\r\n'.includes(text[i])) i++;
  };
  const NAME = /[A-Za-z_][-A-Za-z0-9_.:]*/y;
  const name = () => {
    NAME.lastIndex = i;
    const m = NAME.exec(text);
    if (!m) return fail('a name');
    i += m[0].length;
    return m[0];
  };
  const decode = (raw: string) =>
    raw.replace(/&([^;&\s]*);?/g, (all, ref: string) => {
      if (!all.endsWith(';')) return fail('an entity without ;');
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (ref in named) return named[ref];
      const num = /^#(x[0-9A-Fa-f]+|[0-9]+)$/.exec(ref);
      if (!num) return fail(`an unknown entity &${ref};`);
      return String.fromCodePoint(num[1].startsWith('x') ? parseInt(num[1].slice(1), 16) : Number(num[1]));
    });
  const comment = () => {
    const end = text.indexOf('-->', i + 4);
    if (end < 0) fail('the end of a comment');
    const body = text.slice(i + 4, end);
    if (body.includes('--') || body.endsWith('-')) fail('"--" inside a comment');
    i = end + 3;
  };
  const misc = () => {
    for (;;) {
      space();
      if (text.startsWith('<!--', i)) comment();
      else if (text.startsWith('<?', i)) {
        const end = text.indexOf('?>', i);
        if (end < 0) fail('the end of a processing instruction');
        i = end + 2;
      } else return;
    }
  };
  const element = (): XmlElement => {
    if (text[i] !== '<') fail('<');
    i++;
    const el: XmlElement = { name: name(), attrs: {}, children: [] };
    for (;;) {
      const before = i;
      space();
      if (text.startsWith('/>', i)) {
        i += 2;
        return el;
      }
      if (text[i] === '>') {
        i++;
        break;
      }
      if (i === before) fail('a space before an attribute');
      const key = name();
      if (key in el.attrs) fail(`attribute ${key} twice`);
      space();
      if (text[i] !== '=') fail('=');
      i++;
      space();
      const quote = text[i];
      if (quote !== '"' && quote !== "'") fail('a quoted attribute value');
      const end = text.indexOf(quote, i + 1);
      if (end < 0) fail('the end of an attribute value');
      const raw = text.slice(i + 1, end);
      if (raw.includes('<')) fail('< in an attribute value');
      el.attrs[key] = decode(raw);
      i = end + 1;
    }
    for (;;) {
      if (i >= text.length) fail(`</${el.name}>`);
      if (text.startsWith('</', i)) {
        i += 2;
        if (name() !== el.name) fail(`</${el.name}>`);
        space();
        if (text[i] !== '>') fail('>');
        i++;
        return el;
      }
      if (text.startsWith('<!--', i)) comment();
      else if (text.startsWith('<![CDATA[', i)) {
        const end = text.indexOf(']]>', i);
        if (end < 0) fail('the end of a CDATA section');
        el.children.push(text.slice(i + 9, end));
        i = end + 3;
      } else if (text[i] === '<') el.children.push(element());
      else {
        const end = text.indexOf('<', i);
        const raw = text.slice(i, end < 0 ? text.length : end);
        if (raw.includes(']]>')) fail(']]> in text');
        el.children.push(decode(raw));
        i += raw.length;
      }
    }
  };
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  misc();
  if (text.startsWith('<!DOCTYPE', i)) {
    const end = text.indexOf('>', i);
    if (end < 0 || text.slice(i, end).includes('[')) fail('a DOCTYPE without an internal subset');
    i = end + 1;
    misc();
  }
  const root = element();
  misc();
  if (i !== text.length) fail('the end of the document');
  return root;
}

const elements = (el: XmlElement) => el.children.filter((c): c is XmlElement => typeof c !== 'string');
const textOf = (el: XmlElement) => {
  if (elements(el).length) throw new Error(`plist: <${el.name}> holds elements`);
  return el.children.join('');
};
/** Every element in the tree with this name. */
const findAll = (el: XmlElement, name: string): XmlElement[] => [...(el.name === name ? [el] : []), ...elements(el).flatMap((c) => findAll(c, name))];

type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

/** A property list in Apple's XML format, parsed strictly (plutil isn't on Linux). */
function parsePlist(text: string): PlistValue {
  expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n')).toBe(true);
  const root = parseXml(text);
  if (root.name !== 'plist' || root.attrs.version !== '1.0') throw new Error('plist: no <plist version="1.0">');
  const blank = (el: XmlElement) => el.children.every((c) => typeof c !== 'string' || !c.trim());
  const value = (el: XmlElement): PlistValue => {
    switch (el.name) {
      case 'dict': {
        if (!blank(el)) throw new Error('plist: text in <dict>');
        const items = elements(el);
        if (items.length % 2) throw new Error('plist: a <dict> with a key and no value');
        const dict: { [key: string]: PlistValue } = {};
        for (let k = 0; k < items.length; k += 2) {
          if (items[k].name !== 'key') throw new Error(`plist: <${items[k].name}> where a <key> belongs`);
          const key = textOf(items[k]);
          if (key in dict) throw new Error(`plist: key ${key} twice`);
          dict[key] = value(items[k + 1]);
        }
        return dict;
      }
      case 'array':
        if (!blank(el)) throw new Error('plist: text in <array>');
        return elements(el).map(value);
      case 'string':
        return textOf(el);
      case 'integer':
        if (!/^[+-]?\d+$/.test(textOf(el))) throw new Error('plist: a bad <integer>');
        return Number(textOf(el));
      case 'true':
      case 'false':
        if (el.children.length) throw new Error(`plist: <${el.name}> isn't empty`);
        return el.name === 'true';
      default:
        throw new Error(`plist: <${el.name}> isn't used here`);
    }
  };
  if (!blank(root) || elements(root).length !== 1) throw new Error('plist: <plist> must hold one value');
  return value(elements(root)[0]);
}

// ---- project.pbxproj ------------------------------------------------------------------------------------------------

type Pbx = string | Pbx[] | { [key: string]: Pbx };
type PbxObject = { [key: string]: Pbx };

/** project.pbxproj: an old-style property list ({ key = value; }, ( a, b, ), quoted or bare strings, comments). Throws on anything else. */
function parsePbxproj(text: string): PbxObject {
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`project.pbxproj: expected ${what} at ${JSON.stringify(text.slice(i, i + 40))}`);
  };
  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i + 2);
        if (end < 0) fail('the end of a comment');
        i = end + 2;
      } else if (text.startsWith('//', i)) {
        const end = text.indexOf('\n', i);
        i = end < 0 ? text.length : end + 1;
      } else return;
    }
  };
  const BARE = /[A-Za-z0-9_$+/:.-]+/y;
  const string = (): string => {
    skip();
    if (text[i] === '"') {
      let out = '';
      i++;
      while (text[i] !== '"') {
        if (i >= text.length) fail('the end of a string');
        if (text[i] === '\\') {
          const next = text[i + 1];
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
        } else out += text[i++];
      }
      i++;
      return out;
    }
    BARE.lastIndex = i;
    const m = BARE.exec(text);
    if (!m) return fail('a value');
    i += m[0].length;
    return m[0];
  };
  const value = (): Pbx => {
    skip();
    if (text[i] === '{') {
      i++;
      const dict: PbxObject = {};
      for (;;) {
        skip();
        if (text[i] === '}') {
          i++;
          return dict;
        }
        const key = string();
        if (key in dict) fail(`a key not given before (${key})`);
        skip();
        if (text[i] !== '=') fail('=');
        i++;
        dict[key] = value();
        skip();
        if (text[i] !== ';') fail(';');
        i++;
      }
    }
    if (text[i] === '(') {
      i++;
      const list: Pbx[] = [];
      for (;;) {
        skip();
        if (text[i] === ')') {
          i++;
          return list;
        }
        list.push(value());
        skip();
        if (text[i] === ',') i++;
        else if (text[i] !== ')') fail(', or )');
      }
    }
    return string();
  };
  expect(text.startsWith('// !$*UTF8*$!\n')).toBe(true);
  const root = value();
  skip();
  if (i !== text.length) fail('the end of the file');
  if (typeof root !== 'object' || Array.isArray(root)) fail('a dictionary');
  return root as PbxObject;
}

const PBX_TEXT = read(IOS.pbxproj);
const PBX = parsePbxproj(PBX_TEXT);
const OBJECTS = PBX.objects as { [id: string]: PbxObject };
const obj = (id: Pbx): PbxObject => {
  const found = OBJECTS[id as string];
  if (!found) throw new Error(`project.pbxproj: no object ${String(id)}`);
  return found;
};
const PROJECT = obj(PBX.rootObject);
const TARGETS = (PROJECT.targets as string[]).map(obj);
const APP_TARGET_ID = (PROJECT.targets as string[]).find((id) => obj(id).name === 'App') as string;
const APP_TARGET = obj(APP_TARGET_ID);
const configs = (list: Pbx) => (obj(list).buildConfigurations as string[]).map(obj);
const settingsOf = (c: PbxObject) => c.buildSettings as { [key: string]: Pbx };
const phase = (isa: string) => {
  const found = (APP_TARGET.buildPhases as string[]).map(obj).find((p) => p.isa === isa);
  if (!found) throw new Error(`no ${isa} in the App target`);
  return found;
};
/** A build phase's files, by the name its file reference (or variant group) has. */
const phaseFiles = (isa: string) => (phase(isa).files as string[]).map((id) => obj(obj(id).fileRef)).map((f) => (f.path ?? f.name) as string);

// ---- Swift ----------------------------------------------------------------------------------------------------------

const swiftSource = (file: string) => read(`${APP}/${file}`);

/** Swift source with its comments (line, and nested block) taken out; string literals, raw and multi-line ones and interpolations included, are kept. */
function withoutSwiftComments(src: string): string {
  let out = '';
  let i = 0;
  const code = (inInterpolation: boolean) => {
    let depth = 0;
    while (i < src.length) {
      if (src.startsWith('//', i)) {
        while (i < src.length && src[i] !== '\n') i++;
      } else if (src.startsWith('/*', i)) {
        let nested = 0;
        do {
          if (src.startsWith('/*', i)) {
            nested++;
            i += 2;
          } else if (src.startsWith('*/', i)) {
            nested--;
            i += 2;
          } else {
            if (src[i] === '\n') out += '\n';
            i++;
          }
        } while (nested > 0 && i < src.length);
        out += ' ';
      } else if (src[i] === '"' || (src[i] === '#' && /^#+"/.test(src.slice(i, i + 8)))) {
        string();
      } else {
        if (inInterpolation && src[i] === '(') depth++;
        if (inInterpolation && src[i] === ')') {
          if (depth === 0) return;
          depth--;
        }
        out += src[i++];
      }
    }
  };
  const string = () => {
    let hashes = '';
    while (src[i] === '#') hashes += src[i++];
    const quote = src.startsWith('"""', i) ? '"""' : '"';
    out += hashes + quote;
    i += quote.length;
    const close = quote + hashes;
    const escape = `\\${hashes}`;
    while (i < src.length) {
      if (src.startsWith(close, i)) {
        out += close;
        i += close.length;
        return;
      }
      if (src.startsWith(`${escape}(`, i)) {
        out += `${escape}(`;
        i += escape.length + 1;
        code(true);
        out += src[i] ?? '';
        i++;
      } else if (src.startsWith(escape, i)) {
        out += src.slice(i, i + escape.length + 1);
        i += escape.length + 1;
      } else out += src[i++];
    }
  };
  code(false);
  return out;
}

/** The code a Release build compiles: `#if DEBUG` parts left out (their `#else` parts kept). */
function releaseCode(src: string): string {
  const kept: string[] = [];
  const stack: { debug: boolean; keep: boolean }[] = [];
  const keeping = () => stack.every((s) => s.keep);
  for (const line of withoutSwiftComments(src).split('\n')) {
    const directive = line.trim();
    if (/^#if\b/.test(directive)) stack.push({ debug: directive === '#if DEBUG', keep: directive !== '#if DEBUG' });
    else if (directive === '#else') {
      const top = stack[stack.length - 1];
      if (!top) throw new Error('#else without #if');
      if (top.debug) top.keep = true;
    } else if (/^#elseif\b/.test(directive)) throw new Error('#elseif: extend releaseCode() before using it');
    else if (directive === '#endif') {
      if (!stack.pop()) throw new Error('#endif without #if');
    } else if (keeping()) kept.push(line);
  }
  if (stack.length) throw new Error('#if without #endif');
  return kept.join('\n');
}

/** The members of a TypeScript interface in src/native/bridge.ts: name and the text of its declaration. */
function tsInterface(name: string): Map<string, string> {
  const src = read('src/native/bridge.ts');
  const start = src.indexOf(`export interface ${name} {`);
  expect(start, `interface ${name} in src/native/bridge.ts`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf('\n}\n', start);
  const body = src
    .slice(start, end)
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const members = new Map<string, string>();
  const re = /^ {2}(\w+)\??(\(|:)/gm;
  const found = [...body.matchAll(re)];
  found.forEach((m, k) => members.set(m[1], body.slice(m.index, found[k + 1]?.index ?? body.length)));
  return members;
}

/** The option keys a TypeScript method signature takes (VideoTarget is id and ext). */
function tsOptionKeys(signature: string): string[] {
  const params = signature.slice(signature.indexOf('('), signature.lastIndexOf('): Promise<'));
  const keys = [...params.matchAll(/(\w+)\??:/g)].map((m) => m[1]).filter((k) => k !== 'options');
  if (/\bVideoTarget\b/.test(params)) keys.push('id', 'ext');
  return keys.sort();
}

/** The keys of what a TypeScript method resolves with: an object type's keys, a named interface's members, none for Empty. */
function tsResultKeys(signature: string): string[] | undefined {
  const result = signature.slice(signature.lastIndexOf('Promise<') + 8, signature.lastIndexOf('>'));
  if (result === 'Empty') return [];
  if (result.startsWith('{')) return [...result.matchAll(/(\w+)\??:/g)].map((m) => m[1]).sort();
  if (/^\w+$/.test(result)) return [...tsInterface(result).keys()].sort();
  return undefined;
}

const PLUGIN = releaseCode(swiftSource('FiteeNativePlugin.swift'));
/** Each `@objc func name(_ call: CAPPluginCall)` of the plugin, with its body (up to the next one). */
const SWIFT_METHODS = (() => {
  const methods = new Map<string, string>();
  const found = [...PLUGIN.matchAll(/@objc func (\w+)\(_ call: CAPPluginCall\) \{/g)];
  found.forEach((m, k) => methods.set(m[1], PLUGIN.slice(m.index, found[k + 1]?.index ?? PLUGIN.indexOf('final class FiteeExportPanel'))));
  return methods;
})();

// ---- The tests ------------------------------------------------------------------------------------------------------

describe('capacitor.config.ts', () => {
  it('has the settings the app relies on, and never a server URL', () => {
    expect(config.appId).toMatch(BUNDLE_ID);
    expect(config).toMatchObject({
      appId: 'app.fitee',
      appName: 'fitee',
      webDir: 'dist-native',
      loggingBehavior: 'debug',
      server: { hostname: 'localhost', iosScheme: 'capacitor' },
      ios: { contentInset: 'never', allowsLinkPreview: false },
      plugins: { CapacitorHttp: { enabled: false }, CapacitorCookies: { enabled: false }, SystemBars: { style: 'DEFAULT' } },
    });
    expect('url' in config.server).toBe(false);
    expect(config.loggingBehavior).not.toBe('production');
  });

  it('needs no @capacitor/cli: not a dependency, not imported', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies?: object; devDependencies?: object };
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain('@capacitor/cli');
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, unknown> };
    expect(Object.keys(lock.packages).filter((p) => p.includes('@capacitor/cli'))).toEqual([]);
    expect(read('capacitor.config.ts')).not.toMatch(/from ['"]@capacitor\/cli['"]/);
    expect(read('scripts/native-sync.ts')).not.toMatch(/from ['"]@capacitor\//);
  });
});

describe('the Xcode project (project.pbxproj)', () => {
  it('parses, and every object it names exists', () => {
    const ids = new Set<string>();
    const collect = (v: Pbx) => {
      if (typeof v === 'string') {
        if (/^[0-9A-F]{24}$/.test(v)) ids.add(v);
      } else if (Array.isArray(v)) v.forEach(collect);
      else Object.entries(v).forEach(([k, inner]) => (k === 'objects' ? Object.values(inner as PbxObject).forEach(collect) : collect(inner)));
    };
    collect(PBX);
    expect([...ids].filter((id) => !OBJECTS[id])).toEqual([]);
    for (const id of Object.keys(OBJECTS)) expect(id).toMatch(/^[0-9A-F]{24}$/);
    expect(TARGETS.map((t) => t.name)).toEqual(['App']);
  });

  it('targets iOS 17.0, iPhone only, version 1.0.0 (1), no team, no sandboxed CocoaPods scripts', () => {
    const all = [...configs(PROJECT.buildConfigurationList), ...configs(APP_TARGET.buildConfigurationList)];
    expect(all.map((c) => settingsOf(c).IPHONEOS_DEPLOYMENT_TARGET)).toEqual(['17.0', '17.0', '17.0', '17.0']);
    expect(PBX_TEXT.match(/IPHONEOS_DEPLOYMENT_TARGET = 17\.0;/g)).toHaveLength(4);
    const target = configs(APP_TARGET.buildConfigurationList);
    expect(target.map((c) => c.name).sort()).toEqual(['Debug', 'Release']);
    for (const c of target) {
      const s = settingsOf(c);
      expect(s).toMatchObject({
        TARGETED_DEVICE_FAMILY: '1',
        MARKETING_VERSION: '1.0.0',
        CURRENT_PROJECT_VERSION: '1',
        ENABLE_USER_SCRIPT_SANDBOXING: 'NO',
        SWIFT_VERSION: '5.0',
        CODE_SIGN_STYLE: 'Automatic',
        INFOPLIST_FILE: 'App/Info.plist',
        ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
        PRODUCT_BUNDLE_IDENTIFIER: config.appId,
      });
      expect(s.DEVELOPMENT_TEAM).toBeUndefined();
      expect(s.SWIFT_ACTIVE_COMPILATION_CONDITIONS).toBe(c.name === 'Debug' ? 'DEBUG' : '');
    }
    expect(PBX_TEXT).not.toMatch(/DEVELOPMENT_TEAM/);
  });

  it('bundle ID: both PRODUCT_BUNDLE_IDENTIFIER lines are appId (npm run native:sync writes them)', () => {
    expect(bundleIds(PBX_TEXT)).toEqual([config.appId, config.appId]);
    expect(setBundleId(PBX_TEXT, config.appId)).toBe(PBX_TEXT);
  });

  it('compiles the six Swift files, and ships the privacy manifest; no Main.storyboard, no Swift packages', () => {
    expect(phaseFiles('PBXSourcesBuildPhase').sort()).toEqual([...SWIFT].sort());
    const onDisk = readdirSync(join(ROOT, APP)).filter((f) => f.endsWith('.swift'));
    expect(onDisk.sort()).toEqual([...SWIFT].sort());
    expect(phaseFiles('PBXResourcesBuildPhase').sort()).toEqual(
      ['Assets.xcassets', 'LaunchScreen.storyboard', 'PrivacyInfo.xcprivacy', 'capacitor.config.json', 'config.xml', 'public'].sort(),
    );
    expect(PBX_TEXT).not.toMatch(/Main\.storyboard|Splash|AppIcon-512/);
    const isas = new Set(Object.values(OBJECTS).map((o) => o.isa));
    for (const isa of ['XCLocalSwiftPackageReference', 'XCRemoteSwiftPackageReference', 'XCSwiftPackageProductDependency']) expect(isas.has(isa)).toBe(false);
    expect(PROJECT.packageReferences ?? []).toEqual([]);
    expect(PBX_TEXT).not.toMatch(/CapApp-SPM|capacitor-swift-pm/);
    // CocoaPods' phases: the Pods' lock check and their frameworks embedded.
    const scripts = (APP_TARGET.buildPhases as string[]).map(obj).filter((p) => p.isa === 'PBXShellScriptBuildPhase').map((p) => p.name);
    expect(scripts).toEqual(['[CP] Check Pods Manifest.lock', '[CP] Embed Pods Frameworks']);
  });

  it('every file the App group names is in ios/App/App (except what npm run native:sync writes)', () => {
    const group = obj((obj(PROJECT.mainGroup).children as string[]).find((id) => obj(id).path === 'App') as string);
    const names = (group.children as string[]).map(obj).map((f) => (f.path ?? f.name) as string);
    const generated = ['capacitor.config.json', 'config.xml', 'public'];
    for (const name of names.filter((n) => !generated.includes(n))) {
      const path = name === 'LaunchScreen.storyboard' ? 'Base.lproj/LaunchScreen.storyboard' : name;
      expect(existsSync(join(ROOT, APP, path)), path).toBe(true);
    }
  });

  it('has a shared scheme for the App target that builds the pods first', () => {
    const scheme = parseXml(read('ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme'));
    expect(findAll(scheme, 'BuildAction')[0].attrs.buildImplicitDependencies).toBe('YES');
    const refs = findAll(scheme, 'BuildableReference');
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.attrs).toMatchObject({ BlueprintIdentifier: APP_TARGET_ID, BuildableName: 'App.app', BlueprintName: 'App', ReferencedContainer: 'container:App.xcodeproj' });
    }
    expect(findAll(scheme, 'LaunchAction')[0].attrs.buildConfiguration).toBe('Debug');
    expect(findAll(scheme, 'ArchiveAction')[0].attrs.buildConfiguration).toBe('Release');
  });
});

describe('CocoaPods (committed: CI never runs pod install)', () => {
  const podfile = read('ios/App/Podfile');
  const lock = read('ios/App/Podfile.lock');
  const capacitorVersion = (JSON.parse(read('node_modules/@capacitor/ios/package.json')) as { version: string }).version;

  it('Podfile: iOS 17.0, and only the two Capacitor pods, by path from node_modules', () => {
    expect(podfile).toMatch(/^platform :ios, '17\.0'$/m);
    expect(podfile).toMatch(/^require_relative '\.\.\/\.\.\/node_modules\/@capacitor\/ios\/scripts\/pods_helpers'$/m);
    const pods = [...podfile.matchAll(/^\s*pod (.+)$/gm)].map((m) => m[1]);
    expect(pods).toEqual([
      "'Capacitor', :path => '../../node_modules/@capacitor/ios'",
      "'CapacitorCordova', :path => '../../node_modules/@capacitor/ios'",
    ]);
  });

  it('Podfile.lock is Pods/Manifest.lock, made from this Podfile and the installed Capacitor (else run pod install again)', () => {
    expect(read('ios/App/Pods/Manifest.lock')).toBe(lock);
    expect(lock).toContain(`PODFILE CHECKSUM: ${sha1(podfile)}`);
    expect(lock).toMatch(/^COCOAPODS: 1\.17\.0$/m);
    expect(lock).toContain(`  - Capacitor (${capacitorVersion}):`);
    expect(lock).toContain(`  - CapacitorCordova (${capacitorVersion})`);
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies['@capacitor/ios']).toBe(capacitorVersion);
    for (const pod of ['Capacitor', 'CapacitorCordova']) {
      const spec = read(`ios/App/Pods/Local Podspecs/${pod}.podspec.json`);
      expect((JSON.parse(spec) as { version: string }).version).toBe(capacitorVersion);
      expect(lock).toContain(`  ${pod}: ${sha1(spec)}`);
    }
  });

  it('the committed files hold no absolute paths (Pods, the workspace, the project)', () => {
    const files = [...walk('ios/App/Pods', ['xcuserdata']), ...walk('ios/App/App.xcworkspace'), ...walk('ios/App/App.xcodeproj', ['xcuserdata']), 'ios/App/Podfile.lock'];
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) expect(read(file), file).not.toMatch(/\/Users\/|\/home\/|\/root\/|\/tmp\//);
    const workspace = parseXml(read('ios/App/App.xcworkspace/contents.xcworkspacedata'));
    expect(findAll(workspace, 'FileRef').map((r) => r.attrs.location)).toEqual(['group:App.xcodeproj', 'group:Pods/Pods.xcodeproj']);
  });
});

describe('Info.plist and the privacy manifest', () => {
  const info = parsePlist(read(`${APP}/Info.plist`)) as { [key: string]: PlistValue };

  it('has exactly the app keys, with the purpose strings in full', () => {
    expect(Object.keys(info).sort()).toEqual(
      [
        'CFBundleDevelopmentRegion',
        'CFBundleDisplayName',
        'CFBundleExecutable',
        'CFBundleIdentifier',
        'CFBundleInfoDictionaryVersion',
        'CFBundleName',
        'CFBundlePackageType',
        'CFBundleShortVersionString',
        'CFBundleVersion',
        'ITSAppUsesNonExemptEncryption',
        'LSApplicationCategoryType',
        'LSRequiresIPhoneOS',
        'NSCameraUsageDescription',
        'NSMicrophoneUsageDescription',
        'UIApplicationSceneManifest',
        'UILaunchStoryboardName',
        'UIRequiredDeviceCapabilities',
        'UISupportedInterfaceOrientations',
        'UIViewControllerBasedStatusBarAppearance',
      ].sort(),
    );
    expect(info).toMatchObject({
      CFBundleDisplayName: config.appName,
      CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
      CFBundleShortVersionString: '$(MARKETING_VERSION)',
      CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
      ITSAppUsesNonExemptEncryption: false,
      LSApplicationCategoryType: 'public.app-category.healthcare-fitness',
      LSRequiresIPhoneOS: true,
      UILaunchStoryboardName: 'LaunchScreen',
      UIRequiredDeviceCapabilities: ['arm64'],
      UISupportedInterfaceOrientations: ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
      UIViewControllerBasedStatusBarAppearance: true,
      NSCameraUsageDescription: 'fitee uses the camera to give technique feedback on your sets. The video is analysed on this iPhone and never uploaded.',
      NSMicrophoneUsageDescription:
        'fitee doesn’t record sound itself. iOS asks for the microphone only if you choose Take Video when picking a set to check; that video keeps its sound and stays on this iPhone.',
    });
  });

  it('one scene, made in code by SceneDelegate: no storyboard keys', () => {
    expect(info.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate' }],
      },
    });
    expect(read(`${APP}/Info.plist`)).not.toMatch(/StoryboardFile|~ipad|NSAppTransportSecurity|UIBackgroundModes|NSPhotoLibrary|UIFileSharingEnabled|LSSupportsOpeningDocumentsInPlace/);
  });

  it('PrivacyInfo.xcprivacy: no tracking, no data collected, no required-reason API', () => {
    expect(parsePlist(read(`${APP}/PrivacyInfo.xcprivacy`))).toEqual({
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [],
    });
  });

  it('every plist and XML file of the project parses strictly', () => {
    const files = [
      ...walk('ios', ['public', 'xcuserdata', 'node_modules']).filter((f) => /\.(plist|xcprivacy|storyboard|xcscheme|xcworkspacedata)$/.test(f)),
    ];
    expect(files).toEqual(expect.arrayContaining([`${APP}/Info.plist`, `${APP}/PrivacyInfo.xcprivacy`, `${APP}/Base.lproj/LaunchScreen.storyboard`]));
    for (const file of files) {
      if (/\.(plist|xcprivacy)$/.test(file)) expect(() => parsePlist(read(file)), file).not.toThrow();
      else expect(() => parseXml(read(file)), file).not.toThrow();
    }
  });
});

describe('icon, launch screen and colours', () => {
  const hexOf = (c: { red: string; green: string; blue: string }) =>
    `#${[c.red, c.green, c.blue].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  const tokens = read('src/tokens.css');
  const pageColour = (block: RegExp) => {
    const m = block.exec(tokens);
    if (!m) throw new Error(`tokens.css: no ${block}`);
    return (/--bg:\s*(#[0-9a-f]{6});/i.exec(m[1]) as RegExpExecArray)[1].toLowerCase();
  };
  const LIGHT_BG = pageColour(/^:root \{([\s\S]*?)\n\}/m);
  const DARK_BG = pageColour(/^:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/m);

  it('AppIcon-1024.png: 1024 x 1024, 8-bit RGB, no alpha or transparency, valid chunks; the only image of the icon set', () => {
    const dir = `${APP}/Assets.xcassets/AppIcon.appiconset`;
    expect(readdirSync(join(ROOT, dir)).sort()).toEqual(['AppIcon-1024.png', 'Contents.json']);
    expect(JSON.parse(read(`${dir}/Contents.json`))).toEqual({
      images: [{ filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
      info: { author: 'xcode', version: 1 },
    });
    const png = readFileSync(join(ROOT, dir, 'AppIcon-1024.png'));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunks: string[] = [];
    for (let at = 8; at < png.length; ) {
      const length = png.readUInt32BE(at);
      const body = png.subarray(at + 4, at + 8 + length);
      expect(png.readUInt32BE(at + 8 + length)).toBe(crc32(body));
      chunks.push(body.toString('ascii', 0, 4));
      at += 12 + length;
    }
    expect(chunks[0]).toBe('IHDR');
    expect(chunks[chunks.length - 1]).toBe('IEND');
    expect(chunks).not.toContain('tRNS');
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(2);
  });

  it('LaunchBackground is the page colour of src/tokens.css, light and dark', () => {
    const set = JSON.parse(read(`${APP}/Assets.xcassets/LaunchBackground.colorset/Contents.json`)) as {
      colors: { appearances?: { appearance: string; value: string }[]; color: { 'color-space': string; components: { red: string; green: string; blue: string; alpha: string } } }[];
    };
    expect(set.colors).toHaveLength(2);
    const [any, dark] = set.colors;
    expect(any.appearances).toBeUndefined();
    expect(dark.appearances).toEqual([{ appearance: 'luminosity', value: 'dark' }]);
    for (const c of set.colors) expect(c.color['color-space']).toBe('srgb');
    expect(hexOf(any.color.components)).toBe(LIGHT_BG);
    expect(hexOf(dark.color.components)).toBe(DARK_BG);
    expect(readdirSync(join(ROOT, `${APP}/Assets.xcassets`)).sort()).toEqual(['AppIcon.appiconset', 'Contents.json', 'LaunchBackground.colorset']);
  });

  it('the launch screen is that colour and nothing else', () => {
    const text = read(`${APP}/Base.lproj/LaunchScreen.storyboard`);
    const doc = parseXml(text);
    expect(doc.attrs.launchScreen).toBe('YES');
    const views = findAll(doc, 'view');
    expect(views).toHaveLength(1);
    expect(findAll(views[0], 'color').map((c) => c.attrs)).toEqual([{ key: 'backgroundColor', name: 'LaunchBackground' }]);
    expect(findAll(doc, 'imageView')).toEqual([]);
    expect(text).not.toMatch(/image=|systemColor/);
    const named = findAll(doc, 'namedColor');
    expect(named.map((n) => n.attrs.name)).toEqual(['LaunchBackground']);
    const fallback = findAll(named[0], 'color')[0].attrs;
    const channel = (v: string) => Math.round(Number(v) * 255).toString(16).padStart(2, '0');
    expect(`#${channel(fallback.red)}${channel(fallback.green)}${channel(fallback.blue)}`).toBe(LIGHT_BG);
    expect(existsSync(join(ROOT, `${APP}/Base.lproj/Main.storyboard`))).toBe(false);
  });
});

describe('ios/.gitignore', () => {
  const lines = read('ios/.gitignore').split('\n').map((l) => l.trim());

  it('ignores what npm run native:sync writes, and keeps the pods committed', () => {
    expect(lines).toEqual(expect.arrayContaining(['App/App/public', 'App/App/capacitor.config.json', 'App/App/config.xml', 'xcuserdata', 'DerivedData']));
    expect(lines.filter((l) => /Pods/.test(l))).toEqual([]);
  });
});

describe('the licences the app shows (src/native/licenses/, in its Terms)', () => {
  const lic = (file: string) => read(`src/native/licenses/${file}`);

  it('keeps the font licence, Capacitor’s and Preact’s as their packages have them', () => {
    expect(lic('bricolage-grotesque-OFL.txt')).toBe(read('public/licenses/bricolage-grotesque-OFL.txt'));
    expect(lic('capacitor-mit.txt').startsWith(read('node_modules/@capacitor/ios/LICENSE').trimEnd())).toBe(true);
    expect(lic('preact-mit.txt').startsWith(read('node_modules/preact/LICENSE').trimEnd())).toBe(true);
  });

  it('cover every pod compiled into the app, as CocoaPods acknowledges it, at the version Podfile.lock has', async () => {
    // CocoaPods writes each pod's licence into the acknowledgements; the app shows its own list (the native Terms).
    const ack = read('ios/App/Pods/Target Support Files/Pods-App/Pods-App-acknowledgements.markdown');
    const sections = ack.split(/^## /m).slice(1);
    expect(sections.map((s) => s.slice(0, s.indexOf('\n')))).toEqual(['Capacitor', 'CapacitorCordova']);
    const capacitor = lic('capacitor-mit.txt');
    for (const section of sections) {
      const text = section.slice(section.indexOf('\n')).replace(/Generated by CocoaPods.*$/s, '').trim();
      expect(capacitor.startsWith(text), section.slice(0, 20)).toBe(true);
    }
    // CapacitorCordova carries Apache Cordova code: the note, and the Apache License beside it.
    expect(capacitor).toContain('(CapacitorCordova) includes code from Apache Cordova');
    const version = (JSON.parse(read('node_modules/@capacitor/ios/package.json')) as { version: string }).version;
    expect(read('ios/App/Podfile.lock')).toContain(`  - Capacitor (${version}):`);
    expect(capacitor).toContain(`Capacitor ${version} (@capacitor/ios`);
    const { LICENCES } = await import('../src/native/screens/Legal');
    expect(LICENCES.map((l) => l.file)).toEqual(expect.arrayContaining(['capacitor-mit.txt', 'apache-2.0.txt']));
  });
});

describe('Swift: the native contract', () => {
  const contract = tsInterface('FiteeNative');

  it('FiteeNativePlugin implements every FiteeNative method of src/native/bridge.ts, each a promise', () => {
    expect(PLUGIN).toMatch(/@objc\(FiteeNativePlugin\)\s+public class FiteeNativePlugin: CAPPlugin, CAPBridgedPlugin \{/);
    expect(PLUGIN).toContain('public let identifier = "FiteeNativePlugin"');
    expect(PLUGIN).toContain('public let jsName = "FiteeNative"');
    const declared = [...PLUGIN.matchAll(/CAPPluginMethod\(name: "(\w+)", returnType: (\w+)\)/g)];
    expect(declared.map((m) => m[2])).toEqual(declared.map(() => 'CAPPluginReturnPromise'));
    expect(declared.map((m) => m[1]).sort()).toEqual([...contract.keys()].sort());
    expect([...SWIFT_METHODS.keys()].sort()).toEqual([...contract.keys()].sort());
  });

  it("each method reads the contract's option keys and resolves with its result keys", () => {
    for (const [name, signature] of contract) {
      const body = SWIFT_METHODS.get(name) as string;
      const optionKeys = [...new Set([...body.matchAll(/call\.get\w+\("(\w+)"/g)].map((m) => m[1]))].sort();
      expect(optionKeys, `${name}: option keys`).toEqual(tsOptionKeys(signature));
      const expected = tsResultKeys(signature);
      if (name === 'readSnapshot') {
        expect(expected).toEqual(['current', 'next', 'prev']);
        for (const key of expected ?? []) expect(swiftSource('FiteeFiles.swift')).toContain(`("${key}", ${key})`);
        continue;
      }
      const literals = [...body.matchAll(/(?:return|call\.resolve\()\s*\[([^\]]*)\]/g)].map((m) => m[1]);
      expect(literals.length, `${name}: a result`).toBeGreaterThan(0);
      const keys = [...new Set(literals.flatMap((l) => [...l.matchAll(/"(\w+)":/g)].map((m) => m[1])))].sort();
      expect(keys, `${name}: result keys`).toEqual(expected);
    }
  });

  it('rejects only with the codes of NATIVE_ERROR_CODES, and uses each', () => {
    const swift = SWIFT.map((f) => releaseCode(swiftSource(f))).join('\n');
    const used = new Set([
      ...[...swift.matchAll(/code: "([A-Z_]+)"/g)].map((m) => m[1]),
      ...[...swift.matchAll(/call\.reject\([^\n]*?, "([A-Z_]+)"\)/g)].map((m) => m[1]),
    ]);
    expect([...used].sort()).toEqual([...NATIVE_ERROR_CODES].sort());
  });

  it('FiteeFiles checks the same names as src/native/setFiles.ts', () => {
    const files = swiftSource('FiteeFiles.swift');
    const raw = (name: string) => (new RegExp(`static let ${name} = #"(.*)"#`).exec(files) as RegExpExecArray)[1];
    expect(raw('setFileName')).toBe(SET_FILE_NAME.source);
    expect(raw('setId')).toBe(SET_ID.source);
    expect(raw('exportName')).toBe(EXPORT_NAME.source);
    const exts = (/static let videoExts: \[String\] = \[([^\]]*)\]/.exec(files) as RegExpExecArray)[1];
    expect([...exts.matchAll(/"(\w+)"/g)].map((m) => m[1])).toEqual([...VIDEO_EXTS]);
    expect(Number((/static let chunk = ([\d_]+)/.exec(files) as RegExpExecArray)[1].replace(/_/g, ''))).toBe(CHUNK);
    expect(Number((/static let chunkBase64 = ([\d_]+)/.exec(files) as RegExpExecArray)[1].replace(/_/g, ''))).toBe(4 * Math.ceil(CHUNK / 3));
  });

  it('appInfo answers AppInfo, and turns the idle timer back on', () => {
    expect(SWIFT_METHODS.get('appInfo')).toContain('UIApplication.shared.isIdleTimerDisabled = false');
    expect(PLUGIN).toContain(`static let selfTestArgument = "${SELF_TEST_ARG}"`);
    expect(PLUGIN).toContain(`static let probeURLArgument = "${PROBE_URL_ARG}"`);
  });

  it('going to the background: the scene and the app notifications, the idle timer off, a 5 s background task', () => {
    expect(PLUGIN).toContain('UIScene.didEnterBackgroundNotification');
    expect(PLUGIN).toContain('UIApplication.didEnterBackgroundNotification');
    expect(PLUGIN).toContain('beginBackgroundTask(withName: "fitee: save a copy of your data")');
    expect(PLUGIN).toMatch(/asyncAfter\(deadline: \.now\(\) \+ 5\)/);
  });

  it('exports with Save to Files (never the share sheet); Delete all also clears tmp/ and the web view\'s stores', () => {
    expect(SWIFT_METHODS.get('exportFile')).toContain('UIDocumentPickerViewController(forExporting: [file], asCopy: true)');
    expect(SWIFT_METHODS.get('deleteAllData')).toMatch(/removeData\(ofTypes: WKWebsiteDataStore\.allWebsiteDataTypes\(\), modifiedSince: Date\.distantPast\)/);
    expect(read(`${APP}/FiteeFiles.swift`)).toMatch(/func deleteAll\(\) throws \{[\s\S]*?removeIfPresent\(root\)[\s\S]*?FiteeFiles\.empty\(temporaryFolder, keeping: nil\)/);
    expect(SWIFT_METHODS.get('setAppearance')).toContain('overrideUserInterfaceStyle = style');
  });
});

describe('Swift: the network guards and what Release builds hold', () => {
  it('no network API, no required-reason API, no logging, no share sheet, no refusing stubs (Release code)', () => {
    for (const file of SWIFT) {
      const code = releaseCode(swiftSource(file));
      expect(code, file).not.toMatch(/URLSession|NWConnection|NSURLConnection|URLRequest|http:\/\/|https:\/\//);
      expect(code, file).not.toMatch(/UserDefaults|creationdate|modificationdate|attributesOf|systemUptime|volume\w*Capacity|statv?fs|\b[fl]?stat\(|getattrlist|mach_absolute_time|activeInputModes/i);
      expect(code, file).not.toMatch(/\bprint\(|NSLog|os_log|CAPLog/);
      expect(code, file).not.toMatch(/UIActivityViewController|FiteeRefusedPlugin/);
    }
  });

  it('the content rules block every load but the app\'s own files, blob: and data:', () => {
    const src = swiftSource('FiteeContentRules.swift');
    const json = (/static let json = """\n([\s\S]*?)\n\s*"""/.exec(src) as RegExpExecArray)[1];
    expect(JSON.parse(json)).toEqual([
      { trigger: { 'url-filter': '.*' }, action: { type: 'block' } },
      { trigger: { 'url-filter': '^capacitor://localhost' }, action: { type: 'ignore-previous-rules' } },
      { trigger: { 'url-filter': '^blob:' }, action: { type: 'ignore-previous-rules' } },
      { trigger: { 'url-filter': '^data:' }, action: { type: 'ignore-previous-rules' } },
    ]);
    expect(src).toContain(`"${MARKERS.rules} "`);
  });

  it('the bridge gate replaces Capacitor\'s "bridge" handler and lets through only GATE_ALLOWED and js.error', () => {
    const vc = releaseCode(swiftSource('FiteeViewController.swift'));
    expect(vc).toMatch(/final class FiteeBridgeGate: NSObject, WKScriptMessageHandler \{/);
    const allowed = (/static let allowedPlugins: Set<String> = \[([^\]]*)\]/.exec(vc) as RegExpExecArray)[1];
    expect([...allowed.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort()).toEqual([...GATE_ALLOWED].sort());
    expect(vc).toContain('static let handlerName = "bridge"');
    const install = (/static func install[\s\S]*?\n {4}\}/.exec(vc) as RegExpExecArray)[0];
    expect(install.indexOf('removeScriptMessageHandler(forName: handlerName)')).toBeGreaterThan(0);
    expect(install.indexOf('controller.add(FiteeBridgeGate(forwardingTo: capacitor), name: handlerName)')).toBeGreaterThan(install.indexOf('removeScriptMessageHandler'));
    expect(vc).toContain('if type == "js.error" { return true }');
    expect(vc).toContain('guard type == "message", let pluginId = message["pluginId"] as? String else { return false }');
    expect(vc).toContain('capacitor?.userContentController(userContentController, didReceive: message)');
    const debug = swiftSource('FiteeViewController.swift');
    expect(debug).toContain(`"${MARKERS.dropped} - -.-"`);
    expect(debug).toContain(`"${MARKERS.dropped} \\(type) `);
    expect(debug).toContain(`print("${MARKERS.statusbar} " + text)`);
    for (const text of ['light-text', 'dark-text', 'default']) expect(debug).toContain(`text = "${text}"`);
  });

  it('capacitorDidLoad puts on the rules and the gate, registers FiteeNative, turns AirPlay off', () => {
    const vc = releaseCode(swiftSource('FiteeViewController.swift'));
    expect(vc).toContain('configuration.allowsAirPlayForMediaPlayback = false');
    const didLoad = (/override func capacitorDidLoad\(\) \{[\s\S]*?\n {4}\}/.exec(vc) as RegExpExecArray)[0];
    expect(didLoad).toContain('handler.contentController.add(rules)');
    expect(didLoad).toContain('FiteeContentRules.installed = true');
    expect(didLoad).toContain('FiteeBridgeGate.install(in: handler.contentController, forwardingTo: handler)');
    expect(didLoad).toContain('bridge?.registerPluginInstance(FiteeNativePlugin())');
  });

  it('SceneDelegate empties tmp/ first and makes the bridge only once the rules have compiled', () => {
    const scene = releaseCode(swiftSource('SceneDelegate.swift'));
    const empty = scene.indexOf('FiteeFiles.empty(FileManager.default.temporaryDirectory, keeping: nil)');
    const compile = scene.indexOf('FiteeContentRules.compile {');
    expect(empty).toBeGreaterThan(0);
    expect(compile).toBeGreaterThan(empty);
    expect(scene.indexOf('FiteeViewController()')).toBeGreaterThan(compile);
    expect(scene).not.toMatch(/CAPBridgeViewController\(\)|storyboard/i);
  });
});

describe('npm run native:sync (scripts/native-sync.ts)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'fitee-native-sync-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('writes capacitor.config.json and config.xml as `cap copy ios` does (byte for byte, checked once with the CLI)', () => {
    expect(capacitorConfigJson(config)).toBe(
      [
        '{',
        '\t"appId": "app.fitee",',
        '\t"appName": "fitee",',
        '\t"webDir": "dist-native",',
        '\t"loggingBehavior": "debug",',
        '\t"server": {',
        '\t\t"hostname": "localhost",',
        '\t\t"iosScheme": "capacitor"',
        '\t},',
        '\t"ios": {',
        '\t\t"contentInset": "never",',
        '\t\t"allowsLinkPreview": false',
        '\t},',
        '\t"plugins": {',
        '\t\t"CapacitorHttp": {',
        '\t\t\t"enabled": false',
        '\t\t},',
        '\t\t"CapacitorCookies": {',
        '\t\t\t"enabled": false',
        '\t\t},',
        '\t\t"SystemBars": {',
        '\t\t\t"style": "DEFAULT"',
        '\t\t}',
        '\t},',
        '\t"packageClassList": []',
        '}',
        '',
      ].join('\n'),
    );
    expect(CONFIG_XML).toBe(
      `<?xml version='1.0' encoding='utf-8'?>\n<widget version="1.0.0" xmlns="http://www.w3.org/ns/widgets" xmlns:cdv="http://cordova.apache.org/ns/1.0">\n  <access origin="*" />\n  \n  \n</widget>`,
    );
    const withBuildOptions = { ...config, ios: { ...config.ios, buildOptions: { scheme: 'App' } } };
    expect(JSON.parse(capacitorConfigJson(withBuildOptions)).ios).toEqual(config.ios);
  });

  it('setBundleId writes both lines, quoting a hyphen as Xcode does, and refuses what it can\'t place', () => {
    const changed = setBundleId(PBX_TEXT, 'app.fitee.test');
    expect(bundleIds(changed)).toEqual(['app.fitee.test', 'app.fitee.test']);
    expect(changed.replace(/app\.fitee\.test/g, config.appId)).toBe(PBX_TEXT);
    expect(setBundleId(PBX_TEXT, 'app.fit-ee')).toContain('PRODUCT_BUNDLE_IDENTIFIER = "app.fit-ee";');
    expect(bundleIds(setBundleId(PBX_TEXT, 'app.fit-ee'))).toEqual(['app.fit-ee', 'app.fit-ee']);
    for (const bad of ['fitee', 'app..fitee', 'app.fitee;', 'app.fitee x', '.app']) expect(() => setBundleId(PBX_TEXT, bad)).toThrow(/isn't a bundle ID/);
    const one = PBX_TEXT.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]*;/, 'X;');
    expect(() => setBundleId(one, config.appId)).toThrow(/found 1/);
    expect(() => setBundleId(`${PBX_TEXT}\nPRODUCT_BUNDLE_IDENTIFIER = x.y;`, config.appId)).toThrow(/found 3/);
  });

  it('replaces public/ with the web build, writes the Cordova files and both configs, then the bundle ID', () => {
    const root = join(tmp, 'repo');
    const put = (path: string, text: string) => {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    put('web/index.html', '<!doctype html>');
    put('web/assets/app.js', 'x');
    put('web/plugins/p.js', 'cordova plugin');
    put(`${IOS.public}/stale.txt`, 'from before');
    put(IOS.pbxproj, PBX_TEXT);
    const settings = { ...config, webDir: 'web' };
    expect(nativeSync(root, settings)).toEqual({ webDir: 'web', pbxprojChanged: false });
    const files = (dir: string) => walkFrom(join(root, dir)).sort();
    expect(files(IOS.public)).toEqual(['assets/app.js', 'cordova.js', 'cordova_plugins.js', 'index.html']);
    expect(readFileSync(join(root, IOS.public, 'cordova.js'), 'utf8')).toBe('');
    expect(readFileSync(join(root, IOS.config), 'utf8')).toBe(capacitorConfigJson(settings));
    expect(readFileSync(join(root, IOS.configXml), 'utf8')).toBe(CONFIG_XML);
    expect(readFileSync(join(root, IOS.pbxproj), 'utf8')).toBe(PBX_TEXT);

    // A new bundle ID is written once; running again changes nothing.
    expect(nativeSync(root, { ...settings, appId: 'app.fitee.other' }).pbxprojChanged).toBe(true);
    expect(bundleIds(readFileSync(join(root, IOS.pbxproj), 'utf8'))).toEqual(['app.fitee.other', 'app.fitee.other']);
    expect(nativeSync(root, { ...settings, appId: 'app.fitee.other' }).pbxprojChanged).toBe(false);

    // Without a web build it stops before touching public/; a webDir outside the repo is refused.
    rmSync(join(root, 'web/index.html'));
    expect(() => nativeSync(root, settings)).toThrow(/index\.html is missing: run npm run build:native first/);
    expect(files(IOS.public)).toContain('assets/app.js');
    expect(() => nativeSync(root, { ...settings, webDir: '..' })).toThrow(/inside the repo/);
    expect(() => nativeSync(root, { ...settings, webDir: '.' })).toThrow(/inside the repo/);
  });
});

/** Every file under an absolute folder, relative to it. */
function walkFrom(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walkFrom(full).map((f) => `${name}/${f}`) : [relative(dir, full)];
  });
}
