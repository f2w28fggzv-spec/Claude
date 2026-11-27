// Placeholder: stage 2 replaces this.
// Stage 2 adds the saved-set file helpers here (extFor, setFileFor, toBase64, uploadVideo, VideoNative) and keeps
// the values below as they are: they're part of the native contract (src/native/bridge.ts). The Swift side checks
// the same patterns (ios/App/App/FiteeFiles.swift) and the Chromium check's fake imports them, so this file stays
// free of imports and of TypeScript-only syntax such as enums (Node's type stripping loads it).

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
