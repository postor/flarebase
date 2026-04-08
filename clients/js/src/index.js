import { io } from 'socket.io-client';

export class FlareClient {
    constructor(baseURL) {
        this.baseURL = baseURL;
        this.socket = io(baseURL);
    }

    async callHook(eventName, params) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.socket.off('hook_success');
                this.socket.off('hook_error');
                reject(new Error('Hook request timed out'));
            }, 10000);

            this.socket.once('hook_success', (data) => {
                clearTimeout(timeout);
                this.socket.off('hook_error');
                resolve(data);
            });

            this.socket.once('hook_error', (err) => {
                clearTimeout(timeout);
                this.socket.off('hook_success');
                reject(new Error(err));
            });

            this.socket.emit('call_hook', [eventName, params]);
        });
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
            headers: { 'Content-Type': 'application/json' },
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operations: transaction.operations })
            });
            return response.json();
        } catch (error) {
            console.error('Transaction failed:', error);
            throw error;
        }
    }

    get auth() {
        return {
            // New OTP-based authentication (aligned with Rust tests)
            requestVerificationCode: async (email, sessionId = null) => {
                const now = Date.now();
                const otp = Math.floor(100000 + Math.random() * 900000).toString();

                // Create OTP record
                const otpRecord = await this.collection('_internal_otps').add({
                    email,
                    otp,
                    created_at: now,
                    expires_at: now + 300000, // 5 minutes
                    used: false
                });

                // Create session-specific status if sessionId provided
                if (sessionId) {
                    const statusCollection = `_session_${sessionId}_otp_status`;
                    await this.collection(statusCollection).add({
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
                await this._verifyOtp(email, otp);

                // Check for duplicate email
                const existingUsers = await this.collection('users')
                    .where('email', '==', email)
                    .get();

                if (existingUsers.length > 0) {
                    throw new Error('User with this email already exists');
                }

                // Create user with default fields
                const now = Date.now();
                const userRecord = await this.collection('users').add({
                    ...userData,
                    status: userData.status || 'active',
                    created_at: now,
                    role: userData.role || 'user'
                });

                return userRecord;
            },

            updatePassword: async (userId, newPassword, otp) => {
                const user = await this.collection('users').doc(userId).get();
                if (!user) throw new Error('User not found');

                const email = user.data.email;
                await this._verifyOtp(email, otp);

                return this.collection('users').doc(userId).update({
                    ...user.data,
                    password: newPassword,
                    updated_at: Date.now()
                });
            },

            deleteAccount: async (userId, otp) => {
                const user = await this.collection('users').doc(userId).get();
                if (!user) throw new Error('User not found');

                const email = user.data.email;
                await this._verifyOtp(email, otp);

                return this.collection('users').doc(userId).delete();
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
            headers: { 'Content-Type': 'application/json' },
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
                precondition: precondition
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
