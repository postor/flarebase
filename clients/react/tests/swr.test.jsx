import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { FlarebaseProvider, useFlarebaseSWR, useFlarebaseDocumentSWR, useFlarebaseQuerySWR } from '../src/index.jsx';

// Mock SWR functionality
describe('useFlarebaseSWR - TDD Cycle 1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: '1', data: { title: 'Test Post', content: 'Test Content' } })
    });
  });

  it('should fetch data on mount and provide SWR methods', async () => {
    const wrapper = ({ children }) => React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

    const { result } = renderHook(() => useFlarebaseSWR('posts'), {
      wrapper
    });

    // Initial state - should be fetching
    expect(result.current).toMatchObject({
      data: undefined,
      isLoading: true
    });

    // Wait for data to load
    await waitFor(() => {
      expect(result.current).toMatchObject({
        data: { id: '1', data: { title: 'Test Post', content: 'Test Content' } },
        isLoading: false,
        isValidating: false
      });
      // Error can be null or undefined (no error)
      expect(result.current.error === null || result.current.error === undefined).toBe(true);
    });
  });

  it('should provide mutate function for manual updates', async () => {
    const wrapper = ({ children }) => React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

    const { result } = renderHook(() => useFlarebaseSWR('posts'), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    // Test mutate function
    const newData = { id: '2', data: { title: 'New Post' } };

    await act(async () => {
      await result.current.mutate(async () => {
        return newData;
      });
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(newData);
    });
  });

  it('should support revalidation with refetch', async () => {
    let fetchCallCount = 0;
    global.fetch.mockImplementation(() => {
      fetchCallCount++;
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: '1', data: { title: `Fetch ${fetchCallCount}` } })
      });
    });

    const wrapper = ({ children }) => React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

    const { result } = renderHook(() => useFlarebaseSWR('posts'), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
      expect(fetchCallCount).toBe(1);
    });

    // Test refetch
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(fetchCallCount).toBe(2);
      expect(result.current.data?.data?.title).toBe('Fetch 2');
    });
  });

  it('should handle errors gracefully', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));

    const wrapper = ({ children }) => React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

    const { result } = renderHook(() => useFlarebaseSWR('posts'), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current).toMatchObject({
        data: undefined,
        error: expect.any(Error),
        isLoading: false,
        isValidating: false
      });
      expect(result.current.error?.message).toBe('Network error');
    });
  });

  it('should support conditional fetching', async () => {
    const wrapper = ({ children }) => React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

    const { result, rerender } = renderHook(
      ({ enabled = false }) => useFlarebaseSWR('posts', { enabled }),
      { wrapper, initialProps: { enabled: false } }
    );

    // Should not fetch when disabled
    expect(result.current.isLoading).toBe(true); // Initial state is always loading

    // Enable and fetch
    rerender({ enabled: true });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
  });
});

describe('useFlarebaseDocumentSWR - TDD Cycle 1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: '1', data: { title: 'Post 1', author: 'John' } })
    });
  });

  const wrapper = ({ children }) => React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

  it('should fetch single document with SWR methods', async () => {
    const { result } = renderHook(() => useFlarebaseDocumentSWR('posts', '1'), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({ id: '1', data: { title: 'Post 1', author: 'John' } });
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('should provide update method for document mutation', async () => {
    const { result } = renderHook(() => useFlarebaseDocumentSWR('posts', '1'), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    // Test update
    await act(async () => {
      await result.current.update({ title: 'Updated Post' });
    });

    await waitFor(() => {
      expect(result.current.data?.data?.title).toBe('Updated Post');
    });
  });

  it('should support optimistic updates', async () => {
    const { result } = renderHook(() => useFlarebaseDocumentSWR('posts', '1'), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    // Test optimistic update
    await act(async () => {
      await result.current.update({ title: 'Optimistic Title' }, {
        optimistic: true
      });
    });

    // Should immediately update local data
    expect(result.current.data?.data?.title).toBe('Optimistic Title');
  });
});

describe('useFlarebaseQuerySWR - TDD Cycle 1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: '1', data: { status: 'published' } },
        { id: '2', data: { status: 'published' } }
      ]
    });
  });

  const wrapper = ({ children }) => React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

  it('should execute query with SWR methods', async () => {
    const filters = [['status', { Eq: 'published' }]];
    const { result } = renderHook(() => useFlarebaseQuerySWR('posts', filters), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2);
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('should support query invalidation', async () => {
    const filters = [['status', { Eq: 'published' }]];
    const { result } = renderHook(() => useFlarebaseQuerySWR('posts', filters), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    // Trigger invalidation
    act(() => {
      result.current.invalidate();
    });

    // Check that isValidating was set to true during invalidation
    await waitFor(() => {
      expect(result.current.isValidating).toBe(true);
    });
  });
});

describe('SWR Configuration - TDD Cycle 1', () => {
  const wrapper = ({ children }) => React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

  it('should support custom revalidation intervals', async () => {
    const { result } = renderHook(() =>
      useFlarebaseSWR('posts', { revalidateOnFocus: false, revalidateInterval: 5000 }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
  });

  it('should support custom fetcher functions', async () => {
    const customFetcher = vi.fn().mockResolvedValue({
      id: 'custom',
      data: { title: 'Custom Fetch' }
    });

    const { result } = renderHook(() =>
      useFlarebaseSWR('posts', { fetcher: customFetcher }),
      { wrapper }
    );

    await waitFor(() => {
      expect(customFetcher).toHaveBeenCalled();
      expect(result.current.data?.id).toBe('custom');
    });
  });
});
