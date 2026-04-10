# 🔄 白名单查询混合模式最佳实践

## 🎯 设计理念

采用 **REST + WebSocket 混合模式**，充分发挥两种协议的优势：

- **REST** - 用于 SWR 缓存和初始数据加载
- **WebSocket** - 用于实时查询和更新

## 📊 使用场景对比

### REST 端点 (`/queries/:name`)

**✅ 适用场景：**
- SWR 初始数据加载
- SEO 需要的服务器渲染
- HTTP 缓存友好的操作
- 公开数据获取
- 批量数据导出

**❌ 不适用场景：**
- 高频实时查询
- 实时数据订阅
- 服务器主动推送

**示例：**
```typescript
// ✅ 使用 REST + SWR 的场景
function BlogHome() {
  // 初始页面加载，SEO友好，支持HTTP缓存
  const { data: posts } = useSWR(
    'published_posts',
    () => fetch('/queries/list_published_posts').then(r => r.json())
  );
  return <div>{posts?.map(...)}</div>;
}
```

### WebSocket 事件 (`named_query`)

**✅ 适用场景：**
- 实时数据查询
- 高频查询操作
- 需要即时响应的交互
- 实时过滤和搜索
- 协作编辑场景

**❌ 不适用场景：**
- SEO 关键内容
- 需要离线缓存的数据
- 初始页面加载

**示例：**
```typescript
// ✅ 使用 WebSocket 的场景
function LiveSearch() {
  const [results, setResults] = useState([]);

  const handleSearch = async (keyword) => {
    // 实时搜索，避免频繁HTTP请求
    socket.emit('named_query', ['search_posts', { keyword }]);
    socket.once('query_success', (data) => setResults(data));
  };

  return <input onChange={(e) => handleSearch(e.target.value)} />;
}
```

## 🏗️ 架构设计

### 客户端架构

```
┌─────────────────────────────────────────────────────────┐
│                   前端应用                                │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────┐        ┌──────────────────┐      │
│  │   REST + SWR     │        │   WebSocket      │      │
│  │   (初始加载)      │        │   (实时更新)      │      │
│  └──────────────────┘        └──────────────────┘      │
│           │                         │                  │
│           └─────────┬─────────────┘                  │
│                     │                                │
│              ┌──────▼───────┐                        │
│              │  统一缓存层  │                        │
│              └──────┬───────┘                        │
│                     │                                │
│           ┌───────────▼──────────────┐              │
│           │    白名单查询客户端       │              │
│           └──────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Flarebase 服务器                             │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────┐        ┌──────────────────┐      │
│  │  REST 端点        │        │  WebSocket 事件   │      │
│  │  /queries/:name  │        │  named_query     │      │
│  └──────────────────┘        └──────────────────┘      │
│           │                         │                  │
│           └─────────┬─────────────┘                  │
│                     │                                │
│           ┌───────────▼──────────────┐              │
│           │    QueryExecutor         │              │
│           │    (白名单验证引擎)        │              │
│           └──────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

## 🎯 实施指南

### 1. 客户端配置

```typescript
// src/lib/flarebase_hybrid.ts
import { io } from 'socket.io-client';

class HybridFlarebaseClient {
  private baseURL: string;
  private wsUrl: string;
  private socket: any;
  private getAuthHeaders: () => Record<string, string>;

  constructor(
    baseURL: string,
    wsUrl: string,
    getAuthHeaders: () => Record<string, string>
  ) {
    this.baseURL = baseURL;
    this.wsUrl = wsUrl;
    this.getAuthHeaders = getAuthHeaders;
    this.socket = null;
  }

  // 初始化 WebSocket 连接
  connectSocket() {
    if (this.socket) return;

    this.socket = io(this.wsUrl);

    this.socket.on('connect', () => {
      console.log('🔗 WebSocket connected');
    });

    this.socket.on('disconnect', () => {
      console.log('🔌 WebSocket disconnected');
    });
  }

  // 🔒 REST 白名单查询 (用于 SWR)
  async namedQueryREST<T>(queryName: string, params: any = {}): Promise<T> {
    const response = await fetch(`${this.baseURL}/queries/${queryName}`, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Query failed');
    }

    return response.json();
  }

  // 🔒 WebSocket 白名单查询 (用于实时更新)
  namedQueryWebSocket<T>(queryName: string, params: any = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        this.connectSocket();
      }

      const timeout = setTimeout(() => {
        reject(new Error('Query timeout'));
      }, 5000);

      this.socket.once('query_success', (data) => {
        clearTimeout(timeout);
        resolve(data as T);
      });

      this.socket.once('query_error', (error) => {
        clearTimeout(timeout);
        reject(new Error(error.error || 'Query failed'));
      });

      this.socket.emit('named_query', [queryName, params]);
    });
  }

  // 智能查询：自动选择最佳方式
  async namedQuery<T>(
    queryName: string,
    params: any = {},
    options: { useWebSocket?: boolean; preferCache?: boolean } = {}
  ): Promise<T> {
    const { useWebSocket = false, preferCache = true } = options;

    // 对于实时性要求高的操作，使用 WebSocket
    if (useWebSocket) {
      return this.namedQueryWebSocket<T>(queryName, params);
    }

    // 对于需要缓存的静态数据，使用 REST
    if (preferCache) {
      return this.namedQueryREST<T>(queryName, params);
    }

    // 默认使用 REST
    return this.namedQueryREST<T>(queryName, params);
  }
}

// 创建全局实例
export const hybridClient = new HybridFlarebaseClient(
  process.env.NEXT_PUBLIC_FLAREBASE_URL || 'http://localhost:3000',
  process.env.NEXT_PUBLIC_FLAREBASE_WS_URL || 'http://localhost:3000',
  () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }
);
```

### 2. SWR Hook 集成

```typescript
// src/hooks/useNamedQuery.ts
import useSWR, { useSWRConfig } from 'swr';
import { hybridClient } from '@/lib/flarebase_hybrid';

export function useNamedQuery<T>(
  queryName: string,
  params: any = {},
  options: {
    refreshInterval?: number;
    revalidateOnFocus?: boolean;
    useWebSocket?: boolean;
  } = {}
) {
  const { mutate } = useSWRConfig();
  const { useWebSocket = false, ...swrOptions } = options;

  const fetcher = async () => {
    return hybridClient.namedQuery<T>(queryName, params, {
      useWebSocket,
      preferCache: !useWebSocket
    });
  };

  const { data, error, isValidating } = useSWR<T>(
    [queryName, params],
    fetcher,
    {
      revalidateOnFocus: true,
      ...swrOptions
    }
  );

  return {
    data,
    error,
    isLoading: !error && !data,
    isValidating,
    refresh: () => mutate([queryName, params])
  };
}
```

### 3. 使用示例

```typescript
// ✅ 博客首页 - 使用 REST + SWR (SEO友好)
function BlogHome() {
  const { data: posts, error } = useNamedQuery('list_published_posts', { limit: 10 });

  if (error) return <div>Error loading posts</div>;
  return (
    <div>
      {posts?.map(post => <PostCard key={post.id} post={post} />)}
    </div>
  );
}

// ✅ 实时搜索 - 使用 WebSocket (避免频繁HTTP请求)
function LiveSearch() {
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async (keyword: string) => {
    setSearching(true);
    try {
      const data = await hybridClient.namedQuery('search_posts', { keyword }, {
        useWebSocket: true,
        preferCache: false
      });
      setResults(data);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <input
        placeholder="搜索文章..."
        onChange={(e) => handleSearch(e.target.value)}
      />
      {searching ? <div>搜索中...</div> : <SearchResults results={results} />}
    </div>
  );
}

// ✅ 实时数据更新 - 混合模式
function Dashboard() {
  // 初始数据使用 REST + SWR
  const { data: stats, refresh } = useNamedQuery('admin_get_stats', {}, {
    refreshInterval: 30000 // 每30秒刷新一次
  });

  // 实时更新使用 WebSocket
  useEffect(() => {
    hybridClient.connectSocket();

    const handleUpdate = () => {
      hybridClient.namedQuery('admin_get_stats', {}, { useWebSocket: true })
        .then(newStats => refresh());
    };

    // 监听实时事件
    hybridClient.socket.on('data_updated', handleUpdate);
    return () => hybridClient.socket.off('data_updated', handleUpdate);
  }, [refresh]);

  return <DashboardStats stats={stats} />;
}
```

## 📈 性能优化策略

### 1. 缓存策略

```typescript
// REST 端点缓存配置
const swrConfig = {
  fetcher: hybridClient.namedQueryREST,
  revalidateOnFocus: false,
  dedupingInterval: 60000, // 60秒内相同请求去重
  refreshInterval: 0        // 不自动刷新
};

// 实时数据不缓存
const realtimeConfig = {
  fetcher: (name, params) => hybridClient.namedQuery(name, params, {
    useWebSocket: true,
    preferCache: false
  }),
  revalidateOnFocus: true,
  dedupingInterval: 0,
  refreshInterval: 5000 // 每5秒刷新
};
```

### 2. 请求优化

```typescript
// 批量查询优化
async function fetchDashboardData() {
  const [stats, posts, users] = await Promise.all([
    hybridClient.namedQueryREST('admin_get_stats'),
    hybridClient.namedQueryREST('list_my_posts', { limit: 5 }),
    hybridClient.namedQueryREST('list_recent_users', { limit: 10 })
  ]);

  return { stats, posts, users };
}
```

### 3. 错误处理

```typescript
// 统一错误处理
function handleQueryError(error: any, queryName: string) {
  if (error.message.includes('Query not found in whitelist')) {
    console.error(`🚨 查询 "${queryName}" 不在白名单中`);
  } else if (error.message.includes('Authentication required')) {
    console.error(`🔒 查询 "${queryName}" 需要认证`);
  } else if (error.message.includes('Permission denied')) {
    console.error(`⛔ 查询 "${queryName}" 权限不足`);
  } else {
    console.error(`❌ 查询 "${queryName}" 失败:`, error.message);
  }

  // 根据错误类型决定是否回退到 WebSocket
  if (error.message.includes('timeout') || error.message.includes('network')) {
    console.log('🔄 尝试使用 WebSocket 重试...');
    return hybridClient.namedQuery(queryName, {}, { useWebSocket: true });
  }

  throw error;
}
```

## 🔒 安全考量

### 1. 认证一致性

```typescript
// 确保 REST 和 WebSocket 使用相同的认证机制
const getAuthHeaders = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

// WebSocket 连接时发送认证
hybridClient.socket.on('connect', () => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    hybridClient.socket.emit('authenticate', { token });
  }
});
```

### 2. 权限验证

```typescript
// 客户端权限预检查
function canExecuteQuery(queryName: string): boolean {
  const user = getCurrentUser();

  // 管理员可以执行所有查询
  if (user?.role === 'admin') return true;

  // 检查查询权限配置
  const queryPermissions = {
    'admin_get_stats': ['admin'],
    'list_my_posts': ['admin', 'author', 'user'],
    'list_published_posts': ['admin', 'author', 'user', 'guest']
  };

  return queryPermissions[queryName]?.includes(user?.role) ?? false;
}
```

## 📊 监控和调试

```typescript
// 查询性能监控
class QueryMonitor {
  private metrics: Map<string, { count: number; totalTime: number; errors: number }> = new Map();

  record(queryName: string, duration: number, success: boolean) {
    if (!this.metrics.has(queryName)) {
      this.metrics.set(queryName, { count: 0, totalTime: 0, errors: 0 });
    }

    const metric = this.metrics.get(queryName)!;
    metric.count++;
    metric.totalTime += duration;
    if (!success) metric.errors++;

    // 性能警告
    if (duration > 1000) {
      console.warn(`⚠️ 查询 "${queryName}" 响应时间过长: ${duration}ms`);
    }

    // 错误率警告
    if (metric.errors / metric.count > 0.1) {
      console.error(`🚨 查询 "${queryName}" 错误率过高: ${(metric.errors / metric.count * 100).toFixed(1)}%`);
    }
  }

  getStats(queryName: string) {
    return this.metrics.get(queryName);
  }
}

export const queryMonitor = new QueryMonitor();
```

## 🎯 总结

混合模式提供了最佳的性能和用户体验：

1. **REST + SWR** - 静态数据、SEO友好、HTTP缓存
2. **WebSocket** - 实时数据、高频查询、即时响应
3. **智能切换** - 根据使用场景自动选择最佳方案
4. **统一接口** - 简化客户端代码，提升开发体验

这个设计既保证了安全性（白名单），又提供了灵活性（混合通信），是现代Web应用的理想方案！