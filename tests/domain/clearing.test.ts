import { describe, expect, it } from 'vitest';
import { resolveClears } from '../../src/domain/clearing/clearing';
import type { BoardState } from '../../src/domain/models/types';
import { board, render } from './helpers';

const occupied = (b: BoardState) => b.cells.filter((t) => t !== null).length;

function expectOccupancyInvariant(before: BoardState) {
  const result = resolveClears(before);
  expect(occupied(result.board)).toBe(occupied(before) - result.cleared.length);
  return result;
}

describe('simultaneous clears on the 10x10 board', () => {
  it('one row crossing one column removes 19 unique cells and counts 2 lines', () => {
    const before = board(
      '..A.......',
      '..B.......',
      'CDEFGHIJKL',
      '..M.......',
      '..N.......',
      '..O....x..',
      '..P.......',
      '..Q.......',
      '..R.......',
      '..S.......',
    );
    const result = expectOccupancyInvariant(before);
    expect(result.completedRows).toEqual([2]);
    expect(result.completedColumns).toEqual([2]);
    expect(result.cleared).toHaveLength(19);
    expect(render(result.board)).toEqual([
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '.......x..',
      '..........',
      '..........',
      '..........',
      '..........',
    ]);
  });

  it('two rows crossing two columns removes 36 unique cells and counts 4 lines', () => {
    const before = board(
      '....##....',
      '..a.##....',
      '##########',
      '##########',
      '....##..b.',
      '....##....',
      '....##....',
      '.c..##....',
      '....##...d',
      '....##....',
    );
    const result = expectOccupancyInvariant(before);
    expect(result.completedRows).toEqual([2, 3]);
    expect(result.completedColumns).toEqual([4, 5]);
    expect(result.cleared).toHaveLength(36);
    expect(new Set(result.cleared.map(String)).size).toBe(36);
    expect(render(result.board)).toEqual([
      '..........',
      '..a.......',
      '..........',
      '..........',
      '........b.',
      '..........',
      '..........',
      '.c........',
      '.........d',
      '..........',
    ]);
  });

  it('a full board clears all 20 lines and all 100 cells', () => {
    const result = expectOccupancyInvariant(board(...Array<string>(10).fill('#'.repeat(10))));
    expect(result.completedRows).toHaveLength(10);
    expect(result.completedColumns).toHaveLength(10);
    expect(result.cleared).toHaveLength(100);
    expect(result.board.cells.every((t) => t === null)).toBe(true);
  });
});

describe('what does not happen', () => {
  it('no partial clear: a row with one gap stays, and same-colored tiles do not match', () => {
    const before = board('aaaaaaaaa.', 'bbbbbbbbbb', 'a.........', 'a.........', '..........');
    const result = resolveClears(before);
    expect(result.completedRows).toEqual([1]);
    expect(result.completedColumns).toEqual([]);
    expect(render(result.board)).toEqual(['aaaaaaaaa.', '..........', 'a.........', 'a.........', '..........']);
  });

  it('no gravity: cells above and below a cleared row keep their exact positions', () => {
    const before = board('x....', '#####', '....y', '.z...', '#####');
    expect(render(resolveClears(before).board)).toEqual(['x....', '.....', '....y', '.z...', '.....']);
  });

  it('no cascade: one call detects lines once, and the result has no full line left', () => {
    const before = board('#####', '####.', '#####', '####.', '####.');
    const result = resolveClears(before);
    expect(result.completedRows).toEqual([0, 2]);
    expect(result.completedColumns).toEqual([0, 1, 2, 3]);
    const again = resolveClears(result.board);
    expect([again.completedRows, again.completedColumns]).toEqual([[], []]);
  });

  it('no lines: returns the same board and nothing cleared', () => {
    const before = board('#....', '.#...', '..#..', '...#.', '....#');
    const result = resolveClears(before);
    expect(result.board).toBe(before);
    expect(result.cleared).toEqual([]);
  });
});

describe('rectangular boards and purity', () => {
  it('handles different row and column lengths and leaves the frozen input untouched', () => {
    const before = board(
      '#######',
      '..#....',
      '..#..a.',
      '..#....',
      '..#....',
    );
    const snapshot = JSON.stringify(before);
    const result = expectOccupancyInvariant(before);
    expect(result.completedRows).toEqual([0]);
    expect(result.completedColumns).toEqual([2]);
    expect(result.cleared).toHaveLength(7 + 5 - 1);
    expect(render(result.board)).toEqual(['.......', '.......', '.....a.', '.......', '.......']);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
