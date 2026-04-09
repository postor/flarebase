import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { FlarebaseProvider, useCollection } from '../src/index.jsx';

describe('useCollection - Simple Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: '1', data: { name: 'Test 1' } },
        { id: '2', data: { name: 'Test 2' } }
      ]
    });
  });

  it('should fetch collection data on mount', async () => {
    function TestComponent() {
      const { data, loading } = useCollection('users');

      if (loading) return React.createElement('div', { 'data-testid': 'loading' }, 'Loading...');
      return React.createElement('div', { 'data-testid': 'data' }, JSON.stringify(data));
    }

    render(
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
        React.createElement(TestComponent)
      )
    );

    // Initially should show loading
    expect(screen.getByTestId('loading')).toBeInTheDocument();

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('data')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should handle empty collections', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => []
    });

    function TestComponent() {
      const { data, loading } = useCollection('empty');

      if (loading) return React.createElement('div', { 'data-testid': 'loading' }, 'Loading...');
      return React.createElement('div', { 'data-testid': 'data' }, JSON.stringify(data));
    }

    render(
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
        React.createElement(TestComponent)
      )
    );

    await waitFor(() => {
      expect(screen.getByTestId('data')).toHaveTextContent('[]');
    }, { timeout: 3000 });
  });
});
