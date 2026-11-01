// Screen flow (GDD 6.2): menu, confirmation, play and results. Pure; the DOM screens only render `screen`.
import type { SessionState } from '../../domain/models/types';

export type Screen = 'loading' | 'menu' | 'confirm_new' | 'playing' | 'results';

export class Lifecycle {
  #screen: Screen = 'loading';
  /** Where Cancel returns to from the confirmation. */
  #beforeConfirm: Screen = 'menu';
  /** Session ids whose results were already shown: game over is reported once per run. */
  readonly #finished = new Set<string>();

  constructor(private readonly onScreen: (screen: Screen) => void) {}

  get screen(): Screen {
    return this.#screen;
  }

  get playing(): boolean {
    return this.#screen === 'playing';
  }

  menu(): void {
    this.#go('menu');
  }

  play(): void {
    this.#go('playing');
  }

  /** New Game, Restart or Play Again. Replacing an unfinished run needs confirmation first. */
  requestNewGame(current: SessionState | null): 'start' | 'confirm' {
    if (current?.status !== 'active') return 'start';
    this.#beforeConfirm = this.#screen === 'confirm_new' ? this.#beforeConfirm : this.#screen;
    this.#go('confirm_new');
    return 'confirm';
  }

  cancelNewGame(): void {
    if (this.#screen === 'confirm_new') this.#go(this.#beforeConfirm);
  }

  /** Shows results the first time this run is seen at game over; later calls (refresh, Continue) do nothing. */
  finished(run: SessionState): boolean {
    if (run.status !== 'game_over' || this.#finished.has(run.sessionId)) return false;
    this.#finished.add(run.sessionId);
    this.#go('results');
    return true;
  }

  #go(screen: Screen): void {
    this.#screen = screen;
    this.onScreen(screen);
  }
}
