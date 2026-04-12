import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockPlugin, MockPlugin, MockWebSocketServer } from '../src/testing.js';

describe('Mock Plugin - Basic Functionality', () => {
    let mockPlugin;

    beforeEach(() => {
        mockPlugin = createMockPlugin({
            events: ['auth', 'request_otp', 'greet'],
            handlers: {
                auth: async (req) => {
                    if (req.params.action === 'login') {
                        return {
                            ok: true,
                            user: {
                                id: 'u_123',
                                email: req.params.email
                            }
                        };
                    }
                    return { ok: false, error: 'Unknown action' };
                },
                request_otp: async (req) => {
                    return {
                        ok: true,
                        email: req.params.email,
                        otp: '123456'
                    };
                },
                greet: async (req) => {
                    return {
                        ok: true,
                        message: `Hello, ${req.params.name || 'World'}!`
                    };
                }
            }
        });
    });

    it('should handle auth request', async () => {
        const result = await mockPlugin.handleRequest('auth', {
            action: 'login',
            email: 'user@example.com'
        });

        expect(result.ok).toBe(true);
        expect(result.user.email).toBe('user@example.com');
        expect(result.user.id).toBe('u_123');
    });

    it('should handle OTP request', async () => {
        const result = await mockPlugin.handleRequest('request_otp', {
            email: 'user@example.com'
        });

        expect(result.ok).toBe(true);
        expect(result.email).toBe('user@example.com');
        expect(result.otp).toBe('123456');
    });

    it('should handle greet request with custom name', async () => {
        const result = await mockPlugin.handleRequest('greet', {
            name: 'Alice'
        });

        expect(result.ok).toBe(true);
        expect(result.message).toBe('Hello, Alice!');
    });

    it('should handle greet request without name (default)', async () => {
        const result = await mockPlugin.handleRequest('greet', {});

        expect(result.ok).toBe(true);
        expect(result.message).toBe('Hello, World!');
    });

    it('should throw error for unregistered event', async () => {
        await expect(
            mockPlugin.handleRequest('unknown_event', {})
        ).rejects.toThrow('No handler registered for event: unknown_event');
    });

    it('should include JWT context in request', async () => {
        const jwt = {
            user_id: 'u_456',
            email: 'jwt_user@example.com',
            role: 'user'
        };

        let receivedJwt = null;
        const pluginWithJwt = createMockPlugin({
            events: ['test'],
            handlers: {
                test: async (req) => {
                    receivedJwt = req.$jwt;
                    return { ok: true };
                }
            }
        });

        await pluginWithJwt.handleRequest('test', {}, jwt);

        expect(receivedJwt).toEqual(jwt);
    });

    it('should provide default JWT for guest requests', async () => {
        let receivedJwt = null;
        const pluginWithGuest = createMockPlugin({
            events: ['guest_test'],
            handlers: {
                guest_test: async (req) => {
                    receivedJwt = req.$jwt;
                    return { ok: true };
                }
            }
        });

        await pluginWithGuest.handleRequest('guest_test', {});

        expect(receivedJwt.user_id).toBeNull();
        expect(receivedJwt.email).toBeNull();
        expect(receivedJwt.role).toBe('guest');
    });
});

describe('Mock Plugin - Request Tracking', () => {
    let mockPlugin;

    beforeEach(() => {
        mockPlugin = createMockPlugin({
            events: ['track'],
            handlers: {
                track: async (req) => ({ ok: true, data: req.params })
            }
        });
    });

    it('should track request count', async () => {
        expect(mockPlugin.requestCount).toBe(0);

        await mockPlugin.handleRequest('track', { id: 1 });
        expect(mockPlugin.requestCount).toBe(1);

        await mockPlugin.handleRequest('track', { id: 2 });
        expect(mockPlugin.requestCount).toBe(2);
    });

    it('should maintain request log', async () => {
        await mockPlugin.handleRequest('track', { id: 1 });
        await mockPlugin.handleRequest('track', { id: 2 });

        const log = mockPlugin.getRequestLog();
        expect(log.length).toBe(2);
        expect(log[0].params.id).toBe(1);
        expect(log[1].params.id).toBe(2);
    });

    it('should reset log on resetLog()', async () => {
        await mockPlugin.handleRequest('track', { id: 1 });
        await mockPlugin.handleRequest('track', { id: 2 });

        mockPlugin.resetLog();

        expect(mockPlugin.requestCount).toBe(0);
        expect(mockPlugin.getRequestLog()).toEqual([]);
    });

    it('should include timestamps in request log', async () => {
        const before = Date.now();
        await mockPlugin.handleRequest('track', { id: 1 });
        const after = Date.now();

        const log = mockPlugin.getRequestLog();
        expect(log[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(log[0].timestamp).toBeLessThanOrEqual(after);
    });
});

describe('MockWebSocketServer - Plugin Registration', () => {
    let mockServer;

    beforeEach(() => {
        mockServer = new MockWebSocketServer();
    });

    it('should register a plugin', () => {
        mockServer.registerPlugin('session_1', ['auth'], {
            auth: async () => ({ ok: true })
        });

        expect(mockServer.plugins.size).toBe(1);
    });

    it('should register multiple plugins', () => {
        mockServer.registerPlugin('session_1', ['auth'], {
            auth: async () => ({ ok: true, plugin: 1 })
        });
        mockServer.registerPlugin('session_2', ['auth'], {
            auth: async () => ({ ok: true, plugin: 2 })
        });

        expect(mockServer.plugins.size).toBe(2);
    });

    it('should clear all plugins', () => {
        mockServer.registerPlugin('session_1', ['auth'], {
            auth: async () => ({ ok: true })
        });
        mockServer.registerPlugin('session_2', ['billing'], {
            billing: async () => ({ ok: true })
        });

        mockServer.clear();

        expect(mockServer.plugins.size).toBe(0);
    });
});

describe('MockWebSocketServer - Plugin Calls', () => {
    let mockServer;

    beforeEach(() => {
        mockServer = new MockWebSocketServer();
        
        mockServer.registerPlugin('session_1', ['greet', 'add'], {
            greet: async (req) => ({
                ok: true,
                message: `Hello, ${req.params.name}!`
            }),
            add: async (req) => ({
                ok: true,
                result: req.params.a + req.params.b
            })
        });
    });

    it('should simulate plugin call', async () => {
        const result = await mockServer.simulatePluginCall('greet', { name: 'Bob' });

        expect(result.ok).toBe(true);
        expect(result.message).toBe('Hello, Bob!');
    });

    it('should include request metadata', async () => {
        let receivedRequest = null;
        mockServer.registerPlugin('session_2', ['capture'], {
            capture: async (req) => {
                receivedRequest = req;
                return { ok: true };
            }
        });

        await mockServer.simulatePluginCall('capture', { foo: 'bar' });

        expect(receivedRequest.event_name).toBe('capture');
        expect(receivedRequest.params.foo).toBe('bar');
        expect(receivedRequest.request_id).toBeDefined();
    });

    it('should throw error for unregistered event', async () => {
        await expect(
            mockServer.simulatePluginCall('unknown', {})
        ).rejects.toThrow('No plugin registered for event: unknown');
    });

    it('should increment connection count per call', async () => {
        await mockServer.simulatePluginCall('greet', { name: 'A' });
        await mockServer.simulatePluginCall('greet', { name: 'B' });
        await mockServer.simulatePluginCall('greet', { name: 'C' });

        expect(mockServer.connectionCount).toBe(3);
    });
});

describe('Mock Plugin - Complex Handlers', () => {
    it('should handle async operations in handlers', async () => {
        const plugin = createMockPlugin({
            events: ['fetch_data'],
            handlers: {
                fetch_data: async (req) => {
                    // Simulate async operation
                    await new Promise(resolve => setTimeout(resolve, 10));
                    return {
                        ok: true,
                        data: { id: req.params.id, fetched: true }
                    };
                }
            }
        });

        const result = await plugin.handleRequest('fetch_data', { id: 123 });

        expect(result.ok).toBe(true);
        expect(result.data.id).toBe(123);
        expect(result.data.fetched).toBe(true);
    });

    it('should handle errors in async handlers', async () => {
        const plugin = createMockPlugin({
            events: ['failing_op'],
            handlers: {
                failing_op: async (req) => {
                    if (!req.params.valid) {
                        throw new Error('INVALID_INPUT');
                    }
                    return { ok: true };
                }
            }
        });

        await expect(
            plugin.handleRequest('failing_op', { valid: false })
        ).rejects.toThrow('INVALID_INPUT');
    });

    it('should handle stateful operations', async () => {
        const state = { counter: 0 };
        const plugin = createMockPlugin({
            events: ['increment', 'get_count'],
            handlers: {
                increment: async () => {
                    state.counter++;
                    return { ok: true, count: state.counter };
                },
                get_count: async () => {
                    return { ok: true, count: state.counter };
                }
            }
        });

        await plugin.handleRequest('increment', {});
        await plugin.handleRequest('increment', {});
        await plugin.handleRequest('increment', {});

        const countResult = await plugin.handleRequest('get_count', {});
        expect(countResult.count).toBe(3);
    });
});
