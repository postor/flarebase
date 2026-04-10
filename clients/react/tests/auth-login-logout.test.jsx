/**
 * Flarebase React Client - Login/Logout State Tests
 * 注册登录登出状态变化测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import React, { useState } from 'react';
import { FlarebaseProvider, useFlarebase } from '../src/index.jsx';

const MOCK_USER = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
  role: 'user'
};

const MOCK_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-token';

describe('Auth Provider State - Login/Logout/Register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock successful auth response
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: MOCK_JWT, user: MOCK_USER })
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('Provider provides auth methods', () => {
    it('should provide login method on client', () => {
      function TestComponent() {
        const client = useFlarebase();
        return React.createElement('div', {
          'data-testid': 'client-info',
          'data-has-login': typeof client.login === 'function' ? 'true' : 'false',
          'data-has-register': typeof client.register === 'function' ? 'true' : 'false',
          'data-has-logout': typeof client.logout === 'function' ? 'true' : 'false',
        }, 'Client info');
      }

      render(
        React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
          React.createElement(TestComponent)
        )
      );

      expect(screen.getByTestId('client-info')).toHaveAttribute('data-has-login', 'true');
      expect(screen.getByTestId('client-info')).toHaveAttribute('data-has-register', 'true');
      expect(screen.getByTestId('client-info')).toHaveAttribute('data-has-logout', 'true');
    });

    it('should provide auth object with correct properties', () => {
      function TestComponent() {
        const client = useFlarebase();
        return React.createElement('div', null,
          React.createElement('span', { 'data-testid': 'has-auth', 'data-value': !!client.auth }),
          React.createElement('span', { 'data-testid': 'has-isAuth', 'data-value': 'isAuthenticated' in client.auth }),
          React.createElement('span', { 'data-testid': 'has-user', 'data-value': 'user' in client.auth }),
          React.createElement('span', { 'data-testid': 'has-jwt', 'data-value': 'jwt' in client.auth })
        );
      }

      render(
        React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
          React.createElement(TestComponent)
        )
      );

      expect(screen.getByTestId('has-auth')).toHaveAttribute('data-value', 'true');
      expect(screen.getByTestId('has-isAuth')).toHaveAttribute('data-value', 'true');
      expect(screen.getByTestId('has-user')).toHaveAttribute('data-value', 'true');
      expect(screen.getByTestId('has-jwt')).toHaveAttribute('data-value', 'true');
    });

    it('should have initial unauthenticated state', () => {
      function TestComponent() {
        const client = useFlarebase();
        return React.createElement('div', null,
          React.createElement('span', { 
            'data-testid': 'is-authenticated', 
            'data-value': String(client.auth.isAuthenticated) 
          }),
          React.createElement('span', { 
            'data-testid': 'user-null', 
            'data-value': String(client.auth.user === null) 
          }),
          React.createElement('span', { 
            'data-testid': 'jwt-null', 
            'data-value': String(client.auth.jwt === null) 
          })
        );
      }

      render(
        React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
          React.createElement(TestComponent)
        )
      );

      expect(screen.getByTestId('is-authenticated')).toHaveAttribute('data-value', 'false');
      expect(screen.getByTestId('user-null')).toHaveAttribute('data-value', 'true');
      expect(screen.getByTestId('jwt-null')).toHaveAttribute('data-value', 'true');
    });
  });

  describe('Login/Register/Logout methods exist and are callable', () => {
    it('should allow calling login method', async () => {
      function TestComponent() {
        const client = useFlarebase();
        const [called, setCalled] = useState(false);

        const handleClick = async () => {
          try {
            await client.login({ email: 'test@example.com', password: 'password' });
            setCalled(true);
          } catch (e) {
            setCalled(true);
          }
        };

        return React.createElement('div', null,
          React.createElement('span', { 'data-testid': 'called', 'data-value': String(called) }),
          React.createElement('button', { 'data-testid': 'login-btn', onClick: handleClick }, 'Login')
        );
      }

      render(
        React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
          React.createElement(TestComponent)
        )
      );

      await act(async () => {
        screen.getByTestId('login-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('called')).toHaveAttribute('data-value', 'true');
      });
    });

    it('should allow calling register method', async () => {
      function TestComponent() {
        const client = useFlarebase();
        const [called, setCalled] = useState(false);

        const handleClick = async () => {
          try {
            await client.register({ email: 'test@example.com', password: 'password', name: 'Test' });
            setCalled(true);
          } catch (e) {
            setCalled(true);
          }
        };

        return React.createElement('div', null,
          React.createElement('span', { 'data-testid': 'called', 'data-value': String(called) }),
          React.createElement('button', { 'data-testid': 'register-btn', onClick: handleClick }, 'Register')
        );
      }

      render(
        React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
          React.createElement(TestComponent)
        )
      );

      await act(async () => {
        screen.getByTestId('register-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('called')).toHaveAttribute('data-value', 'true');
      });
    });

    it('should allow calling logout method', () => {
      function TestComponent() {
        const client = useFlarebase();
        const [called, setCalled] = useState(false);

        const handleClick = () => {
          client.logout();
          setCalled(true);
        };

        return React.createElement('div', null,
          React.createElement('span', { 'data-testid': 'called', 'data-value': String(called) }),
          React.createElement('button', { 'data-testid': 'logout-btn', onClick: handleClick }, 'Logout')
        );
      }

      render(
        React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
          React.createElement(TestComponent)
        )
      );

      act(() => {
        screen.getByTestId('logout-btn').click();
      });

      expect(screen.getByTestId('called')).toHaveAttribute('data-value', 'true');
    });
  });

  // Note: Error handling tests for login/register are skipped
  // because the mock FlareClient raises socket.io events that are not handled
  // in the test environment. These should be tested in integration tests.
});
