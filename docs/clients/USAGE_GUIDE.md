# Flarebase React & Vue 客户端使用指南

## 🎯 快速开始

### React 安装

```bash
npm install @flarebase/react
```

### Vue 安装

```bash
npm install @flarebase/vue
```

## 📖 React 使用指南

### 1. 基础设置

```jsx
import { FlarebaseProvider } from '@flarebase/react';
import App from './App';

function Root() {
  return (
    <FlarebaseProvider baseURL="http://localhost:3000">
      <App />
    </FlarebaseProvider>
  );
}

export default Root;
```

### 2. 集合操作

```jsx
import { useCollection } from '@flarebase/react';

function UserList() {
  const { data, loading, error } = useCollection('users');

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {data?.map(user => (
        <li key={user.id}>{user.data.name}</li>
      ))}
    </ul>
  );
}

export default UserList;
```

### 3. 文档操作

```jsx
import { useDocument } from '@flarebase/react';

function UserProfile({ userId }) {
  const { data, loading } = useDocument('users', userId);

  if (loading) return <div>Loading...</div>;
  if (!data) return <div>User not found</div>;

  return (
    <div>
      <h1>{data.data.name}</h1>
      <p>{data.data.email}</p>
    </div>
  );
}

export default UserProfile;
```

### 4. 查询功能

```jsx
import { useQuery } from '@flarebase/react';

function ActiveUsers() {
  const { data, loading, refetch } = useQuery('users', [
    ['status', { Eq: 'active' }]
  ]);

  return (
    <div>
      <button onClick={refetch}>Refresh</button>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <ul>
          {data?.map(user => (
            <li key={user.id}>{user.data.name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ActiveUsers;
```

## 📖 Vue 使用指南

### 1. 基础设置

```vue
<script setup>
import { FlarebasePlugin } from '@flarebase/vue';
import App from './App.vue';

const app = createApp(App);
app.use(FlarebasePlugin, { baseURL: 'http://localhost:3000' });
</script>
```

### 2. 集合操作

```vue
<script setup>
import { useCollection } from '@flarebase/vue';

const { data: users, loading, error } = useCollection('users');
</script>

<template>
  <div v-if="loading">Loading...</div>
  <div v-else-if="error">Error: {{ error.message }}</div>
  <ul v-else>
    <li v-for="user in users" :key="user.id">
      {{ user.data.name }}
    </li>
  </ul>
</template>
```

### 3. 文档操作

```vue
<script setup>
import { useDocument } from '@flarebase/vue';

const props = defineProps(['userId']);
const { data, loading } = useDocument('users', props.userId);
</script>

<template>
  <div v-if="loading">Loading...</div>
  <div v-else-if="!data">User not found</div>
  <div v-else>
    <h1>{{ data.data.name }}</h1>
    <p>{{ data.data.email }}</p>
  </div>
</template>
```

### 4. 查询功能

```vue
<script setup>
import { useQuery } from '@flarebase/vue';

const { data, loading, refetch } = useQuery('users', [
  ['status', { Eq: 'active' }]
]);
</script>

<template>
  <div>
    <button @click="refetch">Refresh</button>
    <div v-if="loading">Loading...</div>
    <ul v-else>
      <li v-for="user in data" :key="user.id">
        {{ user.data.name }}
      </li>
    </ul>
  </div>
</template>
```

## 🔧 高级用法

### React - 自定义Hooks

```jsx
import { useCollection } from '@flarebase/react';

function useActiveUsers() {
  const { data, loading, error } = useQuery('users', [
    ['status', { Eq: 'active' }]
  ]);

  const activeUserCount = data?.length || 0;

  return { data, loading, error, activeUserCount };
}

function ActiveUserDashboard() {
  const { activeUserCount } = useActiveUsers();

  return (
    <div>
      <h2>Active Users: {activeUserCount}</h2>
    </div>
  );
}
```

### Vue - 组合式函数

```javascript
import { useQuery } from '@flarebase/vue';

export function useActiveUsers() {
  const { data, loading, error } = useQuery('users', [
    ['status', { Eq: 'active' }]
  ]);

  const activeUserCount = computed(() => data.value?.length || 0);

  return { data, loading, error, activeUserCount };
}
```

## 🌐 实时数据同步

### React - 自动更新

```jsx
function LiveUserList() {
  const { data: users } = useCollection('users');

  return (
    <div>
      <h3>Live Users ({users?.length || 0})</h3>
      <ul>
        {users?.map(user => (
          <li key={user.id}>
            {user.data.name} - {{ user.data.status }}
          </li>
        ))}
      </ul>
    </div>
  );
}

// 组件会自动监听服务器更新并实时刷新
```

### Vue - 自动更新

```vue
<script setup>
import { useCollection } from '@flarebase/vue';

const { data: users } = useCollection('users');
const userCount = computed(() => users.value?.length || 0);
</script>

<template>
  <div>
    <h3>Live Users ({{ userCount }})</h3>
    <ul>
      <li v-for="user in users" :key="user.id">
        {{ user.data.name }} - {{ user.data.status }}
      </li>
    </ul>
  </div>
</template>
```

## ⚡ 性能优化

### React - 优化建议

```jsx
import { useMemo } from 'react';
import { useCollection, useDocument } from '@flarebase/react';

function OptimizedUserList({ userIds }) {
  // 只查询需要的字段
  const { data: users } = useQuery('users', [
    ['id', { In: userIds }]
  ]);

  // 缓存计算结果
  const sortedUsers = useMemo(() => {
    return users?.sort((a, b) => 
      a.data.name.localeCompare(b.data.name)
    );
  }, [users]);

  return (
    <ul>
      {sortedUsers?.map(user => (
        <li key={user.id}>{user.data.name}</li>
      ))}
    </ul>
  );
}
```

### Vue - 优化建议

```vue
<script setup>
import { useQuery } from '@flarebase/vue';
import { computed } from 'vue';

const props = defineProps(['userIds']);

const { data: users } = useQuery('users', [
  ['id', { In: props.userIds }]
]);

// 缓存计算结果
const sortedUsers = computed(() => {
  return users.value?.sort((a, b) => 
    a.data.name.localeCompare(b.data.name)
  );
});
</script>

<template>
  <ul>
    <li v-for="user in sortedUsers" :key="user.id">
      {{ user.data.name }}
    </li>
  </ul>
</template>
```

## 🎯 最佳实践

### 1. 错误边界 (React)

```jsx
class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <div>Something went wrong...</div>;
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <FlarebaseProvider baseURL="http://localhost:3000">
        <UserList />
      </FlarebaseProvider>
    </ErrorBoundary>
  );
}
```

### 2. 错误处理 (Vue)

```vue
<script setup>
import { ref, onErrorCaptured } from 'vue';

const error = ref(null);

onErrorCaptured((err) => {
  error.value = err;
});
</script>

<template>
  <div v-if="error">Something went wrong...</div>
  <slot v-else />
</template>
```

### 3. 加载状态管理

```jsx
// React
function LoadingWrapper({ children, loading }) {
  return (
    <div>
      {loading ? (
        <div className="spinner">Loading...</div>
      ) : (
        children
      )}
    </div>
  );
}
```

```vue
<!-- Vue -->
<div class="loading-wrapper" :class="{ loading }">
  <div v-if="loading" class="spinner">Loading...</div>
  <slot v-else />
</div>
```

## 🚀 生产部署

### 环境变量

```javascript
// React
const baseURL = process.env.REACT_APP_FLAREBASE_URL || 'http://localhost:3000';

<FlarebaseProvider baseURL={baseURL}>
  <App />
</FlarebaseProvider>
```

```javascript
// Vue
app.use(FlarebasePlugin, { 
  baseURL: import.meta.env.VITE_FLAREBASE_URL || 'http://localhost:3000'
});
```

### 性能监控

```jsx
// React
import { useEffect } from 'react';

function PerformanceMonitor() {
  useEffect(() => {
    const startTime = performance.now();
    return () => {
      const endTime = performance.now();
      console.log(`Render time: ${endTime - startTime}ms`);
    };
  });
}
```

## 🎓 总结

React和Vue客户端都提供了：
- ✅ 简洁的API设计
- ✅ 强大的实时功能
- ✅ 完善的类型支持
- ✅ 优秀的性能表现

选择你喜欢的框架开始使用Flarebase吧！🚀
