import { describe, expect, it } from 'vitest';
import { canPlace, placementCells } from '../../src/domain/placement/placement';
import type { Cell } from '../../src/domain/models/types';
import { CLASSIC, board, emptyRows, shape } from './helpers';

const empty = board(...emptyRows(10, 10));

describe('canPlace on every catalog shape at the borders', () => {
  it.each(CLASSIC.catalog.map((s) => [s.id, s] as const))('%s', (_id, s) => {
    const maxX = 10 - s.width;
    const maxY = 10 - s.height;
    const legal: Cell[] = [[0, 0], [maxX, 0], [0, maxY], [maxX, maxY]];
    const illegal: Cell[] = [[-1, 0], [0, -1], [maxX + 1, 0], [0, maxY + 1], [maxX + 1, maxY + 1], [-1, -1], [100, 100]];
    for (const anchor of legal) expect(canPlace(empty, s, anchor), `legal ${anchor}`).toBe(true);
    for (const anchor of illegal) expect(canPlace(empty, s, anchor), `illegal ${anchor}`).toBe(false);
  });

  it('agrees with an independent count of legal anchors on the empty board', () => {
    for (const s of CLASSIC.catalog) {
      let count = 0;
      for (let y = -5; y < 15; y++) for (let x = -5; x < 15; x++) if (canPlace(empty, s, [x, y])) count++;
      expect(count, s.id).toBe((10 - s.width + 1) * (10 - s.height + 1));
    }
  });
});

describe('overlap', () => {
  it.each(CLASSIC.catalog.map((s) => [s.id, s] as const))('%s: any single occupied target cell rejects the whole placement', (_id, s) => {
    const anchor: Cell = [3, 2];
    for (const [x, y] of placementCells(s, anchor)) {
      const rows = emptyRows(10, 10);
      rows[y] = rows[y]!.slice(0, x) + '#' + rows[y]!.slice(x + 1);
      expect(canPlace(board(...rows), s, anchor)).toBe(false);
    }
  });

  it('cells next to the shape do not block it', () => {
    const b = board(
      '#####',
      '#...#',
      '#...#',
      '#...#',
      '#####',
    );
    expect(canPlace(b, shape('square_3'), [1, 1])).toBe(true);
    expect(canPlace(b, shape('square_3'), [1, 0])).toBe(false);
  });
});

describe('empty local origin', () => {
  // corner_2_2 is .X / XX: its (0,0) cell is empty, so the anchor cell itself may be occupied.
  const corner = shape('corner_2_2');

  it('uses the bounding-box origin as the anchor', () => {
    expect(placementCells(corner, [4, 4])).toEqual([[5, 4], [4, 5], [5, 5]]);
  });

  it('may sit with its empty origin over an occupied cell', () => {
    expect(canPlace(board('#.', '..'), corner, [0, 0])).toBe(true);
  });

  it('still rejects negative anchors even though only an empty corner would be outside', () => {
    // Anchor (-1,0): local (0,0) would be outside, but it is not a shape cell; (0,1)->(-1,1) is a cell, so reject.
    expect(canPlace(board(...emptyRows(5, 5)), corner, [-1, 0])).toBe(false);
    // corner_3_2 has an empty top-left 2x2 area; anchor (0,-1) puts only cell (2,0)->(2,-1) outside.
    expect(canPlace(board(...emptyRows(5, 5)), shape('corner_3_2'), [0, -1])).toBe(false);
  });
});

describe('purity', () => {
  it('leaves the frozen board and shape untouched and rejects non-integer anchors', () => {
    const b = board('.#..', '....', '....', '....');
    const before = JSON.stringify(b);
    const s = shape('bar_2_h');
    expect(canPlace(b, s, [2, 0])).toBe(true);
    expect(canPlace(b, s, [1, 0])).toBe(false);
    expect(canPlace(b, s, [0.5, 1])).toBe(false);
    expect(canPlace(b, s, [Number.NaN, 1])).toBe(false);
    expect(JSON.stringify(b)).toBe(before);
    expect(Object.isFrozen(b.cells) && Object.isFrozen(s.cells)).toBe(true);
  });
});
