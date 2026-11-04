import { describe, expect, it } from 'vitest';
import { Playlist } from '../../src/adapters/audio/playlist';
import { xorshift32 } from '../../src/application/piece-source/xorshift32';

const take = (list: Playlist, n: number) => Array.from({ length: n }, () => list.next());
/** Deterministic stand-in for Math.random. */
const seeded = (seed: number) => {
  let state = seed;
  return () => (state = xorshift32(state)) / 2 ** 32;
};

describe('Playlist', () => {
  it('is empty and silent with no tracks', () => {
    expect(new Playlist([], true, true, Math.random).next()).toBeNull();
  });

  it('plays in order without shuffle and stops at the end without repeat', () => {
    expect(take(new Playlist(['a', 'b', 'c'], false, false, Math.random), 4)).toEqual(['a', 'b', 'c', null]);
  });

  it('repeats in order', () => {
    expect(take(new Playlist(['a', 'b'], false, true, Math.random), 5)).toEqual(['a', 'b', 'a', 'b', 'a']);
  });

  it('shuffles each cycle as a permutation and never repeats a track across the cycle boundary', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const order = take(new Playlist(['a', 'b', 'c', 'd'], true, true, seeded(seed)), 40);
      for (let cycle = 0; cycle < 10; cycle++) expect([...order.slice(cycle * 4, cycle * 4 + 4)].sort()).toEqual(['a', 'b', 'c', 'd']);
      for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    }
  });

  it('skips failed tracks and goes silent when every track has failed, in bounded steps', () => {
    const list = new Playlist(['a', 'b', 'c'], false, true, Math.random);
    list.fail('b');
    expect(take(list, 4)).toEqual(['a', 'c', 'a', 'c']);
    list.fail('a');
    list.fail('c');
    expect(list.next()).toBeNull();
  });
});
