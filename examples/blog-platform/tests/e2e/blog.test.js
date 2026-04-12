/**
 * Blog Platform E2E Tests - JavaScript Version
 * 
 * Simple test runner that doesn't require TypeScript compilation.
 * Uses the same patterns as the client SDK e2e tests.
 */

// Polyfill localStorage for Node.js (FlareClient needs it)
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

// Simple test framework
let passedTests = 0;
let failedTests = 0;
let currentTest = '';

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
  currentTest = name;
  try {
    log(`\n  Testing: ${name}`, 'cyan');
    await fn();
    log(`  ✓ PASSED`, 'green');
    passedTests++;
  } catch (error) {
    log(`  ✗ FAILED: ${error.message}`, 'red');
    if (error.stack) {
      log(`    ${error.stack.split('\n').slice(1, 3).join('\n    ')}`, 'yellow');
    }
    failedTests++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${actual} to be ${expected}`);
      }
    },
    toBeDefined() {
      if (actual === undefined || actual === null) {
        throw new Error(`Expected value to be defined`);
      }
    },
    toBeGreaterThan(expected) {
      if (!(actual > expected)) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected) {
      if (!(actual >= expected)) {
        throw new Error(`Expected ${actual} to be >= ${expected}`);
      }
    },
    toBeInstanceOf(Constructor) {
      if (!(actual instanceof Constructor)) {
        throw new Error(`Expected value to be instance of ${Constructor.name}`);
      }
    },
    async rejectsToThrow() {
      try {
        await actual;
        throw new Error(`Expected promise to reject, but it resolved`);
      } catch (e) {
        // Expected
      }
    }
  };
}

// Helper: Sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: Create connected client using FlareClient
async function createConnectedClient() {
  // Dynamic import to avoid issues if module not found
  const { FlareClient } = await import('@flarebase/client');
  
  const client = new FlareClient(FLARE_URL, { debug: false });

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
  log('\n' + '='.repeat(60), 'blue');
  log('🧪 BLOG PLATFORM E2E TESTS', 'cyan');
  log('='.repeat(60) + '\n', 'blue');

  log(`📡 Flarebase URL: ${FLARE_URL}`, 'cyan');
  log(`🔌 Using new plugin API (plugin_request/plugin_response)\n`, 'cyan');

  // Authentication Flow Tests
  log('\n📝 Authentication Flow', 'yellow');
  log('-'.repeat(60), 'blue');

  await test('should register a new user via auth plugin', async () => {
    const client = await createConnectedClient();

    const timestamp = Date.now();
    const testEmail = `e2e-test-${timestamp}@example.com`;
    const testName = `E2E Test User ${timestamp}`;
    const testPassword = 'testPass123';

    const result = await client.callPlugin('auth', {
      action: 'register',
      email: testEmail,
      password: testPassword,
      name: testName
    });

    expect(result.ok).toBe(true);
    expect(result.user.email).toBe(testEmail);
    expect(result.user.name).toBe(testName);
    expect(result.token).toBeDefined();

    expect(client.auth.isAuthenticated).toBe(true);
    expect(client.auth.user.email).toBe(testEmail);

    client.logout();
  });

  await test('should reject duplicate email registration', async () => {
    const client = await createConnectedClient();

    const timestamp = Date.now();
    const testEmail = `duplicate-${timestamp}@example.com`;
    const testPassword = 'testPass123';

    await client.callPlugin('auth', {
      action: 'register',
      email: testEmail,
      password: testPassword,
      name: 'First User'
    });

    let caughtError = false;
    try {
      await client.callPlugin('auth', {
        action: 'register',
        email: testEmail,
        password: testPassword,
        name: 'Second User'
      });
    } catch (e) {
      caughtError = true;
    }

    expect(caughtError).toBe(true);
    client.logout();
  });

  await test('should login successfully with valid credentials', async () => {
    const client = await createConnectedClient();

    const timestamp = Date.now();
    const testEmail = `login-test-${timestamp}@example.com`;
    const testPassword = 'testPass123';

    await client.callPlugin('auth', {
      action: 'register',
      email: testEmail,
      password: testPassword,
      name: 'Login Test User'
    });

    client.logout();
    expect(client.auth.isAuthenticated).toBe(false);

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

  await test('should reject login with invalid credentials', async () => {
    const client = await createConnectedClient();

    let caughtError = false;
    try {
      await client.callPlugin('auth', {
        action: 'login',
        email: 'nonexistent@example.com',
        password: 'wrongpassword'
      });
    } catch (e) {
      caughtError = true;
    }

    expect(caughtError).toBe(true);
    expect(client.auth.isAuthenticated).toBe(false);
  });

  // Article Management Tests
  log('\n📰 Article Management', 'yellow');
  log('-'.repeat(60), 'blue');

  let articleClient;
  let articleUserEmail;
  let articleUserId;

  await test('should setup authenticated client for article tests', async () => {
    articleClient = await createConnectedClient();
    articleUserEmail = `article-test-${Date.now()}@example.com`;

    const result = await articleClient.callPlugin('auth', {
      action: 'register',
      email: articleUserEmail,
      password: 'testPass123',
      name: 'Article Test User'
    });

    articleUserId = articleClient.auth.user.id;
    expect(articleUserId).toBeDefined();
  });

  await test('should create an article with JWT automatically included', async () => {
    const testTitle = `E2E Test Article ${Date.now()}`;
    const testContent = `Created at ${new Date().toISOString()}`;

    const article = await articleClient.collection('posts').add({
      title: testTitle,
      content: testContent,
      author_id: articleUserId,
      status: 'published',
      created_at: Date.now(),
      updated_at: Date.now()
    });

    expect(article.id).toBeDefined();
    expect(article.data.title).toBe(testTitle);
    expect(article.data.content).toBe(testContent);
  });

  await test('should retrieve all articles', async () => {
    const articles = await articleClient.collection('posts').get();
    expect(Array.isArray(articles)).toBe(true);
    expect(articles.length).toBeGreaterThan(0);
  });

  await test('should update an article', async () => {
    const testTitle = `Update Test ${Date.now()}`;

    const article = await articleClient.collection('posts').add({
      title: testTitle,
      content: 'Initial content',
      author_id: articleUserId,
      status: 'draft',
      created_at: Date.now(),
      updated_at: Date.now()
    });

    const updated = await articleClient.collection('posts').doc(article.id).update({
      content: 'Updated content',
      status: 'published',
      updated_at: Date.now()
    });

    expect(updated.data.content).toBe('Updated content');
    expect(updated.data.status).toBe('published');
  });

  await test('should delete an article', async () => {
    const testTitle = `Delete Test ${Date.now()}`;

    const article = await articleClient.collection('posts').add({
      title: testTitle,
      content: 'To be deleted',
      author_id: articleUserId,
      status: 'draft',
      created_at: Date.now(),
      updated_at: Date.now()
    });

    const articleId = article.id;

    await articleClient.collection('posts').doc(articleId).delete();

    const articles = await articleClient.collection('posts').get();
    const deletedArticle = articles.find(a => a.id === articleId);

    expect(deletedArticle).toBe(undefined);
  });

  // JWT Transparency Tests
  log('\n🔑 JWT Transparency', 'yellow');
  log('-'.repeat(60), 'blue');

  await test('should handle JWT state transparently during auth flow', async () => {
    const client = await createConnectedClient();

    expect(client.auth.isAuthenticated).toBe(false);
    expect(client.auth.user).toBe(null);

    const timestamp = Date.now();
    const testEmail = `jwt-transparency-${timestamp}@example.com`;

    const result = await client.callPlugin('auth', {
      action: 'register',
      email: testEmail,
      password: 'testPass123',
      name: 'Transparency Test'
    });

    expect(client.auth.isAuthenticated).toBe(true);
    expect(client.auth.user.email).toBe(testEmail);
    expect(result.token).toBeDefined();

    client.logout();
    expect(client.auth.isAuthenticated).toBe(false);
    expect(client.auth.user).toBe(null);
  });

  // Error Handling Tests
  log('\n⚠️  Error Handling', 'yellow');
  log('-'.repeat(60), 'blue');

  await test('should handle invalid plugin event names', async () => {
    const client = await createConnectedClient();

    let caughtError = false;
    try {
      await client.callPlugin('nonexistent_event', { foo: 'bar' });
    } catch (e) {
      caughtError = true;
    }

    expect(caughtError).toBe(true);
  });

  await test('should handle missing required fields in registration', async () => {
    const client = await createConnectedClient();

    let caughtError = false;
    try {
      await client.callPlugin('auth', {
        action: 'register',
        email: 'test@example.com'
      });
    } catch (e) {
      caughtError = true;
    }

    expect(caughtError).toBe(true);
  });

  // Cleanup
  if (articleClient) {
    articleClient.logout();
  }

  // Print summary
  log('\n' + '='.repeat(60), 'blue');
  log('TEST SUMMARY', 'cyan');
  log('='.repeat(60), 'blue');
  log(`✓ Passed: ${passedTests}`, 'green');
  log(`✗ Failed: ${failedTests}`, failedTests > 0 ? 'red' : 'green');
  log(`Total:  ${passedTests + failedTests}`, 'cyan');

  if (failedTests === 0) {
    log('\n✨ ALL TESTS PASSED! ✨\n', 'green');
    process.exit(0);
  } else {
    log('\n⚠️  Some tests failed\n', 'yellow');
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
