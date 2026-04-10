/**
 * Flarebase React Provider (TypeScript)
 */
'use client';

import React, { createContext, useContext, useState } from 'react';
import { FlareClient } from '@flarebase/client';
import type { User, LoginCredentials, RegistrationData } from '@flarebase/client';
import type { FlarebaseContextType, FlarebaseProviderProps, SocketInterface } from './types.js';

// Create Context
const FlarebaseContext = createContext<FlarebaseContextType | null>(null);

/**
 * Provider component with JWT support
 */
export function FlarebaseProvider({
  baseURL,
  children,
  initialJWT = null,
  initialUser = null
}: FlarebaseProviderProps): React.ReactElement {
  // Create FlareClient instance
  const flareClient = React.useMemo(() => {
    return new FlareClient(baseURL);
  }, [baseURL]);

  // Restore JWT from localStorage or use initial JWT
  React.useEffect(() => {
    if (initialJWT) {
      (flareClient as any)._setJWT(initialJWT, initialUser);
    }
  }, [flareClient, initialJWT, initialUser]);

  // Auth state
  const [authState, setAuthState] = useState({
    isAuthenticated: flareClient.auth.isAuthenticated,
    user: flareClient.auth.user,
    jwt: flareClient.jwt
  });

  // Update auth state when client auth changes
  React.useEffect(() => {
    const updateAuthState = () => {
      setAuthState({
        isAuthenticated: flareClient.auth.isAuthenticated,
        user: flareClient.auth.user,
        jwt: flareClient.jwt
      });
    };

    // Initial sync
    updateAuthState();

    // Listen for storage events (for multi-tab sync)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'flarebase_jwt' || e.key === 'flarebase_user') {
        updateAuthState();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [flareClient]);

  // Client object with auth methods
  const client = React.useMemo<FlarebaseContextType>(() => {
    return {
      baseURL,
      socket: {} as SocketInterface,
      // Auth methods
      login: async (credentials: LoginCredentials) => {
        const result = await flareClient.login(credentials);
        setAuthState({
          isAuthenticated: true,
          user: flareClient.auth.user,
          jwt: flareClient.jwt
        });
        return result;
      },
      register: async (userData: RegistrationData) => {
        const result = await flareClient.register(userData);
        setAuthState({
          isAuthenticated: true,
          user: flareClient.auth.user,
          jwt: flareClient.jwt
        });
        return result;
      },
      logout: () => {
        flareClient.logout();
        setAuthState({
          isAuthenticated: false,
          user: null,
          jwt: null
        });
      },
      // Auth state
      auth: {
        get isAuthenticated(): boolean {
          return flareClient.auth.isAuthenticated;
        },
        get user(): User | null {
          return flareClient.auth.user;
        },
        get jwt(): string | null {
          return flareClient.jwt;
        }
      },
      // Collection methods
      collection: (_name: string) => {
        return null as any; // Will be implemented in classes.ts
      },
      query: async <T = any>(collection: string, filters: any[]) => {
        return await flareClient.query<T>(collection, filters);
      },
      // Named queries
      namedQuery: <T = any>(queryName: string, params: Record<string, any>) => {
        return flareClient.namedQuery<T>(queryName, params);
      },
      // SWR fetchers
      createSWRFetcher: <T = any>(queryName: string) => {
        return flareClient.createSWRFetcher<T>(queryName);
      },
      get swrFetcher() {
        return flareClient.swrFetcher;
      }
    };
  }, [baseURL, flareClient, authState]);

  return React.createElement(
    FlarebaseContext.Provider,
    { value: client },
    children
  );
}

/**
 * Hook to access Flarebase context
 */
export function useFlarebase(): FlarebaseContextType {
  const context = useContext(FlarebaseContext);
  if (!context) {
    throw new Error('useFlarebase must be used within a FlarebaseProvider');
  }
  return context;
}
