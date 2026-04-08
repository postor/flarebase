import { describe, it, expect, beforeAll } from 'vitest';
import { FlareClient } from '../src/index.js';

const FLARE_URL = process.env.FLARE_URL || 'http://localhost:3000';

describe('Hook Registration Flow', () => {
    let client;

    beforeAll(async () => {
        client = new FlareClient(FLARE_URL);
        // Wait for socket to connect
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Socket connection timeout')), 5000);
            if (client.socket.connected) {
                clearTimeout(timeout);
                resolve();
            } else {
                client.socket.on('connect', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            }
        });
    });

    it('should complete the full registration flow via stateful hooks', async () => {
        const email = `user_${Math.random().toString(36).substring(7)}@example.com`;
        const password = 'secure_password';

        console.log(`[Test] Starting registration for ${email}`);

        // Set up Sync Policy for users collection
        await fetch(`${FLARE_URL}/collections/__config__/sync_policy_users`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                internal: ['hashed_password']
            })
        });

        // 1. Request OTP
        const otpStatusPromise = new Promise((resolve) => {
            client.sessionTable('otp_status').onSnapshot((change) => {
                if (change.type === 'added' && change.doc.data.status === 'sent') {
                    resolve(change.doc.data);
                }
            });
        });

        const otpRes = await client.callHook('request_otp', { email });
        expect(otpRes.success).toBe(true);

        const otpStatus = await otpStatusPromise;
        expect(otpStatus.status).toBe('sent');

        // 2. Retrieve OTP (Testing backdoor: Hooks write to _internal_otps)
        // In a real scenario, this would be retrieved from email
        const otps = await client.query('_internal_otps', [['email', { Eq: email }]]);
        expect(otps.length).toBeGreaterThan(0);
        const otp = otps[0].data.otp;

        // 3. Register User
        const regStatusPromise = new Promise((resolve) => {
            client.sessionTable('reg_status').onSnapshot((change) => {
                if (change.type === 'added' && change.doc.data.status === 'success') {
                    resolve(change.doc.data);
                }
            });
        });

        const regRes = await client.callHook('register_user', { email, otp, password });
        expect(regRes.success).toBe(true);
        expect(regRes.account_id).toBeDefined();

        const regStatus = await regStatusPromise;
        expect(regStatus.status).toBe('success');
        expect(regStatus.account_id).toBe(regRes.account_id);

        // 4. Verify data visibility (Sync encryption/redaction)
        // We listen to the 'users' collection and verify if 'hashed_password' is leaked
        const syncVerificationPromise = new Promise((resolve) => {
            client.collection('users').onSnapshot((change) => {
                if (change.type === 'added' && change.doc.id === regRes.account_id) {
                    resolve(change.doc.data);
                }
            });
        });

        // The user was already created during register_user, but we might have missed the first event
        // if we weren't subscribed. Let's create another "public" doc to test sync redaction.
        const testUser = await client.collection('users').add({
            email: 'other@example.com',
            hashed_password: 'SECRET_DO_NOT_SYNC'
        });

        const syncedData = await syncVerificationPromise.catch(() => null);
        // If we didn't get it via onSnapshot (race condition), let's check the testUser
        const testSyncPromise = new Promise((resolve) => {
            client.collection('users').onSnapshot((change) => {
                if (change.type === 'added' && change.doc.id === testUser.id) {
                    resolve(change.doc.data);
                }
            });
        });
        
        const testSyncedData = await testSyncPromise;
        expect(testSyncedData.email).toBe('other@example.com');
        expect(testSyncedData.hashed_password).toBeUndefined(); // Verified Redaction!
    });
});
