# Auth Plugin for Blog Platform

## Overview

The blog platform uses a WebSocket-based **auth plugin** for handling user authentication (login and registration). This plugin runs as a separate Node.js service and connects to the Flarebase server via WebSocket.

## Why WebSocket Plugin?

Unlike HTTP webhooks, WebSocket plugins provide:
- **Sequential processing**: Requests are processed in order, preventing race conditions
- **Persistent connection**: No connection overhead for each request
- **Bidirectional communication**: Server can push updates to the plugin
- **Stateful**: Plugin can maintain context across requests

## Architecture

```
┌─────────────────┐         WebSocket          ┌──────────────────┐
│  Blog Platform  │ ◄─────────────────────────► │  Flarebase Server │
│  (Next.js)      │   /hooks namespace            │                  │
└─────────────────┘                               │                  │
                                                  │  Auth Plugin     │
                                                  │  (register)      │
└─────────────────┐                               │                  │
│ Auth Plugin     │ ◄────── hook_request ────────► │                  │
│ Service         │        hook_response            │                  │
└─────────────────┘                               └──────────────────┘
```

## WebSocket Events

### Plugin Registration
```javascript
{
  event: "register",
  token: "auth-plugin-token",
  capabilities: {
    events: ["auth"],
    user_context: {}
  }
}
```

### Server Request
```javascript
{
  request_id: "uuid",
  event_name: "auth",
  session_id: "socket-id",
  params: {
    action: "register", // or "login"
    email: "user@example.com",
    password: "password",
    name: "User Name" // for register only
  },
  $jwt: {
    user_id: null,
    email: null,
    role: "guest"
  }
}
```

### Plugin Response (Success)
```javascript
{
  request_id: "uuid",
  status: "success",
  data: {
    user: {
      id: "user_123",
      email: "user@example.com",
      name: "User Name",
      role: "author"
    },
    token: "eyJhbGci..."
  }
}
```

### Plugin Response (Error)
```javascript
{
  request_id: "uuid",
  status: "error",
  error: "USER_EXISTS"
}
```

## Usage

### Starting the Auth Plugin

```bash
# Start all services (blog, flarebase, auth-plugin)
npm run dev

# Start auth plugin only
node auth-plugin-service.js
```

### Client Usage

The blog platform client uses the `useAuth` hook:

```typescript
import { useAuth } from '@/lib/swr-hooks';

function LoginPage() {
  const { login, register, user, isAuthenticated } = useAuth();

  // Register new user
  await register({
    name: 'John Doe',
    email: 'john@example.com',
    password: 'secure123'
  });

  // Login existing user
  await login('john@example.com', 'secure123');
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `USER_EXISTS` | Email already registered |
| `INVALID_CREDENTIALS` | Email or password incorrect |
| `WEAK_PASSWORD` | Password too short (< 6 chars) |
| `INVALID_EMAIL` | Email format invalid |

## Testing

Run the integration test:

```bash
npm run test:auth
```

This test verifies:
- ✅ User registration with new email
- ✅ Duplicate email rejection
- ✅ User login with valid credentials
- ✅ Invalid credentials rejection

## Implementation Details

### Registration Flow

1. Client sends registration request via `call_hook` event
2. Server forwards to auth plugin via `hook_request`
3. Plugin validates input (email format, password strength)
4. Plugin checks if email already exists in database
5. Plugin creates new user in `users` collection
6. Plugin generates JWT token
7. Plugin returns success via `hook_response`
8. Server forwards response to client
9. Client stores JWT and user info

### Login Flow

1. Client sends login request via `call_hook` event
2. Server forwards to auth plugin via `hook_request`
3. Plugin finds user by email
4. Plugin verifies credentials (in production: bcrypt)
5. Plugin generates JWT token
6. Plugin returns success via `hook_response`
7. Server forwards response to client
8. Client stores JWT and user info

## Security Notes

⚠️ **Important**: This is a demo implementation. For production:

1. **Password Hashing**: Use `bcrypt` instead of `hashed_${password}`
2. **JWT Secret**: Use environment variable, not hardcoded string
3. **Token Validation**: Verify JWT signature on protected routes
4. **Rate Limiting**: Add rate limiting to prevent brute force attacks
5. **HTTPS**: Always use HTTPS in production
6. **Input Validation**: Add more robust input validation

## Migration from Old "Hook" Terminology

This plugin uses the new "plugin" terminology but maintains compatibility with the existing WebSocket events used by the server:

| Old Term | New Term | Event Name |
|----------|----------|------------|
| Custom Hook | Custom Plugin | `register` |
| Hook Request | Plugin Request | `hook_request` |
| Hook Response | Plugin Response | `hook_response` |
| Call Hook | Call Plugin | `call_hook` |

The server implementation still uses `hook_*` events, which is why this plugin uses those event names for compatibility.
