# 📋 Query Whitelist Specification

**查询白名单规范 - 安全的命名查询系统**

> **注意**: 此文档描述的是白名单查询的语法规范。关于完整的权限管理系统，请参阅 [Security Rules](./SECURITY_RULES.md)。

---

## 概述

查询白名单（Named Query）系统允许开发者预定义安全的查询模板，客户端只能通过名称调用这些模板。这是实现"最小权限查询"的核心机制。

## 为什么需要查询白名单？

### 问题：不安全的任意查询

```typescript
// ❌ 危险：客户端可以执行任意查询
const allUsers = await flarebase.collection('users').query([]);
const admins = await flarebase.collection('users').query([
  { field: 'role', operator: 'Eq', value: 'admin' }
]);
```

### 解决：安全的白名单查询

```typescript
// ✅ 安全：只能执行预定义的查询
const publishedPosts = await flarebase.namedQuery('list_published_posts', {
  limit: 10
});
```

---

## 白名单配置

### 1. 配置文件结构

白名单配置是 JSON 文件，包含多个命名查询模板：

```json
{
  "version": "1.0",
  "queries": {
    "list_published_posts": {
      "type": "simple",
      "collection": "posts",
      "filters": [
        ["status", {"Eq": "published"}]
      ],
      "limit": "$params.limit",
      "offset": "$params.offset"
    },
    "get_my_posts": {
      "type": "simple",
      "collection": "posts",
      "filters": [
        ["author_id", {"Eq": "$USER_ID"}]
      ],
      "limit": "$params.limit"
    }
  }
}
```

### 2. 查询类型

#### Simple Query（简单查询）

单集合查询，支持过滤、分页：

```json
{
  "list_published_posts": {
    "type": "simple",
    "collection": "posts",
    "filters": [
      ["status", {"Eq": "published"}],
      ["created_at", {"Gte": "$params.start_date"}]
    ],
    "limit": "$params.limit",
    "offset": "$params.offset"
  }
}
```

#### Pipeline Query（管道查询）

多步骤查询，支持关联和聚合：

```json
{
  "get_post_with_author": {
    "type": "pipeline",
    "steps": [
      {
        "id": "post",
        "action": "get",
        "collection": "posts",
        "id_param": "$params.id"
      },
      {
        "id": "author",
        "action": "get",
        "collection": "users",
        "id_param": "$post.data.author_id"
      },
      {
        "id": "comments",
        "action": "find",
        "collection": "comments",
        "filters": [
          ["post_id", {"Eq": "$post.id"}]
        ]
      }
    ],
    "output": {
      "post": {
        "id": "$post.id",
        "title": "$post.data.title",
        "content": "$post.data.content"
      },
      "author": {
        "id": "$author.id",
        "name": "$author.data.name"
      },
      "comment_count": "$comments.count"
    }
  }
}
```

---

## 变量注入

### 可用变量

| 变量 | 说明 | 示例值 | 客户端可控 |
|------|------|--------|-----------|
| `$USER_ID` | 当前登录用户 ID | `"user-123"` | ❌ |
| `$USER_ROLE` | 当前用户角色 | `"user"`, `"admin"` | ❌ |
| `$params.xxx` | 客户端传入的参数 | `{ limit: 10 }` | ✅ |
| `$step_id.field` | 前序步骤的结果 | `$post.data.author_id` | ❌ |

### 使用示例

```json
{
  "get_my_profile": {
    "type": "simple",
    "collection": "users",
    "filters": [
      ["id", {"Eq": "$USER_ID"}]
    ]
  },
  "list_posts_with_pagination": {
    "type": "simple",
    "collection": "posts",
    "filters": [
      ["author_id", {"Eq": "$USER_ID"}]
    ],
    "limit": "$params.limit",
    "offset": "$params.offset"
  }
}
```

---

## 过滤器操作符

### 支持的操作符

| 操作符 | 说明 | 示例 |
|--------|------|------|
| `Eq` | 等于 | `{"Eq": "published"}` |
| `Ne` | 不等于 | `{"Ne": "deleted"}` |
| `Gt` | 大于 | `{"Gt": "100"}` |
| `Gte` | 大于等于 | `{"Gte": "0"}` |
| `Lt` | 小于 | `{"Lt": "1000"}` |
| `Lte` | 小于等于 | `{"Lte": "999"}` |
| `In` | 在列表中 | `{"In": ["draft", "published"]}` |
| `Contains` | 包含字符串 | `{"Contains": "keyword"}` |

### 过滤器格式

```json
{
  "filters": [
    ["field_name", {"Operator": "value"}]
  ]
}
```

---

## 完整示例

### 博客平台白名单配置

```json
{
  "version": "1.0",
  "queries": {
    "list_published_posts": {
      "type": "simple",
      "description": "列出所有已发布的文章",
      "collection": "posts",
      "filters": [
        ["status", {"Eq": "published"}]
      ],
      "limit": "$params.limit",
      "offset": "$params.offset",
      "sort": [["created_at", "desc"]]
    },
    "get_my_posts": {
      "type": "simple",
      "description": "获取当前用户的文章",
      "collection": "posts",
      "filters": [
        ["author_id", {"Eq": "$USER_ID"}]
      ],
      "limit": "$params.limit"
    },
    "get_post_by_id": {
      "type": "simple",
      "description": "根据 ID 获取文章",
      "collection": "posts",
      "filters": [
        ["id", {"Eq": "$params.id"}]
      ]
    },
    "search_posts": {
      "type": "simple",
      "description": "搜索文章",
      "collection": "posts",
      "filters": [
        ["status", {"Eq": "published"}],
        ["title", {"Contains": "$params.keyword"}]
      ],
      "limit": "$params.limit"
    },
    "get_post_with_author": {
      "type": "pipeline",
      "description": "获取文章及其作者信息",
      "steps": [
        {
          "id": "post",
          "action": "get",
          "collection": "posts",
          "id_param": "$params.id"
        },
        {
          "id": "author",
          "action": "get",
          "collection": "users",
          "id_param": "$post.data.author_id"
        }
      ],
      "output": {
        "id": "$post.id",
        "title": "$post.data.title",
        "content": "$post.data.content",
        "status": "$post.data.status",
        "created_at": "$post.data.created_at",
        "author": {
          "id": "$author.id",
          "name": "$author.data.name",
          "avatar": "$author.data.avatar"
        }
      }
    },
    "get_my_profile": {
      "type": "simple",
      "description": "获取当前用户的资料",
      "collection": "users",
      "filters": [
        ["id", {"Eq": "$USER_ID"}]
      ]
    },
    "get_post_comments": {
      "type": "simple",
      "description": "获取文章评论",
      "collection": "comments",
      "filters": [
        ["post_id", {"Eq": "$params.post_id"}]
      ],
      "limit": "$params.limit"
    },
    "admin_get_all_users": {
      "type": "simple",
      "description": "管理员获取所有用户",
      "collection": "users",
      "filters": [],
      "limit": "$params.limit",
      "required_role": "admin"
    }
  }
}
```

---

## 客户端使用

### JavaScript/TypeScript

```typescript
import { initializeFlarebase } from '@flarebase/js-sdk';

const flarebase = initializeFlarebase({
  apiUrl: 'https://your-flarebase.com'
});

// 认证
await flarebase.auth.signInAnonymously();

// 调用命名查询
const posts = await flarebase.namedQuery('list_published_posts', {
  limit: 10,
  offset: 0
});

console.log(posts);
// [
//   { id: 'post-1', data: { title: 'Post 1', status: 'published' } },
//   { id: 'post-2', data: { title: 'Post 2', status: 'published' } }
// ]
```

### REST API

```bash
# 调用命名查询
curl -X POST https://your-flarebase.com/queries/list_published_posts \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 10,
    "offset": 0
  }'
```

### WebSocket

```javascript
const socket = io('https://your-flarebase.com');

socket.emit('named_query', ['list_published_posts', { limit: 10 }]);

socket.on('query_success', (result) => {
  console.log('Query result:', result);
});

socket.on('query_error', (error) => {
  console.error('Query failed:', error);
});
```

---

## 错误处理

### 常见错误

| 错误 | 说明 | 解决方法 |
|------|------|---------|
| `Query not found in whitelist` | 查询不在白名单中 | 检查查询名称是否正确 |
| `Permission denied` | 权限不足 | 检查用户角色和权限设置 |
| `Authentication required` | 需要登录 | 先进行身份认证 |
| `Invalid parameters` | 参数无效 | 检查参数类型和范围 |

### 错误示例

```typescript
try {
  const result = await flarebase.namedQuery('list_published_posts', {
    limit: 10
  });
} catch (error) {
  if (error.message.includes('Query not found in whitelist')) {
    console.error('查询不在白名单中');
  } else if (error.message.includes('Permission denied')) {
    console.error('权限不足');
  } else if (error.message.includes('Authentication required')) {
    console.error('需要登录');
  } else {
    console.error('未知错误:', error.message);
  }
}
```

---

## 安全性

### 1. 参数验证

```json
{
  "list_posts": {
    "limit": "$params.limit"  // 会验证范围 0-10000
  }
}
```

### 2. 防止注入

- 客户端参数无法覆盖模板中的约束
- 特殊字符会被转义
- `$USER_ID` 等系统变量客户端无法伪造

### 3. 角色验证

```json
{
  "admin_query": {
    "required_role": "admin",
    "type": "simple",
    "collection": "admin_data"
  }
}
```

---

## 最佳实践

### 1. 使用描述性名称

```json
{
  "good_name": "list_published_posts_by_category",
  "bad_name": "query1"
}
```

### 2. 添加描述

```json
{
  "list_published_posts": {
    "description": "列出所有已发布的文章，支持分页",
    "type": "simple",
    "collection": "posts"
  }
}
```

### 3. 限制结果数量

```json
{
  "list_posts": {
    "limit": "$params.limit",  // 客户端可控
    "max_limit": 100            // 服务器端硬限制
  }
}
```

### 4. 使用变量注入

```json
{
  "get_my_posts": {
    "filters": [
      ["author_id", {"Eq": "$USER_ID"}]  // 自动注入当前用户
    ]
  }
}
```

---

## 部署

### 方法 1: Security Rules（推荐）

```bash
# 将白名单配置作为 Security Rules 的一部分
flare deploy rules
```

### 方法 2: 直接部署

```bash
# 使用 CLI 工具部署白名单
flare deploy whitelist
```

---

## 相关文档

- [Security Rules](./SECURITY_RULES.md) - 完整的权限管理系统
- [Security & Permissions](../core/SECURITY.md) - 权限系统概述
- [Auth System](./AUTH.md) - 认证系统
