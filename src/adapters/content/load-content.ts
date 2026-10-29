import { canonicalGameplayJson, parseGameplay } from '../../domain/models/gameplay-config';
import type { GameplayConfig } from '../../domain/models/types';
import { ContentError, Validator, deepFreeze } from '../../domain/models/validation';
import { parseAudio, parseRuntime, parseTheme, type AudioConfig, type RuntimeConfig, type ThemeConfig } from './presentation-config';

export const RUNTIME_CONTRACT = 'webgl_puzzle_v1';
const MANIFEST_FILES = ['rules', 'pieces', 'theme', 'runtime', 'audio'] as const;

/** One validated, frozen content selection. A session keeps it even if the hosted index changes. */
export interface ContentBundle {
  readonly contentVersion: string;
  /** Directory of the versioned manifest; audio and other assets resolve against it. */
  readonly releaseUrl: string;
  readonly gameplay: GameplayConfig;
  /** `sha256:<hex>` of the canonical gameplay encoding; separates rulesets, saves and best scores. */
  readonly gameplayHash: string;
  readonly colorKeys: Readonly<Record<string, string>>;
  readonly theme: ThemeConfig;
  readonly runtime: RuntimeConfig;
  readonly audio: AudioConfig;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Fetches content/index.json (revalidated), its versioned manifest and every required file, validates all of
 * them, and computes the gameplay hash. Throws ContentError on network, HTTP, JSON or schema failure.
 */
export async function loadContent(appBaseUrl: string, fetchFn: FetchLike, signal: AbortSignal | null = null): Promise<ContentBundle> {
  const indexUrl = new URL('content/index.json', appBaseUrl).href;
  const v = new Validator('content/index.json');
  const index = v.object(await fetchJson(fetchFn, indexUrl, 'content/index.json', { cache: 'no-cache', signal }), '', [
    'schema_version', 'content_version', 'manifest',
  ]);
  v.literal(index.schema_version, 'schema_version', [1]);
  const contentVersion = v.string(index.content_version, 'content_version');
  const manifestUrl = new URL(v.relativePath(index.manifest, 'manifest'), indexUrl).href;

  const m = new Validator('manifest.json');
  const manifest = m.object(await fetchJson(fetchFn, manifestUrl, 'manifest.json', { signal }), '', [
    'schema_version', 'content_version', 'runtime_contract', 'files',
  ]);
  m.literal(manifest.schema_version, 'schema_version', [1]);
  // A stale or mismatched manifest must not start a different ruleset silently.
  if (manifest.content_version !== contentVersion) m.fail('content_version', `must match the index ("${contentVersion}")`);
  m.literal(manifest.runtime_contract, 'runtime_contract', [RUNTIME_CONTRACT]);
  const files = m.object(manifest.files, 'files', MANIFEST_FILES);
  const paths = Object.fromEntries(MANIFEST_FILES.map((k) => [k, m.relativePath(files[k], `files.${k}`)])) as Record<
    (typeof MANIFEST_FILES)[number],
    string
  >;

  const [rules, pieces, theme, runtime, audio] = await Promise.all(
    MANIFEST_FILES.map((k) => fetchJson(fetchFn, new URL(paths[k], manifestUrl).href, `${k}.json`, { signal })),
  );
  const gameplay = parseGameplay(rules, pieces);
  if (gameplay.catalogFile !== paths.pieces)
    throw new ContentError('rules.json', 'generator.catalog', `must name the manifest's pieces file ("${paths.pieces}")`);

  return deepFreeze({
    contentVersion,
    releaseUrl: new URL('./', manifestUrl).href,
    gameplay: gameplay.config,
    gameplayHash: await gameplayHash(gameplay.config),
    colorKeys: gameplay.colorKeys,
    theme: parseTheme(theme, Object.values(gameplay.colorKeys)),
    runtime: parseRuntime(runtime),
    audio: parseAudio(audio),
  });
}

export async function gameplayHash(config: GameplayConfig): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalGameplayJson(config)));
  return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function fetchJson(fetchFn: FetchLike, url: string, file: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ContentError(file, '', 'could not be downloaded (network error)');
  }
  if (!response.ok) throw new ContentError(file, '', `could not be downloaded (HTTP ${response.status})`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ContentError(file, '', 'is not valid JSON');
  }
}
