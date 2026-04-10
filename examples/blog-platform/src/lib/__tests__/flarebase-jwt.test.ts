// Flarebase JWT Client Unit Tests
//
// These tests verify the JWT-enabled Flarebase client functionality

import { FlarebaseClient } from '../src/lib/flarebase-jwt';

// Mock Socket.IO
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    off: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn(),
    id: 'mock_socket_id',
  })),
}));

describe('FlarebaseClient', () => {
  let client: FlarebaseClient;
  let mockLocalStorage: Record<string, string>;

  beforeEach(() => {
    // Mock localStorage
    mockLocalStorage = {};
    global.localStorage = {
      getItem: jest.fn((key: string) => mockLocalStorage[key] || null),
      setItem: jest.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: jest.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
      clear: jest.fn(),
    } as any;

    client = new FlarebaseClient('http://localhost:3000');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('JWT Storage', () => {
    it('should store JWT token in localStorage', () => {
      client['setJWT']('mock_token', {
        id: 'user_123',
        email: 'test@example.com',
        role: 'user'
      });

      expect(global.localStorage.setItem).toHaveBeenCalledWith(
        'flarebase_jwt',
        'mock_token'
      );
      expect(global.localStorage.setItem).toHaveBeenCalledWith(
        'flarebase_user',
        JSON.stringify({
          id: 'user_123',
          email: 'test@example.com',
          role: 'user'
        })
      );
    });

    it('should load JWT from localStorage on initialization', () => {
      mockLocalStorage['flarebase_jwt'] = 'stored_token';
      mockLocalStorage['flarebase_user'] = JSON.stringify({
        id: 'user_456',
        email: 'stored@example.com',
        role: 'admin'
      });

      const newClient = new FlarebaseClient('http://localhost:3000');

      expect(newClient['jwt']).toBe('stored_token');
      expect(newClient['user']).toEqual({
        id: 'user_456',
        email: 'stored@example.com',
        role: 'admin'
      });
    });

    it('should clear JWT on logout', () => {
      client['setJWT']('mock_token', {
        id: 'user_123',
        email: 'test@example.com',
        role: 'user'
      });

      client.logout();

      expect(global.localStorage.removeItem).toHaveBeenCalledWith('flarebase_jwt');
      expect(global.localStorage.removeItem).toHaveBeenCalledWith('flarebase_user');
      expect(client['jwt']).toBeNull();
      expect(client['user']).toBeNull();
    });
  });

  describe('Authentication Methods', () => {
    it('should login via auth hook', async () => {
      const mockSocket = {
        on: jest.fn(),
        once: jest.fn((event: string, callback: any) => {
          if (event === 'hook_success') {
            callback({
              token: 'login_token',
              user: {
                id: 'user_789',
                email: 'login@example.com',
                role: 'user'
              }
            });
          }
        }),
        emit: jest.fn(),
      };

      client['socket'] = mockSocket;
      client['isConnected'] = true;

      const result = await client.login('login@example.com', 'password');

      expect(result.token).toBe('login_token');
      expect(result.user.email).toBe('login@example.com');
      expect(client['jwt']).toBe('login_token');
      expect(client['user']).toEqual(result.user);
    });

    it('should register via auth hook', async () => {
      const mockSocket = {
        once: jest.fn((event: string, callback: any) => {
          if (event === 'hook_success') {
            callback({
              token: 'register_token',
              user: {
                id: 'user_999',
                email: 'new@example.com',
                role: 'user'
              }
            });
          }
        }),
        emit: jest.fn(),
      };

      client['socket'] = mockSocket;
      client['isConnected'] = true;

      const result = await client.register({
        name: 'New User',
        email: 'new@example.com',
        password: 'password'
      });

      expect(result.token).toBe('register_token');
      expect(result.user.email).toBe('new@example.com');
      expect(client['jwt']).toBe('register_token');
    });

    it('should handle login timeout', async () => {
      const mockSocket = {
        once: jest.fn(),
        emit: jest.fn(),
      };

      client['socket'] = mockSocket;
      client['isConnected'] = true;

      await expect(
        client.login('timeout@example.com', 'password')
      ).rejects.toThrow('Login request timed out');
    });

    it('should handle login errors', async () => {
      const mockSocket = {
        once: jest.fn((event: string, callback: any) => {
          if (event === 'hook_error') {
            callback({ message: 'Invalid credentials' });
          }
        }),
        emit: jest.fn(),
      };

      client['socket'] = mockSocket;
      client['isConnected'] = true;

      await expect(
        client.login('error@example.com', 'wrong_password')
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('HTTP REST Methods', () => {
    it('should include JWT in Authorization header', () => {
      client['jwt'] = 'test_token';

      const headers = client['getAuthHeaders']();

      expect(headers).toEqual({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token'
      });
    });

    it('should not include Authorization header when no JWT', () => {
      client['jwt'] = null;

      const headers = client['getAuthHeaders']();

      expect(headers).toEqual({
        'Content-Type': 'application/json'
      });
      expect(headers).not.toHaveProperty('Authorization');
    });

    it('should execute named query via REST', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'success' })
      });

      client['jwt'] = 'test_token';

      const result = await client.namedQueryREST('test_query', { param1: 'value1' });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/queries/test_query',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test_token'
          },
          body: JSON.stringify({ param1: 'value1' })
        }
      );

      expect(result).toEqual({ result: 'success' });
    });

    it('should handle HTTP errors', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized'
      });

      await expect(
        client.namedQueryREST('protected_query')
      ).rejects.toThrow('Query failed: Unauthorized');
    });
  });

  describe('Authentication Status', () => {
    it('should return true when authenticated', () => {
      client['jwt'] = 'valid_token';
      expect(client.isAuthenticated()).toBe(true);
    });

    it('should return false when not authenticated', () => {
      client['jwt'] = null;
      expect(client.isAuthenticated()).toBe(false);
    });

    it('should return current user', () => {
      const mockUser = {
        id: 'user_123',
        email: 'user@example.com',
        role: 'user'
      };

      client['user'] = mockUser;
      expect(client.getCurrentUser()).toEqual(mockUser);
    });

    it('should return null when no user', () => {
      client['user'] = null;
      expect(client.getCurrentUser()).toBeNull();
    });
  });

  describe('Collection Operations', () => {
    it('should create collection reference', () => {
      const collection = client.collection('posts');

      expect(collection).toBeDefined();
      expect(collection.name).toBe('posts');
    });
  });

  describe('Error Handling', () => {
    it('should handle localStorage errors gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      global.localStorage.setItem = jest.fn(() => {
        throw new Error('localStorage full');
      });

      client['setJWT']('token', null);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to store JWT in localStorage:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should handle invalid JSON in localStorage', () => {
      global.localStorage.getItem = jest.fn((key: string) => {
        if (key === 'flarebase_user') {
          return 'invalid json';
        }
        return null;
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const newClient = new FlarebaseClient('http://localhost:3000');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load JWT from localStorage:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('SWR Integration', () => {
    it('should provide swrFetcher function', () => {
      client['jwt'] = 'swr_token';

      const fetcher = client.swrFetcher;

      expect(typeof fetcher).toBe('function');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: 'test' })
      });

      const promise = fetcher('/queries/test');

      expect(promise).resolves.toBeDefined();
    });

    it('should include JWT in swrFetcher requests', async () => {
      client['jwt'] = 'swr_token';

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: 'test' })
      });

      const fetcher = client.swrFetcher;
      await fetcher('/queries/test');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/queries/test',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer swr_token'
          },
          body: JSON.stringify({})
        }
      );
    });
  });

  describe('Socket.IO Integration', () => {
    it('should connect socket on first use', () => {
      const io = require('socket.io-client');
      const mockSocket = {
        on: jest.fn(),
        id: 'test_socket_id'
      };

      io.io.mockReturnValue(mockSocket);

      client['ensureConnected']();

      expect(io.io).toHaveBeenCalledWith('http://localhost:3000', {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });
    });

    it('should reuse existing socket connection', () => {
      const mockSocket = {
        on: jest.fn(),
        id: 'existing_socket_id'
      };

      client['socket'] = mockSocket;
      client['isConnected'] = true;

      const socket = client['ensureConnected']();

      expect(socket).toBe(mockSocket);
    });
  });
});
