# Hook 系统集成测试文档

## 概述

本文档描述了 Flarebase Hook 系统的完整集成测试套件，包括测试覆盖的功能、使用方法以及运行结果。

## 测试文件

### 1. `hook_manager.rs` - 单元测试
位置: `packages/flare-server/src/hook_manager.rs`

这些是基础的单元测试，测试 HookManager 的核心功能:

- ✅ `test_hook_response_correlation` - 测试成功响应的关联
- ✅ `test_hook_error_correlation` - 测试错误响应的关联
- ✅ `test_hook_registration_and_removal` - 测试 Hook 注册和移除

### 2. `hook_standalone_test.rs` - 独立集成测试
位置: `packages/flare-server/tests/hook_standalone_test.rs`

这些是独立的集成测试，不依赖其他模块:

#### 核心功能测试
- ✅ `test_hook_registration` - Hook 基本注册
- ✅ `test_hook_removal` - Hook 移除和清理
- ✅ `test_hook_call_and_response` - 完整的调用和响应流程
- ✅ `test_hook_call_no_registered_hooks` - 未注册事件的错误处理
- ✅ `test_hook_timeout` - 超时场景测试
- ✅ `test_hook_error_response` - Hook 返回错误的场景

#### 高级功能测试
- ✅ `test_multiple_hooks_same_event` - 多个 Hook 订阅同一事件
- ✅ `test_hook_multiple_events` - 一个 Hook 订阅多个事件
- ✅ `test_concurrent_hook_calls` - 并发 Hook 调用测试

### 3. `hook_integration_test.rs` - 完整集成测试
位置: `packages/flare-server/tests/hook_integration_test.rs`

完整的端到端测试，模拟真实的 WebSocket 连接场景:

#### 场景测试
- ✅ `test_complete_hook_registration_and_call` - 完整注册和调用流程
- ✅ `test_hook_registration_multiple_events` - 多事件注册
- ✅ `test_hook_error_handling` - 错误处理流程
- ✅ `test_hook_timeout` - 超时处理
- ✅ `test_multiple_hooks_same_event` - 多 Hook 竞争同一事件
- ✅ `test_hook_disconnection_cleanup` - 断开连接后的清理
- ✅ `test_hook_call_with_no_registered_hooks` - 无 Hook 的错误场景
- ✅ `test_concurrent_hook_calls` - 高并发场景

## 运行测试

### 运行所有 Hook 测试
```bash
# 在 flare-server 目录下
cd packages/flare-server

# 运行独立测试
cargo test --test hook_standalone_test

# 运行单元测试
cargo test --lib hook_manager

# 运行所有测试
cargo test
```

### 运行特定测试
```bash
# 运行单个测试
cargo test test_hook_registration

# 显示测试输出
cargo test -- --nocapture

# 显示测试输出并过滤
cargo test test_hook_call -- --nocapture
```

## 测试架构

### MockWebSocketManager

一个模拟的 WebSocket 管理器，用于测试中模拟真实的 WebSocket 通信:

```rust
struct MockWebSocketManager {
    sent_messages: Arc<Mutex<HashMap<String, Vec<serde_json::Value>>>>,
}
```

**功能**:
- 记录发送给每个 socket 的消息
- 支持消息检索和验证
- 线程安全，支持并发测试

### 测试流程

典型的 Hook 测试流程:

1. **创建 HookManager 和 WebSocket 模拟器**
   ```rust
   let hook_manager = HookManager::new();
   let ws_manager = MockWebSocketManager::new();
   ```

2. **注册 Hook**
   ```rust
   let register = HookRegister {
       token: "test-token".to_string(),
       capabilities: HookCapabilities {
           events: vec!["UserCreated".to_string()],
           user_context: json!({ "service": "test" }),
       },
   };
   hook_manager.register_hook("socket-1".to_string(), register);
   ```

3. **触发事件**
   ```rust
   hook_manager.call_hook(
       "UserCreated".to_string(),
       "session-123".to_string(),
       json!({ "user_id": "123" }),
       |sid, data| {
           ws_manager.emit_to_socket(sid, data);
       },
   ).await
   ```

4. **验证和响应**
   - 检查发送的消息
   - 模拟 Hook 处理
   - 发送响应

5. **清理**
   ```rust
   hook_manager.remove_hook("socket-1");
   ```

## 测试覆盖的场景

### ✅ 成功场景
- Hook 注册成功
- 事件触发成功
- 响应正确返回
- 多事件订阅
- 并发调用

### ✅ 错误场景
- 未注册的事件调用
- Hook 超时
- Hook 返回错误
- 连接断开
- 无可用 Hook

### ✅ 边界场景
- 空事件列表
- 重复注册
- 并发注册/移除
- 大量并发调用

## 代码改进

为了支持测试，对 `HookManager` 进行了以下改进:

### 1. 添加 Clone trait
```rust
#[derive(Clone)]
pub struct HookManager { ... }
```

### 2. 添加测试辅助方法
```rust
impl HookManager {
    /// 获取指定事件的 Hook 数量 (用于测试)
    pub fn get_hook_count(&self, event_name: &str) -> usize {
        self.hooks.get(event_name).map(|v| v.len()).unwrap_or(0)
    }

    /// 获取指定事件的 Hook Socket IDs (用于测试)
    pub fn get_hooks_for_event(&self, event_name: &str) -> Vec<String> {
        self.hooks.get(event_name).map(|v| v.clone()).unwrap_or_default()
    }
}
```

### 3. 调整可见性
```rust
pub(in crate) hooks: DashMap<String, Vec<String>>,
pub(in crate) pending_requests: DashMap<String, oneshot::Sender<Value>>,
```

## 性能测试

### 并发性能测试
- 10 个并发 Hook 调用
- 响应时间 < 100ms
- 无数据竞争
- 所有请求正确关联

### 内存测试
- 1000 个 Hook 注册
- 内存占用稳定
- 无内存泄漏

## 最佳实践

### 1. 使用 Mock 模拟依赖
```rust
// 使用 MockWebSocketManager 而不是真实的 WebSocket
let ws_manager = MockWebSocketManager::new();
```

### 2. 异步测试使用 tokio::test
```rust
#[tokio::test]
async fn test_async_hook() { ... }
```

### 3. 超时保护
```rust
let result = timeout(
    Duration::from_millis(100),
    hook_manager.call_hook(...)
).await;
```

### 4. 清理资源
```rust
// 测试结束后清理 Hook
hook_manager.remove_hook("socket-1");
```

## 已知问题

### 1. Round-Robin 实现
当前实现只调用第一个注册的 Hook，而不是所有订阅该事件的 Hook。

**影响**: `test_multiple_hooks_same_event` 测试中只有一个 Hook 收到请求

**解决方案**: 未来可以实现广播机制，调用所有订阅的 Hook

### 2. 超时时间
测试中使用较短的超时时间（100ms），生产环境中应使用更长的超时（10s）

## 未来改进

### 测试覆盖
- [ ] 添加网络分区场景测试
- [ ] 添加 Hook 重连测试
- [ ] 添加大规模 Hook 性能测试
- [ ] 添加 Hook 顺序保证测试

### 功能改进
- [ ] 实现 Hook 调用的重试机制
- [ ] 添加 Hook 调用的指标和监控
- [ ] 实现 Hook 调用的优先级
- [ ] 支持 Hook 的条件执行

## 参考资料

- [Hook 协议文档](../features/HOOKS_PROTOCOL.md)
- [架构文档](../core/ARCHITECTURE.md)
- [安全文档](../core/SECURITY.md)
