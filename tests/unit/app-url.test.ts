import { describe, expect, it } from 'vitest';
import { appUrl } from '../../src/bootstrap/app-url';

describe('appUrl', () => {
  it('resolves against the root base', () => {
    expect(appUrl('icon.svg', 'https://example.test/')).toBe('https://example.test/icon.svg');
  });

  it('stays inside a nested base, even for leading-slash paths', () => {
    expect(appUrl('content/index.json', 'https://example.test/TenTen/')).toBe('https://example.test/TenTen/content/index.json');
    expect(appUrl('/icon.svg', 'https://example.test/TenTen/')).toBe('https://example.test/TenTen/icon.svg');
  });
});
