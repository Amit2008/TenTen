import type { GameplayConfig, SessionState } from '../../domain/models/types';

/**
 * Score and semantic tray slot buttons (GDD 6.1). The buttons are the 44 CSS pixel alternative to picking small tray
 * cells: each selects its slot by index and never starts a drag.
 */
export class Hud {
  readonly #buttons: HTMLButtonElement[];

  constructor(
    private readonly config: GameplayConfig,
    private readonly score: HTMLElement,
    private readonly slots: HTMLElement,
    onSelect: (slot: number) => void,
  ) {
    this.#buttons = Array.from({ length: config.traySize }, (_, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(i + 1);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => onSelect(i));
      return button;
    });
    slots.replaceChildren(...this.#buttons);
  }

  update(state: SessionState): void {
    this.score.textContent = String(state.score);
    state.tray.forEach((slot, i) => {
      const button = this.#buttons[i]!;
      const shape = slot && this.config.catalog.find((s) => s.id === slot.shapeId)!;
      button.disabled = !shape;
      button.setAttribute(
        'aria-label',
        shape ? `Slot ${i + 1}: ${shape.cells.length} cells, ${shape.width} wide by ${shape.height} tall` : `Slot ${i + 1}: used`,
      );
    });
  }

  setSelected(slot: number | null): void {
    this.#buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === slot)));
  }

  destroy(): void {
    this.slots.replaceChildren();
  }
}
