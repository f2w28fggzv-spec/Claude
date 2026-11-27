// Saved sets as files in the iPhone app: the file names (src/native/setFiles.ts), the chunked video upload, and
// src/sets/sets.ts itself running on the file adapter (src/native/setsDb.ts) against the in-memory fake native side.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHUNK, extFor, SET_FILE_NAME, setFileFor, toBase64, uploadVideo, VIDEO_EXTS } from '../src/native/setFiles';
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
    // The next launch keeps what no entry names too, while an index is set aside.
    vi.resetModules();
    vi.doMock('../src/db', () => import('../src/native/setsDb'));
    const again = await import('../src/sets/sets');
    expect((await again.loadSets()).map((m) => m.id)).toEqual([ID(2), ID(1)]);
    for (const name of before) expect(fake.file(name), name).toBeDefined();
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
