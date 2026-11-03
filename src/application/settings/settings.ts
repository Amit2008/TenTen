// Player settings (GDD 7.2, 9.2, 9.3). Pure; stored in the save envelope and applied by adapters.

export type ThemeChoice = 'light' | 'high_contrast';
/** `system` follows prefers-reduced-motion; the others override it. */
export type MotionChoice = 'system' | 'reduce' | 'full';

export interface Settings {
  /** Percentages 0..100, used by audio (T22). */
  readonly masterVolume: number;
  readonly musicVolume: number;
  readonly effectsVolume: number;
  readonly theme: ThemeChoice;
  readonly motion: MotionChoice;
}

const THEMES: readonly ThemeChoice[] = ['light', 'high_contrast'];
const MOTIONS: readonly MotionChoice[] = ['system', 'reduce', 'full'];

/**
 * Reads stored settings key by key. A missing or invalid value falls back to its default instead of failing, so
 * settings written by an older or newer build never block play.
 */
export function parseSettings(stored: Readonly<Record<string, unknown>>, defaults: Settings): Settings {
  const volume = (key: keyof Settings) => {
    const v = stored[key];
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100 ? v : (defaults[key] as number);
  };
  const pick = <T extends string>(key: keyof Settings, allowed: readonly T[]) =>
    allowed.includes(stored[key] as T) ? (stored[key] as T) : (defaults[key] as T);
  return {
    masterVolume: volume('masterVolume'),
    musicVolume: volume('musicVolume'),
    effectsVolume: volume('effectsVolume'),
    theme: pick('theme', THEMES),
    motion: pick('motion', MOTIONS),
  };
}

/** Whether move feedback should avoid scaling and translation. */
export function reducesMotion(settings: Settings, systemPrefersReduced: boolean, themeDefault: boolean): boolean {
  if (settings.motion === 'reduce') return true;
  if (settings.motion === 'full') return false;
  return systemPrefersReduced || themeDefault;
}
