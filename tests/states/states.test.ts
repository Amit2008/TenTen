import { describe, expect, it } from 'vitest';
import { createGenerator, scriptedPieceSource } from '../../src/application/piece-source/piece-source';
import { GameSession, startSession, type SessionRules } from '../../src/application/session/session';
import { canonicalJson } from '../../src/domain/models/gameplay-config';
import type { MoveResult, SessionState } from '../../src/domain/models/types';
import { MoveFeedback, ReturnGlide, type FeedbackFrame } from '../../src/presentation/feedback/feedback';
import { PresentationStates } from '../../src/presentation/states/states';
import { CLASSIC } from '../domain/helpers';

const TIMING = { place: 90, clear: 180, clearStagger: 0 };

/** Fills row 9 columns 0-4 with bar_5_h, then a second bar_5_h on columns 5-9 completes the row. */
function clearingMove(): { before: SessionState; result: MoveResult } {
  const rules: SessionRules = { config: CLASSIC, gameplayHash: 'h', source: scriptedPieceSource(['bar_5_h', 'bar_5_h', 'single', 'single', 'single', 'single']) };
  const session = new GameSession(rules, startSession(rules, 's', { ...createGenerator(1), state: 0 }));
  const place = (slot: number, anchor: [number, number]) => {
    const s = session.state;
    return session.place({ type: 'PlacePiece', sessionId: 's', expectedRevision: s.revision, instanceId: s.tray[slot]!.instanceId, anchor });
  };
  place(0, [0, 9]);
  const before = session.state;
  const result = place(1, [5, 9]);
  if (!result.accepted) throw new Error('setup move rejected');
  return { before, result };
}

describe('MoveFeedback', () => {
  it('pulses placed cells and fades the cleared tiles with the colors they held', () => {
    const { before, result } = clearingMove();
    const fb = new MoveFeedback(before, result, TIMING, false);
    const start = fb.frame();
    expect(start.placedScale).toBeCloseTo(1.12);
    expect(start.cleared[0]!.alpha).toBe(1);
    expect(start.cleared).toHaveLength(10);
    expect(new Set(start.cleared.map((t) => t.key))).toEqual(new Set(['bar_5_h']));
    fb.advance(0.09);
    expect(fb.frame().placedScale).toBe(1);
    expect(fb.done).toBe(false); // the clear fade is longer
    fb.advance(0.09);
    expect(fb.frame().cleared[0]!.alpha).toBe(0);
    expect(fb.done).toBe(true);
  });

  it('reduced motion never scales; it keeps an opacity cue and the same duration', () => {
    const { before, result } = clearingMove();
    const fb = new MoveFeedback(before, result, TIMING, true);
    for (const dt of [0, 0.03, 0.06, 0.09]) {
      fb.advance(dt);
      expect(fb.frame().placedScale).toBe(1);
    }
    expect(fb.frame().placedAlpha).toBe(1);
    expect(new MoveFeedback(before, result, TIMING, true).frame().placedAlpha).toBe(0.5);
  });

  it('cleared tiles shrink and fade one after another along the line; reduced motion fades them together', () => {
    const { before, result } = clearingMove(); // row 9, cells x = 0..9
    const timing = { place: 90, clear: 180, clearStagger: 20 };
    const fb = new MoveFeedback(before, result, timing, false);
    const tile = (x: number) => fb.frame().cleared.find((t) => t.cell[0] === x)!;
    fb.advance(0.1);
    expect(tile(0)).toMatchObject({ scale: expect.closeTo(1 - 100 / 180), alpha: expect.closeTo(1 - 100 / 180) });
    expect(tile(4)).toMatchObject({ scale: expect.closeTo(1 - 20 / 180), alpha: expect.closeTo(1 - 20 / 180) });
    expect(tile(9)).toMatchObject({ scale: 1, alpha: 1 }); // not started yet
    fb.advance(0.259); // 359 ms: the last tile starts at 180 ms and needs 180 ms
    expect(fb.done).toBe(false);
    fb.advance(0.001);
    expect(fb.done).toBe(true);
    expect(fb.frame().cleared.every((t) => t.scale === 0 && t.alpha === 0)).toBe(true);

    const reduced = new MoveFeedback(before, result, timing, true);
    reduced.advance(0.1);
    expect(new Set(reduced.frame().cleared.map((t) => `${t.scale}/${t.alpha.toFixed(4)}`))).toEqual(new Set([`1/${(1 - 100 / 180).toFixed(4)}`]));
    reduced.advance(0.08);
    expect(reduced.done).toBe(true);
  });

  it('a move without clears lasts only the placement time', () => {
    const rules: SessionRules = { config: CLASSIC, gameplayHash: 'h', source: scriptedPieceSource(['single', 'single', 'single']) };
    const s = startSession(rules, 's', { ...createGenerator(1), state: 0 });
    const result = new GameSession(rules, s).place({ type: 'PlacePiece', sessionId: 's', expectedRevision: 0, instanceId: s.tray[0]!.instanceId, anchor: [0, 0] });
    if (!result.accepted) throw new Error('rejected');
    const fb = new MoveFeedback(s, result, TIMING, false);
    fb.advance(0.09);
    expect(fb.done).toBe(true);
  });
});

describe('PresentationStates', () => {
  function run() {
    const frames: (FeedbackFrame | null)[] = [];
    const states = new PresentationStates(0.1, (f) => frames.push(f));
    const { before, result } = clearingMove();
    return { frames, states, feedback: () => new MoveFeedback(before, result, TIMING, false), result };
  }

  it('locks commands while resolving and releases them through one completion', () => {
    const { frames, states, feedback } = run();
    expect(states.acceptsCommands).toBe(true);
    states.play(feedback());
    expect(states.label(false, false)).toBe('resolving');
    expect(states.acceptsCommands).toBe(false);
    for (let i = 0; i < 20; i++) states.tick(1 / 60);
    expect(states.acceptsCommands).toBe(true);
    expect(frames.filter((f) => f === null)).toHaveLength(1);
    expect(states.label(false, true)).toBe('selected');
    expect(states.label(true, false)).toBe('dragging');
  });

  it('caps a long frame at 0.1 s, so one hitch cannot skip the whole clear', () => {
    const { frames, states, feedback } = run();
    states.play(feedback());
    states.tick(5);
    expect(states.resolving).toBe(true);
    expect(frames.at(-1)!.cleared[0]!.alpha).toBeCloseTo(1 - 100 / 180);
  });

  it('pause freezes the animation; Resume continues the same event once with a reset clock', () => {
    const { frames, states, feedback } = run();
    states.play(feedback());
    states.tick(0.05);
    const alpha = frames.at(-1)!.cleared[0]!.alpha;
    states.pause();
    expect(states.label(true, true)).toBe('paused');
    expect(states.acceptsCommands).toBe(false);
    for (let i = 0; i < 10; i++) states.tick(0.1); // a stray frame while paused does nothing
    expect(frames.at(-1)!.cleared[0]!.alpha).toBe(alpha);
    states.resume();
    states.tick(30); // the first frame after a long hidden period counts as zero
    expect(frames.at(-1)!.cleared[0]!.alpha).toBe(alpha);
    while (states.resolving) states.tick(1 / 60);
    expect(frames.filter((f) => f === null)).toHaveLength(1);
    expect(frames.filter((f) => f !== null && f.moveId !== frames[0]!.moveId)).toEqual([]);
  });

  it('zero-length feedback completes at once through the same path', () => {
    const { before, result } = clearingMove();
    const frames: (FeedbackFrame | null)[] = [];
    const states = new PresentationStates(0.1, (f) => frames.push(f));
    states.play(new MoveFeedback(before, result, { place: 0, clear: 0, clearStagger: 0 }, false));
    expect(frames).toEqual([null]);
    expect(states.acceptsCommands).toBe(true);
  });

  it('feedback never changes the committed state', () => {
    const { result, states, feedback } = run();
    const snapshot = canonicalJson(result.state);
    states.play(feedback());
    states.pause();
    states.resume();
    while (states.resolving) states.tick(1 / 144);
    expect(canonicalJson(result.state)).toBe(snapshot);
  });
});

describe('ReturnGlide (invalid return)', () => {
  it('eases from the release point to the slot, shrinking to tray pitch, and lands exactly', () => {
    const glide = new ReturnGlide(2, [100, 300], [500, 820], 0.4, 160);
    expect(glide.frame()).toEqual({ slot: 2, position: [100, 300], scale: 1 });
    glide.advance(0.08);
    const mid = glide.frame();
    expect(mid.position[0]).toBeGreaterThan(300); // ease-out: past halfway at half time
    expect(mid.scale).toBeLessThan(0.7);
    expect(glide.done).toBe(false);
    glide.advance(0.1);
    expect(glide.done).toBe(true);
    expect(glide.frame()).toEqual({ slot: 2, position: [500, 820], scale: 0.4 });
  });

  it('is done at once with zero duration', () => {
    const glide = new ReturnGlide(0, [0, 0], [10, 10], 0.5, 0);
    expect(glide.done).toBe(true);
    expect(glide.frame().position).toEqual([10, 10]);
  });
});
