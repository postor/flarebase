/**
 * E2E Test Plugin Service for Blog Platform
 *
 * A real plugin service for end-to-end testing that connects to the Flarebase server
 * and handles plugin events for authentication and blog operations.
 *
 * Uses the NEW plugin API (plugin_request/plugin_response on /plugins namespace).
 *
 * Usage: node tests/e2e/e2e-plugin.js
 */

const { io } = require('socket.io-client');
const crypto = require('crypto');

// Polyfill for Node.js
if (typeof btoa === 'undefined') {
  global.btoa = (str) => Buffer.from(str).toString('base64');
}

const FLAREBASE_URL = process.env.FLAREBASE_URL || 'http://localhost:3000';
const HTTP_PORT = process.env.E2E_PLUGIN_HTTP_PORT || 3003;

console.log('🧪 Starting E2E Test Plugin Service...');
console.log(`📡 Connecting to Flarebase: ${FLAREBASE_URL}`);

// Connect to Flarebase /plugins namespace (NEW API)
const flarebase = io(`${FLAREBASE_URL}/plugins`, {
  transports: ['websocket'],
  reconnection: true
});

class E2EPluginService {
  constructor() {
    this.handlers = new Map();
    this.requestLog = [];
    this.socket = null;
    this.isConnected = false;

    this._registerHandlers();
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.socket = flarebase;

      this.socket.on('connect', () => {
        console.log(`✅ Connected to Flarebase /plugins, socket ID: ${this.socket.id}`);

        // Register as a plugin on /plugins namespace (NEW API)
        this.socket.emit('register', {
          token: 'E2E_TEST_TOKEN',
          capabilities: {
            events: ['auth', 'create_post', 'get_posts'],
            user_context: { role: 'e2e_plugin', service: 'e2e-test' }
          }
        });

        this.isConnected = true;
        console.log(`✅ E2E Plugin registered on /plugins`);

        // Start HTTP readiness server
        this._startHTTPServer().then(() => {
          resolve();
        }).catch(reject);
      });

      // Listen for plugin requests (NEW API)
      this.socket.on('plugin_request', async (req) => {
        console.log(`\n📨 Plugin Request: ${req.event_name}`, JSON.stringify(req.params));

        this.requestLog.push({
          eventName: req.event_name,
          params: req.params,
          sessionId: req.session_id,
          timestamp: Date.now()
        });

        const handler = this.handlers.get(req.event_name);
        if (!handler) {
          console.warn(`⚠️ No handler for ${req.event_name}`);
          this.socket.emit('plugin_response', {
            request_id: req.request_id,
            status: 'error',
            error: `No handler for event: ${req.event_name}`
          });
          return;
        }

        try {
          const data = await handler(req);
          console.log(`✅ Success for ${req.event_name}`);
          this.socket.emit('plugin_response', {
            request_id: req.request_id,
            status: 'success',
            data
          });
        } catch (error) {
          console.error(`❌ Error for ${req.event_name}:`, error.message);
          this.socket.emit('plugin_response', {
            request_id: req.request_id,
            status: 'error',
            error: error.message
          });
        }
      });

      this.socket.on('disconnect', () => {
        console.log('❌ Disconnected from Flarebase');
        this.isConnected = false;
      });

      this.socket.on('connect_error', (err) => {
        console.error('❌ Connection error:', err.message);
        reject(err);
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Plugin connection timeout'));
        }
      }, 10000);
    });
  }

  _registerHandlers() {
    // Auth handler (login/register)
    this.handlers.set('auth', async (req) => {
      const { action, email, password, name } = req.params;

      const fetch = (await import('node-fetch')).default;

      if (action === 'login') {
        // Find user by email
        const response = await fetch(`${FLAREBASE_URL}/collections/users`, {
          headers: { 'X-Internal-Service': 'e2e-plugin' }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch users');
        }

        const data = await response.json();
        const user = data.find(u => u.data?.email === email);

        if (!user) {
          throw new Error('USER_NOT_FOUND');
        }

        // Verify password
        if (!user.data?.password_hash || !user.data?.password_salt) {
          throw new Error('INVALID_CREDENTIALS');
        }

        const hashedInput = crypto.pbkdf2Sync(
          password,
          user.data.password_salt,
          10000,
          64,
          'sha256'
        ).toString('hex');

        if (hashedInput !== user.data.password_hash) {
          throw new Error('INVALID_CREDENTIALS');
        }

        // Generate JWT token
        const token = this._generateJWT(user);

        return {
          ok: true,
          action: 'login',
          user: {
            id: user.id,
            email: user.data.email,
            name: user.data.name,
            role: user.data.role
          },
          token: token
        };
      }

      if (action === 'register') {
        // Check if user exists
        const existing = await fetch(`${FLAREBASE_URL}/collections/users`, {
          headers: { 'X-Internal-Service': 'e2e-plugin' }
        });

        if (existing.ok) {
          const data = await existing.json();
          const duplicate = data.find(u => u.data?.email === email);
          if (duplicate) {
            throw new Error('USER_EXISTS');
          }
        }

        // Hash password
        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex');

        // Create user
        const createResponse = await fetch(`${FLAREBASE_URL}/collections/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Service': 'e2e-plugin'
          },
          body: JSON.stringify({
            email,
            name: name || email.split('@')[0],
            password_hash: passwordHash,
            password_salt: salt,
            role: 'author',
            status: 'active',
            created_at: Date.now(),
            updated_at: Date.now()
          })
        });

        if (!createResponse.ok) {
          throw new Error('Failed to create user');
        }

        const user = await createResponse.json();
        const token = this._generateJWT(user);

        return {
          ok: true,
          action: 'register',
          user: {
            id: user.id,
            email,
            name: name || email.split('@')[0],
            role: 'author'
          },
          token: token
        };
      }

      throw new Error('UNKNOWN_ACTION');
    });

    // Create post handler
    this.handlers.set('create_post', async (req) => {
      const { title, content, authorId } = req.params;

      const fetch = (await import('node-fetch')).default;

      const post = await fetch(`${FLAREBASE_URL}/collections/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service': 'e2e-plugin'
        },
        body: JSON.stringify({
          title,
          content,
          author_id: authorId,
          status: 'published',
          created_at: Date.now(),
          updated_at: Date.now()
        })
      });

      if (!post.ok) {
        throw new Error('Failed to create post');
      }

      const postData = await post.json();

      return {
        ok: true,
        post: postData
      };
    });

    // Get posts handler
    this.handlers.set('get_posts', async (req) => {
      const { authorId, limit } = req.params;

      const fetch = (await import('node-fetch')).default;

      let url = `${FLAREBASE_URL}/collections/posts`;
      if (authorId) {
        url += `?where=author_id,eq,${authorId}`;
      }

      const response = await fetch(url, {
        headers: { 'X-Internal-Service': 'e2e-plugin' }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch posts');
      }

      const posts = await response.json();

      return {
        ok: true,
        posts: posts.slice(0, limit || 100)
      };
    });
  }

  _generateJWT(user) {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
      sub: user.id,
      email: user.data?.email || user.email,
      role: user.data?.role || 'author',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    }));

    const signature = btoa(`${header}.${payload}.e2e_test_secret_key`);
    return `${header}.${payload}.${signature}`;
  }

  _startHTTPServer() {
    return new Promise((resolve) => {
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('E2E Plugin is ready');
      });

      server.listen(HTTP_PORT, () => {
        console.log(`📡 Readiness HTTP server on port ${HTTP_PORT}`);
        resolve();
      });
    });
  }

  stop() {
    if (this.socket) {
      this.socket.disconnect();
      this.isConnected = false;
    }
  }

  getRequestLog() {
    return [...this.requestLog];
  }
}

// Standalone mode: run as a service
if (require.main === module) {
  const plugin = new E2EPluginService();

  plugin.start()
    .then(() => {
      console.log(`✅ E2E Test Plugin connected to ${FLAREBASE_URL}`);
      console.log(`📡 HTTP readiness on port ${HTTP_PORT}`);
    })
    .catch(err => {
      console.error('❌ Failed to start E2E test plugin:', err);
      process.exit(1);
    });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down E2E Test Plugin...');
    plugin.stop();
    process.exit(0);
  });
}

module.exports = { E2EPluginService };
