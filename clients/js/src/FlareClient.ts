/**
 * Flarebase JavaScript Client SDK (TypeScript)
 *
 * TypeScript implementation of Flarebase client with full type safety
 */

import { io, Socket } from 'socket.io-client';
import type {
  User,
  JWTPayload,
  AuthResponse,
  LoginCredentials,
  RegistrationData,
  FlareClientOptions,
  SocketInterface,
  Filter,
  QueryResult,
  DocumentData,
  TransactionOperation,
  BatchResult,
  NamedQueryParams,
  NamedQueryResult,
  SnapshotCallback,
  AuthState
} from './types.js';

/**
 * FlareClient - Main client class for Flarebase
 */
export class FlareClient {
  public readonly baseURL: string;
  public socket: SocketInterface;
  public jwt: string | null;
  public user: User | null;
  private options: Required<FlareClientOptions>;
  private refreshTimeout?: NodeJS.Timeout;

  constructor(baseURL: string, options: FlareClientOptions = {}) {
    this.baseURL = baseURL;
    this.socket = io(baseURL) as unknown as SocketInterface;
    this.jwt = null;
    this.user = null;
    this.options = {
      autoRefresh: options.autoRefresh !== false,
      refreshThreshold: options.refreshThreshold || 5 * 60 * 1000,
      debug: options.debug || false,
    };

    // Load JWT from localStorage if available
    this._loadJWT();

    // Setup auto-refresh if enabled
    if (this.options.autoRefresh && this.jwt) {
      this._setupTokenRefresh();
    }
  }

  /**
   * Decode JWT token (without verification, for reading claims only)
   * @private
   */
  private _decodeJWT(token: string): JWTPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = JSON.parse(atob(parts[1]));
      return payload as JWTPayload;
    } catch (e) {
      if (this.options.debug) {
        console.warn('[Flarebase] Failed to decode JWT:', e);
      }
      return null;
    }
  }

  /**
   * Check if JWT token is expired or will expire soon
   * @private
   */
  private _isTokenExpired(token: string): boolean {
    const payload = this._decodeJWT(token);
    if (!payload || !payload.exp) return true;

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = payload.exp;

    if (this.options.debug) {
      console.log('[Flarebase] Token expiration:', {
        now,
        expiresAt,
        expiresInSeconds: expiresAt - now,
        isExpired: now >= expiresAt
      });
    }

    return now >= expiresAt;
  }

  /**
   * Setup automatic token refresh before expiration
   * @private
   */
  private _setupTokenRefresh(): void {
    if (!this.jwt) return;

    const payload = this._decodeJWT(this.jwt);
    if (!payload || !payload.exp) return;

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = payload.exp;
    const timeUntilExpiry = (expiresAt - now) * 1000;

    // Schedule refresh before expiration
    const refreshTime = Math.max(
      timeUntilExpiry - this.options.refreshThreshold,
      0
    );

    if (this.options.debug) {
      console.log('[Flarebase] Scheduling token refresh in', refreshTime, 'ms');
    }

    this.refreshTimeout = setTimeout(async () => {
      if (this.user) {
        try {
          // Note: This requires storing credentials or having a refresh endpoint
          if (this.options.debug) {
            console.log('[Flarebase] Refreshing token...');
          }
        } catch (e) {
          console.error('[Flarebase] Token refresh failed:', e);
          this._clearJWT();
        }
      }
    }, refreshTime);
  }

  /**
   * Store JWT token and user info
   * @private
   */
  private _setJWT(token: string, user: User | null = null): void {
    // Decode token to extract claims
    const payload = this._decodeJWT(token);

    this.jwt = token;
    this.user = {
      id: user?.id || payload?.sub || '',
      email: user?.email || payload?.email || undefined,
      name: user?.name || undefined,
      role: user?.role || payload?.role || 'user',
      exp: payload?.exp || undefined,
      iat: payload?.iat || undefined,
      ...(user || {})
    } as User;

    if (this.options.debug) {
      console.log('[Flarebase] JWT stored:', {
        user: this.user,
        expiresIn: this.user.exp ? this.user.exp - Math.floor(Date.now() / 1000) : 'unknown'
      });
    }

    // Store in localStorage for persistence
    try {
      localStorage.setItem('flarebase_jwt', token);
      if (this.user) {
        localStorage.setItem('flarebase_user', JSON.stringify(this.user));
      }
    } catch (e) {
      console.warn('[Flarebase] Failed to store JWT in localStorage:', e);
    }

    // Setup auto-refresh if enabled
    if (this.options.autoRefresh) {
      this._setupTokenRefresh();
    }
  }

  /**
   * Load JWT from localStorage
   * @private
   */
  private _loadJWT(): void {
    try {
      const token = localStorage.getItem('flarebase_jwt');
      const userStr = localStorage.getItem('flarebase_user');

      if (token) {
        // Check if token is expired
        if (this._isTokenExpired(token)) {
          console.warn('[Flarebase] Stored JWT token is expired, clearing...');
          this._clearJWT();
          return;
        }
        this.jwt = token;
      }

      if (userStr) {
        this.user = JSON.parse(userStr);
      }

      if (this.jwt && this.options.debug) {
        console.log('[Flarebase] JWT restored from storage:', this.user);
      }
    } catch (e) {
      console.warn('[Flarebase] Failed to load JWT from localStorage:', e);
      this._clearJWT();
    }
  }

  /**
   * Clear JWT and user info (logout)
   * @private
   */
  private _clearJWT(): void {
    this.jwt = null;
    this.user = null;

    // Clear refresh timeout
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = undefined;
    }

    try {
      localStorage.removeItem('flarebase_jwt');
      localStorage.removeItem('flarebase_user');
    } catch (e) {
      console.warn('[Flarebase] Failed to clear JWT from localStorage:', e);
    }

    if (this.options.debug) {
      console.log('[Flarebase] JWT cleared');
    }
  }

  /**
   * Get authorization headers for requests
   * @public
   */
  public _getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.jwt) {
      headers['Authorization'] = `Bearer ${this.jwt}`;
    }

    return headers;
  }

  /**
   * Authentication state (read-only accessor)
   */
  get auth(): AuthState {
    const self = this;
    return {
      get isAuthenticated(): boolean {
        if (!self.jwt) return false;
        if (self._isTokenExpired(self.jwt)) {
          self._clearJWT();
          return false;
        }
        return true;
      },

      get user(): User | null {
        if (!this.isAuthenticated) return null;
        return self.user;
      },

      get jwt(): string | null {
        return self.jwt;
      },

      get expiresAt(): number | null {
        return self.user?.exp || null;
      },

      get expiresIn(): number | null {
        if (!self.user?.exp) return null;
        const now = Math.floor(Date.now() / 1000);
        return Math.max(0, self.user.exp - now);
      },

      expiresSoon(seconds: number = 300): boolean {
        const expiresIn = this.expiresIn;
        return (expiresIn !== null && expiresIn !== undefined) && expiresIn <= seconds;
      }
    };
  }

  /**
   * Login via auth hook
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.off('hook_success');
        this.socket.off('hook_error');
        reject(new Error('Login request timed out'));
      }, 10000);

      this.socket.once('hook_success', (data: AuthResponse) => {
        clearTimeout(timeout);
        this.socket.off('hook_error');

        // Store JWT and user info
        if (data.token) {
          this._setJWT(data.token, data.user || null);
        }

        resolve(data);
      });

      this.socket.once('hook_error', (err: string) => {
        clearTimeout(timeout);
        this.socket.off('hook_success');
        reject(new Error(err));
      });

      // Call auth hook
      this.socket.emit('call_hook', ['auth', {
        action: 'login',
        ...credentials
      }]);
    });
  }

  /**
   * Register via auth hook
   */
  async register(userData: RegistrationData): Promise<AuthResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.off('hook_success');
        this.socket.off('hook_error');
        reject(new Error('Registration request timed out'));
      }, 10000);

      this.socket.once('hook_success', (data: AuthResponse) => {
        clearTimeout(timeout);
        this.socket.off('hook_error');

        // Store JWT and user info
        if (data.token) {
          this._setJWT(data.token, data.user || null);
        }

        resolve(data);
      });

      this.socket.once('hook_error', (err: string) => {
        clearTimeout(timeout);
        this.socket.off('hook_success');
        reject(new Error(err));
      });

      // Call auth hook
      this.socket.emit('call_hook', ['auth', {
        action: 'register',
        ...userData
      }]);
    });
  }

  /**
   * Logout current user
   */
  logout(): void {
    this._clearJWT();
  }

  /**
   * Call a custom hook
   */
  async callHook(eventName: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.off('hook_success');
        this.socket.off('hook_error');
        reject(new Error('Hook request timed out'));
      }, 10000);

      this.socket.once('hook_success', (data: any) => {
        clearTimeout(timeout);
        this.socket.off('hook_error');
        resolve(data);
      });

      this.socket.once('hook_error', (err: string) => {
        clearTimeout(timeout);
        this.socket.off('hook_success');
        reject(new Error(err));
      });

      this.socket.emit('call_hook', [eventName, params]);
    });
  }

  /**
   * Execute a named query (whitelist query)
   */
  async namedQuery<T = any>(queryName: string, params: NamedQueryParams = {}): Promise<NamedQueryResult<T>> {
    const response = await fetch(`${this.baseURL}/queries/${queryName}`, {
      method: 'POST',
      headers: this._getAuthHeaders(),
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      throw new Error(`Query failed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * SWR fetcher function for useSWR integration
   */
  createSWRFetcher<T = any>(queryName: string): (params: NamedQueryParams) => Promise<NamedQueryResult<T>> {
    return async (params: NamedQueryParams) => {
      return await this.namedQuery<T>(queryName, params);
    };
  }

  /**
   * Universal SWR fetcher (works with useSWR('endpoint', fetcher))
   */
  get swrFetcher(): (url: string) => Promise<any> {
    return async (url: string) => {
      const response = await fetch(`${this.baseURL}${url}`, {
        method: 'POST',
        headers: this._getAuthHeaders(),
        body: JSON.stringify({})
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.statusText}`);
      }

      return response.json();
    };
  }

  /**
   * Get a session-scoped collection table
   */
  sessionTable(name: string): CollectionReference {
    if (!this.socket.id) {
      throw new Error('Socket not connected. Session ID not available.');
    }
    return this.collection(`_session_${this.socket.id}_${name}`);
  }

  /**
   * Get a collection reference
   */
  collection(name: string): CollectionReference {
    return new CollectionReference(this, name);
  }

  /**
   * Execute a query with filters
   */
  async query<T = any>(collection: string, filters: Filter[] = [], limit?: number, offset?: number): Promise<QueryResult<T>> {
    const response = await fetch(`${this.baseURL}/query`, {
      method: 'POST',
      headers: this._getAuthHeaders(),
      body: JSON.stringify({ collection, filters, limit, offset })
    });
    return response.json();
  }

  /**
   * Create a write batch
   */
  batch(): WriteBatch {
    return new WriteBatch(this);
  }

  /**
   * Run a transaction
   */
  async runTransaction<T = any>(updateFunction: (txn: Transaction) => Promise<void>): Promise<T> {
    const transaction = new Transaction(this);
    try {
      await updateFunction(transaction);
      const response = await fetch(`${this.baseURL}/transaction`, {
        method: 'POST',
        headers: this._getAuthHeaders(),
        body: JSON.stringify({ operations: transaction.operations })
      });
      return response.json();
    } catch (error) {
      console.error('Transaction failed:', error);
      throw error;
    }
  }

  /**
   * OTP-based authentication methods
   */
  get otpAuth() {
    const self = this;
    return {
      async requestVerificationCode(email: string, sessionId: string | null = null): Promise<any> {
        const now = Date.now();
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Create OTP record
        const otpRecord = await self.collection('_internal_otps').add({
          email,
          otp,
          created_at: now,
          expires_at: now + 300000, // 5 minutes
          used: false
        });

        // Create session-specific status if sessionId provided
        if (sessionId) {
          const statusCollection = `_session_${sessionId}_otp_status`;
          await self.collection(statusCollection).add({
            status: 'sent',
            email,
            message: 'OTP sent to your email',
            created_at: now
          });
        }

        return {
          success: true,
          message: 'OTP sent successfully',
          otpId: otpRecord.id
        };
      },

      async register(userData: any, otp: string): Promise<any> {
        const email = userData.email;
        if (!email) {
          throw new Error('Email is required');
        }

        // Verify OTP
        await self._verifyOtp(email, otp);

        // Check for duplicate email
        const existingUsers = await self.collection('users')
          .where('email', '==', email)
          .get();

        if (existingUsers.length > 0) {
          throw new Error('User with this email already exists');
        }

        // Create user with default fields
        const now = Date.now();
        const userRecord = await self.collection('users').add({
          ...userData,
          status: userData.status || 'active',
          created_at: now,
          role: userData.role || 'user'
        });

        return userRecord;
      },

      async updatePassword(userId: string, newPassword: string, otp: string): Promise<any> {
        const user = await self.collection('users').doc(userId).get();
        if (!user) throw new Error('User not found');

        const email = user.data.email;
        await self._verifyOtp(email, otp);

        return self.collection('users').doc(userId).update({
          ...user.data,
          password: newPassword,
          updated_at: Date.now()
        });
      },

      async deleteAccount(userId: string, otp: string): Promise<any> {
        const user = await self.collection('users').doc(userId).get();
        if (!user) throw new Error('User not found');

        const email = user.data.email;
        await self._verifyOtp(email, otp);

        return self.collection('users').doc(userId).delete();
      }
    };
  }

  /**
   * Verify OTP code
   * @private
   */
  private async _verifyOtp(email: string, otp: string): Promise<boolean> {
    // Query for valid OTP
    const otpRecords = await this.collection('_internal_otps')
      .where('email', '==', email)
      .where('otp', '==', otp)
      .where('used', '==', false)
      .get();

    if (otpRecords.length === 0) {
      throw new Error('Invalid or expired OTP');
    }

    const otpRecord = otpRecords[0];

    // Check expiration
    if (Date.now() > (otpRecord.data as any).expires_at) {
      throw new Error('OTP has expired');
    }

    // Mark OTP as used
    await this.collection('_internal_otps').doc(otpRecord.id).update({
      used: true,
      used_at: Date.now()
    });

    return true;
  }

  /**
   * Legacy verification method (for backward compatibility)
   */
  async _verifyCode(target: string, code: string): Promise<boolean> {
    const res = await this.collection('__internal_verification__').doc(target).get();
    if (!res) {
      throw new Error(`No verification code found for ${target}`);
    }
    if ((res.data as any).code !== code) {
      throw new Error('Invalid verification code');
    }
    if (Date.now() > (res.data as any).expires_at) {
      throw new Error('Verification code expired');
    }
    await this.collection('__internal_verification__').doc(target).delete();
    return true;
  }

  /**
   * Check if user is authenticated (legacy method for backward compatibility)
   * @deprecated Use client.auth.isAuthenticated instead
   */
  isAuthenticated(): boolean {
    return !!this.jwt;
  }

  /**
   * Get current user (legacy method for backward compatibility)
   * @deprecated Use client.auth.user instead
   */
  getCurrentUser(): User | null {
    return this.user;
  }
}

/**
 * CollectionReference - Reference to a collection
 */
export class CollectionReference {
  constructor(
    public readonly client: FlareClient,
    public readonly name: string
  ) {}

  private _filters: Filter[] = [];

  /**
   * Get a document reference
   */
  doc(id: string): DocumentReference {
    return new DocumentReference(this.client, this.name, id);
  }

  /**
   * Add a document to the collection
   */
  async add<T = any>(data: T): Promise<{ id: string }> {
    const response = await fetch(`${this.client.baseURL}/collections/${this.name}`, {
      method: 'POST',
      headers: this.client._getAuthHeaders(),
      body: JSON.stringify(data)
    });
    return response.json();
  }

  /**
   * Get all documents in the collection
   */
  async get<T = any>(): Promise<QueryResult<T>> {
    const response = await fetch(`${this.client.baseURL}/collections/${this.name}`, {
      method: 'GET',
      headers: this.client._getAuthHeaders(),
    });
    return response.json();
  }

  /**
   * Create a filtered query
   */
  where(field: string, op: string, value: any): Query {
    const opMap: Record<string, any> = {
      '==': 'Eq',
      '>': 'Gt',
      '<': 'Lt',
      '>=': 'Gte',
      '<=': 'Lte',
      'in': 'In'
    };

    const queryOp: Record<string, any> = {};
    queryOp[opMap[op] || op] = value;

    // Support chaining by storing filters
    this._filters = [...this._filters, [field, queryOp]];

    // Return a new query object that supports chaining
    const query = new Query(this.client, this.name, [...this._filters]);
    return query;
  }

  /**
   * Listen to real-time updates
   */
  onSnapshot<T = any>(callback: SnapshotCallback<T>): () => void {
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

    // Return unsubscribe function
    return () => {
      this.client.socket.off('doc_created', handleDocCreated);
      this.client.socket.off('doc_updated', handleDocUpdated);
      this.client.socket.off('doc_deleted', handleDocDeleted);
    };
  }
}

/**
 * Query - Query builder for filtered queries
 */
export class Query {
  constructor(
    private client: FlareClient,
    private collectionName: string,
    private _filters: Filter[]
  ) {}

  /**
   * Add another filter to the query
   */
  where(field: string, op: string, value: any): Query {
    const opMap: Record<string, any> = {
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

    return new Query(this.client, this.collectionName, this._filters);
  }

  /**
   * Execute the query
   */
  async get<T = any>(): Promise<QueryResult<T>> {
    return this.client.query<T>(this.collectionName, this._filters);
  }
}

/**
 * DocumentReference - Reference to a single document
 */
export class DocumentReference {
  constructor(
    private client: FlareClient,
    public readonly collection: string,
    public readonly id: string
  ) {}

  /**
   * Get the document
   */
  async get<T = any>(): Promise<DocumentData<T> | null> {
    const response = await fetch(`${this.client.baseURL}/collections/${this.collection}/${this.id}`, {
      method: 'GET',
      headers: this.client._getAuthHeaders(),
    });
    const data = await response.json();
    return data === null ? null : data;
  }

  /**
   * Update the document
   */
  async update<T = any>(data: T): Promise<DocumentData<T>> {
    const response = await fetch(`${this.client.baseURL}/collections/${this.collection}/${this.id}`, {
      method: 'PUT',
      headers: this.client._getAuthHeaders(),
      body: JSON.stringify(data)
    });
    return response.json();
  }

  /**
   * Delete the document
   */
  async delete(): Promise<{ success: boolean }> {
    const response = await fetch(`${this.client.baseURL}/collections/${this.collection}/${this.id}`, {
      method: 'DELETE',
      headers: this.client._getAuthHeaders(),
    });
    return { success: response.ok };
  }

  /**
   * Listen to real-time updates
   */
  onSnapshot<T = any>(callback: SnapshotCallback<T>): () => void {
    this.client.socket.emit('subscribe', this.collection);

    const handleUpdate = (doc: any) => {
      if (doc.collection === this.collection && doc.id === this.id) {
        callback({ type: 'modified', doc });
      }
    };

    const handleDelete = (payload: any) => {
      const deletedId = typeof payload === 'string' ? payload : (payload.id || payload);
      if (deletedId === this.id) {
        callback({ type: 'removed', id: this.id });
      }
    };

    this.client.socket.on('doc_updated', handleUpdate);
    this.client.socket.on('doc_deleted', handleDelete);

    // Return unsubscribe function
    return () => {
      this.client.socket.off('doc_updated', handleUpdate);
      this.client.socket.off('doc_deleted', handleDelete);
    };
  }
}

/**
 * WriteBatch - Batched write operations
 */
export class WriteBatch {
  private operations: TransactionOperation[] = [];

  constructor(private client: FlareClient) {}

  /**
   * Set a document
   */
  set(docRef: DocumentReference, data: any): WriteBatch {
    this.operations.push({
      Set: {
        id: docRef.id,
        collection: docRef.collection,
        data: data,
        version: 1,
        updated_at: Date.now()
      }
    });
    return this;
  }

  /**
   * Update a document
   */
  update(docRef: DocumentReference, data: any): WriteBatch {
    this.operations.push({
      Update: {
        collection: docRef.collection,
        id: docRef.id,
        data: data,
        precondition: null
      }
    });
    return this;
  }

  /**
   * Delete a document
   */
  delete(docRef: DocumentReference): WriteBatch {
    this.operations.push({
      Delete: {
        collection: docRef.collection,
        id: docRef.id,
        precondition: null
      }
    });
    return this;
  }

  /**
   * Commit the batch
   */
  async commit(): Promise<BatchResult> {
    const response = await fetch(`${this.client.baseURL}/transaction`, {
      method: 'POST',
      headers: this.client._getAuthHeaders(),
      body: JSON.stringify({ operations: this.operations })
    });
    return response.json();
  }
}

/**
 * Transaction - Transaction operations
 */
export class Transaction {
  public operations: TransactionOperation[] = [];

  constructor(public readonly client: FlareClient) {}

  /**
   * Get a document in the transaction
   */
  async get<T = any>(docRef: DocumentReference, _precondition?: any): Promise<DocumentData<T> | null> {
    return docRef.get();
  }

  /**
   * Set a document in the transaction
   */
  set(docRef: DocumentReference, data: any): Transaction {
    this.operations.push({
      Set: {
        id: docRef.id,
        collection: docRef.collection,
        data: data,
        version: 1,
        updated_at: Date.now()
      }
    });
    return this;
  }

  /**
   * Update a document in the transaction
   */
  update(docRef: DocumentReference, data: any, precondition?: any): Transaction {
    this.operations.push({
      Update: {
        collection: docRef.collection,
        id: docRef.id,
        data: data,
        precondition: precondition
      }
    });
    return this;
  }

  /**
   * Delete a document in the transaction
   */
  delete(docRef: DocumentReference, _precondition?: any): Transaction {
    this.operations.push({
      Delete: {
        collection: docRef.collection,
        id: docRef.id,
        precondition: null
      }
    });
    return this;
  }
}

/**
 * FlareHook - Stateful hook connection
 */
export class FlareHook {
  private handlers: Map<string, (req: any) => Promise<any>> = new Map();

  constructor(baseURL: string, token: string, options: { events?: string[]; userContext?: Record<string, any> } = {}) {
    const socket = io(`${baseURL}/hooks`) as Socket;

    socket.on('connect', () => {
      socket.emit('register', {
        token: token,
        capabilities: {
          events: options.events || [],
          user_context: options.userContext || {}
        }
      });
    });

    socket.on('hook_request', async (req: any) => {
      console.log('[FlareHook] Received hook_request:', req);
      if (this.handlers.has(req.event_name)) {
        try {
          const data = await this.handlers.get(req.event_name)!(req);
          console.log('[FlareHook] Sending success response for', req.event_name);
          socket.emit('hook_response', {
            request_id: req.request_id,
            status: 'success',
            data
          });
        } catch (error: any) {
          console.log('[FlareHook] Sending error response for', req.event_name, error.message);
          socket.emit('hook_response', {
            request_id: req.request_id,
            status: 'error',
            error: error.message
          });
        }
      } else {
        console.log('[FlareHook] No handler registered for event:', req.event_name);
      }
    });
  }

  /**
   * Register an event handler
   */
  on(event: string, handler: (req: any) => Promise<any>): void {
    this.handlers.set(event, handler);
  }
}
