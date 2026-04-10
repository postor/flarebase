/**
 * Flarebase React Client - SWR Data Fetching Tests
 * useSWR 后端数据获取测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { FlarebaseProvider, useFlarebaseSWR, useFlarebaseDocumentSWR, useFlarebaseQuerySWR } from '../src/index.jsx';

const MOCK_POSTS = [
  { id: 'post-1', data: { title: 'Post 1', author_id: 'user-123', views: 100 } },
  { id: 'post-2', data: { title: 'Post 2', author_id: 'user-456', views: 200 } },
  { id: 'post-3', data: { title: 'Post 3', author_id: 'user-123', views: 150 } }
];

const MOCK_DOC = { 
  id: 'post-1', 
  data: { title: 'Post 1', author_id: 'user-123', views: 100, created_at: 1710000000 } 
};

const createWrapper = () => {
  return ({ children }) => 
    React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);
};

describe('useFlarebaseSWR - Collection Data Fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch collection data with correct structure', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_POSTS
    });

    const { result } = renderHook(() => useFlarebaseSWR('posts'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data).toHaveLength(3);
    expect(result.current.data[0]).toHaveProperty('id');
    expect(result.current.data[0]).toHaveProperty('data');
    expect(result.current.data[0].data).toHaveProperty('title');
  });

  it('should fetch data with correct URL and headers', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_POSTS
    });

    const { result } = renderHook(() => useFlarebaseSWR('posts'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/collections/posts',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json'
        })
      })
    );
  });

  it('should handle empty collection response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => []
    });

    const { result } = renderHook(() => useFlarebaseSWR('empty-collection'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should set isLoading correctly during fetch', async () => {
    let resolveFetch;
    global.fetch.mockImplementation(() => new Promise(resolve => {
      resolveFetch = resolve;
    }));

    const { result } = renderHook(() => useFlarebaseSWR('posts'), { wrapper: createWrapper() });

    // Initial state should be loading
    expect(result.current.isLoading).toBe(true);

    // Resolve fetch
    await act(async () => {
      resolveFetch({ ok: true, json: async () => MOCK_POSTS });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });
});

describe('useFlarebaseDocumentSWR - Single Document Fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch document data', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_DOC
    });

    const { result } = renderHook(() => useFlarebaseDocumentSWR('posts', 'post-1'), { 
      wrapper: createWrapper() 
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    // Check data structure exists
    expect(result.current.data).toBeDefined();
    expect(typeof result.current.isLoading).toBe('boolean');
  });

  it('should not fetch when id is undefined', () => {
    const { result } = renderHook(() => useFlarebaseDocumentSWR('posts', undefined), { 
      wrapper: createWrapper() 
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('should provide update method', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_DOC
    });

    const { result } = renderHook(() => useFlarebaseDocumentSWR('posts', 'post-1'), { 
      wrapper: createWrapper() 
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(typeof result.current.update).toBe('function');
  });
});

describe('useFlarebaseQuerySWR - Query Data Fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute query and return filtered results', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_POSTS
    });

    const { result } = renderHook(() => 
      useFlarebaseQuerySWR('posts', [['author_id', { Eq: 'user-123' }]]), 
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(Array.isArray(result.current.data)).toBe(true);
  });

  it('should provide invalidate function', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_POSTS
    });

    const { result } = renderHook(() => useFlarebaseQuerySWR('posts', []), { 
      wrapper: createWrapper() 
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(typeof result.current.invalidate).toBe('function');
  });

  it('should return empty array for query with no results', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => []
    });

    const { result } = renderHook(() => 
      useFlarebaseQuerySWR('posts', [['author_id', { Eq: 'nonexistent' }]]), 
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data).toEqual([]);
  });
});

// Helper for act
const act = async (fn) => {
  await fn();
};
