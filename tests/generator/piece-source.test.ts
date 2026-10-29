import { describe, expect, it } from 'vitest';
import { cryptoSeed } from '../../src/adapters/random/crypto-seed';
import {
  createGenerator,
  parseGeneratorState,
  scriptedPieceSource,
  weightedPieceSource,
} from '../../src/application/piece-source/piece-source';
import { boundedFromOutput, drawBounded, xorshift32 } from '../../src/application/piece-source/xorshift32';
import type { GameplayConfig, GeneratorState } from '../../src/domain/models/types';
import { ContentError, deepFreeze } from '../../src/domain/models/validation';
import { CLASSIC } from '../domain/helpers';
import { SEED_12345_DRAWS_19, SEED_12345_FINAL_STATE, SEED_1_OUTPUTS } from './golden';

function deal(generator: GeneratorState, count: number, config: GameplayConfig = CLASSIC) {
  const ids: string[] = [];
  let g = generator;
  for (let i = 0; i < count; i++) {
    const draw = weightedPieceSource.draw(g, config);
    ids.push(draw.shape.id);
    g = draw.generator;
  }
  return { ids, generator: g };
}

describe('xorshift32_v1', () => {
  it('state 1 produces the specified golden vectors', () => {
    let state = 1;
    const outputs = SEED_1_OUTPUTS.map(() => (state = xorshift32(state)));
    expect(outputs).toEqual(SEED_1_OUTPUTS);
  });

  it('stays an unsigned 32-bit nonzero state across many steps', () => {
    let state = 0xffffffff;
    for (let i = 0; i < 100_000; i++) {
      state = xorshift32(state);
      expect(state > 0 && state <= 0xffffffff && Number.isInteger(state)).toBe(true);
    }
  });

  it('seed 12345 gives the recorded bounded draw sequence', () => {
    let state = 12345;
    const values = SEED_12345_DRAWS_19.map(() => {
      const draw = drawBounded(state, 19);
      state = draw.state;
      return draw.value;
    });
    expect(values).toEqual(SEED_12345_DRAWS_19);
    expect(state).toBe(SEED_12345_FINAL_STATE);
  });
});

describe('unbiased bounded draws', () => {
  it('rejects only outputs at or above the largest multiple of the bound', () => {
    // bound 2: value range [0, 4294967294] has 4294967295 values; limit 4294967294, so the top value is rejected.
    expect(boundedFromOutput(4294967295, 2)).toBeNull();
    expect(boundedFromOutput(4294967294, 2)).toBe(1);
    expect(boundedFromOutput(1, 2)).toBe(0);
    // bound 19: limit = 226050910 * 19 = 4294967290; values 4294967290..4294967294 (outputs +1) are rejected.
    expect(boundedFromOutput(4294967290, 19)).toBe(4294967289 % 19);
    for (const output of [4294967291, 4294967292, 4294967293, 4294967294, 4294967295])
      expect(boundedFromOutput(output, 19)).toBeNull();
    // bound 3 divides 4294967295 exactly, so nothing is rejected.
    expect(boundedFromOutput(4294967295, 3)).toBe(4294967294 % 3);
    // The maximum total weight still yields values below it.
    expect(boundedFromOutput(4294967295, 2147483647)).toBeNull();
    expect(boundedFromOutput(2147483647, 2147483647)).toBe(2147483646);
  });

  it('maps values to cumulative-weight intervals in catalog order', () => {
    const config = deepFreeze({
      ...CLASSIC,
      catalog: [CLASSIC.catalog[0]!, { ...CLASSIC.catalog[1]!, weight: 2 }, { ...CLASSIC.catalog[2]!, weight: 3 }],
      totalWeight: 6,
    });
    const counts: Record<string, number> = {};
    let g = createGenerator(7);
    for (let i = 0; i < 60_000; i++) {
      const draw = weightedPieceSource.draw(g, config);
      counts[draw.shape.id] = (counts[draw.shape.id] ?? 0) + 1;
      g = draw.generator;
    }
    // Expected 10k / 20k / 30k; allow 5% relative tolerance.
    expect(counts.single! / 10_000).toBeCloseTo(1, 1);
    expect(counts.bar_2_h! / 20_000).toBeCloseTo(1, 1);
    expect(counts.bar_2_v! / 30_000).toBeCloseTo(1, 1);
  });

  it('classic catalog: every shape appears, and duplicates within a three-piece tray happen', () => {
    const { ids } = deal(createGenerator(2026), 19_000);
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect(counts.size).toBe(19);
    for (const n of counts.values()) expect(n).toBeGreaterThan(800); // expected 1000 each
    let duplicateTrays = 0;
    for (let i = 0; i + 3 <= ids.length; i += 3) if (new Set(ids.slice(i, i + 3)).size < 3) duplicateTrays++;
    expect(duplicateTrays).toBeGreaterThan(0);
  });
});

describe('determinism, restore and purity', () => {
  it('a restored generator deals exactly what the uninterrupted one does', () => {
    const full = deal(createGenerator(12345), 40);
    const first = deal(createGenerator(12345), 17);
    const restored = parseGeneratorState(JSON.parse(JSON.stringify(first.generator)));
    const rest = deal(restored, 23);
    expect([...first.ids, ...rest.ids]).toEqual(full.ids);
    expect(rest.generator).toEqual(full.generator);
  });

  it('draw never mutates its input, so discarding a draw leaves the generator untouched', () => {
    const generator = deepFreeze(createGenerator(99));
    const a = weightedPieceSource.draw(generator, CLASSIC);
    const b = weightedPieceSource.draw(generator, CLASSIC);
    expect(a).toEqual(b);
    expect(generator.state).toBe(99);
    expect(a.generator.seed).toBe(99);
  });

  it('normalizes seeds to nonzero unsigned 32-bit values', () => {
    expect(createGenerator(0).state).toBe(1);
    expect(createGenerator(2 ** 32).state).toBe(1);
    expect(createGenerator(-1).state).toBe(4294967295);
    expect(cryptoSeed((a) => a.fill(0))).toBe(0);
    expect(createGenerator(cryptoSeed((a) => a.fill(0))).seed).toBe(1);
    const seed = cryptoSeed();
    expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff).toBe(true);
  });

  it('rejects corrupt saved generator state', () => {
    const good = createGenerator(5);
    for (const bad of [
      { ...good, state: 0 },
      { ...good, state: 2 ** 32 },
      { ...good, state: 1.5 },
      { ...good, seed: -3 },
      { ...good, algorithm: 'mulberry32' },
      { ...good, version: 2 },
      { ...good, extra: 1 },
    ])
      expect(() => parseGeneratorState(bad)).toThrow(ContentError);
    expect(parseGeneratorState(good)).toEqual(good);
  });

  it('scripted source deals its list in order, purely', () => {
    const source = scriptedPieceSource(['square_3', 'single', 'square_3']);
    let g: GeneratorState = { ...createGenerator(1), state: 0 };
    const ids = [0, 1, 2].map(() => {
      const draw = source.draw(g, CLASSIC);
      g = draw.generator;
      return draw.shape.id;
    });
    expect(ids).toEqual(['square_3', 'single', 'square_3']);
    expect(() => source.draw(g, CLASSIC)).toThrow(/exhausted/);
  });
});
