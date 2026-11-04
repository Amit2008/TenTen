import { Container, Graphics, type FillInput } from 'pixi.js';
import type { BoardState, Cell, GameplayConfig, SessionState, SlotInstance, TileKey } from '../../domain/models/types';
import type { DragPreview } from '../../presentation/drag/drag';
import type { FeedbackFrame, ReturnFrame } from '../../presentation/feedback/feedback';
import type { PlacementPreview } from '../../presentation/views/preview';
import { cellOrigin, slotGrid, type GridLayout, type TrayLayout } from '../../presentation/views/layout';
import type { ThemeConfig, ThemePalette } from '../content/presentation-config';

// GDD 7.2: 3-pixel inset at a 60-pixel pitch; the theme radius is also given at that pitch.
const INSET_PER_PITCH = 3 / 60;

/** Retained board cells and tray tiles. update() only retints cells and redraws tray slots whose instance changed. */
export class GameView {
  readonly container = new Container();
  readonly #cells: Graphics[] = [];
  readonly #slots: { instanceId: number | null; graphics: Graphics }[];
  readonly #ghost = new Graphics();
  readonly #floating = new Graphics();
  /** Cleared tiles fading out over the committed (already cleared) board. */
  readonly #fading = new Graphics();
  #fadingMove = -1;
  #pulsed: Graphics[] = [];
  #floatingShape: string | null = null;
  #ghostKey = '';
  #palette: ThemePalette;
  #shown: SessionState | null = null;

  constructor(
    private readonly config: GameplayConfig,
    private readonly theme: ThemeConfig,
    /** Shape id -> theme color key. */
    private readonly colorKeys: Readonly<Record<string, string>>,
    private readonly board: GridLayout,
    private readonly tray: TrayLayout,
  ) {
    this.#palette = theme;
    // Each cell is drawn around its own center so the placement pulse scales in place.
    const unit = { x: -board.pitch / 2, y: -board.pitch / 2, pitch: board.pitch, columns: 1, rows: 1 };
    for (let y = 0; y < board.rows; y++)
      for (let x = 0; x < board.columns; x++) {
        const cell = this.#tile(new Graphics(), unit, 0, 0);
        const [left, top] = cellOrigin(board, [x, y]);
        cell.position.set(left + board.pitch / 2, top + board.pitch / 2);
        this.#cells.push(cell);
        this.container.addChild(cell);
      }
    this.container.addChild(this.#fading);
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
    this.#floating.scale.set(1);
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
    // Pointer moves are frequent; the board cannot change during a drag, so redraw only when the anchor moves.
    const key = `${shape.id}@${preview.anchor.join(',')}`;
    if (key === this.#ghostKey) return;
    this.#ghostKey = key;
    this.#drawGhost(preview);
  }

  /** Invalid-return glide: the floating piece eases back into its (hidden) tray slot; null ends it. */
  showReturn(frame: ReturnFrame | null, shapeId: string | null): void {
    this.#slots.forEach((s, i) => (s.graphics.visible = frame?.slot !== i));
    this.#floating.visible = frame !== null;
    if (!frame || !shapeId) return void this.#floating.scale.set(1);
    if (this.#floatingShape !== shapeId) {
      const shape = this.config.catalog.find((s) => s.id === shapeId)!;
      this.#floatingShape = shapeId;
      const grid = { x: 0, y: 0, pitch: this.board.pitch, columns: shape.width, rows: shape.height };
      this.#floating.clear();
      for (const [x, y] of shape.cells) this.#tile(this.#floating, grid, x, y);
      this.#floating.tint = this.#color(shapeId);
    }
    this.#floating.position.set(...frame.position);
    this.#floating.scale.set(frame.scale);
  }

  /** Tap/keyboard selection: highlighted tray slot, anchor marker and ghost; the piece stays in the tray. */
  showSelection(preview: PlacementPreview | null): void {
    this.#slots.forEach((s) => (s.graphics.visible = true));
    this.#floating.visible = false;
    this.#ghostKey = '';
    if (!preview) return void this.#ghost.clear();
    this.#drawGhost(preview);
    const g = this.#ghost;
    const width = this.board.pitch * 0.06;
    const [x, y, w, h] = this.tray.slots[preview.slot]!;
    g.roundRect(x + width, y + width, w - 2 * width, h - 2 * width, 8).stroke({ width, color: this.#palette.accent });
    // A ring on the anchor cell: the bounding-box origin, visible even when that cell of the shape is empty.
    const [ax, ay] = cellOrigin(this.board, preview.anchor);
    g.circle(ax + this.board.pitch / 2, ay + this.board.pitch / 2, this.board.pitch * 0.22).stroke({ width, color: this.#palette.text });
  }

  /** Draws one feedback frame over the committed board; null restores every cell. Cosmetic only. */
  showFeedback(frame: FeedbackFrame | null): void {
    for (const cell of this.#pulsed) {
      cell.scale.set(1);
      cell.alpha = 1;
    }
    if (!frame) {
      this.#pulsed = [];
      this.#fading.clear();
      this.#fadingMove = -1;
      return;
    }
    this.#pulsed = frame.placed.map(([x, y]) => this.#cells[y * this.board.columns + x]!);
    for (const cell of this.#pulsed) {
      cell.scale.set(frame.placedScale);
      cell.alpha = frame.placedAlpha;
    }
    if (this.#fadingMove !== frame.moveId) {
      this.#fadingMove = frame.moveId;
      this.#fading.clear();
      for (const [[x, y], key] of frame.cleared) this.#tile(this.#fading, this.board, x, y, this.#color(key));
    }
    this.#fading.alpha = frame.clearedAlpha;
  }

  /** Theme switch: retints the board and tray now; outlines, markers and the floating piece use it from their next draw. */
  setPalette(palette: ThemePalette): void {
    this.#palette = palette;
    this.#ghostKey = '';
    this.#floatingShape = null;
    for (const slot of this.#slots) slot.instanceId = -1; // forces a redraw with the new tile color
    if (this.#shown) this.update(this.#shown);
  }

  update(state: SessionState): void {
    this.#shown = state;
    this.#updateBoard(state.board);
    state.tray.forEach((slot, i) => this.#updateSlot(i, slot));
  }

  #updateBoard(board: BoardState): void {
    board.cells.forEach((key, i) => (this.#cells[i]!.tint = key === null ? this.#palette.emptyCell : this.#color(key)));
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

  #drawGhost({ shape, cells, valid, completedRows, completedColumns }: PlacementPreview): void {
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
      g.stroke({ width: pitch * 0.06, color: this.#palette.invalid });
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
    g.stroke({ width: pitch * 0.06, color: this.#palette.accent });
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
    return this.#palette.tile ?? this.theme.colors[this.colorKeys[key]!]!;
  }
}
