/**
 * Login Authentication TDD Tests
 * 
 * These tests verify that login properly validates credentials:
 * - Only registered users can login
 * - Invalid passwords are rejected
 * - Non-existent users are rejected
 * - Valid credentials succeed
 */

// Polyfill localStorage for Node.js
if (typeof localStorage === 'undefined') {
  global.localStorage = {
    _store: {},
    getItem: function(key) {
      return this._store[key] || null;
    },
    setItem: function(key, value) {
      this._store[key] = String(value);
    },
    removeItem: function(key) {
      delete this._store[key];
    },
    clear: function() {
      this._store = {};
    }
  };
}

const { io } = require('socket.io-client');

const FLARE_URL = process.env.FLARE_URL || 'http://localhost:3000';

// Test framework
let passedTests = 0;
let failedTests = 0;

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function test(name, fn) {
  try {
    log(`\n  Testing: ${name}`, 'cyan');
    await fn();
    log(`  ✓ PASSED`, 'green');
    passedTests++;
  } catch (error) {
    log(`  ✗ FAILED: ${error.message}`, 'red');
    failedTests++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
      }
    },
    toBeDefined() {
      if (actual === undefined || actual === null) {
        throw new Error(`Expected value to be defined`);
      }
    },
    toBeInstanceOf(Constructor) {
      if (!(actual instanceof Constructor)) {
        throw new Error(`Expected value to be instance of ${Constructor.name}`);
      }
    },
    toThrow(expectedMessage) {
      if (typeof actual !== 'function') {
        throw new Error(`Expected a function`);
      }
      try {
        actual();
        throw new Error(`Expected function to throw, but it didn't`);
      } catch (e) {
        if (expectedMessage && !e.message.includes(expectedMessage)) {
          throw new Error(`Expected error message to include "${expectedMessage}", but got: "${e.message}"`);
        }
      }
    }
  };
}

async function expectPromiseToReject(promise, expectedMessage) {
  try {
    await promise;
    throw new Error(`Expected promise to reject, but it resolved`);
  } catch (e) {
    if (expectedMessage && !e.message.includes(expectedMessage)) {
      throw new Error(`Expected error message to include "${expectedMessage}", but got: "${e.message}"`);
    }
  }
}

// Helper: Create connected client
async function createConnectedClient() {
  const { FlareClient } = await import('@flarebase/client');
  const client = new FlareClient(FLARE_URL, { debug: true });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket connection timeout')), 10000);
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
        reject(err);
      });
    }
  });

  return client;
}

// Main test suite
async function runTests() {
  log('\n' + '='.repeat(70), 'blue');
  log('🔐 LOGIN AUTHENTICATION TDD TESTS', 'cyan');
  log('='.repeat(70) + '\n', 'blue');

  log(`📡 Flarebase URL: ${FLARE_URL}`, 'cyan');
  log(`🎯 Testing: Login should validate credentials properly\n`, 'cyan');

  // CRITICAL TEST 1: Login with non-existent user should fail
  log('\n🚨 CRITICAL: Non-existent User Login', 'yellow');
  log('-'.repeat(70), 'blue');

  await test('should REJECT login with non-existent email', async () => {
    const client = await createConnectedClient();

    let errorThrown = false;
    let errorMessage = '';

    try {
      await client.callPlugin('auth', {
        action: 'login',
        email: 'nonexistent-user-12345@example.com',
        password: 'anypassword'
      });
    } catch (error) {
      errorThrown = true;
      errorMessage = error.message;
    }

    expect(errorThrown).toBe(true);
    expect(errorMessage.includes('USER_NOT_FOUND') || errorMessage.includes('INVALID_CREDENTIALS')).toBe(true);
    expect(client.auth.isAuthenticated).toBe(false);
  });

  // CRITICAL TEST 2: Login with wrong password should fail
  log('\n🚨 CRITICAL: Wrong Password Login', 'yellow');
  log('-'.repeat(70), 'blue');

  await test('should REJECT login with correct email but wrong password', async () => {
    const client = await createConnectedClient();

    // First register a user
    const timestamp = Date.now();
    const testEmail = `password-test-${timestamp}@example.com`;
    const correctPassword = 'correctPassword123';
    const wrongPassword = 'wrongPassword456';

    await client.callPlugin('auth', {
      action: 'register',
      email: testEmail,
      password: correctPassword,
      name: 'Password Test User'
    });

    // Logout
    client.logout();
    expect(client.auth.isAuthenticated).toBe(false);

    // Try to login with wrong password
    let errorThrown = false;
    let errorMessage = '';

    try {
      await client.callPlugin('auth', {
        action: 'login',
        email: testEmail,
        password: wrongPassword
      });
    } catch (error) {
      errorThrown = true;
      errorMessage = error.message;
    }

    expect(errorThrown).toBe(true);
    expect(errorMessage.includes('INVALID_CREDENTIALS')).toBe(true);
    expect(client.auth.isAuthenticated).toBe(false);
  });

  // CRITICAL TEST 3: Login with empty credentials should fail
  log('\n🚨 CRITICAL: Empty/Missing Credentials', 'yellow');
  log('-'.repeat(70), 'blue');

  await test('should REJECT login with empty email', async () => {
    const client = await createConnectedClient();

    let errorThrown = false;

    try {
      await client.callPlugin('auth', {
        action: 'login',
        email: '',
        password: 'somepassword'
      });
    } catch (error) {
      errorThrown = true;
    }

    expect(errorThrown).toBe(true);
    expect(client.auth.isAuthenticated).toBe(false);
  });

  await test('should REJECT login with empty password', async () => {
    const client = await createConnectedClient();

    // First register a user
    const timestamp = Date.now();
    const testEmail = `empty-pass-test-${timestamp}@example.com`;

    await client.callPlugin('auth', {
      action: 'register',
      email: testEmail,
      password: 'password123',
      name: 'Empty Password Test User'
    });

    client.logout();

    let errorThrown = false;

    try {
      await client.callPlugin('auth', {
        action: 'login',
        email: testEmail,
        password: ''
      });
    } catch (error) {
      errorThrown = true;
    }

    expect(errorThrown).toBe(true);
    expect(client.auth.isAuthenticated).toBe(false);
  });

  // VALID TEST 4: Login with correct credentials should succeed
  log('\n✅ VALID: Correct Credentials Login', 'yellow');
  log('-'.repeat(70), 'blue');

  await test('should ACCEPT login with correct email and password', async () => {
    const client = await createConnectedClient();

    // Register a user
    const timestamp = Date.now();
    const testEmail = `valid-login-${timestamp}@example.com`;
    const testPassword = 'validPassword123';

    const registerResult = await client.callPlugin('auth', {
      action: 'register',
      email: testEmail,
      password: testPassword,
      name: 'Valid Login User'
    });

    expect(registerResult.ok).toBe(true);
    expect(registerResult.user.email).toBe(testEmail);

    // Logout
    client.logout();
    expect(client.auth.isAuthenticated).toBe(false);

    // Login with correct credentials
    const loginResult = await client.callPlugin('auth', {
      action: 'login',
      email: testEmail,
      password: testPassword
    });

    expect(loginResult.ok).toBe(true);
    expect(loginResult.user.email).toBe(testEmail);
    expect(loginResult.token).toBeDefined();
    expect(client.auth.isAuthenticated).toBe(true);
    expect(client.auth.user.email).toBe(testEmail);

    client.logout();
  });

  // EDGE CASE TEST 5: Login with case-sensitive email
  log('\n🔍 EDGE CASE: Email Case Sensitivity', 'yellow');
  log('-'.repeat(70), 'blue');

  await test('should handle email case sensitivity correctly', async () => {
    const client = await createConnectedClient();

    // Register with lowercase email
    const timestamp = Date.now();
    const testEmail = `case-test-${timestamp}@example.com`;
    const testPassword = 'password123';

    await client.callPlugin('auth', {
      action: 'register',
      email: testEmail,
      password: testPassword,
      name: 'Case Test User'
    });

    client.logout();

    // Try to login with uppercase email (should fail if case-sensitive)
    let errorThrown = false;

    try {
      await client.callPlugin('auth', {
        action: 'login',
        email: testEmail.toUpperCase(),
        password: testPassword
      });
    } catch (error) {
      errorThrown = true;
    }

    // Email matching should be case-insensitive for user convenience
    // This test documents the current behavior
    log(`    Note: Email matching is case-${errorThrown ? 'sensitive' : 'insensitive'} (documented behavior)`, 'yellow');
  });

  // Print summary
  log('\n' + '='.repeat(70), 'blue');
  log('TEST SUMMARY', 'cyan');
  log('='.repeat(70), 'blue');
  log(`✓ Passed: ${passedTests}`, 'green');
  log(`✗ Failed: ${failedTests}`, failedTests > 0 ? 'red' : 'green');
  log(`Total:  ${passedTests + failedTests}`, 'cyan');

  if (failedTests === 0) {
    log('\n✨ ALL AUTHENTICATION TESTS PASSED! ✨\n', 'green');
    process.exit(0);
  } else {
    log(`\n⚠️  ${failedTests} TEST(S) FAILED - Authentication has security issues!\n`, 'red');
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
