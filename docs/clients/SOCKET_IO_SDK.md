# 🔌 完全基于 Socket.IO 的 Flarebase SDK

## ✅ 已完成的更新

### 1. SDK 完全重写

**之前**: 使用 REST API + 部分 Socket.IO
```typescript
// ❌ 混合使用 REST 和 Socket.IO
await fetch(`${baseURL}/collections/posts`, { method: 'POST', body: ... })
socket.emit('named_query', [...])
```

**现在**: 完全基于 Socket.IO
```typescript
// ✅ 所有操作都通过 Socket.IO
await flarebase.collection('posts').add(data)
await flarebase.collection('posts').get(id)
await flarebase.blogQueries.getPublishedPosts(10)
```

### 2. 服务器端 Socket.IO 事件支持

新增的事件处理器：
- `insert` - 创建文档
- `get` - 获取单个文档
- `list` - 列出所有文档
- `update` - 更新文档
- `delete` - 删除文档
- `named_query` - 白名单查询（已存在）

### 3. API 映射

| SDK 方法 | Socket.IO 事件 | 成功响应 | 错误响应 |
|---------|---------------|---------|---------|
| `collection().add()` | `insert` | `insert_success` | `insert_error` |
| `collection().get()` | `get` | `get_success` | `get_error` |
| `collection().getAll()` | `list` | `list_success` | `list_error` |
| `collection().update()` | `update` | `update_success` | `update_error` |
| `collection().delete()` | `delete` | `delete_success` | `delete_error` |
| `namedQuery()` | `named_query` | `query_success` | `query_error` |

## 🚀 使用示例

### 创建文档
```typescript
await flarebase.collection('posts').add({
  title: 'Hello World',
  content: 'My first post'
})
```

### 读取文档
```typescript
const post = await flarebase.collection('posts').get('post-id')
const allPosts = await flarebase.collection('posts').getAll()
```

### 更新文档
```typescript
await flarebase.collection('posts').update('post-id', {
  title: 'Updated Title'
})
```

### 删除文档
```typescript
await flarebase.collection('posts').delete('post-id')
```

### 白名单查询
```typescript
const posts = await flarebase.blogQueries.getPublishedPosts(10)
```

## 🔒 安全性

- ✅ 完全不使用 REST API
- ✅ 所有操作通过 Socket.IO
- ✅ 查询只能通过白名单
- ✅ 不安全的 `query()` 方法已禁用

## 📝 注意事项

1. **连接管理**: SDK 会自动管理 Socket.IO 连接
2. **错误处理**: 所有方法都返回 Promise，支持 async/await
3. **超时**: 默认 10 秒超时（白名单查询 30 秒）
4. **实时更新**: 自动监听 `doc_created`, `doc_updated`, `doc_deleted` 事件

## 🧪 测试

服务器端测试：
```bash
cd D:/study/flarebase
cargo test -p flare-server whitelist
```

客户端测试：
```bash
cd examples/blog-platform
npm run dev
```

访问 `http://localhost:3000` 查看功能
