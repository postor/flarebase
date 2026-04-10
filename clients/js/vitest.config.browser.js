import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 15000,
    hookTimeout: 15000,
    teardownTimeout: 15000,
    environment: 'jsdom', // 使用jsdom模拟浏览器环境
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.browser.test.js'],
    exclude: ['node_modules', 'dist'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/'
      ]
    }
  },
});
