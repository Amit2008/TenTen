import { GENERATOR_ALGORITHM, GENERATOR_VERSION, type Cell, type GameplayConfig, type ShapeDefinition } from './types';
import { Validator, deepFreeze } from './validation';

export const BOARD_MIN = 5;
export const BOARD_MAX = 16;
export const TRAY_MIN = 1;
export const TRAY_MAX = 5;
/** Cap on the summed weights so bounded draws stay within the 32-bit generator range (GDD 5.3). */
export const MAX_TOTAL_WEIGHT = 2147483647;

export interface ParsedGameplay {
  readonly config: GameplayConfig;
  /** Catalog file the rules point at; must match the manifest entry. Not part of the gameplay hash. */
  readonly catalogFile: string;
  /** Presentation mapping shape id -> theme color key. Not part of the gameplay hash. */
  readonly colorKeys: Readonly<Record<string, string>>;
}

/** Validates rules.json + pieces.json together and returns frozen effective rules. Throws ContentError. */
export function parseGameplay(rulesJson: unknown, piecesJson: unknown): ParsedGameplay {
  const v = new Validator('rules.json');
  const rules = v.object(rulesJson, '', [
    'schema_version', 'ruleset_id', 'board', 'tray_size', 'rotation_allowed', 'refill_policy',
    'clear_policy', 'score', 'generator', 'undo_enabled',
  ]);
  v.literal(rules.schema_version, 'schema_version', [1]);
  const board = v.object(rules.board, 'board', ['columns', 'rows']);
  const columns = v.int(board.columns, 'board.columns', BOARD_MIN, BOARD_MAX);
  const rows = v.int(board.rows, 'board.rows', BOARD_MIN, BOARD_MAX);
  const traySize = v.int(rules.tray_size, 'tray_size', TRAY_MIN, TRAY_MAX);
  v.literal(rules.rotation_allowed, 'rotation_allowed', [false]);
  v.literal(rules.undo_enabled, 'undo_enabled', [false]);
  v.literal(rules.refill_policy, 'refill_policy', ['when_all_used']);
  v.literal(rules.clear_policy, 'clear_policy', ['simultaneous_full_rows_and_columns']);
  const score = v.object(rules.score, 'score', ['points_per_placed_cell', 'points_per_completed_line', 'multiline_bonus']);
  const pointsPerPlacedCell = v.int(score.points_per_placed_cell, 'score.points_per_placed_cell');
  const pointsPerCompletedLine = v.int(score.points_per_completed_line, 'score.points_per_completed_line');
  v.literal(score.multiline_bonus, 'score.multiline_bonus', [0]);
  const generator = v.object(rules.generator, 'generator', ['policy', 'catalog', 'algorithm', 'version']);
  v.literal(generator.policy, 'generator.policy', ['weighted_independent_with_replacement']);
  v.literal(generator.algorithm, 'generator.algorithm', [GENERATOR_ALGORITHM]);
  v.literal(generator.version, 'generator.version', [GENERATOR_VERSION]);
  const catalogFile = v.relativePath(generator.catalog, 'generator.catalog');
  const rulesetId = v.string(rules.ruleset_id, 'ruleset_id');

  const p = new Validator('pieces.json');
  const pieces = p.object(piecesJson, '', ['schema_version', 'catalog_id', 'shapes'], ['provenance']);
  p.literal(pieces.schema_version, 'schema_version', [1]);
  const catalogId = p.string(pieces.catalog_id, 'catalog_id');
  if (pieces.provenance !== undefined) p.string(pieces.provenance, 'provenance');
  const ids = new Set<string>();
  const colorKeys: Record<string, string> = {};
  const catalog = p.array(pieces.shapes, 'shapes', 1).map((raw, i): ShapeDefinition => {
    const path = `shapes[${i}]`;
    const shape = p.object(raw, path, ['id', 'cells', 'weight', 'color_key']);
    const id = p.string(shape.id, `${path}.id`);
    if (ids.has(id)) p.fail(`${path}.id`, `duplicates shape id "${id}"`);
    ids.add(id);
    colorKeys[id] = p.string(shape.color_key, `${path}.color_key`);
    const weight = p.int(shape.weight, `${path}.weight`, 1);
    const cells = p.array(shape.cells, `${path}.cells`, 1).map((rawCell, j): Cell => {
      const pair = p.array(rawCell, `${path}.cells[${j}]`, 2);
      if (pair.length !== 2) p.fail(`${path}.cells[${j}]`, 'must be an [x, y] pair');
      return [p.int(pair[0], `${path}.cells[${j}][0]`), p.int(pair[1], `${path}.cells[${j}][1]`)];
    });
    const keys = new Set(cells.map(([x, y]) => `${x},${y}`));
    if (keys.size !== cells.length) p.fail(`${path}.cells`, 'repeats a cell');
    const width = Math.max(...cells.map(([x]) => x)) + 1;
    const height = Math.max(...cells.map(([, y]) => y)) + 1;
    if (Math.min(...cells.map(([x]) => x)) !== 0 || Math.min(...cells.map(([, y]) => y)) !== 0)
      p.fail(`${path}.cells`, 'must be normalized so the minimum x and y are 0');
    if (!isConnected(cells, keys)) p.fail(`${path}.cells`, 'must be orthogonally connected');
    if (width > columns || height > rows) p.fail(path, `does not fit an empty ${columns}x${rows} board`);
    const sorted = [...cells].sort(([ax, ay], [bx, by]) => ay - by || ax - bx);
    return { id, cells: sorted, weight, width, height };
  });
  const totalWeight = catalog.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight > MAX_TOTAL_WEIGHT) p.fail('shapes', `total weight must not exceed ${MAX_TOTAL_WEIGHT}`);

  const config: GameplayConfig = {
    rulesetId, catalogId, columns, rows, traySize,
    score: { pointsPerPlacedCell, pointsPerCompletedLine },
    catalog, totalWeight,
  };
  return deepFreeze({ config, catalogFile, colorKeys });
}

function isConnected(cells: readonly Cell[], keys: ReadonlySet<string>): boolean {
  const seen = new Set<string>();
  const stack: Cell[] = [cells[0]!];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const key = `${x},${y}`;
    if (seen.has(key) || !keys.has(key)) continue;
    seen.add(key);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen.size === keys.size;
}

/**
 * Canonical gameplay encoding hashed into the ruleset identity (GDD 9.1): object keys sorted recursively,
 * catalog order preserved, cells normalized. Labels, colors, layout, audio and paths are excluded.
 */
export function canonicalGameplayJson(config: GameplayConfig): string {
  return canonicalJson({
    board: { columns: config.columns, rows: config.rows },
    tray_size: config.traySize,
    rotation_allowed: false,
    undo_enabled: false,
    refill_policy: 'when_all_used',
    clear_policy: 'simultaneous_full_rows_and_columns',
    score: {
      points_per_placed_cell: config.score.pointsPerPlacedCell,
      points_per_completed_line: config.score.pointsPerCompletedLine,
      multiline_bonus: 0,
    },
    generator: {
      policy: 'weighted_independent_with_replacement',
      algorithm: GENERATOR_ALGORITHM,
      version: GENERATOR_VERSION,
    },
    // Shape ids are included: saved trays and boards reference them.
    catalog: config.catalog.map((s) => ({ id: s.id, cells: s.cells, weight: s.weight })),
  });
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
