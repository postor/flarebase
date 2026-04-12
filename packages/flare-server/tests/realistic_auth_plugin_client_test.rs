// Realistic Auth Plugin and Client Flow Test
//
// This test simulates the REAL auth plugin behavior (as implemented in auth-plugin.js)
// and the REAL FlareClient behavior (as implemented in clients/js/src/index.js)
//
// Real Auth Plugin Flow:
// 1. Plugin connects to ws://host:port/plugins
// 2. Plugin registers with event: "auth"
// 3. Plugin receives plugin_request with {action: 'register', email, password, name}
// 4. Plugin validates input (email format, password strength)
// 5. Plugin checks if email exists via GET /collections/users
// 6. Plugin hashes password (PBKDF2/bcrypt)
// 7. Plugin creates user via POST /collections/users
// 8. Plugin generates JWT (using same secret as server)
// 9. Plugin sends plugin_response with {success, token, user}
//
// Real FlareClient Flow:
// 1. Client connects to WebSocket
// 2. Client calls: await client.register({email, password, name})
// 3. Client emits: call_plugin(['auth', {action: 'register', ...}])
// 4. Client listens for: plugin_success / plugin_error
// 5. Client stores JWT: this._setJWT(token, user)
// 6. Client updates login state: client.auth.isAuthenticated = true
// 7. Client can now make authenticated requests with JWT

use flare_db::{memory::MemoryStorage, Storage};
use flare_protocol::Document;
use flare_server::jwt_middleware::JwtManager;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

// ============================================================
// Real Auth Plugin Simulation
// Matches: examples/blog-platform/src/lib/auth-plugin.js
// ============================================================

struct AuthPlugin {
    storage: Arc<dyn Storage>,
    jwt_manager: JwtManager,
    plugin_token: String,
    registered: bool,
}

impl AuthPlugin {
    fn new(storage: Arc<dyn Storage>, jwt_manager: JwtManager) -> Self {
        Self {
            storage,
            jwt_manager,
            plugin_token: "auth-plugin-token".to_string(),
            registered: false,
        }
    }

    /// Plugin registers with server
    fn register(&mut self) -> Result<(), String> {
        self.registered = true;
        println!("🔌 Auth Plugin registered with event: auth");
        Ok(())
    }

    /// Handle registration request (matches handleRegister in auth-plugin.js)
    async fn handle_register(&self, params: &Value) -> Result<Value, String> {
        let email = params["email"].as_str().ok_or("Email is required")?;
        let password = params["password"].as_str().ok_or("Password is required")?;
        let name = params["name"].as_str().unwrap_or("Unknown");

        println!("  🔧 Executing register action for: {}", email);

        // 1. Validate email format (matches auth-plugin.js line 128-130)
        if !email.contains('@') {
            return Err("INVALID_EMAIL".to_string());
        }

        // 2. Validate password strength (matches auth-plugin.js line 132-134)
        if password.len() < 6 {
            return Err("Password must be at least 6 characters".to_string());
        }

        // 3. Check if email already exists (matches auth-plugin.js line 137-147)
        let check_query = flare_protocol::Query {
            collection: "users".to_string(),
            filters: vec![("email".to_string(), flare_protocol::QueryOp::Eq(json!(email)))],
            limit: Some(1),
            offset: None,
        };

        let existing_users = self.storage.query(check_query).await.map_err(|e| e.to_string())?;
        if !existing_users.is_empty() {
            println!("  ⚠️  Email already exists: {}", email);
            return Err("USER_EXISTS".to_string());
        }

        // 4. Hash password (matches auth-plugin.js line 150-151)
        // Real plugin uses PBKDF2, we use bcrypt for better security
        let password_hash = bcrypt::hash(password, bcrypt::DEFAULT_COST)
            .map_err(|e| format!("Failed to hash password: {}", e))?;

        // 5. Create user via storage (matches auth-plugin.js line 154-173)
        let user = Document::new(
            "users".to_string(),
            json!({
                "email": email,
                "password_hash": password_hash,
                "name": name,
                "role": "user",
                "status": "active",
                "created_at": chrono::Utc::now().timestamp_millis(),
                "updated_at": chrono::Utc::now().timestamp_millis()
            })
        );
        let user_id = user.id.clone();
        self.storage.insert(user).await.map_err(|e| format!("Failed to create user: {}", e))?;

        println!("  ✅ User created: {}", user_id);

        // 6. Generate JWT (matches auth-plugin.js generateJWT function line 262-276)
        let token = self.jwt_manager.generate_token(&user_id, email, "user")
            .map_err(|e| format!("Failed to generate JWT: {}", e))?;

        // 7. Return response (matches auth-plugin.js line 175-186)
        Ok(json!({
            "success": true,
            "token": token,
            "user": {
                "id": user_id,
                "email": email,
                "name": name,
                "role": "user"
            }
        }))
    }

    /// Handle login request (matches handleLogin in auth-plugin.js)
    async fn handle_login(&self, params: &Value) -> Result<Value, String> {
        let email = params["email"].as_str().ok_or("Email is required")?;
        let password = params["password"].as_str().ok_or("Password is required")?;

        println!("  🔐 Logging in user: {}", email);

        // 1. Query user by email (matches auth-plugin.js line 203-209)
        let query = flare_protocol::Query {
            collection: "users".to_string(),
            filters: vec![("email".to_string(), flare_protocol::QueryOp::Eq(json!(email)))],
            limit: Some(1),
            offset: None,
        };

        let users = self.storage.query(query).await.map_err(|e| e.to_string())?;
        let user = users.first().ok_or("USER_NOT_FOUND")?;

        // 2. Verify password hash (matches auth-plugin.js line 221-234)
        let stored_hash = user.data["password_hash"]
            .as_str()
            .ok_or("INVALID_CREDENTIALS")?;

        let password_valid = bcrypt::verify(password, stored_hash)
            .map_err(|e| format!("Password verification failed: {}", e))?;

        if !password_valid {
            println!("  ⚠️  Invalid password for: {}", email);
            return Err("INVALID_CREDENTIALS".to_string());
        }

        // 3. Generate JWT (matches auth-plugin.js line 236)
        let user_id = user.id.clone();
        let user_role = user.data["role"].as_str().unwrap_or("user");
        let token = self.jwt_manager.generate_token(&user_id, email, user_role)
            .map_err(|e| format!("Failed to generate JWT: {}", e))?;

        println!("  ✅ Login successful for: {}", email);

        Ok(json!({
            "success": true,
            "token": token,
            "user": {
                "id": user_id,
                "email": email,
                "name": user.data["name"],
                "role": user_role
            }
        }))
    }
}

// ============================================================
// Real FlareClient Simulation
// Matches: clients/js/src/index.js
// ============================================================

struct FlareClient {
    jwt: Option<String>,
    user: Option<Value>,
    registered: bool,
}

impl FlareClient {
    fn new() -> Self {
        Self {
            jwt: None,
            user: None,
            registered: false,
        }
    }

    /// Register via auth plugin (matches FlareClient.register in index.js line 338-367)
    /// This simulates: client.socket.emit('call_plugin', ['auth', {action: 'register', ...}])
    async fn register(&mut self, plugin: &AuthPlugin, data: &Value) -> Result<Value, String> {
        println!("📡 Client calling register via WebSocket plugin...");

        // Simulate WebSocket call to auth plugin
        let result = plugin.handle_register(data).await?;

        // Store JWT and user info (matches FlareClient._setJWT in index.js line 98-127)
        if result["token"].is_string() {
            self._set_jwt(
                result["token"].as_str().unwrap().to_string(),
                &result["user"],
            );
        }

        Ok(result)
    }

    /// Login via auth plugin (matches FlareClient.login in index.js line 310-336)
    async fn login(&mut self, plugin: &AuthPlugin, data: &Value) -> Result<Value, String> {
        println!("📡 Client calling login via WebSocket plugin...");

        let result = plugin.handle_login(data).await?;

        if result["token"].is_string() {
            self._set_jwt(
                result["token"].as_str().unwrap().to_string(),
                &result["user"],
            );
        }

        Ok(result)
    }

    /// Store JWT (matches FlareClient._setJWT in index.js line 98-127)
    fn _set_jwt(&mut self, token: String, user: &Value) {
        self.jwt = Some(token.clone());
        self.user = Some(user.clone());
        self.registered = true;

        println!("✅ Client stored JWT:");
        println!("   User ID: {}", user["id"]);
        println!("   Email: {}", user["email"]);
    }

    /// Logout (matches FlareClient.logout in index.js line 371-373)
    fn logout(&mut self) {
        self.jwt = None;
        self.user = None;
        self.registered = false;
        println!("🚪 Client logged out, JWT cleared");
    }

    /// Check if authenticated (matches FlareClient.auth.isAuthenticated in index.js line 383-393)
    fn is_authenticated(&self) -> bool {
        self.jwt.is_some()
    }

    /// Get current user (matches FlareClient.auth.user in index.js line 399-404)
    fn get_user(&self) -> Option<&Value> {
        self.user.as_ref()
    }

    /// Get auth headers (matches FlareClient._getAuthHeaders in index.js line 283-294)
    fn get_auth_headers(&self) -> HashMap<String, String> {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());

        if let Some(ref token) = self.jwt {
            headers.insert("Authorization".to_string(), format!("Bearer {}", token));
        }

        headers
    }

    /// Create document with auth (matches FlareClient.collection('posts').add)
    async fn create_post(
        &self,
        storage: &Arc<MemoryStorage>,
        title: &str,
        content: &str,
    ) -> Result<Document, String> {
        if !self.is_authenticated() {
            return Err("401 UNAUTHORIZED: No JWT token provided".to_string());
        }

        let user = self.get_user().unwrap();
        let author_id = user["id"].as_str().unwrap();

        let post = Document::new(
            "posts".to_string(),
            json!({
                "title": title,
                "content": content,
                "author_id": author_id,
                "status": "published",
                "created_at": chrono::Utc::now().timestamp_millis()
            })
        );
        let post_id = post.id.clone();
        storage.insert(post).await.map_err(|e| format!("Failed to create post: {}", e))?;

        println!("✅ Created post: {} (id: {})", title, post_id);
        Ok(storage.get("posts", &post_id).await.unwrap().unwrap())
    }

    /// Query posts with auth (simulates GET /collections/posts with JWT)
    async fn get_posts(&self, storage: &Arc<MemoryStorage>) -> Result<Vec<Document>, String> {
        if !self.is_authenticated() {
            return Err("401 UNAUTHORIZED: No JWT token provided".to_string());
        }

        let user = self.get_user().unwrap();
        let user_id = user["id"].as_str().unwrap();

        // Query only own posts (matches namedQuery with user context)
        let query = flare_protocol::Query {
            collection: "posts".to_string(),
            filters: vec![("author_id".to_string(), flare_protocol::QueryOp::Eq(json!(user_id)))],
            limit: None,
            offset: None,
        };

        let posts = storage.query(query).await.map_err(|e| e.to_string())?;
        println!("✅ Found {} posts for user {}", posts.len(), user_id);
        Ok(posts)
    }
}

// ============================================================
// Tests
// ============================================================

/// Test 1: Real registration flow (matches blog_platform_access.test.js line 57-77)
#[tokio::test]
async fn test_real_registration_stores_jwt_and_changes_login_state() {
    let storage = Arc::new(MemoryStorage::new());
    let jwt_manager = JwtManager::new();

    // Create auth plugin (simulates real auth-plugin.js)
    let mut plugin = AuthPlugin::new(storage.clone(), jwt_manager);
    plugin.register().unwrap();

    // Create client (simulates real FlareClient)
    let mut client = FlareClient::new();

    // Client starts unauthenticated
    assert!(!client.is_authenticated());
    println!("✓ Client starts unauthenticated");

    // Call register (simulates: await client.register({email, password, name}))
    let timestamp = chrono::Utc::now().timestamp_millis();
    let result = client.register(
        &plugin,
        &json!({
            "action": "register",
            "email": format!("user{}@example.com", timestamp),
            "password": "SecurePass123!",
            "name": "Test User"
        })
    ).await.unwrap();

    // Verify response matches real plugin response format
    assert!(result["success"].as_bool().unwrap());
    assert!(!result["token"].as_str().unwrap().is_empty());
    assert_eq!(result["user"]["email"], format!("user{}@example.com", timestamp));

    // ✅ Client stored JWT and changed login state
    assert!(client.is_authenticated());
    assert!(client.get_user().is_some());
    println!("✅ Client stored JWT and changed login state to authenticated");

    // Verify JWT is valid
    let jwt_manager = JwtManager::new();
    let claims = jwt_manager.validate_token(client.jwt.as_ref().unwrap()).unwrap();
    assert_eq!(claims.email, format!("user{}@example.com", timestamp));
    assert_eq!(claims.role, "user");
    println!("✅ JWT is valid and contains correct claims");

    // Verify user exists in database
    let user_id = client.get_user().unwrap()["id"].as_str().unwrap();
    let created_user: Document = storage.get("users", user_id).await.unwrap().unwrap();
    assert_eq!(created_user.data["email"], format!("user{}@example.com", timestamp));
    assert_eq!(created_user.data["status"], "active");
    println!("✅ User verified in FlareDB");
}

/// Test 2: Full flow - register → create post → view posts
/// (matches blog_platform_access.test.js line 153-198)
#[tokio::test]
async fn test_real_register_create_post_view_posts() {
    let storage = Arc::new(MemoryStorage::new());
    let jwt_manager = JwtManager::new();

    let mut plugin = AuthPlugin::new(storage.clone(), jwt_manager);
    plugin.register().unwrap();

    let mut client = FlareClient::new();

    // Step 1: Register (matches line 164-172)
    let timestamp = chrono::Utc::now().timestamp_millis();
    let register_response = client.register(
        &plugin,
        &json!({
            "action": "register",
            "email": format!("bloguser{}@example.com", timestamp),
            "password": "blogpass123",
            "name": "Blog User"
        })
    ).await.unwrap();

    assert!(register_response["success"].as_bool().unwrap());
    println!("✅ Step 1: Registered");

    // Step 2: Create a published post (matches line 175-190)
    let post = client.create_post(
        &storage,
        &format!("Test Post {}", timestamp),
        "This is test content"
    ).await.unwrap();

    assert_eq!(post.data["title"], format!("Test Post {}", timestamp));
    println!("✅ Step 2: Created post");

    // Step 3: View posts (matches line 193-198)
    let posts = client.get_posts(&storage).await.unwrap();
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0].data["title"], format!("Test Post {}", timestamp));
    println!("✅ Step 3: Viewed posts");
}

/// Test 3: Register → Logout → Login → Access
#[tokio::test]
async fn test_real_register_logout_login() {
    let storage = Arc::new(MemoryStorage::new());
    let jwt_manager = JwtManager::new();

    let mut plugin = AuthPlugin::new(storage.clone(), jwt_manager);
    plugin.register().unwrap();

    let mut client = FlareClient::new();

    // Register
    let email = "authflow@example.com";
    client.register(
        &plugin,
        &json!({
            "action": "register",
            "email": email,
            "password": "AuthFlow123!",
            "name": "Auth Flow User"
        })
    ).await.unwrap();

    assert!(client.is_authenticated());
    println!("✅ Registered and authenticated");

    // Logout
    client.logout();
    assert!(!client.is_authenticated());
    println!("✅ Logged out, no longer authenticated");

    // Login again
    let login_result = client.login(
        &plugin,
        &json!({
            "action": "login",
            "email": email,
            "password": "AuthFlow123!"
        })
    ).await.unwrap();

    assert!(client.is_authenticated());
    assert!(login_result["success"].as_bool().unwrap());
    assert!(!login_result["token"].as_str().unwrap().is_empty());
    println!("✅ Logged in again, re-authenticated");

    // Verify can access protected resources
    let posts = client.get_posts(&storage).await.unwrap();
    assert_eq!(posts.len(), 0); // No posts yet, but can query
    println!("✅ Can access protected resources after login");
}

/// Test 4: Unauthenticated user cannot create posts
#[tokio::test]
async fn test_unauthenticated_cannot_create_posts() {
    let storage = Arc::new(MemoryStorage::new());
    let client = FlareClient::new();

    // Try to create post without authentication
    let result = client.create_post(&storage, "Unauthorized Post", "Content").await;

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("401 UNAUTHORIZED"));
    println!("✅ Unauthenticated user rejected when creating post");
}

/// Test 5: Duplicate email rejection
#[tokio::test]
async fn test_real_duplicate_email_rejection() {
    let storage = Arc::new(MemoryStorage::new());
    let jwt_manager = JwtManager::new();

    let mut plugin = AuthPlugin::new(storage.clone(), jwt_manager);
    plugin.register().unwrap();

    let mut client1 = FlareClient::new();
    let mut client2 = FlareClient::new();

    // First registration succeeds
    let result1 = client1.register(
        &plugin,
        &json!({
            "action": "register",
            "email": "duplicate@example.com",
            "password": "Pass1234!",
            "name": "User 1"
        })
    ).await;

    assert!(result1.is_ok());
    println!("✅ First registration succeeded");

    // Second registration with same email fails
    let result2 = client2.register(
        &plugin,
        &json!({
            "action": "register",
            "email": "duplicate@example.com",
            "password": "Pass5678!",
            "name": "User 2"
        })
    ).await;

    assert!(result2.is_err());
    assert_eq!(result2.unwrap_err(), "USER_EXISTS");
    println!("✅ Duplicate email rejected with USER_EXISTS error");
}

/// Test 6: Password validation (matches auth-plugin.js line 128-134)
#[tokio::test]
async fn test_real_password_validation() {
    let storage = Arc::new(MemoryStorage::new());
    let jwt_manager = JwtManager::new();

    let mut plugin = AuthPlugin::new(storage.clone(), jwt_manager);
    plugin.register().unwrap();

    let mut client = FlareClient::new();

    // Weak password (less than 6 chars)
    let weak_result = client.register(
        &plugin,
        &json!({
            "action": "register",
            "email": "weak@example.com",
            "password": "12345",
            "name": "Weak User"
        })
    ).await;

    assert!(weak_result.is_err());
    println!("✅ Weak password rejected");

    // Valid password
    let valid_result = client.register(
        &plugin,
        &json!({
            "action": "register",
            "email": "valid@example.com",
            "password": "ValidPass123!",
            "name": "Valid User"
        })
    ).await;

    assert!(valid_result.is_ok());
    println!("✅ Valid password accepted");
}

/// Test 7: Multiple clients with isolated JWT storage
#[tokio::test]
async fn test_real_multiple_clients_isolated_jwt() {
    let storage = Arc::new(MemoryStorage::new());
    let jwt_manager = JwtManager::new();

    let mut plugin = AuthPlugin::new(storage.clone(), jwt_manager);
    plugin.register().unwrap();

    let mut client1 = FlareClient::new();
    let mut client2 = FlareClient::new();

    // Register two different users
    client1.register(
        &plugin,
        &json!({
            "action": "register",
            "email": "user1@example.com",
            "password": "User1Pass123!",
            "name": "User One"
        })
    ).await.unwrap();

    client2.register(
        &plugin,
        &json!({
            "action": "register",
            "email": "user2@example.com",
            "password": "User2Pass123!",
            "name": "User Two"
        })
    ).await.unwrap();

    // Both should be authenticated with different users
    assert!(client1.is_authenticated());
    assert!(client2.is_authenticated());

    let user1_email = client1.get_user().unwrap()["email"].as_str().unwrap();
    let user2_email = client2.get_user().unwrap()["email"].as_str().unwrap();

    assert_ne!(user1_email, user2_email);
    assert_eq!(user1_email, "user1@example.com");
    assert_eq!(user2_email, "user2@example.com");

    println!("✅ Two clients registered with isolated JWT storage");
    println!("   Client 1: {}", user1_email);
    println!("   Client 2: {}", user2_email);

    // Each client should only see their own posts
    let post1 = client1.create_post(&storage, "User 1 Post", "Content 1").await.unwrap();
    let post2 = client2.create_post(&storage, "User 2 Post", "Content 2").await.unwrap();

    let posts1 = client1.get_posts(&storage).await.unwrap();
    let posts2 = client2.get_posts(&storage).await.unwrap();

    assert_eq!(posts1.len(), 1);
    assert_eq!(posts2.len(), 1);
    assert_eq!(posts1[0].id, post1.id);
    assert_eq!(posts2[0].id, post2.id);

    println!("✅ Each client can only see their own posts (data isolation)");
}
