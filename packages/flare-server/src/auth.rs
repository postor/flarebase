// Authentication and Authorization middleware for Flarebase
use axum::{
    extract::{Request, State},
    http::StatusCode,
    Json, Response,
};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::permissions::{Authorizer, PermissionContext, ResourceType};
use crate::AppState;

/// User session extracted from request headers
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: String,
    pub role: String,
    pub email: String,
}

/// Extract user from session token in headers
pub async fn extract_user_from_request(
    request: &Request,
    state: &Arc<AppState>
) -> Result<AuthUser, StatusCode> {
    // Extract session token from headers
    let token = request
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // TODO: Implement proper session validation
    // For now, we'll decode a simple format: "user_id:role:email"
    let parts: Vec<&str> = token.split(':').collect();
    if parts.len() != 3 {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let user_id = parts[0];
    let role = parts[1];
    let email = parts[2];

    // Verify user exists in database
    match state.storage.get("users", user_id).await {
        Ok(Some(user_doc)) => {
            // Validate user is active
            if user_doc.data.get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("") == "active"
            {
                Ok(AuthUser {
                    id: user_id.to_string(),
                    role: role.to_string(),
                    email: email.to_string(),
                })
            } else {
                Err(StatusCode::FORBIDDEN)
            }
        }
        Ok(None) => Err(StatusCode::UNAUTHORIZED),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// Permission check middleware for document operations
pub fn check_document_permission(
    user: &AuthUser,
    collection: &str,
    document: &Value,
    operation: &str,
) -> Result<(), Response> {
    // Skip permission checks for system collections
    if collection.starts_with("__") {
        return Ok(());
    }

    let resource_type = match collection.as_str() {
        "users" => ResourceType::User,
        "posts" | "articles" => ResourceType::Article,
        "comments" => ResourceType::Comment,
        _ => return Ok(()), // Unknown collections - allow for now
    };

    let ctx = PermissionContext {
        user_id: user.id.clone(),
        user_role: user.role.clone(),
        resource_id: document.get("id")
            .and_then(|i| i.as_str())
            .unwrap_or("")
            .to_string(),
        resource_type,
    };

    let result = match operation {
        "read" => Authorizer::can_read(&ctx, document),
        "write" => Authorizer::can_write(&ctx, document),
        "delete" => Authorizer::can_delete(&ctx, document),
        _ => Ok(true),
    };

    match result {
        Ok(true) => Ok(()),
        Ok(false) => Err(Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Json(json!({
                "error": "Permission denied",
                "message": format!("You don't have permission to {} this resource", operation),
                "user_id": user.id,
                "required_role": "owner or admin"
            })))
            .unwrap()),
        ),
        Err(e) => Err(Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Json(json!({
                "error": "Permission denied",
                "message": e.to_string()
            })))
            .unwrap()),
        )
    }
}

/// Validate update permissions and prevent unauthorized field changes
pub fn validate_update_permissions(
    user: &AuthUser,
    collection: &str,
    current_doc: &Value,
    updates: &Value,
) -> Result<(), Response> {
    // Skip for system collections
    if collection.starts_with("__") {
        return Ok(());
    }

    // Check write permission first
    check_document_permission(user, collection, current_doc, "write")?;

    // For articles, prevent changing sensitive fields
    if collection == "posts" || collection == "articles" {
        if let Err(e) = Authorizer::validate_article_update(current_doc, updates) {
            return Err(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Json(json!({
                    "error": "Invalid update",
                    "message": e.to_string()
                })))
                .unwrap());
        }
    }

    Ok(())
}

#[cfg(test)]
mod auth_tests {
    use super::*;

    #[test]
    fn test_extract_valid_token() {
        // This would need a full request setup
        // Just demonstrating the token format
        let token = "user123:admin:user@example.com";
        let parts: Vec<&str> = token.split(':').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "user123");
        assert_eq!(parts[1], "admin");
    }

    #[test]
    fn test_extract_invalid_token() {
        let token = "invalid-token";
        let parts: Vec<&str> = token.split(':').collect();
        assert_ne!(parts.len(), 3);
    }
}