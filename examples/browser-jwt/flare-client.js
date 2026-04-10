// Flarebase Client - Browser Bundle
// This is a browser-compatible bundle of the Flarebase SDK

import { io } from 'https://cdn.socket.io/4.5.4/socket.io.esm.min.js';

export class FlareClient {
    constructor(baseURL) {
        this.baseURL = baseURL;
        this.socket = io(baseURL);
        this.jwt = null;
        this.user = null;
        this._loadJWT();
    }

    _setJWT(token, user = null) {
        this.jwt = token;
        this.user = user;

        try {
            localStorage.setItem('flarebase_jwt', token);
            if (user) {
                localStorage.setItem('flarebase_user', JSON.stringify(user));
            }
        } catch (e) {
            console.warn('Failed to store JWT in localStorage:', e);
        }
    }

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

    _getAuthHeaders() {
        const headers = {
            'Content-Type': 'application/json',
        };

        if (this.jwt) {
            headers['Authorization'] = `Bearer ${this.jwt}`;
        }

        return headers;
    }

    async login(credentials) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.socket.off('hook_success');
                this.socket.off('hook_error');
                reject(new Error('Login request timed out'));
            }, 10000);

            this.socket.once('hook_success', (data) => {
                clearTimeout(timeout);
                this.socket.off('hook_error');

                if (data.token) {
                    this._setJWT(data.token, data.user || null);
                }

                resolve(data);
            });

            this.socket.once('hook_error', (err) => {
                clearTimeout(timeout);
                this.socket.off('hook_success');
                reject(new Error(err));
            });

            this.socket.emit('call_hook', ['auth', {
                action: 'login',
                ...credentials
            }]);
        });
    }

    async register(userData) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.socket.off('hook_success');
                this.socket.off('hook_error');
                reject(new Error('Registration request timed out'));
            }, 10000);

            this.socket.once('hook_success', (data) => {
                clearTimeout(timeout);
                this.socket.off('hook_error');

                if (data.token) {
                    this._setJWT(data.token, data.user || null);
                }

                resolve(data);
            });

            this.socket.once('hook_error', (err) => {
                clearTimeout(timeout);
                this.socket.off('hook_success');
                reject(new Error(err));
            });

            this.socket.emit('call_hook', ['auth', {
                action: 'register',
                ...userData
            }]);
        });
    }

    logout() {
        this._clearJWT();
    }

    isAuthenticated() {
        return !!this.jwt;
    }

    getCurrentUser() {
        return this.user;
    }

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

    collection(name) {
        return new CollectionReference(this, name);
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
