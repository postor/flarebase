/**
 * E2E Test Plugin Service - Simplified (main namespace only)
 * 
 * A real plugin service for end-to-end testing that connects on the main
 * namespace (like custom-hook.js) and handles hook requests.
 */

import { io } from 'socket.io-client';
import { FlareClient } from '../src/index.js';

// Polyfill localStorage for Node.js (FlareClient needs it)
if (typeof localStorage === 'undefined') {
    global.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {}
    };
}

export class E2EPluginService {
    constructor(flareURL, options = {}) {
        this.flareURL = flareURL;
        this.flare = new FlareClient(flareURL);
        this.events = options.events || ['auth', 'greet', 'process', 'request_otp', 'register_user'];
        this.handlers = new Map();
        this.socket = null;
        this.isConnected = false;
        this.requestLog = [];
        
        this._registerHandlers();
    }

    async start() {
        return new Promise((resolve, reject) => {
            console.log(`[E2EPlugin] Connecting to ${this.flareURL}/plugins...`);

            // Connect to /plugins namespace
            this.socket = io(`${this.flareURL}/plugins`);

            this.socket.on('connect', () => {
                console.log(`[E2EPlugin] Connected to /plugins, socket ID: ${this.socket.id}`);
                
                // Register as a plugin on /plugins namespace
                this.socket.emit('register', {
                    token: 'E2E_TEST_TOKEN',
                    capabilities: {
                        events: this.events,
                        user_context: { role: 'e2e_plugin', service: 'e2e-test' }
                    }
                });
                this.isConnected = true;
                console.log(`[E2EPlugin] Registered events on /plugins: ${this.events.join(', ')}`);
                resolve();
            });

            this.socket.on('disconnect', () => {
                console.log('[E2EPlugin] Disconnected from /plugins');
                this.isConnected = false;
            });

            // Listen for plugin_request on /plugins namespace
            this.socket.on('plugin_request', async (req) => {
                console.log(`[E2EPlugin] Received plugin_request: ${req.event_name}`, JSON.stringify(req.params));
                this.requestLog.push({
                    eventName: req.event_name,
                    params: req.params,
                    sessionId: req.session_id,
                    timestamp: Date.now()
                });

                const handler = this.handlers.get(req.event_name);
                if (!handler) {
                    console.warn(`[E2EPlugin] No handler for ${req.event_name}`);
                    this.socket.emit('plugin_response', {
                        request_id: req.request_id,
                        status: 'error',
                        error: `No handler for event: ${req.event_name}`
                    });
                    return;
                }

                try {
                    const data = await handler(req);
                    console.log(`[E2EPlugin] Success for ${req.event_name}`);
                    this.socket.emit('plugin_response', {
                        request_id: req.request_id,
                        status: 'success',
                        data
                    });
                } catch (error) {
                    console.error(`[E2EPlugin] Error for ${req.event_name}:`, error.message);
                    this.socket.emit('plugin_response', {
                        request_id: req.request_id,
                        status: 'error',
                        error: error.message
                    });
                }
            });

            this.socket.on('connect_error', (err) => {
                console.error('[E2EPlugin] Connection error:', err.message);
                reject(err);
            });

            // Timeout after 10 seconds
            setTimeout(() => {
                if (!this.isConnected) {
                    reject(new Error('Plugin connection timeout'));
                }
            }, 10000);
        });
    }

    _registerHandlers() {
        // Auth handler (login/register)
        this.handlers.set('auth', async (req) => {
            const { action, email, password, name } = req.params;
            
            if (action === 'login') {
                const users = await this.flare.query('users', [['email', { Eq: email }]]);
                if (!Array.isArray(users) || users.length === 0) {
                    throw new Error('USER_NOT_FOUND');
                }
                
                const user = users[0];
                if (user.data.hashed_password !== 'hashed_' + password) {
                    throw new Error('INVALID_PASSWORD');
                }
                
                return {
                    ok: true,
                    action: 'login',
                    user: {
                        id: user.id,
                        email: user.data.email,
                        name: user.data.name
                    }
                };
            }
            
            if (action === 'register') {
                const existing = await this.flare.query('users', [['email', { Eq: email }]]);
                if (Array.isArray(existing) && existing.length > 0) {
                    throw new Error('USER_EXISTS');
                }
                
                const user = await this.flare.collection('users').add({
                    email,
                    name: name || email.split('@')[0],
                    hashed_password: 'hashed_' + password,
                    created_at: Date.now(),
                    role: 'user'
                });
                
                return {
                    ok: true,
                    action: 'register',
                    user: {
                        id: user.id,
                        email,
                        name: name || email.split('@')[0]
                    }
                };
            }
            
            throw new Error('UNKNOWN_ACTION');
        });

        // Greet handler
        this.handlers.set('greet', async (req) => {
            const { name } = req.params;
            return {
                ok: true,
                message: `Hello, ${name || 'World'}!`,
                sessionId: req.session_id
            };
        });

        // Process handler
        this.handlers.set('process', async (req) => {
            const { clientId, data } = req.params;
            return {
                ok: true,
                clientId,
                processed: data,
                processedAt: Date.now()
            };
        });

        // Request OTP handler
        this.handlers.set('request_otp', async (req) => {
            const { email } = req.params;
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            
            await this.flare.collection('_internal_otps').add({
                email,
                otp,
                created_at: Date.now(),
                expires_at: Date.now() + 300000,
                used: false
            });
            
            return { ok: true, email };
        });

        // Register user handler
        this.handlers.set('register_user', async (req) => {
            const { email, password, name } = req.params;
            
            const existing = await this.flare.query('users', [['email', { Eq: email }]]);
            if (Array.isArray(existing) && existing.length > 0) {
                throw new Error('USER_EXISTS');
            }
            
            const user = await this.flare.collection('users').add({
                email,
                name: name || email.split('@')[0],
                hashed_password: 'hashed_' + password,
                created_at: Date.now(),
                role: 'user'
            });
            
            return { ok: true, account_id: user.id, email };
        });
    }

    stop() {
        if (this.socket) {
            this.socket.disconnect();
            this.isConnected = false;
        }
    }

    getRequestLog() {
        return [...this.requestLog];
    }

    clearRequestLog() {
        this.requestLog = [];
    }
}

// Standalone mode: run as a service
if (process.argv[1] && process.argv[1].endsWith('e2e-plugin.js')) {
    const FLARE_URL = process.env.FLARE_URL || 'http://localhost:3000';
    const HTTP_PORT = process.env.PORT || 3002;

    const plugin = new E2EPluginService(FLARE_URL);

    plugin.start()
        .then(async () => {
            console.log(`✅ E2E Plugin connected to ${FLARE_URL}`);
            
            // HTTP readiness check
            const http = await import('http');
            http.default.createServer((req, res) => {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('E2E Plugin is ready');
            }).listen(HTTP_PORT, () => {
                console.log(`📡 Readiness HTTP server on port ${HTTP_PORT}`);
            });
        })
        .catch(err => {
            console.error('❌ Failed to start E2E plugin:', err);
            process.exit(1);
        });
}
