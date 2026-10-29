import type { BoardState, Cell, TileKey } from './models/types';

export function isInside(board: BoardState, [x, y]: Cell): boolean {
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) && x >= 0 && y >= 0 && x < board.columns && y < board.rows;
}

/** Tile at an in-bounds cell; callers check bounds first. */
export function tileAt(board: BoardState, [x, y]: Cell): TileKey | null {
  return board.cells[y * board.columns + x] ?? null;
}
