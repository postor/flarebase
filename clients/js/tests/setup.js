/**
 * Vitest Setup File
 *
 * Mocks for testing environment
 */

import { vi } from 'vitest';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(() => null),
  removeItem: vi.fn(() => null),
  clear: vi.fn(() => null),
  get length() { return 0; },
  key: vi.fn(() => null)
};

global.localStorage = localStorageMock;

// Mock window object for browser APIs
global.window = global;

// Mock fetch
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: async () => ({ data: [] }),
  })
);

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

// Mock btoa and atob for JWT encoding/decoding
global.btoa = (str) => Buffer.from(str).toString('base64');
global.atob = (str) => Buffer.from(str, 'base64').toString();

// Clear all mocks before each test
beforeEach(() => {
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();
  vi.clearAllMocks();
});

console.log('[TestSetup] Test environment initialized');
