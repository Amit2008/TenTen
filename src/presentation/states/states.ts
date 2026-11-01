// Interaction states (GDD 6.2): commands are accepted only while not resolving or paused. No timers: the render
// ticker passes dt in, and a paused presentation receives none.
import type { FeedbackFrame, MoveFeedback } from '../feedback/feedback';

export type InteractionState = 'idle' | 'selected' | 'dragging' | 'resolving' | 'paused';

export class PresentationStates {
  #paused = false;
  #feedback: MoveFeedback | null = null;
  #resetClock = false;

  constructor(
    private readonly dtCapSeconds: number,
    /** A frame while resolving; null exactly once when the feedback completes or is skipped. */
    private readonly onFrame: (frame: FeedbackFrame | null) => void,
  ) {}

  get paused(): boolean {
    return this.#paused;
  }

  get resolving(): boolean {
    return this.#feedback !== null;
  }

  get acceptsCommands(): boolean {
    return !this.#paused && !this.#feedback;
  }

  label(dragging: boolean, selected: boolean): InteractionState {
    if (this.#paused) return 'paused';
    if (this.#feedback) return 'resolving';
    return dragging ? 'dragging' : selected ? 'selected' : 'idle';
  }

  /** Starts feedback for a move that is already committed. Zero-length feedback completes immediately. */
  play(feedback: MoveFeedback): void {
    this.#feedback = feedback;
    this.#advance(0);
  }

  /** One render frame. The first frame after Resume counts as zero time; others are capped. */
  tick(dtSeconds: number): void {
    if (this.#paused || !this.#feedback) return;
    const dt = this.#resetClock ? 0 : Math.min(Math.max(dtSeconds, 0), this.dtCapSeconds);
    this.#resetClock = false;
    this.#advance(dt);
  }

  pause(): void {
    this.#paused = true;
  }

  /** Continues the same visual event; nothing is replayed. */
  resume(): void {
    this.#paused = false;
    this.#resetClock = true;
  }

  #advance(dt: number): void {
    const feedback = this.#feedback!;
    feedback.advance(dt);
    if (!feedback.done) return this.onFrame(feedback.frame());
    this.#feedback = null;
    this.onFrame(null); // the single completion path, also for skipped animations
  }
}
