import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    environment: 'node',
    setupFiles: ['./tests/e2e-setup.js'],
    include: ['tests/e2e-plugin-client.test.js'],
    exclude: ['node_modules', 'dist'],
    globals: true,
    // Don't mock anything - real connections
    mockReset: false,
  },
});
