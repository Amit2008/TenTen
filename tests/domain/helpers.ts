import { readFileSync } from 'node:fs';
import { parseGameplay } from '../../src/domain/models/gameplay-config';
import type { BoardState, GameplayConfig, ShapeDefinition } from '../../src/domain/models/types';
import { deepFreeze } from '../../src/domain/models/validation';

const RELEASE = 'public/content/releases/1.1.0';

/** The shipped classic rules and 19-shape catalog. */
export const CLASSIC: GameplayConfig = parseGameplay(
  JSON.parse(readFileSync(`${RELEASE}/rules.json`, 'utf8')),
  JSON.parse(readFileSync(`${RELEASE}/pieces.json`, 'utf8')),
).config;

export function shape(id: string): ShapeDefinition {
  const found = CLASSIC.catalog.find((s) => s.id === id);
  if (!found) throw new Error(`no shape ${id}`);
  return found;
}

/**
 * Frozen board from rows of text: `.` is empty, any other character is a tile keyed by that character.
 * Example: board('..#', '###') is a 3x2 board.
 */
export function board(...rows: string[]): BoardState {
  const columns = rows[0]!.length;
  if (rows.some((r) => r.length !== columns)) throw new Error('ragged board fixture');
  return deepFreeze({ columns, rows: rows.length, cells: rows.join('').split('').map((c) => (c === '.' ? null : c)) });
}

export function render(b: BoardState): string[] {
  return Array.from({ length: b.rows }, (_, y) =>
    b.cells.slice(y * b.columns, (y + 1) * b.columns).map((t) => (t === null ? '.' : t.length === 1 ? t : '#')).join(''),
  );
}

export const emptyRows = (columns: number, rows: number): string[] => Array<string>(rows).fill('.'.repeat(columns));
