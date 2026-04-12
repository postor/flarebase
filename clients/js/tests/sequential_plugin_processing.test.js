import { describe, it, expect, beforeEach } from 'vitest';
import { createMockPlugin, MockPlugin } from '../src/testing.js';

describe('Sequential Processing - Per Connection', () => {
    it('should process requests in order for single connection', async () => {
        const processingOrder = [];
        
        const plugin = createMockPlugin({
            events: ['sequential'],
            handlers: {
                sequential: async (req) => {
                    processingOrder.push({
                        id: req.params.id,
                        start: Date.now()
                    });
                    
                    // Simulate variable processing time
                    await new Promise(resolve => setTimeout(resolve, req.params.delay || 10));
                    
                    processingOrder[processingOrder.length - 1].end = Date.now();
                    
                    return {
                        ok: true,
                        id: req.params.id,
                        order: processingOrder.length
                    };
                }
            }
        });

        // Send requests in sequence
        const results = [];
        for (let i = 0; i < 5; i++) {
            const result = await plugin.handleRequest('sequential', {
                id: i,
                delay: 5
            });
            results.push(result);
        }

        // Verify order
        expect(results.length).toBe(5);
        results.forEach((result, i) => {
            expect(result.id).toBe(i);
            expect(result.order).toBe(i + 1);
        });

        // Verify processing was sequential
        expect(processingOrder.length).toBe(5);
        for (let i = 1; i < processingOrder.length; i++) {
            expect(processingOrder[i].start).toBeGreaterThanOrEqual(
                processingOrder[i - 1].start
            );
        }
    });

    it('should maintain state consistency across sequential requests', async () => {
        const state = { counter: 0, history: [] };
        
        const plugin = createMockPlugin({
            events: ['increment'],
            handlers: {
                increment: async (req) => {
                    state.counter += req.params.amount || 1;
                    state.history.push(state.counter);
                    
                    return {
                        ok: true,
                        current: state.counter,
                        history: [...state.history]
                    };
                }
            }
        });

        // Sequential increments
        const r1 = await plugin.handleRequest('increment', { amount: 1 });
        expect(r1.current).toBe(1);
        expect(r1.history).toEqual([1]);

        const r2 = await plugin.handleRequest('increment', { amount: 2 });
        expect(r2.current).toBe(3);
        expect(r2.history).toEqual([1, 3]);

        const r3 = await plugin.handleRequest('increment', { amount: 3 });
        expect(r3.current).toBe(6);
        expect(r3.history).toEqual([1, 3, 6]);
    });

    it('should handle sequential requests with varying delays', async () => {
        const timestamps = [];
        
        const plugin = createMockPlugin({
            events: ['varying_delay'],
            handlers: {
                varying_delay: async (req) => {
                    const start = Date.now();
                    timestamps.push({ id: req.params.id, start });
                    
                    await new Promise(resolve => setTimeout(resolve, req.params.delay));
                    
                    return {
                        ok: true,
                        id: req.params.id,
                        processedAt: Date.now()
                    };
                }
            }
        });

        // Requests with increasing delays
        await plugin.handleRequest('varying_delay', { id: 0, delay: 50 });
        await plugin.handleRequest('varying_delay', { id: 1, delay: 10 });
        await plugin.handleRequest('varying_delay', { id: 2, delay: 30 });

        // Verify sequential execution
        expect(timestamps[1].start).toBeGreaterThanOrEqual(timestamps[0].start);
        expect(timestamps[2].start).toBeGreaterThanOrEqual(timestamps[1].start);
    });
});

describe('Request Queue Behavior', () => {
    it('should track requests in plugin', async () => {
        const plugin = createMockPlugin({
            events: ['track'],
            handlers: {
                track: async (req) => ({ ok: true, id: req.params.id })
            }
        });

        await plugin.handleRequest('track', { id: 1 });
        await plugin.handleRequest('track', { id: 2 });
        await plugin.handleRequest('track', { id: 3 });

        const log = plugin.getRequestLog();
        expect(log.length).toBe(3);
        expect(log.map(r => r.params.id)).toEqual([1, 2, 3]);
    });

    it('should preserve request parameters exactly', async () => {
        let receivedParams = null;
        
        const plugin = createMockPlugin({
            events: ['echo'],
            handlers: {
                echo: async (req) => {
                    receivedParams = req.params;
                    return { ok: true, params: req.params };
                }
            }
        });

        const complexParams = {
            string: 'test',
            number: 42,
            boolean: true,
            null: null,
            array: [1, 2, 3],
            nested: {
                a: 'b',
                c: [4, 5, 6]
            }
        };

        await plugin.handleRequest('echo', complexParams);

        expect(receivedParams).toEqual(complexParams);
    });

    it('should handle rapid successive requests', async () => {
        const plugin = createMockPlugin({
            events: ['rapid'],
            handlers: {
                rapid: async (req) => ({
                    ok: true,
                    timestamp: Date.now()
                })
            }
        });

        // Fire 10 requests rapidly
        const promises = Array.from({ length: 10 }, (_, i) =>
            plugin.handleRequest('rapid', { seq: i })
        );

        const results = await Promise.all(promises);

        expect(results.length).toBe(10);
        expect(plugin.requestCount).toBe(10);
    });
});

describe('JWT Context Handling', () => {
    it('should pass different JWT contexts for different requests', async () => {
        const jwtContexts = [];
        
        const plugin = createMockPlugin({
            events: ['identify'],
            handlers: {
                identify: async (req) => {
                    jwtContexts.push(req.$jwt);
                    return {
                        ok: true,
                        userId: req.$jwt.user_id
                    };
                }
            }
        });

        const users = [
            { user_id: 'u_1', email: 'alice@test.com', role: 'user' },
            { user_id: 'u_2', email: 'bob@test.com', role: 'admin' },
            { user_id: 'u_3', email: 'charlie@test.com', role: 'user' }
        ];

        const results = await Promise.all(
            users.map(user => plugin.handleRequest('identify', {}, user))
        );

        expect(results[0].userId).toBe('u_1');
        expect(results[1].userId).toBe('u_2');
        expect(results[2].userId).toBe('u_3');

        expect(jwtContexts[0].user_id).toBe('u_1');
        expect(jwtContexts[1].user_id).toBe('u_2');
        expect(jwtContexts[2].user_id).toBe('u_3');
    });

    it('should handle role-based logic in handlers', async () => {
        const plugin = createMockPlugin({
            events: ['check_permission'],
            handlers: {
                check_permission: async (req) => {
                    const isAdmin = req.$jwt.role === 'admin';
                    return {
                        ok: true,
                        hasPermission: isAdmin,
                        role: req.$jwt.role
                    };
                }
            }
        });

        const adminResult = await plugin.handleRequest('check_permission', {}, {
            user_id: 'u_1', role: 'admin'
        });
        expect(adminResult.hasPermission).toBe(true);

        const userResult = await plugin.handleRequest('check_permission', {}, {
            user_id: 'u_2', role: 'user'
        });
        expect(userResult.hasPermission).toBe(false);
    });

    it('should handle guest requests with default JWT', async () => {
        let receivedJwt = null;
        
        const plugin = createMockPlugin({
            events: ['guest_access'],
            handlers: {
                guest_access: async (req) => {
                    receivedJwt = req.$jwt;
                    return {
                        ok: true,
                        isGuest: req.$jwt.role === 'guest'
                    };
                }
            }
        });

        const result = await plugin.handleRequest('guest_access', {});

        expect(result.isGuest).toBe(true);
        expect(receivedJwt.role).toBe('guest');
        expect(receivedJwt.user_id).toBeNull();
    });
});

describe('Plugin Error Handling', () => {
    it('should handle validation errors gracefully', async () => {
        const plugin = createMockPlugin({
            events: ['validate_email'],
            handlers: {
                validate_email: async (req) => {
                    const email = req.params.email;
                    if (!email || !email.includes('@')) {
                        throw new Error('INVALID_EMAIL');
                    }
                    return { ok: true, valid: true };
                }
            }
        });

        // Valid email
        const validResult = await plugin.handleRequest('validate_email', {
            email: 'user@test.com'
        });
        expect(validResult.ok).toBe(true);

        // Invalid email
        await expect(
            plugin.handleRequest('validate_email', { email: 'invalid' })
        ).rejects.toThrow('INVALID_EMAIL');

        // Missing email
        await expect(
            plugin.handleRequest('validate_email', {})
        ).rejects.toThrow('INVALID_EMAIL');
    });

    it('should handle timeout scenarios', async () => {
        const plugin = createMockPlugin({
            events: ['slow_op'],
            handlers: {
                slow_op: async (req) => {
                    await new Promise(resolve => setTimeout(resolve, req.params.delay || 1000));
                    return { ok: true };
                }
            }
        });

        // This would timeout in real scenario (10s timeout in FlareClient)
        // We test with shorter delay
        const result = await plugin.handleRequest('slow_op', { delay: 50 });
        expect(result.ok).toBe(true);
    });

    it('should handle plugin not found errors', async () => {
        const plugin = createMockPlugin({
            events: ['exists'],
            handlers: {
                exists: async () => ({ ok: true })
            }
        });

        await expect(
            plugin.handleRequest('does_not_exist', {})
        ).rejects.toThrow('No handler registered for event: does_not_exist');
    });
});

describe('Real-world Plugin Scenarios', () => {
    it('should handle OTP flow', async () => {
        const otpStore = new Map();
        
        const plugin = createMockPlugin({
            events: ['request_otp', 'verify_otp'],
            handlers: {
                request_otp: async (req) => {
                    const otp = Math.floor(100000 + Math.random() * 900000).toString();
                    otpStore.set(req.params.email, {
                        otp,
                        createdAt: Date.now(),
                        expiresAt: Date.now() + 300000 // 5 minutes
                    });

                    return {
                        ok: true,
                        message: 'OTP sent',
                        email: req.params.email
                    };
                },
                verify_otp: async (req) => {
                    const stored = otpStore.get(req.params.email);
                    if (!stored) {
                        throw new Error('OTP_NOT_FOUND');
                    }

                    if (Date.now() > stored.expiresAt) {
                        throw new Error('OTP_EXPIRED');
                    }

                    if (stored.otp !== req.params.otp) {
                        throw new Error('OTP_INVALID');
                    }

                    otpStore.delete(req.params.email);

                    return {
                        ok: true,
                        verified: true
                    };
                }
            }
        });

        // Request OTP
        const requestResult = await plugin.handleRequest('request_otp', {
            email: 'user@test.com'
        });
        expect(requestResult.ok).toBe(true);

        // Get OTP from store
        const storedOtp = otpStore.get('user@test.com').otp;

        // Verify OTP
        const verifyResult = await plugin.handleRequest('verify_otp', {
            email: 'user@test.com',
            otp: storedOtp
        });
        expect(verifyResult.ok).toBe(true);
        expect(verifyResult.verified).toBe(true);
    });

    it('should handle content moderation flow', async () => {
        const plugin = createMockPlugin({
            events: ['moderate_content'],
            handlers: {
                moderate_content: async (req) => {
                    const content = req.params.content;
                    const forbiddenWords = ['spam', 'abuse', 'violation'];
                    
                    const foundViolations = forbiddenWords.filter(word =>
                        content.toLowerCase().includes(word)
                    );

                    if (foundViolations.length > 0) {
                        return {
                            ok: true,
                            approved: false,
                            violations: foundViolations
                        };
                    }

                    return {
                        ok: true,
                        approved: true
                    };
                }
            }
        });

        // Clean content
        const cleanResult = await plugin.handleRequest('moderate_content', {
            content: 'This is a nice article'
        });
        expect(cleanResult.approved).toBe(true);

        // Content with violations
        const violationResult = await plugin.handleRequest('moderate_content', {
            content: 'This is spam content with abuse'
        });
        expect(violationResult.approved).toBe(false);
        expect(violationResult.violations).toContain('spam');
        expect(violationResult.violations).toContain('abuse');
    });

    it('should handle billing/subscription flow', async () => {
        const subscriptions = new Map();
        
        const plugin = createMockPlugin({
            events: ['subscribe', 'cancel_subscription', 'check_status'],
            handlers: {
                subscribe: async (req) => {
                    const userId = req.$jwt.user_id;
                    subscriptions.set(userId, {
                        plan: req.params.plan,
                        status: 'active',
                        subscribedAt: Date.now()
                    });

                    return {
                        ok: true,
                        subscription: {
                            plan: req.params.plan,
                            status: 'active'
                        }
                    };
                },
                cancel_subscription: async (req) => {
                    const userId = req.$jwt.user_id;
                    const sub = subscriptions.get(userId);
                    
                    if (!sub) {
                        throw new Error('NO_SUBSCRIPTION');
                    }

                    sub.status = 'cancelled';
                    
                    return {
                        ok: true,
                        cancelled: true
                    };
                },
                check_status: async (req) => {
                    const userId = req.$jwt.user_id;
                    const sub = subscriptions.get(userId);
                    
                    return {
                        ok: true,
                        subscription: sub || null
                    };
                }
            }
        });

        const userJwt = { user_id: 'u_123', email: 'user@test.com', role: 'user' };

        // Subscribe
        const subResult = await plugin.handleRequest('subscribe', {
            plan: 'premium'
        }, userJwt);
        expect(subResult.ok).toBe(true);
        expect(subResult.subscription.plan).toBe('premium');

        // Check status
        const statusResult = await plugin.handleRequest('check_status', {}, userJwt);
        expect(statusResult.subscription.status).toBe('active');

        // Cancel
        const cancelResult = await plugin.handleRequest('cancel_subscription', {}, userJwt);
        expect(cancelResult.cancelled).toBe(true);

        // Check status after cancel
        const finalStatus = await plugin.handleRequest('check_status', {}, userJwt);
        expect(finalStatus.subscription.status).toBe('cancelled');
    });
});
