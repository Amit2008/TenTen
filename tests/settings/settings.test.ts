import { describe, expect, it } from 'vitest';
import { snapshot } from '../../src/application/save/envelope';
import { appliedTheme, parseSettings, reducesMotion, type Settings } from '../../src/application/settings/settings';

const DEFAULTS: Settings = { masterVolume: 80, musicVolume: 50, effectsVolume: 70, theme: 'light', motion: 'system' };

describe('parseSettings', () => {
  it('uses defaults for an empty record (first launch)', () => {
    expect(parseSettings({}, DEFAULTS)).toEqual(DEFAULTS);
  });

  it('keeps valid stored values', () => {
    const stored = { masterVolume: 0, musicVolume: 100, effectsVolume: 35, theme: 'high_contrast', motion: 'reduce' };
    expect(parseSettings(stored, DEFAULTS)).toEqual(stored);
  });

  it('replaces each invalid value with its default without failing the rest', () => {
    const stored = { masterVolume: 101, musicVolume: 12.5, effectsVolume: '50', theme: 'neon', motion: 'reduce', unknownFromNewerBuild: true };
    expect(parseSettings(stored, DEFAULTS)).toEqual({ ...DEFAULTS, motion: 'reduce' });
  });
});

describe('reducesMotion', () => {
  const s = (motion: Settings['motion']) => ({ ...DEFAULTS, motion });
  it.each([
    ['system', false, false, false],
    ['system', true, false, true],
    ['system', false, true, true],
    ['reduce', false, false, true],
    ['full', true, true, false],
  ] as const)('%s with system=%s theme=%s -> %s', (motion, system, theme, expected) => {
    expect(reducesMotion(s(motion), system, theme)).toBe(expected);
  });
});

describe('settings in the save envelope', () => {
  it('a move snapshot keeps the stored settings', () => {
    const previous = { schemaVersion: 1 as const, contentVersion: 'x', active: null, best: {}, settings: { motion: 'reduce' } };
    const run = { sessionId: 's', gameplayHash: 'h', revision: 0, board: { columns: 1, rows: 1, cells: [null] }, tray: [], score: 0, status: 'active' as const, generator: { algorithm: 'xorshift32_v1' as const, version: 1 as const, seed: 1, state: 1 }, nextInstanceId: 1 };
    expect(snapshot(previous, 'y', run).settings).toEqual({ motion: 'reduce' });
  });
});

describe('appliedTheme', () => {
  it.each([
    ['system', false, 'light'],
    ['system', true, 'dark'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['high_contrast', true, 'high_contrast'],
  ] as const)('%s with system dark=%s -> %s', (theme, dark, expected) => {
    expect(appliedTheme({ ...DEFAULTS, theme }, dark)).toBe(expected);
  });

  it('keeps a stored dark choice', () => {
    expect(parseSettings({ theme: 'dark' }, DEFAULTS).theme).toBe('dark');
  });
});
