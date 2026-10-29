import { isInside, tileAt } from '../board';
import type { BoardState, Cell, ShapeDefinition } from '../models/types';

/** Board cells a shape would cover with its bounding-box origin at `anchor`. */
export function placementCells(shape: ShapeDefinition, [ax, ay]: Cell): Cell[] {
  return shape.cells.map(([x, y]) => [ax + x, ay + y]);
}

/**
 * The single placement rule shared by preview and commit (GDD 4.3): every shape cell must lie inside the board
 * and be empty. Out-of-bounds shapes are never clamped; one blocked cell rejects the whole placement.
 */
export function canPlace(board: BoardState, shape: ShapeDefinition, anchor: Cell): boolean {
  return placementCells(shape, anchor).every((cell) => isInside(board, cell) && tileAt(board, cell) === null);
}

/** New board with the shape's cells filled by its tile key. Callers must check canPlace first. */
export function applyPlacement(board: BoardState, shape: ShapeDefinition, anchor: Cell): BoardState {
  const cells = board.cells.slice();
  for (const [x, y] of placementCells(shape, anchor)) cells[y * board.columns + x] = shape.id;
  return { columns: board.columns, rows: board.rows, cells };
}
