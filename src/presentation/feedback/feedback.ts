// Cosmetic move feedback (GDD 6.3). Driven only by the dt it is given; it never touches the committed state.
import type { Cell, MoveResult, SessionState, TileKey } from '../../domain/models/types';

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
