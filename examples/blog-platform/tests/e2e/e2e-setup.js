/**
 * E2E Test Setup for Blog Platform
 *
 * This file is run before E2E tests. It sets up the environment
 * with NO mocks - all connections are real.
 */

// Polyfill btoa/atob for Node.js (JWT encoding)
if (typeof btoa === 'undefined') {
  global.btoa = (str) => Buffer.from(str).toString('base64');
}

if (typeof atob === 'undefined') {
  global.atob = (str) => Buffer.from(str, 'base64').toString('binary');
}

// Minimal localStorage polyfill (non-interfering)
if (typeof localStorage === 'undefined') {
  global.localStorage = {
    _store: {},
    getItem: function(key) {
      return this._store[key] || null;
    },
    setItem: function(key, value) {
      this._store[key] = String(value);
    },
    removeItem: function(key) {
      delete this._store[key];
    },
    clear: function() {
      this._store = {};
    }
  };
}

// Set global window reference
if (typeof window === 'undefined') {
  global.window = {
    localStorage: global.localStorage
  };
}

// Log test environment info
console.log('🧪 E2E Test Environment Setup:');
console.log(`  FLARE_URL: ${process.env.FLARE_URL || 'http://localhost:3000'}`);
console.log(`  E2E_TEST_MODE: ${process.env.E2E_TEST_MODE || 'false'}`);
console.log(`  Node.js: ${process.version}`);
console.log('  Mocks: NONE (real connections)\n');
