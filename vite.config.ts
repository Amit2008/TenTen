import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/config/**/*.test.ts'],
    environment: 'node',
  },
});
