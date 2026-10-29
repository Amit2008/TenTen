import { resolveClears } from '../../domain/clearing/clearing';
import { hasAnyLegalMove } from '../../domain/legal-moves/legal-moves';
import type {
  GameplayConfig,
  GeneratorState,
  MoveRejection,
  MoveResult,
  PlacePiece,
  RejectionReason,
  SessionState,
  ShapeDefinition,
  SlotInstance,
} from '../../domain/models/types';
import { deepFreeze } from '../../domain/models/validation';
import { applyPlacement, canPlace, placementCells } from '../../domain/placement/placement';
import { addScore, scoreDelta } from '../../domain/scoring/scoring';
import type { PieceSource } from '../piece-source/piece-source';

export interface SessionRules {
  readonly config: GameplayConfig;
  readonly gameplayHash: string;
  readonly source: PieceSource;
}

/** A fresh run: empty board, a full tray from the generator, and an immediate legal-move check. */
export function startSession(rules: SessionRules, sessionId: string, generator: GeneratorState): SessionState {
  const { config } = rules;
  const deal = dealTray(rules, generator, 1);
  const board = { columns: config.columns, rows: config.rows, cells: Array<null>(config.columns * config.rows).fill(null) };
  return deepFreeze<SessionState>({
    sessionId,
    gameplayHash: rules.gameplayHash,
    revision: 0,
    board,
    tray: deal.slots,
    score: 0,
    status: hasAnyLegalMove(board, deal.slots.map((s) => shapeOf(config, s))) ? 'active' : 'game_over',
    generator: deal.generator,
    nextInstanceId: deal.nextInstanceId,
  });
}

/**
 * One PlacePiece command as one complete transaction (GDD 5.1). Works on copies and returns either a rejection
 * (no effects at all) or the fully committed next state. Order: guards, place, detect and clear all lines at once,
 * score, consume the slot, refill only when every slot is empty, then check for any legal move.
 */
export function placePiece(rules: SessionRules, state: SessionState, command: PlacePiece): MoveResult | MoveRejection {
  const { config } = rules;
  if (command.sessionId !== state.sessionId) return reject('stale_session');
  if (state.status === 'game_over') return reject('game_over');
  if (command.expectedRevision !== state.revision) return reject('stale_revision');
  const slotIndex = state.tray.findIndex((slot) => slot?.instanceId === command.instanceId);
  if (slotIndex < 0) return reject('unknown_slot');
  const slot = state.tray[slotIndex]!;
  const shape = shapeOf(config, slot);
  if (!canPlace(state.board, shape, command.anchor)) return reject('illegal_placement');

  const placed = placementCells(shape, command.anchor);
  const clear = resolveClears(applyPlacement(state.board, shape, command.anchor));
  const delta = scoreDelta(config.score, placed.length, clear.completedRows.length + clear.completedColumns.length);
  const score = addScore(state.score, delta);

  let tray: readonly (SlotInstance | null)[] = state.tray.map((s, i) => (i === slotIndex ? null : s));
  let generator = state.generator;
  let nextInstanceId = state.nextInstanceId;
  let dealt: readonly SlotInstance[] = [];
  if (tray.every((s) => s === null)) {
    const deal = dealTray(rules, generator, nextInstanceId);
    tray = dealt = deal.slots;
    generator = deal.generator;
    nextInstanceId = deal.nextInstanceId;
  }
  const status = hasAnyLegalMove(clear.board, tray.map((s) => (s ? shapeOf(config, s) : null))) ? 'active' : 'game_over';
  const revision = state.revision + 1;
  const next: SessionState = {
    sessionId: state.sessionId,
    gameplayHash: state.gameplayHash,
    revision,
    board: clear.board,
    tray,
    score,
    status,
    generator,
    nextInstanceId,
  };
  return deepFreeze<MoveResult>({
    accepted: true,
    moveId: revision,
    placed,
    completedRows: clear.completedRows,
    completedColumns: clear.completedColumns,
    cleared: clear.cleared,
    scoreDelta: delta,
    consumedInstanceId: slot.instanceId,
    dealt,
    status,
    state: next,
  });
}

/** Holds the one authoritative state; a command is applied against it and replaces it only when accepted. */
export class GameSession {
  #state: SessionState;

  constructor(
    private readonly rules: SessionRules,
    state: SessionState,
  ) {
    this.#state = state;
  }

  get state(): SessionState {
    return this.#state;
  }

  place(command: PlacePiece): MoveResult | MoveRejection {
    const result = placePiece(this.rules, this.#state, command);
    if (result.accepted) this.#state = result.state;
    return result;
  }
}

function dealTray(rules: SessionRules, generator: GeneratorState, firstInstanceId: number) {
  const slots: SlotInstance[] = [];
  let g = generator;
  let instanceId = firstInstanceId;
  for (let i = 0; i < rules.config.traySize; i++) {
    const draw = rules.source.draw(g, rules.config);
    slots.push({ instanceId: instanceId++, shapeId: draw.shape.id });
    g = draw.generator;
  }
  return { slots, generator: g, nextInstanceId: instanceId };
}

function shapeOf(config: GameplayConfig, slot: SlotInstance): ShapeDefinition {
  const shape = config.catalog.find((s) => s.id === slot.shapeId);
  if (!shape) throw new Error(`tray references unknown shape ${slot.shapeId}`);
  return shape;
}

function reject(reason: RejectionReason): MoveRejection {
  return { accepted: false, reason };
}
