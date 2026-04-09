// Flarebase客户端配置和初始化
import { io } from 'socket.io-client';

// 🔒 直接连接到Flarebase服务器，权限检查在Flarebase层面进行
const FLAREBASE_URL = process.env.NEXT_PUBLIC_FLAREBASE_URL || 'http://localhost:3000';
const EXPRESS_SERVER_URL = process.env.NEXT_PUBLIC_EXPRESS_SERVER_URL || 'http://localhost:3001';

class FlarebaseClient {
  baseURL: string;
  expressServerURL: string;
  socket: any;

  constructor(baseURL: string, expressServerURL: string) {
    this.baseURL = baseURL;
    this.expressServerURL = expressServerURL;
    this.socket = null;
  }

  // Socket.IO连接（连接到Express服务器接收Hook事件）
  connectSocket() {
    if (typeof window !== 'undefined' && !this.socket) {
      // 连接到Express服务器的Socket.IO来接收Hook事件
      this.socket = io(this.expressServerURL);

      // 监听来自Flarebase的实时更新
      this.socket.on('flarebase:doc_created', (doc) => {
        console.log('Document created (via Express):', doc);
      });

      this.socket.on('flarebase:doc_updated', (doc) => {
        console.log('Document updated (via Express):', doc);
      });

      this.socket.on('flarebase:doc_deleted', (payload) => {
        console.log('Document deleted (via Express):', payload);
      });

      // 订阅集合更新
      this.subscribe = (collection: string) => {
        this.socket.emit('subscribe', collection);
      };

      this.unsubscribe = (collection: string) => {
        this.socket.emit('unsubscribe', collection);
      };
    }
  }

  // 获取认证头（发送到Flarebase进行权限检查）
  private getAuthHeaders() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  // 🔒 直接连接Flarebase进行集合操作（权限检查在Flarebase服务器层面）
  collection(name: string) {
    return {
      name,

      // 获取所有文档
      async getAll<T>(): Promise<T[]> {
        const response = await fetch(`${this.baseURL}/collections/${name}`, {
          headers: this.getAuthHeaders()
        });
        return response.json();
      },

      // 获取单个文档
      async get<T>(id: string): Promise<T | null> {
        const response = await fetch(`${this.baseURL}/collections/${name}/${id}`, {
          headers: this.getAuthHeaders()
        });
        const data = await response.json();
        return data;
      },

      // 添加文档
      async add<T>(data: any): Promise<T> {
        const response = await fetch(`${this.baseURL}/collections/${name}`, {
          method: 'POST',
          headers: {
            ...this.getAuthHeaders(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        });
        return response.json();
      },

      // 更新文档
      async update(id: string, data: any): Promise<any> {
        const response = await fetch(`${this.baseURL}/collections/${name}/${id}`, {
          method: 'PUT',
          headers: {
            ...this.getAuthHeaders(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        });
        return response.json();
      },

      // 删除文档
      async delete(id: string): Promise<boolean> {
        const response = await fetch(`${this.baseURL}/collections/${name}/${id}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
        return response.ok;
      },

      // 查询
      async query<T>(filters: any[] = []): Promise<T[]> {
        const response = await fetch(`${this.baseURL}/query`, {
          method: 'POST',
          headers: {
            ...this.getAuthHeaders(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ collection: name, filters })
        });
        return response.json();
      }
    };
  }

  // 文档引用
  doc(collection: string, id: string) {
    return {
      async get<T>(): Promise<T | null> {
        return this.collection(collection).get<T>(id);
      },

      async update(data: any): Promise<any> {
        return this.collection(collection).update(id, data);
      },

      async delete(): Promise<boolean> {
        return this.collection(collection).delete(id);
      }
    };
  }

  // 查询操作
  query(collection: string, filters: any[] = []) {
    return {
      get: () => this.collection(collection).query(filters)
    };
  }

  // 订阅集合更新
  subscribe: (collection: string) => void = () => {};
  unsubscribe: (collection: string) => void = () => {};
}

// 单例实例
let flarebaseClient: FlarebaseClient | null = null;

export function getFlarebaseClient(): FlarebaseClient {
  if (!flarebaseClient) {
    flarebaseClient = new FlarebaseClient(FLAREBASE_URL, EXPRESS_SERVER_URL);
  }
  return flarebaseClient;
}

// 客户端Hook（用于SSR）
export function useFlarebaseClient() {
  return getFlarebaseClient();
}
