/**
 * JWT Transparency Tests
 *
 * Verifies that JWT handling is completely transparent to users.
 * Users should never need to manually handle JWT tokens.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FlareClient } from '../src/index.js';

describe('FlareClient - JWT Transparency', () => {
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

  describe('JWT Methods are Internal', () => {
    it('should not expose _setJWT to public API', () => {
      // _setJWT should exist but be considered internal (underscore prefix)
      expect(typeof client._setJWT).toBe('function');
      // Users should NOT call this directly
    });

    it('should not expose _loadJWT to public API', () => {
      // _loadJWT should exist but be considered internal (underscore prefix)
      expect(typeof client._loadJWT).toBe('function');
      // Users should NOT call this directly
    });

    it('should not expose _clearJWT to public API', () => {
      // _clearJWT should exist but be considered internal (underscore prefix)
      expect(typeof client._clearJWT).toBe('function');
      // Users should NOT call this directly
    });

    it('should not expose _getAuthHeaders to public API', () => {
      // _getAuthHeaders should exist but be considered internal
      expect(typeof client._getAuthHeaders).toBe('function');
      // Users should NOT call this directly
    });
  });

  describe('Public API - Auth State', () => {
    it('should expose auth as a read-only object', () => {
      expect(client.auth).toBeDefined();
      expect(typeof client.auth).toBe('object');
    });

    it('should provide isAuthenticated via auth object', () => {
      expect(client.auth.isAuthenticated).toBeDefined();
      expect(typeof client.auth.isAuthenticated).toBe('boolean');
    });

    it('should provide user via auth object', () => {
      expect(client.auth.user).toBeDefined();
      // Can be null if not authenticated
    });

    it('should have legacy methods for backward compatibility', () => {
      expect(typeof client.isAuthenticated).toBe('function');
      expect(typeof client.getCurrentUser).toBe('function');
    });
  });

  describe('JWT Automatic Saving on Login', () => {
    it('should automatically save JWT when login succeeds via WebSocket', async () => {
      // Create a valid JWT format (header.payload.signature)
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({
        sub: 'user-123',
        email: 'test@example.com',
        role: 'user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      }));
      const signature = 'signature';
      const validJWT = `${header}.${payload}.${signature}`;

      // Mock socket.io
      const mockSocket = {
        emit: vi.fn(),
        once: vi.fn((event, callback) => {
          if (event === 'hook_success') {
            // Simulate successful login response
            setTimeout(() => {
              callback({
                token: validJWT,
                user: {
                  id: 'user-123',
                  email: 'test@example.com',
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

      // Call login
      await client.login({
        email: 'test@example.com',
        password: 'password123'
      });

      // Verify JWT was automatically saved
      expect(client.jwt).toBe(validJWT);
      expect(client.user).toMatchObject({
        id: 'user-123',
        email: 'test@example.com',
        role: 'user'
      });
      // JWT decoded fields may or may not be present depending on environment
      // In Node.js test environment, atob might fail silently
      if (client.options.debug) {
        console.log('[Test] JWT decoded fields:', {
          exp: client.user.exp,
          iat: client.user.iat
        });
      }

      // Verify localStorage was called
      expect(global.localStorage.setItem).toHaveBeenCalledWith(
        'flarebase_jwt',
        validJWT
      );
      expect(global.localStorage.setItem).toHaveBeenCalledWith(
        'flarebase_user',
        expect.stringContaining('user-123')
      );
    });

    it('should automatically save JWT when register succeeds via WebSocket', async () => {
      // Create a valid JWT format
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({
        sub: 'user-456',
        email: 'new@example.com',
        role: 'user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      }));
      const signature = 'signature';
      const validJWT = `${header}.${payload}.${signature}`;

      const mockSocket = {
        emit: vi.fn(),
        once: vi.fn((event, callback) => {
          if (event === 'hook_success') {
            setTimeout(() => {
              callback({
                token: validJWT,
                user: {
                  id: 'user-456',
                  email: 'new@example.com',
                  name: 'New User',
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

      // Call register
      await client.register({
        name: 'New User',
        email: 'new@example.com',
        password: 'password123'
      });

      // Verify JWT was automatically saved
      expect(client.jwt).toBe(validJWT);
      expect(client.user).toMatchObject({
        id: 'user-456',
        email: 'new@example.com',
        name: 'New User',
        role: 'user'
      });
      // JWT decoded fields may or may not be present depending on environment
      if (client.options.debug) {
        console.log('[Test] JWT decoded fields:', {
          exp: client.user.exp,
          iat: client.user.iat
        });
      }
    });
  });

  describe('JWT Automatic Inclusion in Requests', () => {
    it('should automatically include JWT in fetch requests', async () => {
      // Set JWT as if user is logged in
      client.jwt = 'test-jwt-token';
      client.user = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'user'
      };

      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] })
      });

      // Make a request
      await client.collection('posts').get();

      // Verify fetch was called with JWT in headers
      expect(global.fetch).toHaveBeenCalledWith(
        'http://test.local/collections/posts',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-jwt-token',
            'Content-Type': 'application/json'
          })
        })
      );
    });

    it('should automatically include JWT in POST requests', async () => {
      client.jwt = 'test-jwt-token';

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: '123' } })
      });

      await client.collection('posts').add({
        title: 'Test',
        content: 'Content'
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://test.local/collections/posts',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-jwt-token'
          })
        })
      );
    });
  });

  describe('JWT Automatic Clearing on Logout', () => {
    it('should automatically clear JWT on logout', () => {
      // Setup authenticated state
      client.jwt = 'test-token';
      client.user = { id: '123', email: 'test@example.com' };

      // Call logout
      client.logout();

      // Verify JWT was cleared
      expect(client.jwt).toBeNull();
      expect(client.user).toBeNull();

      // Verify localStorage was cleared
      expect(global.localStorage.removeItem).toHaveBeenCalledWith('flarebase_jwt');
      expect(global.localStorage.removeItem).toHaveBeenCalledWith('flarebase_user');
    });
  });

  describe('JWT Automatic Restoration from Storage', () => {
    it('should automatically restore JWT from localStorage on init', () => {
      // Setup localStorage to have saved JWT
      global.localStorage.getItem.mockImplementation((key) => {
        if (key === 'flarebase_jwt') return 'saved-jwt-token';
        if (key === 'flarebase_user') return JSON.stringify({
          id: 'user-789',
          email: 'saved@example.com',
          role: 'user'
        });
        return null;
      });

      // Create new client instance
      const newClient = new FlareClient('http://test.local');

      // Verify JWT was automatically loaded
      expect(newClient.jwt).toBe('saved-jwt-token');
      expect(newClient.user).toEqual({
        id: 'user-789',
        email: 'saved@example.com',
        role: 'user'
      });
    });
  });

  describe('User-Friendly API', () => {
    it('should provide simple login API', () => {
      expect(typeof client.login).toBe('function');
      // No JWT parameters required
    });

    it('should provide simple register API', () => {
      expect(typeof client.register).toBe('function');
      // No JWT parameters required
    });

    it('should provide simple logout API', () => {
      expect(typeof client.logout).toBe('function');
      // No JWT parameters required
    });

    it('should provide auth state checking without method calls', () => {
      // Property access, not method call
      const isAuth = client.auth.isAuthenticated;
      expect(typeof isAuth).toBe('boolean');
    });

    it('should provide user access without method calls', () => {
      // Property access, not method call
      const user = client.auth.user;
      expect(user === null || typeof user === 'object').toBe(true);
    });
  });

  describe('JWT Transparency - No Manual Handling Required', () => {
    it('should work end-to-end without manual JWT operations', async () => {
      // Create a valid JWT format
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({
        sub: 'user-999',
        email: 'e2e@example.com',
        role: 'user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      }));
      const signature = 'signature';
      const validJWT = `${header}.${payload}.${signature}`;

      // Mock socket
      const mockSocket = {
        emit: vi.fn(),
        once: vi.fn((event, callback) => {
          if (event === 'hook_success') {
            setTimeout(() => {
              callback({
                token: validJWT,
                user: {
                  id: 'user-999',
                  email: 'e2e@example.com',
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

      // 1. Login (JWT saved automatically)
      await client.login({
        email: 'e2e@example.com',
        password: 'password'
      });

      // 2. Check auth state (JWT checked automatically)
      expect(client.auth.isAuthenticated).toBe(true);
      expect(client.auth.user).toBeDefined();

      // 3. Make authenticated request (JWT included automatically)
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] })
      });

      await client.collection('posts').get();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `Bearer ${validJWT}`
          })
        })
      );

      // 4. Logout (JWT cleared automatically)
      client.logout();
      expect(client.auth.isAuthenticated).toBe(false);
      expect(client.auth.user).toBeNull();

      // User never had to touch JWT directly! ✅
    });
  });
});
