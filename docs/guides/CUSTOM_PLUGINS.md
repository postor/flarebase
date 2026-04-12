# Custom Plugins

`custom plugin` is the Flarebase external logic integration system. This replaces the deprecated `custom hook` system.

## Overview

Custom plugins allow you to extend Flarebase with business logic while:

- Maintaining a persistent WebSocket connection
- Processing requests sequentially per connection (no race conditions)
- Handling long-running operations
- Receiving server-sent events

## Why NOT webhooks

Old webhook systems required Flarebase to make HTTP POST callbacks to external endpoints. This approach has problems:

- **Race conditions**: Concurrent requests may arrive out of order
- **No state**: Each HTTP request is independent
- **Blocking**: Long operations timeout HTTP connections
- **Complex**: Need retry logic and failure handling

WebSocket plugins solve these problems:

- **In-order delivery**: Requests processed sequentially on each connection
- **Stateful**: Plugin maintains context across requests
- **Non-blocking**: Long operations don't timeout
- **Simple**: Direct bidirectional communication

## Terminology Migration

Old SDK APIs (deprecated):

- `FlareHook`
- `callHook`
- `hook_request`
- `hook_response`

New custom plugin API (use this):
- `FlarePluginClient`
- `callPlugin`
- `plugin_request`
- `plugin_response`

## Quick Start

### 1. Create Plugin Service

Create a standalone Node.js service:

```ts
import { FlarePluginClient } from '@flarebase/client';

const plugin = new FlarePluginClient('ws://localhost:3000/hooks', 'PLUGIN_TOKEN', {
  events: ['request_otp', 'register_user'],
});

plugin.on('request_otp', async (req) => {
  const email = req.params.email;

  // Generate and send OTP
  await sendEmail(email, 'Your code is 123456');

  return {
    ok: true,
    email,
    sent: true,
  };
});

plugin.on('register_user', async (req) => {
  const { email, password, name } = req.params;

  // Check if user exists
  const existing = await db.users.findOne({ email });
  if (existing) {
    throw new Error('USER_EXISTS');
  }

  // Create user
  const user = await db.users.insert({ email, password, name });

  return {
    ok: true,
    user: { id: user.id, email: user.email },
  };
});

plugin.connect();
```

### 2. Connect to Flarebase

Plugin connects to `ws://<host>/hooks` and registers capabilities.

### 3. Call from Client Apps

```ts
import { FlareClient } from '@flarebase/client';

const db = new FlareClient('http://localhost:3000');

// Request OTP (triggers plugin via WebSocket)
await db.callPlugin('request_otp', { email: 'user@example.com' });

// Register user (triggers plugin via WebSocket)
await db.callPlugin('register_user', {
  email: 'user@example.com',
  password: 'secure123',
  name: 'John Doe'
});
```

## Use Cases

### 1. Common Plugin Events

Core events you might implement:

- `auth` - Authentication (login, register, logout)
- `billing` - Subscription management
- `content_moderation` - Filter user content
- `search_indexer` - Update search index
- `notifications` - Send push/email notifications

### 2. Handler Best Practices

- **Idempotency**: Handle duplicate requests gracefully
- **Timeouts**: Return before 10 second timeout
- **Error handling**: Return structured error responses

### 3. Long-Running Operations

For operations that take time (e.g., contact imports):

- Store progress in `_session_{sid}_*` collections
- Update progress as work completes
- Client app subscribes to session collection

Example:
```ts
plugin.on('import_contacts', async (req) => {
  const sid = req.session_id;

  await progressCollection(sid).add({ status: 'running', progress: 0 });
  await doImport(req.params.file_id);
  await progressCollection(sid).add({ status: 'done', progress: 100 });

  return { ok: true };
});
```

## Server-Side Rendering

For SSR frameworks (Next.js, Nuxt):

- Server components: Use REST named queries (no WebSocket)
- Client components: Can use plugins normally
- Auth: Use JWT in Authorization header

Example:
```ts
// Server component (no plugin)
const posts = await fetch('http://localhost:3000/queries/posts', {
  headers: { Authorization: `Bearer ${jwt}` }
}).then(r => r.json());

// Client component (plugin use)
await db.callPlugin('like_post', { postId: '123' });
```

## Concurrency and Ordering

### Per-Connection Sequential Processing

Each plugin connection processes requests **sequentially**:

- **Per-connection**: Requests handled in order, one at a time
- **Multiple connections**: Run in parallel
- **No race conditions**: Within single connection

This means:
- If Client A and Client B both call `auth` simultaneously, each request is processed in order
- The plugin receives requests one at a time per connection
- Responses are correlated back to the correct client automatically

### Scaling Horizontally

For parallel processing, run multiple plugin instances:

```bash
# Scale horizontally - each instance handles its own queue
node auth-plugin.js &  # Instance 1
node auth-plugin.js &  # Instance 2
node auth-plugin.js &  # Instance 3
```

Flarebase will use the first available connection for each event. For load balancing across multiple instances, consider:

1. Running multiple plugin processes
2. Using a load balancer in front of plugin instances
3. Implementing custom connection selection logic

## Response Format

Success:
```json
{
  "ok": true,
  "data": {
    "user_id": "u_123"
  }
}
```

Error:
```json
{
  "ok": false,
  "code": "OTP_INVALID",
  "message": "verification code is invalid"
}
```

## JWT Context

Plugins receive user authentication context in `$jwt`:

```json
{
  "request_id": "uuid",
  "event_name": "some_event",
  "session_id": "socket-id",
  "params": { "email": "user@example.com" },
  "$jwt": {
    "user_id": "u_123",
    "email": "user@example.com",
    "role": "user"
  }
}
```

For unauthenticated requests, `$jwt.role` is `"guest"`.

## WebSocket-Only Communication

**Important**: Plugin calls are now **WebSocket-only**. The HTTP POST `/call_hook/*` endpoints have been removed.

### Why WebSocket-Only?

1. **Connection reuse**: No need for separate HTTP POST - uses the same WebSocket connection
2. **Better concurrency handling**: Sequential processing per connection prevents race conditions
3. **Simplified architecture**: One communication channel instead of two
4. **Real-time capabilities**: Plugins can push events to clients

### Migration from HTTP POST

Old (deprecated):
```ts
// Don't do this - HTTP POST endpoints removed
await fetch('http://localhost:3000/call_hook/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
```

New (WebSocket):
```ts
// Use WebSocket-based plugin calls
await db.callPlugin('auth', { email, password });
```

## Best Practices

- **Validate input**: Check all parameters
- **Use transactions**: For multi-step operations
- **Log errors**: Include request_id for tracing
- **Handle timeouts**: Return before 10 second limit
- **Session collections**: Use `_session_{sid}_*` pattern
- **Background jobs**: Use cron + plugin for scheduled tasks
- **Webhooks still useful**: For third-party integrations requiring HTTP callbacks

## Testing Concurrent Plugin Calls

When testing plugins, verify that:

1. Different clients receive their own results (not mixed up)
2. Requests are processed in order per connection
3. Multiple connections can run in parallel

Example test scenario:
```ts
// 5 clients logging in concurrently
const promises = [];
for (let i = 0; i < 5; i++) {
  promises.push(db.callPlugin('auth', {
    email: `user${i}@example.com`,
    password: 'password123'
  }));
}

const results = await Promise.all(promises);

// Each result should match the corresponding request
results.forEach((result, i) => {
  assert(result.user.email === `user${i}@example.com`);
});
```
