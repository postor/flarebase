/**
 * Flarebase Client Integration - TEMPORARY FIX
 *
 * Bypass named queries until query executor is fixed
 */

import { FlareClient as SDKFlareClient } from '@flarebase/client';
import type { User, LoginCredentials, RegistrationData, AuthResponse } from '@flarebase/client';

const FLAREBASE_URL = process.env.FLAREBASE_URL || 'http://localhost:3000';

/**
 * Flarebase Client wrapper for blog platform - TEMPORARY WORKAROUND
 */
export class FlarebaseClient {
  private client: SDKFlareClient;

  constructor(baseURL: string = FLAREBASE_URL) {
    this.client = new SDKFlareClient(baseURL);
  }

  get auth() {
    return this.client.auth;
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    return await this.client.login({ email, password });
  }

  async register(userData: { name: string; email: string; password: string }): Promise<AuthResponse> {
    return await this.client.register(userData);
  }

  logout(): void {
    this.client.logout();
  }

  getCurrentUser(): User | null {
    return this.client.user;
  }

  isAuthenticated(): boolean {
    return this.client.auth.isAuthenticated;
  }

  collection(name: string) {
    return this.client.collection(name);
  }

  /**
   * TEMPORARY WORKAROUND: Direct REST API calls instead of named queries
   * TODO: Revert this once query executor is fixed
   */
  async directApiCall(endpoint: string, method: string = 'GET', body?: any) {
    const url = `${FLAREBASE_URL}${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * TEMPORARY: Get published posts using direct collection access
   */
  async getPublishedPosts(limit: number = 20, offset: number = 0) {
    try {
      // Try named query first (might work after CORS fix)
      const result = await this.directApiCall(`/queries/get_published_posts`, 'POST', { limit, offset });

      // If result is an array, use it; otherwise fallback to collection access
      if (Array.isArray(result)) {
        return result;
      }

      // Fallback: direct collection access (will work with proper auth)
      console.warn('Named query returned non-array, using fallback');
      return await this.client.collection('posts').get();
    } catch (error) {
      console.error('Error fetching posts:', error);
      // Return empty array on error
      return [];
    }
  }

  /**
   * Blog-specific methods with fallbacks
   */
  get blogQueries() {
    return {
      checkEmailExists: async (email: string) => {
        // Direct collection query
        const posts = await this.client.collection('users').where('email', '==', email).get();
        return posts;
      },

      getUserByEmail: async (email: string) => {
        return await this.client.collection('users').where('email', '==', email).get();
      },

      getPublishedPosts: async (limit: number = 20, offset: number = 0) => {
        return await this.getPublishedPosts(limit, offset);
      },

      getPostBySlug: async (slug: string) => {
        return await this.client.collection('posts').where('slug', '==', slug).get();
      },

      getPostsByAuthor: async (authorId: string, limit: number = 20, offset: number = 0) => {
        return await this.client.collection('posts').where('author_id', '==', authorId).get();
      }
    };
  }
}

// Singleton instance
let clientInstance: FlarebaseClient | null = null;

export function getFlarebaseClient(): FlarebaseClient {
  if (!clientInstance) {
    clientInstance = new FlarebaseClient();
  }
  return clientInstance;
}

export default FlarebaseClient;
