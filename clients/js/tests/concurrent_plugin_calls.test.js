import { describe, it, expect, beforeEach } from 'vitest';
import { createMockPlugin, MockWebSocketServer } from '../src/testing.js';

describe('Concurrent Plugin Calls - Result Isolation', () => {
    let mockServer;

    beforeEach(() => {
        mockServer = new MockWebSocketServer();
    });

    it('should isolate results for concurrent clients calling auth', async () => {
        // Register auth plugin
        mockServer.registerPlugin('plugin_1', ['auth'], {
            auth: async (req) => {
                // Simulate processing delay
                await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
                
                return {
                    ok: true,
                    user: {
                        id: `user_${req.params.email}`,
                        email: req.params.email,
                        loginTime: Date.now()
                    }
                };
            }
        });

        // 5 clients logging in concurrently
        const clientEmails = [
            'alice@example.com',
            'bob@example.com',
            'charlie@example.com',
            'diana@example.com',
            'eve@example.com'
        ];

        const promises = clientEmails.map(email =>
            mockServer.simulatePluginCall('auth', { email })
        );

        const results = await Promise.all(promises);

        // Each result should match its corresponding request
        results.forEach((result, index) => {
            expect(result.ok).toBe(true);
            expect(result.user.email).toBe(clientEmails[index]);
            expect(result.user.id).toBe(`user_${clientEmails[index]}`);
        });

        // Verify no result mixing
        const emails = results.map(r => r.user.email);
        const uniqueEmails = [...new Set(emails)];
        expect(uniqueEmails.length).toBe(clientEmails.length);
    });

    it('should isolate results for 10 concurrent clients', async () => {
        mockServer.registerPlugin('plugin_1', ['process'], {
            process: async (req) => {
                await new Promise(resolve => setTimeout(resolve, Math.random() * 30));
                return {
                    ok: true,
                    clientId: req.params.clientId,
                    data: req.params.data,
                    processedAt: Date.now()
                };
            }
        });

        const numClients = 10;
        const promises = Array.from({ length: numClients }, (_, i) =>
            mockServer.simulatePluginCall('process', {
                clientId: `client_${i}`,
                data: { value: i * 10 }
            })
        );

        const results = await Promise.all(promises);

        // Verify each client got their own result
        results.forEach((result, i) => {
            expect(result.clientId).toBe(`client_${i}`);
            expect(result.data.value).toBe(i * 10);
        });
    });

    it('should handle mixed event types concurrently', async () => {
        mockServer.registerPlugin('plugin_1', ['greet', 'calculate', 'validate'], {
            greet: async (req) => ({
                ok: true,
                message: `Hello, ${req.params.name}!`
            }),
            calculate: async (req) => ({
                ok: true,
                result: req.params.a * req.params.b
            }),
            validate: async (req) => ({
                ok: true,
                isValid: req.params.value.length > 3
            })
        });

        const promises = [
            mockServer.simulatePluginCall('greet', { name: 'Alice' }),
            mockServer.simulatePluginCall('calculate', { a: 5, b: 7 }),
            mockServer.simulatePluginCall('validate', { value: 'test123' }),
            mockServer.simulatePluginCall('greet', { name: 'Bob' }),
            mockServer.simulatePluginCall('calculate', { a: 10, b: 3 })
        ];

        const results = await Promise.all(promises);

        expect(results[0].message).toBe('Hello, Alice!');
        expect(results[1].result).toBe(35);
        expect(results[2].isValid).toBe(true);
        expect(results[3].message).toBe('Hello, Bob!');
        expect(results[4].result).toBe(30);
    });

    it('should maintain request ordering metadata', async () => {
        let requestOrder = [];
        
        mockServer.registerPlugin('plugin_1', ['track'], {
            track: async (req) => {
                requestOrder.push({
                    id: req.params.id,
                    timestamp: Date.now()
                });
                await new Promise(resolve => setTimeout(resolve, 10));
                return { ok: true, id: req.params.id };
            }
        });

        const promises = Array.from({ length: 5 }, (_, i) =>
            mockServer.simulatePluginCall('track', { id: i })
        );

        const results = await Promise.all(promises);

        // All requests should complete
        expect(results.length).toBe(5);
        results.forEach((result, i) => {
            expect(result.ok).toBe(true);
        });

        // Request log should contain all requests
        expect(requestOrder.length).toBe(5);
    });

    it('should handle concurrent error scenarios independently', async () => {
        mockServer.registerPlugin('plugin_1', ['validate'], {
            validate: async (req) => {
                if (!req.params.valid) {
                    throw new Error(`INVALID: ${req.params.clientId}`);
                }
                return { ok: true };
            }
        });

        const promises = [
            mockServer.simulatePluginCall('validate', { valid: true, clientId: 'A' }),
            mockServer.simulatePluginCall('validate', { valid: false, clientId: 'B' }),
            mockServer.simulatePluginCall('validate', { valid: true, clientId: 'C' }),
            mockServer.simulatePluginCall('validate', { valid: false, clientId: 'D' }),
        ];

        const results = await Promise.allSettled(promises);

        expect(results[0].status).toBe('fulfilled');
        expect(results[1].status).toBe('rejected');
        expect(results[1].reason.message).toContain('B');
        expect(results[2].status).toBe('fulfilled');
        expect(results[3].status).toBe('rejected');
        expect(results[3].reason.message).toContain('D');
    });
});

describe('Concurrent Plugin Calls - Multiple Plugin Instances', () => {
    let mockServer;

    beforeEach(() => {
        mockServer = new MockWebSocketServer();
    });

    it('should route to correct plugin based on event', async () => {
        mockServer.registerPlugin('auth_plugin', ['auth'], {
            auth: async (req) => ({
                ok: true,
                user: { email: req.params.email },
                plugin: 'auth'
            })
        });

        mockServer.registerPlugin('billing_plugin', ['billing'], {
            billing: async (req) => ({
                ok: true,
                amount: req.params.amount,
                plugin: 'billing'
            })
        });

        const [authResult, billingResult] = await Promise.all([
            mockServer.simulatePluginCall('auth', { email: 'user@test.com' }),
            mockServer.simulatePluginCall('billing', { amount: 99.99 })
        ]);

        expect(authResult.plugin).toBe('auth');
        expect(authResult.user.email).toBe('user@test.com');
        expect(billingResult.plugin).toBe('billing');
        expect(billingResult.amount).toBe(99.99);
    });

    it('should handle multiple plugins for same event (first wins)', async () => {
        mockServer.registerPlugin('plugin_1', ['process'], {
            process: async () => ({ ok: true, handler: 'plugin_1' })
        });

        mockServer.registerPlugin('plugin_2', ['process'], {
            process: async () => ({ ok: true, handler: 'plugin_2' })
        });

        const result = await mockServer.simulatePluginCall('process', {});

        // First registered plugin should handle the request
        expect(result.handler).toBe('plugin_1');
    });
});

describe('Concurrent Plugin Calls - Load Scenarios', () => {
    let mockServer;

    beforeEach(() => {
        mockServer = new MockWebSocketServer();
        mockServer.registerPlugin('plugin_1', ['process'], {
            process: async (req) => {
                // Simulate realistic processing time
                await new Promise(resolve => setTimeout(resolve, 5 + Math.random() * 20));
                return {
                    ok: true,
                    clientId: req.params.clientId,
                    processingTime: Date.now()
                };
            }
        });
    });

    it('should handle 20 concurrent requests', async () => {
        const numRequests = 20;
        const promises = Array.from({ length: numRequests }, (_, i) =>
            mockServer.simulatePluginCall('process', { clientId: `client_${i}` })
        );

        const startTime = Date.now();
        const results = await Promise.all(promises);
        const endTime = Date.now();

        expect(results.length).toBe(numRequests);
        results.forEach((result, i) => {
            expect(result.clientId).toBe(`client_${i}`);
            expect(result.ok).toBe(true);
        });

        // Should complete faster than sequential (20 * 25ms = 500ms)
        // Concurrent should be closer to max single request time (~25ms)
        expect(endTime - startTime).toBeLessThan(500);
    });

    it('should handle 50 concurrent requests', async () => {
        const numRequests = 50;
        const promises = Array.from({ length: numRequests }, (_, i) =>
            mockServer.simulatePluginCall('process', { clientId: `load_test_${i}` })
        );

        const startTime = Date.now();
        const results = await Promise.all(promises);
        const endTime = Date.now();

        expect(results.length).toBe(numRequests);
        results.forEach(result => {
            expect(result.ok).toBe(true);
        });

        console.log(`[Load Test 50] Completed in ${endTime - startTime}ms`);
    });

    it('should handle 100 concurrent requests', async () => {
        const numRequests = 100;
        const promises = Array.from({ length: numRequests }, (_, i) =>
            mockServer.simulatePluginCall('process', { clientId: `stress_test_${i}` })
        );

        const startTime = Date.now();
        const results = await Promise.all(promises);
        const endTime = Date.now();

        expect(results.length).toBe(numRequests);
        results.forEach(result => {
            expect(result.ok).toBe(true);
        });

        console.log(`[Load Test 100] Completed in ${endTime - startTime}ms`);
    });

    it('should maintain data integrity under concurrent load', async () => {
        // Create a plugin with shared state to test isolation
        const processedClients = new Set();
        
        mockServer.registerPlugin('plugin_stateful', ['track_client'], {
            track_client: async (req) => {
                const clientId = req.params.clientId;
                processedClients.add(clientId);
                
                await new Promise(resolve => setTimeout(resolve, 5));
                
                return {
                    ok: true,
                    clientId,
                    totalProcessed: processedClients.size
                };
            }
        });

        const numClients = 30;
        const promises = Array.from({ length: numClients }, (_, i) =>
            mockServer.simulatePluginCall('track_client', { clientId: `unique_${i}` })
        );

        const results = await Promise.all(promises);

        // All clients should be unique
        const clientIds = results.map(r => r.clientId);
        const uniqueClientIds = [...new Set(clientIds)];
        expect(uniqueClientIds.length).toBe(numClients);

        // All should be processed
        expect(processedClients.size).toBe(numClients);
    });
});
