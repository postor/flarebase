/**
 * FlarePluginClient - Client for building plugin services
 * 
 * This class allows you to create standalone plugin services that connect
 * to Flarebase via WebSocket and handle plugin events.
 */

import { io } from 'socket.io-client';

/**
 * Create a mock plugin for testing purposes
 * @param {Object} options - Mock plugin options
 * @param {string[]} options.events - Array of event names this plugin handles
 * @param {Object} options.handlers - Event handlers map
 * @returns {MockPlugin} Mock plugin instance
 */
export function createMockPlugin(options) {
    const { events = [], handlers = {} } = options;
    
    return new MockPlugin(events, handlers);
}

/**
 * MockPlugin - Simulates a plugin connection without requiring a real WebSocket server
 * Can be used with FlareClient for testing plugin calls in isolation
 */
class MockPlugin {
    constructor(events, handlers) {
        this.events = events;
        this.handlers = handlers;
        this.isConnected = false;
        this.requestCount = 0;
        this.requestLog = [];
    }

    /**
     * Simulate handling a plugin request
     * @param {string} eventName - Event name
     * @param {Object} params - Request parameters
     * @param {Object} jwt - JWT context (optional)
     * @returns {Promise<Object>} Response
     */
    async handleRequest(eventName, params, jwt = null) {
        this.requestCount++;
        this.requestLog.push({
            eventName,
            params,
            jwt,
            timestamp: Date.now()
        });

        const handler = this.handlers[eventName];
        if (!handler) {
            throw new Error(`No handler registered for event: ${eventName}`);
        }

        const request = {
            request_id: `mock_req_${this.requestCount}`,
            event_name: eventName,
            session_id: 'mock_session',
            params,
            $jwt: jwt || { user_id: null, email: null, role: 'guest' }
        };

        return await handler(request);
    }

    /**
     * Get request history
     * @returns {Array} Request log
     */
    getRequestLog() {
        return [...this.requestLog];
    }

    /**
     * Reset request log
     */
    resetLog() {
        this.requestLog = [];
        this.requestCount = 0;
    }
}

/**
 * FlarePluginClient - Build a plugin service
 * Connects to Flarebase WebSocket server and registers event handlers
 */
export class FlarePluginClient {
    /**
     * Create a new plugin client
     * @param {string} url - WebSocket URL (e.g., 'ws://localhost:3000/hooks')
     * @param {string} token - Auth token (optional)
     * @param {Object} options - Plugin options
     * @param {string[]} options.events - Events this plugin handles
     * @param {boolean} options.autoConnect - Auto-connect on creation
     */
    constructor(url, token = null, options = {}) {
        this.url = url;
        this.token = token;
        this.events = options.events || [];
        this.autoConnect = options.autoConnect !== false;
        this.handlers = new Map();
        this.socket = null;
        this.isConnected = false;
        this.requestCount = 0;
    }

    /**
     * Register an event handler
     * @param {string} eventName - Event name to handle
     * @param {Function} handler - Async handler function
     * Handler receives request object: { request_id, event_name, session_id, params, $jwt }
     */
    on(eventName, handler) {
        this.handlers.set(eventName, handler);
        if (!this.events.includes(eventName)) {
            this.events.push(eventName);
        }
        return this;
    }

    /**
     * Connect to Flarebase server
     * @returns {Promise<void>}
     */
    connect() {
        return new Promise((resolve, reject) => {
            this.socket = io(this.url);

            this.socket.on('connect', () => {
                this.isConnected = true;
                
                // Register capabilities
                this.socket.emit('register', {
                    capabilities: {
                        events: this.events
                    }
                });

                resolve();
            });

            this.socket.on('disconnect', () => {
                this.isConnected = false;
            });

            // Listen for plugin requests
            this.socket.on('plugin_request', async (data) => {
                const { request_id, event_name, session_id, params, $jwt } = data;
                
                try {
                    const handler = this.handlers.get(event_name);
                    if (!handler) {
                        throw new Error(`No handler for event: ${event_name}`);
                    }

                    const result = await handler({
                        request_id,
                        event_name,
                        session_id,
                        params,
                        $jwt
                    });

                    // Send success response
                    this.socket.emit('plugin_response', {
                        request_id,
                        success: true,
                        data: result
                    });
                } catch (error) {
                    // Send error response
                    this.socket.emit('plugin_response', {
                        request_id,
                        success: false,
                        error: error.message
                    });
                }
            });

            this.socket.on('connect_error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.isConnected = false;
        }
    }
}

/**
 * MockWebSocketServer - Simulates server-side plugin handling for testing
 * Allows testing client plugin calls without a real server
 */
export class MockWebSocketServer {
    constructor() {
        this.plugins = new Map();
        this.pendingRequests = new Map();
        this.connectionCount = 0;
    }

    /**
     * Register a mock plugin
     * @param {string} sessionId - Plugin session ID
     * @param {string[]} events - Events the plugin handles
     * @param {Object} handlers - Event handlers
     */
    registerPlugin(sessionId, events, handlers) {
        this.plugins.set(sessionId, {
            events,
            handlers,
            isConnected: true
        });
    }

    /**
     * Simulate a plugin call
     * @param {string} eventName - Event name
     * @param {Object} params - Parameters
     * @param {Object} jwt - JWT context
     * @returns {Promise<Object>} Response
     */
    async simulatePluginCall(eventName, params, jwt = null) {
        // Find a plugin that handles this event
        let foundPlugin = null;
        for (const [sessionId, plugin] of this.plugins) {
            if (plugin.events.includes(eventName) && plugin.handlers[eventName]) {
                foundPlugin = plugin;
                break;
            }
        }

        if (!foundPlugin) {
            throw new Error(`No plugin registered for event: ${eventName}`);
        }

        const handler = foundPlugin.handlers[eventName];
        const requestId = `req_${Date.now()}_${this.connectionCount++}`;
        
        const request = {
            request_id: requestId,
            event_name: eventName,
            session_id: 'mock_session',
            params,
            $jwt: jwt || { user_id: null, email: null, role: 'guest' }
        };

        return await handler(request);
    }

    /**
     * Clear all registered plugins
     */
    clear() {
        this.plugins.clear();
        this.pendingRequests.clear();
    }
}

export { MockPlugin };
