// Startup save handling (GDD 9.2): open IndexedDB, choose the run to start, and offer explicit recovery choices.
import { openSaveStore, revisionOf, SaveUnavailableError, type IdbSaveStore } from '../adapters/indexeddb/save-store';
import { checkRun, parseEnvelope, snapshot, type SaveEnvelope, type SaveSnapshot } from '../application/save/envelope';
import { SaveQueue, type SaveStatus } from '../application/save/save-queue';
import { parseSettings, type Settings } from '../application/settings/settings';
import type { SessionState } from '../domain/models/types';

const statusText = document.getElementById('save-status')!;
const retryButton = document.getElementById('save-retry') as HTMLButtonElement;
const notice = document.getElementById('save-notice')!;
const noticeText = document.getElementById('save-notice-text')!;
const noticeActions = document.getElementById('save-notice-actions')!;
const noticeDetail = document.getElementById('save-notice-detail') as HTMLDetailsElement;
const noticeDetailText = document.getElementById('save-notice-detail-text')!;

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  session_only: 'Not saved (this session only)',
  conflict: 'Not saved (changed in another tab)',
};

export interface SaveContext {
  readonly contentVersion: string;
  readonly gameplayHash: string;
  readonly checkRun: (run: SessionState) => ReturnType<typeof checkRun>;
  /** `?seed=` test start: a damaged record is set aside without asking. */
  readonly forceNew: boolean;
  /** False once a newer load has started; late results are then dropped. */
  readonly isCurrent: () => boolean;
  /** Called when another tab wrote first: the game must stop accepting moves. */
  readonly onConflict: () => void;
  readonly reload: () => void;
}

export interface Saves {
  /**
   * What Continue restores: the compatible active run of the last completed save, re-read from storage after this
   * tab's own writes finish. While saving is off, the unsaved in-memory run instead (never shown as saved).
   */
  continuable(): Promise<SessionState | null>;
  /** Best score for this ruleset, including the run last saved or queued. */
  best(): number;
  /** The player set a damaged save aside and asked for a new game. */
  readonly startNew: boolean;
  /** Call for every new run and after every accepted move. */
  save(state: SessionState): void;
  /** Stored settings, with defaults for anything missing or invalid. */
  settings(defaults: Settings): Settings;
  /** Saved through the same ordered queue as moves. */
  saveSettings(settings: Settings): void;
  close(): void;
}

/** Shows a recovery message with buttons; resolves with the chosen action's result. */
function ask<T>(message: string, actions: readonly (readonly [label: string, choose: () => T])[], detail = ''): Promise<T> {
  noticeText.textContent = message;
  noticeDetail.hidden = !detail;
  noticeDetailText.textContent = detail;
  return new Promise((resolve) => {
    noticeActions.replaceChildren(
      ...actions.map(([label, choose]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', () => {
          hideNotice();
          resolve(choose());
        });
        return button;
      }),
    );
    notice.hidden = false;
    (noticeActions.firstElementChild as HTMLButtonElement | null)?.focus();
  });
}

function hideNotice(): void {
  notice.hidden = true;
  noticeDetail.hidden = true;
  noticeActions.replaceChildren();
}

function showNotice(message: string, actions: readonly (readonly [string, () => void])[]): void {
  void ask(message, actions);
}

export async function prepareSaves(ctx: SaveContext): Promise<Saves> {
  let store: IdbSaveStore | null = null;
  let queue: SaveQueue | null = null;
  let previous: SaveSnapshot | null = null;
  const listeners = new AbortController();

  const setStatus = (status: SaveStatus, error?: unknown): void => {
    if (!ctx.isCurrent()) return;
    statusText.textContent = STATUS_TEXT[status];
    retryButton.hidden = status !== 'session_only';
    if (error) console.warn('save failed', error);
    if (status === 'conflict') {
      ctx.onConflict();
      showNotice('This game was changed in another tab, so this tab stopped saving to avoid overwriting it.', [['Load latest', ctx.reload]]);
    }
  };
  const handlers = {
    onBlocked: () =>
      showNotice('Saving is waiting for another Line Garden tab that uses an older save format. Close or reload that tab.', [
        ['Reload', ctx.reload],
      ]),
    onVersionChange: () => {
      store = null;
      queue?.stop();
      setStatus('session_only');
      retryButton.hidden = true;
      showNotice('A newer version of Line Garden opened in another tab. Reload this tab to keep saving.', [['Reload', ctx.reload]]);
    },
  };

  try {
    store = await openSaveStore(handlers);
  } catch (error) {
    if (!(error instanceof SaveUnavailableError)) throw error;
    console.warn(error);
  }
  if (!ctx.isCurrent()) {
    store?.close();
    throw new Error('superseded');
  }
  hideNotice();

  let expected = 0;
  let startNew = false;
  if (store) {
    const records = await store.read();
    expected = revisionOf(records.current);
    let envelope: SaveEnvelope | null = null;
    let problem: string | null = null;
    let detail = '';
    if (records.current !== undefined) {
      try {
        envelope = parseEnvelope(records.current);
      } catch (error) {
        problem = 'Your saved game could not be read.';
        detail = error instanceof Error ? error.message : 'invalid data';
      }
    }
    const check = envelope?.active ? ctx.checkRun(envelope.active) : null;
    if (check && !check.ok)
      problem = check.reason === 'incompatible' ? 'Your saved game was played with different rules, so it cannot be continued here.' : 'Your saved game is damaged.';
    if (check && !check.ok) detail = check.detail;
    previous = envelope;
    if (problem) {
      // A damaged or incompatible record is moved aside to "preserved", never deleted or put into backup.
      const replacement = ctx.forceNew ? setAside() : await chooseRecovery(records.backup, problem, detail);
      if (!ctx.isCurrent()) throw new Error('superseded');
      startNew = replacement.active === null;
      previous = replacement;
      try {
        await store.replace(expected, { ...replacement, storageRevision: expected + 1 }, false);
        expected += 1;
      } catch (error) {
        console.warn('could not set the damaged save aside', error); // the next save retries or reports a conflict
      }
    }
  }

  queue = new SaveQueue(store, expected, setStatus);
  if (!store) setStatus('session_only');
  else if (expected > 0) setStatus('saved');

  retryButton.addEventListener(
    'click',
    async () => {
      if (store) return queue!.retry();
      try {
        store = await openSaveStore(handlers);
        queue!.retry(store, revisionOf((await store.read()).current));
      } catch (error) {
        console.warn('storage still unavailable', error);
      }
    },
    { signal: listeners.signal },
  );

  return {
    startNew,
    best: () => previous?.best[ctx.gameplayHash] ?? 0,
    save(state) {
      previous = snapshot(previous, ctx.contentVersion, state);
      queue!.enqueue(previous);
    },
    settings: (defaults) => parseSettings(previous?.settings ?? {}, defaults),
    saveSettings(settings) {
      previous = { ...(previous ?? setAside()), contentVersion: ctx.contentVersion, settings: { ...settings } };
      queue!.enqueue(previous);
    },
    async continuable() {
      const inMemory = previous?.active?.status === 'active' ? previous.active : null;
      if (!store || queue!.status === 'session_only') return inMemory;
      await queue!.whenIdle();
      // The status can change while waiting.
      if (!store || (queue!.status as SaveStatus) === 'session_only') return inMemory;
      try {
        const current = (await store.read()).current;
        if (current === undefined) return null;
        const envelope = parseEnvelope(current);
        const check = envelope.active ? ctx.checkRun(envelope.active) : null;
        queue!.adopt(envelope.storageRevision); // Continue builds on what is stored now, even if another tab wrote it
        previous = envelope;
        return check?.ok && check.run.status === 'active' ? check.run : null;
      } catch (error) {
        console.warn('could not read the save for Continue', error);
        return null;
      }
    },
    close() {
      listeners.abort();
      queue?.stop();
      store?.close();
      hideNotice();
      statusText.textContent = '';
      retryButton.hidden = true;
    },
  };

  function setAside(): SaveSnapshot {
    return { schemaVersion: 1, contentVersion: ctx.contentVersion, active: null, best: previous?.best ?? {}, settings: previous?.settings ?? {} };
  }

  /** Restore backup (when it is readable and compatible) or set the record aside for a new game. */
  async function chooseRecovery(rawBackup: unknown, problem: string, detail: string): Promise<SaveSnapshot> {
    let backup: SaveEnvelope | null = null;
    try {
      backup = rawBackup === undefined ? null : parseEnvelope(rawBackup);
    } catch {
      backup = null;
    }
    const backupRun = backup?.active ? ctx.checkRun(backup.active) : null;
    const restorable = backup && (!backup.active || backupRun?.ok);
    const choice = await ask<'backup' | 'new'>(`${problem} It is kept in this browser, not deleted.`, [
      ...(restorable ? [['Restore backup', () => 'backup' as const] as const] : []),
      ['Start a new game', () => 'new' as const],
    ], detail);
    // The backup's best scores and settings come back with it.
    return choice === 'backup' && backup ? { ...backup, contentVersion: ctx.contentVersion } : setAside();
  }
}
