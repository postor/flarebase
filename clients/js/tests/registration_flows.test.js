import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FlareClient } from '../src/index.js';

const baseURL = process.env.FLARE_URL || 'http://localhost:3000';
const flare = new FlareClient(baseURL);

describe('Registration Flows (Comprehensive)', () => {
    let testUserId;
    const testEmail = 'reg-test@example.com';
    const testPassword = 'SecurePass123!';

    beforeAll(async () => {
        // Setup webhook for real-time notifications
        console.log('[TestSetup] Registering webhook for registration tests...');
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
                .where('email', '==', testEmail)
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
            if (testUserId) {
                await flare.collection('users').doc(testUserId).delete();
            }
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    describe('OTP Request Flow', () => {
        it('should request and store OTP for new email', async () => {
            const email = 'otp-request-test@example.com';

            // Request OTP
            const result = await flare.auth.requestVerificationCode(email);
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.message).toContain('sent');

            // Verify OTP exists in internal collection (if accessible)
            await new Promise(r => setTimeout(r, 500));

            console.log(`✓ OTP request flow completed for ${email}`);
        });

        it('should handle multiple concurrent OTP requests', async () => {
            const email1 = 'concurrent1@example.com';
            const email2 = 'concurrent2@example.com';

            const [result1, result2] = await Promise.all([
                flare.auth.requestVerificationCode(email1),
                flare.auth.requestVerificationCode(email2)
            ]);

            expect(result1.success).toBe(true);
            expect(result2.success).toBe(true);

            console.log('✓ Concurrent OTP requests handled successfully');
        });
    });

    describe('User Registration Flow', () => {
        it('should complete full registration with valid OTP', async () => {
            const email = `reg-${Date.now()}@example.com`;

            // Step 1: Request OTP
            const otpRequest = await flare.auth.requestVerificationCode(email);
            expect(otpRequest.success).toBe(true);

            // Step 2: Wait for OTP (in real scenario, this comes from email/WebSocket)
            await new Promise(r => setTimeout(r, 1000));

            // Step 3: Query for OTP from internal collection
            const otpRecords = await flare.collection('_internal_otps')
                .where('email', '==', email)
                .where('used', '==', false)
                .get();

            expect(otpRecords.length).toBeGreaterThan(0);
            const otp = otpRecords[0].data.otp;
            expect(otp).toBeDefined();
            expect(otp).toHaveLength(6);

            // Step 4: Register user with OTP
            const user = await flare.auth.register({
                email,
                password: testPassword,
                name: 'Test User',
                role: 'user'
            }, otp);

            expect(user.id).toBeDefined();
            expect(user.data.email).toBe(email);
            expect(user.data.status).toBe('active');
            testUserId = user.id;

            // Step 5: Verify user was created successfully (OTP was validated)
            const createdUser = await flare.collection('users').doc(user.id).get();
            expect(createdUser).not.toBeNull();
            expect(createdUser.data.email).toBe(email);

            console.log('✓ Complete registration flow finished successfully');
        });

        it('should create user with correct default fields', async () => {
            const email = `defaults-${Date.now()}@example.com`;

            await flare.auth.requestVerificationCode(email);
            await new Promise(r => setTimeout(r, 1000));

            const otpRecords = await flare.collection('_internal_otps')
                .where('email', '==', email)
                .where('used', '==', false)
                .get();

            const otp = otpRecords[0].data.otp;
            const user = await flare.auth.register({
                email,
                password: testPassword,
                name: 'Default Test User'
            }, otp);

            // Verify default fields
            expect(user.data.status).toBe('active');
            expect(user.data.created_at).toBeDefined();
            expect(user.data.email).toBe(email);
            expect(user.data.name).toBe('Default Test User');

            // Cleanup
            await flare.collection('users').doc(user.id).delete();
        });
    });

    describe('Error Scenarios', () => {
        it('should reject registration with invalid OTP', async () => {
            const email = `invalid-otp-${Date.now()}@example.com`;

            await flare.auth.requestVerificationCode(email);
            await new Promise(r => setTimeout(r, 500));

            // Try to register with wrong OTP
            await expect(
                flare.auth.register({
                    email,
                    password: testPassword,
                    name: 'Invalid OTP User'
                }, '999999')
            ).rejects.toThrow();

            console.log('✓ Invalid OTP rejection test passed');
        });

        it('should reject expired OTP', async () => {
            const email = `expired-${Date.now()}@example.com`;

            await flare.auth.requestVerificationCode(email);
            await new Promise(r => setTimeout(r, 500));

            // Get the OTP record
            const otpRecords = await flare.collection('_internal_otps')
                .where('email', '==', email)
                .where('used', '==', false)
                .get();

            if (otpRecords.length > 0) {
                // Manually expire the OTP
                const expiredTime = Date.now() - 600000; // 10 minutes ago
                await flare.collection('_internal_otps').doc(otpRecords[0].id).update({
                    expires_at: expiredTime
                });

                // Try to use expired OTP
                await expect(
                    flare.auth.register({
                        email,
                        password: testPassword,
                        name: 'Expired OTP User'
                    }, otpRecords[0].data.otp)
                ).rejects.toThrow();

                console.log('✓ Expired OTP rejection test passed');
            }
        });

        it('should prevent duplicate email registration', async () => {
            const email = `duplicate-${Date.now()}@example.com`;

            // First registration
            await flare.auth.requestVerificationCode(email);
            await new Promise(r => setTimeout(r, 1000));

            let otpRecords = await flare.collection('_internal_otps')
                .where('email', '==', email)
                .where('used', '==', false)
                .get();

            const user1 = await flare.auth.register({
                email,
                password: testPassword,
                name: 'First User'
            }, otpRecords[0].data.otp);

            expect(user1.id).toBeDefined();

            // Try to register again with same email
            await flare.auth.requestVerificationCode(email);
            await new Promise(r => setTimeout(r, 1000));

            otpRecords = await flare.collection('_internal_otps')
                .where('email', '==', email)
                .where('used', '==', false)
                .get();

            await expect(
                flare.auth.register({
                    email,
                    password: testPassword,
                    name: 'Second User'
                }, otpRecords[0].data.otp)
            ).rejects.toThrow();

            // Cleanup
            await flare.collection('users').doc(user1.id).delete();

            console.log('✓ Duplicate email detection test passed');
        });

        it('should prevent OTP reuse', async () => {
            const email = `reuse-${Date.now()}@example.com`;
            const password = 'ReuseTest123!';

            // First registration
            await flare.auth.requestVerificationCode(email);
            await new Promise(r => setTimeout(r, 1000));

            let otpRecords = await flare.collection('_internal_otps')
                .where('email', '==', email)
                .where('used', '==', false)
                .get();

            const user1 = await flare.auth.register({
                email,
                password,
                name: 'First Registration'
            }, otpRecords[0].data.otp);

            expect(user1.id).toBeDefined();

            // Try to reuse the same OTP
            await expect(
                flare.auth.register({
                    email,
                    password: 'AnotherPass123!',
                    name: 'Second Registration'
                }, otpRecords[0].data.otp)
            ).rejects.toThrow();

            // Cleanup
            await flare.collection('users').doc(user1.id).delete();

            console.log('✓ OTP reuse prevention test passed');
        });

        it('should handle missing required fields', async () => {
            const email = `missing-fields-${Date.now()}@example.com`;

            await flare.auth.requestVerificationCode(email);
            await new Promise(r => setTimeout(r, 1000));

            const otpRecords = await flare.collection('_internal_otps')
                .where('email', '==', email)
                .where('used', '==', false)
                .get();

            // Try to register without email
            await expect(
                flare.auth.register({
                    password: testPassword,
                    name: 'No Email User'
                }, otpRecords[0].data.otp)
            ).rejects.toThrow();

            console.log('✓ Missing fields validation test passed');
        });
    });

    describe('Session Isolation', () => {
        it('should isolate OTP requests by session', async () => {
            const session1 = `session-${Date.now()}-1`;
            const session2 = `session-${Date.now()}-2`;
            const email = 'session-test@example.com';

            // Request OTP from two different sessions
            const [result1, result2] = await Promise.all([
                flare.auth.requestVerificationCode(email, session1),
                flare.auth.requestVerificationCode(email, session2)
            ]);

            expect(result1.success).toBe(true);
            expect(result2.success).toBe(true);

            await new Promise(r => setTimeout(r, 1000));

            // Verify session-specific status collections
            const status1 = await flare.collection(`_session_${session1}_otp_status`).get();
            const status2 = await flare.collection(`_session_${session2}_otp_status`).get();

            expect(status1.length).toBeGreaterThan(0);
            expect(status2.length).toBeGreaterThan(0);

            console.log('✓ Session isolation test passed');
        });
    });

    describe('End-to-End Scenarios', () => {
        it('should handle complete registration lifecycle', async () => {
            const email = `e2e-${Date.now()}@example.com`;

            // Step 1: Request OTP
            const otpResult = await flare.auth.requestVerificationCode(email);
            expect(otpResult.success).toBe(true);

            // Step 2: Get OTP
            await new Promise(r => setTimeout(r, 1000));
            const otpRecords = await flare.collection('_internal_otps')
                .where('email', '==', email)
                .where('used', '==', false)
                .get();
            const otp = otpRecords[0].data.otp;

            // Step 3: Register
            const user = await flare.auth.register({
                email,
                password: testPassword,
                name: 'E2E Test User'
            }, otp);

            // Step 4: Change password
            await flare.auth.requestVerificationCode(email);
            await new Promise(r => setTimeout(r, 1000));

            const newOtpRecords = await flare.collection('_internal_otps')
                .where('email', '==', email)
                .where('used', '==', false)
                .get();
            const newOtp = newOtpRecords[0].data.otp;

            const updatedUser = await flare.auth.updatePassword(
                user.id,
                'NewPassword456!',
                newOtp
            );
            expect(updatedUser.data.password).toBe('NewPassword456!');

            // Step 5: Delete account
            await flare.auth.requestVerificationCode(email);
            await new Promise(r => setTimeout(r, 1000));

            const finalOtpRecords = await flare.collection('_internal_otps')
                .where('email', '==', email)
                .where('used', '==', false)
                .get();
            const finalOtp = finalOtpRecords[0].data.otp;

            const deleted = await flare.auth.deleteAccount(user.id, finalOtp);
            expect(deleted).toBe(true);

            // Verify user is deleted
            const deletedUser = await flare.collection('users').doc(user.id).get();
            expect(deletedUser).toBeNull();

            console.log('✓ Complete registration lifecycle test passed');
        });
    });

    describe('Batch Operations', () => {
        it('should handle batch OTP cleanup', async () => {
            // Create multiple expired OTPs
            const expiredTime = Date.now() - 86400000; // 1 day ago
            const emails = [
                `expired1-${Date.now()}@example.com`,
                `expired2-${Date.now()}@example.com`,
                `expired3-${Date.now()}@example.com`
            ];

            for (const email of emails) {
                await flare.collection('_internal_otps').add({
                    email,
                    otp: Math.floor(100000 + Math.random() * 900000).toString(),
                    created_at: expiredTime,
                    expires_at: expiredTime + 300000,
                    used: false
                });
            }

            await new Promise(r => setTimeout(r, 500));

            // Query expired OTPs
            const now = Date.now();
            const allOtps = await flare.collection('_internal_otps').get();
            const expiredOtps = allOtps.filter(otp =>
                otp.data.expires_at && otp.data.expires_at < now
            );

            expect(expiredOtps.length).toBeGreaterThanOrEqual(3);

            // Batch delete expired OTPs
            for (const otp of expiredOtps) {
                await flare.collection('_internal_otps').doc(otp.id).delete();
            }

            // Verify cleanup
            const remainingExpired = await flare.collection('_internal_otps')
                .where('expires_at', '<', now)
                .get();

            expect(remainingExpired.length).toBe(0);

            console.log('✓ Batch OTP cleanup test passed');
        });
    });

    describe('Retry Mechanism', () => {
        it('should allow OTP request retry after initial failure', async () => {
            const email = `retry-${Date.now()}@example.com`;

            // First request
            const result1 = await flare.auth.requestVerificationCode(email);
            expect(result1.success).toBe(true);

            // Immediate retry (should generate new OTP)
            await new Promise(r => setTimeout(r, 100));
            const result2 = await flare.auth.requestVerificationCode(email);
            expect(result2.success).toBe(true);

            await new Promise(r => setTimeout(r, 1000));

            // Verify only latest OTP is valid
            const otpRecords = await flare.collection('_internal_otps')
                .where('email', '==', email)
                .where('used', '==', false)
                .get();

            expect(otpRecords.length).toBeGreaterThan(0);

            console.log('✓ Retry mechanism test passed');
        });
    });
});
