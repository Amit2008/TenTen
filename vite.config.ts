import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/{unit,config,domain,application,generator,property,layout}/**/*.test.ts'],
    environment: 'node',
  },
});
