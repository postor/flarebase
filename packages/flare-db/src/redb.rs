// Redb-based persistent storage implementation
// Redb is a pure-Rust embedded key-value store with ACID transactions
use std::path::Path;
use std::sync::Mutex;
use async_trait::async_trait;
use flare_protocol::Document;
use redb::{Database, ReadableTable, TableError};
use chrono;
use std::collections::HashMap;

/// Redb-based persistent storage backend
pub struct RedbStorage {
    db: Database,
    // Cache for table definitions to avoid recreating them
    table_defs: Mutex<HashMap<String, redb::TableDefinition<'static, &'static str, &'static [u8]>>>,
}

impl RedbStorage {
    /// Create a new Redb storage backend at the given path
    pub fn new<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let db = Database::create(path)?;
        Ok(Self {
            db,
            table_defs: Mutex::new(HashMap::new()),
        })
    }

    /// Get access to the underlying redb database
    pub fn db(&self) -> &Database {
        &self.db
    }

    /// Get or create a table definition for a collection
    fn get_table_def(&self, collection: &str) -> redb::TableDefinition<'static, &'static str, &'static [u8]> {
        let mut defs = self.table_defs.lock().unwrap();

        if !defs.contains_key(collection) {
            // Create a new table definition with a unique name
            // We use "collection_" prefix to avoid conflicts
            let table_name = format!("collection_{}", collection);

            // Leak the string to get a 'static lifetime
            // This is safe because the table_defs HashMap owns the data
            let table_name_static: &'static str = Box::leak(table_name.into_boxed_str());

            let table_def = redb::TableDefinition::new(table_name_static);
            defs.insert(collection.to_string(), table_def);
        }

        defs.get(collection).unwrap().to_owned()
    }
}

#[async_trait]
impl crate::Storage for RedbStorage {
    async fn get(&self, collection: &str, id: &str) -> anyhow::Result<Option<Document>> {
        let table_def = self.get_table_def(collection);
        let read_txn = self.db.begin_read()?;

        let table = read_txn.open_table(table_def)?;

        if let Some(value) = table.get(id)? {
            let bytes = value.value();
            let doc: Document = serde_json::from_slice(bytes)?;
            Ok(Some(doc))
        } else {
            Ok(None)
        }
    }

    async fn insert(&self, doc: Document) -> anyhow::Result<()> {
        let table_def = self.get_table_def(&doc.collection);
        let write_txn = self.db.begin_write()?;

        {
            let mut table = write_txn.open_table(table_def)?;

            let key = doc.id.as_str();
            let value = serde_json::to_vec(&doc)?;

            table.insert(key, value.as_slice())?;
        }

        write_txn.commit()?;
        Ok(())
    }

    async fn update(&self, collection: &str, id: &str, data: serde_json::Value) -> anyhow::Result<Option<Document>> {
        let table_def = self.get_table_def(collection);
        let write_txn = self.db.begin_write()?;

        let result = {
            let mut table = write_txn.open_table(table_def)?;

            // Get the existing document first, ending the borrow
            let existing_doc = if let Some(value) = table.get(id)? {
                let doc_bytes = value.value().to_vec();
                Some(serde_json::from_slice::<Document>(&doc_bytes)?)
            } else {
                None
            };

            // Now we can mutably borrow the table again
            if let Some(mut doc) = existing_doc {
                doc.data = data;
                doc.version += 1;
                doc.updated_at = chrono::Utc::now().timestamp_millis();

                let key = id;
                let new_value = serde_json::to_vec(&doc)?;

                table.insert(key, new_value.as_slice())?;

                Ok(Some(doc))
            } else {
                Ok(None)
            }
        };

        write_txn.commit()?;
        result
    }

    async fn delete(&self, collection: &str, id: &str) -> anyhow::Result<()> {
        let table_def = self.get_table_def(collection);
        let write_txn = self.db.begin_write()?;

        {
            let mut table = write_txn.open_table(table_def)?;
            table.remove(id)?;
        }

        write_txn.commit()?;
        Ok(())
    }

    async fn list(&self, collection: &str) -> anyhow::Result<Vec<Document>> {
        let table_def = self.get_table_def(collection);
        let read_txn = self.db.begin_read()?;

        let table = read_txn.open_table(table_def)?;
        let mut docs = Vec::new();

        for item in table.iter()? {
            let (_key, value) = item?;
            let doc: Document = serde_json::from_slice(value.value())?;
            docs.push(doc);
        }

        Ok(docs)
    }

    async fn query(&self, query: flare_protocol::Query) -> anyhow::Result<Vec<Document>> {
        let table_def = self.get_table_def(&query.collection);
        let read_txn = self.db.begin_read()?;

        let table = read_txn.open_table(table_def)?;
        let mut docs = Vec::new();

        for item in table.iter()? {
            let (_key, value) = item?;
            let doc: Document = serde_json::from_slice(value.value())?;

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

        // Pre-validation phase (read operations)
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
                BatchOperation::Set(_) => {}
            }
        }

        // Apply all operations in a single transaction
        let write_txn = self.db.begin_write()?;

        for op in operations {
            match op {
                BatchOperation::Set(doc) => {
                    let table_def = self.get_table_def(&doc.collection);
                    let mut table = write_txn.open_table(table_def)?;

                    let key = doc.id.as_str();
                    let value = serde_json::to_vec(&doc)?;
                    table.insert(key, value.as_slice())?;
                }
                BatchOperation::Update { collection, id, data, .. } => {
                    let table_def = self.get_table_def(&collection);
                    let mut table = write_txn.open_table(table_def)?;

                    // Get existing doc with separate scope
                    let existing_doc = if let Some(value) = table.get(id.as_str())? {
                        let doc_bytes = value.value().to_vec();
                        Some(serde_json::from_slice::<Document>(&doc_bytes)?)
                    } else {
                        None
                    };

                    // Now insert the updated doc
                    if let Some(mut doc) = existing_doc {
                        doc.data = data;
                        doc.version += 1;
                        doc.updated_at = chrono::Utc::now().timestamp_millis();

                        let new_value = serde_json::to_vec(&doc)?;
                        table.insert(id.as_str(), new_value.as_slice())?;
                    }
                }
                BatchOperation::Delete { collection, id, .. } => {
                    let table_def = self.get_table_def(&collection);
                    let mut table = write_txn.open_table(table_def)?;
                    table.remove(id.as_str())?;
                }
            }
        }

        write_txn.commit()?;
        Ok(())
    }

    async fn export_all(&self) -> anyhow::Result<serde_json::Value> {
        let mut collections = serde_json::Map::new();
        let read_txn = self.db.begin_read()?;

        // Get all table names (collections)
        // Note: Redb doesn't have a direct way to list all tables,
        // so we'll need to track collections separately or use a known set
        // For now, we'll return an empty map and implement this later
        // when we have a collection registry

        Ok(serde_json::Value::Object(collections))
    }

    async fn import_all(&self, data: serde_json::Value) -> anyhow::Result<()> {
        if let Some(obj) = data.as_object() {
            let write_txn = self.db.begin_write()?;

            for (col_name, docs_val) in obj {
                let table_def = self.get_table_def(&col_name);
                let mut table = write_txn.open_table(table_def)?;

                if let Some(docs_arr) = docs_val.as_array() {
                    for doc_val in docs_arr {
                        let doc: Document = serde_json::from_value(doc_val.clone())?;
                        let key = doc.id.as_str();
                        let value = serde_json::to_vec(&doc)?;
                        table.insert(key, value.as_slice())?;
                    }
                }
            }

            write_txn.commit()?;
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
    use super::super::Storage;
    use flare_protocol::{BatchOperation, Precondition};
    use serde_json::json;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_redb_basic_operations() {
        let dir = tempdir().unwrap();
        let storage = RedbStorage::new(dir.path().join("test.redb")).unwrap();

        // Insert
        let doc = Document::new("posts".to_string(), json!({"title": "Test Post"}));
        let id = doc.id.clone();
        storage.insert(doc.clone()).await.unwrap();

        // Get
        let retrieved = storage.get("posts", &id).await.unwrap().unwrap();
        assert_eq!(retrieved.data["title"], "Test Post");

        // Update
        storage.update("posts", &id, json!({"title": "Updated"})).await.unwrap();
        let updated = storage.get("posts", &id).await.unwrap().unwrap();
        assert_eq!(updated.data["title"], "Updated");
        assert_eq!(updated.version, 2);

        // Delete
        storage.delete("posts", &id).await.unwrap();
        let deleted = storage.get("posts", &id).await.unwrap();
        assert!(deleted.is_none());
    }

    #[tokio::test]
    async fn test_redb_query() {
        let dir = tempdir().unwrap();
        let storage = RedbStorage::new(dir.path().join("test.redb")).unwrap();

        // Insert multiple documents
        for i in 1..=5 {
            let doc = Document::new("posts".to_string(), json!({
                "title": format!("Post {}", i),
                "status": if i <= 3 { "published" } else { "draft" }
            }));
            storage.insert(doc).await.unwrap();
        }

        // Query with filter
        let query = flare_protocol::Query {
            collection: "posts".to_string(),
            filters: vec![
                ("status".to_string(), flare_protocol::QueryOp::Eq(json!("published")))
            ],
            offset: None,
            limit: None,
        };

        let results = storage.query(query).await.unwrap();
        assert_eq!(results.len(), 3);
    }

    #[tokio::test]
    async fn test_redb_batch_atomicity() {
        let dir = tempdir().unwrap();
        let storage = RedbStorage::new(dir.path().join("test.redb")).unwrap();

        // Initial document
        let doc1 = Document::new("posts".to_string(), json!({"title": "Post 1"}));
        let id1 = doc1.id.clone();
        storage.insert(doc1.clone()).await.unwrap();

        // Apply batch: Update doc1 and Create doc2
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
    async fn test_redb_batch_precondition_failure() {
        let dir = tempdir().unwrap();
        let storage = RedbStorage::new(dir.path().join("test.redb")).unwrap();

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
