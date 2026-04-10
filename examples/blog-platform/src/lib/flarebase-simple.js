// Simplified Flarebase Client for Testing
const FLAREBASE_URL = process.env.FLAREBASE_URL || 'http://localhost:3000';

class FlarebaseClient {
  constructor() {
    this.baseURL = FLAREBASE_URL;
    this.jwt = null;
    this.user = null;
    this.loadJWT();
  }

  setJWT(token, user) {
    this.jwt = token;
    this.user = user;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('flarebase_jwt', token);
        localStorage.setItem('flarebase_user', JSON.stringify(user));
      } catch (e) {
        console.warn('Failed to store JWT:', e);
      }
    }
  }

  loadJWT() {
    if (typeof window === 'undefined') return;
    try {
      this.jwt = localStorage.getItem('flarebase_jwt');
      const userStr = localStorage.getItem('flarebase_user');
      if (userStr) this.user = JSON.parse(userStr);
    } catch (e) {
      console.warn('Failed to load JWT:', e);
    }
  }

  clearJWT() {
    this.jwt = null;
    this.user = null;
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('flarebase_jwt');
        localStorage.removeItem('flarebase_user');
      } catch (e) {
        console.warn('Failed to clear JWT:', e);
      }
    }
  }

  getAuthHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (this.jwt) {
      headers['Authorization'] = `Bearer ${this.jwt}`;
    }
    return headers;
  }

  async login(email, password) {
    const response = await fetch(`${this.baseURL}/call_hook/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'login',
        email,
        password
      })
    });

    const data = await response.json();
    if (data.data && data.data.token) {
      this.setJWT(data.data.token, data.data.user);
    }
    return data;
  }

  async register(name, email, password) {
    const response = await fetch(`${this.baseURL}/call_hook/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'register',
        name,
        email,
        password
      })
    });

    const data = await response.json();
    if (data.data && data.data.token) {
      this.setJWT(data.data.token, data.data.user);
    }
    return data;
  }

  logout() {
    this.clearJWT();
  }

  isAuthenticated() {
    return !!this.jwt;
  }

  getCurrentUser() {
    return this.user;
  }

  async getArticles() {
    const response = await fetch(`${this.baseURL}/collections/posts`, {
      method: 'GET',
      headers: this.getAuthHeaders()
    });
    return response.json();
  }

  async createArticle(title, content) {
    const response = await fetch(`${this.baseURL}/collections/posts`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        title,
        content,
        status: 'published',
        created_at: Date.now()
      })
    });
    return response.json();
  }
}

if (typeof window !== 'undefined') {
  window.FlarebaseClient = FlarebaseClient;
}

module.exports = FlarebaseClient;
