// Pure layout math for the game canvas (GDD 7.2). Logical units; CSS and device pixels enter only through
// clientToLogical/logicalToClient, and device pixel ratio never does.
import type { Cell, ShapeDefinition } from '../../domain/models/types';

export type Rect = readonly [x: number, y: number, width: number, height: number];
export type Point = readonly [x: number, y: number];
/** The canvas's CSS box, as getBoundingClientRect() reports it. */
export interface ClientBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Visible logical region: full width, from one side margin above the board to the bottom. Score and controls are DOM. */
export function viewportRect([width, height]: readonly [number, number], [boardX, boardY]: Rect): Rect {
  const top = Math.max(0, boardY - boardX);
  return [0, top, width, height - top];
}

export interface GridLayout {
  readonly x: number;
  readonly y: number;
  readonly pitch: number;
  readonly columns: number;
  readonly rows: number;
}

/** Square cells centered in board_rect; alternate rectangular boards shrink the pitch instead of stretching cells. */
export function boardLayout([x, y, w, h]: Rect, columns: number, rows: number): GridLayout {
  const pitch = Math.min(w / columns, h / rows);
  return { x: x + (w - pitch * columns) / 2, y: y + (h - pitch * rows) / 2, pitch, columns, rows };
}

/** Logical top-left of a grid cell. */
export function cellOrigin(grid: GridLayout, [cx, cy]: Cell): Point {
  return [grid.x + cx * grid.pitch, grid.y + cy * grid.pitch];
}

/** Grid cell under a logical point, or null outside the grid. */
export function cellAt(grid: GridLayout, [px, py]: Point): Cell | null {
  const cx = Math.floor((px - grid.x) / grid.pitch);
  const cy = Math.floor((py - grid.y) / grid.pitch);
  return cx >= 0 && cy >= 0 && cx < grid.columns && cy < grid.rows ? [cx, cy] : null;
}

export interface TrayLayout {
  readonly slots: readonly Rect[];
  /** Pitch of every piece up to 3×3, so they all look the same size; longer pieces shrink to fit (see slotGrid). */
  readonly pitch: number;
}

/** Largest box the tray pitch is sized for (T29, Amit): pieces are drawn as if each fitted a 3×3 box. */
const TRAY_BOX = 3;

/** Equal slots across tray_rect; the pitch fits a 3×3 box (or the catalog's largest, if smaller) plus half a cell per side. */
export function trayLayout([x, y, w, h]: Rect, traySize: number, catalog: readonly ShapeDefinition[]): TrayLayout {
  const slotWidth = w / traySize;
  const extent = Math.min(TRAY_BOX, Math.max(...catalog.map((s) => Math.max(s.width, s.height))));
  return {
    slots: Array.from({ length: traySize }, (_, i): Rect => [x + i * slotWidth, y, slotWidth, h]),
    pitch: Math.min(slotWidth, h) / (extent + 1),
  };
}

/** Grid for one tray slot: the shape's bounding box centered, at the tray pitch or smaller if that would not fit. */
export function slotGrid(tray: TrayLayout, slot: number, shape: ShapeDefinition): GridLayout {
  const [x, y, w, h] = tray.slots[slot]!;
  const pitch = Math.min(tray.pitch, w / (shape.width + 1), h / (shape.height + 1));
  return { x: x + (w - shape.width * pitch) / 2, y: y + (h - shape.height * pitch) / 2, pitch, columns: shape.width, rows: shape.height };
}

/** CSS client point to logical point through the canvas's bounding box (GDD 7.2). */
export function clientToLogical([cx, cy]: Point, box: ClientBox, [vx, vy, vw, vh]: Rect): Point {
  return [vx + ((cx - box.left) * vw) / box.width, vy + ((cy - box.top) * vh) / box.height];
}

export function logicalToClient([lx, ly]: Point, box: ClientBox, [vx, vy, vw, vh]: Rect): Point {
  return [box.left + ((lx - vx) * box.width) / vw, box.top + ((ly - vy) * box.height) / vh];
}
