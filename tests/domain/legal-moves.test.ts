import { describe, expect, it } from 'vitest';
import { findLegalAnchor, hasAnyLegalMove } from '../../src/domain/legal-moves/legal-moves';
import type { BoardState, ShapeDefinition } from '../../src/domain/models/types';
import { CLASSIC, board, emptyRows, shape } from './helpers';

/** Independent enumerator: does not use canPlace, and also scans anchors left of and above the board. */
function referenceFits(b: BoardState, s: ShapeDefinition): boolean {
  for (let ay = -5; ay < b.rows; ay++) {
    for (let ax = -5; ax < b.columns; ax++) {
      let ok = true;
      for (const [cx, cy] of s.cells) {
        const x = ax + cx;
        const y = ay + cy;
        if (x < 0 || y < 0 || x >= b.columns || y >= b.rows || b.cells[y * b.columns + x] !== null) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
  }
  return false;
}

const fromMask = (columns: number, rows: number, mask: number): BoardState => ({
  columns,
  rows,
  cells: Array.from({ length: columns * rows }, (_, i) => ((mask >> i) & 1 ? '#' : null)),
});

describe('game-over rule', () => {
  // Only one 1x1 hole at (9,9); everything else is full except where noted.
  const nearlyFull = board(
    '##########',
    '##########',
    '##########',
    '##########',
    '##########',
    '##########',
    '##########',
    '##########',
    '##########',
    '#########.',
  );

  it('one blocked slot plus one legal slot keeps the game active', () => {
    expect(hasAnyLegalMove(nearlyFull, [shape('square_3'), shape('single')])).toBe(true);
    expect(findLegalAnchor(nearlyFull, shape('single'))).toEqual([9, 9]);
  });

  it('a fully blocked tray ends the run', () => {
    expect(hasAnyLegalMove(nearlyFull, [shape('square_3'), shape('bar_2_h'), shape('corner_2_0')])).toBe(false);
  });

  it('consumed slots do not participate', () => {
    expect(hasAnyLegalMove(nearlyFull, [null, shape('square_2'), null])).toBe(false);
    expect(hasAnyLegalMove(nearlyFull, [null, null, shape('single')])).toBe(true);
    expect(hasAnyLegalMove(nearlyFull, [null, null, null])).toBe(false);
  });

  it('enough empty area does not imply a fit', () => {
    // 15 empty cells in a checkerboard-ish pattern, yet no 2-cell bar fits anywhere.
    const scattered = board(
      '#.#.#',
      '.#.#.',
      '#.#.#',
      '.#.#.',
      '#.#.#',
    );
    expect(scattered.cells.filter((c) => c === null).length).toBeGreaterThanOrEqual(10);
    expect(hasAnyLegalMove(scattered, [shape('bar_2_h'), shape('bar_2_v'), shape('square_2')])).toBe(false);
    expect(hasAnyLegalMove(scattered, [shape('bar_2_h'), shape('single')])).toBe(true);
  });

  it('every catalog shape fits the empty board, starting at (0,0)', () => {
    const empty = board(...emptyRows(10, 10));
    for (const s of CLASSIC.catalog) expect(findLegalAnchor(empty, s), s.id).toEqual([0, 0]);
  });

  it('finds a fit in the last possible anchor', () => {
    const b = board(
      '##########',
      '##########',
      '##########',
      '##########',
      '##########',
      '##########',
      '##########',
      '#######...',
      '#######...',
      '#######...',
    );
    expect(findLegalAnchor(b, shape('square_3'))).toEqual([7, 7]);
    expect(findLegalAnchor(b, shape('bar_4_h'))).toBeNull();
  });
});

describe('exhaustive comparison with the independent enumerator', () => {
  it('every 4x4 board (65,536) agrees for all 19 shapes', () => {
    let fits = 0;
    let checks = 0;
    for (let mask = 0; mask < 1 << 16; mask++) {
      const b = fromMask(4, 4, mask);
      for (const s of CLASSIC.catalog) {
        const expected = referenceFits(b, s);
        if ((findLegalAnchor(b, s) !== null) !== expected) throw new Error(`mismatch ${s.id} mask ${mask}`);
        checks++;
        if (expected) fits++;
      }
    }
    console.log(`4x4 exhaustive: ${checks} board/shape checks, ${fits} fit, ${checks - fits} blocked`);
    expect(checks).toBe(65_536 * 19);
  }, 60_000);

  it('every 5x5 board with at most 6 empty cells agrees for three-shape trays', () => {
    // Sparse-empty boards are where game-over decisions are made.
    const cells = 25;
    let boards = 0;
    let terminal = 0;
    const tray = [shape('corner_2_1'), shape('bar_3_v'), shape('bar_2_h')];
    const visit = (start: number, empties: number[]) => {
      const cellsArray: (string | null)[] = Array<string | null>(cells).fill('#');
      for (const i of empties) cellsArray[i] = null;
      const b: BoardState = { columns: 5, rows: 5, cells: cellsArray };
      const expected = tray.some((s) => referenceFits(b, s));
      if (hasAnyLegalMove(b, tray) !== expected) throw new Error(`mismatch at empties ${empties}`);
      boards++;
      if (!expected) terminal++;
      if (empties.length === 6) return;
      for (let i = start; i < cells; i++) visit(i + 1, [...empties, i]);
    };
    visit(0, []);
    console.log(`5x5 sparse: ${boards} boards, ${terminal} terminal for [corner_2_1, bar_3_v, bar_2_h]`);
    expect(boards).toBe(1 + 25 + 300 + 2300 + 12650 + 53130 + 177100);
  }, 60_000);
});
