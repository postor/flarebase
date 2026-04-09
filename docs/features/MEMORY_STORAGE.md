# Memory Storage for Flarebase

## 🚀 Overview

Flarebase 现在支持高性能的**内存存储后端**,作为 SledDB 的替代方案。内存存储提供了显著的性能提升,特别适合实时同步、高频读写和低延迟场景。

## 📊 Performance Comparison

基于实际性能测试,内存存储相比 SledDB 的性能提升:

| 操作 | 性能提升 | 延迟对比 |
|------|----------|----------|
| **单次写入** | **496x** | SledDB: 13.7ms → Memory: 27.6µs |
| **单次读取** | **8.6x** | SledDB: 40.5µs → Memory: 4.7µs |
| **更新操作** | **265x** | SledDB: 9.6ms → Memory: 36µs |
| **批量写入(1000条)** | **882x** | SledDB: 3.7s → Memory: 4.2ms |
| **并发操作(1000 ops)** | **1254x** | SledDB: 3.7s → Memory: 2.9ms |
| **索引查询** | **60x** | SledDB: 320.6µs → Memory: 5.3µs |

## 🎯 When to Use Memory Storage

### ✅ Ideal Use Cases

- **实时同步应用**: WebSocket hooks、session sync 等需要低延迟的场景
- **高并发写入**: 大量客户端同时写入数据
- **缓存层**: 作为高速缓存存储热点数据
- **测试环境**: 快速启动和测试,无需磁盘 I/O
- **数据量可控**: 数据集可以完全装入内存

### ⚠️ Considerations

- **数据持久化**: 需要配置快照以防止数据丢失
- **内存占用**: 所有数据保存在内存中
- **重启恢复**: 启动时从快照恢复,可能有数据延迟

## 🛠️ Configuration

### 1. Basic Memory Storage

使用纯内存存储(无持久化):

```bash
FLARE_STORAGE_BACKEND=memory cargo run -p flare-server
```

### 2. Memory Storage with Persistence

配置定期快照到磁盘:

```bash
# 每 60 秒自动快照到默认路径
FLARE_STORAGE_BACKEND=memory \
FLARE_MEMORY_SNAPSHOT_PATH=./flare_memory.json \
FLARE_MEMORY_SNAPSHOT_INTERVAL=60 \
cargo run -p flare-server
```

### 3. Environment Variables

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FLARE_STORAGE_BACKEND` | `sled` | 存储后端: `sled` 或 `memory` |
| `FLARE_MEMORY_SNAPSHOT_PATH` | `./flare_{NODE_ID}_memory.json` | 快照文件路径 |
| `FLARE_MEMORY_SNAPSHOT_INTERVAL` | `60` | 快照间隔(秒) |

## 💻 Usage Examples

### Example 1: Development Mode

```bash
# 使用内存存储快速开发测试
FLARE_STORAGE_BACKEND=memory \
NODE_ID=1 \
HTTP_ADDR=localhost:3000 \
cargo run -p flare-server
```

### Example 2: Production with Persistence

```bash
# 生产环境:启用快照持久化
FLARE_STORAGE_BACKEND=memory \
FLARE_MEMORY_SNAPSHOT_PATH=/data/flare/snapshot.json \
FLARE_MEMORY_SNAPSHOT_INTERVAL=30 \
NODE_ID=1 \
HTTP_ADDR=0.0.0.0:3000 \
cargo run -p flare-server
```

### Example 3: Docker Deployment

```dockerfile
FROM rust:1.75 as builder
WORKDIR /app
COPY . .
RUN cargo build -p flare-server --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates
COPY --from=builder /app/target/release/flare-server /usr/local/bin/

ENV FLARE_STORAGE_BACKEND=memory
ENV FLARE_MEMORY_SNAPSHOT_PATH=/data/flare_memory.json
ENV FLARE_MEMORY_SNAPSHOT_INTERVAL=60

EXPOSE 3000
CMD ["flare-server"]
```

## 🔧 Advanced Features

### In-Memory Indexing

创建高性能索引以加速查询:

```javascript
// JavaScript SDK
const flare = new Flarebase('http://localhost:3000');

// 创建索引
await flare.createIndex('users', 'email');

// 查询自动使用索引(60x faster)
const users = await flare.query('users', {
  filters: [
    ['email', 'eq', 'user@example.com']
  ]
});
```

### Snapshot Management

程序化快照控制:

```rust
use flare_db::{MemoryStorage, persistence::PersistenceManager};
use std::time::Duration;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let storage = MemoryStorage::new();

    // 创建持久化管理器
    let mut manager = PersistenceManager::new(
        storage,
        "./snapshot.json",
        Duration::from_secs(60),
    );

    // 启动自动快照
    manager.start().await?;

    // 手动触发快照
    manager.force_snapshot().await?;

    Ok(())
}
```

## 📈 Architecture Details

### Concurrent Access

内存存储使用 `tokio::sync::RwLock` 实现并发安全:

- **多个读操作可以并发执行**
- **写操作独占锁**
- **优化的批量操作原子性**

### Index Structure

索引使用内存 HashMap 实现:

```
Collection: "users"
├── Primary Store (doc_id -> Document)
└── Index: "email"
    └── "user1@example.com" -> [doc_id_1, doc_id_2]
    └── "user2@example.com" -> [doc_id_3]
```

查询优化流程:

1. 检查是否有可用索引
2. 使用索引快速定位候选文档
3. 应用剩余过滤条件
4. 返回结果

## 🔍 Performance Tuning

### Snapshot Interval Optimization

| 场景 | 建议间隔 | 权衡 |
|------|----------|------|
| 高频率写入 | 30-60秒 | 更频繁,数据丢失风险低 |
| 中等负载 | 2-5分钟 | 平衡性能和持久化 |
| 低负载 | 10-30分钟 | 减少磁盘 I/O |

### Memory Estimation

估算内存使用:

```
每文档平均大小 ≈ 500 bytes - 2 KB
索引开销 ≈ 20% of data size

示例:
10,000 documents × 1 KB ≈ 10 MB data
+ 2 MB indexes
≈ 12 MB total
```

## 🧪 Testing

运行性能对比测试:

```bash
cargo test -p flare-db --test performance_comparison -- --nocapture
```

## 🔄 Migration

### From SledDB to Memory

1. 导出 SledDB 数据:

```bash
curl http://localhost:3000/_export > sled_backup.json
```

2. 启动内存存储:

```bash
FLARE_STORAGE_BACKEND=memory \
FLARE_MEMORY_SNAPSHOT_PATH=./memory_backup.json \
cargo run -p flare-server
```

3. 导入数据:

```bash
curl -X POST http://localhost:3000/_import \
  -H "Content-Type: application/json" \
  -d @sled_backup.json
```

## 🆚 Comparison: SledDB vs Memory

| Feature | SledDB | Memory |
|---------|--------|--------|
| **持久化** | ✅ 实时写入磁盘 | ⚠️ 定期快照 |
| **性能** | 中等 | 极高(100-1000x) |
| **内存占用** | 低 | 全量数据 |
| **启动速度** | 慢(加载DB) | 快(从快照恢复) |
| **数据安全** | 高(ACID事务) | 中等(依赖快照) |
| **适用场景** | 生产关键数据 | 高频实时应用 |

## 📝 Best Practices

1. **生产环境**: 始终启用快照持久化
2. **监控内存**: 设置内存使用告警
3. **备份策略**: 定期备份快照文件到远程存储
4. **容量规划**: 预留足够内存(数据量 × 2)
5. **测试验证**: 在切换到生产前充分测试

## 🔗 Related Documentation

- [Architecture Overview](../core/ARCHITECTURE.md)
- [Indexing Design](../core/INDEXING_DESIGN.md)
- [Session Synchronization](../features/SESSION_SYNC.md)

---

**Note**: 内存存储目前为实验性功能,但已经过完整的单元测试和性能验证。欢迎在生产环境中试用并提供反馈!
