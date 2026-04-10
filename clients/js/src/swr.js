// SWR Integration for Flarebase
//
// This module provides SWR (stale-while-revalidate) integration
// for React applications using Flarebase with JWT authentication.

import useSWR from 'swr';

/**
 * Create a Flarebase SWR hook
 * @param {FlareClient} client - Flarebase client instance
 * @returns {Function} SWR hook factory
 */
export function createFlarebaseSWR(client) {
  /**
   * SWR fetcher with JWT authentication
   * @param {string} url - Query URL
   * @returns {Promise<any>} Query results
   */
  const fetcher = async (url) => {
    const response = await fetch(`${client.baseURL}${url}`, {
      method: 'POST',
      headers: client._getAuthHeaders(),
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`);
    }

    return response.json();
  };

  /**
   * Hook for fetching a named query
   * @param {string} queryName - Name of the query
   * @param {object} params - Query parameters
   * @param {object} options - SWR options
   * @returns {object} SWR response
   */
  const useNamedQuery = (queryName, params = {}, options = {}) => {
    const url = `/queries/${queryName}`;
    return useSWR(url, fetcher, options);
  };

  /**
   * Hook for fetching documents from a collection
   * @param {string} collection - Collection name
   * @param {object} options - SWR options
   * @returns {object} SWR response
   */
  const useCollection = (collection, options = {}) => {
    const url = `/collections/${collection}`;
    return useSWR(url, fetcher, options);
  };

  /**
   * Hook for fetching a single document
   * @param {string} collection - Collection name
   * @param {string} id - Document ID
   * @param {object} options - SWR options
   * @returns {object} SWR response
   */
  const useDocument = (collection, id, options = {}) => {
    if (!id) {
      return { data: null, error: null, isLoading: false };
    }
    const url = `/collections/${collection}/${id}`;
    return useSWR(url, fetcher, options);
  };

  return {
    fetcher,
    useNamedQuery,
    useCollection,
    useDocument,
  };
}

/**
 * React Hook for Flarebase authentication with SWR
 * @param {FlareClient} client - Flarebase client instance
 * @returns {object} Auth state and methods
 */
export function useFlarebaseAuth(client) {
  const [user, setUser] = React.useState(() => client.getCurrentUser());
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const login = async (credentials) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await client.login(credentials);
      setUser(result.user);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await client.register(userData);
      setUser(result.user);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    client.logout();
    setUser(null);
    setError(null);
  };

  return {
    user,
    isAuthenticated: client.isAuthenticated(),
    isLoading,
    error,
    login,
    register,
    logout,
  };
}

// React import for the hooks above
import React from 'react';
