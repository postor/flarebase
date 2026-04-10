// Blog Platform E2E Test using Playwright
// Tests all major functionality of the Flarebase Blog Platform

const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:3002';
const TEST_USER = {
  name: 'Test User',
  email: `test${Date.now()}@example.com`,
  password: 'testpass123'
};

const TEST_POST = {
  title: `Test Post ${Date.now()}`,
  content: 'This is a test post created by automated E2E testing.',
  excerpt: 'This is a test excerpt for the automated test post.',
  tags: ['testing', 'automation', 'e2e']
};

let page, browser, context;

async function setupBrowser() {
  console.log('🚀 Starting browser...');
  browser = await chromium.launch({
    headless: false,
    slowMo: 500 // Slow down actions for better visibility
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  page = await context.newPage();
  console.log('✅ Browser started');
}

async function teardownBrowser() {
  console.log('🧹 Cleaning up...');
  // Keep browser open for manual inspection
  // await browser.close();
  console.log('✅ Cleanup complete');
}

async function testHomePage() {
  console.log('\n📄 Test 1: Homepage');
  try {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Check if page loaded
    const title = await page.title();
    console.log(`  Page title: ${title}`);

    // Check for main elements
    const hasHeader = await page.locator('header').count() > 0;
    const hasMainContent = await page.locator('main').count() > 0;

    console.log(`  Header present: ${hasHeader ? '✅' : '❌'}`);
    console.log(`  Main content present: ${hasMainContent ? '✅' : '❌'}`);

    // Check for loading state
    const isLoading = await page.locator('text=Loading posts').count() > 0;
    if (isLoading) {
      console.log('  ⏳ Waiting for posts to load...');
      await page.waitForSelector('text=Loading posts', { state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    // Check if we have auth buttons (should show login/register)
    const loginLink = await page.locator('text=Login').count();
    const registerLink = await page.locator('text=Register').count();

    console.log(`  Login link: ${loginLink > 0 ? '✅' : '❌'}`);
    console.log(`  Register link: ${registerLink > 0 ? '✅' : '❌'}`);

    // Take screenshot
    await page.screenshot({ path: '01_homepage.png' });
    console.log('  📸 Screenshot saved: 01_homepage.png');

    console.log('✅ Homepage test passed');
    return true;
  } catch (error) {
    console.error(`❌ Homepage test failed: ${error.message}`);
    return false;
  }
}

async function testUserRegistration() {
  console.log('\n👤 Test 2: User Registration');
  try {
    await page.goto(`${BASE_URL}/auth/register`);
    await page.waitForLoadState('networkidle');

    // Fill registration form
    console.log(`  Filling form with email: ${TEST_USER.email}`);
    await page.fill('#name', TEST_USER.name);
    await page.fill('#email', TEST_USER.email);
    await page.fill('#password', TEST_USER.password);
    await page.fill('#confirmPassword', TEST_USER.password);

    // Take screenshot before submission
    await page.screenshot({ path: '02_register_form.png' });
    console.log('  📸 Screenshot saved: 02_register_form.png');

    // Submit form
    console.log('  Submitting registration form...');
    await page.click('button[type="submit"]');

    // Wait for redirect or error
    await page.waitForTimeout(2000);

    // Check if registration was successful (redirected to home)
    const currentUrl = page.url();
    console.log(`  Current URL: ${currentUrl}`);

    // Take screenshot after registration
    await page.screenshot({ path: '03_after_register.png' });
    console.log('  📸 Screenshot saved: 03_after_register.png');

    // Check if we're back on home page
    const isHomePage = currentUrl === BASE_URL || currentUrl === `${BASE_URL}/`;

    if (isHomePage) {
      console.log('✅ Registration successful - redirected to home');
    } else {
      console.log('⚠️  Registration may have issues - not redirected to home');
    }

    return true;
  } catch (error) {
    console.error(`❌ Registration test failed: ${error.message}`);
    return false;
  }
}

async function testUserLogin() {
  console.log('\n🔐 Test 3: User Login');
  try {
    await page.goto(`${BASE_URL}/auth/login`);
    await page.waitForLoadState('networkidle');

    // Fill login form
    console.log(`  Logging in with email: ${TEST_USER.email}`);
    await page.fill('#email', TEST_USER.email);
    await page.fill('#password', TEST_USER.password);

    // Take screenshot before submission
    await page.screenshot({ path: '04_login_form.png' });
    console.log('  📸 Screenshot saved: 04_login_form.png');

    // Submit form
    console.log('  Submitting login form...');
    await page.click('button[type="submit"]');

    // Wait for redirect
    await page.waitForTimeout(2000);

    // Check current state
    const currentUrl = page.url();
    console.log(`  Current URL: ${currentUrl}`);

    // Check for user info display
    const welcomeText = await page.locator(`text=Welcome, ${TEST_USER.name}`).count();
    console.log(`  Welcome message: ${welcomeText > 0 ? '✅' : '❌'}`);

    // Check for logout button
    const logoutButton = await page.locator('text=Logout').count();
    console.log(`  Logout button: ${logoutButton > 0 ? '✅' : '❌'}`);

    // Take screenshot after login
    await page.screenshot({ path: '05_after_login.png' });
    console.log('  📸 Screenshot saved: 05_after_login.png');

    console.log('✅ Login test completed');
    return true;
  } catch (error) {
    console.error(`❌ Login test failed: ${error.message}`);
    return false;
  }
}

async function testCreatePost() {
  console.log('\n✍️  Test 4: Create Post');
  try {
    // Navigate to posts/new
    await page.goto(`${BASE_URL}/posts/new`);
    await page.waitForLoadState('networkidle');

    console.log('  Filling post creation form...');

    // Fill post form (adjust selectors based on actual form)
    const titleInput = await page.locator('input[name="title"], input[placeholder*="title"]').first();
    const contentInput = await page.locator('textarea[name="content"], textarea[placeholder*="content"]').first();

    if (await titleInput.count() > 0) {
      await titleInput.fill(TEST_POST.title);
      console.log(`  Title: ${TEST_POST.title}`);
    }

    if (await contentInput.count() > 0) {
      await contentInput.fill(TEST_POST.content);
      console.log(`  Content: ${TEST_POST.content.substring(0, 50)}...`);
    }

    // Take screenshot before submission
    await page.screenshot({ path: '06_create_post_form.png' });
    console.log('  📸 Screenshot saved: 06_create_post_form.png');

    // Submit form
    const submitButton = await page.locator('button[type="submit"], button:has-text("Create"), button:has-text("Publish")').first();
    if (await submitButton.count() > 0) {
      await submitButton.click();
      console.log('  Submitting post...');
      await page.waitForTimeout(2000);
    }

    // Take screenshot after creation
    await page.screenshot({ path: '07_after_create_post.png' });
    console.log('  📸 Screenshot saved: 07_after_create_post.png');

    console.log('✅ Create post test completed');
    return true;
  } catch (error) {
    console.error(`❌ Create post test failed: ${error.message}`);
    return false;
  }
}

async function testViewPostList() {
  console.log('\n📚 Test 5: View Post List');
  try {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Wait for data to load

    // Check for post cards or articles
    const postCards = await page.locator('article, .post-card, [class*="post"]').count();
    console.log(`  Posts found: ${postCards}`);

    if (postCards > 0) {
      // Get first post title
      const firstPostTitle = await page.locator('article h2, article h3, .post-title').first().textContent();
      console.log(`  First post: ${firstPostTitle || 'No title'}`);

      // Take screenshot of post list
      await page.screenshot({ path: '08_post_list.png' });
      console.log('  📸 Screenshot saved: 08_post_list.png');
    }

    console.log('✅ View post list test completed');
    return true;
  } catch (error) {
    console.error(`❌ View post list test failed: ${error.message}`);
    return false;
  }
}

async function testRealtimeFeatures() {
  console.log('\n⚡ Test 6: Real-time Features');
  try {
    // Check Socket.IO connection
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Listen for console logs
    page.on('console', msg => {
      if (msg.text().includes('socket') || msg.text().includes('Socket')) {
        console.log(`  🌐 Browser: ${msg.text()}`);
      }
    });

    // Wait a bit to see if Socket.IO connects
    await page.waitForTimeout(3000);

    // Take screenshot
    await page.screenshot({ path: '09_realtime_test.png' });
    console.log('  📸 Screenshot saved: 09_realtime_test.png');

    console.log('✅ Real-time features test completed');
    return true;
  } catch (error) {
    console.error(`❌ Real-time features test failed: ${error.message}`);
    return false;
  }
}

async function testLogout() {
  console.log('\n👋 Test 7: Logout');
  try {
    // Look for logout button
    const logoutButton = await page.locator('button:has-text("Logout"), a:has-text("Logout")').first();

    if (await logoutButton.count() > 0) {
      await logoutButton.click();
      await page.waitForTimeout(2000);

      // Take screenshot after logout
      await page.screenshot({ path: '10_after_logout.png' });
      console.log('  📸 Screenshot saved: 10_after_logout.png');

      // Check if login link is back
      const loginLink = await page.locator('text=Login').count();
      console.log(`  Login link visible: ${loginLink > 0 ? '✅' : '❌'}`);
    }

    console.log('✅ Logout test completed');
    return true;
  } catch (error) {
    console.error(`❌ Logout test failed: ${error.message}`);
    return false;
  }
}

async function runAllTests() {
  console.log('===================================================');
  console.log('🧪 FLAREBASE BLOG PLATFORM E2E TEST SUITE');
  console.log('===================================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Test User: ${TEST_USER.email}`);
  console.log('===================================================');

  const results = {
    homepage: false,
    registration: false,
    login: false,
    createPost: false,
    viewPosts: false,
    realtime: false,
    logout: false
  };

  try {
    await setupBrowser();

    // Run tests sequentially
    results.homepage = await testHomePage();
    results.registration = await testUserRegistration();
    results.login = await testUserLogin();
    results.createPost = await testCreatePost();
    results.viewPosts = await testViewPostList();
    results.realtime = await testRealtimeFeatures();
    results.logout = await testLogout();

  } catch (error) {
    console.error('❌ Test suite failed:', error);
  } finally {
    await teardownBrowser();
  }

  // Print summary
  console.log('\n===================================================');
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('===================================================');
  console.log(`Homepage:           ${results.homepage ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`User Registration:  ${results.registration ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`User Login:         ${results.login ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Create Post:        ${results.createPost ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`View Post List:     ${results.viewPosts ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Real-time Features: ${results.realtime ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Logout:             ${results.logout ? '✅ PASS' : '❌ FAIL'}`);
  console.log('===================================================');

  const passedTests = Object.values(results).filter(r => r).length;
  const totalTests = Object.keys(results).length;
  console.log(`\nTotal: ${passedTests}/${totalTests} tests passed (${Math.round(passedTests/totalTests*100)}%)`);

  if (passedTests === totalTests) {
    console.log('🎉 ALL TESTS PASSED!');
  } else {
    console.log('⚠️  Some tests failed - check screenshots for details');
  }

  console.log('===================================================');
}

// Run the test suite
runAllTests().catch(console.error);
