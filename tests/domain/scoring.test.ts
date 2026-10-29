import { describe, expect, it } from 'vitest';
import { resolveClears } from '../../src/domain/clearing/clearing';
import type { BoardState, Cell, ScoreRules } from '../../src/domain/models/types';
import { applyPlacement, canPlace } from '../../src/domain/placement/placement';
import { addScore, scoreDelta } from '../../src/domain/scoring/scoring';
import { CLASSIC, board, emptyRows, shape } from './helpers';

/** Place, clear and score exactly as a committed move does. */
function play(before: BoardState, shapeId: string, anchor: Cell, rules: ScoreRules = CLASSIC.score) {
  const s = shape(shapeId);
  expect(canPlace(before, s, anchor)).toBe(true);
  const clear = resolveClears(applyPlacement(before, s, anchor));
  const lines = clear.completedRows.length + clear.completedColumns.length;
  return { delta: scoreDelta(rules, s.cells.length, lines), lines, cleared: clear.cleared.length };
}

const crossingRowAndColumn = board(
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
);
const crossingTwoByTwo = board(
  '....##....',
  '....##....',
  '####..####',
  '####..####',
  '....##....',
  '....##....',
  '....##....',
  '....##....',
  '....##....',
  '....##....',
);

describe('GDD 5.2 score examples with the classic rules (P + 10 x L)', () => {
  it('a four-cell shape without a clear scores 4', () => {
    expect(play(board(...emptyRows(10, 10)), 'square_2', [3, 3])).toEqual({ delta: 4, lines: 0, cleared: 0 });
  });

  it('a single cell finishing one row scores 11', () => {
    expect(play(board('#########.', ...emptyRows(10, 9)), 'single', [9, 0])).toEqual({ delta: 11, lines: 1, cleared: 10 });
  });

  it('a single cell finishing one row and one column scores 21 and removes 19 cells', () => {
    expect(play(crossingRowAndColumn, 'single', [2, 2])).toEqual({ delta: 21, lines: 2, cleared: 19 });
  });

  it('a 2x2 square finishing two rows and two columns scores 44 and removes 36 cells', () => {
    expect(play(crossingTwoByTwo, 'square_2', [4, 2])).toEqual({ delta: 44, lines: 4, cleared: 36 });
  });
});

describe('policy', () => {
  it('uses the configured values, with no multi-line multiplier', () => {
    expect(play(crossingTwoByTwo, 'square_2', [4, 2], { pointsPerPlacedCell: 2, pointsPerCompletedLine: 5 }).delta).toBe(28);
    expect(scoreDelta({ pointsPerPlacedCell: 0, pointsPerCompletedLine: 0 }, 9, 6)).toBe(0);
    // Linear in lines: 4 lines are worth exactly 4x one line.
    expect(scoreDelta(CLASSIC.score, 0, 4)).toBe(4 * scoreDelta(CLASSIC.score, 0, 1));
  });

  it('awards nothing for a preview: the placement query returns only a boolean', () => {
    expect(canPlace(crossingTwoByTwo, shape('square_2'), [3, 2])).toBe(false);
    expect(typeof canPlace(crossingTwoByTwo, shape('square_2'), [4, 2])).toBe('boolean');
  });

  it('detects overflow instead of rounding', () => {
    expect(addScore(10, 44)).toBe(54);
    expect(() => addScore(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
    expect(() => scoreDelta({ pointsPerPlacedCell: Number.MAX_SAFE_INTEGER, pointsPerCompletedLine: 0 }, 9, 0)).toThrow(RangeError);
  });
});
