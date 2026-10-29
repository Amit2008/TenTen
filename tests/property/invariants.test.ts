import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InvariantError, randomPlay, replay, type PlayPolicy, type RandomPlayStats } from '../../tools/replay/runner';
import { CLASSIC } from '../domain/helpers';
import recorded from './fixtures/recorded-seed-2026.json';

const SEEDS = { first: 1, last: 1000 };
const MAX_MOVES = 300;
const EVIDENCE = 'docs/evidence/t11';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe(`seeded sequences ${SEEDS.first}..${SEEDS.last} (production generator)`, () => {
  it.each(['random', 'clearing'] as PlayPolicy[])('%s play: every move satisfies the documented invariants', (policy) => {
    const runs: RandomPlayStats[] = [];
    const failures: { seed: number; message: string }[] = [];
    for (let seed = SEEDS.first; seed <= SEEDS.last; seed++) {
      try {
        runs.push(randomPlay(CLASSIC, seed, MAX_MOVES, policy));
      } catch (error) {
        if (!(error instanceof InvariantError)) throw error;
        failures.push({ seed, message: error.message });
      }
    }
    const moves = runs.map((r) => r.moves);
    const summary = {
      policy,
      seeds: `${SEEDS.first}..${SEEDS.last}`,
      maxMovesPerRun: MAX_MOVES,
      runs: runs.length,
      totalMoves: moves.reduce((a, b) => a + b, 0),
      movesMinMedianMax: [Math.min(...moves), [...moves].sort((a, b) => a - b)[moves.length >> 1], Math.max(...moves)],
      gameOver: runs.filter((r) => r.status === 'game_over').length,
      hitMoveCap: runs.filter((r) => r.status === 'active').length,
      endedOnBlockedRefill: runs.filter((r) => r.endedOnBlockedRefill).length,
      refills: runs.reduce((a, r) => a + r.refills, 0),
      rejectionsChecked: runs.reduce((a, r) => a + r.rejectionsChecked, 0),
      linesCleared: runs.reduce((a, r) => a + r.linesCleared, 0),
      multiLineMoves: runs.reduce((a, r) => a + r.multiLineMoves, 0),
      bestScore: Math.max(...runs.map((r) => r.score)),
      // Minimal failing seeds are preserved here for replay; empty when everything passes.
      failures,
    };
    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(`${EVIDENCE}/seeded-runs-${policy}.json`, JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify(summary));
    expect(failures).toEqual([]);
    expect(runs).toHaveLength(1000);
  }, 300_000);

  it('runs that end on a blocked fresh tray terminate normally as game over', () => {
    const blocked: RandomPlayStats[] = [];
    for (let seed = SEEDS.first; seed <= SEEDS.last && blocked.length < 5; seed++) {
      const run = randomPlay(CLASSIC, seed, MAX_MOVES);
      if (run.endedOnBlockedRefill) blocked.push(run);
    }
    expect(blocked.length).toBeGreaterThan(0);
    for (const run of blocked) expect(run.status).toBe('game_over');
  }, 60_000);
});

describe('recorded sequence', () => {
  it('replays to the pinned final state', () => {
    const { trace, final } = replay(CLASSIC, recorded.seed, recorded.commands as never);
    expect(final.revision).toBe(recorded.expected.moves);
    expect(final.score).toBe(recorded.expected.score);
    expect(final.status).toBe(recorded.expected.status);
    expect(sha(trace.join('\n'))).toBe(recorded.expected.traceSha256);
  });

  it('the fixture still matches what randomPlay records for its seed', () => {
    const fresh = randomPlay(CLASSIC, recorded.seed, MAX_MOVES);
    expect(fresh.commands).toEqual(recorded.commands);
  });
});
