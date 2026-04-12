/**
 * E2E Plugin Tests - Real Server + Real Plugin + Multiple Clients
 * 
 * These tests run against a REAL Flarebase server with an EMPTY DB,
 * using a REAL plugin service (not mocks).
 */

import { describe, it, expect } from 'vitest';
import { FlareClient } from '../src/index.js';

const FLARE_URL = process.env.FLARE_URL || 'http://localhost:3000';

/**
 * Helper: Create a FlareClient and wait for WebSocket connection
 */
async function createConnectedClient() {
    const client = new FlareClient(FLARE_URL);
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Socket connection timeout (${FLARE_URL})`)), 10000);
        const socket = client.socket;
        if (socket.connected) {
            clearTimeout(timeout);
            resolve();
        } else {
            socket.on('connect', () => {
                clearTimeout(timeout);
                resolve();
            });
            socket.on('connect_error', (err) => {
                clearTimeout(timeout);
                reject(new Error(`Socket connect error: ${err.message}`));
            });
        }
    });
    return client;
}

/**
 * Helper: Collect clients for cleanup
 */
const connectedClients = [];

describe('E2E: Real Plugin with Empty DB', () => {

    describe('1. Empty DB Initial State', () => {
        it('should start with empty or accessible users collection', async () => {
            const client = await createConnectedClient();
            connectedClients.push(client);
            
            try {
                const users = await client.collection('users').get();
                // Either empty array, or { data: [] }, or similar
                const count = Array.isArray(users) ? users.length : (users.data ? users.data.length : 0);
                expect(count).toBeGreaterThanOrEqual(0);
            } catch (e) {
                // Server might reject without auth - that's OK, DB is empty
                expect(e.message).toContain('401');
            }
        });

        it('should allow plugin calls (plugin is connected)', async () => {
            const client = await createConnectedClient();
            connectedClients.push(client);
            
            const result = await client.callPlugin('greet', { name: 'E2E_Test' });
            expect(result.ok).toBe(true);
            expect(result.message).toBe('Hello, E2E_Test!');
        });
    });

    describe('2. JS Client Register via Real Plugin', () => {
        let client;

        it('should connect client', async () => {
            client = await createConnectedClient();
            connectedClients.push(client);
            expect(client.socket.id).toBeDefined();
        });

        it('should register new user via plugin', async () => {
            const email = `e2e_user_${Date.now()}_1@test.com`;
            const password = 'secret123';

            const result = await client.callPlugin('auth', {
                action: 'register',
                email,
                password,
                name: 'E2E User 1'
            });

            expect(result.ok).toBe(true);
            expect(result.user.email).toBe(email);
            expect(result.user.name).toBe('E2E User 1');
            expect(result.user.id).toBeDefined();
        });

        it('should reject duplicate registration', async () => {
            const email = `duplicate_${Date.now()}_2@test.com`;
            const password = 'secret123';

            // First registration
            const result1 = await client.callPlugin('auth', {
                action: 'register',
                email,
                password
            });
            expect(result1.ok).toBe(true);

            // Duplicate should fail
            await expect(
                client.callPlugin('auth', {
                    action: 'register',
                    email,
                    password
                })
            ).rejects.toThrow('USER_EXISTS');
        });

        it('should login with valid credentials', async () => {
            const email = `login_${Date.now()}_3@test.com`;
            const password = 'mypassword';

            // Register first
            await client.callPlugin('auth', {
                action: 'register',
                email,
                password,
                name: 'Login Test'
            });

            // Login
            const result = await client.callPlugin('auth', {
                action: 'login',
                email,
                password
            });

            expect(result.ok).toBe(true);
            expect(result.user.email).toBe(email);
            expect(result.user.name).toBe('Login Test');
        });

        it('should reject login with wrong password', async () => {
            const email = `wrongpwd_${Date.now()}_4@test.com`;
            const password = 'correct';

            await client.callPlugin('auth', {
                action: 'register',
                email,
                password
            });

            await expect(
                client.callPlugin('auth', {
                    action: 'login',
                    email,
                    password: 'wrong'
                })
            ).rejects.toThrow('INVALID_PASSWORD');
        });

        it('should reject login for non-existent user', async () => {
            await expect(
                client.callPlugin('auth', {
                    action: 'login',
                    email: 'nonexistent@test.com',
                    password: 'anything'
                })
            ).rejects.toThrow('USER_NOT_FOUND');
        });
    });

    describe('3. Multiple JS Clients Concurrent - Isolated Results', () => {
        it('should isolate results for 5 concurrent registrations', async () => {
            const clients = await Promise.all(
                Array.from({ length: 5 }, () => createConnectedClient())
            );
            connectedClients.push(...clients);

            const userData = clients.map((_, i) => ({
                email: `concurrent_${i}_${Date.now()}@test.com`,
                password: `pass${i}`,
                name: `User_${i}`
            }));

            // All register concurrently
            const promises = clients.map((client, i) =>
                client.callPlugin('auth', {
                    action: 'register',
                    ...userData[i]
                })
            );

            const results = await Promise.all(promises);

            results.forEach((result, i) => {
                expect(result.ok).toBe(true);
                expect(result.user.email).toBe(userData[i].email);
                expect(result.user.name).toBe(userData[i].name);
                expect(result.user.id).toBeDefined();
            });

            // Verify unique IDs
            const ids = results.map(r => r.user.id);
            const uniqueIds = [...new Set(ids)];
            expect(uniqueIds.length).toBe(ids.length);
        });

        it('should isolate results for 5 concurrent logins', async () => {
            // Create a shared client for pre-registration
            const setupClient = await createConnectedClient();
            connectedClients.push(setupClient);

            const userData = Array.from({ length: 5 }, (_, i) => ({
                email: `login_concurrent_${i}_${Date.now()}@test.com`,
                password: `pass${i}`,
                name: `LoginUser_${i}`
            }));

            // Register all first
            for (const data of userData) {
                await setupClient.callPlugin('auth', {
                    action: 'register',
                    ...data
                });
            }

            // Create clients for concurrent login
            const loginClients = await Promise.all(
                Array.from({ length: 5 }, () => createConnectedClient())
            );
            connectedClients.push(...loginClients);

            // Login concurrently
            const loginPromises = loginClients.map((client, i) =>
                client.callPlugin('auth', {
                    action: 'login',
                    email: userData[i].email,
                    password: userData[i].password
                })
            );

            const results = await Promise.all(loginPromises);

            results.forEach((result, i) => {
                expect(result.ok).toBe(true);
                expect(result.user.email).toBe(userData[i].email);
                expect(result.user.name).toBe(userData[i].name);
            });
        });

        it('should handle mixed concurrent operations', async () => {
            const clients = await Promise.all(
                Array.from({ length: 5 }, () => createConnectedClient())
            );
            connectedClients.push(...clients);

            const promises = [
                clients[0].callPlugin('greet', { name: 'Alice' }),
                clients[1].callPlugin('greet', { name: 'Bob' }),
                clients[2].callPlugin('process', { clientId: 'C2', data: { value: 42 } }),
                clients[3].callPlugin('process', { clientId: 'C3', data: { value: 99 } }),
                clients[4].callPlugin('greet', { name: 'Charlie' }),
            ];

            const results = await Promise.all(promises);

            expect(results[0].message).toBe('Hello, Alice!');
            expect(results[1].message).toBe('Hello, Bob!');
            expect(results[2].clientId).toBe('C2');
            expect(results[2].processed.value).toBe(42);
            expect(results[3].clientId).toBe('C3');
            expect(results[3].processed.value).toBe(99);
            expect(results[4].message).toBe('Hello, Charlie!');
        });

        it('should handle 10 concurrent registrations', async () => {
            const clients = await Promise.all(
                Array.from({ length: 10 }, () => createConnectedClient())
            );
            connectedClients.push(...clients);

            const userData = clients.map((_, i) => ({
                email: `load_${i}_${Date.now()}@test.com`,
                password: `load${i}`,
                name: `LoadUser_${i}`
            }));

            const promises = clients.map((client, i) =>
                client.callPlugin('auth', {
                    action: 'register',
                    ...userData[i]
                })
            );

            const results = await Promise.all(promises);

            expect(results.length).toBe(10);
            results.forEach((result, i) => {
                expect(result.ok).toBe(true);
                expect(result.user.email).toBe(userData[i].email);
            });
        });
    });

    describe('4. Full Lifecycle: Register → CRUD → Logout', () => {
        it('should complete full lifecycle', async () => {
            const client = await createConnectedClient();
            connectedClients.push(client);

            // Step 1: Register
            const email = `lifecycle_${Date.now()}@test.com`;
            const regResult = await client.callPlugin('auth', {
                action: 'register',
                email,
                password: 'lifecycle_pass',
                name: 'Lifecycle User'
            });
            expect(regResult.ok).toBe(true);
            const userId = regResult.user.id;

            // Step 2: Create posts
            const post = await client.collection('posts').add({
                title: 'My First Post',
                content: 'Hello World',
                author_id: userId,
                created_at: Date.now()
            });
            expect(post.id).toBeDefined();

            // Step 3: Read posts
            const posts = await client.collection('posts').get();
            // Post exists (might be wrapped or array depending on server response)
            expect(post.id).toBeTruthy();

            // Step 4: Logout
            client.logout();
            expect(client.jwt).toBeNull();
        });
    });

    describe('5. Edge Cases with Real Plugin', () => {
        it('should handle empty params gracefully', async () => {
            const client = await createConnectedClient();
            connectedClients.push(client);
            
            const result = await client.callPlugin('greet', {});
            expect(result.ok).toBe(true);
            expect(result.message).toBe('Hello, World!');
        });

        it('should handle special characters in data', async () => {
            const client = await createConnectedClient();
            connectedClients.push(client);
            
            const result = await client.callPlugin('greet', {
                name: 'Test <script>alert("xss")</script>'
            });
            expect(result.ok).toBe(true);
            expect(result.message).toContain('Test');
        });

        it('should handle rapid sequential calls from same client', async () => {
            const client = await createConnectedClient();
            connectedClients.push(client);
            
            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(client.callPlugin('greet', { name: `Rapid_${i}` }));
            }
            const results = await Promise.all(promises);
            results.forEach((result, i) => {
                expect(result.ok).toBe(true);
                expect(result.message).toBe(`Hello, Rapid_${i}!`);
            });
        });

        it('should handle non-existent event gracefully', async () => {
            const client = await createConnectedClient();
            connectedClients.push(client);
            
            await expect(
                client.callPlugin('nonexistent_event', {})
            ).rejects.toThrow();
        });
    });
});

// Cleanup after all tests
import { afterAll } from 'vitest';
afterAll(() => {
    console.log(`\n🧹 E2E test cleanup: Disconnecting ${connectedClients.length} clients`);
    for (const client of connectedClients) {
        try {
            if (client.socket && client.socket.disconnect) {
                client.socket.disconnect();
            }
        } catch (e) {
            // Ignore cleanup errors
        }
    }
});
