// The native build's module swaps (NATIVE_SWAPS in scripts/native-build.ts): each replacement exports what the
// original's importers use, with types they accept (checked by tsc -p tests) and names that are there at run time.
// And the app's own Legal module: its terms version, its date and its licence texts.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NATIVE_SWAPS } from '../scripts/native-build';
import { NATIVE_TERMS_VERSION } from '../src/profile';
import type * as Db from '../src/db';
import type * as Legal from '../src/screens/Legal';
import type * as Download from '../src/ui/download';
import type * as NativeDb from '../src/native/setsDb';
import type * as NativeLegal from '../src/native/screens/Legal';
import type * as NativeDownload from '../src/native/download';

// Compile time: tsc fails here if a replacement stops fitting what its importers use.
type Fits<Want, Got extends Want> = Got;
export type SwapTypes = [
  Fits<Pick<typeof Db, 'dbGet' | 'dbSet' | 'dbDelete'>, typeof NativeDb>,
  Fits<typeof Legal, typeof NativeLegal>,
  Fits<typeof Download, typeof NativeDownload>,
];

const ROOT = join(__dirname, '..');

describe('the native swaps', () => {
  it('are the three this test knows, and every file exists', () => {
    expect(NATIVE_SWAPS.map((s) => [s.from, s.to, s.importer])).toEqual([
      ['src/db.ts', 'src/native/setsDb.ts', 'src/sets/sets.ts'],
      ['src/screens/Legal.tsx', 'src/native/screens/Legal.tsx', undefined],
      ['src/ui/download.ts', 'src/native/download.ts', undefined],
    ]);
    for (const s of NATIVE_SWAPS) for (const f of [s.from, s.to, s.importer]) if (f) expect(existsSync(join(ROOT, f)), f).toBe(true);
  });

  it('export at run time every name the original exports (db.ts: the three sets.ts uses)', async () => {
    const pairs: [Record<string, unknown>, Record<string, unknown>, string[]?][] = [
      [await import('../src/db'), await import('../src/native/setsDb'), ['dbGet', 'dbSet', 'dbDelete']],
      [await import('../src/screens/Legal'), await import('../src/native/screens/Legal')],
      [await import('../src/ui/download'), await import('../src/native/download')],
    ];
    for (const [original, replacement, names = Object.keys(original)] of pairs) {
      for (const name of names) expect(typeof replacement[name], name).toBe(typeof original[name]);
    }
  });

  it('src/sets/sets.ts imports nothing from src/db.ts but the three', () => {
    const source = readFileSync(join(ROOT, 'src', 'sets', 'sets.ts'), 'utf8');
    const imported = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/db'/g)].flatMap((m) => m[1].split(',').map((n) => n.trim()).filter(Boolean));
    expect(imported.sort()).toEqual(['dbDelete', 'dbGet', 'dbSet']);
  });
});

describe('the app’s own Terms and Privacy policy', () => {
  it('dates its texts with its terms version', async () => {
    const { NATIVE_UPDATED } = await import('../src/native/screens/Legal');
    const [, y, m, d] = /^ios-(\d{4})-(\d{2})-(\d{2})$/.exec(NATIVE_TERMS_VERSION) ?? [];
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    expect(date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })).toBe(NATIVE_UPDATED);
  });

  it('lists every licence file once, and each file is there', async () => {
    const { LICENCES } = await import('../src/native/screens/Legal');
    const dir = join(ROOT, 'src', 'native', 'licenses');
    expect(LICENCES.map((l) => l.file).sort()).toEqual(readdirSync(dir).sort());
    for (const l of LICENCES) expect(readFileSync(join(dir, l.file), 'utf8').length, l.file).toBeGreaterThan(100);
  });

  it('keeps the font licence, Capacitor’s and Preact’s as their packages have them', () => {
    const lic = (f: string) => readFileSync(join(ROOT, 'src', 'native', 'licenses', f), 'utf8');
    expect(lic('bricolage-grotesque-OFL.txt')).toBe(readFileSync(join(ROOT, 'public', 'licenses', 'bricolage-grotesque-OFL.txt'), 'utf8'));
    expect(lic('capacitor-mit.txt').startsWith(readFileSync(join(ROOT, 'node_modules', '@capacitor', 'ios', 'LICENSE'), 'utf8').trimEnd())).toBe(true);
    expect(lic('preact-mit.txt').startsWith(readFileSync(join(ROOT, 'node_modules', 'preact', 'LICENSE'), 'utf8').trimEnd())).toBe(true);
  });

  it('says where each runtime library’s text came from', () => {
    const lic = (f: string) => readFileSync(join(ROOT, 'src', 'native', 'licenses', f), 'utf8');
    for (const f of readdirSync(join(ROOT, 'src', 'native', 'licenses')).filter((f) => !['bricolage-grotesque-OFL.txt'].includes(f))) {
      expect(lic(f), f).toMatch(/npm package|https:\/\//);
    }
    const runtime = lic('wasm-runtime-apache-2.0.txt');
    for (const name of ['TensorFlow Lite', 'LiteRT', 'Abseil', 'OpenCV', 'ruy', 'gemmlowp', 'FlatBuffers', 'OR-Tools', 'TCMalloc']) expect(runtime, name).toContain(name);
  });
});
