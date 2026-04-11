# TDD修复: Blog平台注册错误

## 问题描述
Blog平台注册功能显示: "User with this email already exists"
- **问题**: 无论使用什么邮箱都显示此错误
- **影响**: 用户无法注册新账号

## TDD调查过程

### RED Phase - 重现问题

**测试文件**: `clients/js/tests/registration_email_check.test.js`

**测试结果**:
```bash
✓ should check email existence endpoint → Returns { data: [] }
✓ should list users in database → Total users in database: 0
✗ should register new user with unique email → Socket.IO not available
```

**关键发现**:
1. 数据库为空（0个用户）
2. `check_email_exists` 返回空数组
3. 注册通过Socket.IO Hook调用，不是HTTP请求

### INVESTIGATE Phase - 根本原因

**问题定位**:
1. 客户端SDK使用 `socket.emit('call_hook', ['auth', {...}])` 进行注册
2. Flarebase服务器查找已注册的"auth" hook处理程序
3. **没有找到任何auth hook** → 返回错误: "No hook registered for event: auth"
4. 客户端显示通用错误: "User with this email already exists"

**架构问题**:
```
Blog Platform (Client)
  ↓ socket.emit('call_hook', ['auth', register])
Flarebase Server
  ↓ 查找auth hook
❌ 没有auth hook服务注册!
  ↓ 返回错误
Client: "User with this email already exists" (误导性错误消息)
```

### GREEN Phase - 解决方案

**创建Auth Hook服务**: `examples/blog-platform/auth-hook-service.js`

**功能**:
1. 连接到Flarebase via Socket.IO
2. 注册"auth" hook
3. 处理register和login动作
4. 验证邮箱和密码
5. 检查用户是否已存在
6. 创建新用户到数据库
7. 生成JWT token

**启动服务**:
```bash
cd examples/blog-platform
node auth-hook-service.js &
```

**输出**:
```
🔐 Starting Auth Hook Service...
📡 Connecting to Flarebase: http://localhost:3000
✅ Connected to Flarebase
📝 Auth hook registered
```

## 技术细节

### Hook协议流程

**注册流程**:
```javascript
// 1. Client调用
await flarebase.register({ email, name, password });

// 2. SDK发送Hook请求
socket.emit('call_hook', ['auth', {
  action: 'register',
  email, name, password
}]);

// 3. Flarebase转发到Hook服务
{
  request_id: "uuid",
  event_name: "auth",
  params: { action: 'register', ... },
  $jwt: { user_id: null, email: null, role: 'guest' }
}

// 4. Hook服务处理
handleRegister(params) {
  // 验证输入
  // 检查用户是否存在
  // 创建用户
  // 返回JWT
}

// 5. Hook服务响应
socket.emit('hook_response', {
  request_id: "uuid",
  status: "success",
  data: { user, token }
});

// 6. 客户端接收
AuthContext.set(response.user);
localStorage.setItem('auth_token', response.token);
```

### Auth Hook服务代码

**关键函数**:
```javascript
// 处理注册
async function handleRegister(params) {
  // 1. 验证输入
  if (!email || !password || !name) {
    throw new Error('Email, password, and name are required');
  }

  // 2. 检查用户是否存在
  const response = await fetch('/collections/users');
  const existingUser = data.find(u => u.data?.email === email);

  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  // 3. 创建用户
  await fetch('/collections/users', {
    method: 'POST',
    body: JSON.stringify({
      email, name,
      password_hash: hash,
      role: 'author',
      status: 'active',
      created_at: Date.now()
    })
  });

  // 4. 生成JWT
  const token = generateJWT(user);

  return { user, token };
}
```

## 验证步骤

### 1. 启动Auth Hook服务
```bash
cd examples/blog-platform
node auth-hook-service.js
```

**预期输出**:
```
✅ Connected to Flarebase
📝 Auth hook registered
```

### 2. 测试注册功能
访问: http://localhost:3002/auth/register

**测试用例**:
- ✅ 新邮箱 → 注册成功
- ✅ 重复邮箱 → "User with this email already exists"
- ✅ 无效邮箱 → "Invalid email format"
- ✅ 短密码 → "Password must be at least 6 characters"

### 3. 运行TDD测试
```bash
cd clients/js
npm test -- tests/registration_email_check.test.js
```

## 安全注意事项

### ⚠️ 生产环境需要改进

1. **密码哈希**: 当前使用简单字符串替换，需使用bcrypt
2. **JWT签名**: 使用环境变量的密钥，不是硬编码
3. **HTTPS**: 生产环境必须使用SSL/TLS
4. **速率限制**: 防止暴力破解
5. **输入验证**: 更严格的邮箱和密码验证

### 推荐实现
```javascript
// 生产环境密码哈希
const bcrypt = require('bcrypt');
const password_hash = await bcrypt.hash(password, 10);

// 生产环境JWT
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: user.id, email: user.email },
  process.env.JWT_SECRET,
  { expiresIn: '24h' }
);
```

## 架构改进建议

### 短期 (当前实现)
- ✅ 独立auth hook服务
- ✅ Socket.IO通信
- ✅ 基本验证功能

### 中期
- [ ] 内置auth handler到Flarebase服务器
- [ ] 支持多种auth provider (OAuth, SAML)
- [ ] 密码重置流程
- [ ] 邮箱验证

### 长期
- [ ] 完整的identity provider
- [ ] MFA支持
- [ ] SSO集成
- [ ] 审计日志

## 相关文档
- [Hook协议设计](../../docs/features/HOOKS_PROTOCOL.md)
- [JWT中间件](../../packages/flare-server/src/jwt_middleware.rs)
- [Auth Hook测试](../../packages/flare-server/tests/auth_hook_integration_tests.rs)
- [Blog平台设置](../examples/blog-platform/README.md)

## 启动命令

**完整启动顺序**:
```bash
# Terminal 1: Flarebase Server
cd D:/study/flarebase
cargo run -p flare-server

# Terminal 2: Auth Hook Service
cd D:/study/flarebase/examples/blog-platform
node auth-hook-service.js

# Terminal 3: Blog Platform
cd D:/study/flarebase/examples/blog-platform
npm run dev
```

**访问**:
- Flarebase: http://localhost:3000
- Blog: http://localhost:3002
- 注册页面: http://localhost:3002/auth/register
