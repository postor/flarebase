//! High-performance in-memory storage implementation for Flarebase.
//!
//! This module provides a memory-backed storage implementation that offers:
//! - Nanosecond-level read latency
//! - High concurrent throughput using RwLock
//! - Optional persistence through snapshots
//! - Optimized in-memory indexing

use std::collections::HashMap;
use std::sync::Arc;
use async_trait::async_trait;
use tokio::sync::RwLock;
use flare_protocol::{Document, Query, QueryOp, BatchOperation};
use chrono;
use serde_json;

/// In-memory collection storage with concurrent access
#[derive(Debug)]
struct MemoryCollection {
    /// Primary document store: doc_id -> Document
    documents: HashMap<String, Document>,

    /// Secondary indexes: field_name -> (field_value -> Vec<doc_id>)
    indexes: HashMap<String, HashMap<serde_json::Value, Vec<String>>>,
}

impl MemoryCollection {
    fn new() -> Self {
        Self {
            documents: HashMap::new(),
            indexes: HashMap::new(),
        }
    }
}

/// High-performance in-memory storage backend
#[derive(Debug, Clone)]
pub struct MemoryStorage {
    /// All collections: collection_name -> MemoryCollection
    collections: Arc<RwLock<HashMap<String, MemoryCollection>>>,
}

impl MemoryStorage {
    /// Create a new in-memory storage instance
    pub fn new() -> Self {
        Self {
            collections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create an index on a specific field in a collection
    pub async fn create_index(&self, collection: &str, field: &str) -> anyhow::Result<()> {
        let mut collections = self.collections.write().await;
        let col = collections.entry(collection.to_string())
            .or_insert_with(MemoryCollection::new);

        // Build index from existing documents
        let index_map = col.indexes.entry(field.to_string())
            .or_insert_with(HashMap::new);

        for (doc_id, doc) in &col.documents {
            if let Some(field_val) = doc.data.get(field) {
                index_map.entry(field_val.clone())
                    .or_insert_with(Vec::new)
                    .push(doc_id.clone());
            }
        }

        Ok(())
    }

    /// Drop an index
    pub async fn drop_index(&self, collection: &str, field: &str) -> anyhow::Result<()> {
        let mut collections = self.collections.write().await;
        if let Some(col) = collections.get_mut(collection) {
            col.indexes.remove(field);
        }
        Ok(())
    }

    /// List all indexes for a collection
    pub async fn list_indexes(&self, collection: &str) -> Vec<String> {
        let collections = self.collections.read().await;
        if let Some(col) = collections.get(collection) {
            col.indexes.keys().cloned().collect()
        } else {
            Vec::new()
        }
    }

    /// Get storage statistics
    pub async fn stats(&self) -> MemoryStorageStats {
        let collections = self.collections.read().await;
        let mut total_docs = 0;
        let mut total_indexes = 0;

        for col in collections.values() {
            total_docs += col.documents.len();
            total_indexes += col.indexes.len();
        }

        MemoryStorageStats {
            collection_count: collections.len(),
            total_documents: total_docs,
            total_indexes: total_indexes,
        }
    }

    /// Snapshot current state to JSON for persistence
    pub async fn snapshot(&self) -> anyhow::Result<serde_json::Value> {
        let collections = self.collections.read().await;
        let mut snapshot = serde_json::Map::new();

        for (col_name, col) in collections.iter() {
            let docs: Vec<serde_json::Value> = col.documents.values()
                .map(|doc| serde_json::to_value(doc).unwrap())
                .collect();
            snapshot.insert(col_name.clone(), serde_json::Value::Array(docs));
        }

        Ok(serde_json::Value::Object(snapshot))
    }

    /// Restore from snapshot
    pub async fn restore(&self, snapshot: serde_json::Value) -> anyhow::Result<()> {
        let mut collections = self.collections.write().await;
        collections.clear();

        if let Some(obj) = snapshot.as_object() {
            for (col_name, docs_val) in obj {
                let mut col = MemoryCollection::new();

                if let Some(docs_arr) = docs_val.as_array() {
                    for doc_val in docs_arr {
                        if let Ok(doc) = serde_json::from_value::<Document>(doc_val.clone()) {
                            col.documents.insert(doc.id.clone(), doc);
                        }
                    }
                }

                collections.insert(col_name.clone(), col);
            }
        }

        Ok(())
    }
}

impl Default for MemoryStorage {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, serde::Serialize)]
pub struct MemoryStorageStats {
    pub collection_count: usize,
    pub total_documents: usize,
    pub total_indexes: usize,
}

#[async_trait]
impl super::Storage for MemoryStorage {
    async fn get(&self, collection: &str, id: &str) -> anyhow::Result<Option<Document>> {
        let collections = self.collections.read().await;
        if let Some(col) = collections.get(collection) {
            Ok(col.documents.get(id).cloned())
        } else {
            Ok(None)
        }
    }

    async fn insert(&self, doc: Document) -> anyhow::Result<()> {
        let mut collections = self.collections.write().await;
        let col = collections.entry(doc.collection.clone())
            .or_insert_with(MemoryCollection::new);

        // Insert into primary store
        let doc_id = doc.id.clone();
        col.documents.insert(doc_id.clone(), doc.clone());

        // Update indexes
        for (field, index_map) in &mut col.indexes {
            if let Some(field_val) = doc.data.get(field) {
                index_map.entry(field_val.clone())
                    .or_insert_with(Vec::new)
                    .push(doc_id.clone());
            }
        }

        Ok(())
    }

    async fn update(&self, collection: &str, id: &str, data: serde_json::Value) -> anyhow::Result<Option<Document>> {
        let mut collections = self.collections.write().await;

        if let Some(col) = collections.get_mut(collection) {
            if let Some(mut doc) = col.documents.get(id).cloned() {
                // Update indexes: remove old entries
                for (field, index_map) in &mut col.indexes {
                    if let Some(old_val) = doc.data.get(field) {
                        if let Some(ids) = index_map.get_mut(old_val) {
                            ids.retain(|x| x != id);
                        }
                    }
                }

                // Update document
                doc.data = data;
                doc.version += 1;
                doc.updated_at = chrono::Utc::now().timestamp_millis();

                // Add new index entries
                for (field, index_map) in &mut col.indexes {
                    if let Some(new_val) = doc.data.get(field) {
                        index_map.entry(new_val.clone())
                            .or_insert_with(Vec::new)
                            .push(id.to_string());
                    }
                }

                col.documents.insert(id.to_string(), doc.clone());
                Ok(Some(doc))
            } else {
                Ok(None)
            }
        } else {
            Ok(None)
        }
    }

    async fn delete(&self, collection: &str, id: &str) -> anyhow::Result<()> {
        let mut collections = self.collections.write().await;

        if let Some(col) = collections.get_mut(collection) {
            // Remove from indexes
            if let Some(_doc) = col.documents.get(id) {
                for (_field, index_map) in &mut col.indexes {
                    for (_val, ids) in index_map.iter_mut() {
                        ids.retain(|x| x != id);
                    }
                }
            }

            // Remove from primary store
            col.documents.remove(id);
        }

        Ok(())
    }

    async fn list(&self, collection: &str) -> anyhow::Result<Vec<Document>> {
        let collections = self.collections.read().await;
        if let Some(col) = collections.get(collection) {
            Ok(col.documents.values().cloned().collect())
        } else {
            Ok(Vec::new())
        }
    }

    async fn query(&self, query: Query) -> anyhow::Result<Vec<Document>> {
        let collections = self.collections.read().await;
        let col = collections.get(&query.collection);

        let col = match col {
            Some(c) => c,
            None => return Ok(Vec::new()),
        };

        // Use index if available for the first filter
        let mut candidate_ids: Option<Vec<String>> = None;

        if let Some((field, op)) = query.filters.first() {
            if let Some(index_map) = col.indexes.get(field) {
                candidate_ids = match op {
                    QueryOp::Eq(val) => {
                        index_map.get(val).map(|ids| ids.clone())
                    },
                    QueryOp::In(vals) => {
                        let mut ids = Vec::new();
                        for val in vals {
                            if let Some(val_ids) = index_map.get(val) {
                                ids.extend(val_ids.iter().cloned());
                            }
                        }
                        Some(ids)
                    },
                    _ => None, // Range queries not optimized yet
                };
            }
        }

        // Fetch candidates and apply remaining filters
        let mut results = Vec::new();

        let doc_ids_to_check = match candidate_ids {
            Some(ids) => ids,
            None => col.documents.keys().cloned().collect(),
        };

        for doc_id in doc_ids_to_check {
            if let Some(doc) = col.documents.get(&doc_id) {
                let mut matched = true;
                for (field, op) in &query.filters {
                    if !match_op(doc.data.get(field), op) {
                        matched = false;
                        break;
                    }
                }

                if matched {
                    results.push(doc.clone());
                }
            }
        }

        // Apply offset and limit
        let mut result = results;
        if let Some(offset) = query.offset {
            if offset < result.len() {
                result = result.drain(offset..).collect();
            } else {
                result.clear();
            }
        }
        if let Some(limit) = query.limit {
            result.truncate(limit);
        }

        Ok(result)
    }

    async fn apply_batch(&self, operations: Vec<BatchOperation>) -> anyhow::Result<()> {
        // For memory storage, we can use a single write lock for better atomicity
        let mut collections = self.collections.write().await;

        // Pre-validation phase
        for op in &operations {
            match op {
                BatchOperation::Update { collection, id, precondition, .. } |
                BatchOperation::Delete { collection, id, precondition, .. } => {
                    if let Some(pre) = precondition {
                        let col = collections.get(collection);
                        let doc = col.and_then(|c| c.documents.get(id));

                        match pre {
                            flare_protocol::Precondition::Exists(exists) => {
                                if doc.is_some() != *exists {
                                    return Err(anyhow::anyhow!("Precondition failed: Exists({})", exists));
                                }
                            }
                            flare_protocol::Precondition::Version(version) => {
                                if let Some(d) = doc {
                                    if d.version != *version {
                                        return Err(anyhow::anyhow!("Precondition failed: Version mismatch"));
                                    }
                                } else {
                                    return Err(anyhow::anyhow!("Precondition failed: Document does not exist"));
                                }
                            }
                            flare_protocol::Precondition::LastUpdate(ts) => {
                                if let Some(d) = doc {
                                    if d.updated_at != *ts {
                                        return Err(anyhow::anyhow!("Precondition failed: Timestamp mismatch"));
                                    }
                                } else {
                                    return Err(anyhow::anyhow!("Precondition failed: Document does not exist"));
                                }
                            }
                        }
                    }
                }
                BatchOperation::Set(_) => {}
            }
        }

        // Apply phase
        for op in operations {
            match op {
                BatchOperation::Set(doc) => {
                    let col = collections.entry(doc.collection.clone())
                        .or_insert_with(MemoryCollection::new);
                    let doc_id = doc.id.clone();
                    col.documents.insert(doc_id, doc);
                }
                BatchOperation::Update { collection, id, data, .. } => {
                    if let Some(col) = collections.get_mut(&collection) {
                        if let Some(doc) = col.documents.get_mut(&id) {
                            doc.data = data;
                            doc.version += 1;
                            doc.updated_at = chrono::Utc::now().timestamp_millis();
                        }
                    }
                }
                BatchOperation::Delete { collection, id, .. } => {
                    if let Some(col) = collections.get_mut(&collection) {
                        col.documents.remove(&id);
                    }
                }
            }
        }

        Ok(())
    }

    async fn export_all(&self) -> anyhow::Result<serde_json::Value> {
        self.snapshot().await
    }

    async fn import_all(&self, data: serde_json::Value) -> anyhow::Result<()> {
        self.restore(data).await
    }
}

/// Helper function to match query operations
fn match_op(val: Option<&serde_json::Value>, op: &QueryOp) -> bool {
    use flare_protocol::QueryOp::*;
    match (val, op) {
        (Some(v), Eq(target)) => v == target,
        (Some(v), Gt(target)) => compare_json(v, target) == std::cmp::Ordering::Greater,
        (Some(v), Lt(target)) => compare_json(v, target) == std::cmp::Ordering::Less,
        (Some(v), Gte(target)) => matches!(compare_json(v, target), std::cmp::Ordering::Greater | std::cmp::Ordering::Equal),
        (Some(v), Lte(target)) => matches!(compare_json(v, target), std::cmp::Ordering::Less | std::cmp::Ordering::Equal),
        (Some(v), In(targets)) => targets.contains(v),
        (val, And(ops)) => ops.iter().all(|o| match_op(val, o)),
        (val, Or(ops)) => ops.iter().any(|o| match_op(val, o)),
        (None, _) => false,
    }
}

fn compare_json(a: &serde_json::Value, b: &serde_json::Value) -> std::cmp::Ordering {
    match (a, b) {
        (serde_json::Value::Number(n1), serde_json::Value::Number(n2)) => {
            let f1 = n1.as_f64().unwrap_or(0.0);
            let f2 = n2.as_f64().unwrap_or(0.0);
            f1.partial_cmp(&f2).unwrap_or(std::cmp::Ordering::Equal)
        }
        (serde_json::Value::String(s1), serde_json::Value::String(s2)) => s1.cmp(s2),
        _ => std::cmp::Ordering::Equal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flare_protocol::Document;
    use serde_json::json;
    use crate::Storage;

    #[tokio::test]
    async fn test_memory_basic_operations() {
        let storage = MemoryStorage::new();

        // Insert
        let doc = Document::new("posts".to_string(), json!({"title": "Hello"}));
        let id = doc.id.clone();
        storage.insert(doc).await.unwrap();

        // Get
        let retrieved = storage.get("posts", &id).await.unwrap().unwrap();
        assert_eq!(retrieved.data["title"], "Hello");

        // Update
        storage.update("posts", &id, json!({"title": "World"})).await.unwrap();
        let updated = storage.get("posts", &id).await.unwrap().unwrap();
        assert_eq!(updated.data["title"], "World");

        // Delete
        storage.delete("posts", &id).await.unwrap();
        let deleted = storage.get("posts", &id).await.unwrap();
        assert!(deleted.is_none());
    }

    #[tokio::test]
    async fn test_index_creation_and_query() {
        let storage = MemoryStorage::new();

        // Create documents
        let doc1 = Document::new("users".to_string(), json!({"name": "Alice", "age": 30}));
        let doc2 = Document::new("users".to_string(), json!({"name": "Bob", "age": 25}));
        let id1 = doc1.id.clone();
        let id2 = doc2.id.clone();

        storage.insert(doc1).await.unwrap();
        storage.insert(doc2).await.unwrap();

        // Create index on 'age'
        storage.create_index("users", "age").await.unwrap();

        // Query with index
        let query = Query {
            collection: "users".to_string(),
            filters: vec![("age".to_string(), QueryOp::Eq(json!(30)))],
            offset: None,
            limit: None,
        };

        let results = storage.query(query).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].data["age"], 30);
    }

    #[tokio::test]
    async fn test_snapshot_and_restore() {
        let storage1 = MemoryStorage::new();

        // Insert data
        let doc = Document::new("posts".to_string(), json!({"title": "Snapshot test"}));
        storage1.insert(doc).await.unwrap();

        // Snapshot
        let snapshot = storage1.snapshot().await.unwrap();

        // Restore to new storage
        let storage2 = MemoryStorage::new();
        storage2.restore(snapshot).await.unwrap();

        // Verify
        let docs = storage2.list("posts").await.unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].data["title"], "Snapshot test");
    }
}
