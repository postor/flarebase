import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FlareClient } from '../src/index.js';

const baseURL = process.env.FLARE_URL || 'http://localhost:3000';
const flare = new FlareClient(baseURL);

describe('User Lifecycle (Integration)', () => {
    let userId;
    const email = 'testuser@example.com';

    beforeAll(async () => {
        // Setup Webhook in Flarebase so the Rust server knows where to send events
        console.log('[TestSetup] Registering custom webhook...');
        try {
            await flare.collection('__webhooks__').add({
                url: process.env.HOOK_URL || 'http://localhost:3001',
                events: ['DocCreated', 'DocUpdated'],
                secret: 'test-secret'
            });
            await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
            console.warn('[TestSetup] Webhook registration failed (may already exist):', err.message);
        }

        // Cleanup any existing test user
        try {
            const existingUsers = await flare.collection('users')
                .where('email', '==', email)
                .get();

            if (existingUsers.length > 0) {
                for (const user of existingUsers) {
                    await flare.collection('users').doc(user.id).delete();
                }
            }
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    afterAll(async () => {
        // Cleanup test data
        try {
            if (userId) {
                await flare.collection('users').doc(userId).delete();
            }
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    it('should register a new user using the OTP flow', async () => {
        console.log(`[Test] Requesting OTP for ${email}...`);

        // 1. Request OTP
        const otpResult = await flare.otpAuth.requestVerificationCode(email);
        expect(otpResult.success).toBe(true);

        // 2. Wait a moment for OTP to be stored
        await new Promise(r => setTimeout(r, 1000));

        // 3. Retrieve OTP from internal collection
        const otpRecords = await flare.collection('_internal_otps')
            .where('email', '==', email)
            .where('used', '==', false)
            .get();

        expect(otpRecords.length).toBeGreaterThan(0);
        const otp = otpRecords[0].data.otp;
        console.log(`[Test] Retrieved OTP: ${otp}`);
        expect(otp).toBeDefined();
        expect(otp.length).toBe(6);

        // 4. Register the user
        const user = await flare.otpAuth.register({
            email,
            password: 'password123',
            name: 'Test User'
        }, otp);

        expect(user.id).toBeDefined();
        expect(user.data.email).toBe(email);
        userId = user.id;

        // 5. Verify user was created successfully
        const createdUser = await flare.collection('users').doc(user.id).get();
        expect(createdUser).not.toBeNull();
        expect(createdUser.data.email).toBe(email);
    });

    it('should change password using updated OTP', async () => {
        // 1. Request new OTP
        await flare.auth.requestVerificationCode(email);
        await new Promise(r => setTimeout(r, 1000));

        // 2. Retrieve OTP
        const otpRecords = await flare.collection('_internal_otps')
            .where('email', '==', email)
            .where('used', '==', false)
            .get();

        const otp = otpRecords[0].data.otp;

        // 3. Update password
        const updatedUser = await flare.otpAuth.updatePassword(userId, 'newpassword456', otp);
        expect(updatedUser.data.password).toBe('newpassword456');
    });

    it('should delete account with final OTP', async () => {
        // 1. Request final OTP
        await flare.otpAuth.requestVerificationCode(email);
        await new Promise(r => setTimeout(r, 1000));

        // 2. Retrieve OTP
        const otpRecords = await flare.collection('_internal_otps')
            .where('email', '==', email)
            .where('used', '==', false)
            .get();

        const otp = otpRecords[0].data.otp;

        // 3. Delete account
        const result = await flare.otpAuth.deleteAccount(userId, otp);
        expect(result).toBe(true);

        // 4. Verify user is deleted
        const user = await flare.collection('users').doc(userId).get();
        expect(user).toBeNull();
    });
});
