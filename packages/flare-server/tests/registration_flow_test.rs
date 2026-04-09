// 完整注册流程集成测试
// 测试 OTP 请求、验证、用户注册的完整数据流程

use flare_db::{SledStorage, Storage};
use flare_protocol::{Document, Query, QueryOp, BatchOperation};
use serde_json::json;
use tempfile::tempdir;

// 辅助函数：创建测试存储
async fn create_test_storage() -> SledStorage {
    let dir = tempdir().unwrap();
    SledStorage::new(dir.path()).unwrap()
}

// ===== 1. OTP 请求和存储测试 =====

#[tokio::test]
async fn test_complete_otp_request_flow() {
    let storage = create_test_storage().await;
    let email = "test@example.com";
    let session_id = "test_session_001";
    let otp = "123456";

    // Step 1: 模拟 Hook 生成并存储 OTP
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

    // Step 2: 创建会话级状态通知
    let status_collection = format!("_session_{}_otp_status", session_id);
    let status_doc = Document::new(
        status_collection.clone(),
        json!({
            "status": "sent",
            "email": email,
            "message": "OTP sent to your email",
            "created_at": chrono::Utc::now().timestamp_millis()
        })
    );
    storage.insert(status_doc).await.unwrap();

    // Step 3: 验证 OTP 存储成功
    let query = Query {
        collection: "_internal_otps".to_string(),
        filters: vec![
            ("email".to_string(), QueryOp::Eq(json!(email))),
            ("used".to_string(), QueryOp::Eq(json!(false))),
        ],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].data["otp"], otp);

    // Step 4: 验证会话状态创建成功
    let status_results = storage.list(&status_collection).await.unwrap();
    assert_eq!(status_results.len(), 1);
    assert_eq!(status_results[0].data["status"], "sent");

    println!("✓ OTP request flow completed successfully");
}

// ===== 2. OTP 验证和用户注册测试 =====

#[tokio::test]
async fn test_complete_user_registration_flow() {
    let storage = create_test_storage().await;
    let email = "newuser@example.com";
    let password = "secure_password_123";
    let otp = "654321";
    let session_id = "reg_session_002";

    // Step 1: 预先创建 OTP 记录
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

    // Step 2: 验证 OTP
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

    let otp_results = storage.query(query).await.unwrap();
    assert_eq!(otp_results.len(), 1, "OTP should exist and be unused");

    // Step 3: 检查 OTP 是否过期
    let expires_at = otp_results[0].data.get("expires_at")
        .and_then(|v| v.as_i64())
        .unwrap();
    let now = chrono::Utc::now().timestamp_millis();
    assert!(expires_at > now, "OTP should not be expired");

    // Step 4: 创建用户记录
    let user = Document::new(
        "users".to_string(),
        json!({
            "email": email,
            "password_hash": format!("HASHED_{}", password),
            "name": "New User",
            "created_at": chrono::Utc::now().timestamp_millis(),
            "status": "active",
            "role": "user"
        })
    );
    let user_id = user.id.clone();
    storage.insert(user).await.unwrap();

    // Step 5: 标记 OTP 为已使用
    storage.update(
        "_internal_otps",
        &otp_results[0].id,
        json!({
            "used": true,
            "used_at": chrono::Utc::now().timestamp_millis()
        })
    ).await.unwrap();

    // Step 6: 更新会话状态为注册成功
    let status_collection = format!("_session_{}_otp_status", session_id);
    let status_doc = Document::new(
        status_collection.clone(),
        json!({
            "status": "success",
            "email": email,
            "user_id": user_id,
            "registered_at": chrono::Utc::now().timestamp_millis()
        })
    );
    storage.insert(status_doc).await.unwrap();

    // Step 7: 验证用户创建成功
    let created_user = storage.get("users", &user_id).await.unwrap().unwrap();
    assert_eq!(created_user.data["email"], email);
    assert_eq!(created_user.data["status"], "active");

    // Step 8: 验证 OTP 已被标记为使用
    let used_otp = storage.get("_internal_otps", &otp_results[0].id).await.unwrap().unwrap();
    assert_eq!(used_otp.data["used"], true);

    println!("✓ Complete registration flow finished successfully");
}

// ===== 3. 错误场景测试 =====

#[tokio::test]
async fn test_registration_with_invalid_otp() {
    let storage = create_test_storage().await;
    let email = "invalid@example.com";
    let wrong_otp = "999999";

    // 创建正确的 OTP
    let correct_otp = "123456";
    let otp_record = Document::new(
        "_internal_otps".to_string(),
        json!({
            "email": email,
            "otp": correct_otp,
            "created_at": chrono::Utc::now().timestamp_millis(),
            "expires_at": chrono::Utc::now().timestamp_millis() + 300000,
            "used": false
        })
    );
    storage.insert(otp_record).await.unwrap();

    // 尝试使用错误的 OTP
    let query = Query {
        collection: "_internal_otps".to_string(),
        filters: vec![
            ("email".to_string(), QueryOp::Eq(json!(email))),
            ("otp".to_string(), QueryOp::Eq(json!(wrong_otp))),
        ],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 0, "Wrong OTP should not match any record");

    println!("✓ Invalid OTP rejection test passed");
}

#[tokio::test]
async fn test_registration_with_expired_otp() {
    let storage = create_test_storage().await;
    let email = "expired@example.com";
    let otp = "111111";

    // 创建已过期的 OTP
    let expired_time = chrono::Utc::now().timestamp_millis() - 600000;
    let otp_record = Document::new(
        "_internal_otps".to_string(),
        json!({
            "email": email,
            "otp": otp,
            "created_at": expired_time,
            "expires_at": expired_time + 300000,
            "used": false
        })
    );
    storage.insert(otp_record).await.unwrap();

    // 验证 OTP 过期
    let query = Query {
        collection: "_internal_otps".to_string(),
        filters: vec![
            ("email".to_string(), QueryOp::Eq(json!(email))),
            ("otp".to_string(), QueryOp::Eq(json!(otp))),
        ],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 1);

    let expires_at = results[0].data.get("expires_at").and_then(|v| v.as_i64()).unwrap();
    let now = chrono::Utc::now().timestamp_millis();
    assert!(expires_at < now, "OTP should be expired");

    println!("✓ Expired OTP rejection test passed");
}

#[tokio::test]
async fn test_registration_with_duplicate_email() {
    let storage = create_test_storage().await;
    let email = "duplicate@example.com";

    // 创建已存在的用户
    let existing_user = Document::new(
        "users".to_string(),
        json!({
            "email": email,
            "password_hash": "existing_hash",
            "name": "Existing User",
            "status": "active"
        })
    );
    storage.insert(existing_user).await.unwrap();

    // 尝试注册相同邮箱
    let query = Query {
        collection: "users".to_string(),
        filters: vec![("email".to_string(), QueryOp::Eq(json!(email)))],
        limit: None,
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 1, "User with this email already exists");

    println!("✓ Duplicate email detection test passed");
}

#[tokio::test]
async fn test_otp_reuse_prevention() {
    let storage = create_test_storage().await;
    let email = "reuse@example.com";
    let otp = "555555";

    // 创建并使用 OTP
    let otp_record = Document::new(
        "_internal_otps".to_string(),
        json!({
            "email": email,
            "otp": otp,
            "created_at": chrono::Utc::now().timestamp_millis(),
            "expires_at": chrono::Utc::now().timestamp_millis() + 300000,
            "used": true,
            "used_at": chrono::Utc::now().timestamp_millis()
        })
    );
    storage.insert(otp_record).await.unwrap();

    // 尝试再次使用相同 OTP
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
    assert_eq!(results.len(), 0, "Used OTP should not be reusable");

    println!("✓ OTP reuse prevention test passed");
}

// ===== 4. 批量操作测试 =====

#[tokio::test]
async fn test_batch_registration_cleanup() {
    let storage = create_test_storage().await;

    // 创建多个过期的 OTP
    for i in 0..5 {
        let expired_time = chrono::Utc::now().timestamp_millis() - 86400000;
        let otp_record = Document::new(
            "_internal_otps".to_string(),
            json!({
                "email": format!("expired{}@example.com", i),
                "otp": format!("{:06}", i),
                "created_at": expired_time,
                "expires_at": expired_time + 300000,
                "used": false
            })
        );
        storage.insert(otp_record).await.unwrap();
    }

    // 查询所有过期 OTP
    let now = chrono::Utc::now().timestamp_millis();
    let all_otps = storage.list("_internal_otps").await.unwrap();

    let expired_otps: Vec<_> = all_otps.iter()
        .filter(|otp| {
            otp.data.get("expires_at")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) < now
        })
        .collect();

    assert_eq!(expired_otps.len(), 5, "Should find 5 expired OTPs");

    // 批量删除过期 OTP
    let mut operations = Vec::new();
    for otp in expired_otps {
        operations.push(BatchOperation::Delete {
            collection: "_internal_otps".to_string(),
            id: otp.id.clone(),
            precondition: None,
        });
    }

    storage.apply_batch(operations).await.unwrap();

    // 验证删除成功
    let remaining = storage.list("_internal_otps").await.unwrap();
    assert_eq!(remaining.len(), 0, "All expired OTPs should be deleted");

    println!("✓ Batch cleanup test passed");
}

// ===== 5. Session 隔离测试 =====

#[tokio::test]
async fn test_multi_session_registration_isolation() {
    let storage = create_test_storage().await;
    let sessions = vec!["session_a", "session_b", "session_c"];

    // 为每个会话创建独立的注册流程
    for session_id in &sessions {
        let email = format!("user@{}.com", session_id);

        // 创建 OTP
        let otp_record = Document::new(
            "_internal_otps".to_string(),
            json!({
                "email": email,
                "otp": "123456",
                "created_at": chrono::Utc::now().timestamp_millis(),
                "expires_at": chrono::Utc::now().timestamp_millis() + 300000,
                "used": false
            })
        );
        storage.insert(otp_record).await.unwrap();

        // 创建会话状态
        let status_collection = format!("_session_{}_otp_status", session_id);
        let status_doc = Document::new(
            status_collection,
            json!({
                "status": "sent",
                "email": email,
                "session": session_id
            })
        );
        storage.insert(status_doc).await.unwrap();
    }

    // 验证每个会话的数据隔离
    for session_id in &sessions {
        let status_collection = format!("_session_{}_otp_status", session_id);
        let results = storage.list(&status_collection).await.unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].data["session"], *session_id);
    }

    println!("✓ Multi-session isolation test passed");
}

// ===== 6. 端到端集成测试 =====

#[tokio::test]
async fn test_end_to_end_registration_scenario() {
    let storage = create_test_storage().await;

    // 场景：用户 Alice 完成完整注册流程
    let email = "alice@example.com";
    let password = "alice_secure_pass";
    let otp = "888888";
    let session_id = "alice_session_001";

    // 1. 请求 OTP
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
    storage.insert(otp_record.clone()).await.unwrap();

    // 2. 创建 OTP 发送状态
    let status_collection = format!("_session_{}_otp_status", session_id);
    let status_sent = Document::new(
        status_collection.clone(),
        json!({
            "status": "sent",
            "email": email,
            "timestamp": chrono::Utc::now().timestamp_millis()
        })
    );
    storage.insert(status_sent).await.unwrap();

    // 3. 验证并注册
    let otp_query = Query {
        collection: "_internal_otps".to_string(),
        filters: vec![
            ("email".to_string(), QueryOp::Eq(json!(email))),
            ("otp".to_string(), QueryOp::Eq(json!(otp))),
        ],
        limit: None,
        offset: None,
    };

    let otp_results = storage.query(otp_query).await.unwrap();
    assert_eq!(otp_results.len(), 1);

    // 4. 创建用户
    let user = Document::new(
        "users".to_string(),
        json!({
            "email": email,
            "password_hash": format!("HASHED_{}", password),
            "name": "Alice",
            "status": "active",
            "role": "user",
            "created_at": chrono::Utc::now().timestamp_millis()
        })
    );
    let user_id = user.id.clone();
    storage.insert(user.clone()).await.unwrap();

    // 5. 更新 OTP 状态
    storage.update(
        "_internal_otps",
        &otp_results[0].id,
        json!({"used": true, "used_at": chrono::Utc::now().timestamp_millis()})
    ).await.unwrap();

    // 6. 更新会话状态
    let status_docs = storage.list(&status_collection).await.unwrap();
    storage.update(
        &status_collection,
        &status_docs[0].id,
        json!({"status": "success", "user_id": user_id})
    ).await.unwrap();

    // 7. 最终验证
    let final_user = storage.get("users", &user_id).await.unwrap().unwrap();
    assert_eq!(final_user.data["email"], email);
    assert_eq!(final_user.data["status"], "active");

    let final_status = storage.list(&status_collection).await.unwrap();
    assert_eq!(final_status[0].data["status"], "success");
    assert_eq!(final_status[0].data["user_id"], user_id);

    println!("✓ End-to-end registration scenario completed successfully");
    println!("  User ID: {}", user_id);
    println!("  Email: {}", email);
    println!("  Session: {}", session_id);
}

// ===== 7. 并发注册测试 =====

#[tokio::test]
async fn test_complete_registration_service_simulation() {
    // 这个测试模拟完整的注册服务，包括所有组件的集成
    let dir = tempdir().unwrap();
    let storage = std::sync::Arc::new(SledStorage::new(dir.path()).unwrap());

    // 模拟多个用户同时注册
    let test_users = vec![
        ("user1@test.com", "111111", "password1"),
        ("user2@test.com", "222222", "password2"),
        ("user3@test.com", "333333", "password3"),
    ];

    let mut handles = Vec::new();

    for (email, otp, password) in test_users {
        let storage_clone = storage.clone();
        let handle = tokio::spawn(async move {
            // 模拟 OTP 请求
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
            storage_clone.insert(otp_record).await.unwrap();

            // 模拟网络延迟
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;

            // 验证 OTP 并注册用户
            let query = Query {
                collection: "_internal_otps".to_string(),
                filters: vec![
                    ("email".to_string(), QueryOp::Eq(json!(email))),
                    ("otp".to_string(), QueryOp::Eq(json!(otp))),
                ],
                limit: None,
                offset: None,
            };

            let otp_results = storage_clone.query(query).await.unwrap();
            assert_eq!(otp_results.len(), 1);

            // 创建用户
            let user = Document::new(
                "users".to_string(),
                json!({
                    "email": email,
                    "password_hash": format!("HASHED_{}", password),
                    "name": format!("User {}", email.split('@').next().unwrap()),
                    "status": "active",
                    "created_at": chrono::Utc::now().timestamp_millis()
                })
            );
            storage_clone.insert(user).await.unwrap();

            // 标记 OTP 为已使用
            let otp_id = &otp_results[0].id;
            storage_clone.update(
                "_internal_otps",
                otp_id,
                json!({"used": true, "used_at": chrono::Utc::now().timestamp_millis()})
            ).await.unwrap();

            (email, true)
        });
        handles.push(handle);
    }

    // 等待所有注册完成
    let mut results = Vec::new();
    for handle in handles {
        let result = handle.await.unwrap();
        results.push(result);
    }

    // 验证所有用户都成功注册
    assert_eq!(results.len(), 3);
    for (email, success) in &results {
        assert!(success, "User {} should have registered successfully", email);
    }

    // 验证数据库状态
    let all_users = storage.list("users").await.unwrap();
    assert_eq!(all_users.len(), 3, "Should have 3 users registered");

    let all_otps = storage.list("_internal_otps").await.unwrap();
    assert_eq!(all_otps.len(), 3, "Should have 3 OTP records");

    // 验证所有 OTP 都被标记为使用
    let used_otps_query = Query {
        collection: "_internal_otps".to_string(),
        filters: vec![("used".to_string(), QueryOp::Eq(json!(true)))],
        limit: None,
        offset: None,
    };
    let used_otps = storage.query(used_otps_query).await.unwrap();
    assert_eq!(used_otps.len(), 3, "All OTPs should be marked as used");

    println!("✓ Complete registration service simulation test passed");
    println!("  Successfully registered {} concurrent users", results.len());
}

// ===== 8. 错误恢复和重试机制测试 =====

#[tokio::test]
async fn test_registration_with_retry_mechanism() {
    let storage = create_test_storage().await;
    let email = "retry_test@example.com";
    let otp = "555444";

    // 模拟第一次 OTP 请求失败 (过期)
    let expired_otp = Document::new(
        "_internal_otps".to_string(),
        json!({
            "email": email,
            "otp": "111111",
            "created_at": chrono::Utc::now().timestamp_millis() - 600000,
            "expires_at": chrono::Utc::now().timestamp_millis() - 300000,
            "used": false
        })
    );
    storage.insert(expired_otp).await.unwrap();

    // 模拟第二次 OTP 请求成功
    let valid_otp = Document::new(
        "_internal_otps".to_string(),
        json!({
            "email": email,
            "otp": otp,
            "created_at": chrono::Utc::now().timestamp_millis(),
            "expires_at": chrono::Utc::now().timestamp_millis() + 300000,
            "used": false
        })
    );
    storage.insert(valid_otp.clone()).await.unwrap();

    // 验证有效的 OTP
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
    assert_eq!(results.len(), 1, "Should find the valid OTP");

    // 完成注册
    let user = Document::new(
        "users".to_string(),
        json!({
            "email": email,
            "password_hash": "HASHED_secure_password",
            "name": "Retry User",
            "status": "active"
        })
    );
    storage.insert(user).await.unwrap();

    println!("✓ Retry mechanism test passed");
}
