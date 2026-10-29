import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Domain and application must stay pure (GDD 8.1): no browser, renderer, storage, audio, clock or Math.random.
const BROWSER_AND_CLOCK = [
  /from\s+['"](pixi\.js|@pixi\/[^'"]*)['"]/,
  /\b(window|document|navigator|localStorage|sessionStorage|indexedDB|AudioContext|fetch|crypto|performance|requestAnimationFrame|setTimeout|setInterval)\b/,
  /\bDate\.now\b|\bnew Date\b|\bMath\.random\b/,
];
const outerLayers = (layers: string) => new RegExp(`from\\s+['"][^'"]*\\/(${layers})(\\/[^'"]*)?['"]`);
const RULES = {
  'src/domain': [...BROWSER_AND_CLOCK, outerLayers('application|presentation|adapters|bootstrap')],
  'src/application': [...BROWSER_AND_CLOCK, outerLayers('presentation|adapters|bootstrap')],
};

function violations(source: string, rules: RegExp[]): RegExp[] {
  return rules.filter((re) => re.test(source));
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => join(e.parentPath, e.name));
}

describe('layer purity', () => {
  it('flags forbidden dependencies', () => {
    const domain = RULES['src/domain'];
    expect(violations("import { Graphics } from 'pixi.js';", domain)).toHaveLength(1);
    expect(violations("import { x } from '../adapters/idb';", domain)).toHaveLength(1);
    expect(violations("import { x } from '../../application/session';", domain)).toHaveLength(1);
    expect(violations("import { x } from '../../application/session';", RULES['src/application'])).toHaveLength(0);
    expect(violations('const t = performance.now();', domain)).toHaveLength(1);
    expect(violations('const r = Math.random();', domain)).toHaveLength(1);
    expect(violations("import { place } from './placement';", domain)).toHaveLength(0);
  });

  it.each(Object.entries(RULES))('%s imports no DOM, Pixi, storage, audio, clock or outer-layer code', (dir, rules) => {
    const offenders = tsFiles(dir).filter((f) => violations(readFileSync(f, 'utf8'), rules).length > 0);
    expect(offenders).toEqual([]);
  });
});
