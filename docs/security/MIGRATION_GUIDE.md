# 🔄 迁移指南

## 从白名单查询迁移到 Security Rules

本文档帮助你从旧的白名单查询系统迁移到新的 Security Rules 系统。

---

## 📋 为什么要迁移？

### 旧系统的问题

```
❌ 白名单配置在服务器上
   - 需要配置 Flarebase 服务器
   - 多个应用共享服务器时无法隔离
   - 部署复杂，需要重启服务器
```

### 新系统的优势

```
✅ Security Rules 存储在数据库中
   - 完全无服务器
   - 每个应用独立管理
   - 通过 CLI 部署，即时生效
```

---

## 🎯 迁移步骤

### 步骤 1: 备份现有配置

```bash
# 导出当前的白名单配置
flare export whitelist > whitelist_backup.json
```

### 步骤 2: 转换配置格式

#### 旧格式 (白名单查询)

```json
{
  "queries": {
    "list_published_posts": {
      "type": "simple",
      "collection": "posts",
      "filters": [
        ["status", {"Eq": "published"}]
      ],
      "limit": "$params.limit"
    }
  }
}
```

#### 新格式 (Security Rules)

```json
{
  "version": "1",
  "rules": [
    {
      "collection": "posts",
      "allow_read": "auth != null && (resource.status == 'published' || resource.author_id == auth.user_id)",
      "allow_write": "auth != null && resource.author_id == auth.user_id",
      "allowed_queries": [
        {
          "name": "list_published_posts",
          "type": "simple",
          "collection": "posts",
          "filters": [
            ["status", {"Eq": "published"}]
          ],
          "limit": "$params.limit"
        }
      ]
    }
  ]
}
```

### 步骤 3: 创建 Security Rules 文件

创建 `security.rules.json`:

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
          "type": "simple",
          "collection": "posts",
          "filters": [
            ["status", {"Eq": "published"}]
          ],
          "limit": "$params.limit",
          "offset": "$params.offset"
        },
        {
          "name": "get_my_posts",
          "type": "simple",
          "collection": "posts",
          "filters": [
            ["author_id", {"Eq": "$USER_ID"}]
          ],
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

### 步骤 4: 部署新规则

```bash
# 安装最新版本的 CLI
npm install -g @flarebase/cli

# 登录（如果还没登录）
flare login

# 部署规则
flare deploy rules

# 验证部署
flare rules list
```

### 步骤 5: 更新客户端代码

客户端代码通常**不需要修改**，API 保持兼容：

```typescript
// 旧代码 - 继续工作
const posts = await flarebase.namedQuery('list_published_posts', {
  limit: 10
});

// 新代码 - 同样的 API
const posts = await flarebase.namedQuery('list_published', {
  limit: 10
});
```

### 步骤 6: 测试

```bash
# 使用模拟器测试规则
flare rules test \
  --user=user-123 \
  --action=read \
  --collection=posts \
  --data='{"status": "published"}'

# 测试命名查询
flare rules test-query \
  --user=user-123 \
  --query=list_published \
  --params='{"limit": 10}'
```

---

## 📊 配置映射表

### 白名单查询 → Security Rules

| 旧配置 (白名单) | 新配置 (Security Rules) | 说明 |
|----------------|------------------------|------|
| `queries` | `allowed_queries` | 嵌套在 `rules` 数组中 |
| `collection` | `collection` | 保持不变 |
| `filters` | `filters` | 保持不变 |
| `limit` | `limit` | 保持不变 |
| 不适用 | `allow_read` | 新增：读权限条件 |
| 不适用 | `allow_write` | 新增：写权限条件 |
| 不适用 | `allow_delete` | 新增：删除权限条件 |

### 完整示例对比

#### 旧配置

```json
{
  "queries": {
    "list_published": {
      "type": "simple",
      "collection": "posts",
      "filters": [
        ["status", {"Eq": "published"}]
      ],
      "limit": "$params.limit"
    },
    "get_my_posts": {
      "type": "simple",
      "collection": "posts",
      "filters": [
        ["author_id", {"Eq": "$USER_ID"}]
      ]
    }
  }
}
```

#### 新配置

```json
{
  "version": "1",
  "rules": [
    {
      "collection": "posts",
      "allow_read": "auth != null && (resource.status == 'published' || resource.author_id == auth.user_id)",
      "allow_write": "auth != null && resource.author_id == auth.user_id",
      "allowed_queries": [
        {
          "name": "list_published",
          "type": "simple",
          "collection": "posts",
          "filters": [
            ["status", {"Eq": "published"}]
          ],
          "limit": "$params.limit"
        },
        {
          "name": "get_my_posts",
          "type": "simple",
          "collection": "posts",
          "filters": [
            ["author_id", {"Eq": "$USER_ID"}]
          ]
        }
      ]
    }
  ]
}
```

---

## 🔄 常见迁移场景

### 场景 1: 简单查询

**旧配置**:
```json
{
  "queries": {
    "list_posts": {
      "collection": "posts",
      "filters": [["status", {"Eq": "published"}]]
    }
  }
}
```

**新配置**:
```json
{
  "version": "1",
  "rules": [
    {
      "collection": "posts",
      "allow_read": "auth != null",
      "allowed_queries": [
        {
          "name": "list_posts",
          "collection": "posts",
          "filters": [["status", {"Eq": "published"}]]
        }
      ]
    }
  ]
}
```

### 场景 2: 用户隔离查询

**旧配置**:
```json
{
  "queries": {
    "get_my_posts": {
      "collection": "posts",
      "filters": [["author_id", {"Eq": "$USER_ID"}]]
    }
  }
}
```

**新配置**:
```json
{
  "version": "1",
  "rules": [
    {
      "collection": "posts",
      "allow_read": "auth != null && resource.author_id == auth.user_id",
      "allowed_queries": [
        {
          "name": "get_my_posts",
          "collection": "posts",
          "filters": [["author_id", {"Eq": "$USER_ID"}]]
        }
      ]
    }
  ]
}
```

### 场景 3: 管理员查询

**旧配置**:
```json
{
  "queries": {
    "admin_get_all": {
      "collection": "users",
      "filters": []
    }
  }
}
```

**新配置**:
```json
{
  "version": "1",
  "rules": [
    {
      "collection": "users",
      "allow_read": "auth.role == 'admin'",
      "allowed_queries": [
        {
          "name": "admin_get_all",
          "collection": "users",
          "filters": [],
          "required_role": "admin"
        }
      ]
    }
  ]
}
```

---

## ⚠️ 注意事项

### 1. 权限表达式语法

Security Rules 使用表达式语法控制权限：

```javascript
// 旧系统：只能通过查询限制
"filters": [["author_id", {"Eq": "$USER_ID"}]]

// 新系统：可以使用表达式
"allow_read": "auth != null && resource.author_id == auth.user_id"
```

### 2. 查询命名

旧系统中的查询名称保持不变：

```typescript
// 客户端代码无需修改
await flarebase.namedQuery('list_published', { limit: 10 });
```

### 3. 部署流程

旧系统需要配置服务器，新系统使用 CLI：

```bash
# 旧系统
vim /etc/flarebase/named_queries.json
systemctl restart flarebase

# 新系统
flare deploy rules
```

---

## 🆘 故障排除

### 问题 1: 部署失败

```bash
# 检查语法
flare validate rules

# 查看详细错误
flare deploy rules --verbose
```

### 问题 2: 查询被拒绝

```bash
# 测试规则
flare rules test \
  --user=user-123 \
  --query=list_published

# 检查日志
flare logs --tail=50
```

### 问题 3: 权限不足

```bash
# 检查用户角色
flare auth list

# 添加管理员角色
flare auth promote user-123 admin
```

---

## 📚 更多资源

- [Security Rules 文档](./SECURITY_RULES.md)
- [Query Whitelist 文档](./QUERY_WHITELIST.md)
- [CLI 使用指南](../cli/USAGE.md)
- [FAQ](./SECURITY_RULES.md#faq)
