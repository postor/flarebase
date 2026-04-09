// 数据类型定义

export interface User {
  id: string;
  data: {
    email: string;
    name: string;
    avatar?: string;
    bio?: string;
    role: 'admin' | 'author' | 'reader';
    status: 'active' | 'inactive';
    created_at: number;
    updated_at?: number;
  };
}

export interface Post {
  id: string;
  data: {
    title: string;
    slug: string;
    content: string;
    excerpt?: string;
    cover_image?: string;
    author_id: string;
    author_name?: string;
    author_email?: string;
    status: 'draft' | 'published' | 'archived';
    published_at?: number;
    created_at: number;
    updated_at?: number;
    tags?: string[];
  };
}

export interface Comment {
  id: string;
  data: {
    post_id: string;
    author_id: string;
    author_name: string;
    author_email: string;
    content: string;
    parent_id?: string;
    status: 'pending' | 'approved' | 'spam';
    created_at: number;
    updated_at?: number;
  };
}

export interface Like {
  id: string;
  data: {
    post_id: string;
    user_id: string;
    created_at: number;
  };
}

// SWR返回类型
export interface SWRResponse<T> {
  data: T;
  error?: Error;
  isLoading: boolean;
  isValidating: boolean;
  mutate: (data?: T | Promise<T> | ((data?: T) => Promise<T>)) => void;
  refetch: () => void;
}

export interface PaginatedResponse<T> {
  data: T[];
  error?: Error;
  isLoading: boolean;
  isValidating: boolean;
  mutate: (data?: T[] | Promise<T[]> | ((data?: T[]) => Promise<T[]>)) => void;
  refetch: () => void;
}
