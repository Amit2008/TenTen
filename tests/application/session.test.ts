import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createGenerator,
  scriptedPieceSource,
  weightedPieceSource,
  type PieceSource,
} from '../../src/application/piece-source/piece-source';
import { GameSession, placePiece, startSession, type SessionRules } from '../../src/application/session/session';
import { findLegalAnchor } from '../../src/domain/legal-moves/legal-moves';
import { canonicalJson } from '../../src/domain/models/gameplay-config';
import type { Cell, MoveResult, PlacePiece, SessionState } from '../../src/domain/models/types';
import { deepFreeze } from '../../src/domain/models/validation';
import { CLASSIC, board, render, shape } from '../domain/helpers';

const HASH = 'sha256:test';
const rulesWith = (source: PieceSource): SessionRules => ({ config: CLASSIC, gameplayHash: HASH, source });
const scripted = (...ids: string[]) => rulesWith(scriptedPieceSource(ids));
const scriptStart = () => ({ ...createGenerator(1), state: 0 });
const stateHash = (s: SessionState) => createHash('sha256').update(canonicalJson(s)).digest('hex').slice(0, 16);

function cmd(state: SessionState, slot: number, anchor: Cell, overrides: Partial<PlacePiece> = {}): PlacePiece {
  return {
    type: 'PlacePiece',
    sessionId: state.sessionId,
    expectedRevision: state.revision,
    instanceId: state.tray[slot]!.instanceId,
    anchor,
    ...overrides,
  };
}

function accepted(result: ReturnType<typeof placePiece>): MoveResult {
  if (!result.accepted) throw new Error(`rejected: ${result.reason}`);
  return result;
}

describe('startSession', () => {
  it('starts with an empty board, a full tray with unique instance ids, revision 0 and score 0', () => {
    const s = startSession(scripted('single', 'square_3', 'single', 'bar_2_h', 'bar_2_h', 'bar_2_h'), 'A', scriptStart());
    expect(s.board.cells.every((c) => c === null)).toBe(true);
    expect(s.tray).toEqual([
      { instanceId: 1, shapeId: 'single' },
      { instanceId: 2, shapeId: 'square_3' },
      { instanceId: 3, shapeId: 'single' },
    ]);
    expect([s.revision, s.score, s.status, s.nextInstanceId, s.generator.state]).toEqual([0, 0, 'active', 4, 3]);
    expect(Object.isFrozen(s.tray[0])).toBe(true);
  });
});

describe('placePiece transaction', () => {
  const rules = scripted('single', 'square_3', 'single', 'bar_2_h', 'bar_2_v', 'square_2', 'single', 'single', 'single');

  it('commits one move: places, scores, consumes only the selected slot, bumps the revision once', () => {
    const s0 = startSession(rules, 'A', scriptStart());
    const r = accepted(placePiece(rules, s0, cmd(s0, 1, [4, 4])));
    expect(r.moveId).toBe(1);
    expect(r.placed).toHaveLength(9);
    expect(r.scoreDelta).toBe(9);
    expect(r.consumedInstanceId).toBe(2);
    expect(r.dealt).toEqual([]);
    expect(r.state.revision).toBe(1);
    expect(r.state.score).toBe(9);
    // Other slots keep their identity and position.
    expect(r.state.tray).toEqual([s0.tray[0], null, s0.tray[2]]);
    expect(render(r.state.board).slice(4, 7)).toEqual(['....###...', '....###...', '....###...']);
    expect(r.state.generator).toEqual(s0.generator);
  });

  it('refills exactly once, only after all slots are consumed, with fresh instance ids', () => {
    const session = new GameSession(rules, startSession(rules, 'A', scriptStart()));
    const dealtPerMove: number[] = [];
    for (const [slot, anchor] of [[0, [0, 0]], [1, [5, 5]], [2, [9, 9]]] as const) {
      dealtPerMove.push(accepted(session.place(cmd(session.state, slot, anchor))).dealt.length);
    }
    expect(dealtPerMove).toEqual([0, 0, 3]);
    expect(session.state.tray).toEqual([
      { instanceId: 4, shapeId: 'bar_2_h' },
      { instanceId: 5, shapeId: 'bar_2_v' },
      { instanceId: 6, shapeId: 'square_2' },
    ]);
    expect(session.state.generator.state).toBe(6);
    expect(session.state.nextInstanceId).toBe(7);
  });

  it('clears rows and columns, scores lines, and leaves no full line', () => {
    const lineRules = scripted('single', 'bar_2_h', 'bar_2_h');
    const start = startSession(lineRules, 'A', scriptStart());
    // Row 2 and column 2 are complete except (2,2).
    const setup: SessionState = deepFreeze({
      ...start,
      board: board(
        '..#.......',
        '..#.......',
        '##.#######',
        '..#.......',
        '..#.......',
        '..#.......',
        '..#.......',
        '..#.......',
        '..#.......',
        '..#.......',
      ),
    });
    const r = accepted(placePiece(lineRules, setup, cmd(setup, 0, [2, 2])));
    expect([r.completedRows, r.completedColumns, r.cleared.length, r.scoreDelta]).toEqual([[2], [2], 19, 21]);
    expect(r.state.board.cells.every((c) => c === null)).toBe(true);
    const occupied = (s: SessionState) => s.board.cells.filter((c) => c !== null).length;
    expect(occupied(r.state)).toBe(occupied(setup) + r.placed.length - r.cleared.length);
  });

  it('detects a completely blocked fresh tray immediately and then rejects further moves', () => {
    // Placing the last single fills (0,0); no line completes; the refill of three square_3 cannot fit anywhere.
    const blockRules = scripted('single', 'square_3', 'square_3', 'square_3', 'square_3', 'square_3');
    const start = startSession(blockRules, 'A', scriptStart());
    const crowded: SessionState = deepFreeze({
      ...start,
      tray: [start.tray[0]!, null, null],
      board: board(
        '.#.#.#.#.#',
        '#.#.#.#.#.',
        '.#.#.#.#.#',
        '#.#.#.#.#.',
        '.#.#.#.#.#',
        '#.#.#.#.#.',
        '.#.#.#.#.#',
        '#.#.#.#.#.',
        '.#.#.#.#.#',
        '#.#.#.#.#.',
      ),
    });
    const r = accepted(placePiece(blockRules, crowded, cmd(crowded, 0, [0, 0])));
    expect(r.dealt.map((d) => d.shapeId)).toEqual(['square_3', 'square_3', 'square_3']);
    expect(r.status).toBe('game_over');
    expect(r.state.status).toBe('game_over');
    expect(placePiece(blockRules, r.state, cmd(r.state, 0, [0, 0]))).toEqual({ accepted: false, reason: 'game_over' });
  });

  it('one blocked slot does not end the run while another slot fits', () => {
    const r2 = scripted('single', 'square_3', 'single');
    const start = startSession(r2, 'A', scriptStart());
    const tight: SessionState = deepFreeze({
      ...start,
      // Column 2 is free, plus a 2x2 hole at the bottom: square_3 cannot fit, single can.
      board: board(...Array.from({ length: 10 }, (_, y) => (y < 8 ? '##.#######' : '##..######'))),
    });
    expect(findLegalAnchor(tight.board, shape('square_3'))).toBeNull();
    const r = accepted(placePiece(r2, tight, cmd(tight, 0, [2, 0])));
    expect(r.status).toBe('active');
  });
});

describe('rejections have no effects', () => {
  const rules = scripted('single', 'square_3', 'bar_5_h', 'single', 'single', 'single');
  const s0 = startSession(rules, 'A', scriptStart());
  const s1 = accepted(placePiece(rules, s0, cmd(s0, 1, [0, 0]))).state;

  it.each([
    ['stale_session', cmd(s1, 0, [9, 9], { sessionId: 'B' })],
    ['stale_revision', cmd(s1, 0, [9, 9], { expectedRevision: 0 })],
    ['unknown_slot (consumed)', cmd(s1, 0, [9, 9], { instanceId: s0.tray[1]!.instanceId })],
    ['unknown_slot (never dealt)', cmd(s1, 0, [9, 9], { instanceId: 999 })],
    ['illegal_placement (overlap)', cmd(s1, 0, [1, 1])],
    ['illegal_placement (outside)', cmd(s1, 2, [6, 0])],
    ['illegal_placement (negative)', cmd(s1, 0, [-1, 0])],
    ['illegal_placement (fractional)', cmd(s1, 0, [0.5, 4])],
  ] as const)('%s', (label, command) => {
    const session = new GameSession(rules, s1);
    const before = stateHash(session.state);
    const result = session.place(command);
    expect(result).toEqual({ accepted: false, reason: label.split(' ')[0] });
    expect(session.state).toBe(s1);
    expect(stateHash(session.state)).toBe(before);
  });

  it('a duplicate command cannot double-score, double-deal or double-consume', () => {
    const session = new GameSession(rules, s0);
    const command = cmd(s0, 0, [9, 9]);
    expect(session.place(command).accepted).toBe(true);
    const after = session.state;
    expect(session.place(command)).toEqual({ accepted: false, reason: 'stale_revision' });
    expect(session.place({ ...command, expectedRevision: after.revision })).toEqual({ accepted: false, reason: 'unknown_slot' });
    expect(session.state).toBe(after);
    expect(after.score).toBe(1);
  });

  it("a delayed command from a previous session cannot consume the new session's slot with the same id", () => {
    const fresh = new GameSession(rules, startSession(rules, 'B', scriptStart()));
    const old = cmd(s0, 0, [9, 9]); // instance id 1 exists in both sessions
    expect(fresh.state.tray[0]!.instanceId).toBe(old.instanceId);
    expect(fresh.place(old)).toEqual({ accepted: false, reason: 'stale_session' });
    expect(fresh.state.revision).toBe(0);
  });

  it('rejected commands leave the generator exactly where it was', () => {
    const weighted = rulesWith(weightedPieceSource);
    const session = new GameSession(weighted, startSession(weighted, 'W', createGenerator(42)));
    const generator = session.state.generator;
    for (let i = 0; i < 50; i++) session.place(cmd(session.state, 0, [-3, -3]));
    expect(session.state.generator).toBe(generator);
    expect(session.state.revision).toBe(0);
  });
});

describe('determinism with the production generator', () => {
  /** Plays the first legal anchor of the first fitting slot until game over or `limit` moves. */
  function autoplay(seed: number, limit: number) {
    const rules = rulesWith(weightedPieceSource);
    const session = new GameSession(rules, startSession(rules, `seed-${seed}`, createGenerator(seed)));
    const trace: string[] = [];
    while (session.state.status === 'active' && session.state.revision < limit) {
      const { state } = session;
      const slot = state.tray.findIndex((s) => s && findLegalAnchor(state.board, shape(s.shapeId)));
      const anchor = findLegalAnchor(state.board, shape(state.tray[slot]!.shapeId))!;
      const r = accepted(session.place(cmd(state, slot, anchor)));
      trace.push(`${r.moveId} ${state.tray[slot]!.shapeId}@${anchor} +${r.scoreDelta} = ${r.state.score} ${stateHash(r.state)}`);
    }
    return { trace, final: session.state };
  }

  it('identical seed and commands give identical state hashes', () => {
    const a = autoplay(12345, 400);
    const b = autoplay(12345, 400);
    expect(a.trace).toEqual(b.trace);
    expect(a.final.status).toBe('game_over');
    console.log(`seed 12345 greedy run: ${a.trace.length} moves, score ${a.final.score}, final ${stateHash(a.final)}`);
    console.log(a.trace.slice(0, 5).join('\n'));
  });
});
