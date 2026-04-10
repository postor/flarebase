/**
 * Flarebase Client Integration - TEMPORARY WORKAROUND VERSION
 *
 * Using direct API calls to bypass broken named query executor
 */

import { FlareClient as SDKFlareClient } from '@flarebase/client';
import type { User, LoginCredentials, RegistrationData, AuthResponse } from '@flarebase/client';

const FLAREBASE_URL = process.env.FLAREBASE_URL || 'http://localhost:3000';

/**
 * Flarebase Client wrapper for blog platform
 */
export class FlarebaseClient {
  private client: SDKFlareClient;

  constructor(baseURL: string = FLAREBASE_URL) {
    this.client = new SDKFlareClient(baseURL);
  }

  /**
   * Get authentication state
   */
  get auth() {
    return this.client.auth;
  }

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<AuthResponse> {
    return await this.client.login({ email, password });
  }

  /**
   * Register new user
   */
  async register(userData: { name: string; email: string; password: string }): Promise<AuthResponse> {
    return await this.client.register(userData);
  }

  /**
   * Logout current user
   */
  logout(): void {
    this.client.logout();
  }

  /**
   * Get current user
   */
  getCurrentUser(): User | null {
    return this.client.user;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.client.auth.isAuthenticated;
  }

  /**
   * Get collection reference
   */
  collection(name: string) {
    return this.client.collection(name);
  }

  /**
   * Get all articles
   */
  async getArticles() {
    return await this.client.collection('posts').get();
  }

  /**
   * Get article by ID
   */
  async getArticle(id: string) {
    return await this.client.collection('posts').doc(id).get();
  }

  /**
   * Create new article
   */
  async createArticle(articleData: { title: string; content: string; status?: string }) {
    return await this.client.collection('posts').add({
      ...articleData,
      status: articleData.status || 'draft',
      created_at: Date.now(),
      updated_at: Date.now()
    });
  }

  /**
   * Update article
   */
  async updateArticle(id: string, updates: any) {
    return await this.client.collection('posts').doc(id).update({
      ...updates,
      updated_at: Date.now()
    });
  }

  /**
   * Delete article
   */
  async deleteArticle(id: string) {
    return await this.client.collection('posts').doc(id).delete();
  }

  /**
   * Get user's articles
   */
  async getMyArticles() {
    const client = this.client;
    if (!client.auth.user?.id) {
      return [];
    }

    // Query articles by author_id
    return await this.client
      .collection('posts')
      .where('author_id', '==', client.auth.user.id)
      .get();
  }

  /**
   * Execute named query
   */
  async namedQuery<T = any>(queryName: string, params: Record<string, any> = {}): Promise<T> {
    return await this.client.namedQuery<T>(queryName, params);
  }

  /**
   * Named query with REST (for compatibility)
   */
  async namedQueryREST<T = any>(queryName: string, params: Record<string, any> = {}): Promise<T> {
    return await this.namedQuery<T>(queryName, params);
  }

  /**
   * Blog-specific named queries for convenience
   */
  get blogQueries() {
    return {
      /**
       * Check if email already exists
       */
      checkEmailExists: async (email: string) => {
        return await this.namedQuery<any[]>('check_email_exists', { email });
      },

      /**
       * Get user by email
       */
      getUserByEmail: async (email: string) => {
        return await this.namedQuery<any[]>('get_user_by_email', { email });
      },

      /**
       * Get published posts with pagination
       */
      getPublishedPosts: async (limit: number = 20, offset: number = 0) => {
        return await this.namedQuery<any[]>('get_published_posts', { limit, offset });
      },

      /**
       * Get post by slug
       */
      getPostBySlug: async (slug: string) => {
        const result = await this.namedQuery<any[]>('get_post_by_slug', { slug });
        return result && result.length > 0 ? result[0] : null;
      },

      /**
       * Get posts by author
       */
      getPostsByAuthor: async (authorId: string, limit: number = 20, offset: number = 0) => {
        return await this.namedQuery<any[]>('get_posts_by_author', { author_id: authorId, limit, offset });
      }
    };
  }
}

// Singleton instance
let clientInstance: FlarebaseClient | null = null;

/**
 * Get Flarebase client instance
 */
export function getFlarebaseClient(): FlarebaseClient {
  if (!clientInstance) {
    clientInstance = new FlarebaseClient();
  }
  return clientInstance;
}

export default FlarebaseClient;
