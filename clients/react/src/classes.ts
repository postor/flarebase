/**
 * Flarebase React Classes (TypeScript)
 *
 * Collection and document reference classes
 */

import type {
  CollectionReference,
  DocumentReference,
  Query,
  FlarebaseContextType,
  Filter,
  QueryResult,
  SnapshotCallback,
  DocumentData
} from './types.js';

/**
 * CollectionReference Implementation
 */
export class CollectionReferenceImpl<T = any> implements CollectionReference<T> {
  constructor(
    public readonly client: FlarebaseContextType,
    public readonly name: string
  ) {}

  doc(id: string): DocumentReference<T> {
    return new DocumentReferenceImpl<T>(this.client, this.name, id);
  }

  async get(): Promise<QueryResult<T>> {
    const response = await fetch(`${this.client.baseURL}/collections/${this.name}`, {
      headers: { 'Content-Type': 'application/json' }
    });
    return response.json();
  }

  where(field: string, op: string, value: any): Query<T> {
    const opMap: Record<string, string> = {
      '==': 'Eq',
      '>': 'Gt',
      '<': 'Lt',
      '>=': 'Gte',
      '<=': 'Lte',
      'in': 'In'
    };
    const queryOp: Record<string, any> = {};
    queryOp[opMap[op] || op] = value;

    return new QueryImpl<T>(this.client, this.name, [[field, queryOp]]);
  }

  onSnapshot(callback: SnapshotCallback<T>): () => void {
    this.client.socket.emit('subscribe', this.name);

    const handleDocCreated = (doc: any) => {
      if (doc.collection === this.name) callback({ type: 'added', doc });
    };

    const handleDocUpdated = (doc: any) => {
      if (doc.collection === this.name) callback({ type: 'modified', doc });
    };

    const handleDocDeleted = (payload: any) => {
      const id = typeof payload === 'string' ? payload : (payload.id || payload);
      callback({ type: 'removed', id });
    };

    this.client.socket.on('doc_created', handleDocCreated);
    this.client.socket.on('doc_updated', handleDocUpdated);
    this.client.socket.on('doc_deleted', handleDocDeleted);

    return () => {
      this.client.socket.off('doc_created', handleDocCreated);
      this.client.socket.off('doc_updated', handleDocUpdated);
      this.client.socket.off('doc_deleted', handleDocDeleted);
    };
  }
}

/**
 * DocumentReference Implementation
 */
export class DocumentReferenceImpl<T = any> implements DocumentReference<T> {
  constructor(
    private client: FlarebaseContextType,
    public readonly collection: string,
    public readonly id: string
  ) {}

  async get(): Promise<DocumentData<T> | null> {
    const response = await fetch(`${this.client.baseURL}/collections/${this.collection}/${this.id}`, {
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    return data === null ? null : data;
  }

  async update(data: Partial<T>): Promise<DocumentData<T>> {
    const response = await fetch(`${this.client.baseURL}/collections/${this.collection}/${this.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return response.json();
  }

  async delete(): Promise<boolean> {
    const response = await fetch(`${this.client.baseURL}/collections/${this.collection}/${this.id}`, {
      method: 'DELETE'
    });
    return response.ok;
  }

  onSnapshot(callback: SnapshotCallback<T>): () => void {
    this.client.socket.emit('subscribe', this.collection);

    const handleUpdate = (doc: any) => {
      if (doc.collection === this.collection && doc.id === this.id) {
        callback({ type: 'modified', doc });
      }
    };

    const handleDelete = (payload: any) => {
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

/**
 * Query Implementation
 */
export class QueryImpl<T = any> implements Query<T> {
  constructor(
    private client: FlarebaseContextType,
    private collectionName: string,
    private _filters: Filter[]
  ) {}

  where(field: string, op: string, value: any): Query<T> {
    const opMap: Record<string, string> = {
      '==': 'Eq',
      '>': 'Gt',
      '<': 'Lt',
      '>=': 'Gte',
      '<=': 'Lte',
      'in': 'In'
    };
    const queryOp: Record<string, any> = {};
    queryOp[opMap[op] || op] = value;
    this._filters = [...this._filters, [field, queryOp]];

    return new QueryImpl<T>(this.client, this.collectionName, this._filters);
  }

  async get(): Promise<QueryResult<T>> {
    return this.client.query<T>(this.collectionName, this._filters);
  }
}
