# JWT Authentication and SWR Integration

This guide demonstrates how to use JWT authentication and SWR (stale-while-revalidate) in the Flarebase blog platform example.

## 📁 Files

- `src/lib/flarebase-jwt.ts` - Flarebase client with JWT support
- `src/lib/swr-hooks.ts` - SWR hooks for data fetching
- `src/app/auth/page.tsx` - Login/Register page
- `src/app/articles/page.tsx` - Article list with JWT auth

## 🔑 JWT Authentication

### 1. Login

```typescript
import { useAuth } from '@/lib/swr-hooks';

function LoginPage() {
  const { login, isAuthenticated, user } = useAuth();

  const handleLogin = async () => {
    try {
      await login('user@example.com', 'password');
      // JWT is automatically stored and used in subsequent requests
      console.log('Logged in as:', user.email);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };
}
```

### 2. Register

```typescript
const { register } = useAuth();

const handleRegister = async () => {
  try {
    await register({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'secure_password'
    });
    console.log('Registered successfully!');
  } catch (error) {
    console.error('Registration failed:', error);
  }
};
```

### 3. Check Authentication Status

```typescript
const { isAuthenticated, user } = useAuth();

if (isAuthenticated) {
  console.log('Current user:', user);
}
```

### 4. Logout

```typescript
const { logout } = useAuth();

const handleLogout = () => {
  logout();
  // JWT and user info are cleared
};
```

## 📡 SWR Integration

### 1. Basic Query Hook

```typescript
import { useNamedQuery } from '@/lib/swr-hooks';

function ArticleList() {
  const { data, error, isLoading } = useNamedQuery<any[]>(
    'list_published_articles'
  );

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!data) return <div>No articles</div>;

  return (
    <ul>
      {data.map(article => (
        <li key={article.id}>{article.title}</li>
      ))}
    </ul>
  );
}
```

### 2. Authenticated Query

```typescript
import { useMyArticles } from '@/lib/swr-hooks';

function MyArticles() {
  // This query automatically includes JWT in the request
  const { data, error } = useMyArticles();

  // JWT is automatically added to Authorization header
  // Server validates JWT and returns user's articles
}
```

### 3. Conditional Query

```typescript
import { useConditionalQuery } from '@/lib/swr-hooks';

function ConditionalArticles({ showAll }: { showAll: boolean }) {
  const { data } = useConditionalQuery(
    showAll,
    'list_all_articles',  // Only fetches if showAll is true
    {}
  );
}
```

### 4. Single Resource

```typescript
import { useArticle } from '@/lib/swr-hooks';

function ArticleDetail({ id }: { id: string }) {
  const { data: article, isLoading } = useArticle(id);

  if (isLoading) return <div>Loading article...</div>;
  if (!article) return <div>Article not found</div>;

  return (
    <article>
      <h1>{article.title}</h1>
      <p>{article.content}</p>
    </article>
  );
}
```

## 🔒 Protected Routes

### Client-Side Protection

```typescript
import { useAuth } from '@/lib/swr-hooks';

export default function ProtectedPage() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <div>Please <a href="/auth">login</a> first</div>;
  }

  // Render protected content
  return <div>Secret content</div>;
}
```

### Middleware Protection (Recommended)

Create `middleware.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const jwt = request.cookies.get('flarebase_jwt')?.value;

  if (!jwt && request.nextUrl.pathname.startsWith('/articles')) {
    return NextResponse.redirect(new URL('/auth', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/articles/:path*'],
};
```

## 🌐 HTTP REST vs WebSocket

### HTTP REST (with JWT) - Used by SWR

```typescript
const client = getFlarebaseClient();

// JWT is automatically included in Authorization header
const data = await client.namedQueryREST('list_my_posts', {});

// HTTP request:
// POST /queries/list_my_posts
// Headers: {
//   "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
//   "Content-Type": "application/json"
// }
```

### WebSocket - Used for real-time updates

```typescript
const client = getFlarebaseClient();

// Real-time subscriptions (no JWT needed for WebSocket)
const collection = client.collection('posts');

collection.onSnapshot((change) => {
  console.log('Document changed:', change);
});
```

## 📊 Named Queries

Server-side configuration (in Flarebase server):

```json
{
  "queries": {
    "list_published_articles": {
      "type": "simple",
      "collection": "posts",
      "filters": [
        ["status", {"Eq": "published"}]
      ]
    },
    "list_my_articles": {
      "type": "simple",
      "collection": "posts",
      "filters": [
        ["author_id", {"Eq": "$USER_ID"}]
      ]
    }
  }
}
```

Client-side usage:

```typescript
// Get published articles (no auth required)
const { data: published } = useNamedQuery('list_published_articles');

// Get my articles (auth required, $USER_ID injected from JWT)
const { data: myArticles } = useNamedQuery('list_my_articles');
```

## 🧪 Testing

### 1. Start Flarebase Server

```bash
cd packages/flare-server
cargo run
```

### 2. Start Next.js Dev Server

```bash
cd examples/blog-platform
npm run dev
```

### 3. Test Authentication Flow

1. Navigate to `http://localhost:3000/auth`
2. Register a new account
3. Verify JWT is stored in localStorage:
   ```javascript
   localStorage.getItem('flarebase_jwt')
   localStorage.getItem('flarebase_user')
   ```
4. Navigate to `http://localhost:3000/articles`
5. Verify articles are loaded with JWT authentication
6. Check browser Network tab for Authorization header

## 🔑 JWT Token Structure

```json
{
  "sub": "user_123",
  "email": "user@example.com",
  "role": "user",
  "iat": 1234567890,
  "exp": 1234571490
}
```

## 🛡️ Security Best Practices

1. ✅ **JWT is stored in localStorage** (for demo purposes)
   - In production, use httpOnly cookies
   - Implement token refresh mechanism

2. ✅ **JWT is sent via Authorization header**
   - Never send JWT in URL parameters
   - Always use HTTPS in production

3. ✅ **JWT expires after 1 hour**
   - Implement refresh token logic
   - Handle token expiration gracefully

4. ✅ **Server validates JWT on every request**
   - Protected endpoints reject invalid tokens
   - User context is extracted from JWT

## 📚 Additional Resources

- [JWT Auth Design](../../docs/security/JWT_AUTH_DESIGN.md)
- [SWR Documentation](https://swr.vercel.app/)
- [Next.js App Router](https://nextjs.org/docs/app)
