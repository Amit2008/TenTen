import { readFileSync } from 'node:fs';

export const RELEASE_DIR = 'public/content/releases/1.1.0';

/** A fresh, mutable copy of a shipped content file. */
export function release(name: 'rules' | 'pieces' | 'theme' | 'runtime' | 'audio' | 'manifest'): any {
  return JSON.parse(readFileSync(`${RELEASE_DIR}/${name}.json`, 'utf8'));
}
