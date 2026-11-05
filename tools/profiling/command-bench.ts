// T26: times PlacePiece processing (no storage, no drawing) with the real application code. Bundled and run in the
// browser by perf.spec.ts. performance.now() is coarsened to 0.1 ms in browsers without cross-origin isolation.
import { createGenerator, weightedPieceSource } from '../../src/application/piece-source/piece-source';
import { GameSession, startSession, type SessionRules } from '../../src/application/session/session';
import type { GameplayConfig } from '../../src/domain/models/types';
import { parseGameplay, randomPlay } from '../replay/runner';

export { parseGameplay };

/** Per-command milliseconds over full `clearing`-policy games, one per seed. */
export function benchCommands(config: GameplayConfig, seeds: readonly number[]): number[] {
  const rules: SessionRules = { config, gameplayHash: 'bench', source: weightedPieceSource };
  const times: number[] = [];
  for (const seed of seeds) {
    const { commands } = randomPlay(config, seed, 500, 'clearing');
    const session = new GameSession(rules, startSession(rules, `bench-${seed}`, createGenerator(seed)));
    for (const { slot, anchor } of commands) {
      const s = session.state;
      const command = { type: 'PlacePiece', sessionId: s.sessionId, expectedRevision: s.revision, instanceId: s.tray[slot]!.instanceId, anchor } as const;
      const start = performance.now();
      const result = session.place(command);
      times.push(performance.now() - start);
      if (!result.accepted) throw new Error(`seed ${seed}: command rejected`);
    }
  }
  return times;
}
