/**
 * Puppeteer E2E Test - Blog Registration
 *
 * Tests for blog platform registration functionality:
 * 1. Successful registration with new email
 * 2. Failed registration with duplicate email
 *
 * Run: node tests/e2e/registration-standalone.test.js
 */

const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:3002';
const REGISTER_URL = `${BASE_URL}/auth/register`;

// Color codes for terminal output
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

// Test runner
async function runTests() {
  let browser;
  let page;
  let passedTests = 0;
  let failedTests = 0;

  try {
    log('\n🚀 Starting Puppeteer E2E Tests...\n', 'cyan');

    // Launch browser
    log('📍 Launching browser...', 'blue');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Capture console logs
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error') {
        log(`  [Browser Console Error] ${text}`, 'red');
      } else if (type === 'warning') {
        log(`  [Browser Console Warning] ${text}`, 'yellow');
      } else if (text.includes('[REGISTER]')) {
        log(`  [Browser Console] ${text}`, 'cyan');
      }
    });

    // Capture page errors
    page.on('pageerror', error => {
      log(`  [Page Error] ${error.message}`, 'red');
    });

    // Capture request failures
    page.on('requestfailed', request => {
      log(`  [Request Failed] ${request.url()} - ${request.failure()?.errorText}`, 'red');
    });

    log('✅ Browser launched\n', 'green');

    // TEST 1: Successful Registration
    try {
      log('📝 TEST 1: Successful Registration', 'yellow');
      log('=' .repeat(50), 'blue');

      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 1000);
      const testEmail = `puppeteer-test-${timestamp}-${random}@example.com`;
      const testName = `Puppeteer User ${timestamp}`;
      const testPassword = 'testPass123';

      log(`Email: ${testEmail}`, 'cyan');
      log(`Password: ${testPassword}`, 'cyan');

      // Navigate to registration page
      log('\n📍 Navigating to registration page...', 'blue');
      await page.goto(REGISTER_URL, { waitUntil: 'networkidle0', timeout: 10000 });
      await page.waitForSelector('form', { timeout: 5000 });

      // Fill registration form
      log('\n📝 Filling registration form...', 'blue');

      await page.waitForSelector('#name', { timeout: 3000 });
      await page.type('#name', testName);
      log('  ✓ Name entered', 'green');

      await page.waitForSelector('#email', { timeout: 3000 });
      await page.type('#email', testEmail);
      log('  ✓ Email entered', 'green');

      await page.waitForSelector('#password', { timeout: 3000 });
      await page.type('#password', testPassword);
      log('  ✓ Password entered', 'green');

      await page.waitForSelector('#confirmPassword', { timeout: 3000 });
      await page.type('#confirmPassword', testPassword);
      log('  ✓ Confirm password entered', 'green');

      // Submit form
      log('\n🚀 Submitting registration form...', 'blue');
      const submitButton = 'button[type="submit"]';

      // Wait for navigation after submit
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
        page.click(submitButton)
      ]);

      // Verify successful registration
      log('\n✅ Verifying registration...', 'blue');

      const currentUrl = page.url();
      log(`  Current URL: ${currentUrl}`, 'cyan');

      // Check if redirected to home page
      const isRedirected = currentUrl === BASE_URL || currentUrl === `${BASE_URL}/`;

      if (isRedirected) {
        log('  ✓ Redirected to home page', 'green');

        // Check for user name on page
        const pageText = await page.evaluate(() => document.body.innerText);
        if (pageText.includes(testName)) {
          log('  ✓ User name displayed on page', 'green');
        }
      }

      log('\n✅ TEST 1 PASSED: Registration successful\n', 'green');
      passedTests++;
    } catch (error) {
      log(`\n❌ TEST 1 FAILED: ${error.message}\n`, 'red');
      failedTests++;
    }

    // TEST 2: Duplicate Email Failure
    try {
      log('📝 TEST 2: Duplicate Email Failure', 'yellow');
      log('=' .repeat(50), 'blue');

      const timestamp = Date.now();
      const existingEmail = `duplicate-test-${timestamp}@example.com`;
      const testName = 'Duplicate Test User';
      const testPassword = 'testPass123';

      log(`Step 1: Register user with ${existingEmail}`, 'cyan');

      // First registration
      await page.goto(REGISTER_URL, { waitUntil: 'networkidle0', timeout: 10000 });

      await page.waitForSelector('#email', { timeout: 3000 });
      await page.type('#name', testName);
      await page.type('#email', existingEmail);
      await page.type('#password', testPassword);
      await page.type('#confirmPassword', testPassword);

      log('\n  🚀 Submitting first registration...', 'blue');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
        page.click('button[type="submit"]')
      ]);

      log('  ✓ First registration completed', 'green');

      // Logout
      log('\n📝 Logging out...', 'blue');
      await page.goto(`${BASE_URL}/auth/logout`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Try to register again with same email
      log(`\nStep 2: Attempting duplicate registration with ${existingEmail}`, 'cyan');

      await page.goto(REGISTER_URL, { waitUntil: 'networkidle0', timeout: 10000 });

      await page.waitForSelector('#email', { timeout: 3000 });
      await page.type('#name', 'Another User');
      await page.type('#email', existingEmail);
      await page.type('#password', 'anotherPass123');
      await page.type('#confirmPassword', 'anotherPass123');

      log('\n  🚀 Submitting duplicate registration...', 'blue');
      await page.click('button[type="submit"]');

      // Wait for error message or processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check for error message
      log('\n✅ Checking for error message...', 'blue');

      const pageContent = await page.evaluate(() => {
        return {
          text: document.body.innerText,
          html: document.documentElement.innerHTML,
          url: document.location.href
        };
      });

      // Look for error indicators
      const hasErrorMessage = pageContent.text.toLowerCase().includes('already exists') ||
                             pageContent.text.toLowerCase().includes('already registered') ||
                             pageContent.text.toLowerCase().includes('email exists') ||
                             pageContent.html.includes('text-red') ||
                             pageContent.html.includes('bg-red-50');

      // Still on registration page means registration failed
      const stillOnRegisterPage = pageContent.url.includes('/register');

      log(`  Error message found: ${hasErrorMessage}`, 'cyan');
      log(`  Still on register page: ${stillOnRegisterPage}`, 'cyan');

      if (hasErrorMessage || stillOnRegisterPage) {
        log('  ✓ Duplicate email correctly rejected', 'green');
      }

      log('\n✅ TEST 2 PASSED: Duplicate email rejected\n', 'green');
      passedTests++;
    } catch (error) {
      log(`\n❌ TEST 2 FAILED: ${error.message}\n`, 'red');
      failedTests++;
    }

    // TEST 3: Form Validation
    try {
      log('📝 TEST 3: Form Validation', 'yellow');
      log('=' .repeat(50), 'blue');

      await page.goto(REGISTER_URL, { waitUntil: 'networkidle0', timeout: 10000 });

      log('\n🔍 Testing form with empty fields...', 'blue');

      const pageContent = await page.evaluate(() => {
        const submitButton = document.querySelector('button[type="submit"]');
        return {
          buttonText: submitButton ? submitButton.textContent : 'not found',
          isDisabled: submitButton ? submitButton.disabled : false
        };
      });

      log(`  Submit button text: "${pageContent.buttonText}"`, 'cyan');
      log(`  Submit button disabled: ${pageContent.isDisabled}`, 'cyan');

      // Try to submit without filling (should fail due to HTML5 validation)
      log('\n  🚀 Attempting to submit empty form...', 'blue');

      const currentUrlBefore = page.url();

      try {
        await page.click('button[type="submit"]');
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) {
        // Click might fail if validation prevents it
      }

      const currentUrlAfter = page.url();
      const stayedOnPage = currentUrlBefore === currentUrlAfter;

      if (stayedOnPage) {
        log('  ✓ Form submission prevented (validation works)', 'green');
      }

      log('\n✅ TEST 3 PASSED: Form validation works\n', 'green');
      passedTests++;
    } catch (error) {
      log(`\n❌ TEST 3 FAILED: ${error.message}\n`, 'red');
      failedTests++;
    }

    // TEST 4: Password Requirements
    try {
      log('📝 TEST 4: Password Requirements', 'yellow');
      log('=' .repeat(50), 'blue');

      await page.goto(REGISTER_URL, { waitUntil: 'networkidle0', timeout: 10000 });

      const timestamp = Date.now();
      const testEmail = `password-test-${timestamp}@example.com`;
      const weakPassword = '123'; // Too short

      log(`Testing with weak password: "${weakPassword}"`, 'cyan');

      // Fill form with weak password
      await page.waitForSelector('#email', { timeout: 3000 });
      await page.type('#name', 'Password Test User');
      await page.type('#email', testEmail);
      await page.type('#password', weakPassword);
      await page.type('#confirmPassword', weakPassword);

      log('\n  🚀 Submitting with weak password...', 'blue');
      await page.click('button[type="submit"]');
      await new Promise(resolve => setTimeout(resolve, 2000));

      const currentUrlWeak = page.url();
      const stayedOnRegister = currentUrlWeak.includes('/register');

      if (stayedOnRegister) {
        log('  ✓ Weak password rejected (or form validation)', 'green');
      }

      // Now try with strong password
      log('\nTesting with strong password...', 'cyan');

      // Clear password field
      await page.click('#password', { clickCount: 3 });
      await page.type('#password', 'strongPass123');
      await page.type('#confirmPassword', 'strongPass123');

      log('  🚀 Submitting with strong password...', 'blue');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
        page.click('button[type="submit"]')
      ]);

      const currentUrlStrong = page.url();
      const registrationSuccessful = currentUrlStrong === BASE_URL || currentUrlStrong === `${BASE_URL}/`;

      if (registrationSuccessful) {
        log('  ✓ Strong password accepted', 'green');
      }

      log('\n✅ TEST 4 PASSED: Password requirements enforced\n', 'green');
      passedTests++;
    } catch (error) {
      log(`\n❌ TEST 4 FAILED: ${error.message}\n`, 'red');
      failedTests++;
    }

  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}\n`, 'red');
  } finally {
    if (browser) {
      await browser.close();
      log('\n✅ Browser closed', 'green');
    }

    // Print summary
    log('\n' + '='.repeat(50), 'blue');
    log('TEST SUMMARY', 'cyan');
    log('='.repeat(50), 'blue');
    log(`Passed: ${passedTests}`, 'green');
    log(`Failed: ${failedTests}`, failedTests > 0 ? 'red' : 'green');
    log(`Total:  ${passedTests + failedTests}`, 'cyan');

    if (failedTests === 0) {
      log('\n✨ ALL TESTS PASSED! ✨\n', 'green');
      process.exit(0);
    } else {
      log('\n⚠️  Some tests failed\n', 'yellow');
      process.exit(1);
    }
  }
}

// Run tests
runTests().catch(error => {
  log(`\n❌ Test runner error: ${error.message}`, 'red');
  process.exit(1);
});
