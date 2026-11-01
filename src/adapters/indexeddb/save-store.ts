import type { SaveEnvelope } from '../../application/save/envelope';
import { SaveConflictError, type SaveStore } from '../../application/save/save-queue';

export const SAVE_DB_NAME = 'line-garden';
const SAVE_DB_VERSION = 1;
const STORE = 'saves';
/** current: the live envelope. backup: the last known-good one before it. preserved: a record set aside, not lost. */
type Key = 'current' | 'backup' | 'preserved';

/** IndexedDB is missing, refused (some private modes) or holds a newer schema than this build. */
export class SaveUnavailableError extends Error {
  override name = 'SaveUnavailableError';
}

export interface StoredRecords {
  readonly current: unknown;
  readonly backup: unknown;
}

/** storageRevision of a raw stored record; 0 when absent or unreadable, so a write can still be guarded. */
export function revisionOf(raw: unknown): number {
  const revision = (raw as { storageRevision?: unknown } | null | undefined)?.storageRevision;
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

export interface OpenHandlers {
  /** Another tab holds an older connection open and blocks the schema upgrade; the open continues once it closes. */
  onBlocked(): void;
  /** Another tab is upgrading the schema: this connection has been closed and can no longer save. */
  onVersionChange(): void;
}

export async function openSaveStore(handlers: OpenHandlers, idb: IDBFactory | undefined = globalThis.indexedDB): Promise<IdbSaveStore> {
  if (!idb) throw new SaveUnavailableError('This browser does not provide IndexedDB.');
  let request: IDBOpenDBRequest;
  try {
    request = idb.open(SAVE_DB_NAME, SAVE_DB_VERSION);
  } catch (cause) {
    throw new SaveUnavailableError('Browser storage refused to open.', { cause });
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onblocked = () => handlers.onBlocked();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new SaveUnavailableError(`Browser storage could not be opened (${request.error?.name ?? 'unknown error'}).`, { cause: request.error }));
  });
  db.onversionchange = () => {
    db.close();
    handlers.onVersionChange();
  };
  return new IdbSaveStore(db);
}

export class IdbSaveStore implements SaveStore {
  constructor(private readonly db: IDBDatabase) {}

  read(): Promise<StoredRecords> {
    const tx = this.db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const current = store.get('current' satisfies Key);
    const backup = store.get('backup' satisfies Key);
    return done(tx).then(() => ({ current: current.result, backup: backup.result }));
  }

  write(expected: number, next: SaveEnvelope): Promise<void> {
    return this.replace(expected, next, true);
  }

  /**
   * One readwrite transaction: read current, compare its storageRevision with `expected` (abort on mismatch), then
   * move the old current to backup (or to preserved when it is not a known-good record) and write `next`.
   * Resolves on transaction completion only.
   */
  replace(expected: number, next: SaveEnvelope, currentIsGood: boolean): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let conflict = false;
    let failure: unknown;
    const read = store.get('current' satisfies Key);
    read.onsuccess = () => {
      try {
        if (revisionOf(read.result) !== expected) {
          conflict = true;
          return tx.abort();
        }
        if (read.result !== undefined) store.put(read.result, (currentIsGood ? 'backup' : 'preserved') satisfies Key);
        store.put(next, 'current' satisfies Key);
      } catch (error) {
        // put() can throw synchronously (e.g. DataCloneError, QuotaExceededError): nothing is written.
        failure = error;
        tx.abort();
      }
    };
    return done(tx).catch((error: unknown) => {
      if (conflict) throw new SaveConflictError(`Another tab saved first (stored revision is not ${expected}).`);
      throw failure ?? error;
    });
  }

  close(): void {
    this.db.close();
  }
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('The save transaction was aborted.', 'AbortError'));
    tx.onerror = (e) => e.preventDefault(); // reported once through onabort
  });
}
