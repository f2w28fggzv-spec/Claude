// An in-memory FiteeNative (the contract in src/native/bridge.ts), for the vitest tests and for the Chromium check of
// dist-native/ (tools/native-check/), which loads this file with Node's type stripping: so no TypeScript-only runtime
// syntax here (enums, namespaces, parameter properties), relative imports with their .ts extension, and only types
// from the contract. It checks names and data as the Swift side does, keeps a log of every call, and can fail a call
// on purpose (failNext).
import type { AppInfo, Appearance, Empty, FiteeNative, NativeErrorCode, SetFileList, SnapshotFiles, VideoTarget } from '../../src/native/bridge.ts';
import { CHUNK, EXPORT_NAME, SET_FILE_NAME, SET_ID, VIDEO_EXTS } from '../../src/native/setFiles.ts';

export interface FakeCall {
  method: string;
  args: unknown;
  /** Date.now() when the call came. */
  at: number;
  /** The page's count of user keys in localStorage when it made the call, if it said. */
  userKeys?: number;
}

export interface FakeOptions {
  appInfo?: Partial<AppInfo>;
  /** videoUrl() answers `${fileBase}/__files__/<name>` (the Chromium check's server serves those from files()). */
  fileBase?: string;
  /** What exportFile resolves with (`saved` true unless set). */
  exportSaved?: boolean;
  /** Runs at the end of deleteAllData (the Chromium check clears the page's own stores here, as WKWebsiteDataStore does). */
  onDeleteAll?: () => void | Promise<void>;
}

/** A rejection as the Capacitor bridge gives it: an Error with a short message and a code. */
export function nativeError(code: NativeErrorCode, message: string): Error & { code: NativeErrorCode } {
  return Object.assign(new Error(message), { code });
}

const isJsonName = (name: unknown): name is string => typeof name === 'string' && SET_FILE_NAME.test(name) && name.endsWith('.json');
const isVideoName = (name: unknown): name is string => typeof name === 'string' && SET_FILE_NAME.test(name) && !name.endsWith('.json');
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class FakeNative implements FiteeNative {
  /** sets/: every file by name, upload parts (<id>.<ext>.part) included. */
  readonly sets = new Map<string, Buffer>();
  /** data/: the copy of the log. */
  snapshot: SnapshotFiles = {};
  /** Uploads running (their part names). */
  readonly activeParts = new Set<string>();
  readonly calls: FakeCall[] = [];
  /** Files exportFile was given. */
  readonly exports: { name: string; text: string }[] = [];
  keepAwake = false;
  appearance: Appearance = 'system';
  pickedFilesCleared = 0;
  deletedAll = 0;
  /**
   * The marker Library/Application Support/fitee-deleting: set while deleteAllData runs, as the Swift side writes it
   * first and removes it last. A test sets it (and clears the files itself) to stand for an app stopped part way.
   */
  deleting = false;
  info: Omit<AppInfo, 'deleting'>;
  private readonly failures: { method: string; code: NativeErrorCode; message: string }[] = [];
  private readonly options: FakeOptions;

  constructor(options: FakeOptions = {}) {
    this.options = options;
    const { deleting, ...info } = { version: '1.0.0', build: '1', debug: true, selfTest: false, rules: true, gate: true, ...options.appInfo };
    this.info = info;
    this.deleting = deleting ?? false;
  }

  /** The next call to `method` rejects with `code`. */
  failNext(method: keyof FiteeNative, code: NativeErrorCode = 'IO_ERROR', message = 'Failed on purpose'): void {
    this.failures.push({ method, code, message });
  }

  /** Logs a call, then fails it if a failure was asked for. */
  private enter(method: keyof FiteeNative, args: unknown, userKeys?: number): void {
    this.calls.push({ method, args, at: Date.now(), ...(userKeys === undefined ? {} : { userKeys }) });
    const i = this.failures.findIndex((f) => f.method === method);
    if (i >= 0) {
      const [f] = this.failures.splice(i, 1);
      throw nativeError(f.code, f.message);
    }
  }

  /** The calls to one method, in order. */
  callsTo(method: keyof FiteeNative): FakeCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /** The Chromium check's door: any method by name, with the page's user-key count logged. */
  async call(method: string, args: unknown, userKeys?: number): Promise<unknown> {
    const fn = (this as unknown as Record<string, unknown>)[method];
    if (typeof fn !== 'function' || !FAKE_METHODS.includes(method as keyof FiteeNative)) throw nativeError('UNAVAILABLE', `No method ${method}`);
    return (fn as (a: unknown, u?: number) => Promise<unknown>).call(this, args ?? {}, userKeys);
  }

  // ---- the contract ----

  async appInfo(_?: unknown, userKeys?: number): Promise<AppInfo> {
    this.enter('appInfo', {}, userKeys);
    this.keepAwake = false;
    return { ...this.info, deleting: this.deleting };
  }

  async setKeepAwake(o: { on: boolean }, userKeys?: number): Promise<Empty> {
    this.enter('setKeepAwake', o, userKeys);
    this.keepAwake = o.on === true;
    return {};
  }

  async setAppearance(o: { style: Appearance }, userKeys?: number): Promise<Empty> {
    this.enter('setAppearance', o, userKeys);
    if (!['light', 'dark', 'system'].includes(o.style)) throw nativeError('BAD_DATA', 'No such style');
    this.appearance = o.style;
    return {};
  }

  async exportFile(o: { name: string; text: string }, userKeys?: number): Promise<{ saved: boolean }> {
    this.enter('exportFile', { name: o.name, bytes: o.text?.length }, userKeys);
    if (typeof o.name !== 'string' || !EXPORT_NAME.test(o.name)) throw nativeError('BAD_NAME', 'Not a file name for an export');
    if (typeof o.text !== 'string') throw nativeError('BAD_DATA', 'No text');
    this.exports.push({ name: o.name, text: o.text });
    return { saved: this.options.exportSaved ?? true };
  }

  async clearPickedFiles(_?: unknown, userKeys?: number): Promise<Empty> {
    this.enter('clearPickedFiles', {}, userKeys);
    this.pickedFilesCleared++;
    return {};
  }

  async readSnapshot(_?: unknown, userKeys?: number): Promise<SnapshotFiles> {
    this.enter('readSnapshot', {}, userKeys);
    return { ...this.snapshot };
  }

  async writeSnapshot(o: { text: string }, userKeys?: number): Promise<{ bytes: number }> {
    this.enter('writeSnapshot', { bytes: o.text?.length, rev: revOf(o.text) }, userKeys);
    if (typeof o.text !== 'string') throw nativeError('BAD_DATA', 'No text');
    const prev = this.snapshot.current ?? this.snapshot.prev;
    this.snapshot = { current: o.text, ...(prev === undefined ? {} : { prev }) };
    return { bytes: Buffer.byteLength(o.text) };
  }

  async dropSnapshot(_?: unknown, userKeys?: number): Promise<Empty> {
    this.enter('dropSnapshot', {}, userKeys);
    delete this.snapshot.current;
    return {};
  }

  async readSetFile(o: { name: string }, userKeys?: number): Promise<{ text?: string }> {
    this.enter('readSetFile', o, userKeys);
    if (!isJsonName(o.name)) throw nativeError('BAD_NAME', 'Not a set file name');
    const file = this.sets.get(o.name);
    if (!file) return {};
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(file) };
    } catch {
      throw nativeError('BAD_DATA', `${o.name} isn’t UTF-8 text.`); // as FiteeFiles.readSetFile
    }
  }

  async writeSetFile(o: { name: string; text: string }, userKeys?: number): Promise<Empty> {
    this.enter('writeSetFile', { name: o.name, bytes: o.text?.length }, userKeys);
    if (!isJsonName(o.name)) throw nativeError('BAD_NAME', 'Not a set file name');
    if (typeof o.text !== 'string') throw nativeError('BAD_DATA', 'No text');
    this.sets.set(o.name, Buffer.from(o.text, 'utf8'));
    return {};
  }

  async renameSetFile(o: { from: string; to: string }, userKeys?: number): Promise<Empty> {
    this.enter('renameSetFile', o, userKeys);
    if (![o.from, o.to].every((n) => typeof n === 'string' && SET_FILE_NAME.test(n))) throw nativeError('BAD_NAME', 'Not a set file name');
    const file = this.sets.get(o.from);
    if (!file) throw nativeError('NOT_FOUND', 'No such file');
    this.sets.delete(o.from);
    this.sets.set(o.to, file);
    return {};
  }

  async removeSetFiles(o: { names: string[] }, userKeys?: number): Promise<Empty> {
    this.enter('removeSetFiles', o, userKeys);
    if (!Array.isArray(o.names) || !o.names.every((n) => typeof n === 'string' && SET_FILE_NAME.test(n))) throw nativeError('BAD_NAME', 'Not a set file name');
    for (const name of o.names) this.sets.delete(name);
    return {};
  }

  async listSetFiles(_?: unknown, userKeys?: number): Promise<SetFileList> {
    this.enter('listSetFiles', {}, userKeys);
    for (const name of [...this.sets.keys()]) if (name.endsWith('.part') && !this.activeParts.has(name)) this.sets.delete(name);
    const files = [...this.sets.entries()].filter(([name]) => SET_FILE_NAME.test(name)).map(([name, bytes]) => ({ name, bytes: bytes.length, excluded: true }));
    return { files, folderExcluded: true };
  }

  private part(o: VideoTarget): string {
    if (typeof o.id !== 'string' || !SET_ID.test(o.id) || !(VIDEO_EXTS as readonly string[]).includes(o.ext)) throw nativeError('BAD_NAME', 'Not a video id or extension');
    return `${o.id}.${o.ext}.part`;
  }

  async beginVideo(o: VideoTarget & { bytes: number }, userKeys?: number): Promise<{ chunk: number }> {
    this.enter('beginVideo', o, userKeys);
    const part = this.part(o);
    if (!Number.isInteger(o.bytes) || o.bytes < 0) throw nativeError('BAD_DATA', 'Not a size');
    this.sets.set(part, Buffer.alloc(0));
    this.activeParts.add(part);
    return { chunk: CHUNK };
  }

  async appendVideo(o: VideoTarget & { offset: number; data: string }, userKeys?: number): Promise<{ length: number }> {
    this.enter('appendVideo', { id: o.id, ext: o.ext, offset: o.offset, bytes: o.data?.length }, userKeys);
    const part = this.part(o);
    const file = this.sets.get(part);
    if (!this.activeParts.has(part) || !file) throw nativeError('NOT_FOUND', 'No upload running for it');
    if (typeof o.data !== 'string' || !BASE64.test(o.data)) throw nativeError('BAD_DATA', 'Not base64');
    const bytes = Buffer.from(o.data, 'base64');
    if (bytes.length > CHUNK) throw nativeError('BAD_DATA', 'Over a chunk');
    if (o.offset !== file.length) throw nativeError('BAD_OFFSET', 'Not at the end of the file');
    const next = Buffer.concat([file, bytes]);
    this.sets.set(part, next);
    return { length: next.length };
  }

  async finishVideo(o: VideoTarget & { bytes: number }, userKeys?: number): Promise<{ bytes: number }> {
    this.enter('finishVideo', o, userKeys);
    const part = this.part(o);
    const file = this.sets.get(part);
    if (!this.activeParts.has(part) || !file) throw nativeError('NOT_FOUND', 'No upload running for it');
    if (file.length !== o.bytes) throw nativeError('SIZE_MISMATCH', 'The file has another size');
    this.sets.delete(part);
    this.sets.set(`${o.id}.${o.ext}`, file);
    this.activeParts.delete(part);
    return { bytes: file.length };
  }

  async abortVideo(o: VideoTarget, userKeys?: number): Promise<Empty> {
    this.enter('abortVideo', o, userKeys);
    const part = this.part(o);
    this.sets.delete(part);
    this.activeParts.delete(part);
    return {};
  }

  async videoUrl(o: { name: string }, userKeys?: number): Promise<{ url: string }> {
    this.enter('videoUrl', o, userKeys);
    if (!isVideoName(o.name)) throw nativeError('BAD_NAME', 'Not a video name');
    if (!this.sets.has(o.name)) throw nativeError('NOT_FOUND', 'No such video');
    return { url: `${this.options.fileBase ?? 'fake://sets'}/__files__/${o.name}` };
  }

  async deleteAllData(_?: unknown, userKeys?: number): Promise<Empty> {
    this.enter('deleteAllData', {}, userKeys);
    this.deleting = true;
    this.sets.clear();
    this.activeParts.clear();
    this.snapshot = {};
    this.deletedAll++;
    await this.options.onDeleteAll?.(); // the web view's stores
    this.deleting = false;
    return {};
  }

  // ---- for tests and the Chromium check ----

  /** A saved file's bytes (the Chromium check's server serves /__files__/<name> from here). */
  file(name: string): Buffer | undefined {
    return SET_FILE_NAME.test(name) ? this.sets.get(name) : undefined;
  }

  /** The current copy of the log, parsed (undefined without one). */
  currentCopy(): { rev: number; data: Record<string, unknown> } | undefined {
    return this.snapshot.current === undefined ? undefined : (JSON.parse(this.snapshot.current) as { rev: number; data: Record<string, unknown> });
  }
}

/** Every method of the contract, for call(). */
export const FAKE_METHODS: readonly (keyof FiteeNative)[] = [
  'appInfo',
  'setKeepAwake',
  'setAppearance',
  'exportFile',
  'clearPickedFiles',
  'readSnapshot',
  'writeSnapshot',
  'dropSnapshot',
  'readSetFile',
  'writeSetFile',
  'renameSetFile',
  'removeSetFiles',
  'listSetFiles',
  'beginVideo',
  'appendVideo',
  'finishVideo',
  'abortVideo',
  'videoUrl',
  'deleteAllData',
];

/** A copy's rev, if its text parses. */
function revOf(text: string): number | undefined {
  try {
    return (JSON.parse(text) as { rev?: number }).rev;
  } catch {
    return undefined;
  }
}

/** window.Capacitor for tests: the fake as Capacitor.Plugins.FiteeNative, and a SystemBars that records its styles. */
export function fakeCapacitor(fake: FakeNative): { Plugins: { FiteeNative: FiteeNative; SystemBars: { styles: string[]; setStyle(o: { style: string }): Promise<void> } } } {
  const styles: string[] = [];
  return {
    Plugins: {
      FiteeNative: fake,
      SystemBars: {
        styles,
        async setStyle(o: { style: string }) {
          styles.push(o.style);
        },
      },
    },
  };
}
