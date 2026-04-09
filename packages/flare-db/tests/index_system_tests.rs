// 索引系统测试 - 基于 INDEXING_DESIGN.md
//
// 覆盖功能：
// 1. 多树存储架构
// 2. 索引创建和管理
// 3. 查询执行流程（索引选择）
// 4. 模式匹配（Equality, Range, In-list）
// 5. 维护和一致性

use flare_db::Storage;
use flare_db::SledStorage;
use flare_protocol::{Document, Query, QueryOp};
use tempfile::tempdir;
use serde_json::json;
use std::collections::HashMap;

// ===== 索引元数据 =====

#[derive(Debug, Clone)]
pub struct IndexMetadata {
    pub collection: String,
    pub field: String,
    pub index_type: IndexType,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum IndexType {
    SingleField,  // 单字段索引
    Compound,     // 复合索引（未来）
    Unique,       // 唯一索引（未来）
}

// ===== 索引管理器 =====

pub struct IndexManager {
    // 索引元数据存储
    metadata: HashMap<String, IndexMetadata>, // index_id -> metadata
    // 字段到索引的映射
    field_indexes: HashMap<String, Vec<String>>, // collection:field -> [index_id]
}

impl IndexManager {
    pub fn new() -> Self {
        Self {
            metadata: HashMap::new(),
            field_indexes: HashMap::new(),
        }
    }

    pub fn create_index(&mut self, collection: &str, field: &str) -> String {
        let index_id = format!("__index__{}:{}", collection, field);

        let metadata = IndexMetadata {
            collection: collection.to_string(),
            field: field.to_string(),
            index_type: IndexType::SingleField,
            created_at: chrono::Utc::now().timestamp_millis(),
        };

        self.metadata.insert(index_id.clone(), metadata);

        self.field_indexes
            .entry(format!("{}:{}", collection, field))
            .or_insert_with(Vec::new)
            .push(index_id.clone());

        index_id
    }

    pub fn get_index_for_field(&self, collection: &str, field: &str) -> Option<String> {
        let key = format!("{}:{}", collection, field);
        self.field_indexes.get(&key)
            .and_then(|indexes| indexes.first())
            .cloned()
    }

    pub fn has_index(&self, collection: &str, field: &str) -> bool {
        self.get_index_for_field(collection, field).is_some()
    }

    pub fn get_all_indexes(&self) -> Vec<IndexMetadata> {
        self.metadata.values().cloned().collect()
    }
}

// ===== 索引存储扩展 =====

pub trait IndexedStorage: Storage {
    fn create_index(&self, collection: &str, field: &str) -> anyhow::Result<()>;
    fn drop_index(&self, collection: &str, field: &str) -> anyhow::Result<()>;
    fn list_indexes(&self, collection: &str) -> anyhow::Result<Vec<String>>;
    fn rebuild_index(&self, collection: &str, field: &str) -> anyhow::Result<()>;
}

// ===== 索引查询优化器 =====

pub struct QueryOptimizer {
    index_manager: IndexManager,
}

impl QueryOptimizer {
    pub fn new(index_manager: IndexManager) -> Self {
        Self { index_manager }
    }

    pub fn select_index(&self, query: &Query) -> Option<String> {
        // 查找可以使用索引的过滤器
        for (field, _) in &query.filters {
            if self.index_manager.has_index(&query.collection, field) {
                return self.index_manager.get_index_for_field(&query.collection, field);
            }
        }
        None
    }

    pub fn estimate_selectivity(&self, _field: &str, value: &serde_json::Value) -> f64 {
        // 简化的选择性估计
        // 在实际实现中，应该基于统计信息
        match value {
            serde_json::Value::String(s) if s.is_empty() => 0.9,
            serde_json::Value::Null => 0.5,
            _ => 0.1, // 默认假设10%的选择性
        }
    }
}

// ===== 索引维护器 =====

pub struct IndexMaintainer {
    storage: SledStorage,
    index_manager: IndexManager,
}

impl IndexMaintainer {
    pub fn new(storage: SledStorage) -> Self {
        Self {
            storage,
            index_manager: IndexManager::new(),
        }
    }

    pub async fn on_document_insert(&self, doc: &Document) -> anyhow::Result<()> {
        // 获取该集合的所有索引
        for metadata in self.index_manager.get_all_indexes() {
            if metadata.collection == doc.collection {
                // 检查文档是否有该字段
                if let Some(field_value) = doc.data.get(&metadata.field) {
                    self.insert_to_index(
                        &doc.collection,
                        &metadata.field,
                        &doc.id,
                        field_value
                    ).await?;
                }
            }
        }
        Ok(())
    }

    pub async fn on_document_update(&self, old_doc: &Document, new_doc: &Document) -> anyhow::Result<()> {
        // 更新索引：删除旧值，插入新值
        for metadata in self.index_manager.get_all_indexes() {
            if metadata.collection == new_doc.collection {
                // 删除旧索引条目
                if let Some(old_value) = old_doc.data.get(&metadata.field) {
                    self.remove_from_index(
                        &new_doc.collection,
                        &metadata.field,
                        &new_doc.id,
                        old_value
                    ).await?;
                }

                // 插入新索引条目
                if let Some(new_value) = new_doc.data.get(&metadata.field) {
                    self.insert_to_index(
                        &new_doc.collection,
                        &metadata.field,
                        &new_doc.id,
                        new_value
                    ).await?;
                }
            }
        }
        Ok(())
    }

    pub async fn on_document_delete(&self, doc: &Document) -> anyhow::Result<()> {
        // 从所有索引中删除
        for metadata in self.index_manager.get_all_indexes() {
            if metadata.collection == doc.collection {
                if let Some(field_value) = doc.data.get(&metadata.field) {
                    self.remove_from_index(
                        &doc.collection,
                        &metadata.field,
                        &doc.id,
                        field_value
                    ).await?;
                }
            }
        }
        Ok(())
    }

    async fn insert_to_index(&self, collection: &str, field: &str, doc_id: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        let index_tree_name = format!("__index__{}:{}", collection, field);

        // 构建索引键：field_value + 0x00 + doc_id
        let value_bytes = serde_json::to_vec(value)?;
        let mut key_bytes = value_bytes;
        key_bytes.push(0x00); // null separator
        key_bytes.extend_from_slice(doc_id.as_bytes());

        let tree = self.storage.db().open_tree(&index_tree_name)?;
        tree.insert(key_bytes, b"")?;
        tree.flush()?;

        Ok(())
    }

    async fn remove_from_index(&self, collection: &str, field: &str, doc_id: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        let index_tree_name = format!("__index__{}:{}", collection, field);

        let value_bytes = serde_json::to_vec(value)?;
        let mut key_bytes = value_bytes;
        key_bytes.push(0x00);
        key_bytes.extend_from_slice(doc_id.as_bytes());

        let tree = self.storage.db().open_tree(&index_tree_name)?;
        tree.remove(&key_bytes)?;
        tree.flush()?;

        Ok(())
    }

    pub async fn rebuild_index(&self, collection: &str, field: &str) -> anyhow::Result<()> {
        // 清空并重建索引
        let index_tree_name = format!("__index__{}:{}", collection, field);

        // 删除旧索引
        {
            let tree = self.storage.db().open_tree(&index_tree_name)?;
            tree.clear()?;
        }

        // 重新扫描集合并构建索引
        let docs = self.storage.list(collection).await?;
        for doc in docs {
            if let Some(value) = doc.data.get(field) {
                self.insert_to_index(collection, field, &doc.id, value).await?;
            }
        }

        Ok(())
    }
}

// ===== 单元测试 =====

#[cfg(test)]
mod tests {
    use super::*;

    // ===== 索引管理器测试 =====

    #[test]
    fn test_index_manager_create() {
        let mut manager = IndexManager::new();

        let index_id = manager.create_index("articles", "status");

        assert_eq!(index_id, "__index__articles:status");
        assert!(manager.has_index("articles", "status"));
    }

    #[test]
    fn test_index_manager_multiple_indexes() {
        let mut manager = IndexManager::new();

        manager.create_index("articles", "status");
        manager.create_index("articles", "author_id");
        manager.create_index("users", "email");

        assert!(manager.has_index("articles", "status"));
        assert!(manager.has_index("articles", "author_id"));
        assert!(manager.has_index("users", "email"));
        assert!(!manager.has_index("articles", "missing"));
    }

    #[test]
    fn test_index_manager_get_metadata() {
        let mut manager = IndexManager::new();

        manager.create_index("articles", "status");

        let indexes = manager.get_all_indexes();
        assert_eq!(indexes.len(), 1);
        assert_eq!(indexes[0].collection, "articles");
        assert_eq!(indexes[0].field, "status");
        assert_eq!(indexes[0].index_type, IndexType::SingleField);
    }

    // ===== 查询优化器测试 =====

    #[test]
    fn test_query_optimizer_select_index() {
        let mut index_manager = IndexManager::new();
        index_manager.create_index("articles", "status");

        let optimizer = QueryOptimizer::new(index_manager);

        let query = Query {
            collection: "articles".to_string(),
            filters: vec![
                ("status".to_string(), QueryOp::Eq(json!("published")))
            ],
            limit: None,
            offset: None,
        };

        let selected_index = optimizer.select_index(&query);
        assert_eq!(selected_index, Some("__index__articles:status".to_string()));
    }

    #[test]
    fn test_query_optimizer_no_index() {
        let index_manager = IndexManager::new();
        let optimizer = QueryOptimizer::new(index_manager);

        let query = Query {
            collection: "articles".to_string(),
            filters: vec![
                ("status".to_string(), QueryOp::Eq(json!("published")))
            ],
            limit: None,
            offset: None,
        };

        let selected_index = optimizer.select_index(&query);
        assert!(selected_index.is_none());
    }

    #[test]
    fn test_query_optimizer_selectivity() {
        let index_manager = IndexManager::new();
        let optimizer = QueryOptimizer::new(index_manager);

        // 高选择性（低值）
        let selectivity = optimizer.estimate_selectivity("status", &json!("published"));
        assert!(selectivity < 0.5);

        // 低选择性（高值）
        let selectivity = optimizer.estimate_selectivity("status", &json!(""));
        assert!(selectivity > 0.5);
    }

    // ===== 索引维护测试 =====

    #[tokio::test]
    async fn test_index_maintainer_insert() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();
        let mut maintainer = IndexMaintainer::new(storage);

        // 创建索引
        let _index_id = maintainer.index_manager.create_index("articles", "status");

        // 插入文档
        let doc = Document::new(
            "articles".to_string(),
            json!({
                "title": "Test Article",
                "status": "published"
            })
        );

        maintainer.on_document_insert(&doc).await.unwrap();

        // 验证索引已创建
        let index_tree_name = "__index__articles:status";
        let tree = maintainer.storage.db().open_tree(index_tree_name).unwrap();

        // 检查索引树不为空
        let iter = tree.iter();
        let count = iter.count();
        assert!(count > 0);
    }

    #[tokio::test]
    async fn test_index_maintainer_update() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();
        let mut maintainer = IndexMaintainer::new(storage);

        maintainer.index_manager.create_index("articles", "status");

        // 插入文档
        let mut doc = Document::new(
            "articles".to_string(),
            json!({"title": "Test", "status": "draft"})
        );
        maintainer.on_document_insert(&doc.clone()).await.unwrap();

        // 更新文档
        doc.data = json!({"title": "Test", "status": "published"});
        maintainer.on_document_update(&doc.clone(), &doc.clone()).await.unwrap();

        // 验证索引更新
        let index_tree_name = "__index__articles:status";
        let tree = maintainer.storage.db().open_tree(index_tree_name).unwrap();

        // 应该有 "published" 的索引条目
        let published_key = serde_json::to_vec(&json!("published")).unwrap();
        let mut key_bytes = published_key;
        key_bytes.push(0x00);

        // 检查是否存在
        let has_published = tree.iter().any(|item: Result<(sled::IVec, sled::IVec), sled::Error>| {
            item.ok().map_or(false, |(k, _)| {
                k.starts_with(&key_bytes)
            })
        });

        assert!(has_published);
    }

    #[tokio::test]
    async fn test_index_maintainer_delete() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();
        let mut maintainer = IndexMaintainer::new(storage);

        maintainer.index_manager.create_index("articles", "status");

        // 插入文档
        let doc = Document::new(
            "articles".to_string(),
            json!({"title": "Test", "status": "published"})
        );
        maintainer.on_document_insert(&doc.clone()).await.unwrap();

        // 删除文档
        maintainer.on_document_delete(&doc).await.unwrap();

        // 验证索引已删除
        let index_tree_name = "__index__articles:status";
        let tree = maintainer.storage.db().open_tree(index_tree_name).unwrap();

        let count = tree.iter().count();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn test_rebuild_index() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();
        let mut maintainer = IndexMaintainer::new(storage);

        // 先插入一些文档
        let doc1 = Document::new("articles".to_string(), json!({"status": "published", "title": "A1"}));
        let doc2 = Document::new("articles".to_string(), json!({"status": "draft", "title": "A2"}));

        maintainer.storage.insert(doc1).await.unwrap();
        maintainer.storage.insert(doc2).await.unwrap();

        // 创建索引（会触发重建）
        maintainer.index_manager.create_index("articles", "status");
        maintainer.rebuild_index("articles", "status").await.unwrap();

        // 验证索引正确构建
        let index_tree_name = "__index__articles:status";
        let tree = maintainer.storage.db().open_tree(index_tree_name).unwrap();

        let count = tree.iter().count();
        assert_eq!(count, 2); // 两个文档的索引
    }

    // ===== 索引查询性能测试 =====

    #[tokio::test]
    async fn test_indexed_query_performance() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();
        let mut maintainer = IndexMaintainer::new(storage);

        // 创建大量文档
        for i in 0..100 {
            let status = if i % 2 == 0 { "published" } else { "draft" };
            let doc = Document::new(
                "articles".to_string(),
                json!({
                    "id": format!("article_{}", i),
                    "status": status,
                    "title": format!("Article {}", i)
                })
            );
            maintainer.storage.insert(doc.clone()).await.unwrap();
            maintainer.on_document_insert(&doc).await.unwrap();
        }

        // 创建索引
        maintainer.index_manager.create_index("articles", "status");

        // 重建索引以填充现有数据
        maintainer.rebuild_index("articles", "status").await.unwrap();

        // 使用索引查询
        let query = Query {
            collection: "articles".to_string(),
            filters: vec![
                ("status".to_string(), QueryOp::Eq(json!("published")))
            ],
            limit: None,
            offset: None,
        };

        let optimizer = QueryOptimizer::new(maintainer.index_manager);
        let selected_index = optimizer.select_index(&query);

        assert!(selected_index.is_some());

        // 在实际实现中，这里应该使用索引进行查询
        // 现在我们验证索引确实存在
        let index_tree_name = "__index__articles:status";
        let tree = maintainer.storage.db().open_tree(index_tree_name).unwrap();

        let published_key = serde_json::to_vec(&json!("published")).unwrap();
        let mut prefix = published_key;
        prefix.push(0x00);

        // 计算匹配的索引条目数
        let count = tree.iter().filter(|item: &Result<(sled::IVec, sled::IVec), sled::Error>| {
            item.as_ref().ok().map_or(false, |(k, _)| k.starts_with(&prefix))
        }).count();

        assert_eq!(count, 50); // 50个 published 文档
    }

    // ===== 范围查询测试 =====

    #[tokio::test]
    async fn test_range_query_with_index() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();
        let mut maintainer = IndexMaintainer::new(storage);

        // 创建带有数字字段的文档
        for i in 1..=10 {
            let doc = Document::new(
                "products".to_string(),
                json!({
                    "name": format!("Product {}", i),
                    "price": i * 10
                })
            );
            maintainer.storage.insert(doc.clone()).await.unwrap();
            maintainer.on_document_insert(&doc).await.unwrap();
        }

        // 创建价格索引
        maintainer.index_manager.create_index("products", "price");

        // 范围查询：价格 > 50
        let query = Query {
            collection: "products".to_string(),
            filters: vec![
                ("price".to_string(), QueryOp::Gt(json!(50)))
            ],
            limit: None,
            offset: None,
        };

        // 验证可以使用索引
        let optimizer = QueryOptimizer::new(maintainer.index_manager);
        let selected_index = optimizer.select_index(&query);

        assert!(selected_index.is_some());
    }

    // ===== In-list 查询测试 =====

    #[tokio::test]
    async fn test_in_list_query_with_index() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();
        let mut maintainer = IndexMaintainer::new(storage);

        // 创建不同状态的文档
        let statuses = ["published", "draft", "archived", "pending"];
        for status in &statuses {
            for i in 0..5 {
                let doc = Document::new(
                    "articles".to_string(),
                    json!({
                        "status": status,
                        "title": format!("{} Article {}", status, i)
                    })
                );
                maintainer.storage.insert(doc.clone()).await.unwrap();
                maintainer.on_document_insert(&doc).await.unwrap();
            }
        }

        // 创建状态索引
        maintainer.index_manager.create_index("articles", "status");

        // In-list 查询
        let query = Query {
            collection: "articles".to_string(),
            filters: vec![
                ("status".to_string(), QueryOp::In(vec![json!("published"), json!("draft")]))
            ],
            limit: None,
            offset: None,
        };

        // 验证查询逻辑
        let results = maintainer.storage.query(query).await.unwrap();
        assert_eq!(results.len(), 10); // 5 published + 5 draft
    }

    // ===== 索引一致性测试 =====

    #[tokio::test]
    async fn test_index_consistency_on_update() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();
        let mut maintainer = IndexMaintainer::new(storage);

        maintainer.index_manager.create_index("articles", "status");

        // 插入文档
        let mut doc = Document::new(
            "articles".to_string(),
            json!({"status": "draft", "title": "Draft"})
        );
        maintainer.storage.insert(doc.clone()).await.unwrap();
        maintainer.on_document_insert(&doc).await.unwrap();

        // 更新文档
        let old_doc = doc.clone();
        doc.data = json!({"status": "published", "title": "Published"});
        maintainer.storage.update("articles", &doc.id, doc.data.clone()).await.unwrap();
        maintainer.on_document_update(&old_doc, &doc).await.unwrap();

        // 验证索引一致性
        let index_tree_name = "__index__articles:status";
        let tree = maintainer.storage.db().open_tree(index_tree_name).unwrap();

        // 检查 draft 条目已删除
        let draft_key = serde_json::to_vec(&json!("draft")).unwrap();
        let mut draft_prefix = draft_key;
        draft_prefix.push(0x00);

        let has_draft = tree.iter().any(|item: Result<(sled::IVec, sled::IVec), sled::Error>| {
            item.ok().map_or(false, |(k, _)| k.starts_with(&draft_prefix))
        });

        assert!(!has_draft, "Draft index entry should be removed");

        // 检查 published 条目存在
        let published_key = serde_json::to_vec(&json!("published")).unwrap();
        let mut published_prefix = published_key;
        published_prefix.push(0x00);

        let has_published = tree.iter().any(|item: Result<(sled::IVec, sled::IVec), sled::Error>| {
            item.ok().map_or(false, |(k, _)| k.starts_with(&published_prefix))
        });

        assert!(has_published, "Published index entry should exist");
    }

    // ===== 多字段索引选择测试 =====

    #[tokio::test]
    async fn test_query_optimizer_multi_field_selection() {
        let mut index_manager = IndexManager::new();

        // 创建多个索引
        index_manager.create_index("articles", "status");
        index_manager.create_index("articles", "author_id");
        index_manager.create_index("articles", "category");

        let optimizer = QueryOptimizer::new(index_manager);

        // 多字段查询
        let query = Query {
            collection: "articles".to_string(),
            filters: vec![
                ("status".to_string(), QueryOp::Eq(json!("published"))),
                ("author_id".to_string(), QueryOp::Eq(json!("user_1"))),
                ("category".to_string(), QueryOp::Eq(json!("tech")))
            ],
            limit: None,
            offset: None,
        };

        // 应该选择第一个可用索引
        let selected_index = optimizer.select_index(&query);
        assert!(selected_index.is_some());

        // 在完整实现中，应该选择选择性最高的索引
    }
}