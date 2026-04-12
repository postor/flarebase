/**
 * Blog Platform E2E Tests
 *
 * Tests the complete blog platform functionality using the new plugin API:
 * - Authentication (login/register) via auth plugin
 * - Article CRUD operations
 * - Real-time updates via WebSocket
 * - JWT transparency
 * - Error handling
 *
 * Uses real server connections with NO mocks.
 */

import { io } from 'socket.io-client';
import { FlareClient } from '@flarebase/client';

const FLARE_URL = process.env.FLARE_URL || 'http://localhost:3000';

// Helper: Sleep for milliseconds
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: Create a connected FlareClient
async function createConnectedClient(): Promise<FlareClient> {
  const client = new FlareClient(FLARE_URL, { debug: false });

  // Wait for socket connection
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket connection timeout')), 10000);
    const socket = (client as any).socket;

    if (socket.connected) {
      clearTimeout(timeout);
      resolve();
    } else {
      socket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.on('connect_error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    }
  });

  return client;
}

describe('Blog Platform E2E', () => {
  describe('Authentication Flow', () => {
    it('should register a new user via auth plugin', async () => {
      const client = await createConnectedClient();

      const timestamp = Date.now();
      const testEmail = `e2e-test-${timestamp}@example.com`;
      const testName = `E2E Test User ${timestamp}`;
      const testPassword = 'testPass123';

      // Register via auth plugin
      const result: any = await client.callPlugin('auth', {
        action: 'register',
        email: testEmail,
        password: testPassword,
        name: testName
      });

      // Verify registration response
      expect(result.ok).toBe(true);
      expect(result.user.email).toBe(testEmail);
      expect(result.user.name).toBe(testName);
      expect(result.token).toBeDefined();

      // Verify JWT was stored automatically
      expect(client.auth.isAuthenticated).toBe(true);
      expect(client.auth.user?.email).toBe(testEmail);

      client.logout();
    });

    it('should reject duplicate email registration', async () => {
      const client = await createConnectedClient();

      const timestamp = Date.now();
      const testEmail = `duplicate-${timestamp}@example.com`;
      const testPassword = 'testPass123';

      // First registration
      const result1: any = await client.callPlugin('auth', {
        action: 'register',
        email: testEmail,
        password: testPassword,
        name: 'First User'
      });

      expect(result1.ok).toBe(true);

      // Second registration with same email should fail
      await expect(
        client.callPlugin('auth', {
          action: 'register',
          email: testEmail,
          password: testPassword,
          name: 'Second User'
        })
      ).rejects.toThrow();

      client.logout();
    });

    it('should login successfully with valid credentials', async () => {
      const client = await createConnectedClient();

      const timestamp = Date.now();
      const testEmail = `login-test-${timestamp}@example.com`;
      const testName = `Login Test User`;
      const testPassword = 'testPass123';

      // Register first
      await client.callPlugin('auth', {
        action: 'register',
        email: testEmail,
        password: testPassword,
        name: testName
      });

      // Logout
      client.logout();
      expect(client.auth.isAuthenticated).toBe(false);

      // Login
      const loginResult: any = await client.callPlugin('auth', {
        action: 'login',
        email: testEmail,
        password: testPassword
      });

      // Verify login response
      expect(loginResult.ok).toBe(true);
      expect(loginResult.user.email).toBe(testEmail);
      expect(loginResult.token).toBeDefined();

      // Verify JWT was stored automatically
      expect(client.auth.isAuthenticated).toBe(true);
      expect(client.auth.user?.email).toBe(testEmail);

      client.logout();
    });

    it('should reject login with invalid credentials', async () => {
      const client = await createConnectedClient();

      await expect(
        client.callPlugin('auth', {
          action: 'login',
          email: 'nonexistent@example.com',
          password: 'wrongpassword'
        })
      ).rejects.toThrow();

      expect(client.auth.isAuthenticated).toBe(false);
    });

    it('should persist JWT across client reconnections', async () => {
      const client1 = await createConnectedClient();

      const timestamp = Date.now();
      const testEmail = `persist-${timestamp}@example.com`;
      const testPassword = 'testPass123';

      // Register
      await client1.callPlugin('auth', {
        action: 'register',
        email: testEmail,
        password: testPassword,
        name: 'Persist Test'
      });

      expect(client1.auth.isAuthenticated).toBe(true);
      const userId = client1.auth.user?.id;

      // Create new client (simulates page reload)
      const client2 = await createConnectedClient();

      // JWT should be restored from localStorage
      expect(client2.auth.isAuthenticated).toBe(true);
      expect(client2.auth.user?.email).toBe(testEmail);
      expect(client2.auth.user?.id).toBe(userId);

      client1.logout();
      client2.logout();
    });

    it('should logout and clear JWT automatically', async () => {
      const client = await createConnectedClient();

      const timestamp = Date.now();
      const testEmail = `logout-${timestamp}@example.com`;
      const testPassword = 'testPass123';

      // Register
      await client.callPlugin('auth', {
        action: 'register',
        email: testEmail,
        password: testPassword,
        name: 'Logout Test'
      });

      expect(client.auth.isAuthenticated).toBe(true);

      // Logout
      client.logout();

      // Verify cleared
      expect(client.auth.isAuthenticated).toBe(false);
      expect(client.auth.user).toBeNull();
    });
  });

  describe('Article Management', () => {
    let client: FlareClient;
    let testEmail: string;
    let testPassword: string;

    beforeAll(async () => {
      client = await createConnectedClient();

      testEmail = `article-test-${Date.now()}@example.com`;
      testPassword = 'testPass123';

      // Register and login
      await client.callPlugin('auth', {
        action: 'register',
        email: testEmail,
        password: testPassword,
        name: 'Article Test User'
      });
    });

    afterAll(() => {
      if (client) {
        client.logout();
      }
    });

    it('should create an article with JWT automatically included', async () => {
      const testTitle = `E2E Test Article ${Date.now()}`;
      const testContent = `Created at ${new Date().toISOString()}`;

      // Create article
      const article = await client.collection('posts').add({
        title: testTitle,
        content: testContent,
        author_id: client.auth.user?.id,
        status: 'published',
        created_at: Date.now(),
        updated_at: Date.now()
      });

      // Verify article was created
      expect(article.id).toBeDefined();
      expect(article.data.title).toBe(testTitle);
      expect(article.data.content).toBe(testContent);
    });

    it('should retrieve all articles', async () => {
      const articles = await client.collection('posts').get();

      expect(Array.isArray(articles)).toBe(true);
      expect(articles.length).toBeGreaterThan(0);
    });

    it('should update an article', async () => {
      const testTitle = `Update Test ${Date.now()}`;

      // Create article
      const article = await client.collection('posts').add({
        title: testTitle,
        content: 'Initial content',
        author_id: client.auth.user?.id,
        status: 'draft',
        created_at: Date.now(),
        updated_at: Date.now()
      });

      // Update article
      const updated = await client.collection('posts').doc(article.id).update({
        content: 'Updated content',
        status: 'published',
        updated_at: Date.now()
      });

      expect(updated.data.content).toBe('Updated content');
      expect(updated.data.status).toBe('published');
    });

    it('should delete an article', async () => {
      const testTitle = `Delete Test ${Date.now()}`;

      // Create article
      const article = await client.collection('posts').add({
        title: testTitle,
        content: 'To be deleted',
        author_id: client.auth.user?.id,
        status: 'draft',
        created_at: Date.now(),
        updated_at: Date.now()
      });

      const articleId = article.id;

      // Delete article
      await client.collection('posts').doc(articleId).delete();

      // Verify deletion by fetching all articles
      const articles = await client.collection('posts').get();
      const deletedArticle = articles.find((a: any) => a.id === articleId);

      expect(deletedArticle).toBeUndefined();
    });

    it('should query articles by author', async () => {
      const authorId = client.auth.user?.id;

      // Create multiple articles
      for (let i = 0; i < 3; i++) {
        await client.collection('posts').add({
          title: `Author Test Article ${i}`,
          content: `Content ${i}`,
          author_id: authorId,
          status: 'published',
          created_at: Date.now(),
          updated_at: Date.now()
        });
      }

      // Query by author
      const authorArticles = await client
        .collection('posts')
        .where('author_id', '==', authorId)
        .get();

      expect(authorArticles.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Real-time Updates', () => {
    let client1: FlareClient;
    let client2: FlareClient;
    let testEmail1: string;
    let testEmail2: string;

    beforeAll(async () => {
      client1 = await createConnectedClient();
      client2 = await createConnectedClient();

      testEmail1 = `realtime1-${Date.now()}@example.com`;
      testEmail2 = `realtime2-${Date.now()}@example.com`;
      const testPassword = 'testPass123';

      // Register both clients
      await client1.callPlugin('auth', {
        action: 'register',
        email: testEmail1,
        password: testPassword,
        name: 'Realtime User 1'
      });

      await client2.callPlugin('auth', {
        action: 'register',
        email: testEmail2,
        password: testPassword,
        name: 'Realtime User 2'
      });
    });

    afterAll(() => {
      client1.logout();
      client2.logout();
    });

    it('should receive real-time article creation events', async () => {
      const receivedEvents: any[] = [];

      // Subscribe to posts collection on client2
      client2.collection('posts').onSnapshot((change: any) => {
        receivedEvents.push(change);
      });

      // Wait for subscription to register
      await sleep(500);

      // Create article on client1
      const testTitle = `Realtime Test ${Date.now()}`;
      await client1.collection('posts').add({
        title: testTitle,
        content: 'Realtime test content',
        author_id: client1.auth.user?.id,
        status: 'published',
        created_at: Date.now(),
        updated_at: Date.now()
      });

      // Wait for event
      await sleep(1000);

      // Verify event received
      const addedEvent = receivedEvents.find(e => e.type === 'added');
      expect(addedEvent).toBeDefined();
      expect(addedEvent.doc.data.title).toBe(testTitle);
    });

    it('should receive real-time article update events', async () => {
      const receivedEvents: any[] = [];

      // Subscribe to posts collection
      client2.collection('posts').onSnapshot((change: any) => {
        receivedEvents.push(change);
      });

      await sleep(500);

      // Create article
      const article = await client1.collection('posts').add({
        title: `Update Realtime Test ${Date.now()}`,
        content: 'Initial',
        author_id: client1.auth.user?.id,
        status: 'draft',
        created_at: Date.now(),
        updated_at: Date.now()
      });

      await sleep(500);

      // Update article
      await client1.collection('posts').doc(article.id).update({
        content: 'Updated content',
        status: 'published',
        updated_at: Date.now()
      });

      // Wait for event
      await sleep(1000);

      // Verify update event received
      const modifiedEvent = receivedEvents.find(e => e.type === 'modified');
      expect(modifiedEvent).toBeDefined();
    });

    it('should receive real-time article deletion events', async () => {
      const receivedEvents: any[] = [];

      // Subscribe to posts collection
      client2.collection('posts').onSnapshot((change: any) => {
        receivedEvents.push(change);
      });

      await sleep(500);

      // Create article
      const article = await client1.collection('posts').add({
        title: `Delete Realtime Test ${Date.now()}`,
        content: 'To be deleted',
        author_id: client1.auth.user?.id,
        status: 'draft',
        created_at: Date.now(),
        updated_at: Date.now()
      });

      await sleep(500);

      // Delete article
      await client1.collection('posts').doc(article.id).delete();

      // Wait for event
      await sleep(1000);

      // Verify delete event received
      const removedEvent = receivedEvents.find(e => e.type === 'removed');
      expect(removedEvent).toBeDefined();
    });
  });

  describe('JWT Transparency', () => {
    it('should not expose internal JWT methods publicly', async () => {
      const client = await createConnectedClient();

      // Check that internal JWT methods are not accessible on public API
      expect((client as any)._setJWT).toBeDefined(); // Internal method exists
      expect((client as any).setJWT).toBeUndefined(); // But not exposed as setJWT

      // Public auth accessor should work
      expect(client.auth).toBeDefined();
      expect(typeof client.auth.isAuthenticated).toBe('boolean');
      expect(typeof client.auth.user).toBe('object');

      client.logout();
    });

    it('should handle JWT state transparently during auth flow', async () => {
      const client = await createConnectedClient();

      // Initial state
      expect(client.auth.isAuthenticated).toBe(false);
      expect(client.auth.user).toBeNull();

      const timestamp = Date.now();
      const testEmail = `jwt-transparency-${timestamp}@example.com`;
      const testPassword = 'testPass123';

      // Register
      const result: any = await client.callPlugin('auth', {
        action: 'register',
        email: testEmail,
        password: testPassword,
        name: 'Transparency Test'
      });

      // After registration, JWT should be set automatically
      expect(client.auth.isAuthenticated).toBe(true);
      expect(client.auth.user?.email).toBe(testEmail);
      expect(result.token).toBeDefined();

      // Logout
      client.logout();
      expect(client.auth.isAuthenticated).toBe(false);
      expect(client.auth.user).toBeNull();

      client.logout();
    });
  });

  describe('Error Handling', () => {
    let client: FlareClient;

    beforeAll(async () => {
      client = await createConnectedClient();
    });

    afterAll(() => {
      client.logout();
    });

    it('should handle invalid plugin event names', async () => {
      await expect(
        client.callPlugin('nonexistent_event', { foo: 'bar' })
      ).rejects.toThrow();
    });

    it('should handle missing required fields in registration', async () => {
      await expect(
        client.callPlugin('auth', {
          action: 'register',
          email: 'test@example.com'
          // Missing password and name
        })
      ).rejects.toThrow();
    });

    it('should handle missing required fields in login', async () => {
      await expect(
        client.callPlugin('auth', {
          action: 'login',
          email: 'test@example.com'
          // Missing password
        })
      ).rejects.toThrow();
    });

    it('should handle concurrent plugin calls correctly', async () => {
      const timestamp = Date.now();

      // Create multiple articles concurrently
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          client.collection('posts').add({
            title: `Concurrent Test ${i} - ${timestamp}`,
            content: `Content ${i}`,
            author_id: client.auth.user?.id || 'anonymous',
            status: 'draft',
            created_at: Date.now(),
            updated_at: Date.now()
          })
        );
      }

      const results = await Promise.allSettled(promises);

      // All should succeed or some may fail due to auth (which is fine)
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThan(0);
    });
  });
});
