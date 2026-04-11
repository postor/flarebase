# Custom Plugins

`custom plugin` is the Flarebase external logic integration system. This replaces the deprecated `custom hook` system.

## Overview

Custom plugins allow you to extend Flarebase with business logic while:

- Maintaining a persistent WebSocket connection
- Processing requests sequentially (no race conditions)
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

// Request OTP (triggers plugin)
await db.callPlugin('request_otp', { email: 'user@example.com' });

// Register user (triggers plugin)
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

Since each plugin connection processes requests sequentially:

- **Per-connection**: Requests handled in order
- **Multiple connections**: Run in parallel
- **No race conditions**: Within single connection

For parallel processing, run multiple plugin instances:
```bash
# Scale horizontally
node auth-plugin.js &  # Instance 1
node auth-plugin.js &  # Instance 2
node auth-plugin.js &  # Instance 3
```

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

## Best Practices

- **Validate input**: Check all parameters
- **Use transactions**: For multi-step operations
- **Log errors**: Include request_id for tracing
- **Handle timeouts**: Return before 10 second limit
- **Session collections**: Use `_session_{sid}_*` pattern
- **Background jobs**: Use cron + plugin for scheduled tasks
- **Webhooks still useful**: For third-party integrations requiring HTTP callbacks
