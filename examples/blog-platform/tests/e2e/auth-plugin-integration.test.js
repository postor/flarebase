/**
 * Auth Plugin Integration Test
 *
 * Tests that the auth plugin service correctly handles login and registration
 * using WebSocket events.
 */

const { io } = require('socket.io-client');

const FLAREBASE_URL = process.env.FLAREBASE_URL || 'http://localhost:3000';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testAuthPlugin() {
  console.log('🧪 Starting Auth Plugin Integration Test...\n');

  // Step 1: Connect as a client
  console.log('Step 1: Connecting client to Flarebase...');
  const client = io(FLAREBASE_URL, {
    transports: ['websocket'],
    reconnection: false
  });

  await new Promise(resolve => {
    client.on('connect', resolve);
  });

  console.log('✅ Client connected\n');

  // Step 2: Test registration with new email
  console.log('Step 2: Testing user registration...');
  const testEmail = `test_${Date.now()}@example.com`;
  const testPassword = 'test123456';
  const testName = 'Test User';

  const registerResult = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Registration timeout')), 10000);

    client.on('hook_success', (data) => {
      clearTimeout(timeout);
      resolve(data);
    });

    client.on('hook_error', (error) => {
      clearTimeout(timeout);
      reject(new Error(error.error || error.message));
    });

    client.emit('call_hook', ['auth', {
      action: 'register',
      email: testEmail,
      password: testPassword,
      name: testName
    }]);
  });

  console.log('✅ Registration successful');
  console.log('   User ID:', registerResult.user.id);
  console.log('   Email:', registerResult.user.email);
  console.log('   Token:', registerResult.token.substring(0, 50) + '...\n');

  // Step 3: Test registration with existing email (should fail)
  console.log('Step 3: Testing duplicate email rejection...');
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);

      client.on('hook_success', (data) => {
        clearTimeout(timeout);
        reject(new Error('Should have failed with USER_EXISTS'));
      });

      client.on('hook_error', (error) => {
        clearTimeout(timeout);
        resolve(error);
      });

      client.emit('call_hook', ['auth', {
        action: 'register',
        email: testEmail,
        password: 'another123',
        name: 'Another User'
      }]);
    });

    console.log('✅ Duplicate email correctly rejected\n');
  } catch (error) {
    console.log('❌ Test failed:', error.message);
    client.disconnect();
    process.exit(1);
  }

  // Step 4: Test login with valid credentials
  console.log('Step 4: Testing user login...');
  const loginResult = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Login timeout')), 10000);

    client.on('hook_success', (data) => {
      clearTimeout(timeout);
      resolve(data);
    });

    client.on('hook_error', (error) => {
      clearTimeout(timeout);
      reject(new Error(error.error || error.message));
    });

    client.emit('call_hook', ['auth', {
      action: 'login',
      email: testEmail,
      password: testPassword
    }]);
  });

  console.log('✅ Login successful');
  console.log('   User ID:', loginResult.user.id);
  console.log('   Email:', loginResult.user.email);
  console.log('   Token:', loginResult.token.substring(0, 50) + '...\n');

  // Step 5: Test login with invalid credentials (should fail)
  console.log('Step 5: Testing invalid credentials...');
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);

      client.on('hook_success', (data) => {
        clearTimeout(timeout);
        reject(new Error('Should have failed with invalid credentials'));
      });

      client.on('hook_error', (error) => {
        clearTimeout(timeout);
        resolve(error);
      });

      client.emit('call_hook', ['auth', {
        action: 'login',
        email: testEmail,
        password: 'wrongpassword'
      }]);
    });

    console.log('✅ Invalid credentials correctly rejected\n');
  } catch (error) {
    console.log('❌ Test failed:', error.message);
    client.disconnect();
    process.exit(1);
  }

  // Cleanup
  client.disconnect();
  console.log('✅ All tests passed!\n');
  process.exit(0);
}

// Run tests
testAuthPlugin().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});
