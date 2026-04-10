import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  get length() {
    return 0;
  },
  key: vi.fn()
};

global.localStorage = localStorageMock;

// Mock fetch globally
global.fetch = vi.fn();

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    id: 'test-session-id',
    emit: vi.fn(),
    on: vi.fn(function() { return this; }),
    off: vi.fn(function() { return this; }),
    disconnect: vi.fn(),
    connect: vi.fn()
  }))
}));

// Clear all mocks before each test
beforeEach(() => {
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();

  // Reset fetch mock
  global.fetch.mockReset();
  // Set default fetch response
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => []
  });
});
