import { isInside } from '../../domain/board';
import { resolveClears } from '../../domain/clearing/clearing';
import type { Cell, SessionState, ShapeDefinition } from '../../domain/models/types';
import { applyPlacement, canPlace, placementCells } from '../../domain/placement/placement';

/** A read-only view of a placement query; drawing it can never change score or random state. */
export interface PlacementPreview {
  readonly slot: number;
  readonly shape: ShapeDefinition;
  /** Board cell for the shape's bounding-box origin, which may be an empty cell of the shape. */
  readonly anchor: Cell;
  readonly valid: boolean;
  /** Proposed cells that fall inside the board. */
  readonly cells: readonly Cell[];
  readonly completedRows: readonly number[];
  readonly completedColumns: readonly number[];
}

/** Every input mode previews through this, with the same domain validator the move transaction uses. */
export function placementPreview(state: SessionState, slot: number, shape: ShapeDefinition, anchor: Cell): PlacementPreview {
  const valid = canPlace(state.board, shape, anchor);
  const clears = valid ? resolveClears(applyPlacement(state.board, shape, anchor)) : null;
  return {
    slot,
    shape,
    anchor,
    valid,
    cells: placementCells(shape, anchor).filter((c) => isInside(state.board, c)),
    completedRows: clears?.completedRows ?? [],
    completedColumns: clears?.completedColumns ?? [],
  };
}
