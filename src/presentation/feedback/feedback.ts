// Cosmetic move feedback (GDD 6.3). Driven only by the dt it is given; it never touches the committed state.
import type { Cell, MoveResult, SessionState, TileKey } from '../../domain/models/types';
import type { Point } from '../views/layout';

export interface FeedbackTiming {
  readonly place: number;
  readonly clear: number;
}

export interface FeedbackFrame {
  readonly moveId: number;
  readonly placed: readonly Cell[];
  /** Scale pulse on placed cells; always 1 with reduced motion. */
  readonly placedScale: number;
  /** Opacity cue on placed cells, used instead of the pulse with reduced motion. */
  readonly placedAlpha: number;
  /** Cleared cells with the tile they held, fading out over the already-cleared board. */
  readonly cleared: readonly (readonly [Cell, TileKey])[];
  readonly clearedAlpha: number;
}

const PULSE = 0.12;

/** One accepted move's feedback: a placement pulse and a fade of the cleared tiles, both starting at once. */
export class MoveFeedback {
  #elapsedMs = 0;
  readonly #placed: readonly Cell[];
  readonly #cleared: readonly (readonly [Cell, TileKey])[];
  readonly #durationMs: number;

  constructor(
    before: SessionState,
    private readonly result: MoveResult,
    private readonly timing: FeedbackTiming,
    private readonly reducedMotion: boolean,
  ) {
    const shapeId = before.tray.find((s) => s?.instanceId === result.consumedInstanceId)!.shapeId;
    this.#placed = result.placed;
    // A cleared cell held an old tile or, if it was empty before the move, a tile of the shape just placed.
    this.#cleared = result.cleared.map((c) => [c, before.board.cells[c[1] * before.board.columns + c[0]] ?? shapeId] as const);
    this.#durationMs = Math.max(timing.place, this.#cleared.length ? timing.clear : 0);
  }

  get done(): boolean {
    return this.#elapsedMs >= this.#durationMs;
  }

  advance(dtSeconds: number): void {
    this.#elapsedMs += dtSeconds * 1000;
  }

  frame(): FeedbackFrame {
    const place = this.timing.place > 0 ? Math.min(this.#elapsedMs / this.timing.place, 1) : 1;
    const clear = this.timing.clear > 0 ? Math.min(this.#elapsedMs / this.timing.clear, 1) : 1;
    return {
      moveId: this.result.moveId,
      placed: this.#placed,
      placedScale: this.reducedMotion ? 1 : 1 + PULSE * (1 - place),
      placedAlpha: this.reducedMotion ? 0.5 + 0.5 * place : 1,
      cleared: this.#cleared,
      clearedAlpha: 1 - clear,
    };
  }
}

/** Where the returning piece is drawn: top-left of its shape-local (0,0) and its scale relative to board pitch. */
export interface ReturnFrame {
  readonly slot: number;
  readonly position: Point;
  readonly scale: number;
}

/**
 * Invalid-return feedback: a piece released where it cannot go glides from the release point back to its tray slot,
 * shrinking from board pitch to tray pitch. Cosmetic: the piece is already back in the tray in the session state.
 * With reduced motion (or zero duration) it is done at once, so the transition is identical, just not animated.
 */
export class ReturnGlide {
  #elapsedMs = 0;

  constructor(
    readonly slot: number,
    private readonly from: Point,
    private readonly to: Point,
    /** Tray pitch / board pitch. */
    private readonly toScale: number,
    private readonly durationMs: number,
  ) {}

  get done(): boolean {
    return this.#elapsedMs >= this.durationMs;
  }

  advance(dtSeconds: number): void {
    this.#elapsedMs += dtSeconds * 1000;
  }

  frame(): ReturnFrame {
    const t = this.durationMs > 0 ? Math.min(this.#elapsedMs / this.durationMs, 1) : 1;
    const ease = 1 - (1 - t) ** 3; // fast start, gentle landing
    const mix = (a: number, b: number) => a + (b - a) * ease;
    return { slot: this.slot, position: [mix(this.from[0], this.to[0]), mix(this.from[1], this.to[1])], scale: mix(1, this.toScale) };
  }
}
