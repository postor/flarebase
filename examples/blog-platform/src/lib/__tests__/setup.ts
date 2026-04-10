/**
 * Vitest Setup File
 *
 * Configures test environment for unit tests
 */

import { beforeEach, vi } from 'vitest';

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

// Mock window object
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true
});

// Clear mocks before each test
beforeEach(() => {
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();
});

// Mock FlarebaseClient on window
Object.defineProperty(window, 'FlarebaseClient', {
  value: vi.fn(),
  writable: true
});
