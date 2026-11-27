// The build-time flag __NATIVE__ (vite.config.ts) keeps the web build byte for byte as it was (scripts/native-build.ts):
// where it may appear and in what forms, that the landing page's, the service worker's and the screenshot seed's
// modules never see it, that native code is reached only through import() or the native build's swaps, and two
// in-memory builds: the web one has no native code, the native one does.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import preact from '@preact/preset-vite';
import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';
import { nativeHtml, nativeSwaps, webHasNoNativeCode } from '../scripts/native-build';

const ROOT = join(__dirname, '..');
const rel = (f: string) => relative(ROOT, f).split(sep).join('/');
const SKIP = new Set(['node_modules', '.git', '.claude', 'dist', 'dist-native', 'ios', 'site']);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(tsx?|mjs|cjs|js)$/.test(name) ? [full] : [];
  });

/** Code without its comments (block and line), so only what's compiled counts. */
const code = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');

/**
 * What the builds compile or load: src/, the root configs and the native build's script (vite.config.ts imports it).
 * Tests and dev tools aren't built (tools/landing-screens/seed.ts is checked through its import graph below).
 */
const BUILT = [...walk(join(ROOT, 'src')), join(ROOT, 'vite.config.ts'), join(ROOT, 'capacitor.config.ts'), join(ROOT, 'scripts', 'native-build.ts')];
const NATIVE_DIR = `src/native/`;

/** The files the two builds share that use __NATIVE__ (src/native/ aside). Adding one is a choice: list it here. */
const SHARED_WITH_FLAG = [
  'src/analysis/feedback.ts',
  'src/analysis/usePoseCamera.ts',
  'src/app.tsx',
  'src/offline/client.ts',
  'src/screens/Analyze.tsx',
  'src/screens/ProgramView.tsx',
  'src/screens/Results.tsx',
  'src/screens/SetScreen.tsx',
  'src/screens/SettingsScreen.tsx',
];

const FLAG = /\b__NATIVE__\b/g;

/** Whether the occurrence of __NATIVE__ at `i` is in one of the forms the web build folds to the original code. */
function allowedForm(src: string, i: number): boolean {
  const before = src.slice(Math.max(0, i - 40), i);
  const after = src.slice(i + '__NATIVE__'.length, i + '__NATIVE__'.length + 40);
  return (
    (/\bif\s*\(\s*$/.test(before) && /^\s*\)/.test(after)) || // if (__NATIVE__) …
    /^\s*\?/.test(after) || // __NATIVE__ ? <native> : <original>
    (/!\s*$/.test(before) && /^\s*&&/.test(after)) || // !__NATIVE__ && …
    /^\s*\|\|/.test(after) // __NATIVE__ || …
  );
}

describe('where __NATIVE__ appears', () => {
  const users = BUILT.filter((f) => FLAG.test(code(f))).map(rel);

  it('only in vite.config.ts, src/env.d.ts, src/native/ and the shared files that need it', () => {
    // scripts/native-build.ts only names it in its error message for the web build's guard.
    expect(users.filter((f) => !f.startsWith(NATIVE_DIR)).sort()).toEqual(['scripts/native-build.ts', 'src/env.d.ts', ...SHARED_WITH_FLAG, 'vite.config.ts'].sort());
    expect(code(join(ROOT, 'scripts', 'native-build.ts')).match(FLAG)).toHaveLength(1);
  });

  it('in shared files, only in forms that fold back to the original code', () => {
    const wrong = SHARED_WITH_FLAG.flatMap((f) => {
      const src = code(join(ROOT, f));
      return [...src.matchAll(FLAG)].filter((m) => !allowedForm(src, m.index)).map((m) => `${f}: …${src.slice(m.index - 30, m.index + 40).replace(/\s+/g, ' ')}…`);
    });
    expect(wrong).toEqual([]);
  });

  it('the form check catches what it should', () => {
    const ok = ['if (__NATIVE__) { x(); }', 'a = __NATIVE__ ? b : c;', '{!__NATIVE__ && <El />}', 'saved: __NATIVE__ || y,', 'if (__NATIVE__) void f();', 'x = (__NATIVE__\n  ? a\n  : b)'];
    const bad = ['const n = __NATIVE__;', 'if (__NATIVE__ && x) {}', 'f(__NATIVE__)', 'if (!__NATIVE__) return;', '__NATIVE__ && f()'];
    for (const s of ok) expect(allowedForm(s, s.indexOf('__NATIVE__')), s).toBe(true);
    for (const s of bad) expect(allowedForm(s, s.indexOf('__NATIVE__')), s).toBe(false);
  });
});

// ---- import graphs -------------------------------------------------------------------------------------------------

const SPECIFIERS = /(?:import|export)\s+(?:type\s+)?[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** The specifiers a file imports: static ones and import() with a plain string, `import type` left out (erased). */
function imports(file: string): { spec: string; dynamic: boolean }[] {
  const src = code(file);
  return [...src.matchAll(SPECIFIERS)]
    .filter((m) => !/^(?:import|export)\s+type\s/.test(m[0]))
    .map((m) => ({ spec: (m[1] ?? m[2] ?? m[3]).split('?')[0], dynamic: m[3] !== undefined }));
}

/** A relative specifier as a file, or undefined (a package, or nothing there). */
function resolveSpec(from: string, spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const base = resolve(dirname(from), spec);
  return [base, ...['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'].map((e) => base + e)].find((f) => existsSync(f) && statSync(f).isFile());
}

/** Every module a file reaches through relative imports, static and dynamic. */
function graph(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [join(ROOT, entry)];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(tsx?|mjs|js)$/.test(file)) continue;
    for (const { spec } of imports(file)) {
      const next = resolveSpec(file, spec);
      if (next) todo.push(next);
    }
  }
  return new Set([...seen].map(rel));
}

describe('import graphs', () => {
  it('the landing page, the service worker and the screenshot seed never load a module with __NATIVE__', () => {
    const users = BUILT.filter((f) => FLAG.test(code(f))).map(rel);
    for (const entry of ['src/landing/main.ts', 'src/landing/prerender.ts', 'src/offline/sw.ts', 'tools/landing-screens/seed.ts']) {
      const reached = graph(entry);
      expect(reached.size, entry).toBeGreaterThanOrEqual(3);
      expect(users.filter((f) => reached.has(f)), entry).toEqual([]);
    }
    // The walker does follow imports: the landing page's build reaches the profile, which can't hold the flag.
    expect(graph('src/landing/prerender.ts').has('src/profile.ts')).toBe(true);
  });

  it('nothing in src/ imports @capacitor/', () => {
    const found = walk(join(ROOT, 'src')).flatMap((f) => imports(f).filter((i) => i.spec.startsWith('@capacitor/')).map((i) => `${rel(f)}: ${i.spec}`));
    expect(found).toEqual([]);
  });

  it('shared code reaches src/native/ only through import()', () => {
    const found = walk(join(ROOT, 'src'))
      .filter((f) => !rel(f).startsWith(NATIVE_DIR))
      .flatMap((f) =>
        imports(f)
          .filter((i) => !i.dynamic && resolveSpec(f, i.spec)?.startsWith(join(ROOT, 'src', 'native') + sep))
          .map((i) => `${rel(f)}: ${i.spec}`),
      );
    expect(found).toEqual([]);
  });
});

// ---- the builds ----------------------------------------------------------------------------------------------------

type Output = Rolldown.RolldownOutput['output'];

async function bundle(native: boolean): Promise<Output> {
  const result = await build({
    configFile: false,
    root: ROOT,
    base: './',
    publicDir: false,
    logLevel: 'silent',
    define: { __NATIVE__: JSON.stringify(native) },
    plugins: native ? [preact(), nativeSwaps(), nativeHtml()] : [preact(), webHasNoNativeCode()],
    build: { write: false, target: 'es2022', rolldownOptions: { input: join(ROOT, 'index.html') } },
  });
  return (Array.isArray(result) ? result[0] : (result as Rolldown.RolldownOutput)).output;
}

const text = (o: Output[number]) => (o.type === 'chunk' ? o.code : typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8'));

describe('the builds', () => {
  it('the web build has no native code, the native build does', { timeout: 120_000 }, async () => {
    const web = await bundle(false);
    const nativeModules = web.flatMap((o) => (o.type === 'chunk' ? o.moduleIds.filter((id) => rel(id.replace(/^\0/, '').split('?')[0]).startsWith(NATIVE_DIR)) : []));
    expect(nativeModules).toEqual([]);
    for (const marker of ['FiteeNative', 'fitee:ready', 'fitee:selftest', 'deleteAllData', '_capacitor_file_', 'ios-20', 'status-strip']) {
      expect(web.filter((o) => text(o).includes(marker)).map((o) => o.fileName), marker).toEqual([]);
    }
    const entryOf = (out: Output) => out.find((o): o is Rolldown.OutputChunk => o.type === 'chunk' && o.isEntry);
    const has = (chunk: Rolldown.OutputChunk | undefined, path: string) => !!chunk?.moduleIds.some((id) => id.split('?')[0] === join(ROOT, path));
    expect(has(entryOf(web), 'src/main.tsx')).toBe(true);

    const native = await bundle(true);
    expect(native.some((o) => text(o).includes('FiteeNative'))).toBe(true);
    expect(native.some((o) => text(o).includes('status-strip'))).toBe(true);
    const entry = entryOf(native);
    expect(has(entry, 'src/native/entry.ts')).toBe(true);
    expect(has(entry, 'src/main.tsx')).toBe(false); // the entry imports the app with import() once the copy is back
    const html = text(native.find((o) => o.fileName === 'index.html')!);
    expect(html).toContain(`src="./${entry!.fileName}"`);
    expect(html).toContain("worker-src 'none'");
  });
});
