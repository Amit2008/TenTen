import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGameplay } from '../../src/domain/models/gameplay-config';
import { randomPlay } from '../../tools/replay/runner';

// GDD 4.1: the engine supports 5..16 cells per side and 1..5 tray slots. Each is a distinct ruleset.
const RELEASE = 'public/content/releases/1.1.0';
const rules = () => JSON.parse(readFileSync(`${RELEASE}/rules.json`, 'utf8'));
const pieces = () => JSON.parse(readFileSync(`${RELEASE}/pieces.json`, 'utf8'));

const VARIANTS: [label: string, columns: number, rows: number, tray: number, seeds: number][] = [
  ['5x5, tray 1 (refill every move)', 5, 5, 1, 200],
  ['16x16, tray 5', 16, 16, 5, 60],
  ['7x12 rectangle, tray 2', 7, 12, 2, 200],
  ['12x5 rectangle, tray 3', 12, 5, 3, 200],
];

describe('alternate rulesets keep every invariant', () => {
  it.each(VARIANTS)('%s: %i seeds', (_label, columns, rows, tray, seeds) => {
    const r = rules();
    r.board = { columns, rows };
    r.tray_size = tray;
    const config = parseGameplay(r, pieces()).config;
    let moves = 0;
    let lines = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const run = randomPlay(config, seed, 400, seed % 2 ? 'random' : 'clearing');
      moves += run.moves;
      lines += run.linesCleared;
    }
    console.log(`${columns}x${rows} tray ${tray}: ${moves} moves, ${lines} lines`);
    expect(moves).toBeGreaterThan(seeds);
  }, 120_000);

  it('the classic catalog fits the smallest 5x5 board; 4 rows is outside the supported range', () => {
    const r = rules();
    r.board = { columns: 5, rows: 5 };
    expect(parseGameplay(r, pieces()).config.catalog).toHaveLength(19);
    r.board = { columns: 5, rows: 4 };
    expect(() => parseGameplay(r, pieces())).toThrow(/board\.rows/);
  });
});
