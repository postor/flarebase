# Flarebase 注册流程集成测试

这个测试套件模拟了完整的用户注册流程,包括 OTP 请求、验证和用户创建。

## 测试概述

### 测试覆盖的场景

1. **OTP 请求流程** (`test_complete_otp_request_flow`)
   - 生成并存储 OTP
   - 创建会话级状态通知
   - 验证 OTP 和会话状态创建成功

2. **完整注册流程** (`test_complete_user_registration_flow`)
   - 预创建 OTP 记录
   - 验证 OTP 有效性
   - 检查过期时间
   - 创建用户记录
   - 标记 OTP 为已使用
   - 更新会话状态

3. **错误场景处理**
   - `test_registration_with_invalid_otp`: 无效 OTP 拒绝
   - `test_registration_with_expired_otp`: 过期 OTP 拒绝
   - `test_registration_with_duplicate_email`: 重复邮箱检测
   - `test_otp_reuse_prevention`: OTP 重用防护

4. **批量操作** (`test_batch_registration_cleanup`)
   - 批量清理过期的 OTP 记录
   - 测试事务性批量删除

5. **会话隔离** (`test_multi_session_registration_isolation`)
   - 多会话并发注册的数据隔离
   - 验证不同会话不会互相干扰

6. **端到端场景** (`test_end_to_end_registration_scenario`)
   - 完整的用户 Alice 注册流程
   - 包含所有步骤的集成测试

## 运行测试

### 运行所有注册集成测试
```bash
cd packages/flare-server
cargo test --test registration_integration_test
```

### 运行单个测试
```bash
cargo test --test registration_integration_test test_complete_otp_request_flow
```

### 带输出运行测试
```bash
cargo test --test registration_integration_test -- --nocapture
```

## 数据流程

### 1. OTP 请求阶段
```
Client → Hook Server → SledDB
├─ 写入 _internal_otps 集合
│  └─ { email, otp, created_at, expires_at, used: false }
└─ 写入 _session_{sid}_otp_status 集合
   └─ { status: "sent", email, message }
```

### 2. OTP 验证阶段
```
Client → Hook Server → SledDB
├─ 查询 _internal_otps
│  └─ WHERE email = ? AND otp = ? AND used = false
├─ 检查 expires_at > now()
└─ 创建用户记录
   └─ INSERT INTO users { email, password_hash, name, status, role }
```

### 3. 完成注册阶段
```
Client → Hook Server → SledDB
├─ 更新 _internal_otps
│  └─ SET used = true, used_at = ?
└─ 更新会话状态
   └─ _session_{sid}_otp_status { status: "success", user_id }
```

## 关键集合说明

### `_internal_otps` (内部 OTP 存储)
- 用途: 存储所有生成的 OTP
- 访问权限: 仅限 Hook Server (内部)
- 字段:
  - `email`: 用户邮箱
  - `otp`: 6 位数字验证码
  - `created_at`: 创建时间戳
  - `expires_at`: 过期时间戳 (通常是创建后 5 分钟)
  - `used`: 是否已使用 (boolean)
  - `used_at`: 使用时间戳 (可选)

### `users` (用户集合)
- 用途: 存储注册用户信息
- 访问权限: 用户本人 + 管理员
- 字段:
  - `email`: 邮箱 (唯一)
  - `password_hash`: 密码哈希
  - `name`: 用户名
  - `status`: 状态 (active/suspended)
  - `role`: 角色 (user/admin/moderator)
  - `created_at`: 注册时间

### `_session_{sid}_otp_status` (会话级 OTP 状态)
- 用途: 向客户端发送 OTP 状态更新
- 访问权限: 仅限对应会话
- 特性: 会话隔离,实时通知
- 字段:
  - `status`: sent/success/error
  - `email`: 关联邮箱
  - `message`: 状态消息
  - `user_id`: 成功注册后的用户 ID (可选)

## 安全考虑

### OTP 安全
- ✓ OTP 过期时间: 5 分钟
- ✓ OTP 使用后立即标记为已使用
- ✓ 防止 OTP 重用攻击
- ✓ OTP 仅存储哈希值 (实际应用中)

### 会话隔离
- ✓ 每个会话有独立的状态集合
- ✓ 使用 `_session_{sid}_` 前缀隔离
- ✓ Socket.IO 房间自动路由到正确会话

### 数据验证
- ✓ 邮箱唯一性检查
- ✓ OTP 格式验证
- ✓ 过期时间检查
- ✓ 密码强度验证 (Hook 层)

## 扩展测试

### 添加新的测试场景

1. 在 `registration_integration_test.rs` 中添加新测试函数:
```rust
#[tokio::test]
async fn test_your_new_scenario() {
    let storage = create_test_storage().await;

    // 你的测试逻辑

    println!("✓ Your scenario passed");
}
```

2. 运行新测试:
```bash
cargo test --test registration_integration_test test_your_new_scenario
```

## 相关文档

- [用户和文章流程](../../../docs/flows/USER_AND_ARTICLE_FLOWS.md)
- [Hook 协议](../../../docs/features/HOOKS_PROTOCOL.md)
- [会话同步](../../../docs/features/SESSION_SYNC.md)
- [安全与权限](../../../docs/core/SECURITY.md)

## 性能基准

测试运行时间 (参考):
- 单个测试: ~5-10ms
- 完整测试套件: ~80ms
- 数据库: Sled (嵌入式)

## 贡献指南

修改或添加测试时:
1. 保持测试独立性和幂等性
2. 使用 `tempfile` 创建临时数据库
3. 每个测试应有清晰的步骤注释
4. 使用 `println!` 输出成功消息 (便于调试)
5. 测试命名应描述其目的

## 许可证

MIT License - 详见项目根目录 LICENSE 文件
