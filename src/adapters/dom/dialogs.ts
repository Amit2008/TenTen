import { parseSettings, type Settings } from '../../application/settings/settings';

/**
 * Buttons with `data-dialog="<id>"` open that native modal dialog: the browser traps focus, closes it on Escape and
 * returns focus to the button. Installed once; works on the error screen too, without WebGL.
 */
export function installDialogButtons(): void {
  document.addEventListener('click', (e) => {
    const button = (e.target as Element | null)?.closest<HTMLElement>('[data-dialog]');
    const dialog = button && document.getElementById(button.dataset.dialog!);
    if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
  });
}

/** Shows `settings` in the form and reports every change; the returned function removes the listeners. */
export function bindSettingsForm(settings: Settings, onChange: (settings: Settings) => void): () => void {
  const form = document.getElementById('settings-form') as HTMLFormElement;
  const show = (s: Settings): void => {
    for (const key of ['masterVolume', 'musicVolume', 'effectsVolume'] as const) {
      const input = form.elements.namedItem(key) as HTMLInputElement;
      input.value = String(s[key]);
      (input.nextElementSibling as HTMLOutputElement).value = `${s[key]}%`;
    }
    for (const key of ['theme', 'motion'] as const) (form.elements.namedItem(key) as RadioNodeList).value = s[key];
  };
  show(settings);
  const listeners = new AbortController();
  form.addEventListener(
    'input',
    () => {
      const data = Object.fromEntries(new FormData(form));
      const next = parseSettings(
        { ...data, masterVolume: Number(data.masterVolume), musicVolume: Number(data.musicVolume), effectsVolume: Number(data.effectsVolume) },
        settings,
      );
      show(next);
      onChange(next);
    },
    { signal: listeners.signal },
  );
  return () => listeners.abort();
}

/** High contrast restyles the HTML at once; canvas colors follow with the theme work (T21). */
export function applyTheme(settings: Settings): void {
  document.documentElement.dataset.theme = settings.theme;
}
