# Memory Storage Quick Start

A practical guide to using Flarebase's high-performance in-memory storage backend.

## 🚀 Quick Start

### 1. Run Flare Server with Memory Backend

```bash
# Set environment variables
export FLARE_STORAGE_BACKEND=memory
export FLARE_MEMORY_SNAPSHOT_PATH="./flare_memory.json"
export FLARE_MEMORY_SNAPSHOT_INTERVAL=60

# Start the server
cargo run -p flare-server
```

### 2. Basic Operations

```bash
# Create a document
curl -X POST http://localhost:3000/collections/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "age": 30,
    "email": "alice@example.com"
  }'

# Read it back
curl http://localhost:3000/collections/users/{id}

# Update
curl -X PUT http://localhost:3000/collections/users/{id} \
  -H "Content-Type: application/json" \
  -d '{
    "age": 31
  }'

# Delete
curl -X DELETE http://localhost:3000/collections/users/{id}
```

## 📊 Performance Comparison

| Operation | SledDB | Memory | Improvement |
|-----------|--------|--------|-------------|
| Single Write | 13.7ms | 27.6µs | **496x** |
| Bulk Write (1000) | 3.7s | 4.2ms | **882x** |
| Indexed Query | 320.6µs | 5.3µs | **60x** |
| Concurrent (10×100) | 3.7s | 2.9ms | **1254x** |

## 🔧 Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FLARE_STORAGE_BACKEND` | `sled` | Storage backend: `sled` or `memory` |
| `FLARE_MEMORY_SNAPSHOT_PATH` | `./flare_{node_id}_memory.json` | Path to snapshot file |
| `FLARE_MEMORY_SNAPSHOT_INTERVAL` | `60` | Snapshot interval in seconds |

### Choosing the Right Backend

#### Use Memory Storage When:
- ✅ You need maximum performance
- ✅ Dataset fits in RAM (< 50% of available memory)
- ✅ Occasional data loss (up to snapshot interval) is acceptable
- ✅ High write throughput is required

#### Use SledDB When:
- ✅ Dataset exceeds available RAM
- ✅ Zero data loss tolerance (RPO = 0)
- ✅ Regulatory compliance requires immediate persistence
- ✅ Long-term archival storage needed

## 📈 Benchmarks

Run the performance comparison:

```bash
cargo test -p flare-db --test performance_comparison -- --nocapture
```

Output:
```
=== Bulk Write (1000 documents) ===
SledDB:     3.7381358s
Memory:     4.2371ms
Speedup:    882.24x

=== Concurrent (10 threads x 100 ops) ===
SledDB:     3.744752s
Memory:     2.986ms
Speedup:    1254.10x
```

## 💡 Tips & Best Practices

### 1. Index Frequently Queried Fields

```javascript
// Via JavaScript SDK
await db.collection('users').createIndex('email');
await db.collection('users').createIndex('age');

// Queries now use indexes for O(1) lookups
const users = await db.collection('users')
  .where('age', '==', 30)
  .get();
```

### 2. Optimize Snapshot Interval

```bash
# Lower interval = better durability, more disk I/O
export FLARE_MEMORY_SNAPSHOT_INTERVAL=30  # 30 seconds

# Higher interval = better performance, more potential data loss
export FLARE_MEMORY_SNAPSHOT_INTERVAL=300  # 5 minutes
```

### 3. Monitor Memory Usage

```rust
let stats = storage.stats().await;
println!("Documents: {}", stats.total_documents);
println!("Indexes: {}", stats.total_indexes);
```

## 🔄 Migration

### From SledDB to Memory

```bash
# 1. Export from SledDB
curl http://localhost:3000/_export > sled_backup.json

# 2. Switch to memory backend
export FLARE_STORAGE_BACKEND=memory
cargo run -p flare-server

# 3. Import data
curl -X POST http://localhost:3000/_import \
  -H "Content-Type: application/json" \
  -d @sled_backup.json
```

## 🛡️ Data Safety

Memory storage provides durability through periodic snapshots:

- **Automatic snapshots**: Every N seconds (configurable)
- **Atomic writes**: Uses temporary files + rename
- **Crash recovery**: Automatically loads latest snapshot on startup

### Recovery Point Objective (RPO)

Your maximum data loss equals the snapshot interval:

```bash
# RPO = 60 seconds (default)
export FLARE_MEMORY_SNAPSHOT_INTERVAL=60

# RPO = 5 minutes
export FLARE_MEMORY_SNAPSHOT_INTERVAL=300
```

## 🐛 Troubleshooting

### Out of Memory

If you encounter memory errors:

1. **Reduce snapshot interval** to flush data more frequently
2. **Migrate to SledDB** for larger datasets
3. **Add more RAM** to your server

### Slow Snapshot Writes

If snapshots take too long:

1. **Increase snapshot interval** to reduce frequency
2. **Use faster storage** (SSD vs HDD)
3. **Reduce dataset size** through archiving old data

## 📚 Further Reading

- [Memory Storage Design](../core/MEMORY_STORAGE_DESIGN.md) - Detailed architecture
- [Indexing System](../core/INDEXING_DESIGN.md) - Query optimization
- [Architecture Overview](../core/ARCHITECTURE.md) - Core concepts
