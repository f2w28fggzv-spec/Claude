// Saved sets as files in the iPhone app: the names the page, the Swift side (ios/App/App/FiteeFiles.swift) and the
// Chromium check's fake (tests/fixtures/fakeNative.ts) share, and the chunked video upload over the bridge.
// Part of the native contract (src/native/bridge.ts): change a pattern here and in FiteeFiles.swift together.
//
// No imports and no TypeScript-only runtime syntax (enums, namespaces, parameter properties): Node's type stripping
// loads this file in the Chromium check, and the fake imports it there.

/**
 * A file name in the saved-sets folder (sets/): the index, an index set aside because it couldn't be read
 * (index.unreadable-<ms>.json), a set's replay, or a set's video. Checked natively too (FiteeFiles.setFileName is
 * this pattern's source, character for character).
 */
export const SET_FILE_NAME = /^(index\.json|index\.unreadable-[0-9]{1,16}\.json|[A-Za-z0-9_-]{1,64}\.(replay\.json|mp4|mov|m4v|webm))$/;

/** A saved set's id, the first part of its file names and a video upload's id (newSetId() in src/sets/sets.ts gives such ids). */
export const SET_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The extensions a saved set's video can have. */
export const VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'webm'] as const;
export type VideoExt = (typeof VIDEO_EXTS)[number];

/** Bytes of video per appendVideo call: 1 MiB (about 1.4 MB of base64 over the bridge). */
export const CHUNK = 1 << 20;

/** A file name exportFile accepts (the backup is fitee-backup-<date>.json). */
export const EXPORT_NAME = /^[A-Za-z0-9._-]{1,100}\.json$/;

/** The index of saved sets. */
export const INDEX_FILE = 'index.json';

/** An index set aside because it couldn't be read (src/native/setsDb.ts): while one exists, no file is deleted as an orphan. */
export const UNREADABLE_INDEX = /^index\.unreadable-[0-9]{1,16}\.json$/;

/** A set's replay file (its landmarks and analysis). */
export const replayFile = (id: string) => `${id}.replay.json`;

/** A set's video file. */
export const videoFile = (id: string, ext: VideoExt) => `${id}.${ext}`;

/** The video methods of the FiteeNative plugin (src/native/bridge.ts) that an upload uses. */
export interface VideoNative {
  beginVideo(options: { id: string; ext: VideoExt; bytes: number }): Promise<{ chunk: number }>;
  appendVideo(options: { id: string; ext: VideoExt; offset: number; data: string }): Promise<{ length: number }>;
  finishVideo(options: { id: string; ext: VideoExt; bytes: number }): Promise<{ bytes: number }>;
  abortVideo(options: { id: string; ext: VideoExt }): Promise<unknown>;
}

/**
 * The file extension for a video's MIME type (parameters such as codecs ignored): MediaRecorder gives video/mp4 on
 * iPhone, a picked file may be QuickTime. Anything else is kept as .mp4, as src/sets/sets.ts types it.
 */
export function extFor(type: string): VideoExt {
  const base = type.split(';')[0].trim().toLowerCase();
  if (base === 'video/quicktime') return 'mov';
  if (base === 'video/x-m4v') return 'm4v';
  if (base === 'video/webm') return 'webm';
  return 'mp4';
}

/** The MIME type of a video file by its extension (for an index entry rebuilt from the files). */
export function typeForExt(ext: VideoExt): string {
  return { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm' }[ext];
}

/**
 * Where a key of src/sets/sets.ts lives in sets/: 'sets.index.v1' is index.json, 'sets.data.v1.<id>' the replay
 * <id>.replay.json, 'sets.video.v1.<id>' a video (one of <id>.<ext>). Anything else throws: sets.ts uses no other key.
 */
export function setFileFor(key: string): { kind: 'index' | 'replay'; name: string } | { kind: 'video'; id: string } {
  if (key === 'sets.index.v1') return { kind: 'index', name: INDEX_FILE };
  const m = /^sets\.(data|video)\.v1\.(.*)$/.exec(key);
  if (m && SET_ID.test(m[2])) return m[1] === 'data' ? { kind: 'replay', name: replayFile(m[2]) } : { kind: 'video', id: m[2] };
  throw new Error(`Not a saved-set key: ${key}`);
}

/** A Blob's bytes as base64: Uint8Array.prototype.toBase64 where present (Safari 18.2+), else btoa over 32 KiB slices. */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === 'function') return native.call(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Saves a video as sets/<id>.<ext> in chunks of at most CHUNK bytes, one call after another (the bridge runs them in
 * order): beginVideo, appendVideo for each slice at its offset, finishVideo with the size. On any error the part file
 * is given up (abortVideo, whose own failure is ignored) and the error rethrown.
 */
export async function uploadVideo(n: VideoNative, id: string, blob: Blob): Promise<void> {
  const ext = extFor(blob.type);
  const target = { id, ext };
  try {
    const { chunk } = await n.beginVideo({ ...target, bytes: blob.size });
    const step = Number.isInteger(chunk) && chunk > 0 ? Math.min(chunk, CHUNK) : CHUNK;
    for (let offset = 0; offset < blob.size; offset += step) {
      const slice = blob.slice(offset, offset + step);
      const { length } = await n.appendVideo({ ...target, offset, data: await toBase64(slice) });
      if (length !== offset + slice.size) throw new Error(`The video's file is ${length} bytes after ${offset + slice.size}`);
    }
    await n.finishVideo({ ...target, bytes: blob.size });
  } catch (err) {
    try {
      await n.abortVideo(target);
    } catch {
      // The part file is a leftover then: listSetFiles() deletes it at the next launch.
    }
    throw err;
  }
}
