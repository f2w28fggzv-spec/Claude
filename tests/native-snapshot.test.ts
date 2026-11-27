// The iPhone app's durable copy of the log (src/native/snapshot.ts): the pure rules, the launch's restore against
// the fake native side, and the copy writer with fake timers and a fake Storage.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportAll, importAll } from '../src/log/store';
import {
  buildCopy,
  COPY_FAILED_TOAST,
  decideStart,
  DEBOUNCE_MS,
  flushNow,
  isUserKey,
  localRevOf,
  MAX_WAIT_MS,
  NEWER_TOAST,
  parseCopy,
  pauseWriter,
  pickCopy,
  restoreBeforeStart,
  RESTORED_TOAST,
  resumeWriter,
  REV_KEY,
  startWriter,
  type Copy,
  type StartResult,
} from '../src/native/snapshot';
import { DELETED_HASH, openData } from '../src/native/data';
import { FakeNative } from './fixtures/fakeNative';

/** A Storage-like class: the writer wraps its prototype as it wraps Storage.prototype in the app. */
class FakeStorage {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  keys() {
    return [...this.map.keys()];
  }
}
const asStorage = (s: FakeStorage) => s as unknown as Storage;

const filled = (entries: Record<string, unknown>, raw: Record<string, string> = {}) => {
  const s = new FakeStorage();
  for (const [k, v] of Object.entries(entries)) s.setItem(k, JSON.stringify(v));
  for (const [k, v] of Object.entries(raw)) s.setItem(k, v);
  return s;
};
const copyText = (data: Record<string, unknown>, rev: number, extra: object = {}) => JSON.stringify({ app: 'fitee', version: 1, exportedAt: '2026-11-27T10:00:00.000Z', data, rev, ...extra });
const NOW = new Date('2026-11-27T10:00:00Z');

describe('which keys the copy holds', () => {
  const mem = new FakeStorage();
  beforeEach(() => vi.stubGlobal('localStorage', mem));
  afterEach(() => {
    mem.clear();
    vi.unstubAllGlobals();
  });

  it('isUserKey selects exactly what exportAll() backs up', () => {
    for (const [k, v] of Object.entries({
      'formcheck.v1.unit': '"kg"',
      'formcheck.v1.workouts': '[]',
      'formcheck.v1.profile': '{"name":"A"}',
      'formcheck.v1.device.snapshotRev': '4',
      'formcheck.v1.device.saveAfterUpdate': '1',
      'other.app': '"x"',
      'formcheck.v2.thing': '1',
    }))
      mem.setItem(k, v);
    const exported = Object.keys((exportAll() as { data: object }).data).sort();
    expect(mem.keys().filter(isUserKey).sort()).toEqual(exported);
    expect(exported).toEqual(['formcheck.v1.profile', 'formcheck.v1.unit', 'formcheck.v1.workouts']);
  });

  it('buildCopy round-trips through parseCopy and importAll, skips a value that isn’t JSON and never copies device keys', () => {
    const src = filled({ 'formcheck.v1.unit': 'lb', 'formcheck.v1.workouts': [{ id: 'w1' }], 'formcheck.v1.device.snapshotRev': 3 }, { 'formcheck.v1.broken': '{nope' });
    const copy = buildCopy(asStorage(src), 7, NOW);
    expect(copy).toEqual({ app: 'fitee', version: 1, exportedAt: NOW.toISOString(), rev: 7, data: { 'formcheck.v1.unit': 'lb', 'formcheck.v1.workouts': [{ id: 'w1' }] } });
    const parsed = parseCopy(JSON.stringify(copy));
    expect(parsed).toEqual({ ok: true, copy });
    expect(importAll(copy)).toBe(2);
    expect(mem.getItem('formcheck.v1.unit')).toBe('"lb"');
    expect(JSON.parse(mem.getItem('formcheck.v1.workouts') ?? '')).toEqual([{ id: 'w1' }]);
    expect(mem.getItem('formcheck.v1.device.snapshotRev')).toBeNull();
  });
});

describe('parseCopy and pickCopy', () => {
  it('rejects what isn’t a valid copy, and flags a newer format', () => {
    expect(parseCopy(copyText({ 'formcheck.v1.unit': 'kg' }, 3)).ok).toBe(true);
    for (const bad of [
      '',
      '{nope',
      'null',
      '[]',
      copyText({}, 3, { app: 'form-check' }),
      copyText({ 'formcheck.v1.device.snapshotRev': 3 }, 3),
      copyText({ 'other.key': 1 }, 3),
      copyText({}, 0),
      copyText({}, 1.5),
      copyText({}, 3, { rev: '3' }),
      copyText({}, 3, { version: 0 }),
      copyText({}, 3, { data: [] }),
    ])
      expect(parseCopy(bad), bad).toEqual({ ok: false, newer: false });
    expect(parseCopy(copyText({}, 3, { version: 2 }))).toEqual({ ok: false, newer: true });
    expect(parseCopy(JSON.stringify({ app: 'fitee', version: 2 }))).toEqual({ ok: false, newer: true });
  });

  it('takes the valid copy with the highest rev, and flags an invalid current', () => {
    const c = (rev: number) => copyText({ 'formcheck.v1.unit': `r${rev}` }, rev);
    expect(pickCopy({ current: c(5), prev: c(4) }).copy?.rev).toBe(5);
    expect(pickCopy({ current: c(5), next: c(6), prev: c(4) }).copy?.rev).toBe(6);
    expect(pickCopy({ current: '{broken', prev: c(4) })).toMatchObject({ copy: { rev: 4 }, currentInvalid: true, newer: false });
    expect(pickCopy({ current: '', next: c(2) })).toMatchObject({ copy: { rev: 2 }, currentInvalid: true });
    expect(pickCopy({ prev: '{broken' })).toEqual({ copy: undefined, currentInvalid: false, newer: false });
    expect(pickCopy({ current: copyText({}, 9, { version: 2 }), prev: c(4) })).toMatchObject({ copy: { rev: 4 }, currentInvalid: false, newer: true });
    expect(pickCopy({})).toEqual({ copy: undefined, currentInvalid: false, newer: false });
  });
});

describe('decideStart', () => {
  const copy = (rev: number): Copy => ({ app: 'fitee', version: 1, exportedAt: '', data: {}, rev });
  const d = (hasUserKeys: boolean, localRev: number, c?: Copy, newer = false, sameData = false) => decideStart({ hasUserKeys, localRev, copy: c, newer, sameData });
  it('follows the table', () => {
    expect(d(true, 3, copy(5), true)).toEqual({ action: 'hold', writeNow: false });
    expect(d(false, 0, undefined, true)).toEqual({ action: 'hold', writeNow: false });
    expect(d(false, 0)).toEqual({ action: 'fresh', writeNow: false });
    expect(d(false, 0, copy(4))).toEqual({ action: 'restore', writeNow: false });
    expect(d(true, 0)).toEqual({ action: 'keep', writeNow: true });
    expect(d(true, 5, copy(4))).toEqual({ action: 'keep', writeNow: true });
    expect(d(true, 4, copy(4), false, true)).toEqual({ action: 'keep', writeNow: false });
    expect(d(true, 4, copy(5))).toEqual({ action: 'replace', writeNow: false });
  });
  it('writes again when the revs are equal but the data differs (changes made before a write started)', () => {
    expect(d(true, 4, copy(4), false, false)).toEqual({ action: 'keep', writeNow: true });
  });
});

describe('restoreBeforeStart', () => {
  const unit = (u: string) => ({ 'formcheck.v1.unit': u });

  it('restores an empty localStorage from the copy, with its rev and a toast', async () => {
    const fake = new FakeNative();
    fake.snapshot = { current: copyText({ ...unit('lb'), 'formcheck.v1.profile': { termsVersion: 'ios-x' } }, 6) };
    const s = new FakeStorage();
    const r = await restoreBeforeStart(fake, asStorage(s), NOW);
    expect(r).toEqual({ action: 'restore', copyRev: 6, writeNow: false, toast: RESTORED_TOAST });
    expect(s.getItem('formcheck.v1.unit')).toBe('"lb"');
    expect(JSON.parse(s.getItem('formcheck.v1.profile') ?? '')).toEqual({ termsVersion: 'ios-x' });
    expect(localRevOf(asStorage(s))).toBe(6);
  });

  it('replaces a localStorage older than its copy, removing keys the copy doesn’t have', async () => {
    const fake = new FakeNative();
    fake.snapshot = { current: copyText(unit('lb'), 5) };
    const s = filled({ ...unit('kg'), 'formcheck.v1.activeWorkout': { id: 'w' }, [REV_KEY]: 3 });
    const r = await restoreBeforeStart(fake, asStorage(s), NOW);
    expect(r).toMatchObject({ action: 'replace', copyRev: 5, writeNow: false });
    expect(r.toast).toBeUndefined();
    expect(s.getItem('formcheck.v1.unit')).toBe('"lb"');
    expect(s.getItem('formcheck.v1.activeWorkout')).toBeNull();
    expect(localRevOf(asStorage(s))).toBe(5);
  });

  it('keeps a newer localStorage, and asks for a write only when the copy is behind', async () => {
    const fake = new FakeNative();
    fake.snapshot = { current: copyText(unit('kg'), 2) };
    const newer = filled({ ...unit('kg'), [REV_KEY]: 3 });
    expect(await restoreBeforeStart(fake, asStorage(newer), NOW)).toEqual({ action: 'keep', copyRev: 2, writeNow: true, toast: undefined });
    const same = filled({ ...unit('kg'), [REV_KEY]: 2 });
    expect(await restoreBeforeStart(fake, asStorage(same), NOW)).toMatchObject({ action: 'keep', writeNow: false });
    const changed = filled({ ...unit('lb'), [REV_KEY]: 2 });
    expect(await restoreBeforeStart(fake, asStorage(changed), NOW)).toMatchObject({ action: 'keep', writeNow: true });
    expect(changed.getItem('formcheck.v1.unit')).toBe('"lb"');
  });

  it('holds when a copy is in a newer format: nothing changes, nothing is dropped, and it says to update', async () => {
    const fake = new FakeNative();
    fake.snapshot = { current: copyText(unit('lb'), 9, { version: 2 }) };
    const s = new FakeStorage();
    expect(await restoreBeforeStart(fake, asStorage(s), NOW)).toEqual({ action: 'hold', copyRev: 0, writeNow: false, toast: NEWER_TOAST });
    expect(s.length).toBe(0);
    expect(fake.callsTo('dropSnapshot')).toHaveLength(0);
  });

  it('drops an invalid current copy before anything else, and restores from snapshot.prev.json', async () => {
    const fake = new FakeNative();
    fake.snapshot = { current: '{broken', prev: copyText(unit('lb'), 4) };
    const s = new FakeStorage();
    expect(await restoreBeforeStart(fake, asStorage(s), NOW)).toMatchObject({ action: 'restore', copyRev: 4 });
    expect(fake.calls.map((c) => c.method)).toEqual(['readSnapshot', 'dropSnapshot']);
    expect(fake.snapshot.current).toBeUndefined();
    expect(s.getItem('formcheck.v1.unit')).toBe('"lb"');
  });

  it('starts fresh with no copy and no data', async () => {
    expect(await restoreBeforeStart(new FakeNative(), asStorage(new FakeStorage()), NOW)).toEqual({ action: 'fresh', copyRev: 0, writeNow: false, toast: undefined });
  });

  it('lets a failed read reject (the app then doesn’t start)', async () => {
    const fake = new FakeNative();
    fake.failNext('readSnapshot', 'IO_ERROR');
    await expect(restoreBeforeStart(fake, asStorage(new FakeStorage()), NOW)).rejects.toMatchObject({ code: 'IO_ERROR' });
  });
});

describe('a Delete all my data the app didn’t finish', () => {
  // FiteeFiles.deleteAll() ran (the marker written, fitee/ and tmp/ removed), then the app or its web process stopped
  // before WKWebsiteDataStore.removeData had deleted localStorage: the next launch finds the user's keys and no copy.
  const stopped = () => {
    const fake = new FakeNative();
    fake.deleting = true;
    const s = filled({ 'formcheck.v1.unit': 'lb', 'formcheck.v1.workouts': [{ id: 'w1' }], 'formcheck.v1.profile': { name: 'A' }, [REV_KEY]: 7 });
    const page = { location: { reload: vi.fn() }, history: { replaceState: vi.fn() } };
    return { fake, s, page };
  };
  /** src/native/entry.ts's launch: appInfo, openData, then the copy writer if the app starts; 10 s go by. */
  const launch = async ({ fake, s, page }: ReturnType<typeof stopped>) => {
    vi.useFakeTimers();
    try {
      const restored = await openData(fake, await fake.appInfo(), asStorage(s), page);
      const stop = restored
        ? startWriter(fake, restored, { storage: asStorage(s), proto: FakeStorage.prototype as unknown as Storage, events: new EventTarget(), doc: Object.assign(new EventTarget(), { hidden: false }), toast: () => undefined })
        : () => undefined;
      vi.advanceTimersByTime(MAX_WAIT_MS);
      stop();
      return restored;
    } finally {
      vi.useRealTimers();
    }
  };

  it('the next launch finishes it and reloads to Welcome: no copy brings the deleted data back', async () => {
    const run = stopped();
    expect(await launch(run)).toBeUndefined();
    expect(run.fake.callsTo('deleteAllData')).toHaveLength(1);
    expect(run.fake.calls.map((c) => c.method)).toEqual(['appInfo', 'deleteAllData']); // the copy isn't even read
    expect(run.fake.callsTo('writeSnapshot')).toEqual([]);
    expect(run.fake.currentCopy()).toBeUndefined();
    expect(run.fake.deleting).toBe(false);
    expect(run.s.keys().filter((k) => k.startsWith('formcheck.v1.'))).toEqual([]);
    expect(run.page.history.replaceState).toHaveBeenCalledWith(null, '', DELETED_HASH);
    expect(run.page.location.reload).toHaveBeenCalledTimes(1);
  });

  it('if it fails again it rejects (the start-error screen), and the marker stays for the launch after', async () => {
    const run = stopped();
    run.fake.failNext('deleteAllData', 'IO_ERROR');
    await expect(launch(run)).rejects.toMatchObject({ code: 'IO_ERROR' });
    expect(run.fake.deleting).toBe(true);
    expect(run.fake.callsTo('writeSnapshot')).toEqual([]);
    expect(run.page.location.reload).not.toHaveBeenCalled();
  });

  it('without one, the launch puts the copy back as before', async () => {
    const run = stopped();
    run.fake.deleting = false;
    run.fake.snapshot = { current: copyText({ 'formcheck.v1.unit': 'kg' }, 9) };
    expect(await launch(run)).toMatchObject({ action: 'replace', copyRev: 9 });
    expect(run.fake.callsTo('deleteAllData')).toEqual([]);
    expect(run.s.getItem('formcheck.v1.unit')).toBe('"kg"');
    expect(run.page.location.reload).not.toHaveBeenCalled();
  });

  it('the fake keeps the marker only while deleteAllData runs, as FiteeFiles does', async () => {
    const fake = new FakeNative({ onDeleteAll: async () => expect((await fake.appInfo()).deleting).toBe(true) });
    expect((await fake.appInfo()).deleting).toBe(false);
    await fake.deleteAllData();
    expect((await fake.appInfo()).deleting).toBe(false);
  });
});

describe('the copy writer', () => {
  let stop: () => void = () => undefined;
  let local: FakeStorage;
  let session: FakeStorage;
  let fake: FakeNative;
  let toasts: string[];
  let events: EventTarget;
  let doc: EventTarget & { hidden: boolean };
  const proto = FakeStorage.prototype as unknown as Storage;
  const keep: StartResult = { action: 'keep', copyRev: 0, writeNow: false };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    local = new FakeStorage();
    session = new FakeStorage();
    fake = new FakeNative();
    toasts = [];
    events = new EventTarget();
    doc = Object.assign(new EventTarget(), { hidden: false });
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });
  const start = (result: StartResult = keep) => {
    stop = startWriter(fake, result, { storage: asStorage(local), proto, events, doc, toast: (m) => toasts.push(m) });
  };
  const writes = () => fake.callsTo('writeSnapshot');
  const revs = () => writes().map((c) => (c.args as { rev: number }).rev);

  it('writes 1.5 s after the last change', () => {
    start();
    local.setItem('formcheck.v1.unit', '"kg"');
    vi.advanceTimersByTime(DEBOUNCE_MS - 100);
    local.setItem('formcheck.v1.unit', '"lb"');
    vi.advanceTimersByTime(DEBOUNCE_MS - 100);
    expect(writes()).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(writes()).toHaveLength(1);
    expect(fake.currentCopy()?.data['formcheck.v1.unit']).toBe('lb');
  });

  it('writes no later than 10 s after the first change, however often things change', () => {
    start();
    for (let t = 0; t < MAX_WAIT_MS; t += 1000) {
      local.setItem('formcheck.v1.workouts', JSON.stringify([t]));
      vi.advanceTimersByTime(1000);
    }
    expect(writes()).toHaveLength(1);
  });

  it('writes at once when the page is hidden or goes', async () => {
    start();
    local.setItem('formcheck.v1.unit', '"kg"');
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(writes()).toHaveLength(1);
    doc.dispatchEvent(new Event('visibilitychange')); // nothing waiting
    expect(writes()).toHaveLength(1);
    local.setItem('formcheck.v1.unit', '"lb"');
    events.dispatchEvent(new Event('pagehide'));
    expect(writes()).toHaveLength(2);
    vi.advanceTimersByTime(MAX_WAIT_MS);
    expect(writes()).toHaveLength(2);
  });

  it('sets REV_KEY before it writes, and revs only grow', async () => {
    local.setItem(REV_KEY, '7');
    start();
    for (const u of ['kg', 'lb', 'kg']) {
      local.setItem('formcheck.v1.unit', JSON.stringify(u));
      const before = writes().length;
      flushNow();
      expect(writes()).toHaveLength(before + 1);
      // The write was sent after the rev was stored: the copy's rev is localStorage's.
      expect(localRevOf(asStorage(local))).toBe(fake.currentCopy()?.rev);
    }
    expect(revs()).toEqual([8, 9, 10]);
  });

  it('writes nothing while there are no user keys, and nothing for sessionStorage or device keys', () => {
    start();
    local.setItem('formcheck.v1.device.saveAfterUpdate', '1');
    session.setItem('formcheck.v1.unit', '"kg"');
    local.setItem('other.key', '1');
    vi.advanceTimersByTime(MAX_WAIT_MS * 2);
    expect(writes()).toHaveLength(0);
    local.setItem('formcheck.v1.unit', '"kg"');
    local.removeItem('formcheck.v1.unit');
    vi.advanceTimersByTime(MAX_WAIT_MS);
    expect(writes()).toHaveLength(0); // the storage had no user keys left
    local.setItem('formcheck.v1.unit', '"kg"');
    local.clear();
    vi.advanceTimersByTime(MAX_WAIT_MS);
    expect(writes()).toHaveLength(0);
  });

  it('writes at start when asked (writeNow), and never with a newer copy (hold)', () => {
    local.setItem('formcheck.v1.unit', '"kg"');
    start({ ...keep, writeNow: true });
    expect(writes()).toHaveLength(1);
    stop();
    start({ action: 'hold', copyRev: 0, writeNow: false });
    local.setItem('formcheck.v1.unit', '"lb"');
    flushNow();
    vi.advanceTimersByTime(MAX_WAIT_MS);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(writes()).toHaveLength(1);
  });

  it('pausing drops a waiting write and any change made meanwhile', () => {
    start();
    local.setItem('formcheck.v1.unit', '"kg"');
    pauseWriter();
    local.setItem('formcheck.v1.unit', '"lb"');
    vi.advanceTimersByTime(MAX_WAIT_MS);
    flushNow();
    events.dispatchEvent(new Event('pagehide'));
    expect(writes()).toHaveLength(0);
    resumeWriter();
    local.setItem('formcheck.v1.unit', '"kg"');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(writes()).toHaveLength(1);
  });

  it('carries on after a failed write, with one toast for the session', async () => {
    start();
    for (let i = 0; i < 3; i++) {
      fake.failNext('writeSnapshot', 'NO_ROOM');
      local.setItem('formcheck.v1.unit', JSON.stringify(`u${i}`));
      flushNow();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(toasts).toEqual([COPY_FAILED_TOAST]);
    // A failed write leaves the change waiting: the next flush tries again.
    flushNow();
    expect(writes()).toHaveLength(4);
    expect(fake.currentCopy()?.data['formcheck.v1.unit']).toBe('u2');
  });

  it('puts Storage.prototype back when stopped', () => {
    const before = proto.setItem;
    start();
    expect(proto.setItem).not.toBe(before);
    stop();
    expect(proto.setItem).toBe(before);
  });
});

describe('localStorage is only written through setItem, removeItem and clear', () => {
  const ROOT = join(__dirname, '..');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.(tsx?|mjs|cjs|js)$/.test(name) ? [full] : [];
    });
  it('no localStorage.x = or localStorage[...] = anywhere in the app', () => {
    const found = walk(join(ROOT, 'src')).flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/\blocalStorage\s*(\.\s*[A-Za-z_$][\w$]*|\[[^\]]*\])\s*=(?!=)/g)].map((m) => `${relative(ROOT, f)}: ${m[0]}`),
    );
    expect(found).toEqual([]);
  });
});
