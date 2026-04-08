// Permission control module for Flarebase
use serde_json::Value;
use serde_json::json;
use anyhow::Result;

/// Permission levels for different resources
#[derive(Debug, Clone, PartialEq)]
pub enum Permission {
    Read,
    Write,
    Delete,
    Admin,
}

/// Resource types in the system
#[derive(Debug, Clone, PartialEq)]
pub enum ResourceType {
    User,
    Article,
    Comment,
    SystemConfig,
}

/// Context for permission checking
pub struct PermissionContext {
    pub user_id: String,
    pub user_role: String,
    pub resource_id: String,
    pub resource_type: ResourceType,
}

/// Authorization service
pub struct Authorizer;

impl Authorizer {
    /// Check if a user can read a resource
    pub fn can_read(ctx: &PermissionContext, resource: &Value) -> Result<bool> {
        match ctx.resource_type {
            ResourceType::Article => {
                // Published articles are public
                if resource.get("status").and_then(|s| s.as_str()) == Some("published") {
                    return Ok(true);
                }

                // Draft and pending review articles can only be read by author or admin
                let author_id = resource.get("author_id")
                    .and_then(|a| a.as_str())
                    .unwrap_or("");

                if author_id == ctx.user_id || ctx.user_role == "admin" {
                    return Ok(true);
                }

                Ok(false)
            }
            ResourceType::User => {
                // Users can read their own profile, admins can read any
                if ctx.user_id == ctx.resource_id || ctx.user_role == "admin" {
                    return Ok(true);
                }
                Ok(false)
            }
            _ => Ok(false)
        }
    }

    /// Check if a user can write (update) a resource
    pub fn can_write(ctx: &PermissionContext, resource: &Value) -> Result<bool> {
        match ctx.resource_type {
            ResourceType::Article => {
                let author_id = resource.get("author_id")
                    .and_then(|a| a.as_str())
                    .unwrap_or("");

                // Only author can update their own articles
                if author_id == ctx.user_id {
                    return Ok(true);
                }

                // Admins have special write access
                if ctx.user_role == "admin" {
                    return Ok(true);
                }

                Err(anyhow::anyhow!("Permission denied: You don't own this article"))
            }
            ResourceType::User => {
                // Users can only update their own profile
                if ctx.user_id == ctx.resource_id {
                    return Ok(true);
                }

                Err(anyhow::anyhow!("Permission denied: You can only update your own profile"))
            }
            _ => Ok(false)
        }
    }

    /// Check if a user can delete a resource
    pub fn can_delete(ctx: &PermissionContext, resource: &Value) -> Result<bool> {
        match ctx.resource_type {
            ResourceType::Article => {
                let author_id = resource.get("author_id")
                    .and_then(|a| a.as_str())
                    .unwrap_or("");

                // Only author can delete their own articles
                if author_id == ctx.user_id {
                    return Ok(true);
                }

                // Admins can delete any article
                if ctx.user_role == "admin" {
                    return Ok(true);
                }

                Err(anyhow::anyhow!("Permission denied: You don't own this article"))
            }
            _ => Ok(false)
        }
    }

    /// Check if a user can moderate (change status of) articles
    pub fn can_moderate(ctx: &PermissionContext) -> Result<bool> {
        if ctx.user_role == "admin" || ctx.user_role == "moderator" {
            return Ok(true);
        }
        Err(anyhow::anyhow!("Permission denied: Moderator access required"))
    }

    /// Sanitize user data for public view (remove sensitive fields)
    pub fn sanitize_user_data(user_data: &Value, requester_id: &str, requester_role: &str) -> Value {
        let is_own_profile = user_data.get("id")
            .and_then(|id| id.as_str())
            .map(|id| id == requester_id)
            .unwrap_or(false);

        let is_admin = requester_role == "admin";

        if is_own_profile || is_admin {
            user_data.clone()
        } else {
            // Remove sensitive fields
            let mut sanitized = user_data.clone();
            if let Some(obj) = sanitized.as_object_mut() {
                obj.remove("password_hash");
                obj.remove("email");
                obj.remove("created_at");
                obj.remove("status");
            }
            sanitized
        }
    }

    /// Validate article update - prevent changing author_id
    pub fn validate_article_update(current: &Value, updates: &Value) -> Result<()> {
        // Prevent changing author_id
        if let Some(new_author) = updates.get("author_id") {
            let current_author = current.get("author_id").unwrap_or(&json!(null));
            if new_author != current_author {
                return Err(anyhow::anyhow!("Cannot change article author"));
            }
        }

        // Prevent direct status changes (should go through moderation)
        if let Some(new_status) = updates.get("status") {
            let current_status = current.get("status").and_then(|s| s.as_str()).unwrap_or("");
            let allowed_statuses = ["draft", "pending_review"];

            if current_status == "published" && new_status.as_str() != Some("published") {
                return Err(anyhow::anyhow!("Cannot change status of published article"));
            }

            // Only allow certain status transitions
            if let Some(status_str) = new_status.as_str() {
                if !allowed_statuses.contains(&status_str) && status_str != "published" {
                    return Err(anyhow::anyhow!("Invalid status transition"));
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod permission_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_can_read_published_article() {
        let article = json!({
            "id": "article-1",
            "title": "Public Article",
            "status": "published",
            "author_id": "user-1"
        });

        let ctx = PermissionContext {
            user_id: "user-2".to_string(),
            user_role: "user".to_string(),
            resource_id: "article-1".to_string(),
            resource_type: ResourceType::Article,
        };

        assert!(Authorizer::can_read(&ctx, &article).unwrap());
    }

    #[test]
    fn test_can_read_own_draft_article() {
        let article = json!({
            "id": "article-1",
            "title": "Draft Article",
            "status": "draft",
            "author_id": "user-1"
        });

        let ctx = PermissionContext {
            user_id: "user-1".to_string(),
            user_role: "user".to_string(),
            resource_id: "article-1".to_string(),
            resource_type: ResourceType::Article,
        };

        assert!(Authorizer::can_read(&ctx, &article).unwrap());
    }

    #[test]
    fn test_cannot_read_others_draft_article() {
        let article = json!({
            "id": "article-1",
            "title": "Draft Article",
            "status": "draft",
            "author_id": "user-1"
        });

        let ctx = PermissionContext {
            user_id: "user-2".to_string(),
            user_role: "user".to_string(),
            resource_id: "article-1".to_string(),
            resource_type: ResourceType::Article,
        };

        assert!(!Authorizer::can_read(&ctx, &article).unwrap());
    }

    #[test]
    fn test_can_update_own_article() {
        let article = json!({
            "id": "article-1",
            "title": "My Article",
            "author_id": "user-1"
        });

        let ctx = PermissionContext {
            user_id: "user-1".to_string(),
            user_role: "user".to_string(),
            resource_id: "article-1".to_string(),
            resource_type: ResourceType::Article,
        };

        assert!(Authorizer::can_write(&ctx, &article).unwrap());
    }

    #[test]
    fn test_cannot_update_others_article() {
        let article = json!({
            "id": "article-1",
            "title": "Someone's Article",
            "author_id": "user-1"
        });

        let ctx = PermissionContext {
            user_id: "user-2".to_string(),
            user_role: "user".to_string(),
            resource_id: "article-1".to_string(),
            resource_type: ResourceType::Article,
        };

        assert!(Authorizer::can_write(&ctx, &article).is_err());
    }

    #[test]
    fn test_admin_can_update_any_article() {
        let article = json!({
            "id": "article-1",
            "title": "Any Article",
            "author_id": "user-1"
        });

        let ctx = PermissionContext {
            user_id: "admin-1".to_string(),
            user_role: "admin".to_string(),
            resource_id: "article-1".to_string(),
            resource_type: ResourceType::Article,
        };

        assert!(Authorizer::can_write(&ctx, &article).unwrap());
    }

    #[test]
    fn test_sanitize_user_data() {
        let user_data = json!({
            "id": "user-1",
            "name": "Alice",
            "email": "alice@example.com",
            "password_hash": "hashed_secret",
            "status": "active"
        });

        // Same user - should see all data
        let full_data = Authorizer::sanitize_user_data(&user_data, "user-1", "user");
        assert_eq!(full_data["email"], "alice@example.com");
        assert_eq!(full_data["password_hash"], "hashed_secret");

        // Different user - should not see sensitive data
        let sanitized_data = Authorizer::sanitize_user_data(&user_data, "user-2", "user");
        assert!(sanitized_data.get("email").is_none());
        assert!(sanitized_data.get("password_hash").is_none());
        assert_eq!(sanitized_data["name"], "Alice");
    }

    #[test]
    fn test_validate_article_update_prevent_author_change() {
        let current = json!({
            "id": "article-1",
            "author_id": "user-1"
        });

        let updates = json!({
            "author_id": "user-2"
        });

        assert!(Authorizer::validate_article_update(&current, &updates).is_err());
    }

    #[test]
    fn test_validate_article_update_allow_valid_changes() {
        let current = json!({
            "id": "article-1",
            "author_id": "user-1",
            "status": "draft"
        });

        let updates = json!({
            "title": "New Title",
            "content": "New Content"
        });

        assert!(Authorizer::validate_article_update(&current, &updates).is_ok());
    }

    #[test]
    fn test_can_moderate_admin() {
        let ctx = PermissionContext {
            user_id: "admin-1".to_string(),
            user_role: "admin".to_string(),
            resource_id: "article-1".to_string(),
            resource_type: ResourceType::Article,
        };

        assert!(Authorizer::can_moderate(&ctx).unwrap());
    }

    #[test]
    fn test_can_moderate_regular_user() {
        let ctx = PermissionContext {
            user_id: "user-1".to_string(),
            user_role: "user".to_string(),
            resource_id: "article-1".to_string(),
            resource_type: ResourceType::Article,
        };

        assert!(Authorizer::can_moderate(&ctx).is_err());
    }
}
