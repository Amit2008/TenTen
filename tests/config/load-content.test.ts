import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadContent, type FetchLike } from '../../src/adapters/content/load-content';
import { ContentError } from '../../src/domain/models/validation';

const BASE = 'https://host.test/TenTen/';

/** Serves public/ from disk; `overrides` replace a path's body or status. */
function fakeFetch(overrides: Record<string, string | number | Error> = {}, log: string[] = []): FetchLike {
  return async (url, init) => {
    log.push(`${url} cache=${init.cache ?? 'default'}`);
    const path = url.slice(BASE.length);
    const override = overrides[path];
    if (override instanceof Error) throw override;
    if (typeof override === 'number') return new Response('<html>not found</html>', { status: override });
    try {
      return new Response(override ?? readFileSync(`public/${path}`, 'utf8'));
    } catch {
      return new Response('missing', { status: 404 });
    }
  };
}

const release = (file: string) => `content/releases/1.1.0/${file}`;
const shipped = (file: string) => JSON.parse(readFileSync(`public/${release(file)}`, 'utf8'));

describe('loadContent', () => {
  it('loads, validates and freezes the shipped 1.1.0 release from a nested base', async () => {
    const log: string[] = [];
    const bundle = await loadContent(BASE, fakeFetch({}, log));
    expect(bundle.contentVersion).toBe('1.1.0');
    expect(bundle.releaseUrl).toBe(`${BASE}content/releases/1.1.0/`);
    expect(bundle.gameplay.catalog).toHaveLength(19);
    expect(bundle.gameplayHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(bundle.theme.colors.single).toBe('#247D80');
    expect(bundle.runtime.boardRect).toEqual([60, 190, 600, 600]);
    expect(bundle.audio.musicTracks).toEqual([]);
    expect(Object.isFrozen(bundle.runtime.boardRect)).toBe(true);
    // The index is revalidated; every request stays under the app base.
    expect(log[0]).toBe(`${BASE}content/index.json cache=no-cache`);
    expect(log.every((l) => l.startsWith(BASE))).toBe(true);
  });

  const failures: [string, Record<string, string | number | Error>, RegExp][] = [
    ['network failure', { 'content/index.json': new TypeError('Failed to fetch') }, /content\/index\.json .*network error/],
    ['missing manifest', { [release('manifest.json')]: 404 }, /manifest\.json .*HTTP 404/],
    ['HTML served for JSON', { [release('rules.json')]: '<!doctype html><p>SPA fallback</p>' }, /rules\.json .*not valid JSON/],
    ['truncated JSON', { [release('pieces.json')]: '{"schema_version": 1, "shapes": [' }, /pieces\.json .*not valid JSON/],
    ['stale manifest version', { [release('manifest.json')]: JSON.stringify({ ...shipped('manifest.json'), content_version: '1.0.0' }) }, /content_version must match the index/],
    ['unknown runtime contract', { [release('manifest.json')]: JSON.stringify({ ...shipped('manifest.json'), runtime_contract: 'webgl_puzzle_v2' }) }, /runtime_contract/],
    ['catalog not the manifest pieces file', { [release('rules.json')]: JSON.stringify({ ...shipped('rules.json'), generator: { ...shipped('rules.json').generator, catalog: 'other.json' } }) }, /generator\.catalog must name/],
    ['missing theme color', { [release('theme.json')]: JSON.stringify({ ...shipped('theme.json'), colors: { single: '#247D80' } }) }, /colors\.bar_2_h is missing/],
    ['invalid theme color', { [release('theme.json')]: JSON.stringify({ ...shipped('theme.json'), accent: 'teal' }) }, /accent must be a #RRGGBB color/],
    ['non-WebGL2 renderer', { [release('runtime.json')]: JSON.stringify({ ...shipped('runtime.json'), renderer: 'webgpu' }) }, /renderer/],
    ['board rect outside canvas', { [release('runtime.json')]: JSON.stringify({ ...shipped('runtime.json'), board_rect: [60, 190, 700, 600] }) }, /board_rect/],
    ['volume out of range', { [release('audio.json')]: JSON.stringify({ ...shipped('audio.json'), master_volume: 2 }) }, /master_volume/],
    ['cross-origin track', { [release('audio.json')]: JSON.stringify({ ...shipped('audio.json'), music_tracks: ['https://cdn.test/a.mp3'] }) }, /music_tracks\[0\]/],
  ];

  it.each(failures)('rejects %s with a ContentError', async (_label, overrides, expected) => {
    const load = loadContent(BASE, fakeFetch(overrides));
    await expect(load).rejects.toBeInstanceOf(ContentError);
    await expect(loadContent(BASE, fakeFetch(overrides))).rejects.toThrow(expected);
  });

  it('propagates cancellation instead of reporting a content error', async () => {
    const abort = new AbortController();
    abort.abort();
    const aborting: FetchLike = async (_url, init) => {
      throw init.signal?.reason ?? new Error('aborted');
    };
    await expect(loadContent(BASE, aborting, abort.signal)).rejects.not.toBeInstanceOf(ContentError);
  });
});
