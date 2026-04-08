# 📋 测试覆盖分析报告

## 📖 文档需求 vs 实际测试覆盖

### 🔐 1. 用户注册流程 (USER_AND_ARTICLE_FLOWS.md)

#### **文档描述的流程：**

```
1. Client → Server: callHook("request_otp", { email })
2. Server → Hook: hook_request (websocket)
3. Hook → DB: insert("_internal_otps", { otp, email })
4. Hook → DB: insert("_session_{sid}_otp_status", { status: "sent" })
5. DB → Client: broadcast_op (event notification)
6. Client → Server: callHook("register_user", { email, otp, password })
7. Hook → DB: validate OTP, insert("users", { email, hashed_password })
8. Hook → DB: insert("_session_{sid}_reg_status", { status: "success" })
```

#### **当前测试覆盖情况：**

| 文档需求 | 当前测试 | 覆盖状态 | 缺失部分 |
|---------|---------|---------|---------|
| OTP 请求流程 | ❌ 无 | 🔴 **未覆盖** | 缺少 `request_otp` hook 测试 |
| OTP 存储验证 | ❌ 无 | 🔴 **未覆盖** | 缺少 `_internal_otps` 集合测试 |
| 会话级状态通知 | ❌ 无 | 🔴 **未覆盖** | 缺少 `_session_{sid}_otp_status` 测试 |
| 用户注册验证 | ✅ `test_user_registration_basic` | 🟡 **部分覆盖** | 有基本注册，但无 OTP 验证 |
| 用户状态转换 | ✅ `test_user_verification_flow` | 🟡 **部分覆盖** | 有状态转换，但无完整流程 |
| Session Table 监听 | ❌ 无 | 🔴 **未覆盖** | 缺少 `onSnapshot` 测试 |

#### **需要补充的测试：**

```rust
// ❌ 缺失：OTP 流程测试
#[tokio::test]
async fn test_request_otp_flow() {
    // 1. 测试 callHook("request_otp")
    // 2. 验证 OTP 存储到 _internal_otps
    // 3. 验证会话状态创建
}

// ❌ 缺失：OTP 验证测试
#[tokio::test]
async fn test_verify_otp_and_register() {
    // 1. 创建 OTP 记录
    // 2. 测试 callHook("register_user")
    // 3. 验证用户创建
}

// ❌ 缺失：Session Table 测试
#[tokio::test]
async fn test_session_table_notifications() {
    // 1. 测试 _session_{sid}_otp_status 创建
    // 2. 验证 broadcast_op 触发
    // 3. 验证客户端 onSnapshot 接收
}
```

---

### 📝 2. 文章管理流程 (USER_AND_ARTICLE_FLOWS.md)

#### **文档描述的流程：**

```
1. Draft Creation: published: false
2. Authorization: Check permissions.rs (author_id ownership)
3. Submission: Update status
4. Moderation: Admin sets published: true
5. Redacted Broadcast: Strip internal fields via Sync Policy
```

#### **当前测试覆盖情况：**

| 文档需求 | 当前测试 | 覆盖状态 | 实现情况 |
|---------|---------|---------|---------|
| 创建草稿文章 | ✅ `test_create_article_basic` | 🟢 **已覆盖** | `status: "draft"` ✅ |
| 作者权限检查 | ✅ `test_cannot_modify_others_article` | 🟢 **已覆盖** | 权限拒绝测试 ✅ |
| 更新自己的文章 | ✅ `test_update_own_article` | 🟢 **已覆盖** | 版本递增 ✅ |
| 文章提交审核 | ✅ `test_article_moderation_workflow` | 🟢 **已覆盖** | draft → published ✅ |
| 管理员审核 | ✅ `test_article_moderation_workflow` | 🟢 **已覆盖** | 状态变更 ✅ |
| **Sync Policy 数据脱敏** | ❌ 无 | 🔴 **未覆盖** | 缺少敏感字段过滤测试 |
| **广播操作脱敏** | ❌ 无 | 🔴 **未覆盖** | 缺少 `redact_internal_fields` 测试 |

#### **需要补充的测试：**

```rust
// ❌ 缺失：Sync Policy 配置测试
#[tokio::test]
async fn test_sync_policy_creation() {
    // 1. 创建 __config__/sync_policy_articles
    // 2. 设置 internal 字段
    // 3. 验证配置正确存储
}

// ❌ 缺失：数据脱敏测试
#[tokio::test]
async fn test_redact_internal_fields_on_broadcast() {
    // 1. 创建包含 internal_notes 的文章
    // 2. 调用 broadcast_op
    // 3. 验证 internal_notes 被移除
}

// ❌ 缺失：发布文章的脱敏广播
#[tokio::test]
async fn test_published_article_redaction() {
    // 1. 创建包含 moderator_id 的文章
    // 2. 发布文章
    // 3. 验证广播时 moderator_id 被过滤
}
```

---

## 📊 总体覆盖分析

### ✅ **已完全覆盖的功能 (50%)**

1. ✅ 基本用户注册
2. ✅ 用户状态管理
3. ✅ 文章创建
4. ✅ 文章权限控制（禁止修改别人的文章）
5. ✅ 文章审核流程
6. ✅ 版本管理
7. ✅ 查询功能

### 🔴 **未覆盖的关键功能 (50%)**

#### **用户注册相关：**
1. ❌ OTP 请求和验证流程
2. ❌ Hook 调用机制
3. ❌ 会话级状态管理
4. ❌ Session Table 通知
5. ❌ WebSocket 实时通信

#### **文章管理相关：**
1. ❌ Sync Policy 配置
2. ❌ 数据脱敏机制
3. ❌ 广播操作字段过滤
4. ❌ 内部字段保护

---

## 🔧 需要补充的测试模块

### 1. **Hook 系统集成测试**

```rust
// ❌ 缺失：完整的 Hook 流程测试
#[tokio::test]
async fn test_complete_user_registration_with_hooks() {
    // 1. 启动 Flarebase 服务器
    // 2. 启动 Auth Hook 服务
    // 3. 测试 request_otp 流程
    // 4. 测试 register_user 流程
    // 5. 验证完整的数据流
}
```

### 2. **Session 同步测试**

```rust
// ❌ 缺失：Session Table 测试
#[tokio::test]
async fn test_session_scoped_data_isolation() {
    // 1. 创建会话级数据
    // 2. 验证不同会话数据隔离
    // 3. 测试会话房间路由
}

#[tokio::test]
async fn test_session_table_realtime_updates() {
    // 1. 监听会话表
    // 2. 更新数据
    // 3. 验证实时通知
}
```

### 3. **数据脱敏测试**

```rust
// ❌ 缺失：Sync Policy 脱敏测试
#[tokio::test]
async fn test_sync_policy_fields_redaction() {
    // 1. 配置 Sync Policy
    // 2. 创建包含敏感字段的文档
    // 3. 广播到公开订阅者
    // 4. 验证敏感字段被移除
}

#[tokio::test]
async fn test_internal_fields_not_leaked() {
    // 1. 创建带 internal_notes 的文章
    // 2. 发布文章
    // 3. 从公开查询获取
    // 4. 验证 internal_notes 不可见
}
```

### 4. **WebSocket 实时通信测试**

```rust
// ❌ 缺失：Socket.IO 集成测试
#[tokio::test]
async fn test_websocket_realtime_article_updates() {
    // 1. 客户端连接 WebSocket
    // 2. 订阅文章集合
    // 3. 创建新文章
    // 4. 验证客户端收到实时更新
}

#[tokio::test]
async fn test_session_room_isolation() {
    // 1. 两个不同会话连接
    // 2. 验证只能接收自己的会话事件
    // 3. 验证跨会话数据隔离
}
```

---

## 🎯 建议的优先级

### **高优先级**（核心流程）

1. **OTP Hook 流程测试**
   - `test_request_otp_hook_integration`
   - `test_register_user_with_otp_verification`
   - `test_otp_storage_and_validation`

2. **数据脱敏测试**
   - `test_sync_policy_redaction`
   - `test_internal_fields_not_leaked_in_broadcast`
   - `test_published_article_sanitization`

3. **Session 同步测试**
   - `test_session_table_creation`
   - `test_session_scoped_notifications`
   - `test_session_room_routing`

### **中优先级**（重要功能）

4. **WebSocket 实时通信**
   - `test_websocket_article_updates`
   - `test_realtime_query_subscriptions`
   - `test_session_room_isolation`

5. **完整集成测试**
   - `test_end_to_end_user_registration`
   - `test_complete_article_lifecycle_with_hooks`

### **低优先级**（边界情况）

6. **错误处理**
   - `test_invalid_otp_handling`
   - `test_expired_otp_rejection`
   - `test_duplicate_registration_handling`

---

## 📈 当前覆盖率总结

| 功能模块 | 测试覆盖 | 状态 |
|---------|---------|------|
| **基础 CRUD** | ✅ 100% | 🟢 完成 |
| **权限控制** | ✅ 100% | 🟢 完成 |
| **文章管理** | ✅ 90% | 🟢 基本完成 |
| **用户注册** | 🟡 40% | 🔴 需要补充 |
| **Hook 系统** | ❌ 0% | 🔴 未实现 |
| **Session 同步** | ❌ 0% | 🔴 未实现 |
| **数据脱敏** | ❌ 0% | 🔴 未实现 |
| **WebSocket 通信** | ❌ 0% | 🔴 未实现 |
| **集成测试** | 🟡 20% | 🔴 需要补充 |

**总体覆盖率：约 40-50%**

---

## 🚀 下一步行动计划

### **阶段 1：补充核心流程测试**（高优先级）
1. 实现 OTP Hook 流程测试
2. 添加数据脱敏测试
3. 实现 Session 同步测试

### **阶段 2：完善集成测试**（中优先级）
4. 添加 WebSocket 实时通信测试
5. 实现端到端用户注册流程测试
6. 完整文章生命周期测试

### **阶段 3：增强边界测试**（低优先级）
7. 错误处理和边界条件测试
8. 性能和压力测试
9. 安全性测试

---

## 💡 结论

当前测试很好地覆盖了**基础的 CRUD 操作**和**权限控制逻辑**，但对于文档中描述的**高级功能**（Hook 系统、Session 同步、数据脱敏、WebSocket 通信）**覆盖不足**。

建议优先补充：
1. **OTP Hook 流程测试** - 文档核心功能
2. **数据脱敏测试** - 安全关键功能
3. **Session 同步测试** - 系统特色功能

这样可以确保测试覆盖与文档描述的功能完全一致。
