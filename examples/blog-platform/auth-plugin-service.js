/**
 * Auth Plugin Service for Blog Platform
 *
 * This service handles authentication operations (login, register) via WebSocket.
 * It connects to Flarebase server and registers the "auth" plugin.
 *
 * Uses the NEW plugin API (plugin_request/plugin_response events on /plugins namespace).
 *
 * Usage: node auth-plugin-service.js
 */

const { io } = require('socket.io-client');
const crypto = require('crypto');

const FLAREBASE_URL = process.env.FLAREBASE_URL || 'http://localhost:3000';

console.log('🔐 Starting Auth Plugin Service...');
console.log(`📡 Connecting to Flarebase: ${FLAREBASE_URL}`);

// Connect to Flarebase /plugins namespace (NEW API)
const flarebase = io(`${FLAREBASE_URL}/plugins`, {
  transports: ['websocket'],
  reconnection: true
});

flarebase.on('connect', () => {
  console.log('✅ Connected to Flarebase /plugins namespace');

  // Register auth plugin with capabilities (NEW API)
  flarebase.emit('register', {
    token: 'auth-plugin-token',
    capabilities: {
      events: ['auth'],
      user_context: {} // No specific user context required
    }
  });

  console.log('📝 Auth plugin registered with event: auth');
});

flarebase.on('disconnect', () => {
  console.log('❌ Disconnected from Flarebase');
  console.log('🔄 Reconnecting...');
});

flarebase.on('connect_error', (error) => {
  console.error('Connection error:', error.message);
});

// Listen for plugin requests from server (NEW API: plugin_request/plugin_response)
flarebase.on('plugin_request', async (data) => {
  const { request_id, event_name, params, $jwt } = data;

  console.log('\n📨 Plugin Request Received:');
  console.log(`  Request ID: ${request_id}`);
  console.log(`  Event: ${event_name}`);
  console.log(`  Action: ${params.action}`);
  console.log(`  User Context:`, $jwt);

  try {
    let result;

    switch (params.action) {
      case 'register':
        result = await handleRegister(params);
        break;

      case 'login':
        result = await handleLogin(params);
        break;

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }

    console.log(`✅ ${params.action} successful`);
    console.log(`  User: ${result.user?.email}`);

    // Send success response to server (NEW API)
    flarebase.emit('plugin_response', {
      request_id: request_id,
      status: 'success',
      data: result
    });

  } catch (error) {
    console.error(`❌ ${params.action} failed:`, error.message);

    // Send error response to server (NEW API)
    flarebase.emit('plugin_response', {
      request_id: request_id,
      status: 'error',
      error: error.message
    });
  }
});

/**
 * Handle user registration
 *
 * Flow:
 * 1. Validate input
 * 2. Check if email already exists (prevent duplicates)
 * 3. Create user in database
 * 4. Generate JWT token
 * 5. Return user data and token
 */
async function handleRegister(params) {
  const { name, email, password } = params;

  console.log(`  📝 Registering user: ${email}`);

  // Validate input
  if (!email || !password || !name) {
    throw new Error('Email, password, and name are required');
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  // Password validation
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  const fetch = (await import('node-fetch')).default;

  // Check if user already exists
  const checkResponse = await fetch(`${FLAREBASE_URL}/collections/users`, {
    headers: {
      'X-Internal-Service': 'auth-plugin-service'
    }
  });

  if (checkResponse.ok) {
    const data = await checkResponse.json();
    const existingUser = data.find(u => u.data?.email === email);

    if (existingUser) {
      console.log(`  ⚠️  Email already exists: ${email}`);
      throw new Error('USER_EXISTS');
    }
  }

  // Hash password properly using crypto
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex');

  // Create user via Flarebase REST API
  // Use X-Internal-Service header to bypass JWT authentication
  const createResponse = await fetch(`${FLAREBASE_URL}/collections/users`, {
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

  // Generate JWT token
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
 *
 * Flow:
 * 1. Validate input
 * 2. Find user by email
 * 3. Verify credentials
 * 4. Generate JWT token
 * 5. Return user data and token
 */
async function handleLogin(params) {
  const { email, password } = params;

  console.log(`  🔐 Logging in user: ${email}`);

  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const fetch = (await import('node-fetch')).default;

  // Find user by email
  const response = await fetch(`${FLAREBASE_URL}/collections/users`, {
    headers: {
      'X-Internal-Service': 'auth-plugin-service'
    }
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

  // Verify password hash
  if (!user.data?.password_hash || !user.data?.password_salt) {
    console.log(`  ⚠️  No password hash for user: ${email}`);
    throw new Error('INVALID_CREDENTIALS');
  }

  // Hash the provided password with the stored salt
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

  // Generate JWT token
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
 * Generate simple JWT token
 *
 * NOTE: In production, use proper JWT library (jsonwebtoken)!
 * This is a simplified implementation for demo purposes.
 */
function generateJWT(user) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    sub: user.id,
    email: user.data?.email || user.email,
    role: user.data?.role || 'author',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
  }));

  const signature = btoa(`${header}.${payload}.flare_secret_key_change_in_production`);
  return `${header}.${payload}.${signature}`;
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down Auth Plugin Service...');
  flarebase.disconnect();
  process.exit(0);
});

console.log('⏳ Waiting for Flarebase connection...');
