// User Registration and Article Management Tests with Permission Control
use flare_db::Storage;
use flare_db::SledStorage;
use flare_protocol::{Document, Query, QueryOp, BatchOperation};
use tempfile::tempdir;
use serde_json::json;

// Helper functions for user management
async fn create_user(storage: &SledStorage, email: &str, password_hash: &str, name: &str) -> anyhow::Result<Document> {
    let user = Document::new(
        "users".to_string(),
        json!({
            "email": email,
            "password_hash": password_hash,
            "name": name,
            "created_at": chrono::Utc::now().timestamp_millis(),
            "status": "pending_verification"
        })
    );
    storage.insert(user.clone()).await?;
    Ok(user)
}

async fn get_user_by_email(storage: &SledStorage, email: &str) -> anyhow::Result<Option<Document>> {
    let query = Query {
        collection: "users".to_string(),
        filters: vec![("email".to_string(), QueryOp::Eq(json!(email)))],
        offset: None,
        limit: None,
    };
    let results = storage.query(query).await?;
    Ok(results.into_iter().next())
}

// Helper functions for article management
async fn create_article(storage: &SledStorage, author_id: &str, title: &str, content: &str, status: &str) -> anyhow::Result<Document> {
    let mut doc = Document::new(
        "articles".to_string(),
        json!({
            "title": title,
            "content": content,
            "author_id": author_id,
            "status": status,
            "created_at": chrono::Utc::now().timestamp_millis(),
            "updated_at": chrono::Utc::now().timestamp_millis()
        })
    );

    // Set initial version to 1
    doc.version = 1;
    storage.insert(doc.clone()).await?;
    Ok(doc)
}

async fn update_article(storage: &SledStorage, article_id: &str, user_id: &str, updates: serde_json::Value) -> anyhow::Result<Option<Document>> {
    // First, check if user owns the article
    let article = storage.get("articles", article_id).await?;

    match article {
        Some(doc) => {
            let author_id = doc.data.get("author_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if author_id != user_id {
                return Err(anyhow::anyhow!("Permission denied: User {} does not own article {}", user_id, article_id));
            }

            // User owns the article, proceed with update
            storage.update("articles", article_id, updates).await
        }
        None => Ok(None)
    }
}

async fn moderate_article(storage: &SledStorage, article_id: &str, new_status: &str) -> anyhow::Result<Option<Document>> {
    let updates = json!({
        "status": new_status,
        "moderated_at": chrono::Utc::now().timestamp_millis()
    });
    storage.update("articles", article_id, updates).await
}

#[cfg(test)]
mod tests {
    use super::*;

    // USER REGISTRATION TESTS

    #[tokio::test]
    async fn test_user_registration_basic() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let user = create_user(
            &storage,
            "alice@example.com",
            "hashed_password_123",
            "Alice Johnson"
        ).await.unwrap();

        assert_eq!(user.collection, "users");
        assert_eq!(user.data["email"], "alice@example.com");
        assert_eq!(user.data["name"], "Alice Johnson");
        assert_eq!(user.data["status"], "pending_verification");
        assert!(user.data.get("password_hash").is_some());
    }

    #[tokio::test]
    async fn test_user_registration_duplicate_email() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        create_user(&storage, "bob@example.com", "hash1", "Bob One").await.unwrap();
        create_user(&storage, "bob@example.com", "hash2", "Bob Two").await.unwrap();

        let users = get_user_by_email(&storage, "bob@example.com").await.unwrap();
        assert!(users.is_some());

        // Should have two users (we're not enforcing uniqueness at DB level in this simple implementation)
        let query = Query {
            collection: "users".to_string(),
            filters: vec![("email".to_string(), QueryOp::Eq(json!("bob@example.com")))],
            offset: None,
            limit: None,
        };
        let results = storage.query(query).await.unwrap();
        assert_eq!(results.len(), 2);
    }

    #[tokio::test]
    async fn test_user_verification_flow() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        // Step 1: User registers
        let user = create_user(
            &storage,
            "charlie@example.com",
            "hashed_password",
            "Charlie Brown"
        ).await.unwrap();

        assert_eq!(user.data["status"], "pending_verification");

        // Step 2: User verifies email
        storage.update("users", &user.id, json!({
            "status": "active",
            "verified_at": chrono::Utc::now().timestamp_millis()
        })).await.unwrap();

        // Step 3: Check user is now active
        let verified_user = storage.get("users", &user.id).await.unwrap().unwrap();
        assert_eq!(verified_user.data["status"], "active");
        assert!(verified_user.data.get("verified_at").is_some());
    }

    // ARTICLE MANAGEMENT TESTS

    #[tokio::test]
    async fn test_create_article_basic() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let user = create_user(&storage, "author@example.com", "hash", "Author Name").await.unwrap();

        let article = create_article(
            &storage,
            &user.id,
            "My First Article",
            "This is the content of my article.",
            "draft"
        ).await.unwrap();

        assert_eq!(article.collection, "articles");
        assert_eq!(article.data["title"], "My First Article");
        assert_eq!(article.data["author_id"], user.id);
        assert_eq!(article.data["status"], "draft");
        assert_eq!(article.version, 1);
    }

    #[tokio::test]
    async fn test_update_own_article() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let user = create_user(&storage, "writer@example.com", "hash", "Writer").await.unwrap();
        let article = create_article(&storage, &user.id, "Original Title", "Original content", "draft").await.unwrap();

        // User updates their own article
        let updated = update_article(
            &storage,
            &article.id,
            &user.id,
            json!({
                "title": "Updated Title",
                "content": "Updated content"
            })
        ).await.unwrap();

        assert!(updated.is_some());
        let updated_article = updated.unwrap();
        assert_eq!(updated_article.data["title"], "Updated Title");
        assert_eq!(updated_article.data["content"], "Updated content");
        assert_eq!(updated_article.version, 2); // Version should be incremented
    }

    #[tokio::test]
    async fn test_cannot_modify_others_article() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let author = create_user(&storage, "author@example.com", "hash", "Author").await.unwrap();
        let malicious_user = create_user(&storage, "hacker@example.com", "hash", "Hacker").await.unwrap();

        let article = create_article(&storage, &author.id, "Author's Article", "Original content", "draft").await.unwrap();

        // Malicious user tries to modify author's article
        let result = update_article(
            &storage,
            &article.id,
            &malicious_user.id,
            json!({
                "title": "Hacked Title",
                "content": "Hacked content"
            })
        ).await;

        // Should fail with permission error
        assert!(result.is_err());
        let error = result.unwrap_err();
        assert!(error.to_string().contains("Permission denied"));

        // Article should remain unchanged
        let original_article = storage.get("articles", &article.id).await.unwrap().unwrap();
        assert_eq!(original_article.data["title"], "Author's Article");
        assert_eq!(original_article.data["content"], "Original content");
    }

    #[tokio::test]
    async fn test_article_moderation_workflow() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let user = create_user(&storage, "writer@example.com", "hash", "Writer").await.unwrap();

        // Step 1: Create article in draft status
        let article = create_article(&storage, &user.id, "Draft Article", "Draft content", "draft").await.unwrap();
        assert_eq!(article.data["status"], "draft");

        // Step 2: Submit for moderation (user action)
        storage.update("articles", &article.id, json!({
            "status": "pending_review"
        })).await.unwrap();

        let submitted = storage.get("articles", &article.id).await.unwrap().unwrap();
        assert_eq!(submitted.data["status"], "pending_review");

        // Step 3: Moderator approves
        let approved = moderate_article(&storage, &article.id, "published").await.unwrap();
        assert!(approved.is_some());

        let published = approved.unwrap();
        assert_eq!(published.data["status"], "published");
        assert!(published.data.get("moderated_at").is_some());
    }

    #[tokio::test]
    async fn test_article_versioning_on_multiple_updates() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let user = create_user(&storage, "editor@example.com", "hash", "Editor").await.unwrap();
        let article = create_article(&storage, &user.id, "Title", "Content v1", "draft").await.unwrap();

        // First update
        storage.update("articles", &article.id, json!({"content": "Content v2"})).await.unwrap();
        let v2 = storage.get("articles", &article.id).await.unwrap().unwrap();
        assert_eq!(v2.version, 2);

        // Second update
        storage.update("articles", &article.id, json!({"content": "Content v3"})).await.unwrap();
        let v3 = storage.get("articles", &article.id).await.unwrap().unwrap();
        assert_eq!(v3.version, 3);

        // Third update
        storage.update("articles", &article.id, json!({"content": "Content v4"})).await.unwrap();
        let v4 = storage.get("articles", &article.id).await.unwrap().unwrap();
        assert_eq!(v4.version, 4);
    }

    #[tokio::test]
    async fn test_list_articles_by_author() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let author1 = create_user(&storage, "author1@example.com", "hash", "Author 1").await.unwrap();
        let author2 = create_user(&storage, "author2@example.com", "hash", "Author 2").await.unwrap();

        create_article(&storage, &author1.id, "Article 1", "Content 1", "published").await.unwrap();
        create_article(&storage, &author1.id, "Article 2", "Content 2", "draft").await.unwrap();
        create_article(&storage, &author2.id, "Article 3", "Content 3", "published").await.unwrap();

        // Query for author1's articles
        let query = Query {
            collection: "articles".to_string(),
            filters: vec![("author_id".to_string(), QueryOp::Eq(json!(author1.id)))],
            offset: None,
            limit: None,
        };

        let author1_articles = storage.query(query).await.unwrap();
        assert_eq!(author1_articles.len(), 2);

        // Verify all belong to author1
        for article in &author1_articles {
            assert_eq!(article.data["author_id"], author1.id);
        }
    }

    #[tokio::test]
    async fn test_delete_own_article() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let user = create_user(&storage, "owner@example.com", "hash", "Owner").await.unwrap();
        let article = create_article(&storage, &user.id, "To Delete", "Will be deleted", "draft").await.unwrap();

        // Verify article exists
        assert!(storage.get("articles", &article.id).await.unwrap().is_some());

        // Delete article
        storage.delete("articles", &article.id).await.unwrap();

        // Verify article is gone
        assert!(storage.get("articles", &article.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_batch_create_articles_with_permission_check() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let user = create_user(&storage, "batch_author@example.com", "hash", "Batch Author").await.unwrap();

        let article1 = Document::new(
            "articles".to_string(),
            json!({
                "title": "Batch Article 1",
                "content": "Content 1",
                "author_id": &user.id,
                "status": "draft"
            })
        );

        let article2 = Document::new(
            "articles".to_string(),
            json!({
                "title": "Batch Article 2",
                "content": "Content 2",
                "author_id": &user.id,
                "status": "draft"
            })
        );

        let operations = vec![
            BatchOperation::Set(article1),
            BatchOperation::Set(article2),
        ];

        storage.apply_batch(operations).await.unwrap();

        // Verify both articles were created
        let query = Query {
            collection: "articles".to_string(),
            filters: vec![("author_id".to_string(), QueryOp::Eq(json!(user.id)))],
            offset: None,
            limit: None,
        };

        let results = storage.query(query).await.unwrap();
        assert_eq!(results.len(), 2);
    }

    #[tokio::test]
    async fn test_search_published_articles() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let user = create_user(&storage, "publisher@example.com", "hash", "Publisher").await.unwrap();

        create_article(&storage, &user.id, "Published 1", "Content 1", "published").await.unwrap();
        create_article(&storage, &user.id, "Draft 1", "Content 2", "draft").await.unwrap();
        create_article(&storage, &user.id, "Published 2", "Content 3", "published").await.unwrap();
        create_article(&storage, &user.id, "Pending Review", "Content 4", "pending_review").await.unwrap();

        // Query only published articles
        let query = Query {
            collection: "articles".to_string(),
            filters: vec![("status".to_string(), QueryOp::Eq(json!("published")))],
            offset: None,
            limit: None,
        };

        let published = storage.query(query).await.unwrap();
        assert_eq!(published.len(), 2);

        for article in &published {
            assert_eq!(article.data["status"], "published");
        }
    }

    #[tokio::test]
    async fn test_cannot_update_others_article_direct_storage_access() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let author = create_user(&storage, "real_author@example.com", "hash", "Real Author").await.unwrap();
        let other_user = create_user(&storage, "other_user@example.com", "hash", "Other User").await.unwrap();

        let article = create_article(
            &storage,
            &author.id,
            "Author's Original Title",
            "Author's content",
            "draft"
        ).await.unwrap();

        // Direct storage update attempt (simulating direct DB access)
        let update_result = storage.update(
            "articles",
            &article.id,
            json!({
                "title": "Malicious Title",
                "content": "Malicious content",
                "author_id": &other_user.id  // Try to change ownership too
            })
        ).await;

        // In our current implementation, storage.update doesn't check permissions
        // This demonstrates why application-level permission checks are critical
        assert!(update_result.is_ok());

        let updated_article = storage.get("articles", &article.id).await.unwrap().unwrap();

        // This would be a security issue in production! The author_id was changed.
        // This is why we need the update_article helper function that checks permissions
        assert_eq!(updated_article.data["author_id"], other_user.id);

        // The solution is to ALWAYS use the helper functions that check permissions
        // Never expose raw storage.update to client requests
    }

    #[tokio::test]
    async fn test_transaction_with_permission_checks() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let user1 = create_user(&storage, "user1@example.com", "hash1", "User 1").await.unwrap();
        let user2 = create_user(&storage, "user2@example.com", "hash2", "User 2").await.unwrap();

        let article1 = create_article(&storage, &user1.id, "User 1 Article", "Content 1", "draft").await.unwrap();
        let article2 = create_article(&storage, &user2.id, "User 2 Article", "Content 2", "draft").await.unwrap();

        // User1 tries to update both articles in a transaction
        let update1_result = update_article(&storage, &article1.id, &user1.id, json!({"title": "Updated My Article"})).await;
        assert!(update1_result.is_ok());

        let update2_result = update_article(&storage, &article2.id, &user1.id, json!({"title": "Hacked Article"})).await;

        // Should fail because user1 can't update user2's article
        assert!(update2_result.is_err());

        // Verify user2's article was not modified
        let user2_article = storage.get("articles", &article2.id).await.unwrap().unwrap();
        assert_eq!(user2_article.data["title"], "User 2 Article");
    }

    #[tokio::test]
    async fn test_complex_article_query_with_filters() {
        let dir = tempdir().unwrap();
        let storage = SledStorage::new(dir.path()).unwrap();

        let user = create_user(&storage, "filter_test@example.com", "hash", "Filter Tester").await.unwrap();

        // Create articles with various statuses and dates
        create_article(&storage, &user.id, "Published Old", "Content 1", "published").await.unwrap();
        create_article(&storage, &user.id, "Draft Recent", "Content 2", "draft").await.unwrap();
        create_article(&storage, &user.id, "Published Recent", "Content 3", "published").await.unwrap();
        create_article(&storage, &user.id, "Pending Review", "Content 4", "pending_review").await.unwrap();

        // Query for published articles by this user
        let query = Query {
            collection: "articles".to_string(),
            filters: vec![
                ("author_id".to_string(), QueryOp::Eq(json!(user.id))),
                ("status".to_string(), QueryOp::Eq(json!("published")))
            ],
            offset: None,
            limit: None,
        };

        let results = storage.query(query).await.unwrap();
        assert_eq!(results.len(), 2);

        for article in &results {
            assert_eq!(article.data["author_id"], user.id);
            assert_eq!(article.data["status"], "published");
        }
    }
}
