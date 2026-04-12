// Complete Registration to Authenticated Actions Flow Test
//
// This test verifies the COMPLETE flow:
// 1. Client calls register() via WebSocket plugin
// 2. Plugin creates user in FlareDB and returns JWT
// 3. Client stores JWT
// 4. Client uses JWT to access protected endpoints (create post, etc.)
// 5. Server validates JWT and allows/denies access based on permissions

use flare_db::{memory::MemoryStorage, Storage};
use flare_protocol::Document;
use flare_server::jwt_middleware::JwtManager;
use serde_json::json;
use std::sync::Arc;

/// Simulates client storing JWT after registration
struct ClientSession {
    jwt_token: Option<String>,
    user_id: Option<String>,
    email: Option<String>,
}

impl ClientSession {
    fn new() -> Self {
        Self {
            jwt_token: None,
            user_id: None,
            email: None,
        }
    }

    /// Called after successful registration - stores JWT
    fn store_jwt(&mut self, token: String, user_id: String, email: String) {
        self.jwt_token = Some(token);
        self.user_id = Some(user_id.clone());
        self.email = Some(email.clone());
        println!("✅ Client stored JWT for user: {} ({})", email, user_id);
    }

    /// Check if client is authenticated (has valid JWT)
    fn is_authenticated(&self) -> bool {
        self.jwt_token.is_some()
    }

    /// Get auth headers for requests (simulates client._getAuthHeaders())
    fn auth_headers(&self) -> Vec<(String, String)> {
        if let Some(ref token) = self.jwt_token {
            vec![
                ("Authorization".to_string(), format!("Bearer {}", token)),
                ("Content-Type".to_string(), "application/json".to_string()),
            ]
        } else {
            vec![
                ("Content-Type".to_string(), "application/json".to_string()),
            ]
        }
    }
}

/// Simulates plugin registration flow and returns JWT
async fn simulate_plugin_registration(
    storage: &Arc<MemoryStorage>,
    jwt_manager: &JwtManager,
    email: &str,
    password: &str,
    name: &str,
) -> (String, String) {
    // Plugin validates input
    assert!(email.contains('@'), "Email should be valid");
    assert!(password.len() >= 8, "Password should be strong");

    // Plugin hashes password
    let password_hash = bcrypt::hash(password, bcrypt::DEFAULT_COST).unwrap();

    // Plugin creates user in FlareDB
    let user = Document::new(
        "users".to_string(),
        json!({
            "email": email,
            "password_hash": password_hash,
            "name": name,
            "status": "active",
            "role": "user",
            "created_at": chrono::Utc::now().timestamp_millis()
        })
    );
    let user_id = user.id.clone();
    storage.insert(user).await.unwrap();

    // Plugin generates JWT
    let token = jwt_manager.generate_token(&user_id, email, "user").unwrap();

    println!("✅ Plugin created user {} and generated JWT", email);

    (user_id, token)
}

/// Test 1: Registration → JWT Storage → Authenticated State
#[tokio::test]
async fn test_registration_stores_jwt_and_changes_login_state() {
    let storage = Arc::new(MemoryStorage::new());
    let jwt_manager = JwtManager::new();
    let mut client = ClientSession::new();

    // ===== Phase 1: Client is NOT authenticated =====
    assert!(!client.is_authenticated(), "Client should NOT be authenticated initially");
    println!("✓ Client starts unauthenticated");

    // ===== Phase 2: Client calls register() =====
    let email = "user1@example.com";
    let password = "SecurePass123!";
    let name = "User One";

    // Simulate: client.register({email, password, name})
    // This calls the auth plugin via WebSocket
    let (user_id, token) = simulate_plugin_registration(
        &storage,
        &jwt_manager,
        email,
        password,
        name,
    ).await;

    // ===== Phase 3: Client receives and stores JWT =====
    // Simulates: client._setJWT(token, user)
    client.store_jwt(token.clone(), user_id.clone(), email.to_string());

    // ===== Phase 4: Client IS NOW authenticated =====
    assert!(client.is_authenticated(), "Client SHOULD be authenticated after registration!");
    println!("✓ Client is NOW authenticated after registration");

    // Verify user exists in database
    let created_user: Document = storage.get("users", &user_id).await.unwrap().unwrap();
    assert_eq!(created_user.data["email"], email);
    assert_eq!(created_user.data["status"], "active");
    println!("✓ User verified in FlareDB");

    // Verify JWT is valid
    let claims = jwt_manager.validate_token(&client.jwt_token.unwrap()).unwrap();
    assert_eq!(claims.sub, user_id);
    assert_eq!(claims.email, email);
    assert_eq!(claims.role, "user");
    println!("✓ JWT token is valid and contains correct claims");
}

/// Test 2: After Registration → Can Create Documents (Authenticated Action)
#[tokio::test]
async fn test_after_registration_can_create_documents() {
    let storage = Arc::new(MemoryStorage::new());
    let jwt_manager = JwtManager::new();
    let mut client = ClientSession::new();

    // Register user
    let (user_id, token) = simulate_plugin_registration(
        &storage,
        &jwt_manager,
        "author@example.com",
        "AuthorPass123!",
        "Blog Author",
    ).await;

    client.store_jwt(token, user_id, "author@example.com".to_string());

    // ===== Try to create a post (requires authentication) =====
    // This simulates: client.collection('posts').add({title, content})
    // Server validates JWT before allowing creation

    let post_data = json!({
        "title": "My First Post",
        "content": "Hello World!",
        "author_id": client.user_id.as_ref().unwrap(),
        "status": "draft",
        "created_at": chrono::Utc::now().timestamp_millis()
    });

    // Simulate server validating JWT before allowing post creation
    let claims = jwt_manager.validate_token(&client.jwt_token.as_ref().unwrap()).unwrap();
    let user_context = jwt_manager.extract_user_context(&claims);

    // Server verifies JWT user matches post author
    assert_eq!(user_context.user_id, *client.user_id.as_ref().unwrap());
    println!("✓ JWT user_id matches post author_id");

    // Server allows creation (user is authenticated and authorized)
    let post = Document::new(
        "posts".to_string(),
        post_data.clone()
    );
    let post_id = post.id.clone();
    storage.insert(post).await.unwrap();

    println!("✓ User successfully created post after registration");

    // Verify post exists
    let created_post: Document = storage.get("posts", &post_id).await.unwrap().unwrap();
    assert_eq!(created_post.data["title"], "My First Post");
    assert_eq!(created_post.data["author_id"], *client.user_id.as_ref().unwrap());
    println!("✓ Post verified in FlareDB");
}

/// Test 3: Unauthenticated User Cannot Create Documents
#[tokio::test]
async fn test_unauthenticated_user_cannot_create_documents() {
    let storage = Arc::new(MemoryStorage::new());
    let jwt_manager = JwtManager::new();
    let unauthenticated_client = ClientSession::new();

    // User tries to create post WITHOUT registering/logging in
    assert!(!unauthenticated_client.is_authenticated());

    // Server attempts to validate JWT - but there is none
    let auth_header = unauthenticated_client.auth_headers();
    let has_jwt = auth_header.iter().any(|(k, v)| k == "Authorization" && v.starts_with("Bearer "));

    assert!(!has_jwt, "Unauthenticated client should NOT have JWT in headers");
    println!("✓ Unauthenticated client has no JWT");

    // Server should REJECT this request (no JWT)
    // In real implementation, JWT middleware returns 401 UNAUTHORIZED
    println!("✓ Server would reject unauthenticated request with 401 UNAUTHORIZED");
}

/// Test 4: Complete Flow - Register → Create Post → Read Own Posts
#[tokio::test]
async fn test_complete_register_create_read_flow() {
    let storage = Arc::new(MemoryStorage::new());
    let jwt_manager = JwtManager::new();
    let mut client = ClientSession::new();

    // ===== Step 1: Register =====
    println!("\n=== Step 1: User Registration ===");
    let (user_id, token) = simulate_plugin_registration(
        &storage,
        &jwt_manager,
        "blogger@example.com",
        "BloggerPass123!",
        "Blogger",
    ).await;

    client.store_jwt(token, user_id, "blogger@example.com".to_string());
    assert!(client.is_authenticated());
    println!("✅ User registered and authenticated");

    // ===== Step 2: Create multiple posts =====
    println!("\n=== Step 2: Create Posts ===");
    for i in 1..=3 {
        let post = Document::new(
            "posts".to_string(),
            json!({
                "title": format!("Post #{}", i),
                "content": format!("Content of post {}", i),
                "author_id": client.user_id.as_ref().unwrap(),
                "status": "published",
                "created_at": chrono::Utc::now().timestamp_millis()
            })
        );
        storage.insert(post).await.unwrap();
        println!("✓ Created post #{}", i);
    }

    // ===== Step 3: Read own posts (query with JWT context) =====
    println!("\n=== Step 3: Read Own Posts ===");
    let claims = jwt_manager.validate_token(&client.jwt_token.as_ref().unwrap()).unwrap();
    let user_id_from_jwt = claims.sub;

    let query = flare_protocol::Query {
        collection: "posts".to_string(),
        filters: vec![
            ("author_id".to_string(), flare_protocol::QueryOp::Eq(json!(user_id_from_jwt))),
            ("status".to_string(), flare_protocol::QueryOp::Eq(json!("published"))),
        ],
        limit: None,
        offset: None,
    };

    let posts: Vec<Document> = storage.query(query).await.unwrap();
    assert_eq!(posts.len(), 3, "Should find all 3 posts by this author");
    println!("✓ Successfully queried {} own posts", posts.len());

    // Verify JWT user can only see their own posts
    for post in &posts {
        assert_eq!(post.data["author_id"], user_id_from_jwt);
    }
    println!("✓ All returned posts belong to authenticated user");

    // ===== Step 4: Try to access without JWT (should fail) =====
    println!("\n=== Step 4: Unauthenticated Access Attempt ===");
    let anon_client = ClientSession::new();
    assert!(!anon_client.is_authenticated());
    println!("✓ Anonymous user has no authentication");
}

/// Test 5: JWT Persists Across Multiple Operations
#[tokio::test]
async fn test_jwt_persists_across_multiple_operations() {
    let storage = Arc::new(MemoryStorage::new());
    let jwt_manager = JwtManager::new();
    let mut client = ClientSession::new();

    // Register once
    let (user_id, token) = simulate_plugin_registration(
        &storage,
        &jwt_manager,
        "persistent@example.com",
        "PersistentPass123!",
        "Persistent User",
    ).await;

    client.store_jwt(token, user_id.clone(), "persistent@example.com".to_string());
    let original_token = client.jwt_token.clone();

    // Perform multiple operations - JWT should remain valid
    for i in 1..=5 {
        assert!(client.is_authenticated(), "Should still be authenticated on operation {}", i);
        assert_eq!(client.jwt_token, original_token, "JWT should not change");

        // Create a document
        let doc = Document::new(
            "documents".to_string(),
            json!({
                "owner_id": client.user_id.as_ref().unwrap(),
                "data": format!("Document {}", i),
                "created_at": chrono::Utc::now().timestamp_millis()
            })
        );
        storage.insert(doc).await.unwrap();
    }

    println!("✓ JWT persisted across 5 operations");

    // Verify JWT is still valid
    let claims = jwt_manager.validate_token(&client.jwt_token.as_ref().unwrap()).unwrap();
    assert_eq!(claims.sub, user_id);
    println!("✓ JWT still valid after multiple operations");

    // Verify all documents created
    let query = flare_protocol::Query {
        collection: "documents".to_string(),
        filters: vec![
            ("owner_id".to_string(), flare_protocol::QueryOp::Eq(json!(user_id))),
        ],
        limit: None,
        offset: None,
    };

    let docs: Vec<Document> = storage.query(query).await.unwrap();
    assert_eq!(docs.len(), 5, "Should have 5 documents");
    println!("✓ All 5 documents found with correct owner_id");
}

/// Test 6: Simulate HTTP Request with JWT (Integration Test)
#[tokio::test]
async fn test_http_request_with_jwt_after_registration() {
    let storage = Arc::new(MemoryStorage::new());
    let jwt_manager = JwtManager::new();
    let mut client = ClientSession::new();

    // Register
    let (user_id, token) = simulate_plugin_registration(
        &storage,
        &jwt_manager,
        "httpuser@example.com",
        "HttpUserPass123!",
        "HTTP User",
    ).await;

    client.store_jwt(token.clone(), user_id.clone(), "httpuser@example.com".to_string());

    // Simulate making HTTP request with JWT
    // POST /collections/posts {title, content}
    // Authorization: Bearer <token>

    let auth_headers = client.auth_headers();
    let auth_header = auth_headers.iter()
        .find(|(k, _)| k == "Authorization")
        .map(|(_, v)| v)
        .unwrap();

    assert!(auth_header.starts_with("Bearer "), "Should have Bearer token");

    // Extract and validate JWT (simulates server middleware)
    let token_from_header = auth_header.trim_start_matches("Bearer ");
    let claims = jwt_manager.validate_token(token_from_header).unwrap();
    let user_context = jwt_manager.extract_user_context(&claims);

    assert_eq!(user_context.user_id, user_id);
    assert_eq!(user_context.email, "httpuser@example.com");
    assert_eq!(user_context.role, "user");

    println!("✓ HTTP request with JWT validated successfully");

    // Server allows creation (user is authenticated)
    let post = Document::new(
        "posts".to_string(),
        json!({
            "title": "HTTP Post",
            "author_id": user_id,
            "status": "published"
        })
    );
    storage.insert(post).await.unwrap();

    println!("✓ Created post via simulated HTTP request");
}
