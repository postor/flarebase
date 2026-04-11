# JWT Authentication Design

## Overview

Flarebase implements JWT (JSON Web Token) based authentication for securing REST API endpoints and providing identity context in Custom Plugins.

## Architecture

### JWT Flow

```
Client                    Server                      Plugin Service
  |                         |                             |
  |--1. POST /auth/login -->|                             |
  |                         |--2. WebSocket plugin_req -->|
  |                         |                             |--3. Validate credentials
  |                         |<----4. WebSocket plugin_res --|
  |<--5. Return JWT --------|                             |
  |                         |                             |
  |--6. GET /posts -------->|--7. Verify JWT ------------>| (if auth plugin registered)
  |                         |                             |
  |<--8. Return data -------|                             |
```

### Components

1. **JWT Middleware** (`src/jwt_middleware.rs`)
   - Validates JWT tokens from Authorization header
   - Extracts user context (user_id, email, role)
   - Injects context into request state

2. **Auth Plugin** (Fixed plugin event: `"auth"`)
   - Handles authentication actions: login, register, logout
   - Returns JWT token on successful authentication
   - Receives `$jwt` object with current user context
   - **Uses persistent WebSocket connection, NOT HTTP POST**

3. **REST API Security**
   - All `/collections/*` endpoints require valid JWT
   - `/queries/:name` endpoints require valid JWT
   - Whitelist queries receive user context from JWT

## Why WebSocket Instead of HTTP POST?

**Problem with HTTP POST webhooks**:
- Race conditions: Multiple concurrent requests may arrive out of order
- No persistent connection context
- Additional HTTP overhead for each request
- Harder to handle long-running operations

**Advantages of WebSocket plugins**:
- **Sequential processing**: Requests processed in order per connection
- **Persistent context**: Plugin maintains state across requests
- **Bidirectional communication**: Server can push updates to plugin
- **No race conditions**: Single connection ensures serial execution

## JWT Token Format

### Payload
```json
{
  "user_id": "user_123",
  "email": "user@example.com",
  "role": "user",
  "iat": 1234567890,
  "exp": 1234571490
}
```

### Claims
- `user_id`: Unique user identifier
- `email`: User email address
- `role`: User role (user, admin, guest)
- `iat`: Issued at timestamp
- `exp`: Expiration timestamp (default 1 hour)

## Auth Plugin Protocol

### Connection

Plugin connects to WebSocket endpoint:
```
ws://localhost:3000/hooks
```

And registers with:
```json
{
  "event": "register",
  "token": "PLUGIN_TOKEN",
  "capabilities": {
    "events": ["auth"],
    "user_context": {}
  }
}
```

### Request Format

Server sends via WebSocket:
```json
{
  "event_name": "auth",
  "request_id": "req_123",
  "session_id": "sess_456",
  "params": {
    "action": "login",
    "email": "user@example.com",
    "password": "hashed_password"
  },
  "$jwt": {
    "user_id": null,
    "email": null,
    "role": "guest"
  }
}
```

### Response Format

Plugin responds via WebSocket:

**Success (login)**:
```json
{
  "request_id": "req_123",
  "status": "success",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user_123",
      "email": "user@example.com",
      "role": "user",
      "name": "John Doe"
    }
  }
}
```

**Success (register)**:
```json
{
  "request_id": "req_123",
  "status": "success",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user_123",
      "email": "user@example.com",
      "role": "user"
    }
  }
}
```

**Error**:
```json
{
  "request_id": "req_123",
  "status": "error",
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password"
  }
}
```

## API Endpoints

### Public Endpoints (No Auth)

- `POST /auth/login` - Login via auth plugin (triggers plugin request)
- `GET /health` - Health check

### Protected Endpoints (Require JWT)

#### Collection Operations
- `GET /collections/:collection` - List documents
- `POST /collections/:collection` - Create document
- `GET /collections/:collection/:id` - Get document
- `PUT /collections/:collection/:id` - Update document
- `DELETE /collections/:collection/:id` - Delete document

#### Query Operations
- `POST /query` - Run custom query (admin only)
- `POST /queries/:name` - Run named query (whitelisted)

#### Plugin Operations
- Client apps call plugins via WebSocket, not HTTP

## Client SDK Usage

### Login

```javascript
import { FlareClient } from '@flarebase/sdk';

const client = new FlareClient('http://localhost:3000');

// Login via auth plugin (uses WebSocket internally)
const result = await client.auth.login({
  email: 'user@example.com',
  password: 'password'
});

// JWT is automatically stored
console.log('User:', result.user);
```

### Making Authenticated Requests

```javascript
// JWT is automatically included in requests
const posts = await client.collection('posts').get();

// With SWR
import useSWR from 'swr';

const fetcher = (url) => fetch(url).then(r => r.json());
const { data } = useSWR('/queries/my_posts', fetcher);
```

### React Hook

```jsx
import { useFlareAuth } from '@flarebase/react';

function LoginPage() {
  const { login, user, loading } = useFlareAuth();

  const handleLogin = async (e) => {
    e.preventDefault();
    await login({ email, password });
  };

  return (
    <form onSubmit={handleLogin}>
      {/* Login form */}
    </form>
  );
}
```

## Security Considerations

### Token Storage
- **Recommended**: Store JWT in httpOnly cookie (server-set)
- **Alternative**: localStorage (with XSS protection)
- **Fallback**: Memory-only (cleared on refresh)

### Token Refresh
- Refresh token endpoint: `POST /auth/refresh`
- Access token expires in 1 hour
- Refresh token expires in 30 days

### Token Revocation
- Server maintains token blacklist
- Logout adds token to blacklist
- Blacklist cleanup runs hourly

## Implementation Phases

### Phase 1: Server Infrastructure
- [x] JWT middleware module
- [x] Auth plugin protocol (WebSocket-based)
- [x] REST endpoint protection

### Phase 2: Client SDK
- [ ] JWT token management
- [ ] Auto-injection in headers
- [ ] Auth plugin integration

### Phase 3: Framework Integrations
- [ ] React hooks
- [ ] Vue composables
- [ ] SWR fetcher

### Phase 4: Advanced Features
- [ ] Token refresh
- [ ] Logout/revocation
- [ ] Multi-factor authentication

## Testing Strategy

### Unit Tests
- JWT generation and validation
- Auth plugin request/response handling
- Middleware request interception

### Integration Tests
- Complete login flow
- Protected endpoint access
- Token expiration handling
- **Email exists/not-exists scenarios during registration**

### E2E Tests
- Login via web interface
- Data access with JWT
- Token refresh flow

## Error Codes

| Code | Description |
|------|-------------|
| `INVALID_CREDENTIALS` | Email or password is incorrect |
| `USER_EXISTS` | Email already registered |
| `WEAK_PASSWORD` | Password doesn't meet requirements |
| `INVALID_TOKEN` | Token is malformed or expired |
| `UNAUTHORIZED` | No valid JWT provided |
