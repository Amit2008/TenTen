import type { SelectionController } from '../../presentation/input_modes/selection';

/**
 * Puzzle keys while the canvas owns focus (GDD 6.1). Only keys the selection uses get preventDefault, so Tab,
 * browser shortcuts and page scrolling keep working; modifier chords are never treated as puzzle keys.
 */
export function attachKeyboard(
  canvas: HTMLCanvasElement,
  selection: SelectionController,
  traySize: number,
  /** Escape that did not cancel a selection: opens pause (GDD 6.1). */
  onEscape: () => void,
): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (selection.key(e.key, e.repeat)) e.preventDefault();
    else if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
    }
  };
  canvas.tabIndex = 0;
  // application: screen readers pass arrow keys and Enter through instead of using them to browse.
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-roledescription', 'puzzle board');
  canvas.setAttribute('aria-label', `Board. Keys 1 to ${traySize} pick a piece, arrow keys move it, Enter places it, Escape cancels.`);
  canvas.addEventListener('keydown', onKey);
  return () => canvas.removeEventListener('keydown', onKey);
}
