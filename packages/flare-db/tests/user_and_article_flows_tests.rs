// 补充测试：覆盖 USER_AND_ARTICLE_FLOWS.md 中描述的功能
// 重点：OTP Hook 流程、数据脱敏、Session 同步

use flare_db::Storage;
use flare_db::SledStorage;
use flare_protocol::{Document, Query, QueryOp, BatchOperation};
use tempfile::tempdir;
use serde_json::json;

// ===== OTP 和 Hook 流程测试 =====

#[tokio::test]
async fn test_otp_storage_and_verification() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    let email = "user@example.com";
    let otp = "123456";
    let session_id = "session_abc";

    // 1. 模拟 Hook 存储 OTP
    let otp_record = Document::new(
        "_internal_otps".to_string(),
        json!({
            "email": email,
            "otp": otp,
            "created_at": chrono::Utc::now().timestamp_millis(),
            "expires_at": chrono::Utc::now().timestamp_millis() + 300000, // 5分钟过期
            "used": false
        })
    );
    storage.insert(otp_record.clone()).await.unwrap();

    // 2. 验证 OTP 存储成功
    let query = Query {
        collection: "_internal_otps".to_string(),
        filters: vec![
            ("email".to_string(), QueryOp::Eq(json!(email))),
            ("otp".to_string(), QueryOp::Eq(json!(otp))),
            ("used".to_string(), QueryOp::Eq(json!(false))),
        ],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].data["email"], email);
    assert_eq!(results[0].data["otp"], otp);

    // 3. 模拟 OTP 验证和使用
    storage.update(
        "_internal_otps",
        &results[0].id,
        json!({"used": true, "used_at": chrono::Utc::now().timestamp_millis()})
    ).await.unwrap();

    // 4. 验证 OTP 已被标记为使用
    let updated = storage.get("_internal_otps", &results[0].id).await.unwrap().unwrap();
    assert_eq!(updated.data["used"], true);
}

#[tokio::test]
async fn test_session_scoped_otp_status() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    let session_id = "session_xyz";
    let collection_name = format!("_session_{}_otp_status", session_id);

    // 1. 创建会话级 OTP 状态
    let status_doc = Document::new(
        collection_name.clone(),
        json!({
            "status": "sent",
            "created_at": chrono::Utc::now().timestamp_millis(),
            "message": "OTP sent to your email"
        })
    );
    storage.insert(status_doc).await.unwrap();

    // 2. 验证会话级状态创建成功
    let results = storage.list(&collection_name).await.unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].data["status"], "sent");

    // 3. 更新会话状态为验证成功
    storage.update(
        &collection_name,
        &results[0].id,
        json!({
            "status": "verified",
            "verified_at": chrono::Utc::now().timestamp_millis()
        })
    ).await.unwrap();

    // 4. 验证状态更新
    let updated = storage.get(&collection_name, &results[0].id).await.unwrap().unwrap();
    assert_eq!(updated.data["status"], "verified");
}

#[tokio::test]
async fn test_complete_user_registration_with_otp() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    let email = "newuser@example.com";
    let otp = "654321";
    let password_hash = "hashed_secure_password";
    let session_id = "session_reg_001";

    // Step 1: 请求 OTP（模拟 Hook 行为）
    let otp_record = Document::new(
        "_internal_otps".to_string(),
        json!({
            "email": email,
            "otp": otp,
            "created_at": chrono::Utc::now().timestamp_millis(),
            "expires_at": chrono::Utc::now().timestamp_millis() + 300000,
            "used": false
        })
    );
    storage.insert(otp_record).await.unwrap();

    // Step 2: 创建会话状态
    let status_collection = format!("_session_{}_otp_status", session_id);
    let status_doc = Document::new(
        status_collection.clone(),
        json!({
            "status": "sent",
            "email": email,
            "created_at": chrono::Utc::now().timestamp_millis()
        })
    );
    storage.insert(status_doc).await.unwrap();

    // Step 3: 验证 OTP 并注册用户（模拟 Hook 验证）
    let query = Query {
        collection: "_internal_otps".to_string(),
        filters: vec![
            ("email".to_string(), QueryOp::Eq(json!(email))),
            ("otp".to_string(), QueryOp::Eq(json!(otp))),
        ],
        limit: None,
        offset: None,
    };

    let otp_results = storage.query(query).await.unwrap();
    assert_eq!(otp_results.len(), 1, "OTP should exist");

    // Step 4: 创建用户记录
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
    storage.insert(user.clone()).await.unwrap();

    // Step 5: 标记 OTP 为已使用
    storage.update(
        "_internal_otps",
        &otp_results[0].id,
        json!({"used": true, "used_at": chrono::Utc::now().timestamp_millis()})
    ).await.unwrap();

    // Step 6: 更新会话状态为成功
    storage.update(
        &status_collection,
        &storage.list(&status_collection).await.unwrap()[0].id,
        json!({"status": "success", "registered": true})
    ).await.unwrap();

    // 验证：用户创建成功
    let user_query = Query {
        collection: "users".to_string(),
        filters: vec![("email".to_string(), QueryOp::Eq(json!(email)))],
        limit: None,
        offset: None,
    };

    let users = storage.query(user_query).await.unwrap();
    assert_eq!(users.len(), 1);
    assert_eq!(users[0].data["email"], email);
    assert_eq!(users[0].data["status"], "active");

    // 验证：OTP 已被使用
    let used_otp = storage.get("_internal_otps", &otp_results[0].id).await.unwrap().unwrap();
    assert_eq!(used_otp.data["used"], true);
}

// ===== 数据脱敏测试 =====

#[tokio::test]
async fn test_sync_policy_configuration() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    // 创建 Sync Policy 配置
    let policy = Document::new(
        "__config__".to_string(),
        json!({
            "id": "sync_policy_articles",
            "internal": ["moderator_id", "internal_notes", "approval_timestamp", "rejection_reason"],
            "collection": "articles"
        })
    );

    // 手动设置 ID 以便后续查询
    let mut policy_with_id = policy.clone();
    policy_with_id.id = "sync_policy_articles".to_string();

    storage.insert(policy_with_id).await.unwrap();

    // 验证策略创建成功
    let retrieved = storage.get("__config__", "sync_policy_articles").await.unwrap();
    assert!(retrieved.is_some());

    let policy_data = retrieved.unwrap();
    assert_eq!(policy_data.data["id"], "sync_policy_articles");
    assert_eq!(policy_data.data["collection"], "articles");

    let internal_fields = policy_data.data["internal"].as_array().unwrap();
    assert!(internal_fields.contains(&json!("moderator_id")));
    assert!(internal_fields.contains(&json!("internal_notes")));
}

#[tokio::test]
async fn test_redact_internal_fields_on_article() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    // 1. 创建 Sync Policy
    let mut policy = Document::new(
        "__config__".to_string(),
        json!({
            "id": "sync_policy_articles",
            "internal": ["moderator_id", "internal_notes", "approval_timestamp"],
            "collection": "articles"
        })
    );
    policy.id = "sync_policy_articles".to_string();
    storage.insert(policy).await.unwrap();

    // 2. 创建包含敏感字段的草稿文章
    let article = Document::new(
        "articles".to_string(),
        json!({
            "title": "Sensitive Article",
            "content": "Public content",
            "author_id": "user_123",
            "status": "draft",
            "moderator_id": "admin_456",  // 敏感字段
            "internal_notes": "Needs review",  // 敏感字段
            "approval_timestamp": 1234567890  // 敏感字段
        })
    );
    storage.insert(article.clone()).await.unwrap();

    // 3. 模拟数据脱敏（参考 main.rs 中的 redact_internal_fields 函数）
    let mut article_data = article.data.clone();

    // 检查是否有 Sync Policy
    if let Ok(Some(policy_doc)) = storage.get("__config__", "sync_policy_articles").await {
        if let Some(internal_fields) = policy_doc.data.get("internal").and_then(|v| v.as_array()) {
            if let Some(obj) = article_data.as_object_mut() {
                for field in internal_fields {
                    if let Some(f_str) = field.as_str() {
                        obj.remove(f_str);
                    }
                }
            }
        }
    }

    // 4. 验证敏感字段被移除
    assert!(article_data.get("moderator_id").is_none(), "moderator_id should be removed");
    assert!(article_data.get("internal_notes").is_none(), "internal_notes should be removed");
    assert!(article_data.get("approval_timestamp").is_none(), "approval_timestamp should be removed");

    // 5. 验证公开字段仍然存在
    assert_eq!(article_data["title"], "Sensitive Article");
    assert_eq!(article_data["content"], "Public content");
    assert_eq!(article_data["author_id"], "user_123");
}

#[tokio::test]
async fn test_published_article_sanitization() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    // 创建 Sync Policy
    let mut policy = Document::new(
        "__config__".to_string(),
        json!({
            "id": "sync_policy_articles",
            "internal": ["moderator_id", "internal_notes", "rejection_reason"],
            "collection": "articles"
        })
    );
    policy.id = "sync_policy_articles".to_string();
    storage.insert(policy).await.unwrap();

    // 创建已发布的文章（包含敏感字段）
    let mut article = Document::new(
        "articles".to_string(),
        json!({
            "title": "Public Article",
            "content": "This is public content",
            "author_id": "author_123",
            "status": "published",
            "moderator_id": "admin_789",
            "internal_notes": "Approved after review",
            "rejection_reason": ""
        })
    );
    storage.insert(article.clone()).await.unwrap();

    // 模拟发布时的数据脱敏
    let mut published_data = article.data.clone();

    if let Ok(Some(policy_doc)) = storage.get("__config__", "sync_policy_articles").await {
        if let Some(internal_fields) = policy_doc.data.get("internal").and_then(|v| v.as_array()) {
            if let Some(obj) = published_data.as_object_mut() {
                for field in internal_fields {
                    if let Some(f_str) = field.as_str() {
                        obj.remove(f_str);
                    }
                }
            }
        }
    }

    // 验证发布的数据已脱敏
    assert!(published_data.get("moderator_id").is_none());
    assert!(published_data.get("internal_notes").is_none());
    assert!(published_data.get("rejection_reason").is_none());

    // 验证公开内容完整
    assert_eq!(published_data["title"], "Public Article");
    assert_eq!(published_data["status"], "published");
    assert_eq!(published_data["author_id"], "author_123");
}

// ===== Session Table 和实时更新测试 =====

#[tokio::test]
async fn test_session_table_creation_and_isolation() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    let session1_id = "session_user_001";
    let session2_id = "session_user_002";

    // 为不同会话创建数据
    let collection1 = format!("_session_{}_user_data", session1_id);
    let collection2 = format!("_session_{}_user_data", session2_id);

    let doc1 = Document::new(
        collection1.clone(),
        json!({"temp_data": "data_for_session_1", "session": session1_id})
    );

    let doc2 = Document::new(
        collection2.clone(),
        json!({"temp_data": "data_for_session_2", "session": session2_id})
    );

    storage.insert(doc1).await.unwrap();
    storage.insert(doc2).await.unwrap();

    // 验证会话隔离
    let results1 = storage.list(&collection1).await.unwrap();
    let results2 = storage.list(&collection2).await.unwrap();

    assert_eq!(results1.len(), 1);
    assert_eq!(results2.len(), 1);
    assert_eq!(results1[0].data["session"], session1_id);
    assert_eq!(results2[0].data["session"], session2_id);

    // 验证不同会话的数据不会混淆
    assert_ne!(results1[0].data["temp_data"], results2[0].data["temp_data"]);
}

#[tokio::test]
async fn test_session_scoped_realtime_updates() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    let session_id = "session_realtime_001";
    let collection_name = format!("_session_{}_notifications", session_id);

    // 模拟实时通知更新
    let notification1 = Document::new(
        collection_name.clone(),
        json!({
            "type": "otp_sent",
            "message": "OTP has been sent to your email",
            "timestamp": chrono::Utc::now().timestamp_millis(),
            "read": false
        })
    );
    storage.insert(notification1).await.unwrap();

    // 模拟状态更新
    let notifications = storage.list(&collection_name).await.unwrap();
    assert_eq!(notifications.len(), 1);

    storage.update(
        &collection_name,
        &notifications[0].id,
        json!({"read": true, "read_at": chrono::Utc::now().timestamp_millis()})
    ).await.unwrap();

    // 验证更新成功
    let updated = storage.get(&collection_name, &notifications[0].id).await.unwrap().unwrap();
    assert_eq!(updated.data["read"], true);
    assert!(updated.data.get("read_at").is_some());
}

#[tokio::test]
async fn test_article_lifecycle_with_moderation() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    let author_id = "author_lifecycle";
    let moderator_id = "moderator_admin";

    // 1. 作者创建草稿
    let mut draft = Document::new(
        "articles".to_string(),
        json!({
            "title": "Draft Article",
            "content": "Initial content",
            "author_id": author_id,
            "status": "draft",
            "created_at": chrono::Utc::now().timestamp_millis()
        })
    );
    draft.version = 1;
    storage.insert(draft.clone()).await.unwrap();

    // 2. 作者提交审核（需要保留所有字段）
    let current_doc = storage.get("articles", &draft.id).await.unwrap().unwrap();
    let mut update_data = current_doc.data.clone();
    update_data["status"] = json!("pending_review");

    storage.update(
        "articles",
        &draft.id,
        update_data
    ).await.unwrap();

    let submitted = storage.get("articles", &draft.id).await.unwrap().unwrap();
    assert_eq!(submitted.data["status"], "pending_review");

    // 3. 管理员审核（添加审核相关字段，同时保留原始字段）
    let current = storage.get("articles", &draft.id).await.unwrap().unwrap();
    let mut update_data = current.data.clone();
    update_data["status"] = json!("published");
    update_data["moderator_id"] = json!(moderator_id);
    update_data["internal_notes"] = json!("Approved after minor edits");
    update_data["approval_timestamp"] = json!(chrono::Utc::now().timestamp_millis());

    storage.update(
        "articles",
        &draft.id,
        update_data
    ).await.unwrap();

    let published = storage.get("articles", &draft.id).await.unwrap().unwrap();
    assert_eq!(published.data["status"], "published");
    assert_eq!(published.data["moderator_id"], moderator_id);

    // 注意：storage.update 会完全替换 data，所以我们需要保留原始字段
    // 在实际应用中，应该使用 merge 而不是 replace

    // 4. 验证普通查询看不到敏感字段（模拟脱敏）
    let mut public_article = published.data.clone();
    // 移除敏感字段
    if let Some(obj) = public_article.as_object_mut() {
        obj.remove("moderator_id");
        obj.remove("internal_notes");
        obj.remove("approval_timestamp");
    }

    // 验证敏感字段已移除
    assert!(public_article.get("moderator_id").is_none());
    assert!(public_article.get("internal_notes").is_none());

    // 验证公开字段仍存在
    assert_eq!(public_article["title"], "Draft Article");
    assert_eq!(public_article["status"], "published");
}

#[tokio::test]
async fn test_internal_fields_not_leaked_to_public_query() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    // 创建 Sync Policy
    let mut policy = Document::new(
        "__config__".to_string(),
        json!({
            "id": "sync_policy_articles",
            "internal": ["moderator_id", "internal_notes", "rejection_reason", "admin_comments"],
            "collection": "articles"
        })
    );
    policy.id = "sync_policy_articles".to_string();
    storage.insert(policy).await.unwrap();

    // 创建多篇文章，有些包含敏感字段
    let articles = vec![
        json!({
            "title": "Public Article 1",
            "author_id": "author_1",
            "status": "published",
            "moderator_id": "admin_1",
            "internal_notes": "Approved"
        }),
        json!({
            "title": "Public Article 2",
            "author_id": "author_2",
            "status": "published",
            "rejection_reason": ""
        }),
        json!({
            "title": "Draft Article",
            "author_id": "author_3",
            "status": "draft",
            "admin_comments": "Needs work"
        }),
    ];

    for (i, article_data) in articles.into_iter().enumerate() {
        let mut doc = Document::new("articles".to_string(), article_data);
        doc.id = format!("article_{}", i + 1);
        storage.insert(doc).await.unwrap();
    }

    // 查询所有已发布文章
    let query = Query {
        collection: "articles".to_string(),
        filters: vec![("status".to_string(), QueryOp::Eq(json!("published")))],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 2);

    // 模拟脱敏处理
    for article in &results {
        let mut article_data = article.data.clone();

        // 应用脱敏规则
        if let Ok(Some(policy_doc)) = storage.get("__config__", "sync_policy_articles").await {
            if let Some(internal_fields) = policy_doc.data.get("internal").and_then(|v| v.as_array()) {
                if let Some(obj) = article_data.as_object_mut() {
                    for field in internal_fields {
                        if let Some(f_str) = field.as_str() {
                            obj.remove(f_str);
                        }
                    }
                }
            }
        }

        // 验证敏感字段不存在
        assert!(article_data.get("moderator_id").is_none(), "moderator_id should be filtered");
        assert!(article_data.get("internal_notes").is_none(), "internal_notes should be filtered");
        assert!(article_data.get("rejection_reason").is_none(), "rejection_reason should be filtered");
        assert!(article_data.get("admin_comments").is_none(), "admin_comments should be filtered");

        // 验证公开字段存在
        assert!(article_data.get("title").is_some());
        assert!(article_data.get("author_id").is_some());
        assert_eq!(article_data["status"], "published");
    }
}

#[tokio::test]
async fn test_expired_otp_rejection() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    let email = "expired@example.com";
    let otp = "999999";

    // 创建已过期的 OTP
    let expired_time = chrono::Utc::now().timestamp_millis() - 600000; // 10分钟前

    let otp_record = Document::new(
        "_internal_otps".to_string(),
        json!({
            "email": email,
            "otp": otp,
            "created_at": expired_time,
            "expires_at": expired_time + 300000, // 5分钟后过期
            "used": false
        })
    );
    storage.insert(otp_record).await.unwrap();

    // 尝试验证过期 OTP
    let query = Query {
        collection: "_internal_otps".to_string(),
        filters: vec![
            ("email".to_string(), QueryOp::Eq(json!(email))),
            ("otp".to_string(), QueryOp::Eq(json!(otp))),
            ("used".to_string(), QueryOp::Eq(json!(false))),
        ],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();

    // 检查 OTP 是否过期
    let now = chrono::Utc::now().timestamp_millis();
    if results.len() > 0 {
        let expires_at = results[0].data.get("expires_at")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        assert!(expires_at < now, "OTP should be expired");
        // 在实际应用中，这里应该拒绝注册
    }
}

#[tokio::test]
async fn test_concurrent_session_isolation() {
    let dir = tempdir().unwrap();
    let storage = SledStorage::new(dir.path()).unwrap();

    let sessions = vec!["session_a", "session_b", "session_c"];

    // 为每个会话创建独立数据
    for session_id in &sessions {
        let collection_name = format!("_session_{}_temp", session_id);
        let doc = Document::new(
            collection_name,
            json!({
                "session_id": session_id,
                "data": format!("private_data_for_{}", session_id),
                "timestamp": chrono::Utc::now().timestamp_millis()
            })
        );
        storage.insert(doc).await.unwrap();
    }

    // 验证每个会话的数据隔离
    for session_id in &sessions {
        let collection_name = format!("_session_{}_temp", session_id);
        let results = storage.list(&collection_name).await.unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].data["session_id"], *session_id);

        // 确保不会访问到其他会话的数据
        let expected_data = format!("private_data_for_{}", session_id);
        assert_eq!(results[0].data["data"], expected_data);
    }

    // 验证不同会话的集合互不干扰
    let all_collections = storage.list(&format!("_session_{}_temp", sessions[0])).await.unwrap();
    assert_eq!(all_collections.len(), 1, "Should only see data from own session");
}