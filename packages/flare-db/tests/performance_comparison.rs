//! Performance comparison tests between SledStorage and MemoryStorage
//!
//! Run with: cargo test -p flare-db --test performance_comparison -- --nocapture

use flare_db::{SledStorage, Storage, memory::MemoryStorage};
use flare_protocol::{Document, Query, QueryOp};
use serde_json::json;
use std::time::{Duration, Instant};
use tempfile::tempdir;

/// Benchmark result structure
#[derive(Debug)]
struct BenchmarkResult {
    test_name: String,
    sled_duration: Duration,
    memory_duration: Duration,
    speedup_factor: f64,
}

impl BenchmarkResult {
    fn print(&self) {
        println!("\n=== {} ===", self.test_name);
        println!("SledDB:     {:?}", self.sled_duration);
        println!("Memory:     {:?}", self.memory_duration);
        println!("Speedup:    {:.2}x", self.speedup_factor);
    }
}

#[tokio::test]
async fn benchmark_single_write() {
    let dir = tempdir().unwrap();

    // SledDB
    let sled_storage = SledStorage::new(dir.path().join("sled.db")).unwrap();
    let start = Instant::now();
    let doc = Document::new("test".to_string(), json!({"value": 42}));
    sled_storage.insert(doc).await.unwrap();
    let sled_duration = start.elapsed();

    // Memory
    let memory_storage = MemoryStorage::new();
    let start = Instant::now();
    let doc = Document::new("test".to_string(), json!({"value": 42}));
    memory_storage.insert(doc).await.unwrap();
    let memory_duration = start.elapsed();

    let result = BenchmarkResult {
        test_name: "Single Write".to_string(),
        sled_duration,
        memory_duration,
        speedup_factor: sled_duration.as_nanos() as f64 / memory_duration.as_nanos() as f64,
    };
    result.print();
}

#[tokio::test]
async fn benchmark_bulk_write() {
    let dir = tempdir().unwrap();
    const COUNT: usize = 1000;

    // SledDB
    let sled_storage = SledStorage::new(dir.path().join("sled.db")).unwrap();
    let start = Instant::now();
    for i in 0..COUNT {
        let doc = Document::new("test".to_string(), json!({"index": i}));
        sled_storage.insert(doc).await.unwrap();
    }
    let sled_duration = start.elapsed();

    // Memory
    let memory_storage = MemoryStorage::new();
    let start = Instant::now();
    for i in 0..COUNT {
        let doc = Document::new("test".to_string(), json!({"index": i}));
        memory_storage.insert(doc).await.unwrap();
    }
    let memory_duration = start.elapsed();

    let result = BenchmarkResult {
        test_name: format!("Bulk Write ({} documents)", COUNT),
        sled_duration,
        memory_duration,
        speedup_factor: sled_duration.as_nanos() as f64 / memory_duration.as_nanos() as f64,
    };
    result.print();
}

#[tokio::test]
async fn benchmark_single_read() {
    let dir = tempdir().unwrap();

    // Setup
    let sled_storage = SledStorage::new(dir.path().join("sled.db")).unwrap();
    let memory_storage = MemoryStorage::new();

    let doc = Document::new("test".to_string(), json!({"value": 42}));
    let id = doc.id.clone();

    sled_storage.insert(doc.clone()).await.unwrap();
    memory_storage.insert(doc).await.unwrap();

    // SledDB read
    let start = Instant::now();
    sled_storage.get("test", &id).await.unwrap();
    let sled_duration = start.elapsed();

    // Memory read
    let start = Instant::now();
    memory_storage.get("test", &id).await.unwrap();
    let memory_duration = start.elapsed();

    let result = BenchmarkResult {
        test_name: "Single Read".to_string(),
        sled_duration,
        memory_duration,
        speedup_factor: sled_duration.as_nanos() as f64 / memory_duration.as_nanos() as f64,
    };
    result.print();
}

#[tokio::test]
async fn benchmark_list_all() {
    let dir = tempdir().unwrap();
    const COUNT: usize = 100;

    // Setup
    let sled_storage = SledStorage::new(dir.path().join("sled.db")).unwrap();
    let memory_storage = MemoryStorage::new();

    for i in 0..COUNT {
        let doc = Document::new("test".to_string(), json!({"index": i}));
        sled_storage.insert(doc.clone()).await.unwrap();
        memory_storage.insert(doc).await.unwrap();
    }

    // SledDB list
    let start = Instant::now();
    sled_storage.list("test").await.unwrap();
    let sled_duration = start.elapsed();

    // Memory list
    let start = Instant::now();
    memory_storage.list("test").await.unwrap();
    let memory_duration = start.elapsed();

    let result = BenchmarkResult {
        test_name: format!("List All ({} documents)", COUNT),
        sled_duration,
        memory_duration,
        speedup_factor: sled_duration.as_nanos() as f64 / memory_duration.as_nanos() as f64,
    };
    result.print();
}

#[tokio::test]
async fn benchmark_query_without_index() {
    let dir = tempdir().unwrap();
    const COUNT: usize = 100;

    // Setup
    let sled_storage = SledStorage::new(dir.path().join("sled.db")).unwrap();
    let memory_storage = MemoryStorage::new();

    for i in 0..COUNT {
        let doc = Document::new("users".to_string(), json!({"age": i % 50}));
        sled_storage.insert(doc.clone()).await.unwrap();
        memory_storage.insert(doc).await.unwrap();
    }

    let query = Query {
        collection: "users".to_string(),
        filters: vec![("age".to_string(), QueryOp::Eq(json!(25)))],
        offset: None,
        limit: None,
    };

    // SledDB query (full scan)
    let start = Instant::now();
    sled_storage.query(query.clone()).await.unwrap();
    let sled_duration = start.elapsed();

    // Memory query (full scan)
    let start = Instant::now();
    memory_storage.query(query.clone()).await.unwrap();
    let memory_duration = start.elapsed();

    let result = BenchmarkResult {
        test_name: format!("Query (full scan, {} documents)", COUNT),
        sled_duration,
        memory_duration,
        speedup_factor: sled_duration.as_nanos() as f64 / memory_duration.as_nanos() as f64,
    };
    result.print();
}

#[tokio::test]
async fn benchmark_query_with_index() {
    let dir = tempdir().unwrap();
    const COUNT: usize = 100;

    // Setup
    let sled_storage = SledStorage::new(dir.path().join("sled.db")).unwrap();
    let memory_storage = MemoryStorage::new();

    for i in 0..COUNT {
        let doc = Document::new("users".to_string(), json!({"age": i % 50}));
        sled_storage.insert(doc.clone()).await.unwrap();
        memory_storage.insert(doc).await.unwrap();
    }

    // Create index
    memory_storage.create_index("users", "age").await.unwrap();

    let query = Query {
        collection: "users".to_string(),
        filters: vec![("age".to_string(), QueryOp::Eq(json!(25)))],
        offset: None,
        limit: None,
    };

    // SledDB query (full scan)
    let start = Instant::now();
    sled_storage.query(query.clone()).await.unwrap();
    let sled_duration = start.elapsed();

    // Memory query (indexed)
    let start = Instant::now();
    memory_storage.query(query.clone()).await.unwrap();
    let memory_duration = start.elapsed();

    let result = BenchmarkResult {
        test_name: format!("Query (indexed, {} documents)", COUNT),
        sled_duration,
        memory_duration,
        speedup_factor: sled_duration.as_nanos() as f64 / memory_duration.as_nanos() as f64,
    };
    result.print();
}

#[tokio::test]
async fn benchmark_update() {
    let dir = tempdir().unwrap();

    // Setup
    let sled_storage = SledStorage::new(dir.path().join("sled.db")).unwrap();
    let memory_storage = MemoryStorage::new();

    let doc = Document::new("test".to_string(), json!({"value": 42}));
    let id = doc.id.clone();

    sled_storage.insert(doc.clone()).await.unwrap();
    memory_storage.insert(doc).await.unwrap();

    // SledDB update
    let start = Instant::now();
    sled_storage.update("test", &id, json!({"value": 43})).await.unwrap();
    let sled_duration = start.elapsed();

    // Memory update
    let start = Instant::now();
    memory_storage.update("test", &id, json!({"value": 43})).await.unwrap();
    let memory_duration = start.elapsed();

    let result = BenchmarkResult {
        test_name: "Update".to_string(),
        sled_duration,
        memory_duration,
        speedup_factor: sled_duration.as_nanos() as f64 / memory_duration.as_nanos() as f64,
    };
    result.print();
}

#[tokio::test]
async fn benchmark_concurrent_operations() {
    let dir = tempdir().unwrap();
    const COUNT: usize = 100;
    const CONCURRENT: usize = 10;

    // SledDB
    let sled_storage = std::sync::Arc::new(SledStorage::new(dir.path().join("sled.db")).unwrap());
    let start = Instant::now();
    let mut handles = Vec::new();

    for _ in 0..CONCURRENT {
        let storage = sled_storage.clone();
        handles.push(tokio::spawn(async move {
            for i in 0..COUNT {
                let doc = Document::new("test".to_string(), json!({"index": i}));
                storage.insert(doc).await.unwrap();
            }
        }));
    }

    for handle in handles {
        handle.await.unwrap();
    }
    let sled_duration = start.elapsed();

    // Memory
    let memory_storage = std::sync::Arc::new(MemoryStorage::new());
    let start = Instant::now();
    let mut handles = Vec::new();

    for _ in 0..CONCURRENT {
        let storage = memory_storage.clone();
        handles.push(tokio::spawn(async move {
            for i in 0..COUNT {
                let doc = Document::new("test".to_string(), json!({"index": i}));
                storage.insert(doc).await.unwrap();
            }
        }));
    }

    for handle in handles {
        handle.await.unwrap();
    }
    let memory_duration = start.elapsed();

    let result = BenchmarkResult {
        test_name: format!("Concurrent ({} threads x {} ops)", CONCURRENT, COUNT),
        sled_duration,
        memory_duration,
        speedup_factor: sled_duration.as_nanos() as f64 / memory_duration.as_nanos() as f64,
    };
    result.print();
}
