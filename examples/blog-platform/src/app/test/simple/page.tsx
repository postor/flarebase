// Blog Platform Test Page - Using @flarebase/react SDK
'use client';

import React, { useState, useEffect } from 'react';
import { useFlarebase } from '@flarebase/react';
import { useAuth } from '@/contexts/AuthContext';
import { getFlarebaseClient } from '@/lib/flarebase';

export default function TestPage() {
  const flarebase = useFlarebase();
  const { user, login, register, logout, isAuthenticated } = useAuth();
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isLogin, setIsLogin] = useState(true);

  // Form state
  const [email, setEmail] = useState('test@example.com');
  const [password, setPassword] = useState('password123');
  const [name, setName] = useState('Test User');
  const [title, setTitle] = useState('E2E Test Article');
  const [content, setContent] = useState('Created by automated Puppeteer test.');

  // Load articles when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadArticles();
    }
  }, [isAuthenticated]);

  const loadArticles = async () => {
    setLoading(true);
    setError('');
    try {
      const client = getFlarebaseClient();
      const data = await client.getArticles();
      setArticles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
      await loadArticles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const client = getFlarebaseClient();
      await client.createArticle({ title, content });
      await loadArticles();
      setTitle('E2E Test Article ' + (articles.length + 1));
      setContent('Created by automated Puppeteer test at ' + new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    setArticles([]);
    setError('');
  };

  if (!isAuthenticated) {
    return (
      <div style={{ maxWidth: '400px', margin: '50px auto', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
        <h1 style={{ textAlign: 'center', marginBottom: '30px' }}>
          {isLogin ? 'Login' : 'Register'}
        </h1>

        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {!isLogin && (
            <div>
              <label style={{ fontWeight: 'bold', display: 'block' }}>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}
                data-testid="name-input"
              />
            </div>
          )}

          <div>
            <label style={{ fontWeight: 'bold', display: 'block' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}
              data-testid="email-input"
            />
          </div>

          <div>
            <label style={{ fontWeight: 'bold', display: 'block' }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}
              data-testid="password-input"
            />
          </div>

          {error && (
            <div style={{ padding: '10px', backgroundColor: '#fee', border: '1px solid #fcc', borderRadius: '4px' }} data-testid="error-message">
              ❌ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '12px',
              backgroundColor: loading ? '#ccc' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
            data-testid="submit-button"
          >
            {loading ? 'Processing...' : isLogin ? 'Login' : 'Register'}
          </button>

          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            style={{
              padding: '8px',
              marginTop: '10px',
              fontSize: '12px',
              color: '#666',
              background: 'none',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {isLogin ? 'Need an account? Register' : 'Have an account? Login'}
          </button>

          <button
            type="button"
            onClick={() => {
              setEmail('test@example.com');
              setPassword('password123');
              setName('Test User');
            }}
            style={{
              padding: '8px',
              marginTop: '10px',
              fontSize: '12px',
              color: '#666',
              background: 'none',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Fill Test Credentials
          </button>
        </form>

        <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f0f9ff', borderRadius: '4px', fontSize: '12px' }}>
          <strong>Test Credentials:</strong><br/>
          Email: test@example.com<br/>
          Password: password123
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '2px solid #2563eb', paddingBottom: '15px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px' }}>📚 Blog Platform</h1>
          <p style={{ margin: '5px 0 0 0', color: '#666', fontSize: '14px' }}>E2E Test Page</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ fontSize: '14px', color: '#666' }} data-testid="user-display">
            {user?.data?.name || user?.data?.email || 'User'}
          </span>
          <button
            onClick={handleLogout}
            style={{
              padding: '8px 16px',
              backgroundColor: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
            data-testid="logout-button"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Create Article */}
      <section style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
        <h2 style={{ marginTop: 0, marginBottom: '15px' }}>Create Article</h2>
        <form onSubmit={handleCreateArticle} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}
              data-testid="title-input"
            />
          </div>

          <div>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              rows={4}
              style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '4px', fontFamily: 'monospace', fontSize: '14px' }}
              data-testid="content-input"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '10px 20px',
              backgroundColor: loading ? '#ccc' : '#059669',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
            data-testid="create-button"
          >
            {loading ? 'Creating...' : 'Create Article'}
          </button>

          {error && (
            <div style={{ padding: '10px', backgroundColor: '#fee', border: '1px solid #fcc', borderRadius: '4px' }} data-testid="create-error">
              ❌ {error}
            </div>
          )}
        </form>
      </section>

      {/* Articles List */}
      <section>
        <h2 style={{ borderBottom: '2px solid #2563eb', paddingBottom: '10px', marginBottom: '20px' }}>
          Articles ({articles.length})
        </h2>

        {loading && articles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#666' }} data-testid="loading">
            Loading articles...
          </div>
        ) : articles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#f8f9fa', borderRadius: '8px', color: '#666' }} data-testid="empty-state">
            No articles yet. Create one above!
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '15px' }}>
            {articles.map((article, idx) => (
              <article
                key={article.id}
                style={{
                  padding: '15px',
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}
                data-testid={`article-${idx}`}
              >
                <h3 style={{ margin: '0 0 10px 0', color: '#1e40af', fontSize: '18px' }} data-testid={`article-${idx}-title`}>
                  {article.data?.title || article.title}
                </h3>
                <p style={{ margin: '0 0 10px 0', color: '#4b5563', lineHeight: '1.5' }} data-testid={`article-${idx}-content`}>
                  {article.data?.content || article.content}
                </p>
                <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                  {article.data?.status || article.status || 'N/A'} |
                  {article.data?.created_at || article.created_at ? new Date(article.data?.created_at || article.created_at).toLocaleString() : 'N/A'}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Status Footer */}
      <footer style={{ marginTop: '50px', padding: '15px', backgroundColor: '#ecfdf5', borderRadius: '8px', fontSize: '12px' }} data-testid="status-footer">
        <strong>✅ Status:</strong>
        <span style={{ marginLeft: '10px' }}>Auth: {user?.data?.email || 'None'}</span>
        <span style={{ marginLeft: '10px' }}>Articles: {articles.length}</span>
        <span style={{ marginLeft: '10px' }}>Server: {process.env.NEXT_PUBLIC_FLAREBASE_URL || 'http://localhost:3000'}</span>
      </footer>
    </div>
  );
}
