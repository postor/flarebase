/**
 * Vitest E2E Configuration for Blog Platform
 *
 * This config is used for running E2E tests with real server connections.
 * NO mocks - uses actual WebSocket and HTTP connections.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/e2e/e2e-setup.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['tests/e2e/blog.test.ts'],
    mockReset: false, // Ensure real connections are used
    reporters: ['verbose'],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true // Run tests sequentially for E2E
      }
    }
  }
});
