import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The domain must stay pure (GDD 8.1): no browser, renderer, storage, audio, clock or Math.random.
const FORBIDDEN = [
  /from\s+['"](pixi\.js|@pixi\/[^'"]*)['"]/,
  /from\s+['"][^'"]*\/(application|presentation|adapters|bootstrap)(\/[^'"]*)?['"]/,
  /\b(window|document|navigator|localStorage|sessionStorage|indexedDB|AudioContext|fetch|crypto|performance|requestAnimationFrame|setTimeout|setInterval)\b/,
  /\bDate\.now\b|\bnew Date\b|\bMath\.random\b/,
];

function violations(source: string): RegExp[] {
  return FORBIDDEN.filter((re) => re.test(source));
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => join(e.parentPath, e.name));
}

describe('domain purity', () => {
  it('flags forbidden dependencies', () => {
    expect(violations("import { Graphics } from 'pixi.js';")).toHaveLength(1);
    expect(violations("import { x } from '../adapters/idb';")).toHaveLength(1);
    expect(violations('const t = performance.now();')).toHaveLength(1);
    expect(violations('const r = Math.random();')).toHaveLength(1);
    expect(violations("import { place } from './placement';")).toHaveLength(0);
  });

  it('src/domain imports no DOM, Pixi, storage, audio or clock APIs', () => {
    const offenders = tsFiles('src/domain').filter((f) => violations(readFileSync(f, 'utf8')).length > 0);
    expect(offenders).toEqual([]);
  });
});
