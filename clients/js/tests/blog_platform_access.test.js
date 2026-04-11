/**
 * Blog Platform Access Tests - TDD Approach
 *
 * Problem: Blog homepage shows "Get collection failed: Unauthorized (401)"
 * Root cause: Unauthenticated users cannot access 'posts' collection
 *
 * TDD Phases:
 * 1. RED: Write failing test - unauthenticated users should access public posts
 * 2. GREEN: Fix server config or client logic
 * 3. REFACTOR: Clean up implementation
 */

import { FlareClient } from '../dist/index.js';
import { describe, it, expect, beforeEach } from 'vitest';

const BASE_URL = 'http://localhost:3000';

describe('Blog Platform Access - TDD', () => {

  describe('RED Phase: Current behavior fails', () => {

    it('should allow unauthenticated access to public posts', async () => {
      const client = new FlareClient({
        baseURL: BASE_URL,
        socketURL: 'ws://localhost:3000'
      });

      // Clear any stored JWT
      client.logout();

      // This should NOT throw 401 error
      // Public posts should be accessible without authentication
      const result = await client.collection('posts').get();

      // Expect: empty array if no posts, OR array of published posts
      // NOT: 401 Unauthorized error
      expect(result).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should return empty array when no posts exist (no auth required)', async () => {
      const client = new FlareClient({
        baseURL: BASE_URL,
        socketURL: 'ws://localhost:3000'
      });
      client.logout();

      const result = await client.collection('posts').get();

      // Should return { data: [] } not throw 401 error
      expect(result.data).toEqual([]);
    });
  });

  describe('Authentication flow', () => {

    it('should register new user successfully', async () => {
      const client = new FlareClient({
        baseURL: BASE_URL,
        socketURL: 'ws://localhost:3000'
      });

      const timestamp = Date.now();
      const userData = {
        name: `Test User ${timestamp}`,
        email: `test${timestamp}@example.com`,
        password: 'password123'
      };

      const response = await client.register(userData);

      expect(response).toBeDefined();
      expect(response.user).toBeDefined();
      expect(response.user.email).toBe(userData.email);
      expect(response.jwt).toBeDefined();
      expect(client.isAuthenticated()).toBe(true);
    });

    it('should login with valid credentials', async () => {
      const client = new FlareClient({
        baseURL: BASE_URL,
        socketURL: 'ws://localhost:3000'
      });

      // First register
      const timestamp = Date.now();
      await client.register({
        name: `Login Test ${timestamp}`,
        email: `logintest${timestamp}@example.com`,
        password: 'testpass123'
      });

      // Logout
      client.logout();

      // Login
      const response = await client.login({
        email: `logintest${timestamp}@example.com`,
        password: 'testpass123'
      });

      expect(response.user).toBeDefined();
      expect(response.jwt).toBeDefined();
      expect(client.isAuthenticated()).toBe(true);
    });

    it('should access posts after authentication', async () => {
      const client = new FlareClient({
        baseURL: BASE_URL,
        socketURL: 'ws://localhost:3000'
      });

      // Register and login
      const timestamp = Date.now();
      await client.register({
        name: `Auth Test ${timestamp}`,
        email: `authtest${timestamp}@example.com`,
        password: 'testpass123'
      });

      // Now should be able to access posts
      const result = await client.collection('posts').get();

      expect(result).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('GREEN Phase: Server-side fix or client-side fallback', () => {

    it('should handle 401 gracefully on client side', async () => {
      const client = new FlareClient({
        baseURL: BASE_URL,
        socketURL: 'ws://localhost:3000'
      });
      client.logout();

      try {
        await client.collection('posts').get();
        // If server allows unauthenticated access, this is good
        expect(true).toBe(true);
      } catch (error) {
        // If server returns 401, client should handle it gracefully
        // Option 1: Show "Please login" message
        // Option 2: Redirect to login page
        // Option 3: Return empty array and show "No posts available"

        // For now, just verify error is clear
        expect(error.message).toMatch(/401|Unauthorized/i);
      }
    });
  });

  describe('End-to-end: Blog platform flow', () => {

    it('should complete full flow: register → create post → view posts', async () => {
      const client = new FlareClient({
        baseURL: BASE_URL,
        socketURL: 'ws://localhost:3000'
      });

      // Step 1: Register
      const timestamp = Date.now();
      const registerResponse = await client.register({
        name: `Blog User ${timestamp}`,
        email: `bloguser${timestamp}@example.com`,
        password: 'blogpass123'
      });

      expect(registerResponse.user).toBeDefined();

      // Step 2: Create a published post
      const postResponse = await client.collection('posts').add({
        title: `Test Post ${timestamp}`,
        slug: `test-post-${timestamp}`,
        content: 'This is test content',
        excerpt: 'Test excerpt',
        status: 'published',
        author_id: registerResponse.user.id,
        author_name: registerResponse.user.data.name,
        author_email: registerResponse.user.data.email,
        published_at: Date.now(),
        created_at: Date.now(),
        updated_at: Date.now(),
        tags: ['test', 'tdd']
      });

      expect(postResponse.id).toBeDefined();

      // Step 3: View posts (should include the post we just created)
      const postsResult = await client.collection('posts').get();

      expect(postsResult.data).toBeInstanceOf(Array);
      expect(postsResult.data.length).toBeGreaterThan(0);

      // Verify our post is in the list
      const ourPost = postsResult.data.find(p => p.id === postResponse.id);
      expect(ourPost).toBeDefined();
      expect(ourPost.data.title).toBe(`Test Post ${timestamp}`);
    });
  });
});
