import type { BoardState, Cell, ShapeDefinition } from '../models/types';
import { canPlace } from '../placement/placement';

/**
 * First legal anchor for a shape in row-major order, or null. Brute force is enough (GDD 5.3): normalized shapes
 * can only fit with anchors in [0, columns - width] x [0, rows - height].
 */
export function findLegalAnchor(board: BoardState, shape: ShapeDefinition): Cell | null {
  for (let y = 0; y <= board.rows - shape.height; y++) {
    for (let x = 0; x <= board.columns - shape.width; x++) {
      if (canPlace(board, shape, [x, y])) return [x, y];
    }
  }
  return null;
}

/**
 * True while any live tray shape has a legal placement; consumed slots (null) do not participate. The run ends only
 * when this is false. One blocked shape is never by itself a game over.
 */
export function hasAnyLegalMove(board: BoardState, tray: readonly (ShapeDefinition | null)[]): boolean {
  return tray.some((shape) => shape !== null && findLegalAnchor(board, shape) !== null);
}
