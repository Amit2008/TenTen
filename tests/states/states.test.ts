import { describe, expect, it } from 'vitest';
import { createGenerator, scriptedPieceSource } from '../../src/application/piece-source/piece-source';
import { GameSession, startSession, type SessionRules } from '../../src/application/session/session';
import { canonicalJson } from '../../src/domain/models/gameplay-config';
import type { MoveResult, SessionState } from '../../src/domain/models/types';
import { MoveFeedback, type FeedbackFrame } from '../../src/presentation/feedback/feedback';
import { PresentationStates } from '../../src/presentation/states/states';
import { CLASSIC } from '../domain/helpers';

const TIMING = { place: 90, clear: 180 };

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
    expect(start.clearedAlpha).toBe(1);
    expect(start.cleared).toHaveLength(10);
    expect(new Set(start.cleared.map(([, key]) => key))).toEqual(new Set(['bar_5_h']));
    fb.advance(0.09);
    expect(fb.frame().placedScale).toBe(1);
    expect(fb.done).toBe(false); // the clear fade is longer
    fb.advance(0.09);
    expect(fb.frame().clearedAlpha).toBe(0);
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
    expect(frames.at(-1)!.clearedAlpha).toBeCloseTo(1 - 100 / 180);
  });

  it('pause freezes the animation; Resume continues the same event once with a reset clock', () => {
    const { frames, states, feedback } = run();
    states.play(feedback());
    states.tick(0.05);
    const alpha = frames.at(-1)!.clearedAlpha;
    states.pause();
    expect(states.label(true, true)).toBe('paused');
    expect(states.acceptsCommands).toBe(false);
    for (let i = 0; i < 10; i++) states.tick(0.1); // a stray frame while paused does nothing
    expect(frames.at(-1)!.clearedAlpha).toBe(alpha);
    states.resume();
    states.tick(30); // the first frame after a long hidden period counts as zero
    expect(frames.at(-1)!.clearedAlpha).toBe(alpha);
    while (states.resolving) states.tick(1 / 60);
    expect(frames.filter((f) => f === null)).toHaveLength(1);
    expect(frames.filter((f) => f !== null && f.moveId !== frames[0]!.moveId)).toEqual([]);
  });

  it('zero-length feedback completes at once through the same path', () => {
    const { before, result } = clearingMove();
    const frames: (FeedbackFrame | null)[] = [];
    const states = new PresentationStates(0.1, (f) => frames.push(f));
    states.play(new MoveFeedback(before, result, { place: 0, clear: 0 }, false));
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
