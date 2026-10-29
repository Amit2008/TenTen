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
