import { Container, Graphics } from 'pixi.js';
import type { BoardState, GameplayConfig, SessionState, SlotInstance, TileKey } from '../../domain/models/types';
import { cellOrigin, slotGrid, type GridLayout, type TrayLayout } from '../../presentation/views/layout';
import type { ThemeConfig } from '../content/presentation-config';

// GDD 7.2: 3-pixel inset at a 60-pixel pitch; the theme radius is also given at that pitch.
const INSET_PER_PITCH = 3 / 60;

/** Retained board cells and tray tiles. update() only retints cells and redraws tray slots whose instance changed. */
export class GameView {
  readonly container = new Container();
  readonly #cells: Graphics[] = [];
  readonly #slots: { instanceId: number | null; graphics: Graphics }[];

  constructor(
    private readonly config: GameplayConfig,
    private readonly theme: ThemeConfig,
    /** Shape id -> theme color key. */
    private readonly colorKeys: Readonly<Record<string, string>>,
    board: GridLayout,
    private readonly tray: TrayLayout,
  ) {
    for (let y = 0; y < board.rows; y++)
      for (let x = 0; x < board.columns; x++) {
        const cell = this.#tile(new Graphics(), board, x, y);
        this.#cells.push(cell);
        this.container.addChild(cell);
      }
    this.#slots = tray.slots.map(() => ({ instanceId: null, graphics: this.container.addChild(new Graphics()) }));
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

  /** Adds one white rounded tile to `g`; color comes from tint so recoloring never rebuilds geometry. */
  #tile(g: Graphics, grid: GridLayout, x: number, y: number): Graphics {
    const inset = grid.pitch * INSET_PER_PITCH;
    const [left, top] = cellOrigin(grid, [x, y]);
    const size = grid.pitch - 2 * inset;
    return g.roundRect(left + inset, top + inset, size, size, (this.theme.tileCornerRadius * grid.pitch) / 60).fill(0xffffff);
  }

  #color(key: TileKey): string {
    return this.theme.colors[this.colorKeys[key]!]!;
  }
}
