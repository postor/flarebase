# 🔒 安全漏洞修复方案

## 🚨 发现的安全问题

### 严重程度: **CRITICAL**

当前Flarebase HTTP API存在**严重的权限漏洞**：

1. ❌ **无身份验证**: HTTP端点完全没有用户认证
2. ❌ **无权限检查**: 任何人都可以删除/修改任何文档
3. ❌ **无所有权验证**: 用户可以操作其他用户的资源
4. ❌ **无会话管理**: 没有token验证或session管理

## 📋 演示攻击场景

```bash
# 攻击者可以删除管理员的文章
curl -X DELETE http://localhost:3000/collections/posts/admin-post-id

# 攻击者可以修改文章作者
curl -X PUT http://localhost:3000/collections/posts/user-post-id \
  -H "Content-Type: application/json" \
  -d '{"author_id": "hacker", "content": "HACKED!"}'
```

## ✅ 修复方案

### 1. 认证中间件 (`auth.rs`)

```rust
// 从请求头提取用户信息
pub async fn extract_user_from_request(
    request: &Request,
    state: &Arc<AppState>
) -> Result<AuthUser, StatusCode>

// 检查文档操作权限
pub fn check_document_permission(
    user: &AuthUser,
    collection: &str,
    document: &Value,
    operation: &str,
) -> Result<(), Response>
```

### 2. 安全的HTTP处理器 (`secure_handlers.rs`)

```rust
// 安全的删除操作
pub async fn secure_delete_doc(...) {
    let user = extract_user_from_request(&request, &state).await?;
    let doc = state.storage.get(&collection, &id).await?;
    check_document_permission(&user, &collection, &doc.data, "delete")?;
    // 执行删除...
}

// 安全的更新操作
pub async fn secure_update_doc(...) {
    let user = extract_user_from_request(&request, &state).await?;
    let current_doc = state.storage.get(&collection, &id).await?;
    validate_update_permissions(&user, &collection, &current_doc.data, &updates)?;
    // 执行更新...
}
```

### 3. 客户端集成

#### 3.1 添加认证头到Flarebase客户端

```typescript
class FlarebaseClient {
  private getAuthHeaders() {
    const token = localStorage.getItem('auth_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  async delete(id: string): Promise<boolean> {
    const response = await fetch(`${this.baseURL}/collections/${name}/${id}`, {
      method: 'DELETE',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json'
      }
    });
    return response.ok;
  }
}
```

#### 3.2 登录时获取token

```typescript
async function login(email: string, password: string) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const { token, user } = await response.json();
  
  // 存储token
  localStorage.setItem('auth_token', token);
  localStorage.setItem('user', JSON.stringify(user));
}
```

### 4. 服务器配置

#### 4.1 更新main.rs使用安全处理器

```rust
// 替换不安全的路由
.delete("/collections/:collection/:id", secure_delete_doc)
.put("/collections/:collection/:id", secure_update_doc)
.get("/collections/:collection/:id", secure_get_doc)
.post("/collections/:collection", secure_create_doc)
```

#### 4.2 添加认证路由

```rust
// 登录路由
async fn login(Json(req): Json<LoginRequest>) -> Json<LoginResponse> {
    // 验证用户凭据
    // 生成JWT token: "user_id:role:email"
    let token = format!("{}:{}:{}", user.id, user.data.role, user.data.email);
    
    Json(LoginResponse { token, user })
}
```

## 🧪 测试安全修复

### 1. 运行安全演示脚本

```bash
cd examples/blog-platform
node scripts/security-demo.js
```

### 2. 运行安全测试

```bash
cd clients/react
npm test -- security.test.jsx
```

### 3. 手动测试权限

```bash
# 创建用户A的文章
USER_A_TOKEN="user-a:author:a@example.com"
curl -X POST http://localhost:3000/collections/posts \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -d '{"title": "User A Post"}'

# 尝试用用户B删除用户A的文章 (应该失败)
USER_B_TOKEN="user-b:author:b@example.com"
curl -X DELETE http://localhost:3000/collections/posts/<post-id> \
  -H "Authorization: Bearer $USER_B_TOKEN" \
  # 应该返回 403 Forbidden
```

## 🔐 安全最佳实践

### 1. **最小权限原则**
- 普通用户只能操作自己的资源
- Admin可以操作所有资源
- 敏感操作需要二次验证

### 2. **所有权验证**
- 每个文档都有`author_id`或`owner_id`
- 删除/修改操作验证所有权
- 防止权限提升攻击

### 3. **字段级别权限**
- 防止修改`author_id`
- 限制状态变更权限
- 敏感字段需要admin权限

### 4. **会话管理**
- 使用JWT或session tokens
- Token过期时间
- 刷新token机制

### 5. **审计日志**
- 记录所有敏感操作
- 记录操作者和时间
- 记录操作结果

## 📝 实施步骤

1. **立即修复** (关键)
   - 在Express服务器添加认证中间件
   - 验证所有write操作的权限
   - 回滚不安全的部署

2. **短期修复** (重要)
   - 实现JWT token系统
   - 更新Flarebase服务器使用安全处理器
   - 添加用户登录/注册API

3. **长期改进** (重要)
   - 实现基于角色的访问控制(RBAC)
   - 添加审计日志系统
   - 定期安全审计

## ⚠️ 当前状态

- ❌ **不安全**: 当前HTTP API没有任何权限检查
- ✅ **有权限系统**: Flarebase有完整的权限实现
- ⚠️ **未应用**: 权限系统没有应用到HTTP层
- 🔄 **需要修复**: 立即应用安全补丁

## 🚀 立即行动

1. **停止使用不安全的API直接访问**
2. **通过Express服务器代理所有操作**
3. **在Express层添加权限检查**
4. **实施安全修复**