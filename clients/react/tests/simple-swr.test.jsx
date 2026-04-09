import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { FlarebaseProvider, useFlarebaseSWR } from '../src/index.jsx';

describe('useFlarebaseSWR - Simple Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: '1', data: { title: 'Test Post' } })
    });
  });

  it('should fetch data and provide SWR interface', async () => {
    const wrapper = ({ children }) =>
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

    const { result } = renderHook(() => useFlarebaseSWR('posts'), { wrapper });

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.data).toEqual({ id: '1', data: { title: 'Test Post' } });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isValidating).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  it('should provide mutate and refetch methods', async () => {
    const wrapper = ({ children }) =>
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

    const { result } = renderHook(() => useFlarebaseSWR('posts'), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
      expect(result.current.mutate).toBeDefined();
      expect(result.current.refetch).toBeDefined();
    });
  });
});
