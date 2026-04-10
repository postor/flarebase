# 📚 白名单查询使用示例

## 组件使用示例

### 1. 博客首页 - 显示已发布文章

```typescript
// src/app/page.tsx
'use client';

import { useBlogQueries } from '@/lib/flarebase_whitelist';

export default function HomePage() {
  const { usePublishedPosts } = useBlogQueries();
  const { data: posts, error, isLoading } = usePublishedPosts(10);

  if (isLoading) return <div>Loading posts...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div className="blog-home">
      <h1>Latest Posts</h1>
      {posts?.map((post: PostWithAuthor) => (
        <article key={post.id} className="blog-post">
          <h2>{post.title}</h2>
          <div className="meta">
            <span>By {post.author.name}</span>
            <span>{new Date(post.created_at).toLocaleDateString()}</span>
          </div>
          <p>{post.content.substring(0, 200)}...</p>
          <a href={`/posts/${post.id}`}>Read more</a>
        </article>
      ))}
    </div>
  );
}
```

### 2. 我的文章管理页面

```typescript
// src/app/dashboard/my-posts/page.tsx
'use client';

import { useBlogQueries } from '@/lib/flarebase_whitelist';
import { useAuth } from '@/contexts/AuthContext';

export default function MyPostsPage() {
  const { user } = useAuth();
  const { useMyPosts } = useBlogQueries();
  const { data: posts, error, isLoading, refresh } = useMyPosts(20);

  if (!user) return <div>Please login first</div>;
  if (isLoading) return <div>Loading your posts...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div className="my-posts-dashboard">
      <div className="header">
        <h1>My Posts</h1>
        <a href="/posts/new" className="btn-primary">Create New Post</a>
      </div>

      <div className="posts-grid">
        {posts?.map((post: Post) => (
          <div key={post.id} className="post-card">
            <h3>{post.data.title}</h3>
            <span className="status">{post.data.status}</span>
            <div className="actions">
              <a href={`/posts/${post.id}/edit`}>Edit</a>
              <button onClick={() => deletePost(post.id)}>Delete</button>
            </div>
            <small>Created: {new Date(post.data.created_at).toLocaleDateString()}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 3. 文章详情页面 (包含作者信息)

```typescript
// src/app/posts/[slug]/page.tsx
'use client';

import { useParams } from 'next/navigation';
import { useBlogQueries } from '@/lib/flarebase_whitelist';

export default function PostDetailPage() {
  const params = useParams();
  const { usePostWithAuthor } = useBlogQueries();
  const { data: postData, error, isLoading } = usePostWithAuthor(params.slug as string);

  if (isLoading) return <div>Loading post...</div>;
  if (error) return <div>Post not found</div>;

  const post = postData as PostWithAuthor;

  return (
    <article className="post-detail">
      <h1>{post.title}</h1>

      <div className="author-info">
        <img src={post.author.avatar || '/default-avatar.png'} alt={post.author.name} />
        <div>
          <span className="name">{post.author.name}</span>
          <span className="bio">{post.author.bio}</span>
        </div>
      </div>

      <div className="content">
        {post.content}
      </div>

      <div className="meta">
        <span>Published: {new Date(post.created_at).toLocaleDateString()}</span>
        {post.updated_at && (
          <span>Updated: {new Date(post.updated_at).toLocaleDateString()}</span>
        )}
      </div>

      <CommentsSection postId={post.id} />
    </article>
  );
}
```

### 4. 搜索组件

```typescript
// src/app/search/page.tsx
'use client';

import { useState } from 'react';
import { useBlogQueries } from '@/lib/flarebase_whitelist';

export default function SearchPage() {
  const [keyword, setKeyword] = useState('');
  const { useSearchPosts } = useBlogQueries();
  const { data: posts, isLoading } = useSearchPosts(keyword, 20);

  return (
    <div className="search-page">
      <div className="search-bar">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Search posts..."
        />
        <button>Search</button>
      </div>

      {isLoading ? (
        <div>Searching...</div>
      ) : (
        <div className="search-results">
          <h2>Found {posts?.length || 0} results</h2>
          {posts?.map((post: Post) => (
            <div key={post.id} className="result-item">
              <h3>{post.data.title}</h3>
              <p>{post.data.content.substring(0, 150)}...</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 5. 管理员仪表板

```typescript
// src/app/admin/dashboard/page.tsx
'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useBlogQueries } from '@/lib/flarebase_whitelist';

export default function AdminDashboard() {
  const { user } = useAuth();
  const { useAdminStats, useMyPosts } = useBlogQueries();

  const { data: stats, isLoading: statsLoading } = useAdminStats();
  const { data: recentPosts } = useMyPosts(5);

  if (!user || user.data.role !== 'admin') {
    return <div>Access denied. Admin only.</div>;
  }

  if (statsLoading) return <div>Loading dashboard...</div>;

  return (
    <div className="admin-dashboard">
      <h1>Admin Dashboard</h1>

      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Posts</h3>
          <span className="stat-value">{stats?.total_posts || 0}</span>
        </div>
        <div className="stat-card">
          <h3>Total Users</h3>
          <span className="stat-value">{stats?.total_users || 0}</span>
        </div>
        <div className="stat-card">
          <h3>Total Comments</h3>
          <span className="stat-value">{stats?.total_comments || 0}</span>
        </div>
      </div>

      <div className="recent-activity">
        <h2>Recent Posts</h2>
        {recentPosts?.map((post: Post) => (
          <div key={post.id}>
            {post.data.title} - {post.data.status}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 6. 评论组件

```typescript
// src/components/CommentsSection.tsx
'use client';

import { useState, useEffect } from 'react';
import { useBlogQueries } from '@/lib/flarebase_whitelist';

interface CommentsSectionProps {
  postId: string;
}

export function CommentsSection({ postId }: CommentsSectionProps) {
  const { usePostComments } = useBlogQueries();
  const { data: comments, error, refresh } = usePostComments(postId, 50);

  const [newComment, setNewComment] = useState('');

  const handleSubmitComment = async () => {
    // 使用传统方式创建评论 (白名单主要用于查询)
    const response = await fetch('/api/comments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
      },
      body: JSON.stringify({
        post_id: postId,
        content: newComment
      })
    });

    if (response.ok) {
      setNewComment('');
      refresh(); // 刷新评论列表
    }
  };

  return (
    <div className="comments-section">
      <h3>Comments ({comments?.length || 0})</h3>

      <div className="comment-form">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Write a comment..."
        />
        <button onClick={handleSubmitComment}>Post Comment</button>
      </div>

      <div className="comments-list">
        {comments?.map((comment: Comment) => (
          <div key={comment.id} className="comment">
            <span className="author">User {comment.data.author_id}</span>
            <p>{comment.data.content}</p>
            <small>{new Date(comment.data.created_at).toLocaleString()}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## 迁移指南

### 从现有查询迁移到白名单查询

**之前的代码:**
```typescript
// 不安全的任意查询
const posts = await flarebase
  .collection('posts')
  .query([
    { field: 'status', operator: 'Eq', value: 'published' }
  ]);
```

**迁移后的代码:**
```typescript
// 安全的白名单查询
const posts = await flarebase
  .namedQuery('list_published_posts', { limit: 10 });
```

### Hook 迁移

**之前的代码:**
```typescript
// 不安全的自定义Hook
function usePosts() {
  const [posts, setPosts] = useState([]);
  useEffect(() => {
    flarebase.collection('posts').query().then(setPosts);
  }, []);
  return posts;
}
```

**迁移后的代码:**
```typescript
// 安全的白名单Hook
function usePosts() {
  const { usePublishedPosts } = useBlogQueries();
  const { data: posts } = usePublishedPosts();
  return posts;
}
```

## 安全优势对比

### 之前的安全风险
```typescript
// ❌ 危险: 客户端可以发送任意查询
const allUsers = await flarebase.collection('users').query([]);
const sensitiveData = await flarebase
  .collection('users')
  .query([{ field: 'role', operator: 'Eq', value: 'admin' }]);
```

### 白名单系统的保护
```typescript
// ✅ 安全: 只能执行预定义的查询
const publishedPosts = await flarebase
  .namedQuery('list_published_posts', { limit: 10 });
// 这确保了:
// 1. 只能获取已发布的文章
// 2. 数量限制在10条
// 3. 无法访问其他用户的数据
```

## 错误处理示例

```typescript
async function loadPostWithAuthor(postId: string) {
  try {
    const client = createWhitelistClient(
      'http://localhost:3000',
      () => ({ 'Authorization': `Bearer ${getToken()}` })
    );

    const post = await client.blogQueries.getPostWithAuthor(postId);
    return post;
  } catch (error) {
    if (error.message.includes('Query not found in whitelist')) {
      console.error('查询不在白名单中');
    } else if (error.message.includes('Permission denied')) {
      console.error('权限不足');
    } else if (error.message.includes('Authentication required')) {
      console.error('需要登录');
    } else {
      console.error('未知错误:', error.message);
    }
    throw error;
  }
}
```

## 测试示例

```typescript
// 测试白名单查询
describe('Whitelist Queries', () => {
  test('should return published posts', async () => {
    const posts = await client.blogQueries.getPublishedPosts(10);
    expect(posts).toBeDefined();
    expect(posts.length).toBeLessThanOrEqual(10);
  });

  test('should enforce user isolation', async () => {
    const user1Posts = await client.blogQueries.getMyPosts(10);
    // 用户只能看到自己的文章
    expect(user1Posts.every(post => post.data.author_id === 'user-1')).toBe(true);
  });

  test('should reject invalid query names', async () => {
    await expect(
      client.namedQuery('nonexistent_query', {})
    ).rejects.toThrow('Query not found in whitelist');
  });
});
```

这个实施指南展示了如何在博客平台中安全地使用白名单查询，既保护了数据安全，又保持了良好的开发体验！