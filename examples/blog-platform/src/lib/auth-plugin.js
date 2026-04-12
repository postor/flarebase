/**
 * Auth Plugin Module for Blog Platform
 *
 * This module handles authentication operations (login, register) via WebSocket.
 * It connects to Flarebase server's /plugins namespace and registers the "auth" plugin.
 *
 * Usage:
 *   const { startAuthPlugin } = require('./src/lib/auth-plugin');
 *   const flarebasePlugins = await startAuthPlugin(FLAREBASE_URL);
 */

const { io: ioClient } = require('socket.io-client');
const crypto = require('crypto');

/**
 * Start the auth plugin and connect to Flarebase /plugins namespace
 * @param {string} flarebaseUrl - The Flarebase server URL
 * @returns {Promise<object>} - The WebSocket connection object
 */
async function startAuthPlugin(flarebaseUrl) {
  return new Promise((resolve, reject) => {
    const flarebasePlugins = ioClient(`${flarebaseUrl}/plugins`, {
      transports: ['websocket'],
      reconnection: true
    });

    flarebasePlugins.on('connect', () => {
      console.log('✅ Auth Plugin: Connected to Flarebase /plugins namespace');

      // Register auth plugin with capabilities
      flarebasePlugins.emit('register', {
        token: 'auth-plugin-token',
        capabilities: {
          events: ['auth'],
          user_context: {}
        }
      });

      console.log('📝 Auth Plugin registered with event: auth');
      resolve(flarebasePlugins);
    });

    flarebasePlugins.on('disconnect', () => {
      console.log('❌ Auth Plugin: Disconnected from Flarebase');
    });

    flarebasePlugins.on('connect_error', (error) => {
      console.error('Auth Plugin: Connection error:', error.message);
      reject(error);
    });

    // Listen for ALL events for debugging
    flarebasePlugins.onAny((event, ...args) => {
      console.log(`🔍 Socket.IO Event [${event}]:`, JSON.stringify(args).substring(0, 500));
    });

    // Listen for plugin requests from server
    flarebasePlugins.on('plugin_request', async (data) => {
      const { request_id, event_name, params, $jwt } = data;

      console.log('\n========================================');
      console.log('📨 AUTH PLUGIN REQUEST RECEIVED');
      console.log('========================================');
      console.log(`  Request ID:  ${request_id}`);
      console.log(`  Event:       ${event_name}`);
      console.log(`  Action:      ${params.action}`);
      console.log(`  User JWT:    ${$jwt ? JSON.stringify($jwt) : 'none'}`);
      console.log(`  Params:      ${JSON.stringify(params)}`);
      console.log('========================================\n');

      try {
        let result;

        switch (params.action) {
          case 'register':
            console.log('🔧 Executing register action...');
            result = await handleRegister(params, flarebaseUrl);
            break;

          case 'login':
            console.log('🔧 Executing login action...');
            result = await handleLogin(params, flarebaseUrl);
            break;

          default:
            throw new Error(`Unknown action: ${params.action}`);
        }

        console.log(`✅ ${params.action} successful`);
        console.log(`  User: ${result.user?.email}`);
        console.log(`  Sending plugin_response (success) for request_id: ${request_id}`);

        flarebasePlugins.emit('plugin_response', {
          request_id: request_id,
          status: 'success',
          data: result
        });

      } catch (error) {
        console.error(`❌ ${params.action} FAILED:`, error.message);
        console.error(`  Stack:`, error.stack);
        console.log(`  Sending plugin_response (error) for request_id: ${request_id}`);

        flarebasePlugins.emit('plugin_response', {
          request_id: request_id,
          status: 'error',
          error: error.message
        });
      }
    });

    // Timeout fallback
    setTimeout(() => reject(new Error('Auth plugin connection timeout')), 10000);
  });
}

/**
 * Handle user registration
 */
async function handleRegister(params, flarebaseUrl) {
  const { name, email, password } = params;

  console.log(`  📝 Registering user: ${email}`);

  if (!email || !password || !name) {
    throw new Error('Email, password, and name are required');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  // Check if user already exists
  const checkResponse = await fetch(`${flarebaseUrl}/collections/users`, {
    headers: { 'X-Internal-Service': 'auth-plugin-service' }
  });

  if (checkResponse.ok) {
    const data = await checkResponse.json();
    const existingUser = data.find(u => u.data?.email === email);

    if (existingUser) {
      console.log(`  ⚠️  Email already exists: ${email}`);
      throw new Error('USER_EXISTS');
    }
  }

  // Hash password
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex');

  // Create user via Flarebase REST API
  const createResponse = await fetch(`${flarebaseUrl}/collections/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Service': 'auth-plugin-service'
    },
    body: JSON.stringify({
      email,
      name,
      password_hash: passwordHash,
      password_salt: salt,
      role: 'author',
      status: 'active',
      created_at: Date.now(),
      updated_at: Date.now()
    })
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`Failed to create user: ${errorText}`);
  }

  const userData = await createResponse.json();
  const token = generateJWT(userData);

  console.log(`  ✅ User created: ${userData.id}`);

  return {
    ok: true,
    user: {
      id: userData.id,
      email: userData.data.email,
      name: userData.data.name,
      role: userData.data.role
    },
    token: token
  };
}

/**
 * Handle user login
 */
async function handleLogin(params, flarebaseUrl) {
  const { email, password } = params;

  console.log(`  🔐 Logging in user: ${email}`);

  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const response = await fetch(`${flarebaseUrl}/collections/users`, {
    headers: { 'X-Internal-Service': 'auth-plugin-service' }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch users');
  }

  const data = await response.json();
  const user = data.find(u => u.data?.email === email);

  if (!user) {
    console.log(`  ⚠️  User not found: ${email}`);
    throw new Error('USER_NOT_FOUND');
  }

  if (!user.data?.password_hash || !user.data?.password_salt) {
    console.log(`  ⚠️  No password hash for user: ${email}`);
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
    console.log(`  ⚠️  Invalid password for: ${email}`);
    throw new Error('INVALID_CREDENTIALS');
  }

  const token = generateJWT(user);

  console.log(`  ✅ Login successful for: ${email}`);

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.data.email,
      name: user.data.name,
      role: user.data.role
    },
    token: token
  };
}

/**
 * Generate JWT token
 */
function generateJWT(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.data?.email || user.email,
    role: user.data?.role || 'author',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
  })).toString('base64');

  const signature = Buffer.from(`${header}.${payload}.flare_secret_key_change_in_production`).toString('base64');
  return `${header}.${payload}.${signature}`;
}

// Export for usage in server.js
module.exports = {
  startAuthPlugin,
  handleRegister,
  handleLogin,
  generateJWT
};
