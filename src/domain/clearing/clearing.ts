import type { BoardState, Cell } from '../models/types';

export interface ClearResult {
  readonly board: BoardState;
  readonly completedRows: readonly number[];
  readonly completedColumns: readonly number[];
  /** Unique removed cells in row-major order; a row/column intersection appears once. */
  readonly cleared: readonly Cell[];
}

/**
 * Clears every full row and column at once (GDD 5.1). All lines are detected on the input board before any cell
 * changes, so clearing a row can never hide a crossing column. No gravity, no cascade, no color matching.
 */
export function resolveClears(board: BoardState): ClearResult {
  const { columns, rows, cells } = board;
  const filled = (x: number, y: number): boolean => cells[y * columns + x] !== null;
  const completedRows: number[] = [];
  const completedColumns: number[] = [];
  for (let y = 0; y < rows; y++) {
    let full = true;
    for (let x = 0; x < columns && full; x++) full = filled(x, y);
    if (full) completedRows.push(y);
  }
  for (let x = 0; x < columns; x++) {
    let full = true;
    for (let y = 0; y < rows && full; y++) full = filled(x, y);
    if (full) completedColumns.push(x);
  }
  if (completedRows.length === 0 && completedColumns.length === 0) {
    return { board, completedRows, completedColumns, cleared: [] };
  }

  const clearedRows = new Set(completedRows);
  const clearedColumns = new Set(completedColumns);
  const next = cells.slice();
  const cleared: Cell[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      if (clearedRows.has(y) || clearedColumns.has(x)) {
        next[y * columns + x] = null;
        cleared.push([x, y]);
      }
    }
  }
  return { board: { columns, rows, cells: next }, completedRows, completedColumns, cleared };
}
