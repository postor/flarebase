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

// Mock socket.io-client with proper callback support
const createMockSocket = () => {
  const handlers = {};
  
  return {
    id: 'test-session-id',
    emit: vi.fn(),
    on: vi.fn((event, handler) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    once: vi.fn((event, handler) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push({ once: true, handler });
    }),
    off: vi.fn((event, handler) => {
      if (handlers[event]) {
        handlers[event] = handlers[event].filter(h => 
          handler ? (typeof h === 'object' ? h.handler !== handler : h !== handler) : true
        );
      }
    }),
    disconnect: vi.fn(),
    connect: vi.fn(),
    // Helper to trigger events (for tests)
    _triggerEvent: (event, ...args) => {
      if (handlers[event]) {
        handlers[event].forEach(h => {
          if (typeof h === 'object' && h.once) {
            h.handler(...args);
          } else if (typeof h === 'function') {
            h(...args);
          }
        });
        // Remove 'once' handlers after triggering
        handlers[event] = handlers[event].filter(h => typeof h === 'function');
      }
    }
  };
};

const mockSocket = createMockSocket();

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket)
}));

// Export mockSocket for tests to use
global.mockSocket = mockSocket;

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
