import { Container, Graphics, type FillInput } from 'pixi.js';
import type { BoardState, Cell, GameplayConfig, SessionState, SlotInstance, TileKey } from '../../domain/models/types';
import type { DragPreview } from '../../presentation/drag/drag';
import { cellOrigin, slotGrid, type GridLayout, type TrayLayout } from '../../presentation/views/layout';
import type { ThemeConfig } from '../content/presentation-config';

// GDD 7.2: 3-pixel inset at a 60-pixel pitch; the theme radius is also given at that pitch.
const INSET_PER_PITCH = 3 / 60;

/** Retained board cells and tray tiles. update() only retints cells and redraws tray slots whose instance changed. */
export class GameView {
  readonly container = new Container();
  readonly #cells: Graphics[] = [];
  readonly #slots: { instanceId: number | null; graphics: Graphics }[];
  readonly #ghost = new Graphics();
  readonly #floating = new Graphics();
  #floatingShape: string | null = null;
  #ghostKey = '';

  constructor(
    private readonly config: GameplayConfig,
    private readonly theme: ThemeConfig,
    /** Shape id -> theme color key. */
    private readonly colorKeys: Readonly<Record<string, string>>,
    private readonly board: GridLayout,
    private readonly tray: TrayLayout,
  ) {
    for (let y = 0; y < board.rows; y++)
      for (let x = 0; x < board.columns; x++) {
        const cell = this.#tile(new Graphics(), board, x, y);
        this.#cells.push(cell);
        this.container.addChild(cell);
      }
    this.#slots = tray.slots.map(() => ({ instanceId: null, graphics: this.container.addChild(new Graphics()) }));
    // Ghost above the floating piece: the same-color ghost leaves the piece unchanged, and the invalid cross and
    // line outlines stay visible even when the piece sits right over them.
    this.container.addChild(this.#floating, this.#ghost);
    this.#floating.visible = false;
  }

  /** Floating piece under the pointer, snapped ghost on the board and the lines it would clear; null hides them. */
  showDrag(preview: DragPreview | null): void {
    this.#slots.forEach((s, i) => (s.graphics.visible = preview?.slot !== i));
    this.#floating.visible = preview !== null;
    if (!preview) {
      this.#ghost.clear();
      this.#ghostKey = '';
      return;
    }
    const { shape } = preview;
    if (this.#floatingShape !== shape.id) {
      this.#floatingShape = shape.id;
      const grid = { x: 0, y: 0, pitch: this.board.pitch, columns: shape.width, rows: shape.height };
      this.#floating.clear();
      for (const [x, y] of shape.cells) this.#tile(this.#floating, grid, x, y);
      this.#floating.tint = this.#color(shape.id);
    }
    this.#floating.position.set(...preview.floating);
    const key = `${shape.id}@${preview.anchor.join(',')}`;
    if (key === this.#ghostKey) return;
    this.#ghostKey = key;
    this.#drawGhost(preview);
  }

  update(state: SessionState): void {
    this.#updateBoard(state.board);
    state.tray.forEach((slot, i) => this.#updateSlot(i, slot));
  }

  #updateBoard(board: BoardState): void {
    board.cells.forEach((key, i) => (this.#cells[i]!.tint = key === null ? this.theme.emptyCell : this.#color(key)));
  }

  #updateSlot(index: number, slot: SlotInstance | null): void {
    const view = this.#slots[index]!;
    const instanceId = slot?.instanceId ?? null;
    if (view.instanceId === instanceId) return;
    view.instanceId = instanceId;
    view.graphics.clear();
    if (!slot) return;
    const shape = this.config.catalog.find((s) => s.id === slot.shapeId)!;
    const grid = slotGrid(this.tray, index, shape);
    for (const [x, y] of shape.cells) this.#tile(view.graphics, grid, x, y);
    view.graphics.tint = this.#color(shape.id);
  }

  #drawGhost({ shape, cells, valid, completedRows, completedColumns }: DragPreview): void {
    const g = this.#ghost.clear();
    const { pitch } = this.board;
    if (!valid) {
      // Outline plus a cross, so an invalid spot does not rely on color alone (GDD 6.1).
      for (const cell of cells) {
        const [l, t, s] = this.#inner(cell);
        g.rect(l, t, s, s);
        g.moveTo(l + s / 4, t + s / 4).lineTo(l + (3 * s) / 4, t + (3 * s) / 4);
        g.moveTo(l + (3 * s) / 4, t + s / 4).lineTo(l + s / 4, t + (3 * s) / 4);
      }
      g.stroke({ width: pitch * 0.06, color: this.theme.invalid });
      return;
    }
    const fill = { color: this.#color(shape.id), alpha: this.theme.ghostAlpha / 255 };
    for (const [x, y] of cells) this.#tile(g, this.board, x, y, fill);
    // Lines this drop would clear get an outline on every cell. Stroke only real paths: an empty stroke() would
    // re-stroke the last ghost tile.
    if (completedRows.length + completedColumns.length === 0) return;
    for (let y = 0; y < this.board.rows; y++)
      for (let x = 0; x < this.board.columns; x++)
        if (completedRows.includes(y) || completedColumns.includes(x)) g.rect(...this.#inner([x, y]));
    g.stroke({ width: pitch * 0.06, color: this.theme.accent });
  }

  /** Square inside a board cell after the inset: [left, top, size]. */
  #inner(cell: Cell): [number, number, number, number] {
    const inset = this.board.pitch * INSET_PER_PITCH;
    const [left, top] = cellOrigin(this.board, cell);
    const size = this.board.pitch - 2 * inset;
    return [left + inset, top + inset, size, size];
  }

  /** Adds one rounded tile to `g`; white by default so color can come from tint without rebuilding geometry. */
  #tile(g: Graphics, grid: GridLayout, x: number, y: number, fill: FillInput = 0xffffff): Graphics {
    const inset = grid.pitch * INSET_PER_PITCH;
    const [left, top] = cellOrigin(grid, [x, y]);
    const size = grid.pitch - 2 * inset;
    return g.roundRect(left + inset, top + inset, size, size, (this.theme.tileCornerRadius * grid.pitch) / 60).fill(fill);
  }

  #color(key: TileKey): string {
    return this.theme.colors[this.colorKeys[key]!]!;
  }
}
