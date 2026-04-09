'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getFlarebaseClient } from '@/lib/flarebase';
import { useAuth } from '@/contexts/AuthContext';
import type { Post } from '@/types';

interface PostWithAuthor extends Post {
  author_name?: string;
  author_email?: string;
}

export default function HomePage() {
  const { user, logout } = useAuth();
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        const flarebase = getFlarebaseClient();
        const publishedPosts = await flarebase.query<PostWithAuthor>([
          ['status', { Eq: 'published' }]
        ]);

        // Sort by published_at date (newest first)
        const sortedPosts = publishedPosts.sort((a, b) => {
          const aTime = a.data.published_at || 0;
          const bTime = b.data.published_at || 0;
          return bTime - aTime;
        });

        setPosts(sortedPosts);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch posts');
      } finally {
        setLoading(false);
      }
    };

    fetchPosts();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading posts...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">Error: {error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Blog Platform</h1>
            <nav className="flex gap-4 items-center">
              <Link
                href="/"
                className="text-gray-700 hover:text-blue-600 transition"
              >
                Home
              </Link>
              <Link
                href="/posts/new"
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
              >
                New Post
              </Link>
              {user ? (
                <div className="flex items-center gap-4">
                  <span className="text-gray-700">
                    Welcome, {user.data.name}
                  </span>
                  <button
                    onClick={logout}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
                  >
                    Logout
                  </button>
                </div>
              ) : (
                <div className="flex gap-4">
                  <Link
                    href="/auth/login"
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
                  >
                    Login
                  </Link>
                  <Link
                    href="/auth/register"
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                  >
                    Register
                  </Link>
                </div>
              )}
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {posts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 text-lg">No posts published yet.</p>
            <Link
              href="/posts/new"
              className="inline-block mt-4 px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
            >
              Create the first post
            </Link>
          </div>
        ) : (
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <article
                key={post.id}
                className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition"
              >
                {post.data.cover_image && (
                  <img
                    src={post.data.cover_image}
                    alt={post.data.title}
                    className="w-full h-48 object-cover"
                  />
                )}
                <div className="p-6">
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    <Link
                      href={`/posts/${post.data.slug}`}
                      className="hover:text-blue-600 transition"
                    >
                      {post.data.title}
                    </Link>
                  </h2>
                  {post.data.excerpt && (
                    <p className="text-gray-600 mb-4 line-clamp-3">
                      {post.data.excerpt}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>{post.data.author_name || 'Anonymous'}</span>
                    <time>
                      {post.data.published_at
                        ? new Date(post.data.published_at).toLocaleDateString()
                        : 'Draft'}
                    </time>
                  </div>
                  {post.data.tags && post.data.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {post.data.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-gray-600">
            © {new Date().getFullYear()} Blog Platform. Powered by Flarebase.
          </p>
        </div>
      </footer>
    </div>
  );
}