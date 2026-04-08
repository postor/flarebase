import { io } from 'socket.io-client';

export class FlareClient {
    constructor(baseURL) {
        this.baseURL = baseURL;
        this.socket = io(baseURL);
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

    get auth() {
        return {
            requestVerificationCode: async (target) => {
                // In Flarebase, a verification request is just a document write
                // to a special collection that triggers a mock hook.
                return this.collection('verification_requests').add({ target });
            },
            register: async (userData, code) => {
                await this._verifyCode(userData.username, code);
                return this.collection('users').add(userData);
            },
            updatePassword: async (userId, newPassword, code) => {
                const user = await this.collection('users').doc(userId).get();
                if (!user) throw new Error('User not found');
                await this._verifyCode(user.data.username, code);
                return this.collection('users').doc(userId).update({ ...user.data, password: newPassword });
            },
            deleteAccount: async (userId, code) => {
                const user = await this.collection('users').doc(userId).get();
                if (!user) throw new Error('User not found');
                await this._verifyCode(user.data.username, code);
                return this.collection('users').doc(userId).delete();
            }
        };
    }

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
        // Clean up code after verification
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
        
        return {
            get: () => this.client.query(this.name, [[field, queryOp]])
        };
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
