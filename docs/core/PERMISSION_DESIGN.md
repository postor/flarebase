# 🔒 Flarebase 权限系统详细设计

## 概述

Flarebase 实现了**多层权限控制**，从粗粒度到细粒度的完整安全体系。

## 权限层级架构

```
┌─────────────────────────────────────────────────────────────┐
│                    权限控制层级                              │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: 网络层                                            │
│  └─ TLS/SSL 加密传输                                        │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 认证层 (Authentication)                           │
│  └─ Bearer Token 验证 (user_id:role:email)                 │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: HTTP 路由层 (Route-level Authorization)          │
│  └─ extract_user_info() - 提取用户身份                      │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: 操作层 (Operation-level Authorization)           │
│  ├─ check_ownership() - 所有权验证                          │
│  ├─ check_field_modification() - 字段修改权限               │
│  └─ Authorizer - 细粒度权限检查                             │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: 数据层 (Data-level Authorization)                │
│  └─ SyncPolicy - 字段级别的数据脱敏                         │
└─────────────────────────────────────────────────────────────┘
```

## 1. 认证 (Authentication)

### 1.1 Token 格式

```
Bearer {user_id}:{role}:{email}
```

**示例：**
```
Authorization: Bearer user-123:admin:user@example.com
```

### 1.2 角色定义

| 角色 | 权限范围 | 说明 |
|------|---------|------|
| `admin` | 完全访问 | 可以操作所有资源 |
| `moderator` | 内容审核 | 可以修改内容状态，不能修改用户数据 |
| `user` | 标准用户 | 只能操作自己的资源 |
| `guest` | 只读访问 | 只能读取公开资源 |

### 1.3 认证流程

```rust
// 1. 从请求头提取 Token
pub fn extract_user_info(headers: &HeaderMap) -> Result<(String, String), StatusCode> {
    let auth_header = headers.get("Authorization")
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token = auth_header.to_str()?.strip_prefix("Bearer ")?;
    let parts: Vec<&str> = token.split(':').collect();

    let user_id = parts[0].to_string();
    let user_role = parts[1].to_string();

    Ok((user_id, user_role))
}
```

## 2. 授权 (Authorization)

### 2.1 资源所有权检查

**规则：**
- 用户只能修改/删除自己拥有的资源
- Admin 可以操作所有资源
- 防止权限提升攻击

```rust
pub fn check_ownership(
    user_id: &str,
    user_role: &str,
    resource_author_id: Option<&str>
) -> Result<(), StatusCode> {
    if let Some(author_id) = resource_author_id {
        if author_id != user_id && user_role != "admin" {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    Ok(())
}
```

**应用场景：**
- `DELETE /collections/:collection/:id`
- `PUT /collections/:collection/:id`

### 2.2 字段修改权限检查

**保护字段：**
- `author_id` / `owner_id` - 防止所有者篡改
- `role` - 防止权限提升
- `email` - 防止账户劫持
- `status` - 防止非法状态转换

```rust
pub fn check_field_modification(
    user_id: &str,
    user_role: &str,
    current_data: &Value,
    updates: &Value
) -> Result<(), StatusCode> {
    // 1. 防止修改 author_id
    if let Some(new_author) = updates.get("author_id") {
        let current_author = current_data.get("author_id").unwrap();
        if new_author != current_author {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    // 2. 防止修改 role (仅 admin)
    if user_role != "admin" && updates.get("role").is_some() {
        return Err(StatusCode::FORBIDDEN);
    }

    // 3. 检查所有权
    let author_id = current_data.get("author_id")
        .and_then(|a| a.as_str());
    check_ownership(user_id, user_role, author_id)?;

    Ok(())
}
```

### 2.3 细粒度权限检查 (Authorizer)

**按资源类型的权限规则：**

#### 文章 (Article)
```rust
pub fn can_read(ctx: &PermissionContext, resource: &Value) -> Result<bool> {
    match resource.get("status").as_str() {
        Some("published") => Ok(true),  // 公开文章任何人可读
        _ => {
            // 草稿只有作者和管理员可读
            Ok(ctx.user_id == author_id || ctx.user_role == "admin")
        }
    }
}

pub fn can_write(ctx: &PermissionContext, resource: &Value) -> Result<bool> {
    // 只有作者可以修改自己的文章
    if ctx.user_id == author_id {
        return Ok(true);
    }
    // Admin 可以修改任何文章
    if ctx.user_role == "admin" {
        return Ok(true);
    }
    Err(anyhow!("Permission denied"))
}

pub fn can_delete(ctx: &PermissionContext, resource: &Value) -> Result<bool> {
    // 只有作者可以删除自己的文章
    if ctx.user_id == author_id {
        return Ok(true);
    }
    // Admin 可以删除任何文章
    if ctx.user_role == "admin" {
        return Ok(true);
    }
    Err(anyhow!("Permission denied"))
}
```

#### 用户 (User)
```rust
pub fn can_read(ctx: &PermissionContext, resource: &Value) -> Result<bool> {
    // 用户可以读取自己的资料
    // Admin 可以读取所有用户资料
    Ok(ctx.user_id == ctx.resource_id || ctx.user_role == "admin")
}

pub fn can_write(ctx: &PermissionContext, resource: &Value) -> Result<bool> {
    // 用户只能修改自己的资料
    if ctx.user_id == ctx.resource_id {
        return Ok(true);
    }
    Err(anyhow!("Permission denied"))
}
```

#### 评论 (Comment)
```rust
pub fn can_delete(ctx: &PermissionContext, resource: &Value) -> Result<bool> {
    let comment_author = resource.get("author_id").as_str();

    // 作者可以删除自己的评论
    if ctx.user_id == comment_author {
        return Ok(true);
    }

    // Admin 和 Moderator 可以删除任何评论
    if ctx.user_role == "admin" || ctx.user_role == "moderator" {
        return Ok(true);
    }

    Err(anyhow!("Permission denied"))
}
```

## 3. 批量操作权限 (Batch Operations)

### 3.1 批量操作的权限检查策略

**批量操作必须进行逐个权限检查！**

```rust
async fn commit_transaction(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<TransactionRequest>,
) -> Response {
    // 🔒 1. 认证检查
    let (user_id, user_role) = match extract_user_info(&headers) {
        Ok(info) => info,
        Err(status) => return status.into_response(),
    };

    // 🔒 2. 逐个检查每个操作的权限
    for operation in &req.operations {
        match operation {
            BatchOperation::Set(doc) => {
                // 创建操作检查：确保 author_id 与当前用户一致
                let author_id = doc.data.get("author_id")
                    .and_then(|a| a.as_str());

                if let Some(author) = author_id {
                    if author != user_id && user_role != "admin" {
                        return (StatusCode::FORBIDDEN, "Cannot create document for other user").into_response();
                    }
                }
            }

            BatchOperation::Update { collection, id, updates } => {
                // 更新操作检查：验证所有权和字段修改权限
                if let Ok(Some(doc)) = state.storage.get(collection, id).await {
                    if let Err(status) = check_field_modification(&user_id, &user_role, &doc.data, updates) {
                        return status.into_response();
                    }
                } else {
                    return StatusCode::NOT_FOUND.into_response();
                }
            }

            BatchOperation::Delete { collection, id } => {
                // 删除操作检查：验证所有权
                if let Ok(Some(doc)) = state.storage.get(collection, id).await {
                    let author_id = doc.data.get("author_id")
                        .and_then(|a| a.as_str());

                    if let Err(status) = check_ownership(&user_id, &user_role, author_id) {
                        return status.into_response();
                    }
                } else {
                    return StatusCode::NOT_FOUND.into_response();
                }
            }

            _ => {}
        }
    }

    // 🔒 3. 所有权限检查通过，执行批量操作
    let _ = state.storage.apply_batch(req.operations).await;

    // ... 广播事件 ...
    Json(true).into_response()
}
```

### 3.2 查询权限检查

```rust
async fn run_query(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(query): Json<Query>,
) -> Response {
    // 🔒 对于查询，可以选择是否需要认证
    // 如果查询包含敏感字段过滤，需要认证

    // 可选：允许未认证的公开查询
    // 但对于用户数据的查询，必须认证

    let docs = state.storage.query(query).await.unwrap();

    // 🔒 对结果进行过滤，只返回用户有权访问的文档
    let filtered_docs: Vec<Document> = docs.into_iter()
        .filter(|doc| {
            // 公开文章所有人可见
            if doc.data.get("status").and_then(|s| s.as_str()) == Some("published") {
                return true;
            }
            // 其他文档需要所有权
            true // 这里简化了，实际应该检查用户身份
        })
        .collect();

    Json(filtered_docs).into_response()
}
```

## 4. 字段级权限 (Field-level Permissions)

### 4.1 敏感字段定义

```rust
const SENSITIVE_FIELDS: &[&str] = &[
    "password_hash",
    "email",
    "phone",
    "secret",
    "api_key",
    "session_token",
    "internal_notes",
    "status",  // 仅对非管理员隐藏
];
```

### 4.2 数据脱敏

```rust
pub fn sanitize_user_data(
    user_data: &Value,
    requester_id: &str,
    requester_role: &str
) -> Value {
    let is_own_profile = user_data.get("id")
        .and_then(|id| id.as_str())
        .map(|id| id == requester_id)
        .unwrap_or(false);

    let is_admin = requester_role == "admin";

    if is_own_profile || is_admin {
        user_data.clone()
    } else {
        // 移除敏感字段
        let mut sanitized = user_data.clone();
        if let Some(obj) = sanitized.as_object_mut() {
            for field in SENSITIVE_FIELDS {
                obj.remove(*field);
            }
        }
        sanitized
    }
}
```

### 4.3 SyncPolicy 实时数据脱敏

```rust
async fn redact_internal_fields(
    state: &Arc<AppState>,
    collection: &str,
    data: &mut serde_json::Value
) {
    // 从数据库获取该集合的脱敏策略
    if let Ok(Some(policy_doc)) = state.storage
        .get("__config__", &format!("sync_policy_{}", collection)).await
    {
        if let Some(internal_fields) = policy_doc.data
            .get("internal")
            .and_then(|v| v.as_array())
        {
            if let Some(obj) = data.as_object_mut() {
                for field in internal_fields {
                    if let Some(f_str) = field.as_str() {
                        obj.remove(f_str);
                    }
                }
            }
        }
    }
}
```

## 5. 安全测试场景

### 5.1 单个文档操作

✅ **已实现：**
- 无认证删除/修改/创建 → 401
- 跨用户删除/修改 → 403
- 修改 author_id → 403

### 5.2 批量操作 (⚠️ **需要实现**)

```javascript
// 🚨 场景1: 批量删除其他用户的文档
POST /transaction
{
  "operations": [
    { "Delete": { "collection": "posts", "id": "admin-post-1" } },
    { "Delete": { "collection": "posts", "id": "admin-post-2" } }
  ]
}
// 应该返回 403 Forbidden

// 🚨 场景2: 批量修改敏感字段
POST /transaction
{
  "operations": [
    {
      "Update": {
        "collection": "posts",
        "id": "my-post",
        "updates": { "author_id": "hacker-999" }
      }
    }
  ]
}
// 应该返回 403 Forbidden

// 🚨 场景3: 批量创建时冒充其他用户
POST /transaction
{
  "operations": [
    {
      "Set": {
        "collection": "posts",
        "data": { "author_id": "victim-123", "title": "Fake Post" }
      }
    }
  ]
}
// 应该返回 403 Forbidden
```

### 5.3 查询操作

```javascript
// 场景1: 查询所有草稿（应该只返回自己的）
POST /query
{
  "collection": "posts",
  "filters": { "status": "draft" }
}
// 应该只返回当前用户的草稿

// 场景2: 批量查询用户信息（应该脱敏）
POST /query
{
  "collection": "users",
  "filters": {}
}
// 返回结果中应该不包含 password_hash, email 等字段
```

## 6. 实施清单

### ✅ 已完成
- [x] HTTP 单个操作权限检查
- [x] 所有权验证
- [x] 字段修改保护
- [x] Authorizer 细粒度权限
- [x] 数据脱敏

### ⚠️ 需要修复
- [ ] **批量操作权限检查** - 严重安全漏洞！
- [ ] **查询权限过滤** - 需要实现
- [ ] 批量操作的防御测试
- [ ] 查询操作的防御测试

### 📝 待设计
- [ ] 基于角色的访问控制 (RBAC) 增强
- [ ] 基于属性的访问控制 (ABAC)
- [ ] 审计日志系统
- [ ] 权限缓存机制

## 7. 安全最佳实践

### 7.1 防御深度 (Defense in Depth)

```
1. 网络层：TLS 加密
2. 认证层：Token 验证
3. 路由层：操作类型检查
4. 业务层：所有权验证
5. 数据层：字段脱敏
```

### 7.2 最小权限原则

- 默认拒绝所有访问
- 仅授予必要的最小权限
- 定期审计权限配置

### 7.3 审计和监控

- 记录所有敏感操作
- 监控异常权限请求
- 定期安全审计

## 8. 参考资料

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [API Security Best Practices](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [RFC 6819 - OAuth 2.0 Threat Model](https://datatracker.ietf.org/doc/html/rfc6819)
