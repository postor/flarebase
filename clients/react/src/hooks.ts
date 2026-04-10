/**
 * Flarebase React Hooks (TypeScript)
 *
 * React hooks for Flarebase
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFlarebase } from './provider.js';
import type {
  SWRState,
  SWROptions,
  MutateOptions,
  Filter,
  QueryResult,
  DocumentData
} from './types.js';

/**
 * useFlarebaseSWR - Collection data with SWR
 */
export function useFlarebaseSWR<T = any>(
  collectionName: string,
  options: SWROptions = {}
): SWRState<T> {
  const client = useFlarebase();
  const {
    revalidateOnFocus = true,
    revalidateInterval = false,
    enabled = true,
    fetcher: customFetcher
  } = options;

  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [isLoading, setIsLoading] = useState(true);
  const [isValidating, setIsValidating] = useState(false);
  const revalidateTimerRef = useRef<NodeJS.Timeout>();

  const fetcher = useCallback(async () => {
    if (!enabled) return;

    try {
      setIsValidating(true);
      setError(undefined);

      if (customFetcher) {
        const result = await customFetcher();
        setData(result);
        return result;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (client.auth.jwt) {
        headers['Authorization'] = `Bearer ${client.auth.jwt}`;
      }

      const response = await fetch(`${client.baseURL}/collections/${collectionName}`, {
        headers
      });
      const result = await response.json() as T;
      setData(result);
      return result;
    } catch (err) {
      const error = err as Error;
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
      setIsValidating(false);
    }
  }, [client.baseURL, collectionName, customFetcher, enabled, client.auth.jwt]);

  useEffect(() => {
    if (enabled) {
      fetcher();
    }
  }, [fetcher, enabled]);

  useEffect(() => {
    if (!revalidateOnFocus) return;

    const handleFocus = () => {
      fetcher();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [revalidateOnFocus, fetcher]);

  useEffect(() => {
    if (!revalidateInterval) return;

    revalidateTimerRef.current = setInterval(() => {
      fetcher();
    }, revalidateInterval);

    return () => {
      if (revalidateTimerRef.current) {
        clearInterval(revalidateTimerRef.current);
      }
    };
  }, [revalidateInterval, fetcher]);

  const mutate = useCallback(async (updateFn?: () => Promise<any>, options?: MutateOptions): Promise<any> => {
    const { optimistic = false, rollbackOnError = true } = options || {};

    if (optimistic && typeof updateFn === 'function') {
      try {
        const optimisticData = await updateFn();
        setData(optimisticData);
      } catch (err) {
        if (rollbackOnError) {
          fetcher();
        }
        throw err;
      }
    } else if (typeof updateFn === 'function') {
      const result = await updateFn();
      if (result !== undefined) {
        setData(result);
      }
      if (result === undefined) {
        await fetcher();
      }
    } else {
      await fetcher();
    }
  }, [fetcher]);

  return {
    data,
    error,
    isLoading,
    isValidating,
    mutate,
    refetch: fetcher
  };
}

/**
 * useFlarebaseDocumentSWR - Single document with SWR
 */
export function useFlarebaseDocumentSWR<T = any>(
  collection: string,
  id: string | undefined,
  options: SWROptions & { optimistic?: boolean } = {}
): SWRState<DocumentData<T>> & {
  update: (updates: Partial<T>, opts?: { optimistic?: boolean }) => Promise<DocumentData<T>>;
  invalidate: () => Promise<void>;
} {
  const client = useFlarebase();
  const {
    revalidateOnFocus = true,
    revalidateInterval = false
  } = options;

  const [data, setData] = useState<DocumentData<T>>();
  const [error, setError] = useState<Error>();
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const revalidateTimerRef = useRef<NodeJS.Timeout>();

  const fetcher = useCallback(async () => {
    if (!id) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setIsValidating(true);
      setError(undefined);

      const response = await fetch(`${client.baseURL}/collections/${collection}/${id}`, {
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json() as DocumentData<T>;
      setData(result);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
      setIsValidating(false);
    }
  }, [client.baseURL, collection, id]);

  useEffect(() => {
    if (id) {
      fetcher();
    }
  }, [fetcher, id]);

  useEffect(() => {
    if (!revalidateOnFocus || !id) return;

    const handleFocus = () => {
      fetcher();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [revalidateOnFocus, fetcher]);

  useEffect(() => {
    if (!revalidateInterval) return;

    revalidateTimerRef.current = setInterval(() => {
      fetcher();
    }, revalidateInterval);

    return () => {
      if (revalidateTimerRef.current) {
        clearInterval(revalidateTimerRef.current);
      }
    };
  }, [revalidateInterval, fetcher]);

  const update = useCallback(async (updates: Partial<T>, opts?: { optimistic?: boolean }) => {
    if (opts?.optimistic) {
      setData(prev => ({ ...prev, data: { ...prev?.data, ...updates } } as DocumentData<T>));
    }

    try {
      setIsValidating(true);
      const response = await fetch(`${client.baseURL}/collections/${collection}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const result = await response.json() as DocumentData<T>;
      setData(result);
      return result as any;
    } catch (err) {
      setError(err as Error);
      if (opts?.optimistic) {
        fetcher();
      }
      throw err;
    } finally {
      setIsValidating(false);
    }
  }, [client.baseURL, collection, id, fetcher]);

  const mutate = useCallback(async (updateFn?: () => Promise<any>, _options?: MutateOptions): Promise<any> => {
    if (updateFn) {
      await updateFn();
    }
    await fetcher();
    return undefined;
  }, [fetcher]);

  const invalidate = useCallback(async () => {
    setIsValidating(true);
    await fetcher();
  }, [fetcher]);

  return {
    data,
    error,
    isLoading,
    isValidating,
    update,
    mutate,
    invalidate,
    refetch: fetcher
  };
}

/**
 * useFlarebaseQuerySWR - Query with SWR
 */
export function useFlarebaseQuerySWR<T = any>(
  collection: string,
  filters: Filter[] = [],
  options: SWROptions = {}
): SWRState<QueryResult<T>> & {
  invalidate: () => Promise<void>;
} {
  const client = useFlarebase();
  const {
    revalidateOnFocus = true,
    revalidateInterval = false,
    customFetcher
  } = options;

  const [data, setData] = useState<QueryResult<T>>();
  const [error, setError] = useState<Error>();
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const revalidateTimerRef = useRef<NodeJS.Timeout>();

  const fetcher = useCallback(async () => {
    try {
      setIsLoading(true);
      setIsValidating(true);
      setError(undefined);

      if (customFetcher) {
        const result = await customFetcher();
        setData(result);
        return result;
      }

      const result = await client.query<T>(collection, filters);
      setData(result);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
      setIsValidating(false);
    }
  }, [client, collection, filters, customFetcher]);

  useEffect(() => {
    fetcher();
  }, [fetcher]);

  useEffect(() => {
    if (!revalidateOnFocus) return;

    const handleFocus = () => {
      fetcher();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [revalidateOnFocus, fetcher]);

  useEffect(() => {
    if (!revalidateInterval) return;

    revalidateTimerRef.current = setInterval(() => {
      fetcher();
    }, revalidateInterval);

    return () => {
      if (revalidateTimerRef.current) {
        clearInterval(revalidateTimerRef.current);
      }
    };
  }, [revalidateInterval, fetcher]);

  const mutate = useCallback(async (updateFn?: () => Promise<any>, _options?: MutateOptions): Promise<any> => {
    if (updateFn) {
      await updateFn();
    }
    await fetcher();
    return undefined;
  }, [fetcher]);

  const invalidate = useCallback(async () => {
    setIsValidating(true);
    await fetcher();
  }, [fetcher]);

  return {
    data,
    error,
    isLoading,
    isValidating,
    mutate,
    invalidate,
    refetch: fetcher
  };
}

/**
 * useCollection - Collection data hook (legacy)
 */
export function useCollection<T = any>(collectionName: string): {
  data: QueryResult<T> | null;
  loading: boolean;
  error: Error | null;
} {
  const [data, setData] = useState<QueryResult<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const client = useFlarebase();

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${client.baseURL}/collections/${collectionName}`, {
          headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json() as QueryResult<T>;
        setData(result);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [client.baseURL, collectionName]);

  return { data, loading, error };
}

/**
 * useDocument - Single document hook (legacy)
 */
export function useDocument<T = any>(collection: string, id: string | undefined): {
  data: DocumentData<T> | null;
  loading: boolean;
  error: Error | null;
} {
  const [data, setData] = useState<DocumentData<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const client = useFlarebase();

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${client.baseURL}/collections/${collection}/${id}`, {
          headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json() as DocumentData<T>;
        setData(result);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [client.baseURL, collection, id]);

  return { data, loading, error };
}

/**
 * useQuery - Query hook (legacy)
 */
export function useQuery<T = any>(collection: string, filters: Filter[] = []): {
  data: QueryResult<T> | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<QueryResult<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const client = useFlarebase();

  const executeQuery = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await client.query<T>(collection, filters);
      setData(result);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [client, collection, filters]);

  useEffect(() => {
    executeQuery();
  }, [executeQuery]);

  return { data, loading, error, refetch: executeQuery };
}
