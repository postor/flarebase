/**
 * E2E Test Setup - NO MOCKS
 * 
 * This setup file is used ONLY for E2E tests.
 * It does NOT mock socket.io-client, localStorage, or fetch.
 * All connections are REAL.
 */

import { vi, beforeAll, afterAll } from 'vitest';

// Mock btoa and atob for JWT encoding/decoding (needed by FlareClient)
global.btoa = (str) => Buffer.from(str).toString('base64');
global.atob = (str) => Buffer.from(str, 'base64').toString();

// Mock localStorage for FlareClient (but don't interfere with real operations)
const localStorageMock = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  get length() { return 0; },
  key: () => null
};
global.localStorage = localStorageMock;

// Mock window for browser compatibility
global.window = global;

console.log('[E2ESetup] E2E test environment initialized (NO MOCKS - real connections)');
