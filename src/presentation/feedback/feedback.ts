// Cosmetic move feedback (GDD 6.3). Driven only by the dt it is given; it never touches the committed state.
import type { Cell, MoveResult, SessionState, TileKey } from '../../domain/models/types';
import type { Point } from '../views/layout';

export interface FeedbackTiming {
  readonly place: number;
  /** Shrink-and-fade time of one cleared tile. */
  readonly clear: number;
  /** Delay between successive tiles along a cleared line (0 with reduced motion). */
  readonly clearStagger: number;
}

/** A cleared tile drawn over the already-cleared board: the tile it held, shrinking about its center and fading. */
export interface ClearingTile {
  readonly cell: Cell;
  readonly key: TileKey;
  readonly scale: number;
  readonly alpha: number;
}

export interface FeedbackFrame {
  readonly moveId: number;
  readonly placed: readonly Cell[];
  /** Scale pulse on placed cells; always 1 with reduced motion. */
  readonly placedScale: number;
  /** Opacity cue on placed cells, used instead of the pulse with reduced motion. */
  readonly placedAlpha: number;
  readonly cleared: readonly ClearingTile[];
}

const PULSE = 0.12;

/**
 * One accepted move's feedback: a placement pulse, and the cleared tiles shrinking and fading one after another
 * along their lines (left to right, top to bottom; crossing lines sweep from their top-left). Reduced motion: every
 * cleared tile fades together, without shrinking.
 */
export class MoveFeedback {
  #elapsedMs = 0;
  readonly #placed: readonly Cell[];
  /** [cell, tile, position in the sweep]. */
  readonly #cleared: readonly (readonly [Cell, TileKey, number])[];
  readonly #stagger: number;
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
    // x + y is the position along a row or a column, so each cleared line sweeps from its first cell.
    const first = Math.min(...result.cleared.map(([x, y]) => x + y));
    this.#cleared = result.cleared.map(
      (c) => [c, before.board.cells[c[1] * before.board.columns + c[0]] ?? shapeId, c[0] + c[1] - first] as const,
    );
    this.#stagger = reducedMotion ? 0 : timing.clearStagger;
    const last = Math.max(0, ...this.#cleared.map(([, , order]) => order));
    this.#durationMs = Math.max(timing.place, this.#cleared.length ? timing.clear + this.#stagger * last : 0);
  }

  get done(): boolean {
    return this.#elapsedMs >= this.#durationMs;
  }

  advance(dtSeconds: number): void {
    this.#elapsedMs += dtSeconds * 1000;
  }

  frame(): FeedbackFrame {
    const place = this.timing.place > 0 ? Math.min(this.#elapsedMs / this.timing.place, 1) : 1;
    const progress = (order: number) =>
      this.timing.clear > 0 ? Math.min(Math.max((this.#elapsedMs - order * this.#stagger) / this.timing.clear, 0), 1) : 1;
    return {
      moveId: this.result.moveId,
      placed: this.#placed,
      placedScale: this.reducedMotion ? 1 : 1 + PULSE * (1 - place),
      placedAlpha: this.reducedMotion ? 0.5 + 0.5 * place : 1,
      cleared: this.#cleared.map(([cell, key, order]) => {
        const t = progress(order);
        return { cell, key, scale: this.reducedMotion ? 1 : 1 - t, alpha: 1 - t };
      }),
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
