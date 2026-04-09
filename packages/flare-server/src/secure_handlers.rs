// Secure HTTP handlers with authentication and authorization
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use crate::auth::{extract_user_from_request, check_document_permission, validate_update_permissions, AuthUser};
use crate::AppState;
use flare_protocol::Document;
use serde_json::Value;

/// Secure DELETE handler with permission checks
pub async fn secure_delete_doc(
    State(state): State<Arc<AppState>>,
    Path((collection, id)): Path<(String, String)>,
    request: Request,
) -> Result<Json<bool>, StatusCode> {
    // 1. Extract and authenticate user
    let user = extract_user_from_request(&request, &state)
        .await
        .map_err(|e| e)?;

    // 2. Fetch the document to check ownership
    let doc = state.storage.get(&collection, &id).await
        .map_err(|e| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    // 3. Check delete permission
    check_document_permission(&user, &collection, &doc.data, "delete")?;

    // 4. Perform deletion
    state.storage.delete(&collection, &id).await
        .map_err(|e| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 5. Emit real-time events
    let _ = state.io.to(collection.clone()).emit("doc_deleted", &id);
    let _ = state.event_bus.emit(crate::hooks::Event {
        event_type: crate::hooks::EventType::DocDeleted,
        payload: serde_json::json!({ "id", id, "collection", collection }),
        timestamp: chrono::Utc::now().timestamp_millis(),
    });

    Ok(Json(true))
}

/// Secure UPDATE handler with permission checks
pub async fn secure_update_doc(
    State(state): State<Arc<AppState>>,
    Path((collection, id)): Path<(String, String)>,
    request: Request,
    Json(updates): Json<Value>,
) -> Result<Json<Document>, StatusCode> {
    // 1. Extract and authenticate user
    let user = extract_user_from_request(&request, &state)
        .await
        .map_err(|e| e)?;

    // 2. Fetch current document
    let current_doc = state.storage.get(&collection, &id).await
        .map_err(|e| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    // 3. Validate update permissions
    validate_update_permissions(&user, &collection, &current_doc.data, &updates)?;

    // 4. Perform update
    let updated_doc = state.storage.update(&collection, &id, &updates).await
        .map_err(|e| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 5. Emit real-time events
    let _ = state.io.to(collection.clone()).emit("doc_updated", &updated_doc);
    let _ = state.event_bus.emit(crate::hooks::Event {
        event_type: crate::hooks::EventType::DocUpdated,
        payload: serde_json::json!({ "doc", updated_doc }),
        timestamp: chrono::Utc::now().timestamp_millis(),
    });

    Ok(Json(updated_doc))
}

/// Secure GET handler with permission checks for sensitive data
pub async fn secure_get_doc(
    State(state): State<Arc<AppState>>,
    Path((collection, id)): Path<(String, String)>,
    request: Request,
) -> Result<Json<Option<Document>>, StatusCode> {
    let doc = state.storage.get(&collection, &id).await
        .map_err(|e| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some(ref document) = doc {
        // Check if user has permission to read this document
        if let Ok(user) = extract_user_from_request(&request, &state).await {
            check_document_permission(&user, &collection, &document.data, "read")?;
        }

        // Sanitize sensitive data based on user role
        if let Ok(user) = extract_user_from_request(&request, &state).await {
            if collection == "users" {
                let sanitized_data = crate::permissions::Authorizer::sanitize_user_data(
                    &document.data,
                    &user.id,
                    &user.role
                );

                // Return sanitized document
                return Ok(Json(Some(Document {
                    id: document.id.clone(),
                    collection: document.collection.clone(),
                    data: sanitized_data,
                    version: document.version,
                    updated_at: document.updated_at,
                })));
            }
        }
    }

    Ok(Json(doc))
}

/// Create a new document with automatic author assignment
pub async fn secure_create_doc(
    State(state): State<Arc<AppState>>,
    Path(collection): Path<String>,
    request: Request,
    Json(mut data): Json<Value>,
) -> Result<Json<Document>, StatusCode> {
    // 1. Extract and authenticate user
    let user = extract_user_from_request(&request, &state)
        .await
        .map_err(|e| e)?;

    // 2. For content collections, automatically set author_id
    if collection == "posts" || collection == "articles" {
        if !data.get("author_id").is_some() {
            data["author_id"] = Value::String(user.id.clone());
        }
        if !data.get("author_email").is_some() {
            data["author_email"] = Value::String(user.email.clone());
        }
        if !data.get("author_name").is_some() {
            // Fetch user's name from users collection
            if let Ok(Some(user_doc)) = state.storage.get("users", &user.id).await {
                if let Some(name) = user_doc.data.get("name") {
                    data["author_name"] = name.clone();
                }
            }
        }
    }

    // 3. Set creation timestamp
    if !data.get("created_at").is_some() {
        data["created_at"] = Value::Number(serde_json::Number::from(chrono::Utc::now().timestamp_millis()));
    }

    // 4. Create document
    let doc = state.storage.add(&collection, &data).await
        .map_err(|e| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 5. Emit real-time events
    let _ = state.io.to(collection.clone()).emit("doc_created", &doc);
    let _ = state.event_bus.emit(crate::hooks::Event {
        event_type: crate::hooks::EventType::DocCreated,
        payload: serde_json::json!({ "doc", doc }),
        timestamp: chrono::Utc::now().timestamp_millis(),
    });

    Ok(Json(doc))
}

#[cfg(test)]
mod secure_handlers_tests {
    use super::*;

    #[test]
    fn test_secure_delete_requires_auth() {
        // Test that delete operation requires authentication
        // This would need integration test setup
        assert!(true); // Placeholder
    }

    #[test]
    fn test_secure_update_validates_ownership() {
        // Test that users can only update their own documents
        assert!(true); // Placeholder
    }

    #[test]
    fn test_secure_create_assigns_author() {
        // Test that author_id is automatically assigned on create
        assert!(true); // Placeholder
    }
}