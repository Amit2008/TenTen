// Direct drag of a tray piece onto the board (GDD 6.1). No DOM: the pointer adapter feeds it CSS client samples.
import type { Cell, GameplayConfig, PlacePiece, SessionState, ShapeDefinition } from '../../domain/models/types';
import { clientToLogical, slotGrid, type ClientBox, type GridLayout, type Point, type Rect, type TrayLayout } from '../views/layout';
import { placementPreview, type PlacementPreview } from '../views/preview';

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

export interface DragPreview extends PlacementPreview {
  /** Logical top-left of the floating shape's local (0,0) at board pitch. */
  readonly floating: Point;
}

interface Pick {
  readonly instanceId: number;
  readonly shape: ShapeDefinition;
  /** Shape-local cell under the pointer at pick time; it stays under the (lifted) pointer while dragging. */
  readonly grabbed: Cell;
}

interface Active {
  readonly pointerId: number;
  /** Null when the press did not land in a tray piece's pickup area: it can still be a tap, never a drag. */
  readonly pick: Pick | null;
  readonly start: Point;
  readonly touch: boolean;
  dragging: boolean;
}

/**
 * One active pointer at a time. A press that moves less than the threshold is a tap, reported as a logical point.
 * A press in a tray piece's pickup area (see #pick) that moves further is a drag; preview and release use the same offset, snapping
 * and domain validator.
 */
export class DragController {
  #active: Active | null = null;

  constructor(
    private readonly settings: DragSettings,
    private readonly getState: () => SessionState,
    private readonly onPreview: (preview: DragPreview | null) => void,
    private readonly onCommit: (command: PlacePiece) => void,
    private readonly onTap: (point: Point) => void = () => {},
  ) {}

  get dragging(): boolean {
    return this.#active?.dragging ?? false;
  }

  /** Claims the pointer while the run is active and no other pointer is. */
  down(sample: PointerSample): boolean {
    const state = this.getState();
    if (this.#active || state.status !== 'active') return false;
    this.#active = {
      pointerId: sample.pointerId,
      pick: this.#pick(state, clientToLogical(sample.client, sample.box, this.settings.viewport)),
      start: sample.client,
      touch: sample.pointerType === 'touch',
      dragging: false,
    };
    return true;
  }

  move(sample: PointerSample): void {
    const active = this.#own(sample);
    if (!active?.pick || !this.#pastThreshold(active, sample)) return;
    active.dragging = true;
    this.onPreview(this.#preview(active.pick, active.touch, sample));
  }

  /** Ends the gesture. Returns true when it was a drag, so the adapter can swallow the following click. */
  up(sample: PointerSample): boolean {
    const active = this.#own(sample);
    if (!active) return false;
    this.cancel();
    if (!this.#pastThreshold(active, sample)) {
      this.onTap(clientToLogical(sample.client, sample.box, this.settings.viewport));
      return false;
    }
    if (!active.pick) return false;
    // Recompute from the release point and the current state; never reuse a stale preview.
    const preview = this.#preview(active.pick, active.touch, sample);
    const state = this.getState();
    if (preview?.valid)
      this.onCommit({
        type: 'PlacePiece',
        sessionId: state.sessionId,
        expectedRevision: state.revision,
        instanceId: active.pick.instanceId,
        anchor: preview.anchor,
      });
    return true;
  }

  /** Drops the gesture without consuming anything. Safe to call at any time. */
  cancel(): void {
    if (!this.#active) return;
    const wasDragging = this.#active.dragging;
    this.#active = null;
    if (wasDragging) this.onPreview(null);
  }

  /**
   * Each slot's whole column below the board picks its piece up (T27 and T29, Amit): the slot's width (the outer slots
   * reach the canvas edges) from the board's bottom edge to the canvas bottom. The grabbed cell is the shape's
   * bounding-box cell nearest the press, possibly empty; the piece jumps so that cell sits under the pointer.
   */
  #pick(state: SessionState, [px, py]: Point): Pick | null {
    const { config, tray, board, viewport: [vx, vy, vw, vh] } = this.settings;
    if (py < board.y + board.rows * board.pitch || py >= vy + vh) return null;
    const last = tray.slots.length - 1;
    for (const [slot, instance] of state.tray.entries()) {
      const [x, , w] = tray.slots[slot]!;
      if (!instance || px < (slot === 0 ? vx : x) || px >= (slot === last ? vx + vw : x + w)) continue;
      const shape = config.catalog.find((s) => s.id === instance.shapeId)!;
      const grid = slotGrid(tray, slot, shape);
      const nearest = (p: number, origin: number, size: number) => Math.min(Math.max(Math.floor((p - origin) / grid.pitch), 0), size - 1);
      return { instanceId: instance.instanceId, shape, grabbed: [nearest(px, grid.x, shape.width), nearest(py, grid.y, shape.height)] };
    }
    return null;
  }

  #own(sample: PointerSample): Active | null {
    return this.#active?.pointerId === sample.pointerId ? this.#active : null;
  }

  #pastThreshold(active: Active, { client: [x, y] }: PointerSample): boolean {
    return active.dragging || Math.hypot(x - active.start[0], y - active.start[1]) >= this.settings.dragThresholdCssPx;
  }

  #preview(pick: Pick, touch: boolean, sample: PointerSample): DragPreview | null {
    const state = this.getState();
    const slot = state.tray.findIndex((s) => s?.instanceId === pick.instanceId);
    if (slot < 0) return null;
    const { board, viewport, touchLiftCssPx } = this.settings;
    // Touch lift is applied in CSS pixels, then converted with the same viewport mapping as the pointer itself.
    const [cx, cy] = sample.client;
    const [lx, ly] = clientToLogical(touch ? [cx, cy - touchLiftCssPx] : [cx, cy], sample.box, viewport);
    const [gx, gy] = pick.grabbed;
    const anchor: Cell = [Math.floor((lx - board.x) / board.pitch) - gx, Math.floor((ly - board.y) / board.pitch) - gy];
    return {
      ...placementPreview(state, slot, pick.shape, anchor),
      floating: [lx - (gx + 0.5) * board.pitch, ly - (gy + 0.5) * board.pitch],
    };
  }
}
