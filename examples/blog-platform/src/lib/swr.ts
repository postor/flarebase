// SWR配置和自定义Hooks
import useSWR, { useSWRConfig } from 'swr';
import useSWRInfinite from 'swr/infinite';
import { mutate } from 'swr';
import { getFlarebaseClient } from './flarebase';
import type { User, Post, Comment, Like } from '../types';

const flarebase = getFlarebaseClient();

// SWR配置
export const swrConfig: useSWRConfig = {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 1000,
  errorRetryCount: 3,
  fetcher: async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  }
};

// 通用SWR Hook
export function useFlarebase<T>(key: string, fetcher: () => Promise<T>) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(key, fetcher);

  return {
    data,
    error,
    isLoading,
    isValidating,
    mutate
  };
}

// ===== 用户相关 Hooks =====

export function useUser(userId?: string) {
  const shouldFetch = userId !== undefined;
  const key = shouldFetch ? `/api/users/${userId}` : null;

  return useFlarebase<User | null>(key, async () => {
    if (!shouldFetch) return null;
    const user = await flarebase.doc('users', userId!).get();
    return user;
  });
}

export function useCurrentUser() {
  // 从session获取当前用户（这里简化处理）
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);

  const fetcher = async () => {
    // 调用API获取当前用户session
    const response = await fetch('/api/auth/me');
    if (response.ok) {
      const data = await response.json();
      return data.user;
    }
    return null;
  };

  return useFlarebase<User | null>('/api/auth/me', fetcher);
}

export function useUsers() {
  return useFlarebase<User[]>('/api/users', async () => {
    return await flarebase.collection('users').getAll<User>();
  });
}

// ===== 文章相关 Hooks =====

export function usePost(slug?: string) {
  const shouldFetch = slug !== undefined;
  const key = shouldFetch ? `/api/posts/${slug}` : null;

  return useFlarebase<Post | null>(key, async () => {
    if (!shouldFetch) return null;
    const posts = await flarebase.query<Post>([['slug', { Eq: slug }]]);
    return posts[0] || null;
  });
}

export function usePosts(filters: any[] = []) {
  const key = `/api/posts?filters=${JSON.stringify(filters)}`;

  return useFlarebase<Post[]>(key, async () => {
    return await flarebase.query<Post>(filters);
  });
}

export function usePublishedPosts() {
  return useFlarebase<Post[]>('/api/posts/published', async () => {
    return await flarebase.query<Post>([
      ['status', { Eq: 'published' }]
    ]);
  });
}

export function usePostsByAuthor(authorId: string) {
  return useFlarebase<Post[]>(`/api/posts?author=${authorId}`, async () => {
    return await flarebase.query<Post>([
      ['author_id', { Eq: authorId }],
      ['status', { Eq: 'published' }]
    ]);
  });
}

// 分页文章列表（无限滚动）
export function usePostsInfinite(filters: any[] = [], limit = 10) {
  const [offset, setOffset] = React.useState(0);

  const getKey = (pageIndex: number, previousPageData: Post[] | null) => {
    if (pageIndex === 0) return '/api/posts';

    if (!previousPageData) return null;

    // 当没有更多数据时返回null
    if (previousPageData.length < limit) {
      return null;
    }

    const newOffset = pageIndex * limit;
    return `/api/posts?offset=${newOffset}&limit=${limit}&filters=${JSON.stringify(filters)}`;
  };

  const { data, error, isLoading, size, setSize } = useSWRInfinite<Post>(
    getKey,
    getFlarebaseClient()
  );

  const flattenedData = data?.flat() || [];

  // 检查是否还有更多数据
  const hasMore = data && data[data.length - 1]?.length >= limit;

  const loadMore = () => {
    if (!isLoading && hasMore) {
      setSize(size + 1);
    }
  };

  return {
    data: flattenedData,
    error,
    isLoading,
    size,
    setSize,
    hasMore,
    loadMore
  };
}

// ===== 评论相关 Hooks =====

export function useComments(postId: string) {
  return useFlarebase<Comment[]>(`/api/posts/${postId}/comments`, async () => {
    return await flarebase.query<Comment>([
      ['post_id', { Eq: postId }],
      ['status', { Eq: 'approved' }]
    ]);
  });
}

// ===== 统计相关 Hooks =====

export function usePostStats(postId: string) {
  return useFlarebase<{ likes: number; comments: number }>(
    `/api/posts/${postId}/stats`,
    async () => {
      const response = await fetch(`/api/posts/${postId}/stats`);
      return response.json();
    }
  );
}

// ===== 预取函数 =====

export async function prefetchPost(slug: string) {
  mutate(`/api/posts/${slug}`);
}

export async function prefetchUserPosts(authorId: string) {
  mutate(`/api/posts?author=${authorId}`);
}

// ===== 全局 mutate 函数 =====

export async function updatePost(postId: string, updates: Partial<Post>) {
  return mutate(`/api/posts/${postId}`, async (currentPost: Post) => {
    const response = await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    return response.json();
  });
}

export async function deletePost(postId: string) {
  return mutate(`/api/posts/${postId}`, async () => {
    const response = await fetch(`/api/posts/${postId}`, {
      method: 'DELETE'
    });
    return response.ok;
  });
}
