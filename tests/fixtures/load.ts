import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { PoseSequence } from '../../src/engine/types';

/** Loads tests/fixtures/<name>.json(.gz). */
export function fixture(name: string): PoseSequence {
  const base = join(__dirname, name);
  try {
    return JSON.parse(gunzipSync(readFileSync(`${base}.json.gz`)).toString('utf8')) as PoseSequence;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return JSON.parse(readFileSync(`${base}.json`, 'utf8')) as PoseSequence;
  }
}
