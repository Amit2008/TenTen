import { describe, expect, it } from 'vitest';
import { Lifecycle, type Screen } from '../../src/application/lifecycle/lifecycle';
import { createGenerator, weightedPieceSource } from '../../src/application/piece-source/piece-source';
import { startSession, type SessionRules } from '../../src/application/session/session';
import type { SessionState } from '../../src/domain/models/types';
import { CLASSIC } from '../domain/helpers';

const rules: SessionRules = { config: CLASSIC, gameplayHash: 'h', source: weightedPieceSource };
const run = (id: string, status: SessionState['status'] = 'active'): SessionState => ({ ...startSession(rules, id, createGenerator(3)), status });

function setup() {
  const screens: Screen[] = [];
  return { life: new Lifecycle((s) => screens.push(s)), screens };
}

describe('Lifecycle', () => {
  it('starts loading, then menu and play', () => {
    const { life, screens } = setup();
    expect(life.screen).toBe('loading');
    life.menu();
    life.play();
    expect(screens).toEqual(['menu', 'playing']);
    expect(life.playing).toBe(true);
  });

  it('starts at once when nothing unfinished would be replaced', () => {
    const { life } = setup();
    life.menu();
    expect(life.requestNewGame(null)).toBe('start');
    expect(life.requestNewGame(run('a', 'game_over'))).toBe('start');
    expect(life.screen).toBe('menu');
  });

  it('asks before replacing an active run; Cancel returns to where the request came from', () => {
    const { life } = setup();
    life.play();
    expect(life.requestNewGame(run('a'))).toBe('confirm');
    expect(life.screen).toBe('confirm_new');
    expect(life.requestNewGame(run('a'))).toBe('confirm'); // a second request keeps the original return point
    life.cancelNewGame();
    expect(life.screen).toBe('playing');
    life.menu();
    life.requestNewGame(run('a'));
    life.cancelNewGame();
    expect(life.screen).toBe('menu');
  });

  it('shows results once per run, never for an active run', () => {
    const { life, screens } = setup();
    life.play();
    expect(life.finished(run('a'))).toBe(false);
    expect(life.finished(run('a', 'game_over'))).toBe(true);
    life.menu();
    expect(life.finished(run('a', 'game_over'))).toBe(false); // the same run again (Continue, a second report)
    expect(life.finished(run('b', 'game_over'))).toBe(true); // a blocked fresh deal is a new run
    expect(screens.filter((s) => s === 'results')).toHaveLength(2);
  });
});
