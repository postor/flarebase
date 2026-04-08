use std::path::Path;
use async_trait::async_trait;
use flare_protocol::Document;
use sled::Db;

pub mod raft;

#[async_trait]
pub trait Storage: Send + Sync {
    async fn get(&self, collection: &str, id: &str) -> anyhow::Result<Option<Document>>;
    async fn insert(&self, doc: Document) -> anyhow::Result<()>;
    async fn delete(&self, collection: &str, id: &str) -> anyhow::Result<()>;
    async fn list(&self, collection: &str) -> anyhow::Result<Vec<Document>>;
    async fn query(&self, query: flare_protocol::Query) -> anyhow::Result<Vec<Document>>;
}

pub struct SledStorage {
    db: Db,
}

impl SledStorage {
    pub fn new<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let db = sled::open(path)?;
        Ok(Self { db })
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
        Ok(())
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
