import { describe, expect, it } from 'vitest';
import { createGenerator, scriptedPieceSource } from '../../src/application/piece-source/piece-source';
import { GameSession, startSession, type SessionRules } from '../../src/application/session/session';
import type { Cell, PlacePiece, SessionState } from '../../src/domain/models/types';
import { placementCells } from '../../src/domain/placement/placement';
import { DragController, type DragPreview, type PointerSample } from '../../src/presentation/drag/drag';
import {
  boardLayout,
  cellAt,
  cellOrigin,
  logicalToClient,
  slotGrid,
  trayLayout,
  viewportRect,
  type ClientBox,
  type Point,
} from '../../src/presentation/views/layout';
import { CLASSIC, shape } from '../domain/helpers';

const VIEWPORT = viewportRect([720, 960], [60, 190, 600, 600]);
const BOARD = boardLayout([60, 190, 600, 600], 10, 10);
const TRAY = trayLayout([60, 810, 600, 120], 3, CLASSIC.catalog);
const SETTINGS = { config: CLASSIC, viewport: VIEWPORT, board: BOARD, tray: TRAY, dragThresholdCssPx: 6, touchLiftCssPx: 36 };
// Canvas boxes at a 360x640 phone, a large desktop window and an odd letterboxed size. DPR never enters these.
const BOXES: ClientBox[] = [
  { left: 0, top: 100, width: 360, height: 415 },
  { left: 412.5, top: 64, width: 805, height: 928 },
  { left: 17.25, top: 3.5, width: 215, height: 248 },
];

/** Tray: corner_3_2 (empty local origin), bar_5_h, single; then a second identical deal. */
function setup(box: ClientBox = BOXES[0]!) {
  const ids = ['corner_3_2', 'bar_5_h', 'single'];
  const rules: SessionRules = { config: CLASSIC, gameplayHash: 'drag-test', source: scriptedPieceSource([...ids, ...ids]) };
  const session = new GameSession(rules, startSession(rules, 's', { ...createGenerator(1), state: 0 }));
  const previews: (DragPreview | null)[] = [];
  const commits: PlacePiece[] = [];
  const drag = new DragController(SETTINGS, () => session.state, (p) => previews.push(p), (c) => {
    commits.push(c);
    session.place(c);
  });
  const sample = (client: Point, pointerType = 'mouse', pointerId = 1): PointerSample => ({ pointerId, pointerType, client, box });
  /** Client point at the center of a tray piece's local cell. */
  const trayCell = (slot: number, local: Cell): Point => {
    const grid = slotGrid(TRAY, slot, shape(session.state.tray[slot]!.shapeId));
    const [x, y] = cellOrigin(grid, local);
    return logicalToClient([x + grid.pitch / 2, y + grid.pitch / 2], box, VIEWPORT);
  };
  /** Client point at the center of a board cell. */
  const boardCell = (cell: Cell): Point => {
    const [x, y] = cellOrigin(BOARD, cell);
    return logicalToClient([x + 30, y + 30], box, VIEWPORT);
  };
  return { session, drag, previews, commits, sample, trayCell, boardCell };
}

const occupied = (state: SessionState): Cell[] =>
  state.board.cells.flatMap((t, i) => (t === null ? [] : [[i % 10, Math.floor(i / 10)] as Cell]));

describe('picking', () => {
  it('drags from anywhere in a tray piece’s bounding box, empty L cells included; other presses are taps at most', () => {
    const { drag, sample, trayCell, boardCell, previews, commits } = setup();
    // The board: claimed, but moving never drags.
    expect(drag.down(sample(boardCell([4, 4])))).toBe(true);
    drag.move(sample(boardCell([5, 5])));
    expect(drag.up(sample(boardCell([5, 5])))).toBe(false);
    expect(previews).toEqual([]);
    expect(commits).toEqual([]);
    // corner_3_2's empty origin and the empty middle of the L both pick the piece up (T27).
    for (const start of [trayCell(0, [0, 0]), trayCell(0, [1, 1])]) {
      expect(drag.down(sample(start))).toBe(true);
      drag.move(sample(boardCell([5, 5])));
      expect(previews.at(-1)).toMatchObject({ slot: 0 });
      drag.cancel();
    }
  });

  it('reports a press that stays under the threshold as a tap at the release point', () => {
    const taps: Point[] = [];
    const { session, sample, boardCell } = setup();
    const drag = new DragController(SETTINGS, () => session.state, () => {}, () => {}, (p) => taps.push(p));
    const [x, y] = boardCell([3, 4]);
    drag.down(sample([x, y]));
    drag.up(sample([x + 2, y + 2]));
    expect(taps).toHaveLength(1);
    expect(cellAt(BOARD, taps[0]!)).toEqual([3, 4]);
  });

  it('ignores a second pointer while one is active', () => {
    const { drag, sample, trayCell, boardCell, commits } = setup();
    expect(drag.down(sample(trayCell(2, [0, 0]), 'touch', 1))).toBe(true);
    expect(drag.down(sample(trayCell(1, [0, 0]), 'touch', 2))).toBe(false);
    drag.move(sample(boardCell([3, 3]), 'touch', 2));
    expect(drag.up(sample(boardCell([3, 3]), 'touch', 2))).toBe(false);
    expect(commits).toEqual([]);
  });

  it('refuses to start after game over', () => {
    const { drag, sample, trayCell } = setup();
    const over = { ...setup().session.state, status: 'game_over' as const };
    const blocked = new DragController(SETTINGS, () => over, () => {}, () => {});
    expect(blocked.down(sample(trayCell(2, [0, 0])))).toBe(false);
    expect(drag.down(sample(trayCell(2, [0, 0])))).toBe(true);
  });
});

describe('threshold and taps', () => {
  it('a move under 6 CSS px shows no preview and release commits nothing', () => {
    const { drag, sample, trayCell, previews, commits } = setup();
    const [x, y] = trayCell(2, [0, 0]);
    drag.down(sample([x, y]));
    drag.move(sample([x + 3, y + 4.9]));
    expect(previews).toEqual([]);
    expect(drag.up(sample([x + 3, y + 4.9]))).toBe(false); // a tap: no click suppression either
    expect(commits).toEqual([]);
  });

  it('a fast flick with no move events still counts as a drag at release', () => {
    const { drag, sample, trayCell, boardCell, commits } = setup();
    drag.down(sample(trayCell(2, [0, 0])));
    expect(drag.up(sample(boardCell([5, 5])))).toBe(true);
    expect(commits.map((c) => c.anchor)).toEqual([[5, 5]]);
  });
});

describe('ghost and committed cells coincide', () => {
  const targets: [string, number, Cell, Cell][] = [
    // [name, slot, grabbed local cell, anchor]
    ['corner_3_2 top-left corner (empty origin)', 0, [2, 0], [0, 0]],
    ['corner_3_2 bottom-right corner', 0, [0, 2], [7, 7]],
    ['corner_3_2 grabbed by its empty origin', 0, [0, 0], [3, 3]],
    ['bar_5_h top-right edge', 1, [4, 0], [5, 0]],
    ['bar_5_h bottom-left edge', 1, [0, 0], [0, 9]],
    ['single bottom-right corner', 2, [0, 0], [9, 9]],
  ];
  for (const [b, box] of BOXES.entries())
    for (const pointerType of ['mouse', 'touch'])
      it.each(targets)(`%s (box ${b}, ${pointerType})`, (_, slot, grabbed, anchor) => {
        const { drag, sample, trayCell, boardCell, previews, commits, session } = setup(box);
        const shapeId = session.state.tray[slot]!.shapeId;
        const [x, y] = boardCell([anchor[0] + grabbed[0], anchor[1] + grabbed[1]]);
        // Touch: the finger sits 36 CSS px below the cell it shows; mouse: right on it.
        const client: Point = pointerType === 'touch' ? [x, y + 36] : [x, y];
        expect(drag.down(sample(trayCell(slot, grabbed), pointerType))).toBe(true);
        drag.move(sample(client, pointerType));
        const ghost = previews.at(-1)!;
        expect(ghost).toMatchObject({ slot, anchor, valid: true });
        expect(drag.up(sample(client, pointerType))).toBe(true);
        expect(previews.at(-1)).toBeNull();
        expect(commits).toHaveLength(1);
        expect(commits[0]!.anchor).toEqual(anchor);
        const placed = placementCells(shape(shapeId), anchor);
        expect(ghost.cells).toEqual(placed);
        expect(occupied(session.state).sort()).toEqual([...placed].sort());
      });

  it('touch lift is applied in CSS px: a 30 px lift on 30 px cells previews exactly one row higher than mouse', () => {
    const { session, sample, trayCell, boardCell } = setup(); // box 0: one board cell is 30 CSS px
    const anchors: Cell[] = [];
    for (const pointerType of ['mouse', 'touch']) {
      const d = new DragController({ ...SETTINGS, touchLiftCssPx: 30 }, () => session.state, (p) => p && anchors.push(p.anchor), () => {});
      d.down(sample(trayCell(2, [0, 0]), pointerType));
      d.move(sample(boardCell([4, 6]), pointerType));
    }
    expect(anchors).toEqual([[4, 6], [4, 5]]);
  });
});

describe('releases that must not consume a piece', () => {
  it('outside the board, partly off an edge, or onto occupied cells', () => {
    const { drag, sample, trayCell, boardCell, commits, previews, session } = setup();
    // Partly off the right edge: bar_5_h grabbed at its left end, dropped on column 7.
    drag.down(sample(trayCell(1, [0, 0])));
    drag.move(sample(boardCell([7, 3])));
    expect(previews.at(-1)).toMatchObject({ valid: false, anchor: [7, 3], cells: [[7, 3], [8, 3], [9, 3]] });
    expect(drag.up(sample(boardCell([7, 3])))).toBe(true);
    // Far outside the canvas (pointer capture still delivers the release).
    drag.down(sample(trayCell(1, [0, 0])));
    expect(drag.up(sample([-500, -500]))).toBe(true);
    expect(commits).toEqual([]);
    // Occupy (5,5), then try to drop the single on it.
    drag.down(sample(trayCell(2, [0, 0])));
    drag.up(sample(boardCell([5, 5])));
    const revision = session.state.revision;
    drag.down(sample(trayCell(0, [2, 2])));
    drag.up(sample(boardCell([5, 5])));
    expect(session.state.revision).toBe(revision);
    expect(commits).toHaveLength(1);
  });

  it('cancel drops the gesture; the later release is ignored', () => {
    const { drag, sample, trayCell, boardCell, commits, previews } = setup();
    drag.down(sample(trayCell(2, [0, 0])));
    drag.move(sample(boardCell([2, 2])));
    drag.cancel();
    expect(previews.at(-1)).toBeNull();
    drag.move(sample(boardCell([3, 3])));
    expect(drag.up(sample(boardCell([3, 3])))).toBe(false);
    expect(commits).toEqual([]);
    drag.cancel(); // idempotent
  });

  it('a piece consumed elsewhere during the drag is not submitted again', () => {
    const { drag, sample, trayCell, boardCell, commits, session } = setup();
    drag.down(sample(trayCell(2, [0, 0])));
    drag.move(sample(boardCell([1, 1])));
    const instanceId = session.state.tray[2]!.instanceId;
    session.place({ type: 'PlacePiece', sessionId: 's', expectedRevision: 0, instanceId, anchor: [8, 8] });
    expect(drag.up(sample(boardCell([1, 1])))).toBe(true);
    expect(commits).toEqual([]);
  });

  it('a release commits against the current revision', () => {
    const { drag, sample, trayCell, boardCell, commits, session } = setup();
    drag.down(sample(trayCell(2, [0, 0])));
    const dragged = session.state.tray[2]!.instanceId;
    const other = session.state.tray[1]!.instanceId;
    session.place({ type: 'PlacePiece', sessionId: 's', expectedRevision: 0, instanceId: other, anchor: [0, 0] });
    drag.up(sample(boardCell([3, 3])));
    expect(commits).toEqual([{ type: 'PlacePiece', sessionId: 's', expectedRevision: 1, instanceId: dragged, anchor: [3, 3] }]);
  });
});

describe('preview shows the lines a drop would clear', () => {
  it('reports the completed row without changing the session', () => {
    const { drag, sample, trayCell, boardCell, previews, session } = setup();
    // Fill row 9 columns 0-4 with bar_5_h, then preview the second bar_5_h on columns 5-9.
    drag.down(sample(trayCell(1, [0, 0])));
    drag.up(sample(boardCell([0, 9])));
    drag.down(sample(trayCell(2, [0, 0])));
    drag.up(sample(boardCell([0, 0])));
    drag.down(sample(trayCell(0, [2, 0])));
    drag.up(sample(boardCell([9, 0])));
    // New deal: corner_3_2, bar_5_h, single.
    const before = session.state;
    drag.down(sample(trayCell(1, [0, 0])));
    drag.move(sample(boardCell([5, 9])));
    expect(previews.at(-1)).toMatchObject({ valid: true, completedRows: [9], completedColumns: [] });
    expect(session.state).toBe(before);
  });
});
