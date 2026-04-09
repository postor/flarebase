# Flarebase 测试系统

## 概述

Flarebase 包含三个层次的测试:
1. **单元测试** - 测试单个模块和函数
2. **集成测试** - 测试模块间的交互
3. **端到端测试** - 测试完整的用户流程

## 测试目录结构

```
flarebase/
├── packages/
│   ├── flare-server/
│   │   ├── src/
│   │   │   ├── hook_manager.rs       # 包含单元测试
│   │   │   ├── permissions.rs        # 包含单元测试
│   │   │   └── main.rs               # 包含集成测试
│   │   └── tests/
│   │       ├── hook_standalone_test.rs   # Hook 独立测试
│   │       └── hook_integration_test.rs  # Hook 集成测试
│   └── flare-db/
│       ├── src/
│       │   └── lib.rs                # 包含单元测试
│       └── tests/
│           ├── cluster_system_tests.rs
│           ├── index_system_tests.rs
│           └── subscription_system_tests.rs
└── docs/
    └── tests/
        ├── HOOK_TESTS.md             # Hook 测试文档
        └── README.md                 # 本文件
```

## 运行测试

### 运行所有测试
```bash
# 整个项目的测试
cargo test --workspace

# 特定包的测试
cargo test -p flare-server
cargo test -p flare-db
```

### 运行特定测试
```bash
# 运行 Hook 相关测试
cargo test -p flare-server hook

# 运行特定测试函数
cargo test test_hook_registration

# 显示输出
cargo test -- --nocapture
```

### 运行集成测试
```bash
# Hook 系统集成测试
cd packages/flare-server
cargo test --test hook_integration_test
cargo test --test hook_standalone_test
```

## 测试文档

- [Hook 系统测试文档](HOOK_TESTS.md) - 完整的 Hook 测试指南
- [权限系统测试](../core/SECURITY.md#测试) - 权限和授权测试

## 测试最佳实践

### 1. 单元测试
放在模块文件的底部，使用 `#[cfg(test)]` 条件编译:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_functionality() {
        // 测试代码
    }
}
```

### 2. 集成测试
放在 `tests/` 目录下，测试公共 API:

```rust
use flare_server::hook_manager::HookManager;

#[tokio::test]
async fn test_integration_scenario() {
    // 集成测试代码
}
```

### 3. 使用 Mock 模拟依赖
```rust
struct MockWebSocket {
    messages: Arc<Mutex<Vec<Message>>>,
}
```

### 4. 异步测试
```rust
#[tokio::test]
async fn test_async_operation() {
    let result = async_operation().await;
    assert!(result.is_ok());
}
```

## 测试覆盖率

### 核心模块测试覆盖

| 模块 | 单元测试 | 集成测试 | 覆盖率 |
|------|---------|---------|--------|
| Hook Manager | ✅ | ✅ | ~90% |
| Permissions | ✅ | ❌ | ~85% |
| Storage | ✅ | ✅ | ~80% |
| Index System | ✅ | ✅ | ~75% |
| Cluster | ✅ | ❌ | ~70% |
| Subscription | ✅ | ❌ | ~75% |

## 测试分类

### 按功能分类

#### Hook 系统测试
- 注册和注销
- 事件触发和响应
- 错误处理
- 超时处理
- 并发调用

#### 存储系统测试
- 文档 CRUD
- 批量操作
- 事务处理
- 索引查询

#### 集群系统测试
- 节点管理
- 一致性哈希
- 数据分片

#### 权限系统测试
- 读写权限
- 数据脱敏
- 资源访问控制

### 按类型分类

#### 单元测试
- 测试单个函数
- 快速执行（< 1ms）
- 无外部依赖

#### 集成测试
- 测试模块交互
- 中等执行时间（< 100ms）
- 使用 Mock 依赖

#### 端到端测试
- 测试完整流程
- 较长执行时间（< 1s）
- 使用真实依赖

## 持续集成

### CI 测试流程
1. 运行所有单元测试（快速失败）
2. 运行集成测试
3. 生成测试覆盖率报告
4. 性能基准测试

### 测试质量标准
- ✅ 所有单元测试必须通过
- ✅ 所有集成测试必须通过
- ✅ 代码覆盖率 > 70%
- ✅ 关键路径覆盖率 > 90%

## 性能测试

### Hook 系统性能
- 注册延迟: < 1ms
- 调用延迟: < 5ms
- 支持 1000+ 并发连接

### 存储系统性能
- 写入吞吐: > 10k ops/s
- 查询延迟: < 10ms
- 批量操作: > 100k docs/s

## 调试测试

### 查看测试输出
```bash
# 显示所有输出
cargo test -- --nocapture

# 显示特定测试的输出
cargo test test_name -- --nocapture

# 显示测试的打印输出
cargo test -- --show-output
```

### 运行单个测试
```bash
# 精确匹配测试名称
cargo test test_exact_name

# 模糊匹配测试名称
cargo test hook
```

### 忽略测试
```rust
#[test]
#[ignore]
fn test_slow_operation() {
    // 这个测试会被跳过
}
```

## 常见问题

### Q: 测试失败怎么办？
1. 查看错误信息
2. 运行 `cargo test -- --nocapture` 查看详细输出
3. 使用 RUST_BACKTRACE=1 查看堆栈跟踪

### Q: 如何调试异步测试？
```bash
# 使用单线程运行
cargo test -- --test-threads=1

# 启用日志
RUST_LOG=debug cargo test
```

### Q: 测试太慢怎么办？
1. 使用 `#[ignore]` 标记慢测试
2. 使用 Mock 替代真实依赖
3. 并行运行测试（默认行为）

## 贡献指南

### 添加新测试
1. 在对应模块添加单元测试
2. 在 `tests/` 目录添加集成测试
3. 更新测试文档
4. 确保所有测试通过

### 测试命名规范
- 单元测试: `test_<function>_<scenario>`
- 集成测试: `test_<feature>_<flow>`

### 断言规范
- 使用具体的断言消息
- 测试边界条件
- 测试错误情况

## 相关资源

- [Rust 测试文档](https://doc.rust-lang.org/book/ch11-00-testing.html)
- [Tokio 测试指南](https://tokio.rs/tokio/topics/testing)
- [Tarpaulin - 覆盖率工具](https://github.com/xd009642/tarpaulin)
