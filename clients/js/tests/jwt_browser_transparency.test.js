/**
 * JWT Transparency Tests - Browser Environment
 *
 * Tests JWT transparency in a simulated browser environment (jsdom)
 * This complements the Node.js tests to ensure JWT transparency works in both environments
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FlareClient } from '../src/index.js';

describe('FlareClient - JWT Transparency (Browser Environment)', () => {
  let client;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create fresh client instance
    client = new FlareClient('http://test.local');
  });

  afterEach(() => {
    // Cleanup
    if (client && client.socket) {
      client.socket.disconnect();
    }
  });

  describe('Browser-specific localStorage behavior', () => {
    it('should use real localStorage in browser environment', () => {
      // In jsdom environment, localStorage is the real implementation
      expect(global.localStorage).toBeDefined();
      expect(typeof global.localStorage.setItem).toBe('function');
      expect(typeof global.localStorage.getItem).toBe('function');
      expect(typeof global.localStorage.removeItem).toBe('function');
    });

    it('should persist JWT to localStorage on login', async () => {
      // Create a valid JWT format
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({
        sub: 'user-browser',
        email: 'browser@example.com',
        role: 'user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      }));
      const signature = 'signature';
      const validJWT = `${header}.${payload}.${signature}`;

      // Mock socket.io for browser environment
      const mockSocket = {
        emit: vi.fn(),
        once: vi.fn((event, callback) => {
          if (event === 'hook_success') {
            setTimeout(() => {
              callback({
                token: validJWT,
                user: {
                  id: 'user-browser',
                  email: 'browser@example.com',
                  role: 'user'
                }
              });
            }, 10);
          }
          return mockSocket;
        }),
        off: vi.fn(() => mockSocket),
        disconnect: vi.fn()
      };

      client.socket = mockSocket;

      // Login
      await client.login({
        email: 'browser@example.com',
        password: 'password123'
      });

      // Verify JWT was saved to localStorage
      const storedToken = global.localStorage.getItem('flarebase_jwt');
      expect(storedToken).toBe(validJWT);

      const storedUser = global.localStorage.getItem('flarebase_user');
      expect(storedUser).toBeDefined();
      const parsedUser = JSON.parse(storedUser);
      expect(parsedUser.email).toBe('browser@example.com');
    });

    it('should restore JWT from localStorage on page reload', () => {
      // Simulate stored JWT from previous session
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({
        sub: 'user-restored',
        email: 'restored@example.com',
        role: 'user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      }));
      const signature = 'signature';
      const savedJWT = `${header}.${payload}.${signature}`;

      const savedUser = {
        id: 'user-restored',
        email: 'restored@example.com',
        role: 'user'
      };

      // Pre-populate localStorage (simulating page reload)
      global.localStorage.setItem('flarebase_jwt', savedJWT);
      global.localStorage.setItem('flarebase_user', JSON.stringify(savedUser));

      // Create new client instance (simulating page reload)
      const newClient = new FlareClient('http://test.local');

      // Verify JWT was automatically restored
      expect(newClient.jwt).toBe(savedJWT);
      expect(newClient.auth.isAuthenticated).toBe(true);
      expect(newClient.auth.user).toMatchObject({
        id: 'user-restored',
        email: 'restored@example.com',
        role: 'user'
      });

      // Cleanup
      global.localStorage.clear();
    });

    it('should clear JWT from localStorage on logout', () => {
      // Setup authenticated state
      client.jwt = 'test-token';
      client.user = { id: '123', email: 'test@example.com' };
      global.localStorage.setItem('flarebase_jwt', 'test-token');
      global.localStorage.setItem('flarebase_user', JSON.stringify(client.user));

      // Logout
      client.logout();

      // Verify localStorage was cleared
      expect(global.localStorage.getItem('flarebase_jwt')).toBeNull();
      expect(global.localStorage.getItem('flarebase_user')).toBeNull();
      expect(client.jwt).toBeNull();
      expect(client.user).toBeNull();
    });
  });

  describe('Browser environment compatibility', () => {
    it('should work with btoa/atob for JWT encoding/decoding', () => {
      // Test JWT encoding/decoding in browser environment
      const header = { alg: 'HS256', typ: 'JWT' };
      const payload = { sub: 'user-123', email: 'test@example.com', role: 'user' };

      // Encode
      const encodedHeader = btoa(JSON.stringify(header));
      const encodedPayload = btoa(JSON.stringify(payload));

      expect(encodedHeader).toBeDefined();
      expect(encodedPayload).toBeDefined();
      expect(typeof encodedHeader).toBe('string');
      expect(typeof encodedPayload).toBe('string');

      // Decode
      const decodedHeader = JSON.parse(atob(encodedHeader));
      const decodedPayload = JSON.parse(atob(encodedPayload));

      expect(decodedHeader).toMatchObject(header);
      expect(decodedPayload).toMatchObject(payload);
    });

    it('should handle JWT decoding in browser environment', () => {
      const validJWT = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({
        sub: 'user',
        email: 'test@example.com',
        role: 'user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      }))}.signature`;

      const payload = client._decodeJWT(validJWT);

      expect(payload).toBeDefined();
      expect(payload.sub).toBe('user');
      expect(payload.email).toBe('test@example.com');
      expect(payload.role).toBe('user');
      expect(payload.exp).toBeDefined();
      expect(payload.iat).toBeDefined();
    });

    it('should detect expired tokens in browser environment', () => {
      // Create an expired token (exp in the past)
      const expiredJWT = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({
        sub: 'user',
        email: 'test@example.com',
        role: 'user',
        iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
        exp: Math.floor(Date.now() / 1000) - 3600  // 1 hour ago
      }))}.signature`;

      const isExpired = client._isTokenExpired(expiredJWT);

      expect(isExpired).toBe(true);
    });

    it('should detect valid tokens in browser environment', () => {
      // Create a valid token (exp in the future)
      const validJWT = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({
        sub: 'user',
        email: 'test@example.com',
        role: 'user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600  // 1 hour in future
      }))}.signature`;

      const isExpired = client._isTokenExpired(validJWT);

      expect(isExpired).toBe(false);
    });
  });

  describe('Cross-environment consistency', () => {
    it('should have consistent API between Node.js and browser', () => {
      // Check that all critical methods exist
      expect(typeof client.login).toBe('function');
      expect(typeof client.register).toBe('function');
      expect(typeof client.logout).toBe('function');
      expect(typeof client.auth).toBe('object');
      expect(typeof client.auth.isAuthenticated).toBe('boolean');
      expect(typeof client.collection).toBe('function');
    });

    it('should have consistent JWT handling in both environments', async () => {
      const validJWT = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({
        sub: 'user-consistency',
        email: 'consistency@example.com',
        role: 'user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      }))}.signature`;

      const mockSocket = {
        emit: vi.fn(),
        once: vi.fn((event, callback) => {
          if (event === 'hook_success') {
            setTimeout(() => {
              callback({
                token: validJWT,
                user: {
                  id: 'user-consistency',
                  email: 'consistency@example.com',
                  role: 'user'
                }
              });
            }, 10);
          }
          return mockSocket;
        }),
        off: vi.fn(() => mockSocket),
        disconnect: vi.fn()
      };

      client.socket = mockSocket;

      // Test login flow
      await client.login({
        email: 'consistency@example.com',
        password: 'password'
      });

      // Verify consistent behavior
      expect(client.jwt).toBe(validJWT);
      expect(client.auth.isAuthenticated).toBe(true);
      expect(client.auth.user).toMatchObject({
        id: 'user-consistency',
        email: 'consistency@example.com',
        role: 'user'
      });
    });

    it('should handle localStorage errors gracefully in browser', () => {
      // Mock localStorage.setItem to throw an error (simulating quota exceeded)
      const originalSetItem = global.localStorage.setItem;
      global.localStorage.setItem = vi.fn(() => {
        throw new Error('QuotaExceededError');
      });

      // Should not throw, should handle gracefully
      expect(() => {
        client._setJWT('test-token', { id: '123', email: 'test@example.com' });
      }).not.toThrow();

      // Restore original
      global.localStorage.setItem = originalSetItem;
    });
  });

  describe('Browser-specific features', () => {
    it('should handle window object correctly', () => {
      // Check that window object exists in jsdom environment
      expect(global.window).toBeDefined();
      expect(typeof global.window).toBe('object');

      // Client should work correctly with window object
      expect(client.baseURL).toBe('http://test.local');
    });

    it('should persist session across multiple client instances', () => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({
        sub: 'user-multi',
        email: 'multi@example.com',
        role: 'user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      }));
      const validJWT = `${header}.${payload}.${signature`;

      // First client instance
      const client1 = new FlareClient('http://test.local');
      client1._setJWT(validJWT, {
        id: 'user-multi',
        email: 'multi@example.com',
        role: 'user'
      });

      // Create second client instance (simulating new tab/window)
      const client2 = new FlareClient('http://test.local');

      // Both should have access to the same JWT
      expect(client2.jwt).toBe(validJWT);
      expect(client2.auth.isAuthenticated).toBe(true);
      expect(client2.auth.user).toMatchObject({
        email: 'multi@example.com'
      });

      // Cleanup
      global.localStorage.clear();
    });
  });
});
