import { describe, expect, it } from 'vitest';
import { canonicalGameplayJson, parseGameplay } from '../../src/domain/models/gameplay-config';
import { ContentError } from '../../src/domain/models/validation';
import { gameplayHash } from '../../src/adapters/content/load-content';
import { release } from './fixtures';

const parse = (rules = release('rules'), pieces = release('pieces')) => parseGameplay(rules, pieces);
const hashOf = (rules = release('rules'), pieces = release('pieces')) => gameplayHash(parse(rules, pieces).config);

describe('shipped classic content', () => {
  it('has 19 unique, connected, normalized pieces that all fit the empty 10x10 board', () => {
    const { config, colorKeys } = parse();
    expect(config.catalog).toHaveLength(19);
    expect(new Set(config.catalog.map((s) => s.id)).size).toBe(19);
    for (const shape of config.catalog) {
      expect(shape.width).toBeLessThanOrEqual(config.columns);
      expect(shape.height).toBeLessThanOrEqual(config.rows);
      expect(Math.min(...shape.cells.map(([x]) => x))).toBe(0);
      expect(Math.min(...shape.cells.map(([, y]) => y))).toBe(0);
    }
    expect(config).toMatchObject({ columns: 10, rows: 10, traySize: 3, totalWeight: 19 });
    expect(config.score).toEqual({ pointsPerPlacedCell: 1, pointsPerCompletedLine: 10 });
    expect(Object.keys(colorKeys)).toHaveLength(19);
  });

  it('is deeply frozen', () => {
    const { config } = parse();
    expect(Object.isFrozen(config.catalog[0]!.cells[0])).toBe(true);
    expect(() => (config.catalog as unknown as unknown[]).push({})).toThrow();
  });

  it('has a pinned canonical hash (change detector: update only with a deliberate rule change)', async () => {
    const hash = await hashOf();
    console.log(`classic_proposed_v1 gameplay hash: ${hash}`);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hash).toBe(CLASSIC_HASH);
  });
});

// Recorded from the shipped 1.1.0 content on 2026-10-29 and cross-checked with an independent Python json.dumps(sort_keys) + sha256.
const CLASSIC_HASH = 'sha256:c8781bbed8b3eb1cf81e0bc4bf9f92b639b9f796f84369e6d48f70d59a523f03';

type Mutation = [label: string, mutate: (rules: any, pieces: any) => void, expectedPath: RegExp];

const invalid: Mutation[] = [
  ['unknown rules key', (r) => (r.bonus_mode = true), /bonus_mode is not a supported key/],
  ['unknown nested key', (r) => (r.score.streak = 5), /score\.streak is not a supported key/],
  ['missing key', (r) => delete r.tray_size, /tray_size is required/],
  ['board too small', (r) => (r.board.columns = 4), /board\.columns/],
  ['board too large', (r) => (r.board.rows = 17), /board\.rows/],
  ['tray of zero', (r) => (r.tray_size = 0), /tray_size/],
  ['tray of six', (r) => (r.tray_size = 6), /tray_size/],
  ['non-integer rule value', (r) => (r.board.columns = 10.5), /board\.columns must be a safe integer/],
  ['negative score', (r) => (r.score.points_per_placed_cell = -1), /points_per_placed_cell/],
  ['unsafe score integer', (r) => (r.score.points_per_completed_line = 2 ** 53), /safe integer/],
  ['non-finite score', (r) => (r.score.points_per_completed_line = Infinity), /safe integer/],
  ['rotation enabled', (r) => (r.rotation_allowed = true), /rotation_allowed must be one of false/],
  ['undo enabled', (r) => (r.undo_enabled = true), /undo_enabled/],
  ['multiline bonus', (r) => (r.score.multiline_bonus = 5), /multiline_bonus/],
  ['unsupported refill policy', (r) => (r.refill_policy = 'each_move'), /refill_policy/],
  ['unsupported clear policy', (r) => (r.clear_policy = 'rows_only'), /clear_policy/],
  ['unsupported generator', (r) => (r.generator.algorithm = 'mulberry32'), /generator\.algorithm/],
  ['unsupported generator version', (r) => (r.generator.version = 2), /generator\.version/],
  ['unsupported schema', (r) => (r.schema_version = 2), /schema_version/],
  ['duplicate shape id', (_, p) => (p.shapes[1].id = 'single'), /shapes\[1\]\.id duplicates/],
  ['repeated cell', (_, p) => p.shapes[1].cells.push([0, 0]), /repeats a cell/],
  ['empty shape', (_, p) => (p.shapes[0].cells = []), /at least 1/],
  ['disconnected cells', (_, p) => (p.shapes[1].cells = [[0, 0], [2, 0]]), /connected/],
  ['diagonal-only cells', (_, p) => (p.shapes[1].cells = [[0, 0], [1, 1]]), /connected/],
  ['negative coordinate', (_, p) => (p.shapes[0].cells = [[-1, 0]]), /cells\[0\]\[0\]/],
  ['fractional coordinate', (_, p) => (p.shapes[0].cells = [[0.5, 0]]), /safe integer/],
  ['unnormalized shape', (_, p) => (p.shapes[0].cells = [[1, 1]]), /normalized/],
  ['malformed cell', (_, p) => (p.shapes[0].cells = [[0, 0, 0]]), /\[x, y\] pair/],
  ['zero weight', (_, p) => (p.shapes[0].weight = 0), /weight/],
  ['fractional weight', (_, p) => (p.shapes[0].weight = 1.5), /weight/],
  ['total weight overflow', (_, p) => ((p.shapes[0].weight = 2147483647), (p.shapes[1].weight = 1)), /total weight/],
  ['missing color key', (_, p) => delete p.shapes[0].color_key, /color_key is required/],
  ['shape too large for board', (r, p) => ((r.board.columns = 5), (r.board.rows = 5), p.shapes.push({ id: 'bar_6', cells: [[0,0],[1,0],[2,0],[3,0],[4,0],[5,0]], weight: 1, color_key: 'single' })), /does not fit an empty 5x5 board/],
  ['empty catalog', (_, p) => (p.shapes = []), /shapes must have at least 1/],
  ['catalog path escapes release', (r) => (r.generator.catalog = '../pieces.json'), /generator\.catalog/],
];

describe('invalid gameplay content is rejected', () => {
  it.each(invalid)('%s', (_label, mutate, expected) => {
    const rules = release('rules');
    const pieces = release('pieces');
    mutate(rules, pieces);
    expect(() => parse(rules, pieces)).toThrow(ContentError);
    expect(() => parse(rules, pieces)).toThrow(expected);
  });
});

describe('gameplay hash identity', () => {
  it('ignores cosmetic and label edits, key order and cell order', async () => {
    const base = await hashOf();
    const pieces = release('pieces');
    pieces.shapes[0].color_key = 'bar_2_h';
    pieces.provenance = 'edited';
    pieces.shapes[10].cells.reverse();
    const rules = release('rules');
    rules.ruleset_id = 'renamed';
    const reordered = Object.fromEntries(Object.entries(rules).reverse());
    expect(await hashOf(reordered, pieces)).toBe(base);
  });

  const ruleEdits: [string, (r: any, p: any) => void][] = [
    ['score per line', (r) => (r.score.points_per_completed_line = 20)],
    ['score per cell', (r) => (r.score.points_per_placed_cell = 2)],
    ['board size', (r) => (r.board.columns = 9)],
    ['tray size', (r) => (r.tray_size = 2)],
    ['weight', (_, p) => (p.shapes[3].weight = 2)],
    ['catalog order', (_, p) => p.shapes.reverse()],
    ['removed shape', (_, p) => p.shapes.pop()],
    ['shape geometry', (_, p) => p.shapes[1].cells.push([2, 0])],
    ['shape id', (_, p) => (p.shapes[0].id = 'mono')],
  ];
  it.each(ruleEdits)('changes when the %s changes', async (_label, mutate) => {
    const rules = release('rules');
    const pieces = release('pieces');
    mutate(rules, pieces);
    expect(await hashOf(rules, pieces)).not.toBe(await hashOf());
  });

  it('canonical JSON sorts keys and excludes presentation', () => {
    const json = canonicalGameplayJson(parse().config);
    expect(json.startsWith('{"board":{"columns":10,"rows":10},"catalog":[{"cells":[[0,0]],"id":"single","weight":1}')).toBe(true);
    expect(json).not.toMatch(/color|theme|ruleset_id|catalog_id|pieces\.json/);
  });
});
