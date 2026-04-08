// 权限控制实际使用示例
//
// 这些示例展示了如何在 Flarebase 服务器中使用权限控制系统

use flare_protocol::Document;
use permissions::{Authorizer, PermissionContext, ResourceType};
use serde_json::json;

// ===== 示例 1: 用户注册 =====
async fn example_user_registration() {
    // 注意：这是应用层的业务逻辑，应该在 HTTP 处理器中实现

    // 用户提交注册请求
    let email = "user@example.com";
    let password = "plain_password"; // 在实际应用中需要哈希处理
    let name = "John Doe";

    // 创建用户文档
    let user = Document::new(
        "users".to_string(),
        json!({
            "email": email,
            "password_hash": hash_password(password), // 需要实现密码哈希函数
            "name": name,
            "created_at": chrono::Utc::now().timestamp_millis(),
            "status": "pending_verification"
        })
    );

    // 保存到数据库（通过 Storage trait）
    // storage.insert(user).await?;

    println!("✅ 用户注册成功: {}", email);
}

// ===== 示例 2: 创建文章 =====
async fn example_create_article() {
    let user_id = "user-123";
    let title = "我的第一篇文章";
    let content = "这是文章内容...";

    let article = Document::new(
        "articles".to_string(),
        json!({
            "title": title,
            "content": content,
            "author_id": user_id,
            "status": "draft",
            "created_at": chrono::Utc::now().timestamp_millis()
        })
    );

    // storage.insert(article).await?;
    println!("✅ 文章创建成功: {}", title);
}

// ===== 示例 3: 更新文章（带权限检查）=====
async fn example_update_article_with_permission(
    storage: &dyn flare_db::Storage,
    article_id: &str,
    user_id: &str,
    updates: serde_json::Value
) -> Result<(), anyhow::Error> {
    // 1. 获取文章
    let article = storage.get("articles", article_id).await?
        .ok_or_else(|| anyhow::anyhow!("文章不存在"))?;

    // 2. 创建权限上下文
    let ctx = PermissionContext {
        user_id: user_id.to_string(),
        user_role: "user".to_string(), // 从用户数据获取实际角色
        resource_id: article_id.to_string(),
        resource_type: ResourceType::Article,
    };

    // 3. 检查写入权限
    let has_permission = Authorizer::can_write(&ctx, &article.data)?;

    if !has_permission {
        return Err(anyhow::anyhow!("权限不足：您不能修改此文章"));
    }

    // 4. 验证更新内容
    Authorizer::validate_article_update(&article.data, &updates)?;

    // 5. 执行更新
    storage.update("articles", article_id, updates).await?;

    println!("✅ 文章更新成功");
    Ok(())
}

// ===== 示例 4: 文章审核（管理员权限）=====
async fn example_moderate_article(
    storage: &dyn flare_db::Storage,
    article_id: &str,
    admin_id: &str,
    new_status: &str
) -> Result<(), anyhow::Error> {
    // 1. 获取文章
    let article = storage.get("articles", article_id).await?
        .ok_or_else(|| anyhow::anyhow!("文章不存在"))?;

    // 2. 创建管理员权限上下文
    let ctx = PermissionContext {
        user_id: admin_id.to_string(),
        user_role: "admin".to_string(),
        resource_id: article_id.to_string(),
        resource_type: ResourceType::Article,
    };

    // 3. 检查审核权限
    Authorizer::can_moderate(&ctx)?;

    // 4. 更新文章状态
    let updates = json!({
        "status": new_status,
        "moderated_at": chrono::Utc::now().timestamp_millis(),
        "moderated_by": admin_id
    });

    storage.update("articles", article_id, updates).await?;

    println!("✅ 文章审核完成，状态更新为: {}", new_status);
    Ok(())
}

// ===== 示例 5: 获取用户信息（带数据脱敏）=====
async fn example_get_user_profile(
    storage: &dyn flare_db::Storage,
    user_id: &str,
    requester_id: &str,
    requester_role: &str
) -> Result<serde_json::Value, anyhow::Error> {
    // 1. 获取用户数据
    let user = storage.get("users", user_id).await?
        .ok_or_else(|| anyhow::anyhow!("用户不存在"))?;

    // 2. 检查读取权限
    let ctx = PermissionContext {
        user_id: requester_id.to_string(),
        user_role: requester_role.to_string(),
        resource_id: user_id.to_string(),
        resource_type: ResourceType::User,
    };

    let has_permission = Authorizer::can_read(&ctx, &user.data)?;

    if !has_permission {
        return Err(anyhow::anyhow!("权限不足：无法查看此用户"));
    }

    // 3. 数据脱敏
    let sanitized_data = Authorizer::sanitize_user_data(
        &user.data,
        requester_id,
        requester_role
    );

    println!("✅ 返回用户信息（已脱敏）");
    Ok(sanitized_data)
}

// ===== 示例 6: 删除文章（带权限检查）=====
async fn example_delete_article(
    storage: &dyn flare_db::Storage,
    article_id: &str,
    user_id: &str
) -> Result<(), anyhow::Error> {
    // 1. 获取文章
    let article = storage.get("articles", article_id).await?
        .ok_or_else(|| anyhow::anyhow!("文章不存在"))?;

    // 2. 创建权限上下文
    let ctx = PermissionContext {
        user_id: user_id.to_string(),
        user_role: "user".to_string(), // 从数据库获取实际角色
        resource_id: article_id.to_string(),
        resource_type: ResourceType::Article,
    };

    // 3. 检查删除权限
    let has_permission = Authorizer::can_delete(&ctx, &article.data)?;

    if !has_permission {
        return Err(anyhow::anyhow!("权限不足：您不能删除此文章"));
    }

    // 4. 执行删除
    storage.delete("articles", article_id).await?;

    println!("✅ 文章删除成功");
    Ok(())
}

// ===== 示例 7: 查询已发布文章（公开访问）=====
async fn example_list_published_articles(
    storage: &dyn flare_db::Storage
) -> Result<Vec<Document>, anyhow::Error> {
    use flare_protocol::{Query, QueryOp};

    let query = Query {
        collection: "articles".to_string(),
        filters: vec![
            ("status".to_string(), QueryOp::Eq(json!("published")))
        ],
        limit: Some(20), // 限制返回数量
        offset: None,
    };

    let articles = storage.query(query).await?;
    println!("✅ 查询到 {} 篇已发布文章", articles.len());

    Ok(articles)
}

// ===== 示例 8: 查询用户的文章（需要认证）=====
async fn example_list_user_articles(
    storage: &dyn flare_db::Storage,
    user_id: &str,
    requester_id: &str
) -> Result<Vec<Document>, anyhow::Error> {
    use flare_protocol::{Query, QueryOp};

    // 权限检查：只能查看自己的文章，除非是管理员
    if user_id != requester_id {
        // 在实际应用中，这里应该检查用户角色
        return Err(anyhow::anyhow!("权限不足：只能查看自己的文章"));
    }

    let query = Query {
        collection: "articles".to_string(),
        filters: vec![
            ("author_id".to_string(), QueryOp::Eq(json!(user_id)))
        ],
        limit: None,
        offset: None,
    };

    let articles = storage.query(query).await?;
    println!("✅ 查询到用户 {} 的 {} 篇文章", user_id, articles.len());

    Ok(articles)
}

// ===== 辅助函数 =====
fn hash_password(password: &str) -> String {
    // 在实际应用中，应该使用 bcrypt 或 Argon2
    format!("hashed_{}", password) // 简化示例
}

// ===== HTTP API 使用示例 =====
/*
// 这些示例展示了如何在 HTTP 处理器中使用权限系统

use axum::{
    extract::{Path, State},
    Json,
    routing::{get, post, put, delete},
    Router,
};

// PUT /articles/:id - 更新文章
async fn http_update_article(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(updates): Json<serde_json::Value>,
    // 从请求中获取认证用户信息
    user_id: String,
) -> Result<Json<Document>, anyhow::Error> {
    example_update_article_with_permission(
        &*state.storage,
        &id,
        &user_id,
        updates
    ).await?;

    // 返回更新后的文章
    let updated = state.storage.get("articles", &id).await?.unwrap();
    Ok(Json(updated))
}

// POST /articles/:id/moderate - 审核文章（管理员）
async fn http_moderate_article(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<serde_json::Value>,
    user_id: String,
) -> Result<Json<Document>, anyhow::Error> {
    let new_status = req.get("status")
        .and_then(|s| s.as_str())
        .ok_or_else(|| anyhow::anyhow!("缺少 status 字段"))?;

    example_moderate_article(
        &*state.storage,
        &id,
        &user_id,
        new_status
    ).await?;

    let updated = state.storage.get("articles", &id).await?.unwrap();
    Ok(Json(updated))
}

// GET /users/:id - 获取用户信息
async fn http_get_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
    user_id: String, // 请求者的用户 ID
) -> Result<Json<serde_json::Value>, anyhow::Error> {
    // 从数据库获取请求者的角色
    let requester_role = "user"; // 简化示例

    let user_data = example_get_user_profile(
        &*state.storage,
        &id,
        &user_id,
        requester_role
    ).await?;

    Ok(Json(user_data))
}
*/
