import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/{unit,config,domain,application,generator,property}/**/*.test.ts'],
    environment: 'node',
  },
});
