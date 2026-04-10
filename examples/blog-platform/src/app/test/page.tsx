// Test Page for Puppeteer E2E Testing
'use client';

import React, { useState, useEffect } from 'react';
import { getFlarebaseClient } from '@/lib/flarebase';
import type { User as SDKUser } from '@flarebase/client';

export default function TestPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<SDKUser | null>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form states
  const [email, setEmail] = useState('test@example.com');
  const [password, setPassword] = useState('password123');
  const [name, setName] = useState('Test User');
  const [title, setTitle] = useState('Puppeteer Test Article');
  const [content, setContent] = useState('This article was created by Puppeteer E2E test.');
  const [isLogin, setIsLogin] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = () => {
    if (typeof window === 'undefined') return;
    const client = getFlarebaseClient();
    const auth = client.isAuthenticated();
    const currentUser = client.getCurrentUser();
    setIsAuthenticated(auth);
    setUser(currentUser);

    if (auth) {
      loadArticles();
    }
  };

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
      const client = getFlarebaseClient();
      let result;

      if (isLogin) {
        result = await client.login(email, password);
      } else {
        result = await client.register({ name, email, password });
      }

      setIsAuthenticated(true);
      setUser(result.user);
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
      setTitle('Puppeteer Test Article ' + (articles.length + 1));
      setContent('This article was created by Puppeteer E2E test.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    const client = getFlarebaseClient();
    client.logout();
    setIsAuthenticated(false);
    setUser(null);
    setArticles([]);
    setError('');
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      {!isAuthenticated ? (
        <div>
          <h1 style={{ textAlign: 'center', color: '#333', marginBottom: '30px' }}>
            {isLogin ? 'Login' : 'Register'} - Blog Platform Test
          </h1>

          <form onSubmit={handleAuth} style={{ maxWidth: '400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {!isLogin && (
              <div>
                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Name:</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '14px' }}
                  data-testid="name-input"
                />
              </div>
            )}

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Email:</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '14px' }}
                data-testid="email-input"
              />
            </div>

            <div>
              <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Password:</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '14px' }}
                data-testid="password-input"
              />
            </div>

            {error && (
              <div style={{ padding: '10px', backgroundColor: '#fee', border: '1px solid #fcc', borderRadius: '5px', color: '#c00' }} data-testid="auth-error">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '12px',
                backgroundColor: loading ? '#ccc' : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: '16px'
              }}
              data-testid="auth-submit-button"
            >
              {loading ? 'Processing...' : isLogin ? 'Login' : 'Register'}
            </button>

            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              style={{
                padding: '10px',
                backgroundColor: 'transparent',
                color: '#007bff',
                border: '1px solid #007bff',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
              data-testid="toggle-auth-mode-button"
            >
              {isLogin ? 'Need an account? Register' : 'Have an account? Login'}
            </button>
          </form>

          <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f0f8ff', borderRadius: '5px', fontSize: '14px' }} data-testid="test-credentials-info">
            <strong>Test Credentials:</strong><br/>
            Email: test@example.com<br/>
            Password: password123
          </div>
        </div>
      ) : (
        <div>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '2px solid #007bff', paddingBottom: '15px' }}>
            <h1 style={{ margin: 0, color: '#333' }}>📚 Blog Platform - E2E Test</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <span style={{ fontSize: '14px', color: '#666' }} data-testid="user-info">
                {user?.data?.name || user?.data?.email}
              </span>
              <button
                onClick={handleLogout}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
                data-testid="logout-button"
              >
                Logout
              </button>
            </div>
          </header>

          {/* Create Article Form */}
          <section style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '8px' }} data-testid="create-article-section">
            <h2 style={{ marginTop: 0, color: '#333', marginBottom: '15px' }}>Create Article</h2>
            <form onSubmit={handleCreateArticle} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontWeight: 'bold', marginBottom: '5px', display: 'block' }}>Title:</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '14px' }}
                  data-testid="article-title-input"
                />
              </div>

              <div>
                <label style={{ fontWeight: 'bold', marginBottom: '5px', display: 'block' }}>Content:</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  required
                  rows={4}
                  style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '14px', fontFamily: 'monospace' }}
                  data-testid="article-content-input"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: '10px 20px',
                  backgroundColor: loading ? '#ccc' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  fontSize: '16px'
                }}
                data-testid="create-article-button"
              >
                {loading ? 'Creating...' : 'Create Article'}
              </button>

              {error && (
                <div style={{ padding: '10px', backgroundColor: '#fee', border: '1px solid #fcc', borderRadius: '5px', color: '#c00' }} data-testid="create-article-error">
                  {error}
                </div>
              )}
            </form>
          </section>

          {/* Articles List */}
          <section data-testid="articles-section">
            <h2 style={{ color: '#333', borderBottom: '2px solid #007bff', paddingBottom: '10px', marginBottom: '20px' }}>
              Articles ({articles.length})
            </h2>

            {loading && articles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#666' }} data-testid="loading-state">
                Loading articles...
              </div>
            ) : articles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#f8f9fa', borderRadius: '8px', color: '#666' }} data-testid="no-articles-state">
                No articles yet. Create your first article above!
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '15px' }} data-testid="articles-list">
                {articles.map((article, index) => (
                  <article
                    key={article.id}
                    style={{
                      padding: '20px',
                      backgroundColor: 'white',
                      border: '1px solid #ddd',
                      borderRadius: '8px',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                    data-testid={`article-${index}`}
                  >
                    <h3 style={{ marginTop: 0, color: '#007bff', marginBottom: '10px' }} data-testid={`article-${index}-title`}>
                      {article.data?.title || article.title}
                    </h3>
                    <p style={{ color: '#666', lineHeight: '1.6', marginBottom: '10px' }} data-testid={`article-${index}-content`}>
                      {article.data?.content || article.content}
                    </p>
                    <div style={{ fontSize: '12px', color: '#999' }}>
                      Status: {article.data?.status || article.status || 'N/A'} |
                      Created: {article.data?.created_at || article.created_at ? new Date(article.data?.created_at || article.created_at).toLocaleString() : 'N/A'}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Test Status Footer */}
          <footer style={{ marginTop: '50px', padding: '20px', backgroundColor: '#e7f3ff', borderRadius: '8px', fontSize: '14px' }} data-testid="test-status-footer">
            <strong>✅ E2E Test Status:</strong><br/>
            • Authentication: {isAuthenticated ? '✅ Authenticated as ' + (user?.data?.email || 'unknown') : '❌ Not Authenticated'}<br/>
            • Articles Loaded: {articles.length} articles<br/>
            • Server URL: {process.env.NEXT_PUBLIC_FLAREBASE_URL || 'http://localhost:3000'}<br/>
            • Page State: {loading ? 'Loading' : 'Ready'}
          </footer>
        </div>
      )}
    </div>
  );
}
