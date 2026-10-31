import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGameplay } from '../../src/domain/models/gameplay-config';
import {
  boardLayout,
  cellAt,
  cellOrigin,
  clientToLogical,
  logicalToClient,
  slotGrid,
  trayLayout,
  viewportRect,
  type Rect,
} from '../../src/presentation/views/layout';

const release = (file: string) => JSON.parse(readFileSync(`public/content/releases/1.1.0/${file}`, 'utf8'));
const { config } = parseGameplay(release('rules.json'), release('pieces.json'));
const runtime = release('runtime.json');
const BOARD: Rect = runtime.board_rect;
const TRAY: Rect = runtime.tray_rect;
const VIEWPORT = viewportRect(runtime.logical_size, BOARD);

describe('board layout', () => {
  it('matches GDD 7.2 for the default 10x10 board: x=60, y=190, pitch 60', () => {
    expect(boardLayout(BOARD, 10, 10)).toEqual({ x: 60, y: 190, pitch: 60, columns: 10, rows: 10 });
  });

  it.each([
    [16, 16],
    [7, 12],
    [12, 5],
    [5, 5],
  ])('a %ix%i board keeps square cells, centered inside board_rect', (columns, rows) => {
    const g = boardLayout(BOARD, columns, rows);
    expect(g.pitch).toBe(Math.min(600 / columns, 600 / rows));
    expect(g.x).toBeGreaterThanOrEqual(60);
    expect(g.y).toBeGreaterThanOrEqual(190);
    expect(g.x + columns * g.pitch).toBeCloseTo(660 - (g.x - 60));
    expect(g.y + rows * g.pitch).toBeCloseTo(790 - (g.y - 190));
  });

  it('cellAt inverts cellOrigin at every cell and rejects points just outside each edge', () => {
    const g = boardLayout(BOARD, 10, 10);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++) {
        const [ox, oy] = cellOrigin(g, [x, y]);
        expect(cellAt(g, [ox, oy])).toEqual([x, y]);
        expect(cellAt(g, [ox + 59.99, oy + 59.99])).toEqual([x, y]);
      }
    for (const p of [[59.99, 300], [660, 300], [300, 189.99], [300, 790]] as const) expect(cellAt(g, p)).toBeNull();
  });
});

describe('tray layout', () => {
  const tray = trayLayout(TRAY, config.traySize, config.catalog);

  it('splits tray_rect into equal slots with one shared pitch', () => {
    expect(tray.slots).toEqual([
      [60, 810, 200, 120],
      [260, 810, 200, 120],
      [460, 810, 200, 120],
    ]);
    expect(tray.pitch).toBe(20); // 120 / (5 + 1)
  });

  it.each(config.catalog.map((s) => [s.id, s] as const))('%s fits centered in every slot', (_, shape) => {
    tray.slots.forEach(([x, y, w, h], i) => {
      const g = slotGrid(tray, i, shape);
      expect(g.x).toBeGreaterThanOrEqual(x + tray.pitch / 2);
      expect(g.y).toBeGreaterThanOrEqual(y + tray.pitch / 2);
      expect(g.x + shape.width * g.pitch).toBeLessThanOrEqual(x + w - tray.pitch / 2);
      expect(g.y + shape.height * g.pitch).toBeLessThanOrEqual(y + h - tray.pitch / 2);
      expect(g.x - x).toBeCloseTo(x + w - (g.x + shape.width * g.pitch));
    });
  });

  it('fits a 5-slot tray too', () => {
    const five = trayLayout(TRAY, 5, config.catalog);
    expect(five.slots).toHaveLength(5);
    expect(five.pitch).toBe(20); // min(120 wide, 120 tall) / 6
  });
});

describe('client to logical mapping', () => {
  it('shows the board and tray, from one side margin above the board to the bottom', () => {
    expect(VIEWPORT).toEqual([0, 130, 720, 830]);
  });

  // CSS boxes as getBoundingClientRect would report them at 360x640, desktop and a letterboxed landscape window.
  // DPR is not an input: it only changes the framebuffer, never these CSS coordinates.
  const boxes = [
    { left: 0, top: 100, width: 360, height: 415 },
    { left: 412.5, top: 64, width: 455, height: 524.5 },
    { left: 200, top: 0.25, width: 216, height: 249 },
  ];

  it.each(boxes)('round-trips and lands every board cell center in its cell (%o)', (box) => {
    const g = boardLayout(BOARD, 10, 10);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++) {
        const [ox, oy] = cellOrigin(g, [x, y]);
        const client = logicalToClient([ox + 30, oy + 30], box, VIEWPORT);
        const back = clientToLogical(client, box, VIEWPORT);
        expect(back[0]).toBeCloseTo(ox + 30, 9);
        expect(back[1]).toBeCloseTo(oy + 30, 9);
        expect(cellAt(g, back)).toEqual([x, y]);
      }
  });

  it('maps the canvas corners to the viewport corners', () => {
    const box = boxes[0]!;
    expect(clientToLogical([0, 100], box, VIEWPORT)).toEqual([0, 130]);
    expect(clientToLogical([360, 515], box, VIEWPORT)).toEqual([720, 960]);
  });
});
