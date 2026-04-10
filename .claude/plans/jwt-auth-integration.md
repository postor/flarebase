# JWT 认证集成实现计划

## 目标
1. 恢复 REST 接口，仅限 SWR 使用（JWT 验证身份）
2. 自动对 header 的 JWT 进行验证
3. 将 'auth' hook 变成固定命名
4. 在 hook 中返回 $jwt 对象，在 JS/React/Vue 库中处理

## 实现步骤

### 1. 服务器端 (Rust)
- [ ] 创建 JWT 验证中间件模块 (`src/jwt_middleware.rs`)
  - JWT 解析和验证函数
  - 从 Authorization header 提取 JWT
  - 将用户信息注入请求上下文

- [ ] 修改 REST 接口，添加 JWT 验证
  - `/collections/:collection` - GET/POST (需要 JWT)
  - `/collections/:collection/:id` - GET/PUT/DELETE (需要 JWT)
  - `/queries/:name` - POST (需要 JWT，用于 SWR)

- [ ] 创建特殊的 'auth' hook 处理
  - 在 HookManager 中添加固定 'auth' hook 支持
  - 在 hook_request 中注入 $jwt 对象
  - 处理登录/注册逻辑

- [ ] 更新白名单查询，支持 JWT 用户上下文
  - 从 JWT 提取 user_id 和 role
  - 传递给 UserContext

### 2. 客户端 SDK (JavaScript)
- [ ] 更新 FlareClient 类
  - 添加 JWT 存储 (localStorage)
  - 在所有请求中自动添加 Authorization header
  - 添加 login() 方法处理 auth hook

- [ ] 创建 SWR 集成
  - fetcher 函数使用 JWT
  - 自动刷新 token 机制

### 3. 示例应用
- [ ] 更新示例应用使用新的 JWT 认证

## 文件修改清单

### 服务器端
- `packages/flare-server/src/main.rs` - 添加 JWT 中间件到路由
- `packages/flare-server/src/jwt_middleware.rs` - **新建** JWT 验证模块
- `packages/flare-server/src/hook_manager.rs` - 添加 $jwt 注入到 hook_request
- `packages/flare-server/src/whitelist.rs` - 更新以使用 JWT 用户信息

### 客户端
- `clients/js/src/index.js` - 添加 JWT 支持和 SWR 集成
- `examples/blog-platform/src/lib/flarebase.ts` - 更新使用新的认证

## 技术细节

### JWT 格式
```json
{
  "user_id": "...",
  "email": "...",
  "role": "user|admin",
  "exp": 1234567890
}
```

### Authorization Header
```
Authorization: Bearer <JWT_TOKEN>
```

### Hook $jwt 对象
```json
{
  "$jwt": {
    "user_id": "...",
    "email": "...",
    "role": "user|admin"
  }
}
```

### Auth Hook 协议
**请求**:
```json
{
  "event_name": "auth",
  "params": {
    "action": "login|register",
    "email": "...",
    "password": "..."
  },
  "$jwt": null  // 初始请求时为 null
}
```

**响应**:
```json
{
  "token": "<JWT_TOKEN>",
  "user": { ... }
}
```
