import { Validator, type Json } from '../../domain/models/validation';

/** The colors that change between light and dark; tile colors are shared. */
export interface ThemePalette {
  readonly background: string;
  readonly emptyCell: string;
  readonly text: string;
  readonly accent: string;
  readonly invalid: string;
}

export interface ThemeConfig extends ThemePalette {
  readonly themeId: string;
  readonly dark: ThemePalette;
  readonly ghostAlpha: number;
  readonly tileCornerRadius: number;
  /** Theme color key -> #RRGGBB. */
  readonly colors: Readonly<Record<string, string>>;
  readonly feedbackMs: { readonly place: number; readonly clear: number; readonly invalidReturn: number };
  readonly reducedMotion: boolean;
}

type Rect = readonly [x: number, y: number, width: number, height: number];

export interface RuntimeConfig {
  readonly logicalSize: readonly [width: number, height: number];
  readonly resolutionCap: number;
  readonly renderFpsCap: number;
  readonly animationDtCapSeconds: number;
  readonly boardRect: Rect;
  readonly trayRect: Rect;
  readonly minimumViewportCss: readonly [width: number, height: number];
  readonly dragThresholdCssPx: number;
  readonly touchLiftCssPx: number;
  readonly minimumControlCssPx: number;
  readonly pauseOnHidden: boolean;
}

export const EFFECT_NAMES = ['pick', 'place', 'clear', 'invalid', 'game_over'] as const;

export interface AudioConfig {
  readonly masterVolume: number;
  readonly musicVolume: number;
  readonly sfxVolume: number;
  readonly musicTracks: readonly string[];
  readonly shuffle: boolean;
  readonly repeatPlaylist: boolean;
  readonly effects: Readonly<Record<(typeof EFFECT_NAMES)[number], string | null>>;
}

const HEX = /^#[0-9a-f]{6}$/i;

function color(v: Validator, value: unknown, path: string): string {
  const text = v.string(value, path);
  if (!HEX.test(text)) v.fail(path, 'must be a #RRGGBB color');
  return text;
}

/** Validates theme.json; every shape color key must have a color. */
export function parseTheme(json: unknown, requiredColorKeys: Iterable<string>): ThemeConfig {
  const v = new Validator('theme.json');
  const t = v.object(json, '', [
    'schema_version', 'theme_id', 'background', 'empty_cell', 'text', 'accent', 'invalid',
    'ghost_alpha', 'tile_corner_radius', 'colors', 'feedback_ms', 'reduced_motion', 'dark',
  ]);
  v.literal(t.schema_version, 'schema_version', [1]);
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(v.record(t.colors, 'colors'))) colors[key] = color(v, value, `colors.${key}`);
  for (const key of requiredColorKeys) if (!(key in colors)) v.fail(`colors.${key}`, 'is missing for a catalog shape');
  const feedback = v.object(t.feedback_ms, 'feedback_ms', ['place', 'clear', 'invalid_return']);
  const palette = (p: Json, prefix: string): ThemePalette => ({
    background: color(v, p.background, `${prefix}background`),
    emptyCell: color(v, p.empty_cell, `${prefix}empty_cell`),
    text: color(v, p.text, `${prefix}text`),
    accent: color(v, p.accent, `${prefix}accent`),
    invalid: color(v, p.invalid, `${prefix}invalid`),
  });
  return {
    themeId: v.string(t.theme_id, 'theme_id'),
    ...palette(t, ''),
    dark: palette(v.object(t.dark, 'dark', ['background', 'empty_cell', 'text', 'accent', 'invalid']), 'dark.'),
    ghostAlpha: v.int(t.ghost_alpha, 'ghost_alpha', 0, 255),
    tileCornerRadius: v.number(t.tile_corner_radius, 'tile_corner_radius', 0, 30),
    colors,
    feedbackMs: {
      place: v.int(feedback.place, 'feedback_ms.place', 0, 2000),
      clear: v.int(feedback.clear, 'feedback_ms.clear', 0, 2000),
      invalidReturn: v.int(feedback.invalid_return, 'feedback_ms.invalid_return', 0, 2000),
    },
    reducedMotion: v.boolean(t.reduced_motion, 'reduced_motion'),
  };
}

export function parseRuntime(json: unknown): RuntimeConfig {
  const v = new Validator('runtime.json');
  const r = v.object(json, '', [
    'schema_version', 'logical_size', 'renderer', 'resolution_cap', 'render_fps_cap', 'animation_dt_cap_seconds',
    'board_rect', 'tray_rect', 'minimum_viewport_css', 'drag_threshold_css_px', 'touch_lift_css_px',
    'minimum_control_css_px', 'pause_on_hidden',
  ]);
  v.literal(r.schema_version, 'schema_version', [1]);
  v.literal(r.renderer, 'renderer', ['webgl2']);
  const tuple = (value: unknown, path: string, length: number): number[] => {
    const items = v.array(value, path, length);
    if (items.length !== length) v.fail(path, `must have exactly ${length} numbers`);
    return items.map((n, i) => v.int(n, `${path}[${i}]`, 0, 10000));
  };
  const [lw, lh] = tuple(r.logical_size, 'logical_size', 2) as [number, number];
  if (lw === 0 || lh === 0) v.fail('logical_size', 'must be positive');
  const rect = (value: unknown, path: string): Rect => {
    const [x, y, w, h] = tuple(value, path, 4) as [number, number, number, number];
    if (w === 0 || h === 0 || x + w > lw || y + h > lh) v.fail(path, 'must be a non-empty rectangle inside logical_size');
    return [x, y, w, h];
  };
  return {
    logicalSize: [lw, lh],
    resolutionCap: v.number(r.resolution_cap, 'resolution_cap', 1, 4),
    renderFpsCap: v.int(r.render_fps_cap, 'render_fps_cap', 1, 240),
    animationDtCapSeconds: v.number(r.animation_dt_cap_seconds, 'animation_dt_cap_seconds', 0.001, 1),
    boardRect: rect(r.board_rect, 'board_rect'),
    trayRect: rect(r.tray_rect, 'tray_rect'),
    minimumViewportCss: tuple(r.minimum_viewport_css, 'minimum_viewport_css', 2) as [number, number],
    dragThresholdCssPx: v.number(r.drag_threshold_css_px, 'drag_threshold_css_px', 0, 100),
    touchLiftCssPx: v.number(r.touch_lift_css_px, 'touch_lift_css_px', 0, 200),
    minimumControlCssPx: v.number(r.minimum_control_css_px, 'minimum_control_css_px', 0, 200),
    pauseOnHidden: v.boolean(r.pause_on_hidden, 'pause_on_hidden'),
  };
}

export function parseAudio(json: unknown): AudioConfig {
  const v = new Validator('audio.json');
  const a = v.object(json, '', [
    'schema_version', 'master_volume', 'music_volume', 'sfx_volume', 'music_tracks', 'shuffle',
    'repeat_playlist', 'effects', 'missing_asset_policy',
  ]);
  v.literal(a.schema_version, 'schema_version', [1]);
  v.literal(a.missing_asset_policy, 'missing_asset_policy', ['silent_with_log']);
  const effectsJson = v.object(a.effects, 'effects', EFFECT_NAMES);
  const effects = Object.fromEntries(
    EFFECT_NAMES.map((name) => [name, effectsJson[name] === null ? null : v.relativePath(effectsJson[name], `effects.${name}`)]),
  ) as AudioConfig['effects'];
  return {
    masterVolume: v.number(a.master_volume, 'master_volume', 0, 1),
    musicVolume: v.number(a.music_volume, 'music_volume', 0, 1),
    sfxVolume: v.number(a.sfx_volume, 'sfx_volume', 0, 1),
    musicTracks: v.array(a.music_tracks, 'music_tracks').map((t, i) => v.relativePath(t, `music_tracks[${i}]`)),
    shuffle: v.boolean(a.shuffle, 'shuffle'),
    repeatPlaylist: v.boolean(a.repeat_playlist, 'repeat_playlist'),
    effects,
  };
}
