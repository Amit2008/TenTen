// Startup save handling (GDD 9.2): open IndexedDB, choose the run to start, and offer explicit recovery choices.
import { openSaveStore, revisionOf, SaveUnavailableError, type IdbSaveStore } from '../adapters/indexeddb/save-store';
import { checkRun, parseEnvelope, snapshot, type SaveEnvelope, type SaveSnapshot } from '../application/save/envelope';
import { SaveQueue, type SaveStatus } from '../application/save/save-queue';
import type { SessionState } from '../domain/models/types';

const statusText = document.getElementById('save-status')!;
const retryButton = document.getElementById('save-retry') as HTMLButtonElement;
const notice = document.getElementById('save-notice')!;
const noticeText = document.getElementById('save-notice-text')!;
const noticeActions = document.getElementById('save-notice-actions')!;

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
  readonly newRun: () => SessionState;
  /** `?seed=` start: always a new run, never a resume. */
  readonly forceNew: boolean;
  /** False once a newer load has started; late results are then dropped. */
  readonly isCurrent: () => boolean;
  /** Called when another tab wrote first: the game must stop accepting moves. */
  readonly onConflict: () => void;
  readonly reload: () => void;
}

export interface Saves {
  readonly run: SessionState;
  /** Call after every accepted move (and, from T19, every settings change). */
  save(state: SessionState): void;
  close(): void;
}

/** Shows a recovery message with buttons; resolves with the chosen action's result. */
function ask<T>(message: string, actions: readonly (readonly [label: string, choose: () => T])[]): Promise<T> {
  noticeText.textContent = message;
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

  let run: SessionState;
  let expected = 0;
  /** False when the stored current record already is this run. */
  let needsWrite = true;
  if (!store) {
    run = ctx.newRun();
  } else {
    const records = await store.read();
    expected = revisionOf(records.current);
    let envelope: SaveEnvelope | null = null;
    let problem: string | null = null;
    if (records.current !== undefined) {
      try {
        envelope = parseEnvelope(records.current);
      } catch (error) {
        problem = `The saved game could not be read (${error instanceof Error ? error.message : 'invalid data'}).`;
      }
    }
    const check = envelope?.active ? ctx.checkRun(envelope.active) : null;
    if (check && !check.ok)
      problem = check.reason === 'incompatible' ? 'The saved game was played with different rules.' : `The saved game is damaged (${check.detail}).`;
    previous = envelope;

    if (check?.ok && check.run.status === 'active' && !ctx.forceNew) {
      run = check.run; // resume exactly what was saved, including future deals
      needsWrite = false;
    } else if (problem) {
      // A damaged or incompatible record is moved aside to "preserved", never deleted or put into backup.
      run = ctx.forceNew ? ctx.newRun() : await chooseRecovery(records.backup, problem);
      if (!ctx.isCurrent()) throw new Error('superseded');
      previous = snapshot(previous, ctx.contentVersion, run);
      try {
        await store.replace(expected, { ...previous, storageRevision: expected + 1 }, false);
        expected += 1;
        needsWrite = false;
      } catch (error) {
        console.warn('could not replace the damaged save', error); // the queue retries or reports a conflict
      }
    } else {
      run = ctx.newRun();
    }
  }

  queue = new SaveQueue(store, expected, setStatus);
  const save = (state: SessionState): void => {
    previous = snapshot(previous, ctx.contentVersion, state);
    queue!.enqueue(previous);
  };
  if (!store) setStatus('session_only');
  if (needsWrite) save(run);
  else setStatus('saved');

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
    run,
    save,
    close() {
      listeners.abort();
      queue?.stop();
      store?.close();
      hideNotice();
      statusText.textContent = '';
      retryButton.hidden = true;
    },
  };

  /** Restore backup (when it is readable and compatible) or start a new game. */
  async function chooseRecovery(rawBackup: unknown, problem: string): Promise<SessionState> {
    let backup: SaveEnvelope | null = null;
    try {
      backup = rawBackup === undefined ? null : parseEnvelope(rawBackup);
    } catch {
      backup = null;
    }
    const backupRun = backup?.active ? ctx.checkRun(backup.active) : null;
    const restorable = backup && (!backup.active || backupRun?.ok);
    const choice = await ask<'backup' | 'new'>(`${problem} It is kept in this browser.`, [
      ...(restorable ? [['Restore backup', () => 'backup' as const] as const] : []),
      ['Start a new game', () => 'new' as const],
    ]);
    if (choice === 'backup') previous = backup; // its best scores and settings come back too
    return choice === 'backup' && backupRun?.ok && backupRun.run.status === 'active' ? backupRun.run : ctx.newRun();
  }
}
