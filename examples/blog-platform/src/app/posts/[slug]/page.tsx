'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getFlarebaseClient } from '@/lib/flarebase';
import type { Post } from '@/types';

export default function PostPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPost = async () => {
      if (!slug) return;

      try {
        const flarebase = getFlarebaseClient();
        // ✅ 使用安全的白名单查询
        const posts: any = await flarebase.blogQueries.getPostBySlug(slug);

        if (posts.length === 0) {
          setError('Post not found');
          return;
        }

        setPost(posts[0]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch post');
      } finally {
        setLoading(false);
      }
    };

    fetchPost();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading post...</p>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || 'Post not found'}</p>
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            Back to Home
          </Link>
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
            <nav className="flex gap-4">
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
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <article className="bg-white rounded-lg shadow-md overflow-hidden">
          {post.data.cover_image && (
            <img
              src={post.data.cover_image}
              alt={post.data.title}
              className="w-full h-64 object-cover"
            />
          )}

          <div className="p-8">
            <div className="mb-6">
              <h1 className="text-4xl font-bold text-gray-900 mb-4">
                {post.data.title}
              </h1>

              <div className="flex items-center gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold">
                    {post.data.author_name?.[0] || 'A'}
                  </div>
                  <span>{post.data.author_name || 'Anonymous'}</span>
                </div>
                <span>•</span>
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
                      className="px-3 py-1 bg-blue-100 text-blue-700 text-sm rounded"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {post.data.excerpt && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg border-l-4 border-blue-600">
                <p className="text-gray-700 italic">{post.data.excerpt}</p>
              </div>
            )}

            <div className="prose max-w-none">
              <div className="whitespace-pre-wrap text-gray-800 leading-relaxed">
                {post.data.content}
              </div>
            </div>

            <div className="mt-8 pt-6 border-t flex justify-between items-center">
              <Link
                href="/"
                className="text-blue-600 hover:text-blue-700 transition"
              >
                ← Back to Home
              </Link>
              {post.data.status === 'draft' && (
                <span className="px-3 py-1 bg-yellow-100 text-yellow-700 text-sm rounded">
                  Draft
                </span>
              )}
            </div>
          </div>
        </article>

        {/* Comments Section */}
        <section className="mt-8">
          <div className="bg-white rounded-lg shadow-md p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Comments</h2>
            <p className="text-gray-600">
              Comments feature coming soon! This will use real-time updates via Socket.IO.
            </p>
          </div>
        </section>
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