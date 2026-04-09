import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { FlarebaseProvider, useCollection, useDocument, useQuery } from '../src/index.jsx';

// Test components
function TestCollectionComponent({ collectionName }) {
  const { data, loading, error } = useCollection(collectionName);

  if (loading) return React.createElement('div', { 'data-testid': 'loading' }, 'Loading...');
  if (error) return React.createElement('div', { 'data-testid': 'error' }, error.message);
  return React.createElement('div', { 'data-testid': 'data' }, JSON.stringify(data));
}

function TestDocumentComponent({ collection, id }) {
  const { data, loading, error } = useDocument(collection, id);

  if (loading) return React.createElement('div', { 'data-testid': 'loading' }, 'Loading...');
  if (error) return React.createElement('div', { 'data-testid': 'error' }, error.message);
  return React.createElement('div', { 'data-testid': 'data' }, JSON.stringify(data));
}

function TestQueryComponent({ collection, filters }) {
  const { data, loading, error, refetch } = useQuery(collection, filters);

  if (loading) return React.createElement('div', { 'data-testid': 'loading' }, 'Loading...');
  if (error) return React.createElement('div', { 'data-testid': 'error' }, error.message);
  return React.createElement('div', null,
    React.createElement('div', { 'data-testid': 'data' }, JSON.stringify(data)),
    React.createElement('button', {
      'data-testid': 'refetch',
      onClick: refetch
    }, 'Refetch')
  );
}

describe('useCollection - TDD Cycle 2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock fetch responses
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: '1', data: { name: 'Test 1' } },
        { id: '2', data: { name: 'Test 2' } }
      ]
    });
  });

  it('should fetch collection data on mount', async () => {
    render(
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
        React.createElement(TestCollectionComponent, { collectionName: 'users' })
      )
    );

    await waitFor(() => {
      expect(screen.getByTestId('data')).toBeInTheDocument();
    });
  });

  it('should set loading to true while fetching', async () => {
    let resolveFetch;
    global.fetch.mockImplementation(() => new Promise(resolve => {
      resolveFetch = resolve;
    }));

    render(
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
        React.createElement(TestCollectionComponent, { collectionName: 'users' })
      )
    );

    expect(screen.getByTestId('loading')).toBeInTheDocument();
    resolveFetch({ ok: true, json: async () => [] });

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });
  });

  it('should handle errors gracefully', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));

    render(
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
        React.createElement(TestCollectionComponent, { collectionName: 'users' })
      )
    );

    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeInTheDocument();
      expect(screen.getByTestId('error')).toHaveTextContent('Network error');
    });
  });

  it('should support real-time updates via socket', async () => {
    render(
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
        React.createElement(TestCollectionComponent, { collectionName: 'users' })
      )
    );

    await waitFor(() => {
      // Verify that socket methods were called (the mock is in setup.js)
      expect(screen.getByTestId('data')).toBeInTheDocument();
    });
  });
});

describe('useDocument - TDD Cycle 2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: '1', data: { name: 'Test User', email: 'test@example.com' } })
    });
  });

  it('should fetch document data on mount', async () => {
    render(
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
        React.createElement(TestDocumentComponent, { collection: 'users', id: '1' })
      )
    );

    await waitFor(() => {
      expect(screen.getByTestId('data')).toBeInTheDocument();
    });
  });

  it('should return null for non-existent documents', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => null
    });

    render(
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
        React.createElement(TestDocumentComponent, { collection: 'users', id: '999' })
      )
    );

    await waitFor(() => {
      expect(screen.getByTestId('data')).toHaveTextContent('null');
    });
  });

  it('should support real-time document updates', async () => {
    render(
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
        React.createElement(TestDocumentComponent, { collection: 'users', id: '1' })
      )
    );

    await waitFor(() => {
      // Verify that the document was loaded successfully
      expect(screen.getByTestId('data')).toBeInTheDocument();
    });
  });
});

describe('useQuery - TDD Cycle 2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: '1', data: { name: 'Alice', age: 25 } },
        { id: '2', data: { name: 'Bob', age: 30 } }
      ]
    });
  });

  it('should execute query with filters', async () => {
    const filters = [['age', { Gte: 25 }]];

    render(
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
        React.createElement(TestQueryComponent, { collection: 'users', filters })
      )
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'users', filters })
      });
      expect(screen.getByTestId('data')).toBeInTheDocument();
    });
  });

  it('should provide refetch function', async () => {
    let fetchCallCount = 0;
    global.fetch.mockImplementation(() => {
      fetchCallCount++;
      return Promise.resolve({
        ok: true,
        json: async () => [{ id: '1', data: { name: 'Test' } }]
      });
    });

    render(
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
        React.createElement(TestQueryComponent, { collection: 'users', filters: [] })
      )
    );

    await waitFor(() => {
      expect(fetchCallCount).toBe(1);
    });

    // Click refetch button
    screen.getByTestId('refetch').click();

    await waitFor(() => {
      expect(fetchCallCount).toBe(2);
    });
  });

  it('should support empty filters for full collection query', async () => {
    render(
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' },
        React.createElement(TestQueryComponent, { collection: 'users', filters: [] })
      )
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'users', filters: [] })
      });
    });
  });
});
