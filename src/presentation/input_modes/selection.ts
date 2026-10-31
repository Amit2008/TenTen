// Tap/click and keyboard placement (GDD 6.1): select a slot, place its bounding-box anchor, commit. No DOM.
import type { Cell, GameplayConfig, PlacePiece, SessionState, ShapeDefinition } from '../../domain/models/types';
import { cellAt, type GridLayout, type Point, type TrayLayout } from '../views/layout';
import { placementPreview, type PlacementPreview } from '../views/preview';

export interface SelectionSettings {
  readonly config: GameplayConfig;
  readonly board: GridLayout;
  readonly tray: TrayLayout;
}

const ARROWS: Readonly<Record<string, Cell>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/**
 * The selected tray instance and its anchor. The anchor is the board cell for the shape's local (0,0), shown by a
 * marker even when that cell of the shape is empty, so every input mode places the same cells for the same anchor.
 */
export class SelectionController {
  #instanceId: number | null = null;
  #anchor: Cell | null = null;

  constructor(
    private readonly settings: SelectionSettings,
    private readonly getState: () => SessionState,
    private readonly onPreview: (preview: PlacementPreview | null) => void,
    private readonly onCommit: (command: PlacePiece) => void,
  ) {}

  /** Selects a live slot; selecting the selected slot again clears the selection. */
  selectSlot(slot: number): void {
    const instance = this.getState().tray[slot];
    if (!instance || this.getState().status !== 'active') return;
    if (instance.instanceId === this.#instanceId) return this.clear();
    this.#instanceId = instance.instanceId;
    const shape = this.#shape(instance.shapeId);
    const { columns, rows } = this.settings.config;
    // Keep the anchor across selections; the first one starts centered. Keyboard moves keep the box on the board.
    this.#anchor = this.#clamp(this.#anchor ?? [Math.floor((columns - shape.width) / 2), Math.floor((rows - shape.height) / 2)], shape);
    this.#emit();
  }

  /** A tap on a tray slot selects it; a tap on a board cell places the anchor there and commits if legal. */
  tap(point: Point): void {
    const state = this.getState();
    const slot = this.settings.tray.slots.findIndex(
      ([x, y, w, h]) => point[0] >= x && point[0] < x + w && point[1] >= y && point[1] < y + h,
    );
    if (slot >= 0 && state.tray[slot]) return this.selectSlot(slot);
    const cell = cellAt(this.settings.board, point);
    if (!cell || this.#instanceId === null) return;
    this.#anchor = cell; // not clamped: a box that leaves the board is shown invalid, never moved
    this.#emit();
    this.commit();
  }

  /** Handles a puzzle key. Returns true when the key was used, so only those keys get preventDefault. */
  key(key: string, repeat: boolean): boolean {
    const slotNumber = Number(key);
    if (/^[1-9]$/.test(key) && slotNumber <= this.settings.config.traySize) {
      if (!repeat && this.getState().tray[slotNumber - 1]) this.selectSlot(slotNumber - 1);
      return true;
    }
    if (this.#instanceId === null) return false;
    const step = ARROWS[key];
    if (step) {
      const [x, y] = this.#anchor!;
      this.#anchor = this.#clamp([x + step[0], y + step[1]], this.#selectedShape()!);
      this.#emit();
      return true;
    }
    if (key === 'Enter' || key === ' ') {
      if (!repeat) this.commit(); // a held key must not commit twice
      return true;
    }
    if (key === 'Escape') {
      this.clear();
      return true;
    }
    return false;
  }

  commit(): void {
    const preview = this.#preview();
    if (!preview?.valid) return;
    const state = this.getState();
    this.onCommit({ type: 'PlacePiece', sessionId: state.sessionId, expectedRevision: state.revision, instanceId: this.#instanceId!, anchor: preview.anchor });
  }

  clear(): void {
    if (this.#instanceId === null) return;
    this.#instanceId = null;
    this.onPreview(null);
  }

  /** Call after the session changes: a consumed or stale selection clears; a live one re-previews on the new board. */
  refresh(): void {
    if (this.#instanceId === null) return;
    if (this.getState().status !== 'active' || !this.#selectedShape()) return this.clear();
    this.#emit();
  }

  #emit(): void {
    this.onPreview(this.#preview());
  }

  #preview(): PlacementPreview | null {
    const state = this.getState();
    const slot = state.tray.findIndex((s) => s !== null && s.instanceId === this.#instanceId);
    if (slot < 0 || !this.#anchor) return null;
    return placementPreview(state, slot, this.#shape(state.tray[slot]!.shapeId), this.#anchor);
  }

  #selectedShape(): ShapeDefinition | null {
    const instance = this.getState().tray.find((s) => s !== null && s.instanceId === this.#instanceId);
    return instance ? this.#shape(instance.shapeId) : null;
  }

  #shape(id: string): ShapeDefinition {
    return this.settings.config.catalog.find((s) => s.id === id)!;
  }

  #clamp([x, y]: Cell, shape: ShapeDefinition): Cell {
    const { columns, rows } = this.settings.config;
    return [Math.min(Math.max(x, 0), columns - shape.width), Math.min(Math.max(y, 0), rows - shape.height)];
  }
}
