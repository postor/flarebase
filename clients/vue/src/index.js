import { io } from 'socket.io-client';
import { inject, provide, reactive, ref, onUnmounted } from 'vue';

// Symbol for dependency injection
const FLAREBASE_KEY = Symbol('flarebase');

// Plugin
export const FlarebasePlugin = {
  install(app, options = {}) {
    const { baseURL = 'http://localhost:3000' } = options;

    const client = {
      baseURL,
      socket: io(baseURL),
      collection: (name) => new CollectionReference(client, name),
      query: async (collection, filters = []) => {
        const response = await fetch(`${baseURL}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection, filters })
        });
        return response.json();
      }
    };

    // Provide globally
    app.provide(FLAREBASE_KEY, client);

    // Add to global properties
    app.config.globalProperties.$flarebase = client;
  }
};

// Composable
export function useFlarebase() {
  const client = inject(FLAREBASE_KEY);
  if (!client) {
    throw new Error('useFlarebase must be used within a FlarebasePlugin context');
  }
  return client;
}

// useCollection Composable
export function useCollection(collectionName) {
  const client = useFlarebase();
  const data = ref(null);
  const loading = ref(true);
  const error = ref(null);

  const fetchData = async () => {
    try {
      loading.value = true;
      error.value = null;
      const collection = client.collection(collectionName);
      const result = await collection.get();
      data.value = result;
    } catch (err) {
      error.value = err;
    } finally {
      loading.value = false;
    }
  };

  // Real-time updates
  const handleDocCreated = (doc) => {
    if (doc.collection === collectionName) {
      data.value = data.value ? [...data.value, doc] : [doc];
    }
  };

  const handleDocUpdated = (doc) => {
    if (doc.collection === collectionName) {
      data.value = data.value ? data.value.map(d => d.id === doc.id ? doc : d) : data.value;
    }
  };

  const handleDocDeleted = (payload) => {
    const id = typeof payload === 'string' ? payload : (payload.id || payload);
    data.value = data.value ? data.value.filter(d => d.id !== id) : data.value;
  };

  // Set up socket listeners
  client.socket.on('doc_created', handleDocCreated);
  client.socket.on('doc_updated', handleDocUpdated);
  client.socket.on('doc_deleted', handleDocDeleted);

  // Initial fetch
  fetchData();

  // Cleanup
  onUnmounted(() => {
    client.socket.off('doc_created', handleDocCreated);
    client.socket.off('doc_updated', handleDocUpdated);
    client.socket.off('doc_deleted', handleDocDeleted);
  });

  return { data, loading, error };
}

// useDocument Composable
export function useDocument(collection, id) {
  const client = useFlarebase();
  const data = ref(null);
  const loading = ref(true);
  const error = ref(null);

  const fetchData = async () => {
    if (!id) {
      loading.value = false;
      return;
    }

    try {
      loading.value = true;
      error.value = null;
      const docRef = client.collection(collection).doc(id);
      const result = await docRef.get();
      data.value = result;
    } catch (err) {
      error.value = err;
    } finally {
      loading.value = false;
    }
  };

  // Real-time updates
  const handleUpdate = (doc) => {
    if (doc.collection === collection && doc.id === id) {
      data.value = doc;
    }
  };

  const handleDelete = (payload) => {
    const deletedId = typeof payload === 'string' ? payload : (payload.id || payload);
    if (deletedId === id) {
      data.value = null;
    }
  };

  client.socket.on('doc_updated', handleUpdate);
  client.socket.on('doc_deleted', handleDelete);

  fetchData();

  onUnmounted(() => {
    client.socket.off('doc_updated', handleUpdate);
    client.socket.off('doc_deleted', handleDelete);
  });

  return { data, loading, error };
}

// useQuery Composable
export function useQuery(collection, filters = []) {
  const client = useFlarebase();
  const data = ref(null);
  const loading = ref(true);
  const error = ref(null);

  const executeQuery = async () => {
    try {
      loading.value = true;
      error.value = null;
      const result = await client.query(collection, filters);
      data.value = result;
    } catch (err) {
      error.value = err;
    } finally {
      loading.value = false;
    }
  };

  executeQuery();

  const refetch = () => executeQuery();

  return { data, loading, error, refetch };
}

// CollectionReference Class
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

// DocumentReference Class
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
