import { io } from 'socket.io-client';

export class FlareClient {
    constructor(baseURL, options = {}) {
        this.baseURL = baseURL;
        this.socket = io(baseURL);
        this.jwt = null; // JWT token storage
        this.user = null; // Current user info
        this.options = {
            // Auto-refresh token before expiration (default: true)
            autoRefresh: options.autoRefresh !== false,
            // Refresh token 5 minutes before expiration
            refreshThreshold: options.refreshThreshold || 5 * 60 * 1000,
            // Enable debug logging
            debug: options.debug || false,
            ...options
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
    _decodeJWT(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return null;

            const payload = JSON.parse(atob(parts[1]));
            return payload;
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
    _isTokenExpired(token) {
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
    _setupTokenRefresh() {
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

        setTimeout(async () => {
            if (this.user) {
                try {
                    // Refresh token by logging in again
                    // This is a simple implementation - a more sophisticated one
                    // would use a refresh token endpoint
                    if (this.options.debug) {
                        console.log('[Flarebase] Refreshing token...');
                    }
                    // Note: This requires storing credentials or having a refresh endpoint
                } catch (e) {
                    console.error('[Flarebase] Token refresh failed:', e);
                    // If refresh fails, clear the session
                    this._clearJWT();
                }
            }
        }, refreshTime);
    }

    /**
     * Store JWT token and user info
     * @param {string} token - JWT token
     * @param {object} user - User information
     * @private
     */
    _setJWT(token, user = null) {
        // Decode token to extract claims
        const payload = this._decodeJWT(token);

        this.jwt = token;
        this.user = {
            id: user?.id || payload?.sub || null,
            email: user?.email || payload?.email || null,
            name: user?.name || null,
            role: user?.role || payload?.role || 'user',
            exp: payload?.exp || null,
            iat: payload?.iat || null
        };

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
    _loadJWT() {
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
    _clearJWT() {
        this.jwt = null;
        this.user = null;

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
     * Store JWT token and user info
     * @param {string} token - JWT token
     * @param {object} user - User information
     */
    _setJWT(token, user = null) {
        this.jwt = token;
        this.user = user;

        // Store in localStorage for persistence
        try {
            localStorage.setItem('flarebase_jwt', token);
            if (user) {
                localStorage.setItem('flarebase_user', JSON.stringify(user));
            }
        } catch (e) {
            console.warn('Failed to store JWT in localStorage:', e);
        }
    }

    /**
     * Load JWT from localStorage
     */
    _loadJWT() {
        try {
            const token = localStorage.getItem('flarebase_jwt');
            const userStr = localStorage.getItem('flarebase_user');

            if (token) {
                this.jwt = token;
            }

            if (userStr) {
                this.user = JSON.parse(userStr);
            }
        } catch (e) {
            console.warn('Failed to load JWT from localStorage:', e);
        }
    }

    /**
     * Clear JWT and user info (logout)
     */
    _clearJWT() {
        this.jwt = null;
        this.user = null;

        try {
            localStorage.removeItem('flarebase_jwt');
            localStorage.removeItem('flarebase_user');
        } catch (e) {
            console.warn('Failed to clear JWT from localStorage:', e);
        }
    }

    /**
     * Get authorization headers for requests
     * @returns {object} Headers object with Authorization
     */
    _getAuthHeaders() {
        const headers = {
            'Content-Type': 'application/json',
        };

        if (this.jwt) {
            headers['Authorization'] = `Bearer ${this.jwt}`;
        }

        return headers;
    }

    /**
     * Login via auth hook
     * @param {object} credentials - Login credentials
     * @param {string} credentials.email - User email
     * @param {string} credentials.password - User password
     * @returns {Promise<object>} Login response with user and token
     */
    async login(credentials) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.socket.off('plugin_success');
                this.socket.off('plugin_error');
                reject(new Error('Login request timed out'));
            }, 10000);

            this.socket.once('plugin_success', (data) => {
                clearTimeout(timeout);
                this.socket.off('plugin_error');

                // Store JWT and user info
                if (data.token) {
                    this._setJWT(data.token, data.user || null);
                }

                resolve(data);
            });

            this.socket.once('plugin_error', (err) => {
                clearTimeout(timeout);
                this.socket.off('plugin_success');
                reject(new Error(err));
            });

            // Call auth plugin
            this.socket.emit('call_plugin', ['auth', {
                action: 'login',
                ...credentials
            }]);
        });
    }

    /**
     * Register via auth hook
     * @param {object} userData - User registration data
     * @returns {Promise<object>} Registration response with user and token
     */
    async register(userData) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.socket.off('plugin_success');
                this.socket.off('plugin_error');
                reject(new Error('Registration request timed out'));
            }, 10000);

            this.socket.once('plugin_success', (data) => {
                clearTimeout(timeout);
                this.socket.off('plugin_error');

                // Store JWT and user info
                if (data.token) {
                    this._setJWT(data.token, data.user || null);
                }

                resolve(data);
            });

            this.socket.once('plugin_error', (err) => {
                clearTimeout(timeout);
                this.socket.off('plugin_success');
                reject(new Error(err));
            });

            // Call auth plugin
            this.socket.emit('call_plugin', ['auth', {
                action: 'register',
                ...userData
            }]);
        });
    }

    /**
     * Logout current user
     */
    logout() {
        this._clearJWT();
    }

    /**
     * Authentication state (read-only accessor)
     * Provides access to authentication status and current user
     * @returns {object} Authentication state with isAuthenticated and user properties
     * @example
     * if (client.auth.isAuthenticated) {
     *     console.log('Logged in as:', client.auth.user);
     *     console.log('User role:', client.auth.user?.role);
     * }
     */
    get auth() {
        const self = this;
        return {
            /**
             * Check if user is authenticated
             * @returns {boolean} True if JWT token exists and is not expired
             */
            get isAuthenticated() {
                if (!self.jwt) return false;
                if (self._isTokenExpired(self.jwt)) {
                    // Clear expired token
                    self._clearJWT();
                    return false;
                }
                return true;
            },

            /**
             * Get current user information
             * @returns {object|null} User object with id, email, name, role, exp, iat
             */
            get user() {
                // Return null if not authenticated
                if (!this.isAuthenticated) return null;

                return self.user;
            },

            /**
             * Get JWT expiration time (Unix timestamp)
             * @returns {number|null} Expiration time or null if not authenticated
             */
            get expiresAt() {
                return self.user?.exp || null;
            },

            /**
             * Get time until token expires (in seconds)
             * @returns {number|null} Seconds until expiration or null if not authenticated
             */
            get expiresIn() {
                if (!self.user?.exp) return null;
                const now = Math.floor(Date.now() / 1000);
                return Math.max(0, self.user.exp - now);
            },

            /**
             * Check if token will expire soon
             * @param {number} seconds - Threshold in seconds (default: 300 = 5 minutes)
             * @returns {boolean} True if token will expire within threshold
             */
            expiresSoon(seconds = 300) {
                const expiresIn = this.expiresIn;
                return expiresIn !== null && expiresIn <= seconds;
            }
        };
    }

    /**
     * Check if user is authenticated (legacy method for backward compatibility)
     * @deprecated Use client.auth.isAuthenticated instead
     * @returns {boolean} True if authenticated
     */
    isAuthenticated() {
        return !!this.jwt;
    }

    /**
     * Get current user (legacy method for backward compatibility)
     * @deprecated Use client.auth.user instead
     * @returns {object|null} Current user object or null
     */
    getCurrentUser() {
        return this.user;
    }

    /**
     * Call a custom hook (deprecated - use callPlugin instead)
     * @deprecated Use callPlugin() instead
     */
    async callHook(eventName, params) {
        return this.callPlugin(eventName, params);
    }

    /**
     * Call a custom plugin via WebSocket
     * @param {string} eventName - Plugin event name
     * @param {object} params - Event parameters
     * @returns {Promise<object>} Plugin response
     */
    async callPlugin(eventName, params) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.socket.off('plugin_success');
                this.socket.off('plugin_error');
                reject(new Error('Plugin request timed out'));
            }, 10000);

            this.socket.once('plugin_success', (data) => {
                clearTimeout(timeout);
                this.socket.off('plugin_error');
                resolve(data);
            });

            this.socket.once('plugin_error', (err) => {
                clearTimeout(timeout);
                this.socket.off('plugin_success');
                reject(new Error(err));
            });

            this.socket.emit('call_plugin', [eventName, params]);
        });
    }

    /**
     * Execute a named query (whitelist query)
     * @param {string} queryName - Name of the query to execute
     * @param {object} params - Query parameters
     * @returns {Promise<object>} Query results
     */
    async namedQuery(queryName, params = {}) {
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
     * @param {string} queryName - Name of the query
     * @returns {Function} Fetcher function compatible with useSWR
     */
    createSWRFetcher(queryName) {
        return async (params) => {
            return await this.namedQuery(queryName, params);
        };
    }

    /**
     * Universal SWR fetcher (works with useSWR('endpoint', fetcher))
     * @returns {Function} Fetcher function
     */
    get swrFetcher() {
        return async (url) => {
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

    sessionTable(name) {
        if (!this.socket.id) {
            throw new Error('Socket not connected. Session ID not available.');
        }
        return this.collection(`_session_${this.socket.id}_${name}`);
    }

    collection(name) {
        return new CollectionReference(this, name);
    }

    async query(collection, filters = [], limit, offset) {
        const response = await fetch(`${this.baseURL}/query`, {
            method: 'POST',
            headers: this._getAuthHeaders(),
            body: JSON.stringify({ collection, filters, limit, offset })
        });
        return response.json();
    }

    batch() {
        return new WriteBatch(this);
    }

    async runTransaction(updateFunction) {
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
     * Provides OTP verification flows for enhanced security
     */
    get otpAuth() {
        const self = this;
        return {
            requestVerificationCode: async (email, sessionId = null) => {
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

            register: async (userData, otp) => {
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

            updatePassword: async (userId, newPassword, otp) => {
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

            deleteAccount: async (userId, otp) => {
                const user = await self.collection('users').doc(userId).get();
                if (!user) throw new Error('User not found');

                const email = user.data.email;
                await self._verifyOtp(email, otp);

                return self.collection('users').doc(userId).delete();
            }
        };
    }

    async _verifyOtp(email, otp) {
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
        if (Date.now() > otpRecord.data.expires_at) {
            throw new Error('OTP has expired');
        }

        // Mark OTP as used
        await this.collection('_internal_otps').doc(otpRecord.id).update({
            used: true,
            used_at: Date.now()
        });

        return true;
    }

    // Legacy verification method (for backward compatibility)
    async _verifyCode(target, code) {
        const res = await this.collection('__internal_verification__').doc(target).get();
        if (!res) {
            throw new Error(`No verification code found for ${target}`);
        }
        if (res.data.code !== code) {
            throw new Error('Invalid verification code');
        }
        if (Date.now() > res.data.expires_at) {
            throw new Error('Verification code expired');
        }
        await this.collection('__internal_verification__').doc(target).delete();
        return true;
    }
}

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
            headers: this.client._getAuthHeaders(),
            body: JSON.stringify(data)
        });
        return response.json();
    }

    async get() {
        const response = await fetch(`${this.client.baseURL}/collections/${this.name}`, {
            method: 'GET',
            headers: this.client._getAuthHeaders(),
        });
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

        // Support chaining by storing filters
        if (!this._filters) {
            this._filters = [];
        }
        this._filters.push([field, queryOp]);

        // Return a new query object that supports chaining
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
        const response = await fetch(`${this.client.baseURL}/collections/${this.collection}/${this.id}`, {
            method: 'GET',
            headers: this.client._getAuthHeaders(),
        });
        const data = await response.json();
        return data === null ? null : data;
    }

    async update(data) {
        const response = await fetch(`${this.client.baseURL}/collections/${this.collection}/${this.id}`, {
            method: 'PUT',
            headers: this.client._getAuthHeaders(),
            body: JSON.stringify(data)
        });
        return response.json();
    }

    async delete() {
        const response = await fetch(`${this.client.baseURL}/collections/${this.collection}/${this.id}`, {
            method: 'DELETE',
            headers: this.client._getAuthHeaders(),
        });
        return response.json();
    }
}

class WriteBatch {
    constructor(client) {
        this.client = client;
        this.operations = [];
    }

    set(docRef, data) {
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

    update(docRef, data) {
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

    delete(docRef) {
        this.operations.push({
            Delete: {
                collection: docRef.collection,
                id: docRef.id,
                precondition: null
            }
        });
        return this;
    }

    async commit() {
        const response = await fetch(`${this.client.baseURL}/transaction`, {
            method: 'POST',
            headers: this.client._getAuthHeaders(),
            body: JSON.stringify({ operations: this.operations })
        });
        return response.json();
    }
}

class Transaction {
    constructor(client) {
        this.client = client;
        this.operations = [];
    }

    async get(docRef, precondition = null) {
        return docRef.get();
    }

    set(docRef, data) {
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

    update(docRef, data, precondition = null) {
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

    delete(docRef, precondition = null) {
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

export class FlareHook {
    constructor(baseURL, token, options = { events: [] }) {
        this.socket = io(`${baseURL}/hooks`);
        this.token = token;
        this.options = options;
        this.handlers = new Map();

        this.socket.on('connect', () => {
            this.socket.emit('register', {
                token: this.token,
                capabilities: {
                    events: this.options.events,
                    user_context: this.options.userContext || {}
                }
            });
        });

        this.socket.on('hook_request', async (req) => {
            console.log('[FlareHook] Received hook_request:', req);
            if (this.handlers.has(req.event_name)) {
                try {
                    const data = await this.handlers.get(req.event_name)(req);
                    console.log('[FlareHook] Sending success response for', req.event_name);
                    this.socket.emit('hook_response', {
                        request_id: req.request_id,
                        status: 'success',
                        data
                    });
                } catch (error) {
                    console.log('[FlareHook] Sending error response for', req.event_name, error.message);
                    this.socket.emit('hook_response', {
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

    on(event, handler) {
        this.handlers.set(event, handler);
    }
}
