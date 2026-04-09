# Memory Storage Implementation

## Overview

This document describes Flarebase's high-performance in-memory storage implementation, which offers significant performance improvements over the traditional SledDB disk-based storage.

## Performance Benchmarks

Based on our performance comparison tests, MemoryStorage provides the following improvements:

| Operation | Speedup Factor |
|-----------|----------------|
| **Single Write** | **496x** faster |
| **Single Read** | **8.6x** faster |
| **Update** | **265x** faster |
| **Bulk Write (1000 docs)** | **882x** faster |
| **Concurrent Operations** | **1254x** faster |
| **Indexed Query** | **60x** faster |
| **Full Scan Query** | **7.2x** faster |

### Key Takeaways

- **Write operations** see the most dramatic improvements (265x-1254x)
- **Indexed queries** are 60x faster due to optimized in-memory index lookups
- **Concurrent throughput** scales significantly better with memory storage

## Architecture

### Storage Structure

```rust
pub struct MemoryStorage {
    collections: Arc<RwLock<HashMap<String, MemoryCollection>>>,
}

struct MemoryCollection {
    documents: HashMap<String, Document>,
    indexes: HashMap<String, HashMap<serde_json::Value, Vec<String>>>,
}
```

### Concurrency Model

- **Tokio RwLock**: Allows multiple concurrent readers or exclusive writer access
- **Lock-free reads**: Read operations (get, list, query) only acquire read locks
- **Atomic batch operations**: Batch operations use a single write lock for atomicity

### Indexing System

MemoryStorage provides optimized secondary indexing:

```rust
// Create an index
storage.create_index("users", "age").await?;

// Query automatically uses the index
let results = storage.query(Query {
    collection: "users".to_string(),
    filters: vec![("age".to_string(), QueryOp::Eq(json!(25)))],
    ..Default::default()
}).await?;
```

**Index structure**: `field_value -> Vec<document_id>`

This enables:
- **O(1) equality lookups** instead of O(N) scans
- **O(k) IN-list queries** where k = number of values in the list

## Persistence Options

MemoryStorage supports optional persistence through snapshots:

### 1. In-Memory Only (No Persistence)

Fastest option, suitable for:
- Caching layers
- Session data
- Testing environments

### 2. Periodic Snapshots

Automatic background persistence:

```rust
let mut persistence_manager = PersistenceManager::new(
    storage,
    "./snapshot.json",
    Duration::from_secs(60), // Snapshot every 60 seconds
);

persistence_manager.start().await?;
```

**Benefits**:
- Durable storage without sacrificing memory performance
- Atomic snapshot writes (using temporary files)
- Automatic recovery on restart

## Usage

### Environment Variables

Configure storage backend in `flare-server`:

```bash
# Use in-memory storage
export FLARE_STORAGE_BACKEND=memory

# Optional: Configure persistence
export FLARE_MEMORY_SNAPSHOT_PATH="./data/flare_memory.json"
export FLARE_MEMORY_SNAPSHOT_INTERVAL=60  # seconds

# Default: Use SledDB
export FLARE_STORAGE_BACKEND=sled
export FLARE_DB_PATH="./flare.db"
```

### Code Example

```rust
use flare_db::memory::MemoryStorage;
use flare_protocol::Document;
use serde_json::json;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Create storage
    let storage = MemoryStorage::new();

    // Insert document
    let doc = Document::new("users".to_string(), json!({
        "name": "Alice",
        "age": 30
    }));
    storage.insert(doc).await?;

    // Create index for fast queries
    storage.create_index("users", "age").await?;

    // Fast indexed lookup
    let results = storage.query(Query {
        collection: "users".to_string(),
        filters: vec![("age".to_string(), QueryOp::Eq(json!(30)))],
        ..Default::default()
    }).await?;

    Ok(())
}
```

## Trade-offs

### Advantages

✅ **Nanosecond-level latency** for read operations
✅ **High throughput** for write operations (882x faster bulk writes)
✅ **Simplified architecture** - no disk I/O, WAL, or flush operations
✅ **Optimized indexing** - Hash-based lookups instead of tree traversals
✅ **Better concurrency** - RwLock scales better than disk-backed locks

### Limitations

⚠️ **Volatile**: Data is lost on process crash (unless persistence is enabled). Even with persistence, there is a data loss window until the next snapshot. See [DATA_DURABILITY.md](./DATA_DURABILITY.md) for details.
⚠️ **Memory bounded**: Limited by available RAM
⚠️ **Cold start**: Requires data loading from snapshots

## When to Use MemoryStorage

### Use MemoryStorage when:

- **Performance is critical** (real-time applications, high-frequency trading)
- **Dataset fits in memory** (< 50% of available RAM)
- **Acceptable data loss window** (RPO = snapshot interval)
- **High write throughput** needed (event sourcing, telemetry)

### Use SledDB when:

- **Dataset exceeds memory**
- **Durability is critical** (RPO = 0, RTO < 1s)
- **Long-term storage** required
- **Regulatory compliance** demands immediate persistence

## Performance Tuning

### Snapshot Optimization

```rust
// For better performance, increase snapshot interval
// This reduces disk I/O but increases potential data loss
let interval = Duration::from_secs(300); // 5 minutes
```

### Index Strategy

```rust
// Only index frequently queried fields
storage.create_index("users", "email").await?;
storage.create_index("users", "created_at").await?;

// Avoid indexing high-cardinality fields with few queries
// storage.create_index("users", "session_token").await?; // NOT recommended
```

### Memory Monitoring

```rust
let stats = storage.stats().await;
println!("Collections: {}", stats.collection_count);
println!("Total documents: {}", stats.total_documents);
println!("Total indexes: {}", stats.total_indexes);
```

## Migration

### From SledDB to MemoryStorage

```bash
# 1. Export data from SledDB
curl http://localhost:3000/_export > sled_data.json

# 2. Restart with memory backend
export FLARE_STORAGE_BACKEND=memory
export FLARE_MEMORY_SNAPSHOT_PATH="./memory_data.json"

# 3. Import data
curl -X POST http://localhost:3000/_import \
  -H "Content-Type: application/json" \
  -d @sled_data.json
```

### From MemoryStorage to SledDB

```bash
# 1. Force snapshot
curl -X POST http://localhost:3000/_snapshot

# 2. Restart with sled backend
export FLARE_STORAGE_BACKEND=sled
export FLARE_DB_PATH="./flare.db"

# 3. Import from snapshot
curl -X POST http://localhost:3000/_import \
  -H "Content-Type: application/json" \
  -d @./memory_data.json
```

## Implementation Details

### Thread Safety

MemoryStorage uses `Arc<RwLock<>>` for:

- **Thread-safe access** across async tasks
- **Multiple concurrent readers** (get, list, query)
- **Exclusive writer access** (insert, update, delete)

### Memory Layout

```
MemoryStorage
└── collections: RwLock<HashMap<String, MemoryCollection>>
    └── MemoryCollection
        ├── documents: HashMap<String, Document>
        └── indexes: HashMap<String, Index>
            └── Index (field_name)
                └── HashMap<Value, Vec<doc_id>>
```

### Query Execution

1. **Index selection**: Check if any filter field has an index
2. **Index lookup**: If indexed, get candidate IDs from index
3. **Filter application**: Apply remaining filters to candidates
4. **Result assembly**: Fetch full documents and apply offset/limit

## Future Improvements

- [ ] Range query optimization in indexes (Gt, Lt, Gte, Lte)
- [ ] Async snapshot with compression
- [ ] Incremental snapshots (delta-based)
- [ ] Memory-mapped files for very large datasets
- [ ] Eviction policies for memory-constrained environments

## References

- Source: `packages/flare-db/src/memory.rs`
- Persistence Logic: `packages/flare-db/src/persistence.rs`
- Durability Guide: [DATA_DURABILITY.md](./DATA_DURABILITY.md)
- Tests: `packages/flare-db/tests/performance_comparison.rs`
