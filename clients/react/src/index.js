import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { FlareClient } from '@flarebase/client';

// 创建 Context
const FlarebaseContext = createContext(null);
const AuthContext = createContext(null);

// Provider 组件
export function FlarebaseProvider({ baseURL = 'http://localhost:3000', children }) {
  // 使用 useMemo 创建客户端实例
  const client = useMemo(() => {
    return new FlareClient(baseURL);
  }, [baseURL]);

  return (
    <FlarebaseContext.Provider value={client}>
      <AuthProvider client={client}>
        {children}
      </AuthProvider>
    </FlarebaseContext.Provider>
  );
}

// Auth Provider
export function AuthProvider({ client, children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is already authenticated
    if (client.auth.isAuthenticated) {
      setUser(client.auth.user);
    }
    setLoading(false);

    // Optional: Listen to auth state changes
    // This would require the SDK to emit events when auth state changes
  }, [client]);

  const login = async (credentials) => {
    const result = await client.login(credentials);
    setUser(client.auth.user);
    return result;
  };

  const register = async (userData) => {
    const result = await client.register(userData);
    setUser(client.auth.user);
    return result;
  };

  const logout = () => {
    client.logout();
    setUser(null);
  };

  const authValue = useMemo(() => ({
    user,
    loading,
    isAuthenticated: !!user,
    login,
    register,
    logout
  }), [user, loading]);

  return (
    <AuthContext.Provider value={authValue}>
      {children}
    </AuthContext.Provider>
  );
}

// Flarebase Hook
export function useFlarebase() {
  const context = useContext(FlarebaseContext);
  if (!context) {
    throw new Error('useFlarebase must be used within a FlarebaseProvider');
  }
  return context;
}

// Auth Hook
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context === undefined) {
    throw new Error('useAuth must be used within a FlarebaseProvider');
  }
  return context;
}

// CollectionReference 类 (简化版本)
class CollectionReference {
  constructor(client, name) {
    this.client = client;
    this.name = name;
  }

  doc(id) {
    return new DocumentReference(this.client, this.name, id);
  }

  async add(data) {
    const response = await fetch(`${this.client.baseURL}/collections/${this.name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return response.json();
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

    // 支持链式查询
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

// DocumentReference 类 (简化版本)
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

    // 返回清理函数
    return () => {
      this.client.socket.off('doc_updated', handleUpdate);
      this.client.socket.off('doc_deleted', handleDelete);
    };
  }
}
