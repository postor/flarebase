import { describe, it, expect, beforeAll } from 'vitest';
import { FlareClient } from '../src/index.js';

const baseURL = process.env.FLARE_URL || 'http://localhost:3000';
const flare = new FlareClient(baseURL);

/**
 * Helper to wait for a verification code to arrive via Socket.io
 */
async function waitForCode(target) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Timed out waiting for code for ${target}`));
        }, 10000);

        flare.collection('__internal_verification__').onSnapshot((change) => {
            if ((change.type === 'added' || change.type === 'modified') && 
                (change.doc.id === target || change.doc.data.target === target)) {
                clearTimeout(timeout);
                resolve(change.doc.data.code);
            }
        });
    });
}

describe('User Lifecycle (Integration)', () => {
    let userId;
    const username = 'testuser@example.com';

    beforeAll(async () => {
        // Setup Webhook in Flarebase so the Rust server knows where to send events
        console.log('[TestSetup] Registering custom webhook...');
        await flare.collection('__webhooks__').add({
            url: process.env.HOOK_URL || 'http://localhost:3001',
            events: ['DocCreated'],
            secret: 'test-secret'
        });
        
        // Wait a small buffer for Flarebase to register the hook
        await new Promise(r => setTimeout(r, 1000));
    });

    it('should register a new user using the Webhook -> Socket.io flow', async () => {
        console.log(`[Test] Requesting code for ${username}...`);
        
        // 1. Start listening for the real-time update
        const codePromise = waitForCode(username);

        // 2. Request code (triggers DocCreated in verification_requests)
        await flare.auth.requestVerificationCode(username);

        // 3. Wait for the code to be pushed via Socket.io
        const code = await codePromise;
        console.log(`[Test] Received code via Socket.io: ${code}`);
        expect(code).toBeDefined();
        expect(code.length).toBe(6);

        // 4. Register the user
        const user = await flare.auth.register({
            username,
            password: 'password123',
            name: 'Test User'
        }, code);

        expect(user.id).toBeDefined();
        userId = user.id;
    });

    it('should change password using updated OTP', async () => {
        const codePromise = waitForCode(username);
        
        await flare.auth.requestVerificationCode(username);
        const code = await codePromise;
        
        const updatedUser = await flare.auth.updatePassword(userId, 'newpassword456', code);
        expect(updatedUser.data.password).toBe('newpassword456');
    });

    it('should delete account with final OTP', async () => {
        const codePromise = waitForCode(username);
        
        await flare.auth.requestVerificationCode(username);
        const code = await codePromise;
        
        const result = await flare.auth.deleteAccount(userId, code);
        expect(result).toBe(true);

        const user = await flare.collection('users').doc(userId).get();
        expect(user).toBeNull();
    });
});
