import { dbDelete, dbGet, dbSet } from '../db';
import type { CalibrationRecording } from './calibrate';

const KEY = 'calibration.recordings.v1';

export const loadRecordings = async (): Promise<CalibrationRecording[]> => (await dbGet<CalibrationRecording[]>(KEY)) ?? [];

export async function saveRecording(rec: CalibrationRecording): Promise<void> {
  const all = await loadRecordings();
  await dbSet(KEY, [...all.filter((r) => r.id !== rec.id), rec]);
}

export async function deleteRecording(id: string): Promise<void> {
  await dbSet(KEY, (await loadRecordings()).filter((r) => r.id !== id));
}

/** Removes every calibration recording (used by "Delete all my data"). */
export const deleteAllRecordings = (): Promise<void> => dbDelete(KEY);
