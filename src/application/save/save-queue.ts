// Ordered, coalescing saves (GDD 9.2). Pure: the store is injected; no timers, no unload hooks.
import type { SaveEnvelope, SaveSnapshot } from './envelope';

/** Another tab wrote since this tab last read or wrote: stop writing, never overwrite it. */
export class SaveConflictError extends Error {
  override name = 'SaveConflictError';
}

export interface SaveStore {
  /**
   * One transaction: read the stored envelope, require its storageRevision to equal `expected`, then replace it.
   * Resolves only after the transaction completes; rejects with SaveConflictError on a revision mismatch.
   */
  write(expected: number, next: SaveEnvelope): Promise<void>;
}

/** saved: last write completed. saving: a write is in flight or queued. session_only: storage failed or is unavailable. */
export type SaveStatus = 'saved' | 'saving' | 'session_only' | 'conflict';

/**
 * Keeps at most one pending snapshot (the latest); writes never run out of order. A failed write keeps the latest
 * snapshot for retry() and the run stays playable; a conflict stops the writer for good.
 */
export class SaveQueue {
  #store: SaveStore | null;
  #expected: number;
  #pending: SaveSnapshot | null = null;
  #writing = false;
  #status: SaveStatus;
  #stopped = false;

  constructor(
    store: SaveStore | null,
    /** storageRevision of the envelope this tab read or wrote last (0 when there was none). */
    expectedRevision: number,
    private readonly onStatus: (status: SaveStatus, error?: unknown) => void,
  ) {
    this.#store = store;
    this.#expected = expectedRevision;
    this.#status = store ? 'saved' : 'session_only';
  }

  get status(): SaveStatus {
    return this.#status;
  }

  get expectedRevision(): number {
    return this.#expected;
  }

  enqueue(next: SaveSnapshot): void {
    if (this.#stopped || this.#status === 'conflict') return;
    this.#pending = next;
    if (this.#status === 'session_only') return; // keep only the latest until retry()
    void this.#flush();
  }

  /** After a failure: try again with the latest snapshot. A new store may be attached (storage became available). */
  retry(store: SaveStore | null = this.#store, expectedRevision = this.#expected): void {
    if (this.#stopped || this.#status === 'conflict' || !store) return;
    this.#store = store;
    this.#expected = expectedRevision;
    this.#set('saving');
    void this.#flush();
  }

  /** Teardown: late completions are ignored and nothing more is written. */
  stop(): void {
    this.#stopped = true;
  }

  async #flush(): Promise<void> {
    if (this.#writing) return;
    this.#writing = true;
    while (this.#pending && !this.#stopped) {
      const next: SaveEnvelope = { ...this.#pending, storageRevision: this.#expected + 1 };
      this.#pending = null;
      this.#set('saving');
      try {
        await this.#store!.write(this.#expected, next);
      } catch (error) {
        this.#writing = false;
        if (this.#stopped) return;
        if (error instanceof SaveConflictError) {
          this.#pending = null;
          return this.#set('conflict', error);
        }
        this.#pending ??= next; // a newer snapshot, if any, replaces the failed one
        return this.#set('session_only', error);
      }
      if (this.#stopped) return;
      this.#expected = next.storageRevision;
    }
    this.#writing = false;
    if (!this.#stopped && !this.#pending) this.#set('saved');
  }

  #set(status: SaveStatus, error?: unknown): void {
    if (this.#status === status && status === 'saving') return;
    this.#status = status;
    this.onStatus(status, error);
  }
}
