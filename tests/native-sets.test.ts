// Saved sets as files in the iPhone app: the file names (src/native/setFiles.ts), the chunked video upload, and
// src/sets/sets.ts itself running on the file adapter (src/native/setsDb.ts) against the in-memory fake native side.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHUNK, extFor, SET_FILE_NAME, setFileFor, toBase64, UNREADABLE_INDEX, uploadVideo, VIDEO_EXTS } from '../src/native/setFiles';
import { entryFromReplay, parseIndex, timeFromId } from '../src/native/setsDb';
import { newSetId, type SavedSetMeta } from '../src/sets/sets';
import { FakeNative, fakeCapacitor } from './fixtures/fakeNative';

const ROOT = join(__dirname, '..');

describe('file names', () => {
  it('maps the keys of src/sets/sets.ts to files', () => {
    expect(setFileFor('sets.index.v1')).toEqual({ kind: 'index', name: 'index.json' });
    expect(setFileFor('sets.data.v1.s1abc')).toEqual({ kind: 'replay', name: 's1abc.replay.json' });
    expect(setFileFor('sets.video.v1.s1abc')).toEqual({ kind: 'video', id: 's1abc' });
    for (const bad of ['calibration.recordings.v1', 'sets.data.v1.', 'sets.data.v1.../x', 'sets.video.v1.a/b', 'sets.index.v2']) expect(() => setFileFor(bad), bad).toThrow();
  });

  it('picks the extension from the MIME type, parameters ignored', () => {
    expect(extFor('video/mp4')).toBe('mp4');
    expect(extFor('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extFor('video/quicktime')).toBe('mov');
    expect(extFor('video/x-m4v')).toBe('m4v');
    expect(extFor('video/webm;codecs=vp9')).toBe('webm');
    expect(extFor('')).toBe('mp4');
    expect(extFor('video/3gpp')).toBe('mp4');
  });

  it('accepts the names saved sets use, and nothing that could leave the folder', () => {
    for (let i = 0; i < 20; i++) {
      const id = newSetId(new Date(Date.UTC(2026, 10, 27) + i * 7_777_777));
      for (const name of [`${id}.replay.json`, ...VIDEO_EXTS.map((e) => `${id}.${e}`)]) expect(SET_FILE_NAME.test(name), name).toBe(true);
    }
    for (const ok of ['index.json', 'index.unreadable-1764237600000.json', `${'a'.repeat(64)}.mp4`]) expect(SET_FILE_NAME.test(ok), ok).toBe(true);
    for (const bad of ['../x.mp4', 'a/b.mp4', `${'a'.repeat(65)}.mp4`, 'x.txt', '.mp4', 'x.mp4.part', 'index.unreadable-.json', 'x.replay.json/..', '']) expect(SET_FILE_NAME.test(bad), bad).toBe(false);
  });

  // The Swift side checks the same pattern (the native contract).
  it('FiteeFiles.setFileName in Swift is the same pattern', () => {
    const source = readFileSync(join(ROOT, 'ios', 'App', 'App', 'FiteeFiles.swift'), 'utf8');
    const m = /\bsetFileName\b[^=\n]*=\s*#"(.*?)"#/.exec(source);
    expect(m?.[1]).toBe(SET_FILE_NAME.source);
  });
});

describe('base64', () => {
  const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 31 + 7) & 0xff);
  const expected = Buffer.from(bytes).toString('base64');
  afterEach(() => {
    delete (Uint8Array.prototype as { toBase64?: unknown }).toBase64;
  });
  it('encodes without Uint8Array.prototype.toBase64', async () => {
    expect((Uint8Array.prototype as { toBase64?: unknown }).toBase64).toBeUndefined();
    expect(await toBase64(new Blob([bytes]))).toBe(expected);
    expect(await toBase64(new Blob([]))).toBe('');
  });
  it('uses Uint8Array.prototype.toBase64 where there is one', async () => {
    const spy = vi.fn(function (this: Uint8Array) {
      return Buffer.from(this).toString('base64');
    });
    Object.defineProperty(Uint8Array.prototype, 'toBase64', { value: spy, configurable: true, writable: true });
    expect(await toBase64(new Blob([bytes]))).toBe(expected);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('uploadVideo', () => {
  const blobOf = (size: number) => new Blob([Uint8Array.from({ length: size }, (_, i) => (i * 13) & 0xff)], { type: 'video/mp4' });
  for (const size of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK + 5]) {
    it(`saves ${size} bytes in order`, async () => {
      const fake = new FakeNative();
      const blob = blobOf(size);
      await uploadVideo(fake, 'sTest', blob);
      expect(fake.file('sTest.mp4')?.equals(Buffer.from(await blob.arrayBuffer()))).toBe(true);
      const offsets = fake.callsTo('appendVideo').map((c) => (c.args as { offset: number }).offset);
      expect(offsets).toEqual(Array.from({ length: Math.ceil(size / CHUNK) }, (_, i) => i * CHUNK));
      expect(fake.callsTo('finishVideo')).toHaveLength(1);
      expect(fake.activeParts.size).toBe(0);
    });
  }
  it('gives the part up when a chunk fails, and rethrows', async () => {
    const fake = new FakeNative();
    await uploadVideo(fake, 'sOk', blobOf(10)); // another set's video stays
    fake.failNext('appendVideo', 'NO_ROOM');
    await expect(uploadVideo(fake, 'sTest', blobOf(CHUNK + 1))).rejects.toMatchObject({ code: 'NO_ROOM' });
    expect(fake.callsTo('abortVideo')).toHaveLength(1);
    expect([...fake.sets.keys()]).toEqual(['sOk.mp4']);
    expect(fake.activeParts.size).toBe(0);
  });
  it('still rethrows the first error when giving up fails too', async () => {
    const fake = new FakeNative();
    fake.failNext('finishVideo', 'SIZE_MISMATCH');
    fake.failNext('abortVideo', 'IO_ERROR');
    await expect(uploadVideo(fake, 'sTest', blobOf(5))).rejects.toMatchObject({ code: 'SIZE_MISMATCH' });
  });
});

// ---- src/sets/sets.ts on files ------------------------------------------------------------------------------------

const ID = (i: number) => `s${(Date.UTC(2026, 10, 1) + i * 60_000).toString(36)}x${i % 10}`;
const meta = (i: number, video?: { type: string; bytes: number }): SavedSetMeta => ({
  id: ID(i),
  exerciseId: 'back-squat',
  at: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString(),
  source: 'camera',
  durationSec: 10,
  reps: 1,
  cleanReps: 1,
  faults: {},
  mirrored: false,
  ...(video ? { video: { ...video, offsetMs: 120 } } : {}),
});
const replay = (exerciseId = 'back-squat') => ({
  seq: { version: 1, width: 640, height: 480, source: 'camera', frames: [{ t: 0, lm: null }, { t: 4250, lm: null }] },
  result: {
    exerciseId,
    kind: 'reps',
    side: 'left',
    reps: [{ checks: [{ status: 'pass' }] }, { checks: [{ status: 'fail', fault: 'depth' }, { status: 'fail', fault: 'depth' }] }],
    warnings: [],
    torsoPx: 100,
  },
});

describe('src/sets/sets.ts on files', () => {
  let fake: FakeNative;
  let sets: typeof import('../src/sets/sets');
  const names = () => [...fake.sets.keys()].sort();
  const index = () => JSON.parse(fake.file('index.json')?.toString('utf8') ?? 'null') as SavedSetMeta[] | null;
  const put = (name: string, value: unknown) => fake.sets.set(name, Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));

  beforeEach(async () => {
    // A fresh launch, so the reconcile runs again, with src/sets/sets.ts as the native build compiles it: its
    // src/db.ts is the file adapter. (vi.resetModules keeps mocked modules, so the mock is made again each time.)
    vi.resetModules();
    vi.doMock('../src/db', () => import('../src/native/setsDb'));
    fake = new FakeNative();
    vi.stubGlobal('Capacitor', fakeCapacitor(fake));
    sets = await import('../src/sets/sets');
  });
  afterEach(() => vi.unstubAllGlobals());

  const data = { seq: { version: 1 as const, width: 640, height: 480, source: 'camera' as const, frames: [{ t: 0, lm: null }] }, result: replay().result as never };

  it('saves a set (replay first, then the index) and reads it back', async () => {
    await sets.saveSet(meta(1), data);
    expect(names()).toEqual(['index.json', `${ID(1)}.replay.json`]);
    expect(fake.calls.filter((c) => c.method === 'writeSetFile').map((c) => (c.args as { name: string }).name)).toEqual([`${ID(1)}.replay.json`, 'index.json']);
    expect((await sets.loadSets()).map((m) => m.id)).toEqual([ID(1)]);
    expect((await sets.loadSetData(ID(1)))?.seq.width).toBe(640);
    expect(await sets.loadSetData(ID(2))).toBeUndefined();
  });

  it('saves a video as a file and marks the entry', async () => {
    await sets.saveSet(meta(1), data);
    const video = new Blob([new Uint8Array(CHUNK + 3)], { type: 'video/quicktime' });
    await sets.saveSetVideo(ID(1), video, 80);
    expect(fake.file(`${ID(1)}.mov`)?.length).toBe(CHUNK + 3);
    expect(index()?.[0].video).toEqual({ bytes: CHUNK + 3, type: 'video/quicktime', offsetMs: 80 });
    const { videoUrl } = await import('../src/native/setsDb');
    expect(await videoUrl(ID(1), 'video/quicktime')).toBe(`fake://sets/__files__/${ID(1)}.mov`);
    await expect(sets.loadSetVideo(ID(1))).rejects.toThrow(/videoUrl/);
  });

  it('prunes replays past MAX_REPLAYS, keeping sets with a video', async () => {
    put(`${ID(0)}.replay.json`, replay());
    put(`${ID(0)}.mp4`, 'v');
    put('index.json', [meta(0, { type: 'video/mp4', bytes: 1 })]);
    for (let i = 1; i <= sets.MAX_REPLAYS + 2; i++) await sets.saveSet(meta(i), data);
    const kept = (await sets.loadSets()).map((m) => m.id);
    expect(kept).toHaveLength(sets.MAX_REPLAYS + 1);
    expect(kept).toContain(ID(0));
    expect(kept).not.toContain(ID(1));
    expect(kept).not.toContain(ID(2));
    expect(fake.file(`${ID(1)}.replay.json`)).toBeUndefined();
    expect(fake.file(`${ID(0)}.mp4`)).toBeDefined();
  });

  it('deletes a set, a video (every extension), all videos, and everything', async () => {
    for (const i of [1, 2, 3]) await sets.saveSet(meta(i), data);
    await sets.saveSetVideo(ID(1), new Blob(['a'], { type: 'video/mp4' }), 0);
    await sets.saveSetVideo(ID(2), new Blob(['b'], { type: 'video/webm' }), 0);
    await sets.deleteSetVideo(ID(1));
    expect(fake.callsTo('removeSetFiles').at(-1)?.args).toEqual({ names: VIDEO_EXTS.map((e) => `${ID(1)}.${e}`) });
    expect(index()?.find((m) => m.id === ID(1))?.video).toBeUndefined();
    await sets.deleteSet(ID(3));
    expect(names()).toEqual(['index.json', `${ID(1)}.replay.json`, `${ID(2)}.replay.json`, `${ID(2)}.webm`]);
    await sets.deleteAllVideos();
    expect(names()).toEqual(['index.json', `${ID(1)}.replay.json`, `${ID(2)}.replay.json`]);
    await sets.deleteAllSets();
    expect(names()).toEqual([]);
  });

  it('reconciles at launch: orphans and stale parts go, a missing replay drops its entry, a missing video clears it', async () => {
    put('index.json', [meta(1), meta(2, { type: 'video/mp4', bytes: 3 }), meta(3, { type: 'video/mp4', bytes: 3 })]);
    put(`${ID(1)}.replay.json`, replay());
    put(`${ID(2)}.replay.json`, replay()); // its video is gone (sets/ isn't restored from backups)
    put(`${ID(3)}.mp4`, 'vid'); // its replay is gone: the entry and the video go
    put(`${ID(9)}.replay.json`, replay()); // no entry: an orphan
    put(`${ID(1)}.webm`, 'x'); // an orphan video
    put(`${ID(4)}.mp4.part`, 'half'); // an upload that never finished
    put('notes.txt', 'not a set file'); // left alone
    expect((await sets.loadSets()).map((m) => [m.id, !!m.video])).toEqual([
      [ID(2), false],
      [ID(1), false],
    ]);
    expect(names()).toEqual(['index.json', 'notes.txt', `${ID(1)}.replay.json`, `${ID(2)}.replay.json`].sort());
    // Once per launch: later calls don't reconcile again.
    put(`${ID(8)}.replay.json`, replay());
    await sets.loadSets();
    expect(fake.file(`${ID(8)}.replay.json`)).toBeDefined();
  });

  it('runs the reconcile before saveSet writes, so a new replay is never taken for an orphan', async () => {
    put('index.json', []);
    await sets.saveSet(meta(5), data);
    expect(fake.file(`${ID(5)}.replay.json`)).toBeDefined();
    expect(fake.calls[0].method).toBe('listSetFiles');
  });

  it('sets an unreadable index aside and rebuilds it from the replays, deleting nothing', async () => {
    put('index.json', '{"truncated');
    put(`${ID(1)}.replay.json`, replay('deadlift'));
    put(`${ID(2)}.replay.json`, replay());
    put(`${ID(2)}.mov`, 'vid');
    put(`${ID(3)}.replay.json`, '{also broken');
    put(`${ID(7)}.mp4`, 'a video whose replay is gone');
    const before = names().filter((n) => n !== 'index.json');
    const loaded = await sets.loadSets();
    expect(loaded.map((m) => [m.id, m.exerciseId, m.video?.type])).toEqual([
      [ID(2), 'back-squat', 'video/quicktime'],
      [ID(1), 'deadlift', undefined],
    ]);
    expect(loaded[0]).toMatchObject({ reps: 2, cleanReps: 1, faults: { depth: 1 }, durationSec: 4.3, source: 'camera', mirrored: false, video: { bytes: 3, offsetMs: 0 } });
    const aside = names().filter((n) => /^index\.unreadable-\d+\.json$/.test(n));
    expect(aside).toHaveLength(1);
    expect(fake.file(aside[0])?.toString()).toBe('{"truncated');
    for (const name of before) expect(fake.file(name), name).toBeDefined();
    // The next launch keeps what no entry names too: none of it is newer than the set-aside index.
    vi.resetModules();
    vi.doMock('../src/db', () => import('../src/native/setsDb'));
    const again = await import('../src/sets/sets');
    expect((await again.loadSets()).map((m) => m.id)).toEqual([ID(2), ID(1)]);
    for (const name of before) expect(fake.file(name), name).toBeDefined();
  });

  /** Another launch: the module state (the reconcile, holds, picks) starts afresh, the files stay. */
  const relaunch = async () => {
    vi.resetModules();
    vi.doMock('../src/db', () => import('../src/native/setsDb'));
    sets = await import('../src/sets/sets');
    return sets;
  };
  const aside = () => names().filter((n) => UNREADABLE_INDEX.test(n));

  it('sets aside an index whose bytes aren’t UTF-8 (BAD_DATA) as one that doesn’t parse, rebuilds it, and saves go on', async () => {
    const bad = Buffer.from([0x5b, 0xff, 0xfe, 0x00, 0x9c, 0x5d]); // "[…]" with bytes that aren't UTF-8
    fake.sets.set('index.json', bad);
    put(`${ID(1)}.replay.json`, replay());
    put(`${ID(1)}.mp4`, 'vid');
    expect((await sets.loadSets()).map((m) => [m.id, m.video?.type])).toEqual([[ID(1), 'video/mp4']]);
    expect(aside()).toHaveLength(1);
    expect(fake.file(aside()[0])?.equals(bad)).toBe(true);
    await sets.saveSet(meta(2), data);
    expect((await (await relaunch()).loadSets()).map((m) => m.id)).toEqual([ID(2), ID(1)]);
    expect(names().filter((n) => n.endsWith('.replay.json'))).toEqual([`${ID(1)}.replay.json`, `${ID(2)}.replay.json`]);
  });

  it('leaves an index it couldn’t read for another reason (IO_ERROR) for the next launch: nothing set aside or deleted', async () => {
    put('index.json', [meta(1)]);
    put(`${ID(1)}.replay.json`, replay());
    put(`${ID(9)}.replay.json`, replay()); // an orphan, which a reconcile would delete
    fake.failNext('readSetFile', 'IO_ERROR'); // the reconcile's read of index.json
    expect((await sets.loadSets()).map((m) => m.id)).toEqual([ID(1)]); // read again after it: it works now
    expect(fake.callsTo('renameSetFile')).toEqual([]);
    expect(aside()).toEqual([]);
    expect(fake.file(`${ID(9)}.replay.json`)).toBeDefined();
    expect(fake.file('index.json')?.toString()).toBe(JSON.stringify([meta(1)]));
  });

  it('rebuilds before it sets an unreadable index aside: stopped during the rebuild, the next launch starts over', async () => {
    put('index.json', '{"truncated');
    for (const i of [1, 2, 3]) put(`${ID(i)}.replay.json`, replay());
    put(`${ID(2)}.mp4`, 'a saved video');
    // The app stops while the rebuild reads the second replay (a few MB each over the bridge).
    const read = fake.readSetFile.bind(fake);
    let reads = 0;
    fake.readSetFile = (o, u) => (o.name.endsWith('.replay.json') && ++reads === 2 ? new Promise(() => {}) : read(o, u));
    void sets.loadSets();
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.file('index.json')?.toString()).toBe('{"truncated');
    expect(aside()).toEqual([]);
    fake.readSetFile = read;
    expect((await (await relaunch()).loadSets()).map((m) => [m.id, !!m.video])).toEqual([
      [ID(3), false],
      [ID(2), true],
      [ID(1), false],
    ]);
    expect(aside()).toHaveLength(1);
  });

  it('rebuilds again when the rebuilt index wasn’t written (stopped, or no room), and nothing writes over it meanwhile', async () => {
    put('index.json', '{"truncated');
    for (const i of [1, 2, 3]) put(`${ID(i)}.replay.json`, replay());
    put(`${ID(2)}.mp4`, 'a saved video');
    fake.failNext('writeSetFile', 'NO_ROOM'); // the rebuilt index's write, right after the set-aside
    // This launch: the sets aren't shown, and a save doesn't write an index of its own over them.
    await expect(sets.loadSets()).rejects.toThrow(/index/);
    await expect(sets.saveSet(meta(9), data)).rejects.toThrow(/index/);
    expect(fake.file('index.json')).toBeUndefined();
    expect(aside()).toHaveLength(1);
    // The next launch (room again): rebuilt from the replays, the one written meanwhile included.
    expect((await (await relaunch()).loadSets()).map((m) => [m.id, !!m.video])).toEqual([
      [ID(9), false],
      [ID(3), false],
      [ID(2), true],
      [ID(1), false],
    ]);
    expect(fake.file(`${ID(2)}.mp4`)).toBeDefined();
    // And from then on the index is read as usual.
    await sets.saveSet(meta(10), data);
    expect((await (await relaunch()).loadSets()).map((m) => m.id)).toEqual([ID(10), ID(9), ID(3), ID(2), ID(1)]);
  });

  it('while an index is set aside, deletes only orphans saved after it was set aside, never older files or the set-aside index', async () => {
    const setAside = Date.UTC(2026, 10, 1) + 5 * 60_000; // between ID(4) and ID(6)
    put(`index.unreadable-${setAside}.json`, '{"truncated');
    put('index.json', [meta(1)]);
    put(`${ID(1)}.replay.json`, replay());
    put(`${ID(2)}.replay.json`, '{broken'); // older: maybe a set the unreadable index named
    put(`${ID(3)}.mov`, 'older video, no replay');
    put(`${ID(6)}.replay.json`, replay()); // newer, in no entry: a save that stopped before its index write
    put(`${ID(7)}.mp4`, 'newer video, no entry');
    put('selftest1764237600000a.mp4', 'no time in its id'); // kept: its time can't be told
    expect((await sets.loadSets()).map((m) => m.id)).toEqual([ID(1)]);
    expect(names()).toEqual(
      [`index.unreadable-${setAside}.json`, 'index.json', `${ID(1)}.replay.json`, `${ID(2)}.replay.json`, `${ID(3)}.mov`, 'selftest1764237600000a.mp4'].sort(),
    );
  });

  it('rebuilding again beside a set-aside index, a replay it can’t read goes as an orphan only if it was saved after the set-aside', async () => {
    const setAside = Date.UTC(2026, 10, 1) + 5 * 60_000; // between ID(4) and ID(6); no index.json beside it
    put(`index.unreadable-${setAside}.json`, '{"truncated');
    put(`${ID(1)}.replay.json`, replay());
    put(`${ID(2)}.replay.json`, '{broken'); // older: maybe a set the set-aside index named
    put(`${ID(6)}.replay.json`, '{broken'); // newer: a save after the set-aside that left a replay no one can read
    put(`${ID(7)}.replay.json`, replay()); // newer and readable: rebuilt into the index
    expect((await sets.loadSets()).map((m) => m.id)).toEqual([ID(7), ID(1)]);
    expect(names()).toEqual([`index.unreadable-${setAside}.json`, 'index.json', `${ID(1)}.replay.json`, `${ID(2)}.replay.json`, `${ID(7)}.replay.json`].sort());
  });

  it('never takes an index that went bad mid-session for an empty one', async () => {
    await sets.saveSet(meta(1), data);
    put('index.json', 'garbage');
    await expect(sets.saveSet(meta(2), data)).rejects.toThrow(/index/);
    expect(fake.file('index.json')?.toString()).toBe('garbage');
  });

  it('waits for a video still being saved before deleting the picked files', async () => {
    await sets.saveSet(meta(1), data);
    const { clearPickedFiles } = await import('../src/native/setsDb');
    const saving = sets.saveSetVideo(ID(1), new Blob([new Uint8Array(2 * CHUNK)], { type: 'video/mp4' }), 0);
    await clearPickedFiles();
    await saving;
    const order = fake.calls.map((c) => c.method).filter((m) => m === 'finishVideo' || m === 'clearPickedFiles');
    expect(order).toEqual(['finishVideo', 'clearPickedFiles']);
  });

  // ---- picked videos: iOS's temporary copies in tmp/, which clearPickedFiles() empties ----

  /** A picked video's File (WebKit's copy in tmp/), of `bytes` bytes. */
  const picked = (bytes = 2 * CHUNK) => new Blob([new Uint8Array(bytes)], { type: 'video/quicktime' });
  /** Holds back a set's video chunks (a big picked video over the bridge) until let go. */
  const slowUpload = (id: string) => {
    let go!: () => void;
    const gate = new Promise<void>((resolve) => (go = resolve));
    const append = fake.appendVideo.bind(fake);
    fake.appendVideo = async (o, u) => {
      if (o.id === id) await gate;
      return append(o, u);
    };
    return go;
  };
  const tick = () => new Promise((r) => setTimeout(r, 10));

  it('a clear asked as a check’s results close, while its video saves, doesn’t run once the picker opens again', async () => {
    const setsDb = await import('../src/native/setsDb');
    await sets.saveSet(meta(1), data);
    const a = picked();
    setsDb.holdPickedFile(a); // check A, on a picked video
    const go = slowUpload(ID(1));
    const saving = sets.saveSetVideo(ID(1), a, 0); // A's Save video, still running when…
    const cleared = setsDb.releasePickedFile(a); // …A's results close ("Record another set")
    setsDb.pickingFile(); // the picker opens: WebKit puts B's copy in tmp/ before the input's change event
    go();
    await saving;
    await cleared;
    expect(fake.pickedFilesCleared).toBe(0); // B's copy stays
    const b = picked();
    setsDb.holdPickedFile(b);
    await setsDb.releasePickedFile(b); // B's check ends
    expect(fake.pickedFilesCleared).toBe(1); // tmp/ emptied then, A's copy with B's
  });

  it('a clear waits for every video being saved, those started after it was asked too, and not while a picked video is in use', async () => {
    const setsDb = await import('../src/native/setsDb');
    for (const i of [1, 2]) await sets.saveSet(meta(i), data);
    const a = picked();
    setsDb.holdPickedFile(a);
    const goA = slowUpload(ID(1));
    const savingA = sets.saveSetVideo(ID(1), a, 0);
    const cleared = setsDb.releasePickedFile(a); // A's results close while its video saves
    // B, picked and in its results, saving its own video (the hold alone protects it here).
    const b = picked(6 * CHUNK);
    setsDb.holdPickedFile(b);
    const goB = slowUpload(ID(2));
    const savingB = sets.saveSetVideo(ID(2), b, 0);
    goA();
    await savingA;
    await tick();
    expect(fake.pickedFilesCleared).toBe(0); // B's upload still reads its copy
    goB();
    await savingB;
    await cleared;
    expect(fake.pickedFilesCleared).toBe(0); // B's results still show (Save video may read it again)
    await setsDb.releasePickedFile(b);
    expect(fake.pickedFilesCleared).toBe(1);
    expect(fake.calls.map((c) => c.method).filter((m) => m === 'finishVideo' || m === 'clearPickedFiles')).toEqual(['finishVideo', 'finishVideo', 'clearPickedFiles']);
  });

  it('a video being analysed keeps its copy through any clear, until its check is left', async () => {
    const setsDb = await import('../src/native/setsDb');
    const a = picked();
    setsDb.holdPickedFile(a); // the analysis reads it
    await setsDb.clearPickedFiles(); // a clear left over from the check before
    expect(fake.pickedFilesCleared).toBe(0);
    await setsDb.releasePickedFile(a); // left mid-analysis: the stopped analysis lets it go
    expect(fake.pickedFilesCleared).toBe(1);
  });

  it('the picker closing without a file empties tmp/ of what an earlier clear left', async () => {
    const setsDb = await import('../src/native/setsDb');
    await sets.saveSet(meta(1), data);
    const a = picked();
    setsDb.holdPickedFile(a);
    const go = slowUpload(ID(1));
    const saving = sets.saveSetVideo(ID(1), a, 0);
    const cleared = setsDb.releasePickedFile(a);
    setsDb.pickingFile(); // the picker opens…
    const cancelled = setsDb.clearPickedFiles(); // …and closes without a file (the input's cancel event)
    go();
    await Promise.all([saving, cleared, cancelled]);
    expect(fake.pickedFilesCleared).toBe(1); // A's copy goes now, not at the next launch
  });
});

describe('rebuilding an index entry', () => {
  it('reads the time back from the set id', () => {
    const at = new Date('2026-11-27T10:11:12.345Z');
    expect(timeFromId(newSetId(at))).toBe(at.toISOString());
    expect(timeFromId('selftest1764237600000a')).toBeUndefined();
    expect(timeFromId('s0000000')).toBeUndefined();
  });
  it('needs the replay’s exercise and frames', () => {
    const id = newSetId(new Date('2026-11-20T08:00:00Z'));
    expect(entryFromReplay(id, replay())?.exerciseId).toBe('back-squat');
    expect(entryFromReplay(id, { seq: {}, result: {} })).toBeUndefined();
    expect(entryFromReplay(id, null)).toBeUndefined();
    expect(entryFromReplay('nope', replay())).toBeUndefined();
  });
  it('parses an index only when it is a list of sets', () => {
    expect(parseIndex('[]')).toEqual([]);
    expect(parseIndex('[{"id":"s1"}]')).toEqual([{ id: 's1' }]);
    for (const bad of ['', '{}', '[1]', '[{"id":1}]', 'null', '{"truncated']) expect(parseIndex(bad), bad).toBeUndefined();
  });
});
