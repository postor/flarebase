# @flarebase/client

Official JavaScript SDK for Flarebase - **JWT Authentication is Completely Transparent**

High-performance, real-time JavaScript SDK for the Flarebase distributed document infrastructure.

## Key Features

- ✅ **Automatic JWT Handling** - No manual token management required
- ✅ **Persistent Sessions** - Sessions survive page reloads
- ✅ **Real-time Updates** - Socket.IO integration for live data
- ✅ **Simple API** - Intuitive methods for all operations
- ✅ **Generic Storage** - No schema definitions required

## Architectural Philosophy

Flarebase is a **Passive Infrastructure** (BaaS) designed to reach "Zero-Backend" development.

- **Generic Storage**: The server does NOT manage business logic or predefined schemas. It provides generic collection-based CRUD and Query capabilities.
- **Dynamic Collections**: Collections (like `users`, `items`, `posts`) are created on-the-fly when the client interacts with them. There is no need to define tables or schemas on the server.
- **Client-Driven**: Business flows (like Registration, Article Moderation, etc.) are implemented on the client via generic collection operations.
- **Event-Driven**: The server provides real-time event synchronization (WebSockets) and Webhooks to allow external services to react to data changes.
- **JWT Transparency**: All JWT operations are automatic and internal to the SDK.

## Installation

```bash
npm install @flarebase/client
```

## Quick Start

```javascript
import { FlareClient } from '@flarebase/client';

const db = new FlareClient('http://localhost:3000');

// Login - JWT automatically saved
await db.login({
  email: 'user@example.com',
  password: 'password123'
});

// Check authentication status
if (db.auth.isAuthenticated) {
  console.log('Logged in as:', db.auth.user);
}

// Fetch data - JWT automatically included
const posts = await db.collection('posts').get();

// Create data - JWT automatically included
await db.collection('posts').add({
  title: 'Hello World',
  content: 'My first post'
});

// Logout - JWT automatically cleared
db.logout();
```

## JWT Transparency

**The SDK handles JWT completely automatically. You never need to:**

- ❌ Call `setJWT()` manually
- ❌ Load tokens from localStorage yourself
- ❌ Add `Authorization` headers to requests
- ❌ Handle token expiration manually
- ❌ Clear tokens on logout

**All JWT operations are handled internally:**

```javascript
// ✅ CORRECT: Just use the SDK
await db.login({ email, password });
const data = await db.collection('posts').get(); // JWT included automatically

// ❌ WRONG: Don't manually handle JWT
const { token } = await db.login({ email, password });
db._setJWT(token); // This method is private (underscore prefix)
```

## API Reference

### Constructor

```javascript
const db = new FlareClient(baseURL);
```

**Parameters:**
- `baseURL` (string): Flarebase server URL

### Authentication

#### `db.login(credentials)`

Login with email and password via WebSocket. JWT is automatically saved.

```javascript
await db.login({
  email: 'user@example.com',
  password: 'password'
});
```

#### `db.register(userData)`

Register a new user via WebSocket. JWT is automatically saved.

```javascript
await db.register({
  name: 'John Doe',
  email: 'john@example.com',
  password: 'password123'
});
```

#### `db.logout()`

Logout current user. JWT is automatically cleared.

```javascript
db.logout();
```

#### `db.auth`

Read-only object for checking authentication state.

```javascript
if (db.auth.isAuthenticated) {
  console.log('User:', db.auth.user);
}
```

**Properties:**
- `isAuthenticated` (boolean): `true` if logged in
- `user` (object | null): Current user object

**Legacy Methods (for backward compatibility):**
- `db.isAuthenticated()` - Returns boolean
- `db.getCurrentUser()` - Returns user object or null

### Data Operations

#### Collection Operations

```javascript
// Get all documents
const docs = await db.collection('posts').get();

// Add a document
const newDoc = await db.collection('posts').add({
  title: 'Hello',
  content: 'World'
});

// Get a specific document
const doc = await db.collection('posts').doc('doc-id').get();

// Update a document
await db.collection('posts').doc('doc-id').update({
  title: 'Updated Title'
});

// Delete a document
await db.collection('posts').doc('doc-id').delete();
```

#### Querying

```javascript
// Simple query
const results = await db.collection('users')
  .where('age', '>=', 18)
  .where('role', '==', 'admin')
  .get();
```

#### Real-time Updates

```javascript
// Listen for changes
db.collection('posts').onSnapshot((snapshot) => {
  snapshot.forEach((change) => {
    if (change.type === 'added') {
      console.log('New document:', change.doc);
    } else if (change.type === 'modified') {
      console.log('Modified document:', change.doc);
    } else if (change.type === 'removed') {
      console.log('Removed document:', change.id);
    }
  });
});
```

### Named Queries (Whitelist Queries)

```javascript
// Execute a pre-defined named query
const results = await db.namedQuery('get-user-posts', {
  userId: 'user-123',
  limit: 10
});
```

### SWR Integration

```javascript
// Create SWR fetcher for a query
const fetcher = db.createSWRFetcher('get-posts');

// Universal SWR fetcher
const universalFetcher = db.swrFetcher;

// Use with useSWR
const { data, error } = useSWR(['get-posts', { limit: 10 }], fetcher);
```

### Session-Scoped Data

For private, per-session data:

```javascript
// Session-scoped collection (isolated per client)
const sessionData = db.sessionTable('private-data');
await sessionData.add({ key: 'value' });
```

### Advanced Features

#### Batch Operations

```javascript
const batch = db.batch();
batch.set(docRef1, { data: 'value1' });
batch.update(docRef2, { field: 'newValue' });
batch.delete(docRef3);
await batch.commit();
```

#### Transactions

```javascript
await db.runTransaction(async (transaction) => {
  const doc = await transaction.get(docRef);
  await transaction.update(docRef, {
    count: doc.data.count + 1
  });
});
```

## User Workflows (Example)

In a Firebase-like architecture, complex workflows are built using generic collections.

### Registration Flow
1. **Request Code**: Create a document in `verification_requests`.
2. **Infrastructure Hook**: A server-side hook (or external worker) reacts to the write, generates a code, and sends it (mocked in this repo).
3. **Register**: Write user data to `users` collection after verifying the code.

```javascript
// 1. Request OTP
await db.auth.requestVerificationCode('bob@example.com');

// 2. Mock Hook generates code (e.g., '123456')

// 3. Register User
await db.auth.register({
  username: 'bob@example.com',
  name: 'Bob'
}, '123456');
```

## Framework Integration

### React

Use `@flarebase/react` for React integration:

```bash
npm install @flarebase/react
```

```jsx
import { FlarebaseProvider, useAuth, useFlarebase } from '@flarebase/react';

function App() {
  return (
    <FlarebaseProvider baseURL="http://localhost:3000">
      <MyComponent />
    </FlarebaseProvider>
  );
}

function MyComponent() {
  const { user, login, logout, isAuthenticated } = useAuth();
  const db = useFlarebase();

  // JWT is completely transparent!
}
```

### Vue 3

```javascript
import { FlareClient } from '@flarebase/client';

const db = new FlareClient();

export default {
  setup() {
    const posts = ref([]);

    onMounted(async () => {
      if (db.auth.isAuthenticated) {
        const data = await db.collection('posts').get();
        posts.value = data;
      }
    });

    return { posts };
  }
};
```

### Next.js

```javascript
'use client';

import { FlareClient } from '@flarebase/client';
import { useEffect, useState } from 'react';

const db = new FlareClient();

export default function Page() {
  const [data, setData] = useState([]);

  useEffect(() => {
    async function loadData() {
      const result = await db.collection('posts').get();
      setData(result);
    }
    loadData();
  }, []);

  return <div>{/* Render data */}</div>;
}
```

## Error Handling

All async methods throw errors on failure:

```javascript
try {
  await db.login({ email, password });
} catch (error) {
  if (error.message.includes('Invalid credentials')) {
    // Handle login error
  }
}
```

## Storage

The SDK stores JWT tokens in `localStorage`:

- `flarebase_jwt`: The JWT token
- `flarebase_user`: User data (email, name, role)

These are automatically cleared on logout and persist across page reloads.

## Architecture Summary

| Component | Responsibility |
| --- | --- |
| **Flare Server** | Distributed Storage (Sled/Raft), Real-time Pub/Sub, Generic Query. |
| **JS Client** | Data interaction, JWT management, State management, Reactive UI updates. |
| **Hooks/Triggers** | Side-effects, third-party integrations, validation. |

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- IE11: ❌ Not supported (requires ES6+)

## Security Best Practices

1. **Use HTTPS** in production
2. **Store server URL** in environment variables
3. **Never hardcode passwords**
4. **Handle errors gracefully**

## License

MIT License - see LICENSE file for details
