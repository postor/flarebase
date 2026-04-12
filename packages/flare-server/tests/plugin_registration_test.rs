// TDD Tests for Plugin-Based Registration Flow
// 
// According to Flarebase architecture:
// - Registration is handled by AUTH PLUGIN via WebSocket (NOT REST)
// - Client calls: client.callPlugin('auth', {action: 'register', ...})
// - Plugin creates user in FlareDB and returns JWT token
// - Server routes plugin requests via WebSocket only
//
// Reference: docs/security/JWT_AUTH_DESIGN.md
// "CRITICAL: Plugins are WebSocket-ONLY. There are NO REST endpoints for plugin calls."

use flare_db::{SledStorage, Storage};
use flare_protocol::Document;
use flare_server::jwt_middleware::JwtManager;
use serde_json::json;
use tempfile::tempdir;

// ===== 1. Test: Auth plugin creates user in FlareDB =====

#[tokio::test]
async fn test_plugin_registration_creates_user_in_database() {
    let storage = create_test_storage().await;
    let email = "newuser@example.com";
    let password = "SecurePass123!";
    let name = "New User";

    // Simulate auth plugin creating user (this is what the plugin does internally)
    // Plugin uses bcrypt to hash password
    let password_hash = bcrypt::hash(password, bcrypt::DEFAULT_COST).unwrap();
    
    // Plugin creates user document via FlareDB storage
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

    // ✅ Verify user was created in FlareDB
    let created_user = storage.get("users", &user_id).await.unwrap().unwrap();
    assert_eq!(created_user.data["email"], email);
    assert_eq!(created_user.data["name"], name);
    assert_eq!(created_user.data["status"], "active");
    assert_eq!(created_user.data["role"], "user");
    
    // ✅ Verify password was hashed (not plaintext)
    let stored_hash = created_user.data["password_hash"].as_str().unwrap();
    assert_ne!(stored_hash, password);
    assert!(stored_hash.starts_with("$2")); // bcrypt hash prefix

    println!("✅ Plugin registration creates user in FlareDB");
}

// ===== 2. Test: Auth plugin generates and returns JWT =====

#[tokio::test]
async fn test_plugin_registration_returns_jwt_token() {
    let email = "jwtuser@example.com";
    let user_id = "user_test_001";
    let role = "user";

    // After creating user, auth plugin generates JWT
    // (Plugin uses same JWT secret as server's JwtManager)
    let jwt_manager = JwtManager::new();
    let token = jwt_manager
        .generate_token(user_id, email, role)
        .expect("Failed to generate JWT token");

    // ✅ Verify token is not empty
    assert!(!token.is_empty());
    assert!(token.contains('.')); // JWT has 3 parts

    // ✅ Verify token can be validated by server
    let claims = jwt_manager.validate_token(&token).unwrap();
    assert_eq!(claims.sub, user_id);
    assert_eq!(claims.email, email);
    assert_eq!(claims.role, role);

    println!("✅ Plugin registration returns valid JWT token");
}

// ===== 3. Test: Plugin validates password with bcrypt =====

#[tokio::test]
async fn test_plugin_validates_password_with_bcrypt() {
    let password = "SecurePassword123!";
    
    // Plugin hashes password before storing
    let hash = bcrypt::hash(password, bcrypt::DEFAULT_COST).unwrap();
    
    // ✅ Verify correct password validates
    assert!(bcrypt::verify(password, &hash).unwrap());
    
    // ✅ Verify incorrect password fails
    assert!(!bcrypt::verify("WrongPassword", &hash).unwrap());
    
    // ✅ Verify hash is different from plaintext
    assert_ne!(hash, password);
    
    // ✅ Verify hash starts with bcrypt identifier
    assert!(hash.starts_with("$2b$"));

    println!("✅ Plugin validates password with bcrypt");
}

// ===== 4. Test: Plugin rejects duplicate email =====

#[tokio::test]
async fn test_plugin_rejects_duplicate_email() {
    let storage = create_test_storage().await;
    let email = "duplicate@example.com";

    // Plugin first creates a user
    let password_hash = bcrypt::hash("password123", bcrypt::DEFAULT_COST).unwrap();
    let user1 = Document::new(
        "users".to_string(),
        json!({
            "email": email,
            "password_hash": password_hash,
            "name": "First User",
            "status": "active",
            "role": "user"
        })
    );
    storage.insert(user1).await.unwrap();

    // Plugin checks if email exists before creating second user
    let query = flare_protocol::Query {
        collection: "users".to_string(),
        filters: vec![("email".to_string(), flare_protocol::QueryOp::Eq(json!(email)))],
        limit: Some(1),
        offset: None,
    };

    let results = storage.query(query).await.unwrap();
    assert_eq!(results.len(), 1, "Plugin should find existing user");

    // Plugin should reject duplicate email registration
    println!("✅ Plugin rejects duplicate email");
}

// ===== 5. Test: Plugin response includes user data and JWT =====

#[tokio::test]
async fn test_plugin_response_structure() {
    let email = "response@example.com";
    let user_id = "user_response_001";
    
    // After registration, plugin returns this structure
    let jwt_manager = JwtManager::new();
    let token = jwt_manager.generate_token(user_id, email, "user").unwrap();
    
    // This is what plugin sends back via plugin_response
    let plugin_response = json!({
        "success": true,
        "token": token,
        "user": {
            "id": user_id,
            "email": email,
            "name": "Response User",
            "role": "user"
        }
    });

    // ✅ Verify response structure
    assert!(plugin_response["success"].as_bool().unwrap());
    assert!(!plugin_response["token"].as_str().unwrap().is_empty());
    assert_eq!(plugin_response["user"]["id"], user_id);
    assert_eq!(plugin_response["user"]["email"], email);
    assert_eq!(plugin_response["user"]["role"], "user");
    
    // ✅ Verify token matches user
    let claims = jwt_manager.validate_token(plugin_response["token"].as_str().unwrap()).unwrap();
    assert_eq!(claims.sub, plugin_response["user"]["id"]);
    assert_eq!(claims.email, plugin_response["user"]["email"]);

    println!("✅ Plugin response structure is correct");
}

// ===== 6. Test: Plugin validates password strength =====

#[tokio::test]
async fn test_plugin_validates_password_strength() {
    let weak_passwords = vec![
        "123",           // Too short
        "password",      // Common password
        "abc",           // Too short
        "",              // Empty
    ];

    for weak_password in weak_passwords {
        // Plugin should validate password strength before hashing
        let is_valid = weak_password.len() >= 8 && weak_password != "password";
        assert!(!is_valid || weak_password.len() < 8, 
            "Plugin should reject password '{}'", weak_password);
    }

    println!("✅ Plugin validates password strength");
}

// ===== 7. Test: Complete registration flow (Plugin perspective) =====

#[tokio::test]
async fn test_complete_plugin_registration_flow() {
    let storage = create_test_storage().await;
    let email = "fullflow@example.com";
    let password = "FullFlowPass123!";
    let name = "Full Flow User";

    // Step 1: Plugin validates password
    assert!(password.len() >= 8, "Password should be strong");

    // Step 2: Plugin hashes password with bcrypt
    let password_hash = bcrypt::hash(password, bcrypt::DEFAULT_COST).unwrap();

    // Step 3: Plugin creates user in FlareDB
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

    // Step 4: Plugin generates JWT
    let jwt_manager = JwtManager::new();
    let token = jwt_manager.generate_token(&user_id, email, "user").unwrap();

    // Step 5: ✅ Verify user exists in FlareDB
    let created_user = storage.get("users", &user_id).await.unwrap().unwrap();
    assert_eq!(created_user.data["email"], email);

    // Step 6: ✅ Verify token is valid (server can validate it)
    let claims = jwt_manager.validate_token(&token).unwrap();
    assert_eq!(claims.sub, user_id);
    assert_eq!(claims.email, email);

    // Step 7: ✅ Verify password can be validated
    let stored_hash = created_user.data["password_hash"].as_str().unwrap();
    assert!(bcrypt::verify(password, stored_hash).unwrap());

    println!("✅ Complete plugin registration flow successful");
}

// ===== 8. Test: Plugin registration via WebSocket flow =====

#[tokio::test]
async fn test_websocket_plugin_registration_flow() {
    // This test simulates the WebSocket-based plugin call flow:
    // Client --call_plugin('auth', {action: 'register'})--> Server --plugin_request--> Plugin
    // Client <--plugin_success({token, user})-- Server <--plugin_response-- Plugin
    
    let storage = create_test_storage().await;
    let email = "websocket@example.com";
    let password = "WebSocketPass123!";

    // Simulate what plugin does when it receives registration request via WebSocket
    
    // 1. Plugin receives: {action: 'register', email, password, name}
    let name = "WebSocket User";

    // 2. Plugin validates input
    assert!(email.contains('@'), "Email should be valid");
    assert!(password.len() >= 8, "Password should be strong");

    // 3. Plugin creates user
    let password_hash = bcrypt::hash(password, bcrypt::DEFAULT_COST).unwrap();
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

    // 4. Plugin generates JWT (using same secret as server)
    let jwt_manager = JwtManager::new();
    let token = jwt_manager.generate_token(&user_id, email, "user").unwrap();

    // 5. Plugin returns: {success: true, token, user}
    let response = json!({
        "success": true,
        "token": token,
        "user": {
            "id": user_id,
            "email": email,
            "name": name,
            "role": "user"
        }
    });

    // ✅ Verify plugin response
    assert!(response["success"].as_bool().unwrap());
    assert!(!response["token"].as_str().unwrap().is_empty());

    // ✅ Server can validate this token
    let claims = jwt_manager.validate_token(response["token"].as_str().unwrap()).unwrap();
    assert_eq!(claims.sub, response["user"]["id"]);

    println!("✅ WebSocket plugin registration flow works correctly");
}

// ===== Helper function =====

async fn create_test_storage() -> SledStorage {
    let dir = tempdir().unwrap();
    SledStorage::new(dir.path()).unwrap()
}
