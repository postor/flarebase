import { describe, it, expect, beforeAll } from 'vitest';
import { FlareClient } from '../src/index.js';
import axios from 'axios';

const baseURL = 'http://localhost:3000';
const flare = new FlareClient(baseURL);

describe('User Lifecycle', () => {
    let userId;
    const username = 'testuser@example.com';

    it('should register a new user with verification code', async () => {
        // 1. Request verification code (adds to verification_requests)
        await flare.auth.requestVerificationCode(username);

        // 2. Wait a bit for the mock hook in Rust to pick it up and generate the code
        await new Promise(resolve => setTimeout(resolve, 500));

        // 3. Fetch the code from the internal collection (for testing)
        // In our mock hook, it stores the code in __internal_verification__ with ID = target
        const res = await flare.collection('__internal_verification__').doc(username).get();
        const code = res.data.code;
        expect(code).toBeDefined();

        // 4. Register
        const user = await flare.auth.register({
            username,
            password: 'password123',
            name: 'Test User'
        }, code);

        expect(user.id).toBeDefined();
        userId = user.id;
    });

    it('should change password with verification code', async () => {
        // 1. Request code
        await flare.auth.requestVerificationCode(username);
        await new Promise(resolve => setTimeout(resolve, 500));

        // 2. Mock fetching the code
        const res = await flare.collection('__internal_verification__').doc(username).get();
        const code = res.data.code;

        // 3. Change password
        const updatedUser = await flare.auth.updatePassword(userId, 'newpassword456', code);
        expect(updatedUser.data.password).toBe('newpassword456');
    });

    it('should delete account with verification code', async () => {
        // 1. Request code
        await flare.auth.requestVerificationCode(username);
        await new Promise(resolve => setTimeout(resolve, 500));

        // 2. Mock fetching the code
        const res = await flare.collection('__internal_verification__').doc(username).get();
        const code = res.data.code;

        // 3. Delete account
        const result = await flare.auth.deleteAccount(userId, code);
        expect(result).toBe(true);

        // 4. Verify user is gone
        const user = await flare.collection('users').doc(userId).get();
        expect(user).toBeNull();
    });
});
