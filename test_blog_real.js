// Real test of the blog platform - checking if data actually loads
const { chromium } = require('playwright');

async function realTest() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Listen for console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('🔴 Browser Error:', msg.text());
    }
  });

  // Listen for network failures
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log('🔴 HTTP Error:', response.url(), response.status());
    }
  });

  console.log('📄 Loading homepage...');
  await page.goto('http://localhost:3002');
  await page.waitForTimeout(5000);

  // Check page content
  const content = await page.content();
  const hasFailedFetch = content.includes('failed to fetch') || content.includes('Failed to fetch');
  const hasError = content.includes('Error') || content.includes('error');

  console.log('📊 Page Analysis:');
  console.log('  Has "failed to fetch":', hasFailedFetch);
  console.log('  Has errors:', hasError);

  // Check if loading spinner is still present
  const isLoading = await page.locator('text=Loading posts').count() > 0;
  console.log('  Still loading:', isLoading);

  // Get actual page text
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('  Page text preview:', pageText.substring(0, 500));

  // Take screenshot
  await page.screenshot({ path: 'real_test_result.png' });
  console.log('📸 Screenshot saved: real_test_result.png');

  await browser.close();

  console.log('\n🎯 REALITY CHECK:');
  if (hasFailedFetch || hasError || isLoading) {
    console.log('❌ Blog platform is NOT working - data fetching failed');
    console.log('❌ Previous E2E tests were misleading - they only checked UI elements');
    console.log('❌ The real problem: Named queries return query definitions, not results');
  } else {
    console.log('✅ Blog platform is working correctly');
  }
}

realTest().catch(console.error);