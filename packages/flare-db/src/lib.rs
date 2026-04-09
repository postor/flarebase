use std::path::Path;
use async_trait::async_trait;
use flare_protocol::Document;
use sled::Db;
use chrono;

// Re-export modules
pub mod memory;
pub mod persistence;
pub mod redb;



#[async_trait]
pub trait Storage: Send + Sync {
    async fn get(&self, collection: &str, id: &str) -> anyhow::Result<Option<Document>>;
    async fn insert(&self, doc: Document) -> anyhow::Result<()>;
    async fn update(&self, collection: &str, id: &str, data: serde_json::Value) -> anyhow::Result<Option<Document>>;
    async fn delete(&self, collection: &str, id: &str) -> anyhow::Result<()>;
    async fn list(&self, collection: &str) -> anyhow::Result<Vec<Document>>;
    async fn query(&self, query: flare_protocol::Query) -> anyhow::Result<Vec<Document>>;
    async fn apply_batch(&self, operations: Vec<flare_protocol::BatchOperation>) -> anyhow::Result<()>;
    async fn export_all(&self) -> anyhow::Result<serde_json::Value>;
    async fn import_all(&self, data: serde_json::Value) -> anyhow::Result<()>;
}

pub struct SledStorage {
    db: Db,
}

impl SledStorage {
    pub fn new<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let db = sled::open(path)?;
        Ok(Self { db })
    }

    /// Get access to the underlying sled database for advanced operations like index management
    pub fn db(&self) -> &Db {
        &self.db
    }
}

#[async_trait]
impl Storage for SledStorage {
    async fn get(&self, collection: &str, id: &str) -> anyhow::Result<Option<Document>> {
        let tree = self.db.open_tree(collection)?;
        let key = id.as_bytes();
        if let Some(ivec) = tree.get(key)? {
            let doc: Document = serde_json::from_slice(&ivec)?;
            Ok(Some(doc))
        } else {
            Ok(None)
        }
    }

    async fn insert(&self, doc: Document) -> anyhow::Result<()> {
        let tree = self.db.open_tree(&doc.collection)?;
        let key = doc.id.as_bytes();
        let val = serde_json::to_vec(&doc)?;
        tree.insert(key, val)?;
        tree.flush()?;
        Ok(())
    }

    async fn update(&self, collection: &str, id: &str, data: serde_json::Value) -> anyhow::Result<Option<Document>> {
        let tree = self.db.open_tree(collection)?;
        let key = id.as_bytes();

        if let Some(ivec) = tree.get(key)? {
            let mut doc: Document = serde_json::from_slice(&ivec)?;
            doc.data = data;
            doc.version += 1;
            doc.updated_at = chrono::Utc::now().timestamp_millis();

            let val = serde_json::to_vec(&doc)?;
            tree.insert(key, val)?;
            tree.flush()?;
            Ok(Some(doc))
        } else {
            Ok(None)
        }
    }

    async fn delete(&self, collection: &str, id: &str) -> anyhow::Result<()> {
        let tree = self.db.open_tree(collection)?;
        tree.remove(id.as_bytes())?;
        Ok(())
    }

    async fn list(&self, collection: &str) -> anyhow::Result<Vec<Document>> {
        let tree = self.db.open_tree(collection)?;
        let mut docs = Vec::new();
        for item in tree.iter() {
            let (_key, val) = item?;
            let doc: Document = serde_json::from_slice(&val)?;
            docs.push(doc);
        }
        Ok(docs)
    }

    async fn query(&self, query: flare_protocol::Query) -> anyhow::Result<Vec<Document>> {
        let tree = self.db.open_tree(&query.collection)?;
        let mut docs = Vec::new();

        for item in tree.iter() {
            let (_key, val) = item?;
            let doc: Document = serde_json::from_slice(&val)?;

            let mut matched = true;
            for (field, op) in &query.filters {
                if !match_op(doc.data.get(field), op) {
                    matched = false;
                    break;
                }
            }

            if matched {
                docs.push(doc);
            }
        }

        // Handle offset and limit
        let mut result = docs;
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

    async fn apply_batch(&self, operations: Vec<flare_protocol::BatchOperation>) -> anyhow::Result<()> {
        use flare_protocol::{BatchOperation, Precondition};
        
        // In a real distributed DB, this would be much more complex.
        // For SledStorage, we'll implement it as a sequence of operations.
        // To ensure atomicity across collections, we'd ideally use sled transactions,
        // but since trees are dynamic, we'll use a simple approach for this version:
        // 1. Validate all preconditions
        // 2. If all pass, apply all changes
        
        // Pre-validation
        for op in &operations {
            match op {
                BatchOperation::Update { collection, id, precondition, .. } |
                BatchOperation::Delete { collection, id, precondition, .. } => {
                    if let Some(pre) = precondition {
                        let doc = self.get(collection, id).await?;
                        match pre {
                            Precondition::Exists(exists) => {
                                if doc.is_some() != *exists {
                                    return Err(anyhow::anyhow!("Precondition failed: Exists({})", exists));
                                }
                            }
                            Precondition::Version(version) => {
                                if let Some(d) = doc {
                                    if d.version != *version {
                                        return Err(anyhow::anyhow!("Precondition failed: Version mismatch (expected {}, got {})", version, d.version));
                                    }
                                } else {
                                    return Err(anyhow::anyhow!("Precondition failed: Document does not exist for version check"));
                                }
                            }
                            Precondition::LastUpdate(ts) => {
                                if let Some(d) = doc {
                                    if d.updated_at != *ts {
                                        return Err(anyhow::anyhow!("Precondition failed: LastUpdate mismatch"));
                                    }
                                } else {
                                    return Err(anyhow::anyhow!("Precondition failed: Document does not exist for timestamp check"));
                                }
                            }
                        }
                    }
                }
                BatchOperation::Set(_) => {} // Set usually doesn't have preconditions in this model 
            }
        }

        // Apply
        for op in operations {
            match op {
                BatchOperation::Set(doc) => {
                    self.insert(doc).await?;
                }
                BatchOperation::Update { collection, id, data, .. } => {
                    self.update(&collection, &id, data).await?;
                }
                BatchOperation::Delete { collection, id, .. } => {
                    self.delete(&collection, &id).await?;
                }
            }
        }

        Ok(())
    }

    async fn export_all(&self) -> anyhow::Result<serde_json::Value> {
        let mut collections = serde_json::Map::new();
        for name in self.db.tree_names() {
            let tree_name = String::from_utf8_lossy(&name);
            if tree_name == "__sled__default" { continue; }
            
            let tree = self.db.open_tree(&*tree_name)?;
            let mut docs = Vec::new();
            for item in tree.iter() {
                let (_key, val) = item?;
                let doc: Document = serde_json::from_slice(&val)?;
                docs.push(doc);
            }
            collections.insert(tree_name.to_string(), serde_json::Value::Array(
                docs.into_iter().map(|d| serde_json::to_value(d).unwrap()).collect()
            ));
        }
        Ok(serde_json::Value::Object(collections))
    }

    async fn import_all(&self, data: serde_json::Value) -> anyhow::Result<()> {
        if let Some(obj) = data.as_object() {
            for (col_name, docs_val) in obj {
                let tree = self.db.open_tree(col_name)?;
                if let Some(docs_arr) = docs_val.as_array() {
                    for doc_val in docs_arr {
                        let doc: Document = serde_json::from_value(doc_val.clone())?;
                        let key = doc.id.as_bytes();
                        let val = serde_json::to_vec(&doc)?;
                        tree.insert(key, val)?;
                    }
                }
            }
        }
        Ok(())
    }
}

fn match_op(val: Option<&serde_json::Value>, op: &flare_protocol::QueryOp) -> bool {
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
    use flare_protocol::{BatchOperation, Precondition};
    use serde_json::json;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_apply_batch_atomicity() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();
        
        // 1. Initial doc
        let doc1 = Document::new("posts".to_string(), json!({"title": "Post 1"}));
        let id1 = doc1.id.clone();
        storage.insert(doc1.clone()).await.unwrap();
        
        // 2. Apply batch: Update doc1 and Create doc2
        let doc2 = Document::new("posts".to_string(), json!({"title": "Post 2"}));
        let id2 = doc2.id.clone();
        
        let ops = vec![
            BatchOperation::Update {
                collection: "posts".to_string(),
                id: id1.clone(),
                data: json!({"title": "Post 1 Updated"}),
                precondition: Some(Precondition::Version(doc1.version)),
            },
            BatchOperation::Set(doc2.clone()),
        ];
        
        storage.apply_batch(ops).await.unwrap();
        
        // Verify both applied
        let d1 = storage.get("posts", &id1).await.unwrap().unwrap();
        assert_eq!(d1.data["title"], "Post 1 Updated");
        assert_eq!(d1.version, 2);
        
        let d2 = storage.get("posts", &id2).await.unwrap().unwrap();
        assert_eq!(d2.data["title"], "Post 2");
    }

    #[tokio::test]
    async fn test_apply_batch_precondition_failure() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();
        
        let doc1 = Document::new("posts".to_string(), json!({"title": "Post 1"}));
        let id1 = doc1.id.clone();
        storage.insert(doc1.clone()).await.unwrap();
        
        // Apply batch with WRONG version precondition
        let ops = vec![
            BatchOperation::Update {
                collection: "posts".to_string(),
                id: id1.clone(),
                data: json!({"title": "Should fail"}),
                precondition: Some(Precondition::Version(999)),
            },
        ];
        
        let res = storage.apply_batch(ops).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().to_string().contains("Precondition failed"));
        
        // Verify doc1 NOT updated
        let d1 = storage.get("posts", &id1).await.unwrap().unwrap();
        assert_eq!(d1.data["title"], "Post 1");
    }
}
