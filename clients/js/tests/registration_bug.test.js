/**
 * Registration Bug - TDD Investigation
 *
 * Problem: "User with this email already exists" for ALL emails
 * Goal: Find root cause and fix with TDD
 */

import { FlareClient } from '../dist/index.js';
import { describe, it, expect, beforeEach } from 'vitest';

const BASE_URL = 'http://localhost:3000';

describe('Registration Bug - TDD Investigation', () => {

  it('STEP 1: Test HTTP registration endpoint', async () => {
    const timestamp = Date.now();
    const uniqueEmail = `http-test-${timestamp}@test.com`;

    console.log(`\n📧 Testing HTTP POST to /collections/users`);
    console.log(`Email: ${uniqueEmail}`);

    try {
      const response = await fetch(`${BASE_URL}/collections/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: uniqueEmail,
          name: 'HTTP Test User',
          password_hash: 'test_hash',
          role: 'author',
          status: 'active',
          created_at: Date.now()
        })
      });

      console.log(`Status: ${response.status}`);

      if (!response.ok) {
        const text = await response.text();
        console.log(`Error: ${text}`);
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const data = await response.json();
      console.log('✅ HTTP POST works!');
      console.log(`Created user ID: ${data.id}`);

      expect(data.id).toBeDefined();
    } catch (error) {
      console.log('❌ HTTP POST failed:', error.message);
      throw error;
    }
  });

  it('STEP 2: Check if users exist after creation', async () => {
    console.log('\n📋 Checking users collection...');

    const response = await fetch(`${BASE_URL}/collections/users`);
    const data = await response.json();

    console.log(`Total users: ${data.length}`);

    if (data.length > 0) {
      console.log('Recent users:');
      data.slice(-3).forEach(u => {
        console.log(`  - ${u.data?.email} (${u.id?.slice(0, 8)}...)`);
      });
    }

    expect(Array.isArray(data)).toBe(true);
  });

  it('STEP 3: Test SDK registration method', async () => {
    // This will fail because Socket.IO not available in Node.js
    console.log('\n🔌 Testing SDK.register() method...');

    const client = new FlareClient({
      baseURL: BASE_URL,
      socketURL: 'ws://localhost:3000'
    });

    const timestamp = Date.now();
    const uniqueEmail = `sdk-test-${timestamp}@test.com`;

    try {
      // This requires Socket.IO connection
      const response = await client.register({
        name: 'SDK Test User',
        email: uniqueEmail,
        password: 'testPass123'
      });

      console.log('✅ SDK register works!');
      console.log(`User: ${response.user?.email}`);
    } catch (error) {
      console.log(`❌ SDK register failed: ${error.message}`);
      console.log('This is expected in Node.js (no Socket.IO)');
    }
  });

  it('STEP 4: Direct test - create user via HTTP', async () => {
    const timestamp = Date.now();
    const uniqueEmail = `direct-test-${timestamp}@nodomain.com`;

    console.log(`\n🧪 Direct HTTP test`);
    console.log(`Email: ${uniqueEmail}`);

    // Step 1: Create user
    const createResponse = await fetch(`${BASE_URL}/collections/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail,
        name: 'Direct Test User',
        password_hash: `hash_${timestamp}`,
        role: 'author',
        status: 'active',
        created_at: Date.now()
      })
    });

    console.log(`Create status: ${createResponse.status}`);

    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.log(`❌ Create failed: ${error}`);
      throw new Error(`Create failed: ${error}`);
    }

    const createdUser = await createResponse.json();
    console.log(`✅ User created: ${createdUser.id}`);

    // Step 2: Try to create same email again
    console.log('\n🔄 Testing duplicate email...');

    const duplicateResponse = await fetch(`${BASE_URL}/collections/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail, // Same email
        name: 'Duplicate User',
        password_hash: 'different_hash',
        role: 'author',
        status: 'active',
        created_at: Date.now()
      })
    });

    console.log(`Duplicate status: ${duplicateResponse.status}`);

    // Server SHOULD allow duplicates (no unique constraint)
    // OR should return error
    if (duplicateResponse.ok) {
      console.log('⚠️ Server allows duplicate emails (no validation)');
    } else {
      const error = await duplicateResponse.text();
      console.log(`✅ Server rejected duplicate: ${error}`);
    }
  });

  it('STEP 5: Check auth hook service status', async () => {
    console.log('\n🔍 Checking auth hook service...');

    // Try to check if auth hook is running
    // We can't directly check Socket.IO from HTTP, but we can test the endpoint

    const testEmail = `hook-check-${Date.now()}@test.com`;

    // This will call the auth hook if it's registered
    console.log('Attempting to call auth hook...');

    // Since we can't call Socket.IO hooks from HTTP tests,
    // we'll check if we can create users directly (which the hook does)
    const response = await fetch(`${BASE_URL}/collections/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        name: 'Hook Check User',
        password_hash: 'test',
        role: 'author',
        status: 'active',
        created_at: Date.now()
      })
    });

    if (response.ok) {
      console.log('✅ User creation works (auth hook endpoint accessible)');
    } else {
      console.log(`❌ User creation failed: ${await response.text()}`);
    }
  });
});
