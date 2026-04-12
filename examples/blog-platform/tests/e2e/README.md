# Blog Platform E2E Tests

This directory contains end-to-end tests for the Blog Platform example project, using the **new plugin API** (plugin_request/plugin_response on `/plugins` namespace).

## Test Files

### `blog.test.js` - Simple JavaScript E2E Tests
- **Runner**: Simple Node.js script (no test framework required)
- **What it tests**:
  - Authentication flow (register/login/logout)
  - Article CRUD operations (create/read/update/delete)
  - JWT transparency
  - Error handling
- **Run**: `node tests/e2e/blog.test.js`

### `blog.test.ts` - TypeScript Vitest E2E Tests
- **Runner**: Vitest with custom config
- **What it tests**: Same as blog.test.js plus real-time WebSocket updates
- **Run**: `npx vitest run tests/e2e/blog.test.ts --config vitest.e2e.config.js`

### `e2e-plugin.js` - E2E Test Plugin Service
- A real plugin service that connects to Flarebase `/plugins` namespace
- Handles test events: `auth`, `create_post`, `get_posts`
- Provides HTTP readiness endpoint for test orchestration

### `run_e2e_tests.js` - Full E2E Test Orchestrator
- Starts Flarebase server with fresh DB
- Starts E2E plugin service
- Starts auth plugin service  
- Runs tests
- Cleans up

## New Plugin API Changes

The blog platform has been updated to use the **NEW plugin API**:

### Old API (Deprecated)
```javascript
// Old: /hooks namespace
const socket = io(`${FLAREBASE_URL}/hooks`);

// Old events
socket.on('hook_request', handler);
socket.emit('hook_response', response);
```

### New API (Current)
```javascript
// New: /plugins namespace
const socket = io(`${FLAREBASE_URL}/plugins`);

// New events
socket.on('plugin_request', handler);
socket.emit('plugin_response', response);
```

## Running the Tests

### Option 1: Simple Test (Requires Running Server)

```bash
# 1. Start Flarebase server
cargo run -p flare-server

# 2. Start auth plugin
node auth-plugin-service.js

# 3. Run simple tests
node tests/e2e/blog.test.js
```

### Option 2: Full E2E Test Suite (Automated)

```bash
# This will start everything automatically and run tests
node tests/e2e/run_e2e_tests.js
```

This orchestrator:
1. Cleans up old test data
2. Finds free ports dynamically
3. Starts Flarebase server with empty DB
4. Starts E2E plugin service
5. Starts auth plugin service
6. Waits for all services to be ready
7. Runs vitest E2E tests
8. Cleans up processes

### Option 3: Manual Testing with Blog Platform

```bash
# Start all services
npm run dev

# In another terminal, run tests
npm run test:e2e
```

## Test Coverage

### Authentication Flow
- ✅ Register new user via auth plugin
- ✅ Reject duplicate email registration
- ✅ Login with valid credentials
- ✅ Reject login with invalid credentials
- ✅ JWT persistence across reconnections
- ✅ Logout and JWT cleanup

### Article Management
- ✅ Create article with JWT authentication
- ✅ Retrieve all articles
- ✅ Update article
- ✅ Delete article
- ✅ Query articles by author

### Real-time Updates (TypeScript tests only)
- ✅ Receive article creation events
- ✅ Receive article update events
- ✅ Receive article deletion events

### JWT Transparency
- ✅ Internal methods not exposed
- ✅ JWT state handled transparently

### Error Handling
- ✅ Invalid plugin event names
- ✅ Missing required fields
- ✅ Concurrent operations

## Plugin Configuration

### Auth Plugin (`auth-plugin-service.js`)
- Connects to: `/plugins` namespace
- Registered events: `['auth']`
- Handles: `login`, `register` actions
- Password hashing: PBKDF2 with random salt

### E2E Test Plugin (`e2e-plugin.js`)
- Connects to: `/plugins` namespace
- Registered events: `['auth', 'create_post', 'get_posts']`
- Used for: Automated test orchestration

## Architecture

```
┌─────────────────┐
│  Blog Platform  │  ← Next.js app (port 3002)
└────────┬────────┘
         │
         │ HTTP/WebSocket
         │
┌────────┴────────┐
│ Flarebase Server│  ← Rust server (port 3000)
└────────┬────────┘
         │
         │ /plugins namespace
         │
    ┌────┴─────┐
    │          │
┌───┴──┐  ┌───┴────┐
│Auth  │  │E2E     │
│Plugin│  │Plugin  │
└──────┘  └────────┘
```

## Troubleshooting

### Tests fail with "xhr poll error"
- Flarebase server is not running or not reachable
- Check server logs: `cargo run -p flare-server`

### Tests fail with "No handler for event"
- Plugin service is not running
- Start auth plugin: `node auth-plugin-service.js`

### Tests timeout
- Check that both plugins are connected
- Check server logs for plugin registration

### localStorage errors
- The polyfill should be auto-applied
- If you see errors, check that the polyfill code is at the top of blog.test.js

## Migration from Old API

If you have older test files using the deprecated API, update them:

1. Change namespace from `/hooks` to `/plugins`
2. Change events from `hook_request/hook_response` to `plugin_request/plugin_response`
3. Update plugin registration to use new capabilities format
4. Update client calls to use `callPlugin()` instead of `callHook()`

See `CUSTOM_PLUGINS.md` in the docs directory for more details.
