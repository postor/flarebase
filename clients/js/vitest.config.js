import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 15000, // 15 seconds for slow tests
    hookTimeout: 15000,
    teardownTimeout: 15000,
  },
});
