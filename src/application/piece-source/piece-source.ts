import {
  GENERATOR_ALGORITHM,
  GENERATOR_VERSION,
  type GameplayConfig,
  type GeneratorState,
  type ShapeDefinition,
} from '../../domain/models/types';
import { Validator } from '../../domain/models/validation';
import { drawBounded } from './xorshift32';

export interface PieceDraw {
  readonly shape: ShapeDefinition;
  readonly generator: GeneratorState;
}

/** Deterministic, pure deal source: never mutates its input, so a rejected command leaves the generator as it was. */
export interface PieceSource {
  draw(generator: GeneratorState, config: GameplayConfig): PieceDraw;
}

const UINT32_MAX = 4294967295;

/** Normalizes an injected 32-bit seed (from the CSPRNG seed adapter); zero maps to 1. */
export function createGenerator(seed: number): GeneratorState {
  const normalized = seed >>> 0 || 1;
  return { algorithm: GENERATOR_ALGORITHM, version: GENERATOR_VERSION, seed: normalized, state: normalized };
}

/** Production source: independent weighted draws with replacement, catalog order, xorshift32_v1. */
export const weightedPieceSource: PieceSource = {
  draw(generator, config) {
    const { value, state } = drawBounded(generator.state, config.totalWeight);
    let cumulative = 0;
    const shape = config.catalog.find((s) => value < (cumulative += s.weight))!;
    return { shape, generator: { ...generator, state } };
  },
};

/** Test source that deals a fixed list of shape ids; `state` is the cursor so it stays pure and replayable. */
export function scriptedPieceSource(shapeIds: readonly string[]): PieceSource {
  return {
    draw(generator, config) {
      const id = shapeIds[generator.state];
      const shape = config.catalog.find((s) => s.id === id);
      if (!shape) throw new Error(`scripted source exhausted or unknown shape at ${generator.state}: ${id}`);
      return { shape, generator: { ...generator, state: generator.state + 1 } };
    },
  };
}

/** Validates a saved generator record; throws ContentError. */
export function parseGeneratorState(json: unknown): GeneratorState {
  const v = new Validator('save.generator');
  const g = v.object(json, '', ['algorithm', 'version', 'seed', 'state']);
  return {
    algorithm: v.literal(g.algorithm, 'algorithm', [GENERATOR_ALGORITHM]),
    version: v.literal(g.version, 'version', [GENERATOR_VERSION]),
    seed: v.int(g.seed, 'seed', 1, UINT32_MAX),
    state: v.int(g.state, 'state', 1, UINT32_MAX),
  };
}
