import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { FlarebaseProvider, useFlarebaseSWR } from '../src/index.jsx';

describe('Security Tests - User Permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock user 1 (admin)
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'user1',
        data: { email: 'admin@test.com', name: 'Admin', role: 'admin' }
      })
    });

    // Mock posts
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'post1',
          data: { title: 'Admin Post', author_id: 'user1', content: 'Admin content' }
        },
        {
          id: 'post2',
          data: { title: 'User Post', author_id: 'user2', content: 'User content' }
        }
      ]
    });
  });

  it('SECURITY TEST: User should NOT be able to delete other users posts', async () => {
    const wrapper = ({ children }) =>
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

    // Simulate user1 trying to delete user2's post
    const { result } = renderHook(() => useFlarebaseSWR('posts'), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2);
    });

    // Mock delete operation
    const deleteSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch.mockImplementationOnce(() => Promise.resolve({
      ok: true,
      json: async () => ({ success: true })
    }));

    // Try to delete post belonging to user2
    const flarebase = require('../src/index.jsx').getFlarebaseClient();
    const postToDelete = result.current.data.find(p => p.data.author_id === 'user2');

    if (postToDelete) {
      // This should FAIL with permission error
      await expect(
        flarebase.collection('posts').doc(postToDelete.id).delete()
      ).rejects.toThrow('Permission denied');
    }
  });

  it('SECURITY TEST: User should be able to delete their own posts', async () => {
    const wrapper = ({ children }) =>
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

    const { result } = renderHook(() => useFlarebaseSWR('posts'), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(2);
    });

    // Mock successful delete for own post
    global.fetch.mockImplementationOnce(() => Promise.resolve({
      ok: true,
      json: async () => ({ success: true })
    }));

    // Try to delete own post (user1 deleting post1)
    const flarebase = require('../src/index.jsx').getFlarebaseClient();
    const ownPost = result.current.data.find(p => p.data.author_id === 'user1');

    if (ownPost) {
      // This should succeed
      const result = await flarebase.collection('posts').doc(ownPost.id).delete();
      expect(result).toBe(true);
    }
  });

  it('SECURITY TEST: Update operations should respect ownership', async () => {
    const wrapper = ({ children }) =>
      React.createElement(FlarebaseProvider, { baseURL: 'http://localhost:3000' }, children);

    const { result } = renderHook(() => useFlarebaseSWR('posts'), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    // Try to update other user's post
    const otherUsersPost = result.current.data.find(p => p.data.author_id === 'user2');

    if (otherUsersPost) {
      // This should FAIL with permission error
      await expect(
        flarebase.collection('posts').doc(otherUsersPost.id).update({ title: 'Hacked!' })
      ).rejects.toThrow('Permission denied');
    }
  });
});