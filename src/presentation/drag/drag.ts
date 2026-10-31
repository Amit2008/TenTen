// Direct drag of a tray piece onto the board (GDD 6.1). No DOM: the pointer adapter feeds it CSS client samples.
import { isInside } from '../../domain/board';
import { resolveClears } from '../../domain/clearing/clearing';
import type { Cell, GameplayConfig, PlacePiece, SessionState, ShapeDefinition } from '../../domain/models/types';
import { applyPlacement, canPlace, placementCells } from '../../domain/placement/placement';
import { cellAt, clientToLogical, slotGrid, type ClientBox, type GridLayout, type Point, type Rect, type TrayLayout } from '../views/layout';

export interface PointerSample {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly client: Point;
  /** The canvas bounding box at the time of this event. */
  readonly box: ClientBox;
}

export interface DragSettings {
  readonly config: GameplayConfig;
  readonly viewport: Rect;
  readonly board: GridLayout;
  readonly tray: TrayLayout;
  readonly dragThresholdCssPx: number;
  readonly touchLiftCssPx: number;
}

/** A read-only view of a placement query; drawing it can never change score or random state. */
export interface DragPreview {
  readonly slot: number;
  readonly shape: ShapeDefinition;
  /** Logical top-left of the floating shape's local (0,0) at board pitch. */
  readonly floating: Point;
  readonly anchor: Cell;
  readonly valid: boolean;
  /** Proposed cells that fall inside the board. */
  readonly cells: readonly Cell[];
  readonly completedRows: readonly number[];
  readonly completedColumns: readonly number[];
}

interface Active {
  readonly pointerId: number;
  readonly instanceId: number;
  readonly shape: ShapeDefinition;
  /** Shape-local cell under the pointer at pick time; it stays under the (lifted) pointer while dragging. */
  readonly grabbed: Cell;
  readonly start: Point;
  readonly touch: boolean;
  dragging: boolean;
}

/** One active pointer at a time; preview and release use the same offset, snapping and domain validator. */
export class DragController {
  #active: Active | null = null;

  constructor(
    private readonly settings: DragSettings,
    private readonly getState: () => SessionState,
    private readonly onPreview: (preview: DragPreview | null) => void,
    private readonly onCommit: (command: PlacePiece) => void,
  ) {}

  /** Claims the pointer when it lands on an occupied cell of a live tray piece. */
  down(sample: PointerSample): boolean {
    const state = this.getState();
    if (this.#active || state.status !== 'active') return false;
    const point = clientToLogical(sample.client, sample.box, this.settings.viewport);
    for (const [slot, instance] of state.tray.entries()) {
      if (!instance) continue;
      const shape = this.settings.config.catalog.find((s) => s.id === instance.shapeId)!;
      const local = cellAt(slotGrid(this.settings.tray, slot, shape), point);
      // Empty padding inside an L's bounding box cannot begin a drag.
      if (!local || !shape.cells.some(([x, y]) => x === local[0] && y === local[1])) continue;
      this.#active = {
        pointerId: sample.pointerId,
        instanceId: instance.instanceId,
        shape,
        grabbed: local,
        start: sample.client,
        touch: sample.pointerType === 'touch',
        dragging: false,
      };
      return true;
    }
    return false;
  }

  move(sample: PointerSample): void {
    const active = this.#own(sample);
    if (!active || !this.#pastThreshold(active, sample)) return;
    active.dragging = true;
    this.onPreview(this.#preview(active, sample));
  }

  /** Ends the gesture. Returns true when it was a drag, so the adapter can swallow the following click. */
  up(sample: PointerSample): boolean {
    const active = this.#own(sample);
    if (!active) return false;
    this.cancel();
    if (!this.#pastThreshold(active, sample)) return false;
    // Recompute from the release point and the current state; never reuse a stale preview.
    const preview = this.#preview(active, sample);
    const state = this.getState();
    if (preview?.valid)
      this.onCommit({
        type: 'PlacePiece',
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        instanceId: active.instanceId,
        anchor: preview.anchor,
      });
    return true;
  }

  /** Drops the gesture without consuming anything. Safe to call at any time. */
  cancel(): void {
    if (!this.#active) return;
    this.#active = null;
    this.onPreview(null);
  }

  #own(sample: PointerSample): Active | null {
    return this.#active?.pointerId === sample.pointerId ? this.#active : null;
  }

  #pastThreshold(active: Active, { client: [x, y] }: PointerSample): boolean {
    return active.dragging || Math.hypot(x - active.start[0], y - active.start[1]) >= this.settings.dragThresholdCssPx;
  }

  #preview(active: Active, sample: PointerSample): DragPreview | null {
    const state = this.getState();
    const slot = state.tray.findIndex((s) => s?.instanceId === active.instanceId);
    if (slot < 0) return null;
    const { board, viewport, touchLiftCssPx } = this.settings;
    // Touch lift is applied in CSS pixels, then converted with the same viewport mapping as the pointer itself.
    const [cx, cy] = sample.client;
    const [lx, ly] = clientToLogical(active.touch ? [cx, cy - touchLiftCssPx] : [cx, cy], sample.box, viewport);
    const [gx, gy] = active.grabbed;
    const { shape } = active;
    const anchor: Cell = [Math.floor((lx - board.x) / board.pitch) - gx, Math.floor((ly - board.y) / board.pitch) - gy];
    const valid = canPlace(state.board, shape, anchor);
    const clears = valid ? resolveClears(applyPlacement(state.board, shape, anchor)) : null;
    return {
      slot,
      shape,
      floating: [lx - (gx + 0.5) * board.pitch, ly - (gy + 0.5) * board.pitch],
      anchor,
      valid,
      cells: placementCells(shape, anchor).filter((c) => isInside(state.board, c)),
      completedRows: clears?.completedRows ?? [],
      completedColumns: clears?.completedColumns ?? [],
    };
  }
}
