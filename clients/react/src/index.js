import React, { createContext, useContext, useMemo } from 'react';
import { io } from 'socket.io-client';

// 创建 Context
const FlarebaseContext = createContext(null);

// Provider 组件
export function FlarebaseProvider({ baseURL, children }) {
  // 使用 useMemo 创建客户端实例
  const client = useMemo(() => {
    return {
      baseURL,
      socket: io(baseURL),
      collection: (name) => {
        // 这里将使用现有的 JS SDK 逻辑
        return new CollectionReference(client, name);
      },
      query: async (collection, filters = [], limit, offset) => {
        const response = await fetch(`${baseURL}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection, filters, limit, offset })
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
