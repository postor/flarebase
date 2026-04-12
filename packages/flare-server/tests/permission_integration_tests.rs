// Flarebase权限系统集成测试
// 测试HTTP API层面的安全控制

use flare_server::{main, AppState};
use flare_db::Storage;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

#[tokio::test]
async fn test_unauthenticated_delete_blocked() {
    // 测试：无认证的删除请求应该被阻止
    let response = reqwest::Client::new()
        .delete("http://localhost:3000/collections/posts/test-doc-1")
        .send()
        .await;

    assert!(response.is_ok());
    let resp = response.unwrap();
    assert_eq!(resp.status(), 401, "无认证删除应该返回401");
}

#[tokio::test]
async fn test_cross_user_delete_blocked() {
    // 测试：普通用户不能删除管理员的文档
    let admin_token = "admin-001:admin:admin@flarebase.com";
    let user_token = "user-002:user:user@flarebase.com";

    // 1. 管理员创建文档
    let client = reqwest::Client::new();
    let create_response = client
        .post("http://localhost:3000/collections/posts")
        .header("Authorization", format!("Bearer {}", admin_token))
        .json(&serde_json::json!({
            "title": "Admin Post",
            "content": "Admin content",
            "author_id": "admin-001"
        }))
        .send()
        .await;

    assert!(create_response.is_ok());
    let create_resp = create_response.unwrap();
    assert_eq!(create_resp.status(), 200);

    let doc: serde_json::Value = create_resp.json().await.unwrap();
    let doc_id = doc["id"].as_str().unwrap();

    // 2. 普通用户尝试删除管理员文档（应该被阻止）
    let delete_response = client
        .delete(&format!("http://localhost:3000/collections/posts/{}", doc_id))
        .header("Authorization", format!("Bearer {}", user_token))
        .send()
        .await;

    assert!(delete_response.is_ok());
    let delete_resp = delete_response.unwrap();
    assert_eq!(delete_resp.status(), 403, "普通用户删除管理员文档应该返回403");

    // 3. 管理员可以删除自己的文档
    let admin_delete_response = client
        .delete(&format!("http://localhost:3000/collections/posts/{}", doc_id))
        .header("Authorization", format!("Bearer {}", admin_token))
        .send()
        .await;

    assert!(admin_delete_response.is_ok());
    let admin_delete_resp = admin_delete_response.unwrap();
    assert_eq!(admin_delete_resp.status(), 200, "管理员删除自己文档应该返回200");
}

#[tokio::test]
async fn test_author_id_change_blocked() {
    // 测试：不能修改文档的author_id
    let user_token = "user-001:user:user@flarebase.com";

    let client = reqwest::Client::new();

    // 1. 创建文档
    let create_response = client
        .post("http://localhost:3000/collections/posts")
        .header("Authorization", format!("Bearer {}", user_token))
        .json(&serde_json::json!({
            "title": "User Post",
            "content": "User content",
            "author_id": "user-001"
        }))
        .send()
        .await;

    assert!(create_response.is_ok());
    let doc: serde_json::Value = create_response.unwrap().json().await.unwrap();
    let doc_id = doc["id"].as_str().unwrap();

    // 2. 尝试修改author_id（应该被阻止）
    let update_response = client
        .put(&format!("http://localhost:3000/collections/posts/{}", doc_id))
        .header("Authorization", format!("Bearer {}", user_token))
        .json(&serde_json::json!({
            "author_id": "hacker-999"
        }))
        .send()
        .await;

    assert!(update_response.is_ok());
    let update_resp = update_response.unwrap();
    assert_eq!(update_resp.status(), 403, "修改author_id应该返回403");

    // 3. 验证author_id没有被修改
    let get_response = client
        .get(&format!("http://localhost:3000/collections/posts/{}", doc_id))
        .send()
        .await;

    assert!(get_response.is_ok());
    let get_doc: serde_json::Value = get_response.unwrap().json().await.unwrap();
    assert_eq!(get_doc["data"]["author_id"], "user-001", "author_id应该保持不变");
}

#[tokio::test]
async fn test_unauthenticated_create_blocked() {
    // 测试：无认证的创建请求应该被阻止
    let response = reqwest::Client::new()
        .post("http://localhost:3000/collections/posts")
        .json(&serde_json::json!({
            "title": "Test Post",
            "content": "Test content"
        }))
        .send()
        .await;

    assert!(response.is_ok());
    let resp = response.unwrap();
    assert_eq!(resp.status(), 401, "无认证创建应该返回401");
}

#[tokio::test]
async fn test_unauthenticated_update_blocked() {
    // 测试：无认证的更新请求应该被阻止
    let response = reqwest::Client::new()
        .put("http://localhost:3000/collections/posts/test-doc")
        .json(&serde_json::json!({
            "title": "Updated Title"
        }))
        .send()
        .await;

    assert!(response.is_ok());
    let resp = response.unwrap();
    assert_eq!(resp.status(), 401, "无认证更新应该返回401");
}

#[tokio::test]
async fn test_cross_user_update_blocked() {
    // 测试：普通用户不能修改管理员的文档
    let admin_token = "admin-001:admin:admin@flarebase.com";
    let user_token = "user-002:user:user@flarebase.com";

    let client = reqwest::Client::new();

    // 1. 管理员创建文档
    let create_response = client
        .post("http://localhost:3000/collections/posts")
        .header("Authorization", format!("Bearer {}", admin_token))
        .json(&serde_json::json!({
            "title": "Admin Post",
            "content": "Original content",
            "author_id": "admin-001"
        }))
        .send()
        .await;

    let doc: serde_json::Value = create_response.unwrap().json().await.unwrap();
    let doc_id = doc["id"].as_str().unwrap();

    // 2. 普通用户尝试修改管理员文档（应该被阻止）
    let update_response = client
        .put(&format!("http://localhost:3000/collections/posts/{}", doc_id))
        .header("Authorization", format!("Bearer {}", user_token))
        .json(&serde_json::json!({
            "content": "Modified by user"
        }))
        .send()
        .await;

    assert!(update_response.is_ok());
    let update_resp = update_response.unwrap();
    assert_eq!(update_resp.status(), 403, "普通用户修改管理员文档应该返回403");

    // 3. 验证内容没有被修改
    let get_response = client
        .get(&format!("http://localhost:3000/collections/posts/{}", doc_id))
        .send()
        .await;

    let get_doc: serde_json::Value = get_response.unwrap().json().await.unwrap();
    assert_eq!(get_doc["data"]["content"], "Original content", "内容应该保持不变");
}

#[tokio::test]
async fn test_admin_can_access_all_resources() {
    // 测试：管理员可以访问任何资源
    let user_token = "user-001:user:user@flarebase.com";
    let admin_token = "admin-001:admin:admin@flarebase.com";

    let client = reqwest::Client::new();

    // 1. 普通用户创建文档
    let create_response = client
        .post("http://localhost:3000/collections/posts")
        .header("Authorization", format!("Bearer {}", user_token))
        .json(&serde_json::json!({
            "title": "User Post",
            "content": "User content",
            "author_id": "user-001"
        }))
        .send()
        .await;

    let doc: serde_json::Value = create_response.unwrap().json().await.unwrap();
    let doc_id = doc["id"].as_str().unwrap();

    // 2. 管理员可以删除普通用户的文档
    let delete_response = client
        .delete(&format!("http://localhost:3000/collections/posts/{}", doc_id))
        .header("Authorization", format!("Bearer {}", admin_token))
        .send()
        .await;

    assert!(delete_response.is_ok());
    let delete_resp = delete_response.unwrap();
    assert_eq!(delete_resp.status(), 200, "管理员可以删除普通用户文档");
}
