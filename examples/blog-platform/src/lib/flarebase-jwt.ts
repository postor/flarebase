// Flarebase客户端配置和初始化 - 支持 JWT 认证和 SWR
import { io } from 'socket.io-client';

const FLAREBASE_URL = process.env.NEXT_PUBLIC_FLAREBASE_URL || 'http://localhost:3000';

interface JWTUser {
  id: string;
  email: string;
  name?: string;
  role: string;
}

interface AuthResponse {
  token: string;
  user: JWTUser;
}

interface NamedQueryParams {
  [key: string]: any;
}

// Socket.IO 事件名称定义
const SocketEvents = {
  // 集合操作
  INSERT: 'insert',
  GET: 'get',
  LIST: 'list',
  UPDATE: 'update',
  DELETE: 'delete',

  // Hook 操作
  CALL_HOOK: 'call_hook',
  HOOK_SUCCESS: 'hook_success',
  HOOK_ERROR: 'hook_error',

  // 查询操作
  NAMED_QUERY: 'named_query',

  // 订阅
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',

  // 响应
  SUCCESS: 'success',
  ERROR: 'error',
  QUERY_SUCCESS: 'query_success',
  QUERY_ERROR: 'query_error',
} as const;

class FlarebaseClient {
  private baseURL: string;
  private socket: any;
  private isConnected: boolean = false;
  private jwt: string | null = null;
  private user: JWTUser | null = null;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.socket = null;
    this.loadJWT();
  }

  // ========== JWT 管理方法 ==========

  /**
   * 存储 JWT 和用户信息
   */
  private setJWT(token: string, user: JWTUser | null = null) {
    this.jwt = token;
    this.user = user;

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('flarebase_jwt', token);
        if (user) {
          localStorage.setItem('flarebase_user', JSON.stringify(user));
        }
      } catch (e) {
        console.warn('Failed to store JWT in localStorage:', e);
      }
    }
  }

  /**
   * 从 localStorage 加载 JWT
   */
  private loadJWT() {
    if (typeof window === 'undefined') return;

    try {
      const token = localStorage.getItem('flarebase_jwt');
      const userStr = localStorage.getItem('flarebase_user');

      if (token) {
        this.jwt = token;
      }

      if (userStr) {
        this.user = JSON.parse(userStr);
      }

      if (token && this.user) {
        console.log('✅ [JWT] Loaded existing token for user:', this.user.email);
      }
    } catch (e) {
      console.warn('Failed to load JWT from localStorage:', e);
    }
  }

  /**
   * 清除 JWT 和用户信息
   */
  private clearJWT() {
    this.jwt = null;
    this.user = null;

    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('flarebase_jwt');
        localStorage.removeItem('flarebase_user');
      } catch (e) {
        console.warn('Failed to clear JWT from localStorage:', e);
      }
    }
  }

  /**
   * 获取认证头
   */
  private getAuthHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.jwt) {
      headers['Authorization'] = `Bearer ${this.jwt}`;
    }

    return headers;
  }

  /**
   * 用户登录
   */
  async login(email: string, password: string): Promise<AuthResponse> {
    console.log('🔐 [JWT] Logging in user:', email);

    return new Promise((resolve, reject) => {
      const socket = this.ensureConnected();

      const timeoutId = setTimeout(() => {
        socket.off(SocketEvents.HOOK_SUCCESS, onSuccess);
        socket.off(SocketEvents.HOOK_ERROR, onError);
        reject(new Error('Login request timed out'));
      }, 10000);

      const onSuccess = (data: AuthResponse) => {
        clearTimeout(timeoutId);
        socket.off(SocketEvents.HOOK_ERROR, onError);

        if (data.token) {
          this.setJWT(data.token, data.user);
          console.log('✅ [JWT] Login successful for:', data.user.email);
        }

        resolve(data);
      };

      const onError = (error: any) => {
        clearTimeout(timeoutId);
        socket.off(SocketEvents.HOOK_SUCCESS, onSuccess);
        reject(new Error(error.message || error.error || 'Login failed'));
      };

      socket.once(SocketEvents.HOOK_SUCCESS, onSuccess);
      socket.once(SocketEvents.HOOK_ERROR, onError);

      // 调用 auth hook
      socket.emit(SocketEvents.CALL_HOOK, ['auth', {
        action: 'login',
        email,
        password
      }]);
    });
  }

  /**
   * 用户注册
   */
  async register(userData: { name: string; email: string; password: string }): Promise<AuthResponse> {
    console.log('🔐 [JWT] Registering user:', userData.email);

    return new Promise((resolve, reject) => {
      const socket = this.ensureConnected();

      const timeoutId = setTimeout(() => {
        socket.off(SocketEvents.HOOK_SUCCESS, onSuccess);
        socket.off(SocketEvents.HOOK_ERROR, onError);
        reject(new Error('Registration request timed out'));
      }, 10000);

      const onSuccess = (data: AuthResponse) => {
        clearTimeout(timeoutId);
        socket.off(SocketEvents.HOOK_ERROR, onError);

        if (data.token) {
          this.setJWT(data.token, data.user);
          console.log('✅ [JWT] Registration successful for:', data.user.email);
        }

        resolve(data);
      };

      const onError = (error: any) => {
        clearTimeout(timeoutId);
        socket.off(SocketEvents.HOOK_SUCCESS, onSuccess);
        reject(new Error(error.message || error.error || 'Registration failed'));
      };

      socket.once(SocketEvents.HOOK_SUCCESS, onSuccess);
      socket.once(SocketEvents.HOOK_ERROR, onError);

      // 调用 auth hook
      socket.emit(SocketEvents.CALL_HOOK, ['auth', {
        action: 'register',
        ...userData
      }]);
    });
  }

  /**
   * 用户登出
   */
  logout() {
    console.log('🔐 [JWT] Logging out user');
    this.clearJWT();
  }

  /**
   * 检查是否已认证
   */
  isAuthenticated(): boolean {
    return !!this.jwt;
  }

  /**
   * 获取当前用户
   */
  getCurrentUser(): JWTUser | null {
    return this.user;
  }

  // ========== HTTP REST 方法 (用于 SWR) ==========

  /**
   * SWR fetcher 函数
   */
  get swrFetcher() {
    return async (url: string) => {
      const response = await fetch(`${this.baseURL}${url}`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({})
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    };
  }

  /**
   * 执行命名查询 (HTTP REST - 用于 SWR)
   */
  async namedQueryREST<T = any>(queryName: string, params: NamedQueryParams = {}): Promise<T> {
    console.log(`📡 [REST] Executing named query: ${queryName}`, params);

    const response = await fetch(`${this.baseURL}/queries/${queryName}`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      throw new Error(`Query failed: ${response.statusText}`);
    }

    return response.json();
  }

  // ========== Socket.IO 方法 ==========

  // 确保 Socket.IO 已连接
  private ensureConnected() {
    if (!this.socket || !this.isConnected) {
      this.connectSocket();
    }
    return this.socket;
  }

  // Socket.IO 连接
  connectSocket() {
    if (this.socket && this.isConnected) {
      console.log('🔄 [connectSocket] Reusing existing socket');
      return this.socket;
    }

    if (typeof window === 'undefined') {
      console.log('⚠️  [connectSocket] SSR environment, skipping socket connection');
      return null;
    }

    console.log('🔌 [connectSocket] Connecting to Flarebase via Socket.IO:', this.baseURL);

    this.socket = io(this.baseURL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('✅ [connectSocket] Connected to Flarebase, Socket ID:', this.socket.id);
      this.isConnected = true;
    });

    this.socket.on('disconnect', () => {
      console.log('❌ [connectSocket] Disconnected from Flarebase');
      this.isConnected = false;
    });

    this.socket.on('connect_error', (error: any) => {
      console.error('❌ [connectSocket] Connection error:', error.message);
      this.isConnected = false;
    });

    return this.socket;
  }

  // 通用 Socket.IO 请求方法
  private async socketRequest<T>(
    event: string,
    data: any,
    timeout: number = 10000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = this.ensureConnected();

      if (!socket) {
        reject(new Error('Socket not available (SSR)'));
        return;
      }

      const timeoutId = setTimeout(() => {
        reject(new Error(`Socket request timeout: ${event}`));
      }, timeout);

      const successEvent = `${event}_success`;
      const errorEvent = `${event}_error`;

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off(successEvent, onSuccess);
        socket.off(errorEvent, onError);
      };

      const onSuccess = (result: T) => {
        cleanup();
        resolve(result);
      };

      const onError = (error: any) => {
        cleanup();
        reject(new Error(error.message || error.error || `Request failed: ${event}`));
      };

      socket.once(successEvent, onSuccess);
      socket.once(errorEvent, onError);
      socket.emit(event, data);
    });
  }

  // 🔒 安全的白名单查询（通过 Socket.IO）
  async namedQuery<T = any>(queryName: string, params: NamedQueryParams = {}): Promise<T> {
    return this.socketRequest<T>(SocketEvents.NAMED_QUERY, { queryName, params });
  }

  // 集合操作
  collection(name: string) {
    const client = this;

    return {
      name,

      // 获取所有文档
      async getAll<T>(): Promise<T[]> {
        return client.socketRequest<T[]>(SocketEvents.LIST, { collection: name });
      },

      // 获取单个文档
      async get<T>(id: string): Promise<T | null> {
        return client.socketRequest<T>(SocketEvents.GET, { collection: name, id });
      },

      // 添加文档
      async add<T>(data: any): Promise<T> {
        return client.socketRequest<T>(SocketEvents.INSERT, { collection: name, data });
      },

      // 更新文档
      async update(id: string, data: any): Promise<any> {
        return client.socketRequest(SocketEvents.UPDATE, { collection: name, id, data });
      },

      // 删除文档
      async delete(id: string): Promise<boolean> {
        return client.socketRequest(SocketEvents.DELETE, { collection: name, id });
      },
    };
  }
}

// 创建单例实例
let clientInstance: FlarebaseClient | null = null;

export function getFlarebaseClient(): FlarebaseClient {
  if (!clientInstance) {
    clientInstance = new FlarebaseClient(FLAREBASE_URL);
  }
  return clientInstance;
}

export default getFlarebaseClient;
