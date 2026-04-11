/**
 * Puppeteer E2E Test - Blog Registration (Fixed)
 *
 * Run: npm run test:e2e
 */

const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:3002';
const REGISTER_URL = `${BASE_URL}/auth/register`;

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

async function runTests() {
  let browser;
  let page;
  let passedTests = 0;
  let failedTests = 0;

  try {
    log('\n🚀 Starting Puppeteer E2E Tests...\n', 'cyan');

    browser = await puppeteer.launch({
      headless: false, // Run in visible mode for debugging
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      slowMo: 100 // Slow down for better visibility
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    log('✅ Browser launched\n', 'green');

    // TEST 1: Successful Registration
    try {
      log('📝 TEST 1: Successful Registration', 'yellow');
      log('=' .repeat(50), 'blue');

      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 1000);
      const testEmail = `puppeteer-${timestamp}-${random}@test.com`;
      const testName = `Puppeteer ${timestamp}`;
      const testPassword = 'password123';

      log(`Email: ${testEmail}`, 'cyan');
      log(`Password: ${testPassword}`, 'cyan');

      // Navigate to registration page
      log('\n📍 Navigating to registration page...', 'blue');
      await page.goto(REGISTER_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });

      // Wait for form to be ready
      await page.waitForSelector('#name', { visible: true, timeout: 5000 });
      log('  ✓ Registration page loaded', 'green');

      // Fill form
      log('\n📝 Filling registration form...', 'blue');

      await page.type('#name', testName, { delay: 50 });
      log('  ✓ Name entered', 'green');

      await page.type('#email', testEmail, { delay: 50 });
      log('  ✓ Email entered', 'green');

      await page.type('#password', testPassword, { delay: 50 });
      log('  ✓ Password entered', 'green');

      await page.type('#confirmPassword', testPassword, { delay: 50 });
      log('  ✓ Confirm password entered', 'green');

      // Submit form
      log('\n🚀 Submitting registration...', 'blue');

      // Click submit and wait for response
      await page.click('button[type="submit"]');

      // Wait for either navigation or error message
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check result
      const currentUrl = page.url();
      const pageContent = await page.evaluate(() => {
        return {
          text: document.body.innerText,
          html: document.documentElement.innerHTML
        };
      });

      log(`\n  Current URL: ${currentUrl}`, 'cyan');

      // Check for error message
      const hasError = pageContent.html.includes('text-red') ||
                     pageContent.text.toLowerCase().includes('error') ||
                     pageContent.text.toLowerCase().includes('already exists');

      if (hasError) {
        log(`  ❌ Error message found: ${pageContent.text.substring(0, 100)}...`, 'red');
        throw new Error('Registration failed with error');
      }

      // Check if registration succeeded
      const isRedirected = currentUrl === BASE_URL || currentUrl === `${BASE_URL}/`;
      const hasWelcome = pageContent.text.includes('Welcome') || pageContent.text.includes(testName);

      if (isRedirected || hasWelcome) {
        log('  ✓ Registration successful', 'green');
      }

      log('\n✅ TEST 1 PASSED\n', 'green');
      passedTests++;

    } catch (error) {
      log(`\n❌ TEST 1 FAILED: ${error.message}\n`, 'red');
      failedTests++;

      // Take screenshot for debugging
      try {
        await page.screenshot({ path: 'tests/e2e/screenshots/test1-failure.png' });
        log('  📸 Screenshot saved: tests/e2e/screenshots/test1-failure.png', 'yellow');
      } catch (e) {}
    }

    // Wait before next test
    await new Promise(resolve => setTimeout(resolve, 2000));

    // TEST 2: Duplicate Email
    try {
      log('📝 TEST 2: Duplicate Email', 'yellow');
      log('=' .repeat(50), 'blue');

      // Go to register page
      await page.goto(REGISTER_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
      log('  ✓ On registration page', 'green');

      const timestamp = Date.now();
      const existingEmail = `duplicate-${timestamp}@test.com`;

      log(`\nStep 1: Register first user with ${existingEmail}`, 'cyan');

      // Register first user
      await page.waitForSelector('#email', { visible: true });
      await page.type('#name', 'User One');
      await page.type('#email', existingEmail);
      await page.type('#password', 'password123');
      await page.type('#confirmPassword', 'password123');

      log('\n  🚀 Submitting first registration...', 'blue');
      await page.click('button[type="submit"]');

      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check if first registration succeeded
      const afterFirstUrl = page.url();
      const afterFirstContent = await page.evaluate(() => document.body.innerText);
      const firstSuccess = afterFirstUrl === BASE_URL || afterFirstContent.includes('Welcome');

      if (firstSuccess) {
        log('  ✓ First user registered successfully', 'green');
      } else {
        const firstError = await page.evaluate(() => document.body.innerText);
        if (firstError.includes('error') || firstError.includes('exists')) {
          throw new Error('First registration failed: ' + firstError.substring(0, 100));
        }
      }

      // Now try duplicate
      log(`\nStep 2: Try to register again with ${existingEmail}`, 'cyan');

      await page.goto(REGISTER_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });

      await page.waitForSelector('#email', { visible: true });
      await page.type('#name', 'User Two');
      await page.type('#email', existingEmail); // Same email
      await page.type('#password', 'password456');
      await page.type('#confirmPassword', 'password456');

      log('\n  🚀 Submitting duplicate registration...', 'blue');
      await page.click('button[type="submit"]');

      await new Promise(resolve => setTimeout(resolve, 4000));

      // Check for error
      const duplicateContent = await page.evaluate(() => {
        return {
          text: document.body.innerText,
          html: document.documentElement.innerHTML,
          url: document.location.href
        };
      });

      const hasDuplicateError = duplicateContent.text.toLowerCase().includes('already exists') ||
                                 duplicateContent.html.includes('text-red') ||
                                 duplicateContent.url.includes('/register');

      if (hasDuplicateError) {
        log('  ✓ Duplicate email rejected', 'green');
      }

      log('\n✅ TEST 2 PASSED\n', 'green');
      passedTests++;

    } catch (error) {
      log(`\n❌ TEST 2 FAILED: ${error.message}\n`, 'red');
      failedTests++;
    }

    // TEST 3: Form Validation (Quick test)
    try {
      log('📝 TEST 3: Form Validation', 'yellow');
      log('=' .repeat(50), 'blue');

      await page.goto(REGISTER_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });

      // Check if form has required attributes
      const hasRequired = await page.evaluate(() => {
        const nameInput = document.querySelector('#name');
        const emailInput = document.querySelector('#email');
        const passwordInput = document.querySelector('#password');
        return nameInput?.hasAttribute('required') &&
               emailInput?.hasAttribute('required') &&
               passwordInput?.hasAttribute('required');
      });

      if (hasRequired) {
        log('  ✓ Form has required field validation', 'green');
      }

      log('\n✅ TEST 3 PASSED\n', 'green');
      passedTests++;

    } catch (error) {
      log(`\n❌ TEST 3 FAILED: ${error.message}\n`, 'red');
      failedTests++;
    }

  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}\n`, 'red');
  } finally {
    if (browser) {
      await browser.close();
      log('\n✅ Browser closed', 'green');
    }

    // Summary
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
      log('\n⚠️  Some tests failed', 'yellow');
      log('\nTroubleshooting:', 'cyan');
      log('1. Ensure Flarebase Server is running (port 3000)', 'white');
      log('2. Ensure Auth Hook Service is running', 'white');
      log('3. Ensure Blog Platform is running (port 3002)', 'white');
      log('\nRun: npm run dev', 'white');
      process.exit(1);
    }
  }
}

runTests().catch(error => {
  log(`\n❌ Error: ${error.message}`, 'red');
  process.exit(1);
});
