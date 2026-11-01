import { describe, expect, it } from 'vitest';
import { createGenerator, scriptedPieceSource } from '../../src/application/piece-source/piece-source';
import { GameSession, startSession, type SessionRules } from '../../src/application/session/session';
import type { Cell, PlacePiece } from '../../src/domain/models/types';
import { DragController } from '../../src/presentation/drag/drag';
import { SelectionController } from '../../src/presentation/input_modes/selection';
import { boardLayout, cellOrigin, logicalToClient, slotGrid, trayLayout, viewportRect, type Point } from '../../src/presentation/views/layout';
import type { PlacementPreview } from '../../src/presentation/views/preview';
import { CLASSIC, shape } from '../domain/helpers';

const VIEWPORT = viewportRect([720, 960], [60, 190, 600, 600]);
const BOARD = boardLayout([60, 190, 600, 600], 10, 10);
const TRAY = trayLayout([60, 810, 600, 120], 3, CLASSIC.catalog);
const BOX = { left: 0, top: 100, width: 360, height: 415 };

/** Tray: corner_3_2 (3x3, empty local origin), bar_5_h, single; the same deal again on refill. */
function setup() {
  const ids = ['corner_3_2', 'bar_5_h', 'single'];
  const rules: SessionRules = { config: CLASSIC, gameplayHash: 'selection-test', source: scriptedPieceSource([...ids, ...ids]) };
  const session = new GameSession(rules, startSession(rules, 's', { ...createGenerator(1), state: 0 }));
  const previews: (PlacementPreview | null)[] = [];
  const commits: PlacePiece[] = [];
  const commit = (c: PlacePiece) => {
    commits.push(c);
    session.place(c);
    selection.refresh();
  };
  const selection = new SelectionController({ config: CLASSIC, board: BOARD, tray: TRAY }, () => session.state, (p) => previews.push(p), commit);
  return { session, selection, previews, commits, commit, last: () => previews.at(-1) };
}

/** Logical center of a board cell or of a tray slot's local cell. */
const boardPoint = (cell: Cell): Point => {
  const [x, y] = cellOrigin(BOARD, cell);
  return [x + 30, y + 30];
};
const slotPoint = (slot: number, shapeId: string, local: Cell): Point => {
  const grid = slotGrid(TRAY, slot, shape(shapeId));
  const [x, y] = cellOrigin(grid, local);
  return [x + grid.pitch / 2, y + grid.pitch / 2];
};
const filled = (s: ReturnType<typeof setup>['session']) =>
  s.state.board.cells.flatMap((t, i) => (t === null ? [] : [[i % 10, Math.floor(i / 10)]]));

describe('keyboard', () => {
  it('number keys select live slots; the first anchor is centered for the shape', () => {
    const { selection, last } = setup();
    expect(selection.key('1', false)).toBe(true);
    expect(last()).toMatchObject({ slot: 0, anchor: [3, 3], valid: true });
    expect(selection.key('2', false)).toBe(true);
    expect(last()).toMatchObject({ slot: 1, anchor: [3, 3] }); // anchor kept across selections
    expect(selection.key('4', false)).toBe(false); // beyond the tray size: not a puzzle key
  });

  it('arrows move the anchor and keep the bounding box on the board', () => {
    const { selection, last } = setup();
    expect(selection.key('ArrowLeft', false)).toBe(false); // nothing selected: the page may use the key
    selection.key('1', false);
    for (let i = 0; i < 12; i++) selection.key('ArrowRight', true); // held key repeats are fine for moving
    for (let i = 0; i < 12; i++) selection.key('ArrowDown', true);
    expect(last()!.anchor).toEqual([7, 7]);
    for (let i = 0; i < 12; i++) selection.key('ArrowLeft', false);
    selection.key('ArrowUp', false);
    expect(last()!.anchor).toEqual([0, 6]);
    selection.key('2', false); // bar_5_h is 5 wide: [0,6] stays legal
    for (let i = 0; i < 9; i++) selection.key('ArrowRight', false);
    expect(last()!.anchor).toEqual([5, 6]);
  });

  it('Enter commits once; a repeated Enter or Space never commits again', () => {
    const { selection, commits, session } = setup();
    selection.key('3', false);
    expect(selection.key('Enter', false)).toBe(true);
    expect(selection.key('Enter', true)).toBe(false); // selection is gone after the commit
    expect(commits).toHaveLength(1);
    selection.key('2', false);
    selection.key('ArrowDown', false); // the kept anchor [4,4] would overlap the single
    expect(selection.key(' ', true)).toBe(true); // a held Space is swallowed but ignored
    expect(commits).toHaveLength(1);
    expect(selection.key(' ', false)).toBe(true);
    expect(commits).toHaveLength(2);
    expect(session.state.revision).toBe(2);
  });

  it('Enter on an illegal anchor commits nothing and keeps the selection', () => {
    const { selection, commits, session, last } = setup();
    selection.key('3', false); // single, centered at [4,4]
    selection.key('Enter', false);
    selection.key('1', false); // corner_3_2 keeps the anchor [4,4]: covers (6,4),(6,5),(4,6),(5,6),(6,6)
    expect(last()).toMatchObject({ anchor: [4, 4], valid: true });
    selection.key('ArrowLeft', false);
    selection.key('ArrowLeft', false); // [2,4]: its local (2,0) lands on the single at (4,4)
    expect(last()).toMatchObject({ anchor: [2, 4], valid: false });
    expect(selection.key('Enter', false)).toBe(true);
    expect(commits).toHaveLength(1);
    expect(session.state.revision).toBe(1);
    expect(last()).toMatchObject({ slot: 0 });
  });

  it('Escape clears a selection; with nothing selected it is left for pause', () => {
    const { selection, last } = setup();
    expect(selection.key('Escape', false)).toBe(false);
    selection.key('1', false);
    expect(selection.key('Escape', false)).toBe(true);
    expect(last()).toBeNull();
  });
});

describe('tap and click', () => {
  it('a tap anywhere in a slot selects it, including empty L padding; tapping it again deselects', () => {
    const { selection, last } = setup();
    selection.tap(slotPoint(0, 'corner_3_2', [0, 0])); // empty origin of the L
    expect(last()).toMatchObject({ slot: 0 });
    selection.tap(slotPoint(0, 'corner_3_2', [2, 2]));
    expect(last()).toBeNull();
  });

  it('a board tap puts the bounding-box origin on the tapped cell even when that shape cell is empty', () => {
    const { selection, commits, session } = setup();
    selection.selectSlot(0);
    selection.tap(boardPoint([0, 0]));
    expect(commits.map((c) => c.anchor)).toEqual([[0, 0]]);
    expect(filled(session).sort()).toEqual([[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]].sort());
  });

  it('a board tap that puts the box off the board is shown invalid, never moved, and commits nothing', () => {
    const { selection, commits, last } = setup();
    selection.selectSlot(0);
    selection.tap(boardPoint([7, 8]));
    expect(last()).toMatchObject({ anchor: [7, 8], valid: false, cells: [[9, 8], [9, 9]] });
    expect(commits).toEqual([]);
  });

  it('board taps without a selection and taps on a used slot do nothing', () => {
    const { selection, previews, commits } = setup();
    selection.tap(boardPoint([4, 4]));
    selection.selectSlot(2);
    selection.tap(boardPoint([4, 4]));
    selection.tap(slotPoint(2, 'single', [0, 0])); // slot 3 is used now
    expect(commits).toHaveLength(1);
    expect(previews.at(-1)).toBeNull();
  });

  it('nothing is selectable after game over', () => {
    const { session } = setup();
    const over = { ...session.state, status: 'game_over' as const };
    const previews: unknown[] = [];
    const s = new SelectionController({ config: CLASSIC, board: BOARD, tray: TRAY }, () => over, (p) => previews.push(p), () => {});
    s.selectSlot(0);
    expect(s.key('1', false)).toBe(true);
    expect(previews).toEqual([]);
  });
});

describe('every input mode places the same cells for the same anchor', () => {
  const anchors: Cell[] = [[0, 0], [7, 0], [0, 7], [7, 7], [4, 2]];
  it.each(anchors)('corner_3_2 (empty origin) at [%i, %i]', (ax, ay) => {
    const anchor: Cell = [ax, ay];
    // Keyboard: select, walk the anchor there, Enter.
    const keys = setup();
    keys.selection.key('1', false);
    for (let i = 0; i < 10; i++) keys.selection.key('ArrowLeft', false), keys.selection.key('ArrowUp', false);
    for (let i = 0; i < ax; i++) keys.selection.key('ArrowRight', false);
    for (let i = 0; i < ay; i++) keys.selection.key('ArrowDown', false);
    keys.selection.key('Enter', false);
    // Tap/click: select the slot button, tap the anchor cell.
    const tap = setup();
    tap.selection.selectSlot(0);
    tap.selection.tap(boardPoint(anchor));
    // Drag: grab an occupied cell and drop it where that cell belongs.
    const drag = setup();
    const grabbed: Cell = [2, 0];
    const dc = new DragController(
      { config: CLASSIC, viewport: VIEWPORT, board: BOARD, tray: TRAY, dragThresholdCssPx: 6, touchLiftCssPx: 36 },
      () => drag.session.state,
      () => {},
      drag.commit,
    );
    const client = (p: Point) => ({ pointerId: 1, pointerType: 'mouse', box: BOX, client: logicalToClient(p, BOX, VIEWPORT) });
    dc.down(client(slotPoint(0, 'corner_3_2', grabbed)));
    dc.up(client(boardPoint([ax + grabbed[0], ay + grabbed[1]])));

    for (const mode of [keys, tap, drag]) expect(mode.commits.map((c) => c.anchor)).toEqual([anchor]);
    expect(filled(tap.session)).toEqual(filled(keys.session));
    expect(filled(drag.session)).toEqual(filled(keys.session));
    expect(filled(keys.session)).not.toContainEqual(anchor); // the origin cell itself stays empty
  });
});
