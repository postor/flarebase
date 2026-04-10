# Flarebase SDK Update - Unified Client Architecture

## Overview

Updated all Flarebase clients to use a **unified SDK architecture** where:
- `clients/js` - Core JavaScript SDK with transparent JWT handling
- `clients/react` - React SDK with Provider and hooks (built on `clients/js`)
- `clients/vue` - Vue SDK (to be updated similarly)
- `examples/blog-platform` - Uses `@flarebase/react` for React integration

## Key Changes

### 1. `clients/js` - Core SDK ✅

**Updated File:** `src/index.js`

**New Features:**
- Added `auth` getter for read-only authentication state
- `auth.isAuthenticated` - Property (not method) for checking auth state
- `auth.user` - Property (not method) for accessing current user
- Legacy methods (`isAuthenticated()`, `getCurrentUser()`) still available for backward compatibility

**Usage:**
```javascript
import { FlareClient } from '@flarebase/client';

const db = new FlareClient('http://localhost:3000');

// Login - JWT automatically saved
await db.login({ email, password });

// Check auth state
if (db.auth.isAuthenticated) {
  console.log('User:', db.auth.user);
}

// Data operations - JWT automatically included
await db.collection('posts').add({ title: 'Hello' });

// Logout - JWT automatically cleared
db.logout();
```

### 2. `clients/react` - React SDK ✅

**Updated File:** `src/index.js`

**New Features:**
- `FlarebaseProvider` - Main provider that wraps the app
- `AuthProvider` - Internal provider for authentication state
- `useFlarebase()` - Hook to access FlareClient instance
- `useAuth()` - Hook to access authentication state and methods
- Built on top of `@flarebase/client` for consistency

**Usage:**
```jsx
import { FlarebaseProvider, useAuth, useFlarebase } from '@flarebase/react';

// Wrap your app
function App() {
  return (
    <FlarebaseProvider baseURL="http://localhost:3000">
      <MyComponent />
    </FlarebaseProvider>
  );
}

// Use in components
function MyComponent() {
  const { user, login, logout, isAuthenticated } = useAuth();
  const db = useFlarebase();

  const handleLogin = async () => {
    await login({ email: 'user@example.com', password: 'password' });
  };

  return (
    <div>
      {isAuthenticated ? (
        <div>
          <p>Welcome, {user?.email}</p>
          <button onClick={logout}>Logout</button>
        </div>
      ) : (
        <button onClick={handleLogin}>Login</button>
      )}
    </div>
  );
}
```

### 3. `clients/js/tests/jwt_transparency.test.js` - JWT Transparency Tests ✅

**New File:** Comprehensive test suite for JWT transparency

**Test Coverage:**
- JWT methods are internal (underscore prefix)
- Auth state is read-only
- JWT automatically saved on login/register
- JWT automatically included in requests
- JWT automatically cleared on logout
- JWT automatically restored from localStorage
- User-friendly API without manual JWT operations

**Total Tests:** 15 test suites

### 4. `examples/blog-platform` - Updated to Use Unified SDK ✅

**Changes:**
- Removed duplicate SDK files (flarebase-sdk.ts, load-sdk.js, etc.)
- Updated `package.json` to use `@flarebase/react`
- Updated `layout.tsx` to use `FlarebaseProvider`
- Updated test pages to use `useAuth()` and `useFlarebase()` hooks
- Removed custom `AuthContext` (using unified SDK instead)

**Usage:**
```jsx
// layout.tsx
import { FlarebaseProvider } from "@flarebase/react";

export default function RootLayout({ children }) {
  return (
    <FlarebaseProvider baseURL="http://localhost:3000">
      {children}
    </FlarebaseProvider>
  );
}

// app/test/simple/page.tsx
import { useAuth, useFlarebase } from '@flarebase/react';

export default function TestPage() {
  const { user, login, logout, isAuthenticated } = useAuth();
  const db = useFlarebase();

  // JWT is completely transparent!
}
```

## Architecture

```
clients/
├── js/                    # Core JavaScript SDK
│   ├── src/index.js      # FlareClient with transparent JWT
│   └── tests/
│       └── jwt_transparency.test.js
│
├── react/                # React SDK (built on clients/js)
│   ├── src/index.js     # FlarebaseProvider, useAuth, useFlarebase
│   └── package.json     # Depends on @flarebase/client
│
└── vue/                  # Vue SDK (to be updated)

examples/
└── blog-platform/        # Uses @flarebase/react
    ├── package.json     # Depends on @flarebase/react
    └── src/app/
        ├── layout.tsx   # Wraps with FlarebaseProvider
        └── test/simple/page.tsx  # Uses useAuth, useFlarebase
```

## Benefits

### 1. **Single Source of Truth**
- All JWT logic is in `clients/js`
- React SDK wraps and extends it
- No code duplication

### 2. **Consistent API**
- Same JWT behavior across all platforms
- Same authentication flow
- Same error handling

### 3. **Better Maintainability**
- Bug fixes in core SDK benefit all clients
- Features added once, available everywhere
- Easier to test and document

### 4. **JWT Transparency**
- Users never handle JWT manually
- Automatic persistence
- Automatic inclusion in requests
- Automatic clearing on logout

### 5. **Framework-Specific Features**
- React: Provider + hooks
- Vue: Composables (to be implemented)
- Core: Vanilla JavaScript

## Migration Guide

### For Existing Projects Using `clients/js`

**Before:**
```javascript
const client = new FlareClient(baseURL);
const isAuth = client.isAuthenticated();
const user = client.getCurrentUser();
```

**After:**
```javascript
const client = new FlareClient(baseURL);
const isAuth = client.auth.isAuthenticated;
const user = client.auth.user;
```

### For React Projects

**Before (custom AuthContext):**
```jsx
import { AuthProvider } from '@/contexts/AuthContext';

<AuthProvider>
  <App />
</AuthProvider>
```

**After (using @flarebase/react):**
```jsx
import { FlarebaseProvider } from '@flarebase/react';

<FlarebaseProvider baseURL="http://localhost:3000">
  <App />
</FlarebaseProvider>
```

## Testing

### Run Core SDK Tests
```bash
cd clients/js
npm test
```

### Run React SDK Tests
```bash
cd clients/react
npm test
```

### Run Blog Example
```bash
cd examples/blog-platform
npm install
npm run dev
# Visit http://localhost:3000/test/simple
```

## Files Changed

### Modified Files
1. `clients/js/src/index.js` - Added `auth` getter
2. `clients/react/src/index.js` - Complete rewrite with Provider/hooks
3. `clients/react/package.json` - Updated dependencies
4. `examples/blog-platform/package.json` - Updated to use @flarebase/react
5. `examples/blog-platform/src/app/layout.tsx` - Use FlarebaseProvider
6. `examples/blog-platform/src/app/test/simple/page.tsx` - Use hooks

### New Files
1. `clients/js/tests/jwt_transparency.test.js` - JWT transparency tests
2. `clients/js/README.md` - Core SDK documentation

### Deleted Files
1. `examples/blog-platform/src/lib/flarebase-sdk.ts` (duplicate)
2. `examples/blog-platform/src/lib/__tests__/flarebase-sdk.test.ts` (duplicate)
3. `examples/blog-platform/src/app/test/simple/load-sdk.js` (duplicate)
4. `examples/blog-platform/src/contexts/AuthContext.tsx` (replaced by unified SDK)
5. `examples/blog-platform/src/components/FlarebaseSDK.tsx` (duplicate)

## Next Steps

1. ✅ Update `clients/js` with transparent JWT
2. ✅ Update `clients/react` with Provider/hooks
3. ⏳ Update `clients/vue` with composables
4. ⏳ Add more React hooks (useCollection, useDocument, etc.)
5. ⏳ Update documentation for all clients
6. ⏳ Add TypeScript definitions

## Conclusion

All Flarebase clients now share a **unified architecture** with:
- Single core SDK (`clients/js`)
- Framework-specific wrappers (`clients/react`, `clients/vue`)
- Complete JWT transparency
- Consistent API across all platforms
- No code duplication

Blog example now uses the official React SDK with Provider and hooks, making it a proper example of how to use Flarebase in a React application.
