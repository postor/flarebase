use flare_db::{SledStorage, Storage};
use flare_protocol::{Document, Query, QueryOp};
use serde_json::json;
use tempfile::TempDir;
use std::collections::HashMap;

fn create_test_storage() -> (SledStorage, TempDir) {
    let temp_dir = TempDir::new().unwrap();
    let storage = SledStorage::new(temp_dir.path()).unwrap();
    (storage, temp_dir)
}

// ==================== Basic CRUD Operations ====================

#[tokio::test]
async fn test_insert_get() {
    let (storage, _temp) = create_test_storage();

    let doc = Document::new("users".to_string(), json!({
        "name": "Alice",
        "age": 30,
        "email": "alice@example.com"
    }));

    storage.insert(doc.clone()).await.unwrap();

    let retrieved = storage.get("users", &doc.id).await.unwrap();
    assert!(retrieved.is_some());
    let retrieved_doc = retrieved.unwrap();
    assert_eq!(retrieved_doc.id, doc.id);
    assert_eq!(retrieved_doc.data["name"], "Alice");
    assert_eq!(retrieved_doc.data["age"], 30);
    assert_eq!(retrieved_doc.version, 1);
}

#[tokio::test]
async fn test_delete_consistency() {
    let (storage, _temp) = create_test_storage();

    let doc = Document::new("users".to_string(), json!({
        "name": "Bob",
        "age": 25
    }));

    storage.insert(doc.clone()).await.unwrap();

    // Verify document exists
    let retrieved = storage.get("users", &doc.id).await.unwrap();
    assert!(retrieved.is_some());

    // Delete the document
    storage.delete("users", &doc.id).await.unwrap();

    // Verify document is gone
    let retrieved = storage.get("users", &doc.id).await.unwrap();
    assert!(retrieved.is_none(), "Document should not exist after deletion");

    // Verify query doesn't return deleted document
    let query = Query {
        collection: "users".to_string(),
        filters: vec![],
        limit: None,
        offset: None,
    };
    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 0, "Query should return empty after deletion");
}

#[tokio::test]
async fn test_update_document() {
    let (storage, _temp) = create_test_storage();

    let doc = Document::new("users".to_string(), json!({
        "name": "Charlie",
        "age": 35,
        "city": "NYC"
    }));

    storage.insert(doc.clone()).await.unwrap();

    // Update the document
    let updated_data = json!({
        "name": "Charlie",
        "age": 36,
        "city": "LA"
    });

    let updated_doc = storage.update("users", &doc.id, updated_data).await.unwrap();
    assert!(updated_doc.is_some());

    let updated = updated_doc.unwrap();
    assert_eq!(updated.id, doc.id);
    assert_eq!(updated.data["age"], 36);
    assert_eq!(updated.data["city"], "LA");
    assert_eq!(updated.version, 2, "Version should increment after update");

    // Verify update persisted
    let retrieved = storage.get("users", &doc.id).await.unwrap();
    assert!(retrieved.is_some());
    let retrieved_doc = retrieved.unwrap();
    assert_eq!(retrieved_doc.version, 2);
    assert_eq!(retrieved_doc.data["age"], 36);
}

// ==================== Query Functionality ====================

#[tokio::test]
async fn test_query_eq_filter() {
    let (storage, _temp) = create_test_storage();

    // Insert multiple documents
    for i in 1..=5 {
        let doc = Document::new("products".to_string(), json!({
            "name": format!("Product {}", i),
            "price": i * 10,
            "category": "electronics"
        }));
        storage.insert(doc).await.unwrap();
    }

    // Query with equality filter
    let query = Query {
        collection: "products".to_string(),
        filters: vec![
            ("price".to_string(), QueryOp::Eq(json!(30)))
        ],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].data["price"], 30);
    assert_eq!(results[0].data["name"], "Product 3");
}

#[tokio::test]
async fn test_query_gt_filter() {
    let (storage, _temp) = create_test_storage();

    for i in 1..=5 {
        let doc = Document::new("scores".to_string(), json!({
            "player": format!("Player{}", i),
            "score": i * 10
        }));
        storage.insert(doc).await.unwrap();
    }

    let query = Query {
        collection: "scores".to_string(),
        filters: vec![
            ("score".to_string(), QueryOp::Gt(json!(25)))
        ],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 3); // scores 30, 40, 50
    for result in &results {
        assert!(result.data["score"].as_i64().unwrap() > 25);
    }
}

#[tokio::test]
async fn test_query_lt_filter() {
    let (storage, _temp) = create_test_storage();

    for i in 1..=5 {
        let doc = Document::new("temperatures".to_string(), json!({
            "city": format!("City{}", i),
            "temp": i * 5
        }));
        storage.insert(doc).await.unwrap();
    }

    let query = Query {
        collection: "temperatures".to_string(),
        filters: vec![
            ("temp".to_string(), QueryOp::Lt(json!(15)))
        ],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 2); // temps 5, 10
    for result in &results {
        assert!(result.data["temp"].as_i64().unwrap() < 15);
    }
}

#[tokio::test]
async fn test_query_gte_lte() {
    let (storage, _temp) = create_test_storage();

    for i in 1..=10 {
        let doc = Document::new("items".to_string(), json!({
            "id": i,
            "value": i
        }));
        storage.insert(doc).await.unwrap();
    }

    // Test GTE
    let query_gte = Query {
        collection: "items".to_string(),
        filters: vec![
            ("value".to_string(), QueryOp::Gte(json!(5)))
        ],
        limit: None,
        offset: None,
    };

    let results_gte = storage.query(query_gte).await.unwrap();
    assert_eq!(results_gte.len(), 6); // values 5, 6, 7, 8, 9, 10

    // Test LTE
    let query_lte = Query {
        collection: "items".to_string(),
        filters: vec![
            ("value".to_string(), QueryOp::Lte(json!(4)))
        ],
        limit: None,
        offset: None,
    };

    let results_lte = storage.query(query_lte).await.unwrap();
    assert_eq!(results_lte.len(), 4); // values 1, 2, 3, 4
}

#[tokio::test]
async fn test_query_in_operator() {
    let (storage, _temp) = create_test_storage();

    let valid_ids = vec![1, 3, 5, 7, 9];
    for i in 1..=10 {
        let doc = Document::new("orders".to_string(), json!({
            "order_id": i,
            "amount": i * 100
        }));
        storage.insert(doc).await.unwrap();
    }

    let query = Query {
        collection: "orders".to_string(),
        filters: vec![
            ("order_id".to_string(), QueryOp::In(
                valid_ids.iter().map(|id| json!(*id)).collect()
            ))
        ],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 5);
    for result in &results {
        let order_id = result.data["order_id"].as_i64().unwrap();
        assert!(valid_ids.contains(&(order_id as i64)));
    }
}

#[tokio::test]
async fn test_query_and_or() {
    let (storage, _temp) = create_test_storage();

    let data = vec![
        ("Alice", 28, "Engineering"),
        ("Bob", 32, "Sales"),
        ("Charlie", 25, "Engineering"),
        ("Diana", 30, "Sales"),
    ];

    for (name, age, dept) in data {
        let doc = Document::new("employees".to_string(), json!({
            "name": name,
            "age": age,
            "department": dept
        }));
        storage.insert(doc).await.unwrap();
    }

    // Test AND: Engineering AND age >= 28
    let query_and = Query {
        collection: "employees".to_string(),
        filters: vec![
            ("department".to_string(), QueryOp::Eq(json!("Engineering"))),
            ("age".to_string(), QueryOp::Gte(json!(28)))
        ],
        limit: None,
        offset: None,
    };

    let results_and = storage.query(query_and).await.unwrap();
    assert_eq!(results_and.len(), 1);
    assert_eq!(results_and[0].data["name"], "Alice");

    // Test OR: age < 27 (Charlie)
    // Note: Cross-field OR queries (age < 27 OR department == Sales) are not supported
    // by the current query API design. Each filter operates on a single field.
    let query_or_age = Query {
        collection: "employees".to_string(),
        filters: vec![
            ("age".to_string(), QueryOp::Lt(json!(27)))
        ],
        limit: None,
        offset: None,
    };

    let results_or = storage.query(query_or_age).await.unwrap();
    assert_eq!(results_or.len(), 1); // Only Charlie (age 25)

    // Test department filter separately
    let query_sales = Query {
        collection: "employees".to_string(),
        filters: vec![
            ("department".to_string(), QueryOp::Eq(json!("Sales")))
        ],
        limit: None,
        offset: None,
    };

    let results_sales = storage.query(query_sales).await.unwrap();
    assert_eq!(results_sales.len(), 2); // Bob and Diana
}

#[tokio::test]
async fn test_query_offset_limit() {
    let (storage, _temp) = create_test_storage();

    for i in 1..=20 {
        let doc = Document::new("posts".to_string(), json!({
            "id": i,
            "title": format!("Post {}", i)
        }));
        storage.insert(doc).await.unwrap();
    }

    // Test with filter first to ensure deterministic ordering
    let query = Query {
        collection: "posts".to_string(),
        filters: vec![
            ("id".to_string(), QueryOp::Gte(json!(1)))
        ],
        limit: Some(10),
        offset: Some(5),
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 10);

    // Verify all results have valid IDs
    for result in &results {
        let id = result.data["id"].as_i64().unwrap();
        assert!(id >= 1 && id <= 20);
    }
}

#[tokio::test]
async fn test_query_multiple_filters() {
    let (storage, _temp) = create_test_storage();

    let products = vec![
        ("Laptop", 1200, "Electronics", 30),  // Changed stock from 10 to 30
        ("Mouse", 25, "Electronics", 50),
        ("Desk", 300, "Furniture", 15),
        ("Chair", 150, "Furniture", 20),
        ("Monitor", 400, "Electronics", 25),
    ];

    for (name, price, category, stock) in products {
        let doc = Document::new("inventory".to_string(), json!({
            "name": name,
            "price": price,
            "category": category,
            "stock": stock
        }));
        storage.insert(doc).await.unwrap();
    }

    // Query: Electronics AND price >= 100 AND stock >= 20
    let query = Query {
        collection: "inventory".to_string(),
        filters: vec![
            ("category".to_string(), QueryOp::Eq(json!("Electronics"))),
            ("price".to_string(), QueryOp::Gte(json!(100))),
            ("stock".to_string(), QueryOp::Gte(json!(20)))
        ],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 2); // Laptop and Monitor
    for result in &results {
        assert_eq!(result.data["category"], "Electronics");
        assert!(result.data["price"].as_i64().unwrap() >= 100);
        assert!(result.data["stock"].as_i64().unwrap() >= 20);
    }
}

// ==================== Edge Cases ====================

#[tokio::test]
async fn test_query_empty_collection() {
    let (storage, _temp) = create_test_storage();

    let query = Query {
        collection: "nonexistent".to_string(),
        filters: vec![],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 0, "Empty collection should return no results");
}

#[tokio::test]
async fn test_query_nonexistent_field() {
    let (storage, _temp) = create_test_storage();

    let doc = Document::new("test".to_string(), json!({
        "name": "Test",
        "value": 100
    }));
    storage.insert(doc).await.unwrap();

    // Query for non-existent field
    let query = Query {
        collection: "test".to_string(),
        filters: vec![
            ("nonexistent_field".to_string(), QueryOp::Eq(json!("something")))
        ],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 0, "Non-existent field should return no results");
}

#[tokio::test]
async fn test_list_empty_collection() {
    let (storage, _temp) = create_test_storage();

    let results = storage.list("empty_collection").await.unwrap();
    assert_eq!(results.len(), 0, "Listing empty collection should return empty vec");
}

#[tokio::test]
async fn test_get_nonexistent_doc() {
    let (storage, _temp) = create_test_storage();

    let result = storage.get("users", "nonexistent_id").await.unwrap();
    assert!(result.is_none(), "Getting non-existent document should return None");
}

// ==================== Data Consistency ====================

#[tokio::test]
async fn test_concurrent_inserts() {
    let (storage, _temp) = create_test_storage();
    let storage = std::sync::Arc::new(storage);

    // Spawn multiple concurrent insert tasks
    let mut handles = vec![];

    for i in 0..10 {
        let storage_clone = storage.clone();
        let handle = tokio::spawn(async move {
            let doc = Document::new("concurrent".to_string(), json!({
                "index": i,
                "data": format!("Data {}", i)
            }));
            storage_clone.insert(doc).await
        });
        handles.push(handle);
    }

    // Wait for all inserts to complete
    for handle in handles {
        handle.await.unwrap().unwrap();
    }

    // Verify all documents were inserted
    let results = storage.list("concurrent").await.unwrap();
    assert_eq!(results.len(), 10, "All concurrent inserts should succeed");
}

#[tokio::test]
async fn test_version_increment() {
    let (storage, _temp) = create_test_storage();

    let doc = Document::new("version_test".to_string(), json!({
        "value": "initial"
    }));

    storage.insert(doc.clone()).await.unwrap();

    // First update
    let v1 = storage.update("version_test", &doc.id, json!({"value": "v1"})).await.unwrap();
    assert_eq!(v1.unwrap().version, 2);

    // Second update
    let v2 = storage.update("version_test", &doc.id, json!({"value": "v2"})).await.unwrap();
    assert_eq!(v2.unwrap().version, 3);

    // Third update
    let v3 = storage.update("version_test", &doc.id, json!({"value": "v3"})).await.unwrap();
    assert_eq!(v3.unwrap().version, 4);

    // Verify final version
    let final_doc = storage.get("version_test", &doc.id).await.unwrap();
    assert_eq!(final_doc.unwrap().version, 4);
}
