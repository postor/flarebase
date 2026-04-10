'use client';

import React, { useState, useEffect } from 'react';
import { getFlarebaseClient } from '@/lib/flarebase';
import { useCollectionUpdates } from '@/hooks/useRealtimeUpdates';
import type { Post } from '@/types';

export default function RealtimeTestPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPostTitle, setNewPostTitle] = useState('');
  const [newPostContent, setNewPostContent] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [events, setEvents] = useState<any[]>([]);

  const fetchPosts = async () => {
    try {
      const flarebase = getFlarebaseClient();
      // ✅ 使用安全的白名单查询获取所有文章（仅用于测试页面）
      const allPosts = await flarebase.blogQueries.getPublishedPosts(100, 0);
      setPosts(allPosts);
    } catch (error) {
      console.error('Error fetching posts:', error);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, []);

  // Listen for real-time updates on posts collection
  useCollectionUpdates('posts', {
    onCreated: (doc) => {
      console.log('Real-time: Document created', doc);
      addEvent('created', doc);
      fetchPosts(); // Refresh posts when new one is created
    },
    onUpdated: (doc) => {
      console.log('Real-time: Document updated', doc);
      addEvent('updated', doc);
      fetchPosts(); // Refresh posts when one is updated
    },
    onDeleted: (payload) => {
      console.log('Real-time: Document deleted', payload);
      addEvent('deleted', payload);
      fetchPosts(); // Refresh posts when one is deleted
    }
  });

  const addEvent = (type: string, data: any) => {
    const timestamp = new Date().toLocaleTimeString();
    setEvents(prev => [{ type, data, timestamp }, ...prev].slice(0, 10));
  };

  const handleCreatePost = async () => {
    if (!newPostTitle || !newPostContent) return;

    try {
      const flarebase = getFlarebaseClient();
      await flarebase.collection('posts').add({
        title: newPostTitle,
        slug: newPostTitle.toLowerCase().replace(/\s+/g, '-'),
        content: newPostContent,
        author_id: 'test-user',
        author_name: 'Test User',
        author_email: 'test@example.com',
        status: 'published',
        published_at: Date.now(),
        created_at: Date.now(),
        updated_at: Date.now(),
        tags: ['realtime', 'test']
      });

      setNewPostTitle('');
      setNewPostContent('');
    } catch (error) {
      console.error('Error creating post:', error);
    }
  };

  const handleDeletePost = async (postId: string) => {
    try {
      const flarebase = getFlarebaseClient();
      await flarebase.collection('posts').doc(postId).delete();
      addEvent('deleted', { id: postId });
    } catch (error) {
      console.error('Error deleting post:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Real-time Updates Test</h1>

        {/* Connection Status */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Connection Status</h2>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-gray-700 capitalize">{connectionStatus}</span>
          </div>
        </div>

        {/* Create Post Form */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Create Test Post</h2>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Post title"
              value={newPostTitle}
              onChange={(e) => setNewPostTitle(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              placeholder="Post content"
              value={newPostContent}
              onChange={(e) => setNewPostContent(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleCreatePost}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Create Post (Triggers Real-time Update)
            </button>
          </div>
        </div>

        {/* Real-time Events Log */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Real-time Events</h2>
          {events.length === 0 ? (
            <p className="text-gray-500">No events yet. Create or modify a post to see real-time updates!</p>
          ) : (
            <div className="space-y-2">
              {events.map((event, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded border-l-4 border-blue-600">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-semibold text-blue-600 uppercase">{event.type}</span>
                      <pre className="mt-2 text-xs bg-white p-2 rounded overflow-auto max-h-32">
                        {JSON.stringify(event.data, null, 2)}
                      </pre>
                    </div>
                    <span className="text-xs text-gray-500">{event.timestamp}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Posts List */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Current Posts ({posts.length})</h2>
          {posts.length === 0 ? (
            <p className="text-gray-500">No posts yet. Create one above!</p>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <div key={post.id} className="p-4 border border-gray-200 rounded-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-gray-900">{post.data.title}</h3>
                      <p className="text-sm text-gray-600 mt-1">{post.data.content.substring(0, 100)}...</p>
                      <p className="text-xs text-gray-500 mt-2">Status: {post.data.status}</p>
                    </div>
                    <button
                      onClick={() => handleDeletePost(post.id)}
                      className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 text-center">
          <a
            href="/"
            className="text-blue-600 hover:text-blue-700"
          >
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}