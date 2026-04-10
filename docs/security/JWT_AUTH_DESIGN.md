# JWT Authentication Design

## Overview

Flarebase implements JWT (JSON Web Token) based authentication for securing REST API endpoints and providing identity context in Hooks.

## Architecture

### JWT Flow

```
Client                    Server                      Hook Service
  |                         |                             |
  |--1. POST /auth/login -->|                             |
  |                         |--2. call_hook("auth") ----->|
  |                         |                             |--3. Validate credentials
  |                         |<----4. Return user + token --|
  |<--5. Return JWT --------|                             |
  |                         |                             |
  |--6. GET /posts -------->|--7. Verify JWT ------------>| (if auth hook registered)
  |                         |                             |
  |<--8. Return data -------|                             |
```

### Components

1. **JWT Middleware** (`src/jwt_middleware.rs`)
   - Validates JWT tokens from Authorization header
   - Extracts user context (user_id, email, role)
   - Injects context into request state

2. **Auth Hook** (Fixed hook name: `"auth"`)
   - Handles authentication actions: login, register, logout
   - Returns JWT token on successful authentication
   - Receives `$jwt` object with current user context

3. **REST API Security**
   - All `/collections/*` endpoints require valid JWT
   - `/queries/:name` endpoints require valid JWT
   - Whitelist queries receive user context from JWT

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

## Auth Hook Protocol

### Request Format

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

- `POST /call_hook/auth` - Login/Register via auth hook
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

#### Hook Operations
- `POST /call_hook/:event` - Call non-auth hook

## Client SDK Usage

### Login

```javascript
import { FlareClient } from '@flarebase/sdk';

const client = new FlareClient('http://localhost:3000');

// Login via auth hook
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
- [x] Auth hook protocol
- [x] REST endpoint protection

### Phase 2: Client SDK
- [ ] JWT token management
- [ ] Auto-injection in headers
- [ ] Auth hook integration

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
- Auth hook request/response handling
- Middleware request interception

### Integration Tests
- Complete login flow
- Protected endpoint access
- Token expiration handling

### E2E Tests
- Login via web interface
- Data access with JWT
- Token refresh flow
