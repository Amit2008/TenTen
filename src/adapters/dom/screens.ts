import type { Screen } from '../../application/lifecycle/lifecycle';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const OVERLAYS: Partial<Record<Screen, HTMLElement>> = {
  menu: byId('menu'),
  confirm_new: byId('confirm-new'),
  results: byId('results'),
};

export interface ScreenActions {
  continueGame(): void;
  newGame(): void;
  confirmNewGame(): void;
  cancelNewGame(): void;
  mainMenu(): void;
}

export interface ScreenInfo {
  readonly canContinue: boolean;
  readonly score: number;
  readonly best: number;
}

/** Semantic HTML menu, confirmation and results over the game; one at a time, focus on its first button. */
export class Screens {
  readonly #listeners = new AbortController();

  constructor(actions: ScreenActions) {
    const on = (id: string, fn: () => void) => byId(id).addEventListener('click', fn, { signal: this.#listeners.signal });
    on('menu-continue', actions.continueGame);
    on('menu-new', actions.newGame);
    on('confirm-yes', actions.confirmNewGame);
    on('confirm-no', actions.cancelNewGame);
    on('results-again', actions.newGame);
    on('results-menu', actions.mainMenu);
    on('pause-restart', actions.newGame);
    on('pause-menu', actions.mainMenu);
  }

  show(screen: Screen, info: ScreenInfo): void {
    byId('menu-continue').hidden = !info.canContinue;
    byId('results-score').textContent = String(info.score);
    byId('results-best').textContent = String(info.best);
    for (const [name, overlay] of Object.entries(OVERLAYS)) overlay.hidden = name !== screen;
    OVERLAYS[screen]?.querySelector<HTMLButtonElement>('button:not([hidden])')?.focus();
  }

  destroy(): void {
    this.#listeners.abort();
    for (const overlay of Object.values(OVERLAYS)) overlay.hidden = true;
  }
}
