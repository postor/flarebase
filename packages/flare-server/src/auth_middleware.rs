// 🔒 权限和认证中间件
use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};
use std::sync::Arc;
use crate::AppState;

/// 🔒 从Authorization头中提取用户信息
pub fn extract_user_info(headers: &HeaderMap) -> Result<(String, String), StatusCode> {
    let auth_header = headers
        .get("Authorization")
        .ok_or(StatusCode::UNAUTHORIZED)?
        .to_str()
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    if !auth_header.starts_with("Bearer ") {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let token = &auth_header[7..]; // 移除 "Bearer "
    let parts: Vec<&str> = token.split(':').collect();

    if parts.len() < 2 {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let user_id = parts[0].to_string();
    let user_role = parts[1].to_string();

    Ok((user_id, user_role))
}

/// 🔒 认证中间件 - 检查请求是否包含有效的认证信息
pub async fn auth_middleware(
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // 对于GET请求（读操作），我们允许无认证访问
    let method = request.method().to_string();
    let uri = request.uri().to_string();

    // 只对写操作检查认证
    if method == "POST" || method == "PUT" || method == "DELETE" {
        extract_user_info(&headers)?;
    }

    Ok(next.run(request).await)
}

/// 🔒 权限检查上下文
#[derive(Clone)]
pub struct PermissionContext {
    pub user_id: String,
    pub user_role: String,
}

/// 🔒 检查用户是否有权限执行特定操作
pub fn check_ownership(user_id: &str, user_role: &str, resource_author_id: Option<&str>) -> Result<(), StatusCode> {
    if let Some(author_id) = resource_author_id {
        if !author_id.is_empty() && author_id != user_id && user_role != "admin" {
            tracing::warn!("🚨 SECURITY: User {} attempted to access resource owned by {}", user_id, author_id);
            return Err(StatusCode::FORBIDDEN);
        }
    }
    Ok(())
}

/// 🔒 检查是否尝试修改关键字段（如author_id）
pub fn check_field_modification(user_id: &str, user_role: &str, current_data: &serde_json::Value, updates: &serde_json::Value) -> Result<(), StatusCode> {
    // 防止修改author_id字段
    if let Some(new_author) = updates.get("author_id") {
        let current_author = current_data.get("author_id").unwrap_or(&serde_json::Value::Null);
        if new_author != current_author {
            tracing::warn!("🚨 SECURITY: Attempt to change author_id from {} to {:?}", current_author, new_author);
            return Err(StatusCode::FORBIDDEN);
        }
    }

    // 检查所有权
    let author_id = current_data.get("author_id")
        .and_then(|a| a.as_str())
        .or_else(|| current_data.get("owner_id").and_then(|o| o.as_str()));

    check_ownership(user_id, user_role, author_id)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_valid_token() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Bearer user-123:admin:user@test.com".parse().unwrap());

        let result = extract_user_info(&headers);
        assert!(result.is_ok());
        let (user_id, user_role) = result.unwrap();
        assert_eq!(user_id, "user-123");
        assert_eq!(user_role, "admin");
    }

    #[test]
    fn test_extract_missing_header() {
        let headers = HeaderMap::new();
        let result = extract_user_info(&headers);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn test_extract_invalid_format() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Invalid token".parse().unwrap());

        let result = extract_user_info(&headers);
        assert!(result.is_err());
    }

    #[test]
    fn test_check_ownership_admin() {
        let result = check_ownership("admin-123", "admin", Some("user-456"));
        assert!(result.is_ok()); // 管理员可以访问任何资源
    }

    #[test]
    fn test_check_ownership_owner() {
        let result = check_ownership("user-123", "user", Some("user-123"));
        assert!(result.is_ok()); // 用户可以访问自己的资源
    }

    #[test]
    fn test_check_ownership_unauthorized() {
        let result = check_ownership("user-123", "user", Some("user-456"));
        assert!(result.is_err()); // 普通用户不能访问其他用户资源
        assert_eq!(result.unwrap_err(), StatusCode::FORBIDDEN);
    }
}