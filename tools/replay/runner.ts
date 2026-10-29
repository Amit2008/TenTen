// Headless replay runner (T11). Plays recorded or seeded command sequences through the real application code and
// checks GDD 10 invariants on every move with independent reimplementations. Runs in Node and, bundled, in browsers.
import { createGenerator, weightedPieceSource } from '../../src/application/piece-source/piece-source';
import { xorshift32 } from '../../src/application/piece-source/xorshift32';
import { GameSession, startSession, type SessionRules } from '../../src/application/session/session';
import { canonicalJson, parseGameplay } from '../../src/domain/models/gameplay-config';
import type { Cell, GameplayConfig, MoveResult, PlacePiece, SessionState, ShapeDefinition } from '../../src/domain/models/types';

export { parseGameplay };

/** A replayable command: tray slot index and anchor, resolved against the live state when applied. */
export interface ReplayCommand {
  readonly slot: number;
  readonly anchor: readonly [number, number];
}

export class InvariantError extends Error {
  override name = 'InvariantError';
}

const rulesFor = (config: GameplayConfig): SessionRules => ({ config, gameplayHash: 'replay', source: weightedPieceSource });

/** Replays commands from a seed. Every command must be accepted; returns the canonical state after each move. */
export function replay(config: GameplayConfig, seed: number, commands: readonly ReplayCommand[]) {
  const rules = rulesFor(config);
  const session = new GameSession(rules, startSession(rules, `replay-${seed}`, createGenerator(seed)));
  const trace = [canonicalJson(session.state)];
  for (const [i, c] of commands.entries()) {
    const result = session.place(toCommand(session.state, c));
    if (!result.accepted) throw new InvariantError(`move ${i + 1} rejected: ${result.reason}`);
    trace.push(canonicalJson(result.state));
  }
  return { trace, final: session.state };
}

export interface RandomPlayStats {
  readonly seed: number;
  readonly moves: number;
  readonly score: number;
  readonly status: SessionState['status'];
  readonly refills: number;
  /** True when the run ended on a fresh tray that had no legal move at all. */
  readonly endedOnBlockedRefill: boolean;
  readonly rejectionsChecked: number;
  readonly linesCleared: number;
  /** Moves that completed two or more lines at once (crossing or parallel clears). */
  readonly multiLineMoves: number;
  readonly commands: readonly ReplayCommand[];
}

/** `random` picks any legal move; `clearing` picks among the moves completing the most lines, reaching deeper boards. */
export type PlayPolicy = 'random' | 'clearing';

/**
 * Plays random legal moves (choices from a separate test-only xorshift stream, never the deal generator) until
 * game over or `maxMoves`, interleaving invalid commands. Throws InvariantError naming the seed and move.
 */
export function randomPlay(config: GameplayConfig, seed: number, maxMoves: number, policy: PlayPolicy = 'random'): RandomPlayStats {
  const rules = rulesFor(config);
  const session = new GameSession(rules, startSession(rules, `seed-${seed}`, createGenerator(seed)));
  let picker = (seed ^ 0x9e3779b9) >>> 0 || 1;
  const pick = (n: number): number => (picker = xorshift32(picker)) % n;
  const commands: ReplayCommand[] = [];
  let refills = 0;
  let rejectionsChecked = 0;
  let endedOnBlockedRefill = false;
  let linesCleared = 0;
  let multiLineMoves = 0;
  const fail: (message: string) => never = (message) => {
    throw new InvariantError(`seed ${seed}, move ${session.state.revision + 1}: ${message}`);
  };

  while (session.state.status === 'active' && session.state.revision < maxMoves) {
    const before = session.state;
    const legal = legalMoves(config, before);
    if (legal.length === 0) fail('active status with no legal move');

    // Every few moves, an invalid command must be rejected with no effect at all.
    if (pick(4) === 0) {
      rejectionsChecked++;
      const snapshot = canonicalJson(before);
      const bad = invalidCommand(config, before, pick);
      const result = session.place(bad);
      if (result.accepted) fail(`invalid command accepted: ${JSON.stringify(bad)}`);
      if (session.state !== before || canonicalJson(session.state) !== snapshot) fail('rejection changed state');
    }

    const candidates = policy === 'clearing' ? mostLines(config, before, legal) : legal;
    const choice = candidates[pick(candidates.length)]!;
    const result = session.place(toCommand(before, choice));
    if (!result.accepted) fail(`legal move rejected: ${result.reason}`);
    commands.push(choice);
    checkMove(config, before, choice, result, fail);
    const lines = result.completedRows.length + result.completedColumns.length;
    linesCleared += lines;
    if (lines >= 2) multiLineMoves++;
    if (result.dealt.length > 0) {
      refills++;
      endedOnBlockedRefill = result.status === 'game_over';
    }
  }
  const final = session.state;
  if (final.status === 'game_over' && legalMoves(config, final).length > 0) fail('game over while a legal move exists');
  return {
    seed,
    moves: final.revision,
    score: final.score,
    status: final.status,
    refills,
    endedOnBlockedRefill,
    rejectionsChecked,
    linesCleared,
    multiLineMoves,
    commands,
  };
}

function mostLines(config: GameplayConfig, state: SessionState, legal: ReplayCommand[]): ReplayCommand[] {
  const { columns, rows } = state.board;
  const scored = legal.map((move) => {
    const shape = shapeOf(config, state.tray[move.slot]!.shapeId);
    const placed = new Set(shape.cells.map(([x, y]) => (move.anchor[1] + y) * columns + move.anchor[0] + x));
    const filled = (x: number, y: number) => placed.has(y * columns + x) || at(state, x, y) !== null;
    let lines = 0;
    for (let y = 0; y < rows; y++) if ([...Array(columns).keys()].every((x) => filled(x, y))) lines++;
    for (let x = 0; x < columns; x++) if ([...Array(rows).keys()].every((y) => filled(x, y))) lines++;
    return { move, lines };
  });
  const best = Math.max(...scored.map((s) => s.lines));
  return scored.filter((s) => s.lines === best).map((s) => s.move);
}

function toCommand(state: SessionState, { slot, anchor }: ReplayCommand): PlacePiece {
  const instance = state.tray[slot];
  return {
    type: 'PlacePiece',
    sessionId: state.sessionId,
    expectedRevision: state.revision,
    instanceId: instance ? instance.instanceId : -1,
    anchor: [anchor[0], anchor[1]],
  };
}

const shapeOf = (config: GameplayConfig, id: string): ShapeDefinition => config.catalog.find((s) => s.id === id)!;
const at = (s: SessionState, x: number, y: number) => s.board.cells[y * s.board.columns + x];

/** Independent enumeration of every legal (slot, anchor), including anchors outside the board. */
function legalMoves(config: GameplayConfig, state: SessionState): ReplayCommand[] {
  const moves: ReplayCommand[] = [];
  const { columns, rows } = state.board;
  state.tray.forEach((slot, i) => {
    if (!slot) return;
    const shape = shapeOf(config, slot.shapeId);
    for (let ay = -5; ay < rows; ay++)
      for (let ax = -5; ax < columns; ax++)
        if (shape.cells.every(([x, y]) => ax + x >= 0 && ay + y >= 0 && ax + x < columns && ay + y < rows && at(state, ax + x, ay + y) === null))
          moves.push({ slot: i, anchor: [ax, ay] });
  });
  return moves;
}

function invalidCommand(config: GameplayConfig, state: SessionState, pick: (n: number) => number): PlacePiece {
  const live = state.tray.findIndex((s) => s !== null);
  const valid = toCommand(state, { slot: live, anchor: [0, 0] });
  switch (pick(5)) {
    case 0:
      return { ...valid, sessionId: 'other-session' };
    case 1:
      return { ...valid, expectedRevision: state.revision - 1 };
    case 2:
      return { ...valid, instanceId: state.nextInstanceId + 7 };
    case 3:
      return { ...valid, anchor: [state.board.columns, 0] };
    default: {
      // An occupied anchor cell if one exists under the shape's first cell, otherwise far outside.
      const shape = shapeOf(config, state.tray[live]!.shapeId);
      const [cx, cy] = shape.cells[0]!;
      const idx = state.board.cells.findIndex((c) => c !== null);
      const anchor: Cell = idx >= 0 ? [(idx % state.board.columns) - cx, Math.floor(idx / state.board.columns) - cy] : [-9, -9];
      return { ...valid, anchor };
    }
  }
}

function checkMove(
  config: GameplayConfig,
  before: SessionState,
  choice: ReplayCommand,
  result: MoveResult,
  fail: (message: string) => never,
): void {
  const after = result.state;
  const { columns, rows } = before.board;
  const shape = shapeOf(config, before.tray[choice.slot]!.shapeId);
  const placed = new Set(shape.cells.map(([x, y]) => `${choice.anchor[0] + x},${choice.anchor[1] + y}`));

  // Recompute completed lines on the placed (pre-clear) board.
  const filled = (x: number, y: number) => placed.has(`${x},${y}`) || at(before, x, y) !== null;
  const rowsDone = [...Array(rows).keys()].filter((y) => [...Array(columns).keys()].every((x) => filled(x, y)));
  const colsDone = [...Array(columns).keys()].filter((x) => [...Array(rows).keys()].every((y) => filled(x, y)));
  if (canonicalJson(rowsDone) !== canonicalJson(result.completedRows)) fail('completed rows differ from recomputation');
  if (canonicalJson(colsDone) !== canonicalJson(result.completedColumns)) fail('completed columns differ from recomputation');
  const union = new Set<string>();
  for (const y of rowsDone) for (let x = 0; x < columns; x++) union.add(`${x},${y}`);
  for (const x of colsDone) for (let y = 0; y < rows; y++) union.add(`${x},${y}`);
  if (union.size !== result.cleared.length) fail('cleared cells are not the unique union of completed lines');

  // Every cell: cleared -> empty; placed (not cleared) -> shape tile; otherwise unchanged.
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const key = `${x},${y}`;
      const expected = union.has(key) ? null : placed.has(key) ? shape.id : at(before, x, y);
      if (at(after, x, y) !== expected) fail(`cell ${key} is ${at(after, x, y)}, expected ${expected}`);
    }
  const count = (s: SessionState) => s.board.cells.filter((c) => c !== null).length;
  if (count(after) !== count(before) + placed.size - union.size) fail('occupancy_after != before + placed - cleared');
  for (let y = 0; y < rows; y++) if ([...Array(columns).keys()].every((x) => at(after, x, y) !== null)) fail(`row ${y} still full`);
  for (let x = 0; x < columns; x++) if ([...Array(rows).keys()].every((y) => at(after, x, y) !== null)) fail(`column ${x} still full`);

  const lines = rowsDone.length + colsDone.length;
  const delta = config.score.pointsPerPlacedCell * placed.size + config.score.pointsPerCompletedLine * lines;
  if (result.scoreDelta !== delta || after.score !== before.score + delta) fail('score delta mismatch');
  if (after.revision !== before.revision + 1 || result.moveId !== after.revision) fail('revision did not advance by one');

  // Tray: the consumed slot empties; others keep identity; refill only when all were consumed.
  const consumedTray = before.tray.map((s, i) => (i === choice.slot ? null : s));
  if (consumedTray.every((s) => s === null)) {
    const ids = after.tray.map((s) => s?.instanceId ?? -1);
    if (after.tray.some((s) => s === null) || new Set(ids).size !== ids.length || Math.min(...ids) < before.nextInstanceId)
      fail('refill did not deal a full tray of fresh instances');
    if (canonicalJson(after.generator) === canonicalJson(before.generator)) fail('refill did not advance the generator');
  } else {
    if (canonicalJson(after.tray) !== canonicalJson(consumedTray)) fail('tray changed beyond the consumed slot');
    if (after.generator !== before.generator) fail('generator changed without a refill');
  }
  const anyLegal = legalMoves(config, after).length > 0;
  if ((after.status === 'active') !== anyLegal) fail(`status ${after.status} but legal moves = ${anyLegal}`);
}
