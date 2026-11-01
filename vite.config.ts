import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/{unit,config,domain,application,generator,property,layout,pointer,input_modes,states,persistence}/**/*.test.ts'],
    environment: 'node',
  },
});
