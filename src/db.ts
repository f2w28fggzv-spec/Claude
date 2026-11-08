// Minimal IndexedDB key-value store for larger on-device data (calibration
// landmark recordings: numbers only, never video). Falls back to memory when
// IndexedDB is unavailable (e.g. some private-browsing modes).
const DB_NAME = 'formcheck';
const STORE = 'kv';
let dbPromise: Promise<IDBDatabase | null> | undefined;
const memory = new Map<string, unknown>();

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

// The memory copy is only used when IndexedDB isn't available, so large
// values (saved videos) aren't also kept in memory.
export async function dbGet<T>(key: string): Promise<T | undefined> {
  if (!(await open())) return memory.get(key) as T | undefined;
  return run<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
}

export async function dbSet(key: string, value: unknown): Promise<void> {
  if (!(await open())) {
    memory.set(key, value);
    return;
  }
  await run('readwrite', (s) => s.put(value, key));
}

export async function dbDelete(key: string): Promise<void> {
  memory.delete(key);
  if (await open()) await run('readwrite', (s) => s.delete(key));
}
