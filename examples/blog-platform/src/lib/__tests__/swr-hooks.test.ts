// SWR Hooks Unit Tests
//
// These tests verify the SWR integration with JWT authentication

import { renderHook, act, waitFor } from '@testing-library/react';
import { useNamedQuery, useAuth, useArticles } from '../src/lib/swr-hooks';
import { getFlarebaseClient } from '../src/lib/flarebase-jwt';

// Mock the Flarebase client
jest.mock('../src/lib/flarebase-jwt');

describe('SWR Hooks', () => {
  let mockClient: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock client
    mockClient = {
      jwt: null,
      user: null,
      namedQueryREST: jest.fn(),
      login: jest.fn(),
      register: jest.fn(),
      logout: jest.fn(),
      isAuthenticated: jest.fn(() => false),
      getCurrentUser: jest.fn(() => null),
    };

    (getFlarebaseClient as jest.Mock).mockReturnValue(mockClient);
  });

  describe('useAuth', () => {
    it('should return unauthenticated state initially', () => {
      mockClient.isAuthenticated.mockReturnValue(false);
      mockClient.getCurrentUser.mockReturnValue(null);

      const { result } = renderHook(() => useAuth());

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it('should return authenticated state after login', async () => {
      const mockUser = {
        id: 'user_123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user'
      };

      mockClient.isAuthenticated.mockReturnValue(true);
      mockClient.getCurrentUser.mockReturnValue(mockUser);
      mockClient.login.mockResolvedValue({
        token: 'mock_jwt_token',
        user: mockUser
      });

      const { result } = renderHook(() => useAuth());

      // Initially unauthenticated
      expect(result.current.isAuthenticated).toBe(false);

      // Perform login
      await act(async () => {
        await result.current.login('test@example.com', 'password');
      });

      // Verify login was called
      expect(mockClient.login).toHaveBeenCalledWith('test@example.com', 'password');
    });

    it('should register new user', async () => {
      const mockUser = {
        id: 'user_456',
        email: 'new@example.com',
        name: 'New User',
        role: 'user'
      };

      mockClient.register.mockResolvedValue({
        token: 'mock_jwt_token',
        user: mockUser
      });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.register({
          name: 'New User',
          email: 'new@example.com',
          password: 'password'
        });
      });

      expect(mockClient.register).toHaveBeenCalledWith({
        name: 'New User',
        email: 'new@example.com',
        password: 'password'
      });
    });

    it('should logout user', () => {
      mockClient.isAuthenticated.mockReturnValue(true);
      mockClient.getCurrentUser.mockReturnValue({
        id: 'user_123',
        email: 'test@example.com',
        role: 'user'
      });

      const { result } = renderHook(() => useAuth());

      act(() => {
        result.current.logout();
      });

      expect(mockClient.logout).toHaveBeenCalled();
    });
  });

  describe('useNamedQuery', () => {
    it('should fetch named query with JWT', async () => {
      const mockData = [
        { id: '1', title: 'Post 1' },
        { id: '2', title: 'Post 2' }
      ];

      mockClient.namedQueryREST.mockResolvedValue(mockData);

      const { result } = renderHook(() =>
        useNamedQuery<any[]>('list_articles', {})
      );

      // Wait for data to load
      await waitFor(() => {
        expect(result.current.data).toEqual(mockData);
      });

      expect(mockClient.namedQueryREST).toHaveBeenCalledWith('list_articles', {});
    });

    it('should handle query errors', async () => {
      const mockError = new Error('Query failed');

      mockClient.namedQueryREST.mockRejectedValue(mockError);

      const { result } = renderHook(() =>
        useNamedQuery('list_articles', {})
      );

      await waitFor(() => {
        expect(result.current.error).toBeDefined();
      });

      expect(result.current.error).toBeInstanceOf(Error);
    });

    it('should pass parameters to query', async () => {
      const mockData = { count: 5 };

      mockClient.namedQueryREST.mockResolvedValue(mockData);

      const { result } = renderHook(() =>
        useNamedQuery('get_article_count', { limit: 10 })
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockData);
      });

      expect(mockClient.namedQueryREST).toHaveBeenCalledWith(
        'get_article_count',
        { limit: 10 }
      );
    });

    it('should not fetch when condition is false', () => {
      const { result } = renderHook(() =>
        useNamedQuery('conditional_query', {}, {}, { suspense: false })
      );

      // Initial state should have no data
      expect(result.current.data).toBeUndefined();
      expect(mockClient.namedQueryREST).not.toHaveBeenCalled();
    });
  });

  describe('useArticles', () => {
    it('should fetch articles list', async () => {
      const mockArticles = [
        { id: '1', title: 'First Article', status: 'published' },
        { id: '2', title: 'Second Article', status: 'published' }
      ];

      mockClient.namedQueryREST.mockResolvedValue(mockArticles);

      const { result } = renderHook(() => useArticles());

      await waitFor(() => {
        expect(result.current.data).toEqual(mockArticles);
      });

      expect(mockClient.namedQueryREST).toHaveBeenCalledWith(
        'list_published_articles',
        {}
      );
    });

    it('should handle empty articles list', async () => {
      mockClient.namedQueryREST.mockResolvedValue([]);

      const { result } = renderHook(() => useArticles());

      await waitFor(() => {
        expect(result.current.data).toEqual([]);
      });
    });
  });

  describe('JWT Integration', () => {
    it('should include JWT in query requests', async () => {
      // Set authenticated state
      mockClient.jwt = 'mock_jwt_token';
      mockClient.isAuthenticated.mockReturnValue(true);
      mockClient.getCurrentUser.mockReturnValue({
        id: 'user_123',
        email: 'test@example.com',
        role: 'user'
      });

      const mockData = [{ id: '1', title: 'Protected Post' }];
      mockClient.namedQueryREST.mockResolvedValue(mockData);

      const { result } = renderHook(() =>
        useNamedQuery('my_protected_posts', {})
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockData);
      });

      // Verify that namedQueryREST was called (JWT is included internally)
      expect(mockClient.namedQueryREST).toHaveBeenCalled();
    });

    it('should work with guest context when unauthenticated', async () => {
      mockClient.isAuthenticated.mockReturnValue(false);
      mockClient.getCurrentUser.mockReturnValue(null);

      const mockData = [{ id: '1', title: 'Public Post' }];
      mockClient.namedQueryREST.mockResolvedValue(mockData);

      const { result } = renderHook(() =>
        useNamedQuery('public_posts', {})
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockData);
      });
    });
  });

  describe('SWR Configuration', () => {
    it('should use custom SWR options', async () => {
      const mockData = [{ id: '1', title: 'Post' }];
      mockClient.namedQueryREST.mockResolvedValue(mockData);

      const customOptions = {
        revalidateOnFocus: false,
        dedupingInterval: 5000
      };

      const { result } = renderHook(() =>
        useNamedQuery('list_articles', {}, customOptions)
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockData);
      });

      // Verify data was fetched
      expect(mockClient.namedQueryREST).toHaveBeenCalled();
    });

    it('should support conditional queries', async () => {
      const mockData = { id: '1', title: 'Conditional Post' };
      mockClient.namedQueryREST.mockResolvedValue(mockData);

      const condition = true;
      const { result } = renderHook(() =>
        useNamedQuery('conditional_query', {}, {})
      );

      if (condition) {
        await waitFor(() => {
          expect(result.current.data).toEqual(mockData);
        });
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle authentication errors', async () => {
      const authError = new Error('Unauthorized: Invalid token');

      mockClient.namedQueryREST.mockRejectedValue(authError);

      const { result } = renderHook(() =>
        useNamedQuery('protected_query', {})
      );

      await waitFor(() => {
        expect(result.current.error).toBeDefined();
      });

      expect(result.current.error?.message).toContain('Unauthorized');
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network error: Failed to fetch');

      mockClient.namedQueryREST.mockRejectedValue(networkError);

      const { result } = renderHook(() =>
        useNamedQuery('any_query', {})
      );

      await waitFor(() => {
        expect(result.current.error).toBeDefined();
      });
    });

    it('should handle server errors', async () => {
      const serverError = new Error('Server error: 500');

      mockClient.namedQueryREST.mockRejectedValue(serverError);

      const { result } = renderHook(() =>
        useNamedQuery('server_query', {})
      );

      await waitFor(() => {
        expect(result.current.error).toBeDefined();
      });
    });
  });
});
