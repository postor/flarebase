# Flarebase Blog Platform

A real-time blog platform built with Next.js 14 and powered by [Flarebase](https://github.com/your-org/flarebase) - a distributed document database with TypeScript SDKs.

## Features

- 🔐 **JWT Authentication** - Secure login/register with Flarebase JWT integration
- 📝 **Article Management** - Create, edit, and publish blog posts
- 🔄 **Real-time Updates** - Live data synchronization via Socket.IO
- 🎯 **Type-Safe** - Built with TypeScript SDK v0.2.0
- 📊 **SWR Integration** - Efficient data fetching with stale-while-revalidate
- 🔒 **Whitelist Queries** - Secure server-side query validation

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript
- **Database**: Flarebase (Distributed Document Database)
- **Real-time**: Socket.IO
- **Data Fetching**: SWR
- **Styling**: Tailwind CSS

## Prerequisites

Before running this blog platform, ensure you have:

1. **Flarebase Server** running on `http://localhost:3000`
   ```bash
   # From the flarebase root directory
   cargo run -p flare-server
   ```

2. **Named Queries** configured in `named_queries.json`:
   ```json
   {
     "check_email_exists": "SELECT * FROM users WHERE email = {{email}} LIMIT 1",
     "get_user_by_email": "SELECT * FROM users WHERE email = {{email}} LIMIT 1",
     "get_published_posts": "SELECT * FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT {{limit}} OFFSET {{offset}}",
     "get_post_by_slug": "SELECT * FROM posts WHERE slug = {{slug}} LIMIT 1",
     "get_posts_by_author": "SELECT * FROM posts WHERE author_id = {{author_id}} ORDER BY created_at DESC LIMIT {{limit}} OFFSET {{offset}}"
   }
   ```

## Quick Start

### 1. Install Dependencies

```bash
cd examples/blog-platform
npm install
```

### 2. Configure Environment

Create `.env.local`:
```bash
NEXT_PUBLIC_FLAREBASE_URL=http://localhost:3000
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

## Project Structure

```
blog-platform/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── auth/              # Authentication pages
│   │   │   ├── login/
│   │   │   └── register/
│   │   ├── posts/             # Blog post pages
│   │   │   ├── [slug]/        # Individual post view
│   │   │   └── new/           # Create new post
│   │   ├── test/              # Testing pages
│   │   ├── layout.tsx         # Root layout with providers
│   │   └── page.tsx           # Home page
│   ├── contexts/              # React Context providers
│   │   └── AuthContext.tsx    # Authentication context
│   ├── hooks/                 # Custom React hooks
│   │   └── useRealtimeUpdates.ts
│   ├── lib/                   # Core library code
│   │   ├── flarebase.ts       # Flarebase client wrapper
│   │   └── swr-hooks.ts      # SWR integration hooks
│   └── types/                 # TypeScript type definitions
│       └── index.ts
├── public/                    # Static assets
└── package.json
```

## Usage Examples

### Authentication

```typescript
import { useAuth } from '@/contexts/AuthContext';

function LoginPage() {
  const { login, register } = useAuth();

  const handleLogin = async () => {
    await login('user@example.com', 'password');
  };
}
```

### Data Fetching with SWR

```typescript
import { useArticles, useAuth } from '@/lib/swr-hooks';

function HomePage() {
  const { data: articles, error, isLoading } = useArticles();
  const { user, logout } = useAuth();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {articles?.map(article => (
        <article key={article.id}>{article.data.title}</article>
      ))}
    </div>
  );
}
```

### Named Queries (Secure Whitelist)

```typescript
import { getFlarebaseClient } from '@/lib/flarebase';

const flarebase = getFlarebaseClient();

// Secure query - validated server-side
const posts = await flarebase.blogQueries.getPublishedPosts(20, 0);
const user = await flarebase.blogQueries.getUserByEmail('user@example.com');
```

### Real-time Updates

```typescript
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';

function PostList() {
  const { posts, subscribe } = useRealtimeUpdates();

  useEffect(() => {
    const unsubscribe = subscribe('posts', (updatedPost) => {
      console.log('Post updated:', updatedPost);
    });

    return unsubscribe;
  }, []);

  return <div>{/* render posts */}</div>;
}
```

## API Reference

### Flarebase Client Methods

| Method | Description |
|--------|-------------|
| `login(email, password)` | Authenticate user |
| `register(userData)` | Create new account |
| `logout()` | End session |
| `collection(name)` | Access collection |
| `namedQuery(name, params)` | Execute whitelisted query |

### Blog Query Methods

| Method | Description |
|--------|-------------|
| `checkEmailExists(email)` | Check if email is taken |
| `getUserByEmail(email)` | Get user by email |
| `getPublishedPosts(limit, offset)` | Get public posts |
| `getPostBySlug(slug)` | Get post by URL slug |
| `getPostsByAuthor(id, limit, offset)` | Get user's posts |

## Testing

### Run TypeScript Build

```bash
npm run build
```

### Run Linter

```bash
npm run lint
```

### Run Unit Tests

```bash
npm test
```

## Deployment

### Production Build

```bash
npm run build
npm start
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_FLAREBASE_URL` | Flarebase server URL | `http://localhost:3000` |

## Troubleshooting

### Connection Refused

Ensure Flarebase server is running:
```bash
cargo run -p flare-server
```

### Named Query Not Found

Verify `named_queries.json` exists and is properly configured:
```bash
cat named_queries.json
```

### JWT Authentication Issues

Clear localStorage and re-login:
```javascript
localStorage.clear();
location.reload();
```

## Contributing

Contributions welcome! Please read our [Contributing Guide](../../CONTRIBUTING.md).

## License

MIT License - see [LICENSE](../../LICENSE) for details.

## Links

- [Flarebase Documentation](../../docs/README.md)
- [TypeScript SDK](../../clients/js/README.md)
- [React SDK](../../clients/react/README.md)
- [Architecture Overview](../../docs/core/ARCHITECTURE.md)
