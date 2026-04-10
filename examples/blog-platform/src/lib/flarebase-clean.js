// Flarebase SDK - JWT Fully Automated
// 用户无需关心JWT，SDK自动处理所有认证逻辑

class FlarebaseClient {
  constructor(baseURL = 'http://localhost:3000') {
    this.baseURL = baseURL;
    this._autoInit();
  }

  // 自动初始化：从存储恢复JWT，设置拦截器
  _autoInit() {
    this._loadJWT();
    this._setupAxiosInterceptor(); // 如果用axios
    this._setupFetchWrapper();   // 包装fetch
  }

  // 内部方法：加载JWT
  _loadJWT() {
    if (typeof window === 'undefined') return;
    try {
      const token = localStorage.getItem('flarebase_jwt');
      const userStr = localStorage.getItem('flarebase_user');
      if (token) this._jwt = token;
      if (userStr) this._user = JSON.parse(userStr);
    } catch (e) {
      console.warn('[Flarebase] Failed to load JWT');
    }
  }

  // 内部方法：保存JWT
  _saveJWT(token, user) {
    this._jwt = token;
    this._user = user;
    if (typeof window !== 'undefined') {
      localStorage.setItem('flarebase_jwt', token);
      localStorage.setItem('flarebase_user', JSON.stringify(user));
    }
  }

  // 内部方法：清除JWT
  _clearJWT() {
    this._jwt = null;
    this._user = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('flarebase_jwt');
      localStorage.removeItem('flarebase_user');
    }
  }

  // 内部方法：所有请求自动添加JWT
  _fetch(url, options = {}) {
    // 自动添加Authorization header
    const headers = options.headers || {};
    if (this._jwt) {
      headers['Authorization'] = `Bearer ${this._jwt}`;
    }

    return fetch(url, {
      ...options,
      headers
    });
  }

  // ========== 公开API（用户调用）==========

  // 登录 - 自动保存JWT
  async login(email, password) {
    const res = await this._fetch(`${this.baseURL}/call_hook/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email, password })
    });

    const data = await res.json();

    // 自动保存JWT
    if (data.data?.token) {
      this._saveJWT(data.data.token, data.data.user);
    }

    return data;
  }

  // 注册 - 自动保存JWT
  async register({ name, email, password }) {
    const res = await this._fetch(`${this.baseURL}/call_hook/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register', name, email, password })
    });

    const data = await res.json();

    // 自动保存JWT
    if (data.data?.token) {
      this._saveJWT(data.data.token, data.data.user);
    }

    return data;
  }

  // 登出 - 自动清除JWT
  logout() {
    this._clearJWT();
  }

  // 获取当前用户（对用户透明）
  get user() {
    return this._user;
  }

  // 检查是否已登录
  get isAuthenticated() {
    return !!this._jwt;
  }

  // ========== 数据操作API（自动带JWT）==========

  // 获取文章列表 - 自动添加JWT
  async getArticles() {
    const res = await this._fetch(`${this.baseURL}/collections/posts`);
    return res.json();
  }

  // 创建文章 - 自动添加JWT
  async createArticle({ title, content }) {
    const res = await this._fetch(`${this.baseURL}/collections/posts`, {
      method: 'POST',
      body: JSON.stringify({ title, content, created_at: Date.now() })
    });
    return res.json();
  }

  // 获取单个文章 - 自动添加JWT
  async getArticle(id) {
    const res = await this._fetch(`${this.baseURL}/collections/posts/${id}`);
    return res.json();
  }

  // 更新文章 - 自动添加JWT
  async updateArticle(id, updates) {
    const res = await this._fetch(`${this.baseURL}/collections/posts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    return res.json();
  }

  // 删除文章 - 自动添加JWT
  async deleteArticle(id) {
    const res = await this._fetch(`${this.baseURL}/collections/posts/${id}`, {
      method: 'DELETE'
    });
    return res.json();
  }

  // 集合操作
  collection(name) {
    const client = this;
    return {
      async getAll() {
        const res = await client._fetch(`${client.baseURL}/collections/${name}`);
        return res.json();
      },

      async get(id) {
        const res = await client._fetch(`${client.baseURL}/collections/${name}/${id}`);
        return res.json();
      },

      async add(data) {
        const res = await client._fetch(`${client.baseURL}/collections/${name}`, {
          method: 'POST',
          body: JSON.stringify(data)
        });
        return res.json();
      },

      async update(id, data) {
        const res = await client._fetch(`${client.baseURL}/collections/${name}/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data)
        });
        return res.json();
      },

      async delete(id) {
        const res = await client._fetch(`${client.baseURL}/collections/${name}/${id}`, {
          method: 'DELETE'
        });
        return res.json();
      }
    };
  }
}

// 使用示例：
// const db = new FlarebaseClient();
//
// // 登录（JWT自动保存）
// await db.login('user@example.com', 'pass');
//
// // 之后所有请求自动带JWT，用户无感知
// const articles = await db.getArticles();
// const article = await db.createArticle({ title: 'Hello', content: 'World' });
//
// // 登出（自动清除JWT）
// db.logout();

export default FlarebaseClient;
