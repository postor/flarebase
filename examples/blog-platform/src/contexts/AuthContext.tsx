'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getFlarebaseClient } from '@/lib/flarebase';
import type { User } from '@/types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session on mount
    const flarebase = getFlarebaseClient();

    // Try to load user from localStorage first (for faster initial render)
    if (typeof window !== 'undefined') {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (e) {
          console.warn('Failed to parse stored user:', e);
        }
      }
    }

    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const flarebase = getFlarebaseClient();
    const response = await flarebase.login(email, password);

    if (response.user) {
      const user: User = {
        id: response.user.id,
        data: {
          email: response.user.email || email,
          name: response.user.name || '',
          role: (response.user.role as any) || 'author',
          status: 'active',
          created_at: Date.now()
        }
      };
      setUser(user);

      if (typeof window !== 'undefined') {
        localStorage.setItem('user', JSON.stringify(user));
      }
    }
  };

  const register = async (name: string, email: string, password: string) => {
    const flarebase = getFlarebaseClient();
    const response = await flarebase.register({ name, email, password });

    if (response.user) {
      const user: User = {
        id: response.user.id,
        data: {
          email: response.user.email || email,
          name: response.user.name || name,
          role: (response.user.role as any) || 'author',
          status: 'active',
          created_at: Date.now()
        }
      };
      setUser(user);

      if (typeof window !== 'undefined') {
        localStorage.setItem('user', JSON.stringify(user));
      }
    }
  };

  const logout = () => {
    const flarebase = getFlarebaseClient();
    flarebase.logout();
    setUser(null);

    if (typeof window !== 'undefined') {
      localStorage.removeItem('user');
      localStorage.removeItem('auth_token');
    }
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
