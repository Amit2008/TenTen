import { describe, expect, it } from 'vitest';
import { createGenerator, weightedPieceSource } from '../../src/application/piece-source/piece-source';
import { checkRun, parseEnvelope, snapshot, type SaveEnvelope } from '../../src/application/save/envelope';
import { SaveConflictError, SaveQueue, type SaveStatus, type SaveStore } from '../../src/application/save/save-queue';
import { GameSession, startSession, type SessionRules } from '../../src/application/session/session';
import { canonicalJson } from '../../src/domain/models/gameplay-config';
import type { SessionState } from '../../src/domain/models/types';
import { CLASSIC } from '../domain/helpers';

const HASH = 'sha256:test';
const rules: SessionRules = { config: CLASSIC, gameplayHash: HASH, source: weightedPieceSource };

/** A few legal moves from seed 7, found by trying anchors in order. */
function playedRun(moves = 3): GameSession {
  const session = new GameSession(rules, startSession(rules, 'run', createGenerator(7)));
  for (let m = 0; m < moves; m++) {
    const s = session.state;
    outer: for (const inst of s.tray)
      if (inst)
        for (let y = 0; y < 10; y++)
          for (let x = 0; x < 10; x++)
            if (session.place({ type: 'PlacePiece', sessionId: s.sessionId, expectedRevision: s.revision, instanceId: inst.instanceId, anchor: [x, y] }).accepted) break outer;
    expect(session.state.revision, `move ${m}`).toBe(m + 1);
  }
  return session;
}

/** What IndexedDB would hold: the structured clone of the envelope, i.e. plain JSON data. */
const stored = (e: SaveEnvelope): unknown => JSON.parse(JSON.stringify(e));

describe('envelope', () => {
  it('round-trips a run exactly: board, tray, score and the generator, so future deals are identical', () => {
    const session = playedRun(5);
    const env: SaveEnvelope = { ...snapshot(null, '1.1.0', session.state), storageRevision: 4 };
    const parsed = parseEnvelope(stored(env));
    expect(canonicalJson(parsed.active)).toBe(canonicalJson(session.state));
    const check = checkRun(parsed.active!, CLASSIC, HASH);
    expect(check.ok).toBe(true);
    // Continue both and compare the next deals.
    const resumed = new GameSession(rules, (check as { run: SessionState }).run);
    const play = (g: GameSession) => {
      for (let i = 0; i < 6; i++) {
        const s = g.state;
        const inst = s.tray.find((t) => t)!;
        for (let a = 0; a < 100; a++)
          if (g.place({ type: 'PlacePiece', sessionId: s.sessionId, expectedRevision: s.revision, instanceId: inst.instanceId, anchor: [a % 10, Math.floor(a / 10)] }).accepted) break;
      }
      return canonicalJson(g.state);
    };
    expect(play(resumed)).toBe(play(session));
  });

  it('keeps the best score per ruleset and never lowers it', () => {
    const run = playedRun(2).state;
    const first = snapshot({ schemaVersion: 1, contentVersion: 'x', active: null, best: { other: 99, [HASH]: 500 }, settings: { volume: 3 } }, '1.1.0', run);
    expect(first.best).toEqual({ other: 99, [HASH]: 500 });
    expect(first.settings).toEqual({ volume: 3 });
    expect(snapshot(null, '1.1.0', { ...run, score: 700 }).best).toEqual({ [HASH]: 700 });
  });

  it.each([
    ['unsupported schema', (e: Record<string, unknown>) => ({ ...e, schemaVersion: 2 })],
    ['unknown key', (e: Record<string, unknown>) => ({ ...e, extra: 1 })],
    ['fractional score', (e: Record<string, unknown>) => ({ ...e, active: { ...(e.active as object), score: 1.5 } })],
    ['bad generator', (e: Record<string, unknown>) => ({ ...e, active: { ...(e.active as object), generator: { algorithm: 'mt19937' } } })],
    ['cells length', (e: Record<string, unknown>) => ({ ...e, active: { ...(e.active as object), board: { columns: 10, rows: 10, cells: [] } } })],
  ])('rejects a record with %s', (_, mutate) => {
    const env = stored({ ...snapshot(null, '1.1.0', playedRun(1).state), storageRevision: 1 }) as Record<string, unknown>;
    expect(() => parseEnvelope(mutate(env))).toThrow(/^save:/);
  });

  it('refuses a different ruleset, inconsistent runs and half-resolved boards; recomputes game over', () => {
    const run = playedRun(2).state;
    expect(checkRun(run, CLASSIC, 'sha256:other')).toMatchObject({ ok: false, reason: 'incompatible' });
    expect(checkRun({ ...run, tray: run.tray.slice(1) }, CLASSIC, HASH)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkRun({ ...run, tray: run.tray.map(() => null) }, CLASSIC, HASH)).toMatchObject({ ok: false, reason: 'invalid' });
    const fullRow = run.board.cells.map((c, i) => (i >= 90 ? 'single' : c));
    expect(checkRun({ ...run, board: { ...run.board, cells: fullRow } }, CLASSIC, HASH)).toMatchObject({ detail: expect.stringMatching(/full line/) });
    expect(checkRun({ ...run, board: { ...run.board, cells: run.board.cells.map(() => 'nope') } }, CLASSIC, HASH)).toMatchObject({ ok: false });
    // A board where nothing fits is reported as game over even if the record says active.
    const blocked = run.board.cells.map((_, i) => ((Math.floor(i / 10) + i) % 2 === 0 ? 'single' : null));
    const over = checkRun({ ...run, board: { ...run.board, cells: blocked }, tray: run.tray.map((t) => (t ? { ...t, shapeId: 'square_3' } : null)) }, CLASSIC, HASH);
    expect(over).toMatchObject({ ok: true, run: { status: 'game_over' } });
  });
});

/** A store whose writes complete only when the test says so. */
function fakeStore() {
  const writes: { expected: number; next: SaveEnvelope; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const store: SaveStore = { write: (expected, next) => new Promise((resolve, reject) => writes.push({ expected, next, resolve, reject })) };
  return { store, writes };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('SaveQueue', () => {
  const snap = (score: number) => snapshot(null, '1.1.0', { ...playedRun(1).state, score });

  it('shows Saved only after the write completes, and writes in order with increasing storage revisions', async () => {
    const { store, writes } = fakeStore();
    const statuses: SaveStatus[] = [];
    const q = new SaveQueue(store, 3, (s) => statuses.push(s));
    q.enqueue(snap(1));
    expect(q.status).toBe('saving');
    q.enqueue(snap(2));
    q.enqueue(snap(3)); // coalesces: only the latest waits
    expect(writes).toHaveLength(1);
    writes[0]!.resolve();
    await tick();
    expect(q.status).toBe('saving'); // the newer snapshot is now in flight
    expect(writes.map((w) => [w.expected, w.next.storageRevision, w.next.active!.score])).toEqual([[3, 4, 1], [4, 5, 3]]);
    writes[1]!.resolve();
    await tick();
    expect(q.status).toBe('saved');
    expect(statuses).toEqual(['saving', 'saved']);
    expect(q.expectedRevision).toBe(5);
  });

  it('a failed write keeps only the latest snapshot, keeps the run playable and writes it on retry', async () => {
    const { store, writes } = fakeStore();
    const q = new SaveQueue(store, 0, () => {});
    q.enqueue(snap(1));
    writes[0]!.reject(new DOMException('full', 'QuotaExceededError'));
    await tick();
    expect(q.status).toBe('session_only');
    q.enqueue(snap(2));
    q.enqueue(snap(3));
    expect(writes).toHaveLength(1); // nothing written while session-only
    q.retry();
    expect(writes).toHaveLength(2);
    expect([writes[1]!.expected, writes[1]!.next.active!.score]).toEqual([0, 3]);
    writes[1]!.resolve();
    await tick();
    expect(q.status).toBe('saved');
  });

  it('a conflict stops the writer for good; nothing is retried or forced', async () => {
    const { store, writes } = fakeStore();
    const statuses: SaveStatus[] = [];
    const q = new SaveQueue(store, 2, (s) => statuses.push(s));
    q.enqueue(snap(1));
    q.enqueue(snap(2));
    writes[0]!.reject(new SaveConflictError('other tab'));
    await tick();
    expect(q.status).toBe('conflict');
    q.enqueue(snap(3));
    q.retry();
    expect(writes).toHaveLength(1);
    expect(statuses).toEqual(['saving', 'conflict']);
  });

  it('without storage the run is session-only; a later store gets the latest snapshot', async () => {
    const q = new SaveQueue(null, 0, () => {});
    expect(q.status).toBe('session_only');
    q.enqueue(snap(1));
    q.enqueue(snap(2));
    const { store, writes } = fakeStore();
    q.retry(store, 7);
    expect(writes.map((w) => [w.expected, w.next.storageRevision, w.next.active!.score])).toEqual([[7, 8, 2]]);
  });

  it('after stop(), late completions change nothing', async () => {
    const { store, writes } = fakeStore();
    const statuses: SaveStatus[] = [];
    const q = new SaveQueue(store, 0, (s) => statuses.push(s));
    q.enqueue(snap(1));
    q.stop();
    writes[0]!.resolve();
    await tick();
    q.enqueue(snap(2));
    expect(statuses).toEqual(['saving']);
    expect(writes).toHaveLength(1);
  });
});
