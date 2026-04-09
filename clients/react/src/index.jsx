import React, { createContext, useContext, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

// 创建 Context
const FlarebaseContext = createContext(null);

// Provider 组件
export function FlarebaseProvider({ baseURL, children }) {
  const client = useMemo(() => {
    const socketInstance = io(baseURL);
    return {
      baseURL,
      socket: socketInstance,
      collection: (name) => {
        return new CollectionReference(client, name);
      },
      query: async (collection, filters = []) => {
        const response = await fetch(`${client.baseURL}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection, filters })
        });
        return response.json();
      }
    };
  }, [baseURL]);

  return (
    <FlarebaseContext.Provider value={client}>
      {children}
    </FlarebaseContext.Provider>
  );
}

// Hook
export function useFlarebase() {
  const context = useContext(FlarebaseContext);
  if (!context) {
    throw new Error('useFlarebase must be used within a FlarebaseProvider');
  }
  return context;
}

// ===== SWR Hooks =====

// useFlarebaseSWR - Collection data with SWR
export function useFlarebaseSWR(collectionName, options = {}) {
  const client = useFlarebase();
  const {
    revalidateOnFocus = true,
    revalidateInterval = false,
    enabled = true,
    fetcher: customFetcher
  } = options;

  const [data, setData] = useState();
  const [error, setError] = useState();
  const [isLoading, setIsLoading] = useState(true);
  const [isValidating, setIsValidating] = useState(false);
  const revalidateTimerRef = useRef(null);

  // Main fetch function
  const fetcher = useCallback(async () => {
    if (!enabled) return;

    try {
      setIsValidating(true);
      setError(null);

      if (customFetcher) {
        const result = await customFetcher();
        setData(result);
        return result;
      }

      const response = await fetch(`${client.baseURL}/collections/${collectionName}`);
      const result = await response.json();
      setData(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setIsLoading(false);
      setIsValidating(false);
    }
  }, [client.baseURL, collectionName, customFetcher, enabled]);

  // Initial fetch
  useEffect(() => {
    if (enabled) {
      fetcher();
    }
  }, [fetcher, enabled]);

  // Revalidation on focus
  useEffect(() => {
    if (!revalidateOnFocus) return;

    const handleFocus = () => {
      fetcher();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [revalidateOnFocus, fetcher]);

  // Auto revalidation interval
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

  // Real-time updates via Socket.IO
  useEffect(() => {
    const handleDocCreated = (doc) => {
      if (doc.collection === collectionName) {
        setData(prev => prev ? [...prev, doc] : [doc]);
      }
    };

    const handleDocUpdated = (doc) => {
      if (doc.collection === collectionName) {
        setData(prev => prev ? prev.map(d => d.id === doc.id ? doc : d) : prev);
      }
    };

    const handleDocDeleted = (payload) => {
      const id = typeof payload === 'string' ? payload : (payload.id || payload);
      setData(prev => prev ? prev.filter(d => d.id !== id) : prev);
    };

    client.socket.on('doc_created', handleDocCreated);
    client.socket.on('doc_updated', handleDocUpdated);
    client.socket.on('doc_deleted', handleDocDeleted);

    return () => {
      client.socket.off('doc_created', handleDocCreated);
      client.socket.off('doc_updated', handleDocUpdated);
      client.socket.off('doc_deleted', handleDocDeleted);
    };
  }, [client, collectionName]);

  // mutate function for manual updates
  const mutate = useCallback(async (updateFn, options = {}) => {
    const { optimistic = false, rollbackOnError = true } = options;

    // Optimistic update
    if (optimistic && typeof updateFn === 'function') {
      try {
        const optimisticData = await updateFn();
        setData(optimisticData);
      } catch (err) {
        // Rollback on error
        if (rollbackOnError) {
          fetcher();
        }
        throw err;
      }
    } else if (typeof updateFn === 'function') {
      // Apply the update function result directly
      const result = await updateFn();
      if (result !== undefined) {
        setData(result);
      }
      // Only fetch if the update function doesn't return data
      if (result === undefined) {
        await fetcher();
      }
    } else {
      await fetcher();
    }
  }, [fetcher]);

  // Return SWR interface
  return {
    data,
    error,
    isLoading,
    isValidating,
    mutate,
    refetch: fetcher
  };
}

// useFlarebaseDocumentSWR - Single document with SWR
export function useFlarebaseDocumentSWR(collection, id, options = {}) {
  const client = useFlarebase();
  const {
    revalidateOnFocus = true,
    revalidateInterval = false,
    optimistic = false
  } = options;

  const [data, setData] = useState();
  const [error, setError] = useState();
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const revalidateTimerRef = useRef(null);

  const fetcher = useCallback(async () => {
    if (!id) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setIsValidating(true);
      setError(null);

      const docRef = client.collection(collection).doc(id);
      const result = await docRef.get();
      setData(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setIsLoading(false);
      setIsValidating(false);
    }
  }, [client, collection, id]);

  // Initial fetch
  useEffect(() => {
    if (id) {
      fetcher();
    }
  }, [fetcher]);

  // Revalidation
  useEffect(() => {
    if (!revalidateOnFocus) return;

    const handleFocus = () => {
      fetcher();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [revalidateOnFocus, fetcher]);

  // Auto revalidation
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

  // Real-time updates
  useEffect(() => {
    if (!id) return;

    const handleUpdate = (doc) => {
      if (doc.collection === collection && doc.id === id) {
        setData(doc);
      }
    };

    const handleDelete = (payload) => {
      const deletedId = typeof payload === 'string' ? payload : (payload.id || payload);
      if (deletedId === id) {
        setData(null);
      }
    };

    client.socket.on('doc_updated', handleUpdate);
    client.socket.on('doc_deleted', handleDelete);

    return () => {
      client.socket.off('doc_updated', handleUpdate);
      client.socket.off('doc_deleted', handleDelete);
    };
  }, [client, collection, id]);

  // Update function
  const update = useCallback(async (updates, options = {}) => {
    const { optimisticData } = options;

    // Optimistic update - apply updates immediately if optimistic is enabled
    if (optimistic) {
      setData(prev => ({ ...prev, data: { ...prev.data, ...updates } }));
    } else if (optimisticData) {
      setData(prev => ({ ...prev, data: { ...prev.data, ...optimisticData } }));
    }

    try {
      setIsValidating(true);
      const docRef = client.collection(collection).doc(id);
      const result = await docRef.update(updates);

      // Merge the updates with current data to ensure local state is updated
      setData(prev => ({
        ...prev,
        ...result,
        data: { ...prev?.data, ...updates }
      }));

      return result;
    } catch (err) {
      setError(err);
      // Rollback optimistic update
      if (optimistic || optimisticData) {
        fetcher();
      }
      throw err;
    } finally {
      setIsValidating(false);
    }
  }, [client, collection, id, optimistic]);

  // mutate function
  const mutate = useCallback(async (updateFn, options = {}) => {
    await updateFn();
    await fetcher();
  }, [fetcher]);

  // invalidate function
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

// useFlarebaseQuerySWR - Query with SWR
export function useFlarebaseQuerySWR(collection, filters = [], options = {}) {
  const client = useFlarebase();
  const {
    revalidateOnFocus = true,
    revalidateInterval = false,
    customFetcher
  } = options;

  const [data, setData] = useState();
  const [error, setError] = useState();
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const revalidateTimerRef = useRef(null);

  const fetcher = useCallback(async () => {
    try {
      setIsLoading(true);
      setIsValidating(true);
      setError(null);

      if (customFetcher) {
        const result = await customFetcher();
        setData(result);
        return result;
      }

      const result = await client.query(collection, filters);
      setData(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setIsLoading(false);
      setIsValidating(false);
    }
  }, [client, collection, filters, customFetcher]);

  // Initial fetch
  useEffect(() => {
    fetcher();
  }, [fetcher]);

  // Revalidation on focus
  useEffect(() => {
    if (!revalidateOnFocus) return;

    const handleFocus = () => {
      fetcher();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [revalidateOnFocus, fetcher]);

  // Auto revalidation
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

  // mutate function
  const mutate = useCallback(async (updateFn) => {
    await updateFn();
    await fetcher();
  }, [fetcher]);

  // invalidate function
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

// ===== Original Hooks (maintained for compatibility) =====

export function useCollection(collectionName) {
  const client = useFlarebase();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const collection = client.collection(collectionName);

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await collection.get();
        setData(result);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    const handleDocCreated = (doc) => {
      setData(prev => prev ? [...prev, doc] : [doc]);
    };

    const handleDocUpdated = (doc) => {
      setData(prev => prev ? prev.map(d => d.id === doc.id ? doc : d) : prev);
    };

    const handleDocDeleted = (payload) => {
      const id = typeof payload === 'string' ? payload : (payload.id || payload);
      setData(prev => prev ? prev.filter(d => d.id !== id) : prev);
    };

    client.socket.on('doc_created', handleDocCreated);
    client.socket.on('doc_updated', handleDocUpdated);
    client.socket.on('doc_deleted', handleDocDeleted);

    return () => {
      client.socket.off('doc_created', handleDocCreated);
      client.socket.off('doc_updated', handleDocUpdated);
      client.socket.off('doc_deleted', handleDocDeleted);
    };
  }, [client, collectionName]);

  return { data, loading, error };
}

export function useDocument(collection, id) {
  const client = useFlarebase();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const docRef = client.collection(collection).doc(id);

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await docRef.get();
        setData(result);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    const handleUpdate = (doc) => {
      if (doc.collection === collection && doc.id === id) {
        setData(doc);
      }
    };

    const handleDelete = (payload) => {
      const deletedId = typeof payload === 'string' ? payload : (payload.id || payload);
      if (deletedId === id) {
        setData(null);
      }
    };

    client.socket.on('doc_updated', handleUpdate);
    client.socket.on('doc_deleted', handleDelete);

    return () => {
      client.socket.off('doc_updated', handleUpdate);
      client.socket.off('doc_deleted', handleDelete);
    };
  }, [client, collection, id]);

  return { data, loading, error };
}

export function useQuery(collection, filters = []) {
  const client = useFlarebase();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const executeQuery = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await client.query(collection, filters);
      setData(result);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [client, collection, filters]);

  useEffect(() => {
    executeQuery();
  }, [executeQuery]);

  return { data, loading, error, refetch: executeQuery };
}

// ===== Classes =====

class CollectionReference {
  constructor(client, name) {
    this.client = client;
    this.name = name;
  }

  doc(id) {
    return new DocumentReference(this.client, this.name, id);
  }

  async get() {
    const response = await fetch(`${this.client.baseURL}/collections/${this.name}`);
    return response.json();
  }

  where(field, op, value) {
    const opMap = {
      '==': 'Eq',
      '>': 'Gt',
      '<': 'Lt',
      '>=': 'Gte',
      '<=': 'Lte',
      'in': 'In'
    };
    const queryOp = {};
    queryOp[opMap[op] || op] = value;

    if (!this._filters) {
      this._filters = [];
    }
    this._filters.push([field, queryOp]);

    const query = {
      _filters: [...this._filters],
      where: (f, o, v) => {
        const qop = {};
        qop[opMap[o] || o] = v;
        query._filters.push([f, qop]);
        return query;
      },
      get: () => this.client.query(this.name, query._filters)
    };

    return query;
  }

  onSnapshot(callback) {
    this.client.socket.emit('subscribe', this.name);
    this.client.socket.on('doc_created', (doc) => {
      if (doc.collection === this.name) callback({ type: 'added', doc });
    });
    this.client.socket.on('doc_updated', (doc) => {
      if (doc.collection === this.name) callback({ type: 'modified', doc });
    });
    this.client.socket.on('doc_deleted', (payload) => {
      const id = typeof payload === 'string' ? payload : (payload.id || payload);
      callback({ type: 'removed', id });
    });
  }
}

class DocumentReference {
  constructor(client, collection, id) {
    this.client = client;
    this.collection = collection;
    this.id = id;
  }

  async get() {
    const response = await fetch(`${this.client.baseURL}/collections/${this.collection}/${this.id}`);
    const data = await response.json();
    return data === null ? null : data;
  }

  async update(data) {
    const response = await fetch(`${this.client.baseURL}/collections/${this.collection}/${this.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return response.json();
  }

  async delete() {
    const response = await fetch(`${this.client.baseURL}/collections/${this.collection}/${this.id}`, {
      method: 'DELETE'
    });
    return response.ok;
  }

  onSnapshot(callback) {
    this.client.socket.emit('subscribe', this.collection);
    const handleUpdate = (doc) => {
      if (doc.collection === this.collection && doc.id === this.id) {
        callback({ type: 'modified', doc });
      }
    };
    const handleDelete = (payload) => {
      const id = typeof payload === 'string' ? payload : (payload.id || payload);
      if (id === this.id) {
        callback({ type: 'removed', id });
      }
    };
    this.client.socket.on('doc_updated', handleUpdate);
    this.client.socket.on('doc_deleted', handleDelete);

    return () => {
      this.client.socket.off('doc_updated', handleUpdate);
      this.client.socket.off('doc_deleted', handleDelete);
    };
  }
}
