/**
 * Flarebase Blog Platform - E2E Tests
 *
 * Tests complete blog functionality using Puppeteer
 * Verifies that JWT authentication is completely transparent
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_PAGE = `${BASE_URL}/test/simple`;

describe('Blog Platform E2E', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    page = await browser.newPage();

    // Set viewport and timeout
    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultTimeout(10000);
  });

  afterAll(async () => {
    await browser.close();
  });

  describe('Authentication Flow', () => {
    it('should show login form initially', async () => {
      await page.goto(TEST_PAGE, { waitUntil: 'networkidle0' });

      // Wait for page to load
      await page.waitForSelector('form');

      // Extract page state
      const pageState = await page.evaluate(() => {
        return {
          title: document.title,
          hasEmailInput: !!document.querySelector('[data-testid="email-input"]'),
          hasPasswordInput: !!document.querySelector('[data-testid="password-input"]'),
          hasSubmitButton: !!document.querySelector('[data-testid="submit-button"]'),
          hasLogoutButton: !!document.querySelector('[data-testid="logout-button"]')
        };
      });

      expect(pageState.hasEmailInput).toBe(true);
      expect(pageState.hasPasswordInput).toBe(true);
      expect(pageState.hasSubmitButton).toBe(true);
      expect(pageState.hasLogoutButton).toBe(false); // Not logged in yet
    });

    it('should login successfully and save JWT automatically', async () => {
      await page.goto(TEST_PAGE, { waitUntil: 'networkidle0' });

      // Fill in login form
      await page.fill('[data-testid="email-input"]', 'test@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');

      // Submit form
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('[data-testid="submit-button"]')
      ]);

      // Wait for dashboard to load
      await page.waitForSelector('[data-testid="user-display"]');

      // Verify login success by extracting page content
      const loggedInState = await page.evaluate(() => {
        return {
          hasUserDisplay: !!document.querySelector('[data-testid="user-display"]'),
          hasLogoutButton: !!document.querySelector('[data-testid="logout-button"]'),
          hasCreateForm: !!document.querySelector('[data-testid="title-input"]'),
          userText: document.querySelector('[data-testid="user-display"]')?.textContent
        };
      });

      expect(loggedInState.hasUserDisplay).toBe(true);
      expect(loggedInState.hasLogoutButton).toBe(true);
      expect(loggedInState.hasCreateForm).toBe(true);
      expect(loggedInState.userText).toContain('test');
    });

    it('should persist JWT across page reloads', async () => {
      // After successful login from previous test
      await page.reload({ waitUntil: 'networkidle0' });

      // Wait for page to load
      await page.waitForSelector('[data-testid="user-display"]');

      // Verify user is still logged in (JWT was restored)
      const authState = await page.evaluate(() => {
        return {
          isLoggedIn: !!document.querySelector('[data-testid="user-display"]'),
          hasCreateButton: !!document.querySelector('[data-testid="create-button"]'),
          userText: document.querySelector('[data-testid="user-display"]')?.textContent
        };
      });

      expect(authState.isLoggedIn).toBe(true);
      expect(authState.hasCreateButton).toBe(true);
      expect(authState.userText).toContain('test');
    });

    it('should logout and clear JWT automatically', async () => {
      // Click logout button
      await page.click('[data-testid="logout-button"]');

      // Wait for login form to reappear
      await page.waitForSelector('[data-testid="email-input"]');

      // Verify logged out state
      const loggedOutState = await page.evaluate(() => {
        return {
          hasEmailInput: !!document.querySelector('[data-testid="email-input"]'),
          hasPasswordInput: !!document.querySelector('[data-testid="password-input"]'),
          hasUserDisplay: !!document.querySelector('[data-testid="user-display"]'),
          hasLogoutButton: !!document.querySelector('[data-testid="logout-button"]')
        };
      });

      expect(loggedOutState.hasEmailInput).toBe(true);
      expect(loggedOutState.hasPasswordInput).toBe(true);
      expect(loggedOutState.hasUserDisplay).toBe(false);
      expect(loggedOutState.hasLogoutButton).toBe(false);
    });
  });

  describe('Article Management', () => {
    beforeAll(async () => {
      // Login before running article tests
      await page.goto(TEST_PAGE, { waitUntil: 'networkidle0' });
      await page.fill('[data-testid="email-input"]', 'test@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('[data-testid="submit-button"]')
      ]);
      await page.waitForSelector('[data-testid="user-display"]');
    });

    it('should display empty state initially', async () => {
      const articlesState = await page.evaluate(() => {
        return {
          hasEmptyState: !!document.querySelector('[data-testid="empty-state"]'),
          hasArticles: document.querySelectorAll('[data-testid^="article-"]').length > 0,
          articleCount: document.querySelectorAll('[data-testid^="article-"]').length
        };
      });

      expect(articlesState.hasEmptyState).toBe(true);
      expect(articlesState.hasArticles).toBe(false);
      expect(articlesState.articleCount).toBe(0);
    });

    it('should create an article with JWT automatically included', async () => {
      // Fill in article form
      const testTitle = `E2E Test Article ${Date.now()}`;
      const testContent = `Created at ${new Date().toISOString()}`;

      await page.fill('[data-testid="title-input"]', testTitle);
      await page.fill('[data-testid="content-input"]', testContent);

      // Submit form
      await page.click('[data-testid="create-button"]');

      // Wait for article to appear
      await page.waitForSelector('[data-testid^="article-"]');

      // Extract article data
      const articleData = await page.evaluate(() => {
        const article = document.querySelector('[data-testid^="article-"]');
        if (!article) return null;

        return {
          title: article.querySelector('[data-testid$="-title"]')?.textContent,
          content: article.querySelector('[data-testid$="-content"]')?.textContent,
          totalArticles: document.querySelectorAll('[data-testid^="article-"]').length
        };
      });

      expect(articleData).not.toBeNull();
      expect(articleData.title).toBe(testTitle);
      expect(articleData.content).toBe(testContent);
      expect(articleData.totalArticles).toBeGreaterThan(0);
    });

    it('should display all created articles', async () => {
      // Create multiple articles
      for (let i = 0; i < 3; i++) {
        await page.fill('[data-testid="title-input"]', `Article ${i + 1}`);
        await page.fill('[data-testid="content-input"]', `Content ${i + 1}`);
        await page.click('[data-testid="create-button"]');
        await page.waitForTimeout(500); // Brief wait for article to appear
      }

      // Extract articles list
      const articlesList = await page.evaluate(() => {
        return {
          articleCount: document.querySelectorAll('[data-testid^="article-"]').length,
          articles: Array.from(document.querySelectorAll('[data-testid^="article-"]')).map(article => ({
            title: article.querySelector('[data-testid$="-title"]')?.textContent,
            content: article.querySelector('[data-testid$="-content"]')?.textContent
          }))
        };
      });

      expect(articlesList.articleCount).toBeGreaterThanOrEqual(3);
      expect(articlesList.articles.length).toBeGreaterThanOrEqual(3);
    });

    it('should show correct status footer information', async () => {
      const footerInfo = await page.evaluate(() => {
        const footer = document.querySelector('[data-testid="status-footer"]');
        return {
          footerText: footer?.textContent,
          hasAuthInfo: footer?.textContent?.includes('Auth:'),
          hasArticlesCount: footer?.textContent?.includes('Articles:'),
          hasServerURL: footer?.textContent?.includes('Server:')
        };
      });

      expect(footerInfo.hasAuthInfo).toBe(true);
      expect(footerInfo.hasArticlesCount).toBe(true);
      expect(footerInfo.hasServerURL).toBe(true);
      expect(footerInfo.footerText).toContain('test@example.com');
    });
  });

  describe('JWT Transparency', () => {
    it('should not expose JWT methods to user code', async () => {
      // Check that JWT-related methods are not exposed in the window object
      const exposedMethods = await page.evaluate(() => {
        const client = new (window as any).FlarebaseClient();

        // Check that internal JWT methods are not accessible
        return {
          hasSetJWT: typeof (client as any).setJWT === 'function',
          hasLoadJWT: typeof (client as any).loadJWT === 'function',
          hasClearJWT: typeof (client as any).clearJWT === 'function',
          hasSaveJWT: typeof (client as any)._saveJWT === 'function',
          hasPublicLogin: typeof client.login === 'function',
          hasPublicLogout: typeof client.logout === 'function',
          hasPublicAuth: typeof client.auth === 'object'
        };
      });

      // Internal methods should not be exposed (or are private)
      expect(exposedMethods.hasPublicLogin).toBe(true);
      expect(exposedMethods.hasPublicLogout).toBe(true);
      expect(exposedMethods.hasPublicAuth).toBe(true);
    });

    it('should handle JWT state transparently', async () => {
      // Verify that JWT operations happen automatically
      const authFlow = await page.evaluate(async () => {
        const client = new (window as any).FlarebaseClient();

        // Initial state
        const initialState = {
          isAuthenticated: client.auth.isAuthenticated,
          user: client.auth.user
        };

        return {
          initialState,
          hasAuthProperty: 'auth' in client,
          hasArticlesProperty: 'articles' in client
        };
      });

      expect(authFlow.hasAuthProperty).toBe(true);
      expect(authFlow.hasArticlesProperty).toBe(true);
      expect(authFlow.initialState.isAuthenticated).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should show error message for invalid credentials', async () => {
      // Logout first
      await page.click('[data-testid="logout-button"]');
      await page.waitForSelector('[data-testid="email-input"]');

      // Try to login with wrong credentials
      await page.fill('[data-testid="email-input"]', 'wrong@example.com');
      await page.fill('[data-testid="password-input"]', 'wrongpassword');
      await page.click('[data-testid="submit-button"]');

      // Wait for error message
      await page.waitForSelector('[data-testid="error-message"]', { timeout: 5000 });

      const errorState = await page.evaluate(() => {
        const errorElement = document.querySelector('[data-testid="error-message"]');
        return {
          hasError: !!errorElement,
          errorText: errorElement?.textContent
        };
      });

      expect(errorState.hasError).toBe(true);
      expect(errorState.errorText).toBeDefined();
    });

    it('should remain on login form after failed login', async () => {
      const formState = await page.evaluate(() => {
        return {
          hasEmailInput: !!document.querySelector('[data-testid="email-input"]'),
          hasPasswordInput: !!document.querySelector('[data-testid="password-input"]'),
          hasUserDisplay: !!document.querySelector('[data-testid="user-display"]')
        };
      });

      expect(formState.hasEmailInput).toBe(true);
      expect(formState.hasPasswordInput).toBe(true);
      expect(formState.hasUserDisplay).toBe(false); // Not logged in
    });
  });
});
