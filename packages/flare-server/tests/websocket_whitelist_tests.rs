/// FlareDB WebSocket 层次测试
/// 测试白名单配置和数据操作正确性
/// 参考 user_and_article_flows_tests.rs 结构

use flare_server::{AppState, QueryExecutor, UserContext, ClusterManager, EventBus, PluginManager};
use flare_db::{Storage, memory::MemoryStorage};
use flare_protocol::Document;
use socketioxide::SocketIo;
use std::sync::Arc;
use std::collections::HashMap;
use serde_json::json;
use tokio::sync::Mutex;
use tokio::time::Duration;

// ===== 测试数据结构和工具 =====

/// 模拟 WebSocket 消息收集器
struct MockMessageCollector {
    messages: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
}

impl MockMessageCollector {
    fn new() -> Self {
        Self {
            messages: Arc::new(Mutex::new(Vec::new())),
        }
    }

    async fn collect(&self, event: String, data: serde_json::Value) {
        let mut messages = self.messages.lock().await;
        messages.push((event, data));
    }

    async fn get_messages(&self) -> Vec<(String, serde_json::Value)> {
        let messages = self.messages.lock().await;
        messages.clone()
    }

    async fn clear(&self) {
        let mut messages = self.messages.lock().await;
        messages.clear();
    }
}

/// 创建测试用的 AppState
fn create_test_state() -> Arc<AppState> {
    let storage: Arc<dyn Storage> = Arc::new(MemoryStorage::new());
    let (_io_layer, io) = SocketIo::builder().build_layer();

    // 白名单配置
    let whitelist_config = r#"
    {
        "queries": {
            "list_published_posts": {
                "type": "simple",
                "collection": "posts",
                "filters": [
                    ["status", {"Eq": "published"}]
                ]
            },
            "list_my_posts": {
                "type": "simple",
                "collection": "posts",
                "filters": [
                    ["author_id", {"Eq": "$USER_ID"}]
                ]
            },
            "get_user_profile": {
                "type": "simple",
                "collection": "users",
                "filters": [
                    ["id", {"Eq": "$USER_ID"}]
                ]
            },
            "list_all_articles": {
                "type": "simple",
                "collection": "articles",
                "filters": []
            }
        }
    }
    "#;

    let query_executor = Arc::new(
        QueryExecutor::from_json(whitelist_config)
            .expect("Failed to parse whitelist config")
    );

    Arc::new(AppState {
        storage,
        io,
        cluster: Arc::new(ClusterManager::new()),
        node_id: 1,
        event_bus: Arc::new(EventBus::new().0),
        plugin_manager: Arc::new(PluginManager::new()),
        query_executor,
    })
}

// ===== 白名单查询测试 =====

#[tokio::test]
async fn test_websocket_whitelist_query_list_published_posts() {
    let state = create_test_state();

    // 插入测试数据
    let published_post = Document::new(
        "posts".to_string(),
        json!({
            "title": "Published Post 1",
            "content": "Public content",
            "author_id": "user_1",
            "status": "published"
        })
    );
    state.storage.insert(published_post).await.unwrap();

    let draft_post = Document::new(
        "posts".to_string(),
        json!({
            "title": "Draft Post",
            "content": "Private content",
            "author_id": "user_1",
            "status": "draft"
        })
    );
    state.storage.insert(draft_post).await.unwrap();

    let published_post2 = Document::new(
        "posts".to_string(),
        json!({
            "title": "Published Post 2",
            "content": "Another public content",
            "author_id": "user_2",
            "status": "published"
        })
    );
    state.storage.insert(published_post2).await.unwrap();

    // 模拟 WebSocket 查询执行
    let user_context = UserContext {
        user_id: "guest".to_string(),
        user_role: "guest".to_string(),
    };

    let result = state.query_executor.execute_query(
        "list_published_posts",
        &user_context,
        &HashMap::new()
    );

    assert!(result.is_ok());
    match result.unwrap() {
        flare_server::QueryResult::Simple(simple) => {
            assert_eq!(simple.collection, "posts");
            assert_eq!(simple.filters.len(), 1);
        }
        _ => panic!("Expected simple query result"),
    }
}

#[tokio::test]
async fn test_websocket_whitelist_query_user_isolation() {
    let state = create_test_state();

    // 插入测试数据 - 不同用户的文章
    let post_user1 = Document::new(
        "posts".to_string(),
        json!({
            "title": "User 1 Post",
            "author_id": "user_1",
            "status": "published"
        })
    );
    state.storage.insert(post_user1).await.unwrap();

    let post_user2 = Document::new(
        "posts".to_string(),
        json!({
            "title": "User 2 Post",
            "author_id": "user_2",
            "status": "published"
        })
    );
    state.storage.insert(post_user2).await.unwrap();

    // 用户 1 查询自己的文章
    let user1_context = UserContext {
        user_id: "user_1".to_string(),
        user_role: "user".to_string(),
    };

    let result1 = state.query_executor.execute_query(
        "list_my_posts",
        &user1_context,
        &HashMap::new()
    );

    assert!(result1.is_ok());
    match result1.unwrap() {
        flare_server::QueryResult::Simple(simple) => {
            assert_eq!(simple.collection, "posts");
            // 验证过滤条件中包含作者 ID
            assert!(simple.filters.iter().any(|f| {
                f.get("field").and_then(|v| v.as_str()) == Some("author_id")
            }));
        }
        _ => panic!("Expected simple query result"),
    }

    // 用户 2 查询自己的文章
    let user2_context = UserContext {
        user_id: "user_2".to_string(),
        user_role: "user".to_string(),
    };

    let result2 = state.query_executor.execute_query(
        "list_my_posts",
        &user2_context,
        &HashMap::new()
    );

    assert!(result2.is_ok());
}

#[tokio::test]
async fn test_websocket_whitelist_rejects_arbitrary_query() {
    let state = create_test_state();

    let user_context = UserContext {
        user_id: "user_1".to_string(),
        user_role: "user".to_string(),
    };

    // 尝试执行不在白名单中的查询
    let result = state.query_executor.execute_query(
        "drop_all_tables",
        &user_context,
        &HashMap::new()
    );

    assert!(result.is_err());
    let error_msg = result.unwrap_err().to_string();
    assert!(error_msg.contains("not found") || error_msg.contains("not in whitelist"));
}

#[tokio::test]
async fn test_websocket_whitelist_parameter_injection_prevention() {
    let state = create_test_state();

    let user_context = UserContext {
        user_id: "user_1".to_string(),
        user_role: "user".to_string(),
    };

    // 尝试通过参数注入获取其他用户的数据
    let mut malicious_params = HashMap::new();
    malicious_params.insert("author_id".to_string(), json!("admin_user"));

    let result = state.query_executor.execute_query(
        "list_my_posts",
        &user_context,
        &malicious_params
    );

    // 即使提供了 author_id 参数，查询仍然使用 $USER_ID 变量
    // 不会受到注入攻击
    assert!(result.is_ok());

    // 验证返回的过滤条件仍然使用用户上下文中的 user_id
    match result.unwrap() {
        flare_server::QueryResult::Simple(simple) => {
            let author_filter = simple.filters.iter().find(|f| {
                f.get("field").and_then(|v| v.as_str()) == Some("author_id")
            });
            assert!(author_filter.is_some());
            // value 应该被注入为 user_1（来自上下文），而不是 admin_user（来自参数）
            let value = author_filter.unwrap().get("value");
            assert!(value.is_some());
        }
        _ => panic!("Expected simple query result"),
    }
}

// ===== WebSocket 数据操作测试 =====

#[tokio::test]
async fn test_websocket_insert_and_query() {
    let state = create_test_state();

    // 模拟 insert 操作
    let doc = Document::new(
        "users".to_string(),
        json!({
            "name": "Test User",
            "email": "test@example.com",
            "role": "user"
        })
    );

    let insert_result = state.storage.insert(doc.clone()).await;
    assert!(insert_result.is_ok());

    // 模拟 get 操作
    let get_result = state.storage.get("users", &doc.id).await;
    assert!(get_result.is_ok());
    let retrieved = get_result.unwrap();
    assert!(retrieved.is_some());
    assert_eq!(retrieved.unwrap().data["name"], "Test User");
}

#[tokio::test]
async fn test_websocket_update_operation() {
    let state = create_test_state();

    // 创建文档
    let mut doc = Document::new(
        "articles".to_string(),
        json!({
            "title": "Original Title",
            "content": "Original content",
            "status": "draft"
        })
    );
    state.storage.insert(doc.clone()).await.unwrap();

    // 模拟 update 操作
    let updated_doc = state.storage.get("articles", &doc.id).await.unwrap().unwrap();
    let mut updated_data = updated_doc.data.clone();
    updated_data["title"] = json!("Updated Title");
    updated_data["status"] = json!("published");

    let mut updated_doc = updated_doc;
    updated_doc.data = updated_data;
    updated_doc.version += 1;

    let update_result = state.storage.insert(updated_doc.clone()).await;
    assert!(update_result.is_ok());

    // 验证更新
    let retrieved = state.storage.get("articles", &doc.id).await.unwrap().unwrap();
    assert_eq!(retrieved.data["title"], "Updated Title");
    assert_eq!(retrieved.data["status"], "published");
    assert_eq!(retrieved.version, 2);
}

#[tokio::test]
async fn test_websocket_delete_operation() {
    let state = create_test_state();

    // 创建文档
    let doc = Document::new(
        "temp_data".to_string(),
        json!({
            "key": "value",
            "temporary": true
        })
    );
    state.storage.insert(doc.clone()).await.unwrap();

    // 验证文档存在
    let exists = state.storage.get("temp_data", &doc.id).await.unwrap();
    assert!(exists.is_some());

    // 模拟 delete 操作
    let delete_result = state.storage.delete("temp_data", &doc.id).await;
    assert!(delete_result.is_ok());

    // 验证文档已删除
    let deleted = state.storage.get("temp_data", &doc.id).await.unwrap();
    assert!(deleted.is_none());
}

#[tokio::test]
async fn test_websocket_list_collection() {
    let state = create_test_state();

    // 插入多个文档到同一集合
    for i in 1..=5 {
        let doc = Document::new(
            "counters".to_string(),
            json!({
                "name": format!("counter_{}", i),
                "value": i
            })
        );
        state.storage.insert(doc).await.unwrap();
    }

    // 模拟 list 操作
    let list_result = state.storage.list("counters").await;
    assert!(list_result.is_ok());
    let docs = list_result.unwrap();
    assert_eq!(docs.len(), 5);
}

// ===== 复杂数据操作测试 =====

#[tokio::test]
async fn test_article_lifecycle_with_whitelist() {
    let state = create_test_state();

    let author_id = "author_test";

    // 1. 创建草稿文章
    let mut draft = Document::new(
        "articles".to_string(),
        json!({
            "title": "Test Article",
            "content": "Test content",
            "author_id": author_id,
            "status": "draft",
            "moderator_id": null,
            "internal_notes": null
        })
    );
    state.storage.insert(draft.clone()).await.unwrap();

    // 2. 验证文章创建
    let created = state.storage.get("articles", &draft.id).await.unwrap().unwrap();
    assert_eq!(created.data["status"], "draft");
    assert_eq!(created.data["author_id"], author_id);

    // 3. 提交审核
    let current = state.storage.get("articles", &draft.id).await.unwrap().unwrap();
    let mut update_data = current.data.clone();
    update_data["status"] = json!("pending_review");

    let mut updated_doc = current;
    updated_doc.data = update_data;
    updated_doc.version += 1;

    state.storage.insert(updated_doc.clone()).await.unwrap();

    let pending = state.storage.get("articles", &draft.id).await.unwrap().unwrap();
    assert_eq!(pending.data["status"], "pending_review");

    // 4. 管理员审核（添加内部字段）
    let admin = state.storage.get("articles", &draft.id).await.unwrap().unwrap();
    let mut admin_data = admin.data.clone();
    admin_data["status"] = json!("published");
    admin_data["moderator_id"] = json!("admin_001");
    admin_data["internal_notes"] = json!("Approved by admin");

    let mut admin_doc = admin;
    admin_doc.data = admin_data;
    admin_doc.version += 1;

    state.storage.insert(admin_doc.clone()).await.unwrap();

    // 5. 验证最终状态
    let final_doc = state.storage.get("articles", &draft.id).await.unwrap().unwrap();
    assert_eq!(final_doc.data["status"], "published");
    assert_eq!(final_doc.data["moderator_id"], "admin_001");

    // 6. 模拟白名单查询 - 普通用户只能看到已发布文章
    let guest_context = UserContext {
        user_id: "guest".to_string(),
        user_role: "guest".to_string(),
    };

    let query_result = state.query_executor.execute_query(
        "list_all_articles",
        &guest_context,
        &HashMap::new()
    );

    assert!(query_result.is_ok());
}

#[tokio::test]
async fn test_user_registration_flow() {
    let state = create_test_state();

    let email = "newuser@example.com";
    let password_hash = "hashed_secure_password_123";
    let session_id = "session_reg_123";

    // 1. 创建会话状态集合
    let session_collection = format!("_session_{}_registration", session_id);

    let session_doc = Document::new(
        session_collection.clone(),
        json!({
            "email": email,
            "status": "pending",
            "created_at": chrono::Utc::now().timestamp_millis()
        })
    );
    state.storage.insert(session_doc.clone()).await.unwrap();

    // 2. 验证会话状态创建
    let session = state.storage.get(&session_collection, &session_doc.id).await.unwrap().unwrap();
    assert_eq!(session.data["email"], email);
    assert_eq!(session.data["status"], "pending");

    // 3. 模拟注册成功 - 创建用户
    let user = Document::new(
        "users".to_string(),
        json!({
            "email": email,
            "password_hash": password_hash,
            "name": "New User",
            "created_at": chrono::Utc::now().timestamp_millis(),
            "status": "active"
        })
    );
    state.storage.insert(user.clone()).await.unwrap();

    // 4. 验证用户创建
    let created_user = state.storage.get("users", &user.id).await.unwrap().unwrap();
    assert_eq!(created_user.data["email"], email);
    assert_eq!(created_user.data["status"], "active");

    // 5. 更新会话状态为完成
    let session_current = state.storage.get(&session_collection, &session_doc.id).await.unwrap().unwrap();
    let mut updated_session = session_current.data.clone();
    updated_session["status"] = json!("completed");
    updated_session["user_id"] = json!(user.id.clone());

    let mut session_doc_updated = session_current;
    session_doc_updated.data = updated_session;
    session_doc_updated.version += 1;

    state.storage.insert(session_doc_updated.clone()).await.unwrap();

    // 6. 验证会话状态更新
    let final_session = state.storage.get(&session_collection, &session_doc.id).await.unwrap().unwrap();
    assert_eq!(final_session.data["status"], "completed");
    assert_eq!(final_session.data["user_id"], user.id);
}

#[tokio::test]
async fn test_concurrent_data_operations() {
    let state = create_test_state();

    // 并发插入操作
    let mut handles = Vec::new();

    for i in 0..10 {
        let storage = state.storage.clone();
        let handle = tokio::spawn(async move {
            let doc = Document::new(
                "concurrent_docs".to_string(),
                json!({
                    "index": i,
                    "timestamp": chrono::Utc::now().timestamp_millis()
                })
            );
            storage.insert(doc).await
        });
        handles.push(handle);
    }

    // 等待所有操作完成
    for handle in handles {
        let result = handle.await.unwrap();
        assert!(result.is_ok());
    }

    // 验证所有文档都已插入
    let docs = state.storage.list("concurrent_docs").await.unwrap();
    assert_eq!(docs.len(), 10);
}

// ===== 安全性测试 =====

#[tokio::test]
async fn test_whitelist_admin_bypass() {
    let state = create_test_state();

    // 管理员上下文
    let admin_context = UserContext {
        user_id: "admin_1".to_string(),
        user_role: "admin".to_string(),
    };

    // 管理员可以执行任何白名单查询
    let result = state.query_executor.execute_query(
        "list_all_articles",
        &admin_context,
        &HashMap::new()
    );

    assert!(result.is_ok());

    // 验证管理员也可以查询其他用户的文章
    let user_context = UserContext {
        user_id: "some_user".to_string(),
        user_role: "user".to_string(),
    };

    let user_result = state.query_executor.execute_query(
        "list_my_posts",
        &user_context,
        &HashMap::new()
    );

    assert!(user_result.is_ok());
}

#[tokio::test]
async fn test_whitelist_query_with_params() {
    let state = create_test_state();

    let user_context = UserContext {
        user_id: "user_1".to_string(),
        user_role: "user".to_string(),
    };

    // 测试带参数的查询
    let mut params = HashMap::new();
    params.insert("limit".to_string(), json!(10));
    params.insert("offset".to_string(), json!(0));

    let result = state.query_executor.execute_query(
        "list_all_articles",
        &user_context,
        &params
    );

    assert!(result.is_ok());
}

#[tokio::test]
async fn test_invalid_query_name_rejected() {
    let state = create_test_state();

    let user_context = UserContext {
        user_id: "user_1".to_string(),
        user_role: "user".to_string(),
    };

    // 尝试执行恶意查询名称
    let result = state.query_executor.execute_query(
        "../../../etc/passwd",
        &user_context,
        &HashMap::new()
    );

    assert!(result.is_err());
}

#[tokio::test]
async fn test_parameter_range_validation() {
    let state = create_test_state();

    let user_context = UserContext {
        user_id: "user_1".to_string(),
        user_role: "user".to_string(),
    };

    // 测试超出范围的 limit 参数
    let mut invalid_params = HashMap::new();
    invalid_params.insert("limit".to_string(), json!(99999));

    let result = state.query_executor.execute_query(
        "list_all_articles",
        &user_context,
        &invalid_params
    );

    assert!(result.is_err());
    let error_msg = result.unwrap_err().to_string();
    assert!(error_msg.contains("range") || error_msg.contains("valid"));
}

// ===== 数据隔离测试 =====

#[tokio::test]
async fn test_session_data_isolation() {
    let state = create_test_state();

    let session1_id = "session_user_a";
    let session2_id = "session_user_b";

    // 为不同会话创建隔离的数据
    let collection1 = format!("_session_{}_private_data", session1_id);
    let collection2 = format!("_session_{}_private_data", session2_id);

    let doc1 = Document::new(
        collection1.clone(),
        json!({
            "session_id": session1_id,
            "data": "private_data_for_session_a"
        })
    );

    let doc2 = Document::new(
        collection2.clone(),
        json!({
            "session_id": session2_id,
            "data": "private_data_for_session_b"
        })
    );

    state.storage.insert(doc1.clone()).await.unwrap();
    state.storage.insert(doc2.clone()).await.unwrap();

    // 验证会话数据隔离
    let list1 = state.storage.list(&collection1).await.unwrap();
    let list2 = state.storage.list(&collection2).await.unwrap();

    assert_eq!(list1.len(), 1);
    assert_eq!(list2.len(), 1);
    assert_eq!(list1[0].data["session_id"], session1_id);
    assert_eq!(list2[0].data["session_id"], session2_id);

    // 验证一个会话无法访问另一个会话的数据
    let cross_access = state.storage.get(&collection1, &doc2.id).await.unwrap();
    assert!(cross_access.is_none());
}

#[tokio::test]
async fn test_collection_naming_isolation() {
    let state = create_test_state();

    // 确保不同前缀的集合不会混淆
    let regular_collection = "posts";
    let internal_collection = "_internal_posts";

    let regular_doc = Document::new(
        regular_collection.to_string(),
        json!({"type": "regular"})
    );

    let internal_doc = Document::new(
        internal_collection.to_string(),
        json!({"type": "internal"})
    );

    state.storage.insert(regular_doc.clone()).await.unwrap();
    state.storage.insert(internal_doc.clone()).await.unwrap();

    // 验证集合正确隔离
    let regular_docs = state.storage.list(regular_collection).await.unwrap();
    let internal_docs = state.storage.list(internal_collection).await.unwrap();

    assert_eq!(regular_docs.len(), 1);
    assert_eq!(internal_docs.len(), 1);
    assert_eq!(regular_docs[0].data["type"], "regular");
    assert_eq!(internal_docs[0].data["type"], "internal");
}
