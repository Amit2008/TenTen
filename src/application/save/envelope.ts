// Versioned browser save envelope (GDD 9.2). Pure: parsing and checks only; storage lives in an adapter.
import { resolveClears } from '../../domain/clearing/clearing';
import { hasAnyLegalMove } from '../../domain/legal-moves/legal-moves';
import type { GameplayConfig, SessionState, SlotInstance } from '../../domain/models/types';
import { Validator, deepFreeze } from '../../domain/models/validation';
import { parseGeneratorState } from '../piece-source/piece-source';

export const SAVE_SCHEMA_VERSION = 1;

export interface SaveEnvelope {
  readonly schemaVersion: typeof SAVE_SCHEMA_VERSION;
  /** Increases on every envelope write (moves, settings, restarts); separate from the move revision. */
  readonly storageRevision: number;
  readonly contentVersion: string;
  /** The run to continue, or null when none is active. */
  readonly active: SessionState | null;
  /** Best score per gameplay hash, so different rulesets never share a record. */
  readonly best: Readonly<Record<string, number>>;
  /** Player settings; the keys are defined with the settings screen (T19) and kept as stored until then. */
  readonly settings: Readonly<Record<string, unknown>>;
}

/** An envelope before the save queue assigns its storage revision. */
export type SaveSnapshot = Omit<SaveEnvelope, 'storageRevision'>;

/** Snapshot after a move or a new run: the best score for this ruleset only ever rises. */
export function snapshot(previous: SaveSnapshot | null, contentVersion: string, active: SessionState): SaveSnapshot {
  const best = { ...previous?.best };
  best[active.gameplayHash] = Math.max(best[active.gameplayHash] ?? 0, active.score);
  return { schemaVersion: SAVE_SCHEMA_VERSION, contentVersion, active, best, settings: previous?.settings ?? {} };
}

/** Structural validation of a stored record. Throws ContentError; callers keep the raw record for recovery. */
export function parseEnvelope(json: unknown): SaveEnvelope {
  const v = new Validator('save');
  const e = v.object(json, '', ['schemaVersion', 'storageRevision', 'contentVersion', 'active', 'best', 'settings']);
  v.literal(e.schemaVersion, 'schemaVersion', [SAVE_SCHEMA_VERSION]);
  const best: Record<string, number> = {};
  for (const [hash, score] of Object.entries(v.record(e.best, 'best'))) best[hash] = v.int(score, `best.${hash}`);
  return deepFreeze({
    schemaVersion: SAVE_SCHEMA_VERSION,
    storageRevision: v.int(e.storageRevision, 'storageRevision', 1),
    contentVersion: v.string(e.contentVersion, 'contentVersion'),
    active: e.active === null ? null : parseRun(v, e.active),
    best,
    settings: { ...v.record(e.settings, 'settings') },
  });
}

function parseRun(v: Validator, json: unknown): SessionState {
  const r = v.object(json, 'active', ['sessionId', 'gameplayHash', 'revision', 'board', 'tray', 'score', 'status', 'generator', 'nextInstanceId']);
  const b = v.object(r.board, 'active.board', ['columns', 'rows', 'cells']);
  const columns = v.int(b.columns, 'active.board.columns', 1, 64);
  const rows = v.int(b.rows, 'active.board.rows', 1, 64);
  const cells = v.array(b.cells, 'active.board.cells').map((c, i) => (c === null ? null : v.string(c, `active.board.cells[${i}]`)));
  if (cells.length !== columns * rows) v.fail('active.board.cells', 'must have columns × rows entries');
  const tray = v.array(r.tray, 'active.tray', 1).map((s, i): SlotInstance | null => {
    if (s === null) return null;
    const slot = v.object(s, `active.tray[${i}]`, ['instanceId', 'shapeId']);
    return { instanceId: v.int(slot.instanceId, `active.tray[${i}].instanceId`, 1), shapeId: v.string(slot.shapeId, `active.tray[${i}].shapeId`) };
  });
  let generator;
  try {
    generator = parseGeneratorState(r.generator);
  } catch (error) {
    v.fail('active.generator', error instanceof Error ? error.message : 'is invalid');
  }
  return {
    sessionId: v.string(r.sessionId, 'active.sessionId'),
    gameplayHash: v.string(r.gameplayHash, 'active.gameplayHash'),
    revision: v.int(r.revision, 'active.revision'),
    board: { columns, rows, cells },
    tray,
    score: v.int(r.score, 'active.score'),
    status: v.literal(r.status, 'active.status', ['active', 'game_over']),
    generator,
    nextInstanceId: v.int(r.nextInstanceId, 'active.nextInstanceId', 1),
  };
}

export type RunCheck =
  | { readonly ok: true; readonly run: SessionState }
  | { readonly ok: false; readonly reason: 'incompatible' | 'invalid'; readonly detail: string };

/**
 * Checks a structurally valid run against the rules it claims to use. A different gameplay hash is incompatible
 * (kept, never resumed directly). Never resumes a half-resolved board, and recomputes the legal-move status.
 */
export function checkRun(run: SessionState, config: GameplayConfig, gameplayHash: string): RunCheck {
  if (run.gameplayHash !== gameplayHash) return { ok: false, reason: 'incompatible', detail: 'the saved run uses different rules' };
  const invalid = (detail: string): RunCheck => ({ ok: false, reason: 'invalid', detail });
  const ids = new Set(config.catalog.map((s) => s.id));
  const { board, tray } = run;
  if (board.columns !== config.columns || board.rows !== config.rows) return invalid('board size does not match the rules');
  if (board.cells.some((c) => c !== null && !ids.has(c))) return invalid('board holds an unknown tile');
  if (tray.length !== config.traySize) return invalid('tray size does not match the rules');
  const live = tray.filter((s): s is SlotInstance => s !== null);
  if (live.length === 0) return invalid('tray has no pieces left');
  if (live.some((s) => !ids.has(s.shapeId))) return invalid('tray holds an unknown shape');
  const instanceIds = live.map((s) => s.instanceId);
  if (new Set(instanceIds).size !== instanceIds.length || instanceIds.some((id) => id >= run.nextInstanceId))
    return invalid('tray instance ids are inconsistent');
  const lines = resolveClears(board);
  if (lines.completedRows.length + lines.completedColumns.length > 0) return invalid('board has a full line (half-resolved move)');
  const shapes = tray.map((s) => (s ? config.catalog.find((c) => c.id === s.shapeId)! : null));
  const status = hasAnyLegalMove(board, shapes) ? 'active' : 'game_over';
  return { ok: true, run: deepFreeze({ ...run, status }) };
}

