# 🔐 Flarebase Security Rules

**无服务器权限管理的完整方案**

Flarebase Security Rules 是一个基于数据库的权限系统，类似 Firebase Security Rules。规则存储在 Flarebase 中，由 Flarebase 服务器执行，完全无需用户维护任何服务器。

## 📋 目录

- [核心概念](#核心概念)
- [工作原理](#工作原理)
- [规则语法](#规则语法)
- [部署流程](#部署流程)
- [使用示例](#使用示例)
- [安全保证](#安全保证)
- [与白名单查询的区别](#与白名单查询的区别)

---

## 核心概念

### 传统方案的问题

```
❌ 方案 1: 客户端验证
   - 不安全：可以被绕过
   - 用户可以直接调用 HTTP API

❌ 方案 2: 服务器配置文件
   - 需要配置 Flarebase 服务器
   - 多个应用共享服务器时无法隔离
   - 部署复杂

❌ 方案 3: 用户自己的服务器
   - 违背了"无服务器"理念
   - 增加运维成本
```

### Flarebase Security Rules

```
✅ 规则存储在 Flarebase 中
✅ Flarebase 服务器执行规则验证
✅ 完全无服务器
✅ 每个应用独立管理自己的规则
```

---

## 工作原理

### 1. 架构设计

```
┌─────────────────────────────────────────────────┐
│         开发者机器（部署时）                      │
│  ┌──────────────────┐    ┌──────────────────┐   │
│  │ security.rules   │    │flare deploy rules│   │
│  └────────┬─────────┘    └────────┬─────────┘   │
│           │                      │              │
│           └──────────┬───────────┘              │
│                      ▼                          │
└──────────────────┬──────────────────────────────┘
                   │ 上传规则到 __security_rules__
                   ▼
┌─────────────────────────────────────────────────┐
│              Flarebase 服务器                    │
│  ┌────────────────────────────────────────┐    │
│  │ __security_rules__ 集合                │    │
│  │  ┌─────────────────────────────────┐  │    │
│  │  │ collection: posts               │  │    │
│  │  │ - allow_read/write conditions   │  │    │
│  │  │ - allowed_queries               │  │    │
│  │  └─────────────────────────────────┘  │    │
│  └────────────────────────────────────────┘    │
│                      │                           │
│                      ▼                           │
│  ┌────────────────────────────────────────┐    │
│  │     规则引擎（每次查询时验证）           │    │
│  │  1. 读取规则                           │    │
│  │  2. 验证权限                           │    │
│  │  3. 注入 $USER_ID                     │    │
│  │  4. 执行或拒绝                         │    │
│  └────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│         静态网站（运行时）                        │
│  ┌────────────────────────────────────────┐    │
│  │  浏览器中的 JS 应用                     │    │
│  │  - 调用 API                            │    │
│  │  - 规则在服务器端执行                   │    │
│  │  - 完全无服务器                         │    │
│  └────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### 2. 规则存储

规则存储在特殊的 `__security_rules__` 集合中：

```json
{
  "id": "posts_rules",
  "collection": "posts",
  "created_at": 1699123456789,
  "updated_at": 1699123456789,
  "data": {
    "allow_read": "auth != null && (resource.status == 'published' || resource.author_id == auth.user_id)",
    "allow_write": "auth != null && resource.author_id == auth.user_id",
    "allow_delete": "auth != null && resource.author_id == auth.user_id || auth.role == 'admin'",
    "allowed_queries": [
      {
        "name": "list_published",
        "description": "列出所有已发布的文章",
        "filters": [
          ["status", {"Eq": "published"}]
        ],
        "limit": "$params.limit",
        "offset": "$params.offset"
      },
      {
        "name": "get_my_posts",
        "description": "获取当前用户的文章",
        "filters": [
          ["author_id", {"Eq": "$USER_ID"}]
        ],
        "limit": "$params.limit"
      }
    ]
  }
}
```

### 3. 验证流程

每次客户端请求时：

1. **提取认证信息**：从请求头或 token 中提取 `user_id` 和 `role`
2. **读取规则**：从 `__security_rules__` 读取对应集合的规则
3. **验证权限**：
   - 检查 `allow_read/write/delete` 条件
   - 对于查询，检查是否在 `allowed_queries` 中
4. **注入上下文**：替换 `$USER_ID`, `$USER_ROLE` 等变量
5. **执行或拒绝**：通过则执行，否则返回 403

---

## 规则语法

### 1. 权限条件

使用表达式语法控制访问：

```javascript
// 基本条件
"auth != null"                          // 需要登录
"auth.role == 'admin'"                  // 需要管理员
"resource.author_id == auth.user_id"    // 只能访问自己的资源

// 组合条件
"auth != null && resource.status == 'published'"
"auth.role == 'admin' || resource.author_id == auth.user_id"

// 对象访问
"resource.author_id == auth.user_id"
"resource.status == 'published'"
```

### 2. 可用变量

| 变量 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `auth` | Object | 当前认证用户信息 | `auth.user_id`, `auth.role` |
| `auth.user_id` | String | 用户 ID | `"user-123"` |
| `auth.role` | String | 用户角色 | `"user"`, `"admin"` |
| `resource` | Object | 正在访问的资源 | `resource.author_id` |
| `data` | Object | 正在写入的数据 | `data.status` |

### 3. 查询白名单

在 `allowed_queries` 中定义允许的查询：

```json
{
  "allowed_queries": [
    {
      "name": "list_published",
      "description": "列出已发布的文章",
      "type": "simple",
      "collection": "posts",
      "filters": [
        ["status", {"Eq": "published"}]
      ],
      "limit": "$params.limit",
      "offset": "$params.offset"
    },
    {
      "name": "get_post_with_author",
      "description": "获取文章及其作者",
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
        }
      ],
      "output": {
        "title": "$post.data.title",
        "content": "$post.data.content",
        "author_name": "$author.data.name"
      }
    }
  ]
}
```

---

## 部署流程

### 1. 创建规则文件

在项目根目录创建 `security.rules.json`：

```json
{
  "version": "1",
  "rules": [
    {
      "collection": "posts",
      "allow_read": "auth != null && (resource.status == 'published' || resource.author_id == auth.user_id)",
      "allow_write": "auth != null && resource.author_id == auth.user_id",
      "allow_delete": "auth != null && (resource.author_id == auth.user_id || auth.role == 'admin')",
      "allowed_queries": [
        {
          "name": "list_published",
          "filters": [["status", {"Eq": "published"}]],
          "limit": "$params.limit"
        }
      ]
    },
    {
      "collection": "users",
      "allow_read": "auth != null",
      "allow_write": "auth != null && resource.id == auth.user_id",
      "allow_delete": "auth.role == 'admin'"
    }
  ]
}
```

### 2. 使用 CLI 部署

```bash
# 安装 Flarebase CLI
npm install -g @flarebase/cli

# 登录
flare login

# 部署规则
flare deploy rules

# 验证部署
flare rules list
```

### 3. 部署静态网站

```bash
# 规则部署后，部署静态文件到任何 CDN
npm run build
firebase deploy  # 或 Vercel, Netlify 等
```

---

## 使用示例

### 客户端 SDK 使用

```typescript
import { initializeFlarebase } from '@flarebase/js-sdk';

const flarebase = initializeFlarebase({
  apiUrl: 'https://your-flarebase-instance.com'
});

// 1. 认证
await flarebase.auth.signInAnonymously();
// 或
await flarebase.auth.signInWithEmail('user@example.com', 'password');

// 2. 读取数据（规则自动验证）
const posts = await flarebase
  .collection('posts')
  .where('status', '==', 'published')
  .limit(10)
  .get();

// 3. 写入数据（规则自动验证）
await flarebase.collection('posts').add({
  title: 'My Post',
  content: 'Hello World',
  status: 'draft',
  author_id: flarebase.auth.currentUser.uid
});

// 4. 使用命名查询
const myPosts = await flarebase.namedQuery('get_my_posts', {
  limit: 20
});
```

### REST API 使用

```bash
# 1. 认证获取 token
curl -X POST https://your-flarebase.com/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password"}'

# 2. 使用 token 调用 API（规则自动验证）
curl -X POST https://your-flarebase.com/query \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "posts",
    "filters": [["status", {"Eq": "published"}]],
    "limit": 10
  }'

# 3. 使用命名查询
curl -X POST https://your-flarebase.com/queries/list_published \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10}'
```

---

## 安全保证

### 1. 规则不可篡改

- 规则存储在 `__security_rules__` 集合中
- 只有管理员可以修改规则（需要 `admin` 权限）
- 普通用户无法读取或修改规则

### 2. 服务器端验证

- 所有验证在 Flarebase 服务器执行
- 客户端无法绕过验证
- 每次请求都会检查规则

### 3. 上下文注入安全

- `$USER_ID` 从认证 token 中提取，客户端无法伪造
- `$USER_ROLE` 从服务器端会话中获取
- 客户端参数 (`$params`) 经过严格验证

### 4. 审计日志

```json
{
  "timestamp": 1699123456789,
  "user_id": "user-123",
  "action": "query",
  "collection": "posts",
  "rule": "list_published",
  "result": "allowed",
  "ip": "192.168.1.1"
}
```

---

## 与白名单查询的区别

| 特性 | 白名单查询（旧） | Security Rules（新） |
|------|-----------------|---------------------|
| 存储位置 | 服务器配置文件 | Flarebase 数据库 |
| 部署方式 | 配置服务器 | CLI 部署 |
| 多应用隔离 | 不支持 | 完全隔离 |
| 权限表达式 | 不支持 | 支持 |
| 细粒度控制 | 查询级别 | 字段级别 |
| 无服务器 | 否 | 是 |

### 迁移指南

如果你的项目使用了旧的白名单查询系统：

```bash
# 1. 导出现有白名单配置
flare export whitelist > old_whitelist.json

# 2. 转换为新的规则格式
# (需要手动或使用转换工具)

# 3. 部署新规则
flare deploy rules

# 4. 更新客户端代码
# 旧的: namedQuery('query_name', params)
# 新的: 相同，但规则在服务器端管理
```

---

## 最佳实践

### 1. 最小权限原则

```json
{
  "allow_read": "resource.status == 'published'",
  "allow_write": "resource.author_id == auth.user_id && auth.role != 'guest'"
}
```

### 2. 使用角色

```json
{
  "allow_delete": "auth.role == 'admin' || resource.author_id == auth.user_id"
}
```

### 3. 验证数据完整性

```json
{
  "allow_write": "resource.author_id == auth.user_id && data.status != 'deleted'"
}
```

### 4. 组合条件

```json
{
  "allow_read": "auth != null && (resource.status == 'published' || resource.author_id == auth.user_id || auth.role == 'moderator')"
}
```

---

## FAQ

### Q: 规则会影响性能吗？

A: 规则验证有轻微性能开销，但 Flarebase 会缓存规则。对于高并发场景，建议使用命名查询。

### Q: 可以动态更新规则吗？

A: 可以，使用 `flare deploy rules` 或管理 API。规则更新后立即生效。

### Q: 规则支持版本控制吗？

A: 支持，每次部署会生成新版本。可以使用 `flare rules rollback` 回滚。

### Q: 如何调试规则？

A: 使用模拟器：
```bash
flare rules test --user=user-123 --action=read --collection=posts
```

---

## 相关文档

- [Security & Permissions](../core/SECURITY.md) - 权限系统概述
- [Query Whitelist](./QUERY_WHITELIST.md) - 查询白名单规范
- [Auth System](./AUTH.md) - 认证系统
