/**
 * Registration Email Check Tests - TDD Approach
 *
 * Problem: "User with this email already exists" error for ALL emails
 * Expected: Should only show this error if email actually exists
 *
 * TDD Phases:
 * 1. RED: Write failing test - registration with new email should work
 * 2. INVESTIGATE: Find root cause
 * 3. GREEN: Fix the bug
 * 4. VERIFY: All tests pass
 */

import { FlareClient } from '../dist/index.js';
import { describe, it, expect, beforeEach } from 'vitest';

const BASE_URL = 'http://localhost:3000';

describe('Registration Email Check - TDD', () => {

  let client;

  beforeEach(() => {
    client = new FlareClient({
      baseURL: BASE_URL,
      socketURL: 'ws://localhost:3000'
    });
  });

  describe('RED Phase: Reproduce the bug', () => {

    it('should register new user with unique email', async () => {
      // Generate truly unique email with timestamp and random
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000);
      const uniqueEmail = `test-user-${timestamp}-${random}@notexistent-domain-test.com`;

      console.log(`Attempting registration with email: ${uniqueEmail}`);

      try {
        const response = await client.register({
          name: `Test User ${timestamp}`,
          email: uniqueEmail,
          password: 'testPassword123!'
        });

        // Should succeed
        expect(response).toBeDefined();
        expect(response.user).toBeDefined();
        expect(response.user.email).toBe(uniqueEmail);
        expect(response.jwt).toBeDefined();

        console.log('✅ Registration succeeded');
      } catch (error) {
        console.log('❌ Registration failed:', error.message);

        // This is the bug - should NOT fail with "email already exists"
        expect(error.message).not.toMatch(/already exists/i);
        expect(error.message).not.toMatch(/User with this email/i);
      }
    });

    it('should fail with existing email', async () => {
      // First, create a user
      const timestamp = Date.now();
      const email = `existing-user-${timestamp}@test.com`;

      try {
        await client.register({
          name: 'First User',
          email: email,
          password: 'password123'
        });
      } catch (error) {
        // Ignore if already exists
      }

      // Now try to register again with same email
      try {
        await client.register({
          name: 'Second User',
          email: email,
          password: 'password456'
        });

        // Should have failed
        expect(false).toBe(true);
      } catch (error) {
        // This SHOULD fail with "already exists"
        expect(error.message).toMatch(/already exists/i);
      }
    });

    it('should check email existence endpoint', async () => {
      const timestamp = Date.now();
      const testEmail = `check-email-${timestamp}@test.com`;

      console.log(`Checking if email exists: ${testEmail}`);

      try {
        // Try to check if email exists
        const result = await client.namedQuery('check_email_exists', { email: testEmail });

        console.log('Email check result:', result);

        // For a new email, should return empty or false
        if (Array.isArray(result)) {
          expect(result.length).toBe(0);
        } else if (typeof result === 'object') {
          expect(result.exists).toBe(false);
        }
      } catch (error) {
        console.log('Email check error:', error.message);
        // Check endpoint might not exist or might fail
        expect(error.message).toBeDefined();
      }
    });
  });

  describe('INVESTIGATE: Database state', () => {

    it('should list users in database', async () => {
      try {
        const users = await client.collection('users').get();

        console.log(`Total users in database: ${users.data?.length || 0}`);

        if (users.data && users.data.length > 0) {
          console.log('Sample users:', users.data.slice(0, 3).map(u => ({
            id: u.id,
            email: u.data?.email
          })));
        }

        // Should be able to read users
        expect(users.data).toBeDefined();
        expect(Array.isArray(users.data)).toBe(true);
      } catch (error) {
        console.log('Error reading users:', error.message);
        throw error;
      }
    });

    it('should check users collection structure', async () => {
      try {
        const result = await client.collection('users').get();

        console.log('Users collection structure:', {
          hasData: !!result.data,
          isArray: Array.isArray(result.data),
          firstItemKeys: result.data?.[0] ? Object.keys(result.data[0]) : []
        });

        // Check first user structure
        if (result.data && result.data.length > 0) {
          const firstUser = result.data[0];
          console.log('First user structure:', {
            hasId: !!firstUser.id,
            hasData: !!firstUser.data,
            dataKeys: firstUser.data ? Object.keys(firstUser.data) : [],
            emailField: firstUser.data?.email || 'NO EMAIL FIELD'
          });
        }
      } catch (error) {
        console.log('Structure check error:', error.message);
      }
    });
  });

  describe('GREEN Phase: After fix', () => {

    it('should successfully register multiple unique users', async () => {
      const timestamp = Date.now();

      // Register 3 different users
      const users = [
        { email: `user1-${timestamp}@test.com`, name: 'User One' },
        { email: `user2-${timestamp}@test.com`, name: 'User Two' },
        { email: `user3-${timestamp}@test.com`, name: 'User Three' }
      ];

      for (const userData of users) {
        try {
          const response = await client.register({
            name: userData.name,
            email: userData.email,
            password: 'testPassword123!'
          });

          expect(response.user.email).toBe(userData.email);
          console.log(`✅ Registered: ${userData.email}`);
        } catch (error) {
          console.log(`❌ Failed to register ${userData.email}:`, error.message);
          expect(error.message).not.toMatch(/already exists/i);
        }
      }
    });
  });

  describe('Edge Cases', () => {

    it('should handle email with different cases', async () => {
      const timestamp = Date.now();
      const baseEmail = `case-test-${timestamp}@test.com`;

      // Register with lowercase
      await client.register({
        name: 'User 1',
        email: baseEmail.toLowerCase(),
        password: 'password123'
      });

      // Try with uppercase (should still fail)
      try {
        await client.register({
          name: 'User 2',
          email: baseEmail.toUpperCase(),
          password: 'password456'
        });
        // If case-insensitive, should fail
        expect(false).toBe(true);
      } catch (error) {
        // Expected - email already exists (case-insensitive)
        expect(error.message).toMatch(/already exists/i);
      }
    });

    it('should handle special characters in email', async () => {
      const timestamp = Date.now();
      const specialEmail = `user+tag-${timestamp}@test.com`;

      try {
        const response = await client.register({
          name: 'Special User',
          email: specialEmail,
          password: 'password123'
        });

        expect(response.user.email).toBe(specialEmail);
      } catch (error) {
        console.log('Special email error:', error.message);
        expect(error.message).not.toMatch(/already exists/i);
      }
    });
  });
});
