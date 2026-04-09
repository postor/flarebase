# Data Durability and Persistence

This document explains the data durability guarantees, persistence mechanisms, and crash recovery strategies in Flarebase.

## Persistence Backends

Flarebase supports two primary storage backends with different durability levels:

### 1. SledStorage (Default Persistent)
- **Engine**: [sled](https://github.com/spacejam/sled) (Transactional Key-Value Store)
- **Durability**: **Strong**
- **Mechanism**:
    - Every write operation triggers an immediate `flush()` to disk.
    - Uses an internal Write-Ahead Log (WAL) to ensure ACID properties.
- **Crash Recovery**: Automatic. On restart, `sled` replays its internal log to restore the database to a consistent state.
- **Recommended for**: Production environments where zero data loss is required.

### 2. MemoryStorage (Performance Optimized)
- **Engine**: In-memory `HashMap` with `RwLock` concurrency.
- **Durability**: **Configurable / Eventual**
- **Mechanism (Periodic Snapshots)**:
    - Data is kept in RAM for nanosecond-level access.
    - A background `PersistenceManager` saves full snapshots to a JSON file at regular intervals (default: 60s).
    - Snapshots use an "Atomic Write" strategy: Save to `.tmp` file -> Rename to target. This prevents corruption of previous snapshots.
- **Crash Recovery**: Loads the last successful snapshot on startup.
- **Data Loss Risk**: 
    - > [!WARNING]
    - > Any data modified *between* the last snapshot and a process crash/power failure will be lost.
    - > Current RPO (Recovery Point Objective) = Snapshot Interval.
- **Recommended for**: Caching, session management, or scenarios where performance outweighs durability.

## Crisis Handling & Recovery

### What happens during a crash?

1.  **If using SledStorage**:
    - The OS cache is flushed periodically or on `flush()` calls.
    - `sled` ensures that committed transactions are durable.
    - No manual intervention is needed for recovery.

2.  **If using MemoryStorage**:
    - The process state is lost.
    - On restart, the system searches for `snapshot.json`.
    - Data is restored to the state of the *last successful snapshot*.
    - **Note**: A planned improvement (WAL) is in the roadmap to eliminate this data loss window.

## Scheduled Persistence Configuration

You can configure the persistence behavior via environment variables or the configuration file:

```bash
# Enable periodic snapshots for memory storage
export FLARE_STORAGE_BACKEND=memory
export FLARE_MEMORY_SNAPSHOT_PATH="./data/flare_1.db/snapshot.json"
export FLARE_MEMORY_SNAPSHOT_INTERVAL=60 # seconds
```

## Future Roadmap: Write-Ahead Log (WAL)

To bridge the gap between memory performance and strong durability, we are planning to implement a WAL for `MemoryStorage`:
- **Step 1**: Append-only log for every write operation.
- **Step 2**: Log rotation after each successful full snapshot.
- **Step 3**: Startup recovery: Load Snapshot + Replay WAL = 0 Data Loss.

---
*For more details on memory storage internals, see [MEMORY_STORAGE_DESIGN.md](file:///d:/study/flarebase/docs/core/MEMORY_STORAGE_DESIGN.md).*
*For indexing consistency details, see [INDEXING_DESIGN.md](file:///d:/study/flarebase/docs/core/INDEXING_DESIGN.md).*
