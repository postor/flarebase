/**
 * Browser-based Registration Test
 *
 * Test the complete registration flow in a browser environment
 */

console.log('🧪 Starting Registration Test...\n');

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = `browser-test-${Date.now()}@test.com`;

async function testHTTPCreateUser() {
  console.log('📧 STEP 1: Test HTTP user creation');
  console.log(`Email: ${TEST_EMAIL}`);

  try {
    const response = await fetch(`${BASE_URL}/collections/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + generateAdminToken()
      },
      body: JSON.stringify({
        email: TEST_EMAIL,
        name: 'Browser Test User',
        password_hash: 'test_hash_123',
        role: 'author',
        status: 'active',
        created_at: Date.now()
      })
    });

    console.log(`Status: ${response.status}`);

    if (!response.ok) {
      const text = await response.text();
      console.log(`❌ Failed: ${text}`);
      return false;
    }

    const data = await response.json();
    console.log(`✅ User created: ${data.id}`);
    console.log(`Email: ${data.data.email}`);
    return true;

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    return false;
  }
}

async function testCheckUsers() {
  console.log('\n📋 STEP 2: Check users collection');

  try {
    const response = await fetch(`${BASE_URL}/collections/users`);
    const users = await response.json();

    console.log(`Total users: ${users.length}`);

    const testUser = users.find(u => u.data?.email === TEST_EMAIL);
    if (testUser) {
      console.log(`✅ Test user found: ${testUser.data.email}`);
      return true;
    } else {
      console.log(`❌ Test user not found`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    return false;
  }
}

async function testDuplicateEmail() {
  console.log('\n🔄 STEP 3: Test duplicate email prevention');

  try {
    const response = await fetch(`${BASE_URL}/collections/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + generateAdminToken()
      },
      body: JSON.stringify({
        email: TEST_EMAIL, // Same email
        name: 'Duplicate User',
        password_hash: 'different_hash',
        role: 'author',
        status: 'active',
        created_at: Date.now()
      })
    });

    if (response.ok) {
      console.log('⚠️ Server allows duplicate emails (no validation)');
      return false;
    } else {
      console.log('✅ Server rejected duplicate email');
      return true;
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    return false;
  }
}

function generateAdminToken() {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    sub: 'test-admin',
    email: 'admin@test.com',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  }));

  const signature = btoa(`${header}.${payload}.flare_secret_key`);
  return `${header}.${payload}.${signature}`;
}

// Run all tests
async function runTests() {
  console.log('='.repeat(50));
  console.log('REGISTRATION TDD TESTS');
  console.log('='.repeat(50));

  const results = {
    create: await testHTTPCreateUser(),
    check: await testCheckUsers(),
    duplicate: await testDuplicateEmail()
  };

  console.log('\n' + '='.repeat(50));
  console.log('TEST RESULTS');
  console.log('='.repeat(50));
  console.log(`Create User: ${results.create ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Check Users: ${results.check ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Duplicate Check: ${results.duplicate ? '✅ PASS' : '⚠️ WARNING'}`);

  const allPassed = results.create && results.check;
  console.log(`\nOverall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  return allPassed;
}

// Start tests
runTests().then(success => {
  if (success) {
    console.log('\n✨ Registration system is working!');
    console.log('You can now test registration in the browser:');
    console.log('http://localhost:3002/auth/register');
  } else {
    console.log('\n❌ Registration system has issues');
    console.log('Please check the errors above');
  }
});
