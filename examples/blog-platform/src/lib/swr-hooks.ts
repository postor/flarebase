/**
 * SWR Hooks for Flarebase with JWT Authentication
 *
 * Updated for TypeScript SDK v0.2.0
 */

import useSWR from 'swr';
import { getFlarebaseClient } from './flarebase';
import type { SWRConfiguration } from 'swr';

/**
 * Use current user information
 */
export function useUser() {
  const client = getFlarebaseClient();

  return {
    user: client.getCurrentUser(),
    isAuthenticated: client.isAuthenticated(),
    isLoading: false
  };
}

/**
 * Authentication Hook
 */
export function useAuth() {
  const client = getFlarebaseClient();

  return {
    user: client.getCurrentUser(),
    isAuthenticated: client.isAuthenticated(),

    login: async (email: string, password: string) => {
      return await client.login(email, password);
    },

    register: async (userData: { name: string; email: string; password: string }) => {
      return await client.register(userData);
    },

    logout: () => {
      client.logout();
    }
  };
}

/**
 * Articles Hook (fetches all published articles)
 */
export function useArticles(options?: SWRConfiguration) {
  const client = getFlarebaseClient();

  const fetcher = async () => {
    return await client.getArticles();
  };

  return useSWR('articles', fetcher, options);
}

/**
 * My Articles Hook (requires authentication)
 */
export function useMyArticles(options?: SWRConfiguration) {
  const client = getFlarebaseClient();

  const fetcher = async () => {
    return await client.getMyArticles();
  };

  return useSWR('my-articles', fetcher, {
    ...options,
    refreshInterval: 5000 // Refresh every 5 seconds
  });
}

/**
 * Single Article Hook
 */
export function useArticle(id: string, options?: SWRConfiguration) {
  const client = getFlarebaseClient();

  const fetcher = async () => {
    if (!id) return null;
    return await client.getArticle(id);
  };

  return useSWR(id ? `article-${id}` : null, fetcher, options);
}

/**
 * Named Query Hook
 */
export function useNamedQuery<T = any>(
  queryName: string,
  params: Record<string, any> = {},
  options?: SWRConfiguration
) {
  const client = getFlarebaseClient();

  const fetcher = async () => {
    return await client.namedQuery<T>(queryName, params);
  };

  return useSWR(queryName, fetcher, options);
}

/**
 * Conditional Query Hook
 */
export function useConditionalQuery<T = any>(
  condition: boolean,
  queryName: string,
  params: Record<string, any> = {},
  options?: SWRConfiguration
) {
  const client = getFlarebaseClient();

  const fetcher = async () => {
    return await client.namedQuery<T>(queryName, params);
  };

  return useSWR<T>(condition ? queryName : null, fetcher, options);
}
