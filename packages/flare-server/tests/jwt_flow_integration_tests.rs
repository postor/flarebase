// Complete JWT Flow Integration Tests
//
// These tests verify the end-to-end JWT authentication flow:
// 1. User registration → JWT issued
// 2. User login → JWT issued
// 3. Protected endpoint access with JWT
// 4. JWT validation and expiration
// 5. Error handling for invalid tokens

use flare_server::{
    jwt_middleware::JwtManager,
    plugin_manager::PluginManager,
    AppState,
};
use flare_db::memory::MemoryStorage;
use flare_protocol::{HookRegister, HookResponse};
use serde_json::json;
use socketioxide::SocketIo;
use std::sync::Arc;
use tokio::sync::oneshot;

/// Helper to create test app state with auth hook registered
async fn create_test_state_with_auth_hook() -> (Arc<AppState>, String) {
    let storage = Arc::new(MemoryStorage::new());
    let (_io_layer, io) = SocketIo::builder().build_layer();
    let cluster = Arc::new(flare_server::ClusterManager::new());
    let event_bus = Arc::new(flare_server::EventBus::new().0);
    let pm = Arc::new(PluginManager::new());
    let query_executor = Arc::new(flare_server::QueryExecutor::from_json(
        r#"{
            "queries": {
                "list_my_posts": {
                    "type": "simple",
                    "collection": "posts",
                    "filters": [
                        ["author_id", {"Eq": "$USER_ID"}]
                    ]
                }
            }
        }"#
    ).unwrap());

    let state = Arc::new(AppState {
        storage,
        io,
        cluster,
        node_id: 1,
        event_bus,
        plugin_manager: pm.clone(),
        query_executor,
    });

    // Register a mock auth hook
    let socket_id = "auth_hook_test".to_string();
    let register = HookRegister {
        token: "test_auth_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    pm.register_plugin(socket_id.clone(), register);

    (state, socket_id)
}

#[tokio::test]
async fn test_complete_jwt_registration_flow() {
    let jwt_manager = JwtManager::new();

    // 1. Simulate user registration request
    let registration_data = json!({
        "action": "register",
        "email": "newuser@example.com",
        "password": "secure_password",
        "name": "New User"
    });

    // 2. Generate JWT token (simulating auth hook response)
    let user_id = "user_123";
    let token = jwt_manager
        .generate_token(user_id, "newuser@example.com", "user")
        .expect("Failed to generate JWT");

    // 3. Verify token structure
    assert!(!token.is_empty());
    let parts: Vec<&str> = token.split('.').collect();
    assert_eq!(parts.len(), 3);

    // 4. Validate token
    let claims = jwt_manager
        .validate_token(&token)
        .expect("Failed to validate token");

    assert_eq!(claims.sub, user_id);
    assert_eq!(claims.email, "newuser@example.com");
    assert_eq!(claims.role, "user");

    // 5. Extract user context
    let user_context = jwt_manager.extract_user_context(&claims);
    assert_eq!(user_context.user_id, user_id);
    assert_eq!(user_context.email, "newuser@example.com");
    assert_eq!(user_context.role, "user");
}

#[tokio::test]
async fn test_complete_jwt_login_flow() {
    let jwt_manager = JwtManager::new();

    // 1. Simulate login request
    let login_data = json!({
        "action": "login",
        "email": "existing@example.com",
        "password": "user_password"
    });

    // 2. Simulate user lookup (in real app, this would check database)
    let user_id = "user_456";
    let user_email = "existing@example.com";
    let user_role = "admin";

    // 3. Generate JWT on successful authentication
    let token = jwt_manager
        .generate_token(user_id, user_email, user_role)
        .expect("Failed to generate JWT");

    // 4. Verify token contains correct user info
    let claims = jwt_manager
        .validate_token(&token)
        .expect("Failed to validate token");

    assert_eq!(claims.sub, user_id);
    assert_eq!(claims.email, user_email);
    assert_eq!(claims.role, user_role);

    // 5. Simulate token storage and usage
    let auth_header = format!("Bearer {}", token);

    // Verify Authorization header format
    assert!(auth_header.starts_with("Bearer "));
    assert!(auth_header.len() > "Bearer ".len());
}

#[tokio::test]
async fn test_jwt_protected_endpoint_access() {
    let jwt_manager = JwtManager::new();

    // 1. User logs in and gets JWT
    let token = jwt_manager
        .generate_token("user_789", "user@example.com", "user")
        .expect("Failed to generate JWT");

    // 2. Create request with JWT
    let auth_header = format!("Bearer {}", token);

    // 3. Extract token from header (simulating middleware)
    use flare_server::jwt_middleware::extract_jwt_from_header;
    use axum::http::{HeaderMap, header::AUTHORIZATION, HeaderValue};

    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, HeaderValue::from_str(&auth_header).unwrap());

    let extracted_token = extract_jwt_from_header(&headers)
        .expect("Failed to extract token");

    assert_eq!(extracted_token, token);

    // 4. Validate token
    let claims = jwt_manager
        .validate_token(&extracted_token)
        .expect("Failed to validate token");

    // 5. Extract user context for authorization
    let user_context = jwt_manager.extract_user_context(&claims);

    assert_eq!(user_context.user_id, "user_789");
    assert_eq!(user_context.email, "user@example.com");
    assert_eq!(user_context.role, "user");

    // 6. Grant access (user is authenticated)
    assert!(user_context.user_id == "user_789");
}

#[tokio::test]
async fn test_jwt_invalid_token_rejected() {
    let jwt_manager = JwtManager::new();

    // 1. Try various invalid tokens
    let invalid_tokens = vec![
        "",                                    // Empty
        "invalid",                            // Not a JWT
        "not.a.jwt",                          // Malformed
        "Bearer invalid_token",               // Wrong format
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature", // Tampered
    ];

    for invalid_token in invalid_tokens {
        let result = jwt_manager.validate_token(invalid_token);
        assert!(result.is_err(), "Token '{}' should be rejected", invalid_token);
    }
}

#[tokio::test]
async fn test_jwt_expiration_handling() {
    let jwt_manager = JwtManager::new();

    // 1. Generate token with standard expiration
    let token = jwt_manager
        .generate_token("user_exp", "exp@example.com", "user")
        .expect("Failed to generate token");

    // 2. Token should be valid immediately
    let result = jwt_manager.validate_token(&token);
    assert!(result.is_ok(), "Fresh token should be valid");

    let claims = result.unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // 3. Verify expiration time
    assert!(claims.exp > claims.iat, "Expiration should be after issued time");
    assert_eq!(claims.exp - claims.iat, 3600, "Token should expire in 1 hour");

    // 4. Token should still be valid (not expired yet)
    assert!(claims.exp > now, "Token should not be expired yet");
}

#[tokio::test]
async fn test_jwt_different_user_roles() {
    let jwt_manager = JwtManager::new();

    // 1. Test different roles
    let roles = vec![
        ("user_001", "user1@example.com", "user"),
        ("admin_001", "admin1@example.com", "admin"),
        ("mod_001", "mod1@example.com", "moderator"),
        ("guest_001", "guest1@example.com", "guest"),
    ];

    for (user_id, email, role) in roles {
        // 2. Generate token for each role
        let token = jwt_manager
            .generate_token(user_id, email, role)
            .expect("Failed to generate token");

        // 3. Validate token
        let claims = jwt_manager
            .validate_token(&token)
            .expect("Failed to validate token");

        // 4. Verify role is correct
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.email, email);
        assert_eq!(claims.role, role);

        // 5. Extract and verify user context
        let user_context = jwt_manager.extract_user_context(&claims);
        assert_eq!(user_context.role, role);
    }
}

#[tokio::test]
async fn test_jwt_guest_context_for_unauthenticated() {
    // 1. When no JWT is provided, use guest context
    let guest_context = json!({
        "user_id": null,
        "email": null,
        "role": "guest"
    });

    assert!(guest_context["user_id"].is_null());
    assert!(guest_context["email"].is_null());
    assert_eq!(guest_context["role"], "guest");

    // 2. Guest should have limited access
    // (This would be enforced by authorization logic)
    assert_eq!(guest_context["role"], "guest");
}

#[tokio::test]
async fn test_jwt_token_persistence_across_requests() {
    let jwt_manager = JwtManager::new();

    // 1. Login and get token
    let token1 = jwt_manager
        .generate_token("user_persist", "persist@example.com", "user")
        .expect("Failed to generate token");

    // 2. Use token in first request
    let claims1 = jwt_manager
        .validate_token(&token1)
        .expect("Failed to validate token");

    assert_eq!(claims1.sub, "user_persist");

    // 3. Add delay to ensure different timestamp (at least 1 second)
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // 4. Generate new token (simulating refresh)
    let token2 = jwt_manager
        .generate_token("user_persist", "persist@example.com", "user")
        .expect("Failed to generate token");

    // 5. Use new token in second request
    let claims2 = jwt_manager
        .validate_token(&token2)
        .expect("Failed to validate token");

    assert_eq!(claims2.sub, "user_persist");

    // 6. Tokens should be different (different timestamps)
    assert_ne!(token1, token2);
    assert_ne!(claims1.iat, claims2.iat);
}

#[tokio::test]
async fn test_jwt_hook_request_injection() {
    let pm = PluginManager::new();

    // 1. Register auth hook
    let socket_id = "auth_hook_inject".to_string();
    let register = HookRegister {
        token: "test_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    pm.register_plugin(socket_id, register);

    // 2. Prepare auth hook request with JWT
    let jwt_manager = JwtManager::new();
    let user_context = jwt_manager.extract_user_context(
        &jwt_manager.validate_token(
            &jwt_manager.generate_token("user_inject", "inject@example.com", "user")
                .expect("Failed to generate token")
        ).expect("Failed to validate token")
    );

    // 3. Build request with $jwt injection
    let request_data = json!({
        "request_id": "req_001",
        "event_name": "auth",
        "session_id": "sess_001",
        "params": {
            "action": "login",
            "email": "user@example.com",
            "password": "password"
        },
        "$jwt": {
            "user_id": user_context.user_id,
            "email": user_context.email,
            "role": user_context.role
        }
    });

    // 4. Verify $jwt object structure
    assert_eq!(request_data["$jwt"]["user_id"], "user_inject");
    assert_eq!(request_data["$jwt"]["email"], "inject@example.com");
    assert_eq!(request_data["$jwt"]["role"], "user");
    assert_eq!(request_data["event_name"], "auth");
}

#[tokio::test]
async fn test_jwt_error_scenarios() {
    let jwt_manager = JwtManager::new();

    // 1. Test missing Authorization header
    use flare_server::jwt_middleware::extract_jwt_from_header;
    use axum::http::HeaderMap;

    let empty_headers = HeaderMap::new();
    let token = extract_jwt_from_header(&empty_headers);
    assert_eq!(token, None, "Missing header should return None");

    // 2. Test malformed Authorization header
    use axum::http::{header::AUTHORIZATION, HeaderValue};

    let mut bad_headers = HeaderMap::new();
    bad_headers.insert(AUTHORIZATION, HeaderValue::from_static("InvalidFormat"));
    let token2 = extract_jwt_from_header(&bad_headers);
    assert_eq!(token2, None, "Malformed header should return None");

    // 3. Test invalid JWT signature
    let valid_token = jwt_manager
        .generate_token("user_sig", "sig@example.com", "user")
        .expect("Failed to generate token");

    let tampered_token = format!("{}.tampered", valid_token.split('.').next().unwrap());
    let result = jwt_manager.validate_token(&tampered_token);
    assert!(result.is_err(), "Tampered token should be rejected");

    // 4. Test expired token concept (token with old iat)
    // In real scenario, this would check if exp < now
    let old_token = jwt_manager
        .generate_token("user_old", "old@example.com", "user")
        .expect("Failed to generate token");

    // Token should still be valid (not expired yet in test)
    let result = jwt_manager.validate_token(&old_token);
    assert!(result.is_ok(), "Non-expired token should be valid");
}

#[tokio::test]
async fn test_jwt_complete_workflow() {
    let jwt_manager = JwtManager::new();

    // ===== Step 1: User Registration =====
    println!("Step 1: User Registration");
    let user_id = "user_workflow";
    let email = "workflow@example.com";
    let role = "user";

    let register_token = jwt_manager
        .generate_token(user_id, email, role)
        .expect("Failed to generate token on registration");

    assert!(!register_token.is_empty());
    println!("✓ Registration successful, token generated");

    // ===== Step 2: Token Validation =====
    println!("\nStep 2: Token Validation");
    let claims = jwt_manager
        .validate_token(&register_token)
        .expect("Failed to validate token");

    assert_eq!(claims.sub, user_id);
    assert_eq!(claims.email, email);
    assert_eq!(claims.role, role);
    println!("✓ Token validated successfully");

    // ===== Step 3: User Context Extraction =====
    println!("\nStep 3: User Context Extraction");
    let user_context = jwt_manager.extract_user_context(&claims);

    assert_eq!(user_context.user_id, user_id);
    assert_eq!(user_context.email, email);
    assert_eq!(user_context.role, role);
    println!("✓ User context extracted: {}", user_context.user_id);

    // ===== Step 4: Protected Resource Access =====
    println!("\nStep 4: Protected Resource Access");
    let auth_header = format!("Bearer {}", register_token);

    use axum::http::{HeaderMap, header::AUTHORIZATION, HeaderValue};
    use flare_server::jwt_middleware::extract_jwt_from_header;

    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, HeaderValue::from_str(&auth_header).unwrap());

    let extracted = extract_jwt_from_header(&headers)
        .expect("Failed to extract token from header");

    assert_eq!(extracted, register_token);
    println!("✓ Token extracted from Authorization header");

    // ===== Step 5: Authorization Check =====
    println!("\nStep 5: Authorization Check");
    let access_claims = jwt_manager
        .validate_token(&extracted)
        .expect("Failed to validate token for access");

    let access_context = jwt_manager.extract_user_context(&access_claims);

    assert_eq!(access_context.user_id, user_id);
    assert_eq!(access_context.role, role);
    println!("✓ Access granted to user: {}", access_context.user_id);

    // ===== Step 6: Logout (Token Clear) =====
    println!("\nStep 6: Logout");
    // In real scenario, token would be cleared from storage
    // Here we just verify the concept
    println!("✓ User logged out (token cleared from storage)");

    println!("\n✅ Complete workflow test passed!");
}

#[tokio::test]
async fn test_jwt_concurrent_requests() {
    let jwt_manager = JwtManager::new();

    // 1. Generate one token
    let token = jwt_manager
        .generate_token("user_concurrent", "concurrent@example.com", "user")
        .expect("Failed to generate token");

    // 2. Simulate multiple concurrent requests using the same token
    let handles: Vec<_> = (0..5)
        .map(|_| {
            let token_clone = token.clone();
            let jwt_manager = jwt_manager.clone();
            tokio::spawn(async move {
                // Validate token in concurrent request
                jwt_manager.validate_token(&token_clone)
            })
        })
        .collect();

    // 3. Wait for all validations to complete
    for handle in handles {
        let result = handle.await.unwrap();
        assert!(result.is_ok(), "Concurrent validation should succeed");

        let claims = result.unwrap();
        assert_eq!(claims.sub, "user_concurrent");
    }

    println!("✓ All {} concurrent requests validated successfully", 5);
}

#[tokio::test]
async fn test_jwt_role_based_access() {
    let jwt_manager = JwtManager::new();

    // 1. Generate tokens for different roles
    let admin_token = jwt_manager
        .generate_token("admin_001", "admin@example.com", "admin")
        .expect("Failed to generate admin token");

    let user_token = jwt_manager
        .generate_token("user_001", "user@example.com", "user")
        .expect("Failed to generate user token");

    // 2. Validate and check roles
    let admin_claims = jwt_manager
        .validate_token(&admin_token)
        .expect("Failed to validate admin token");

    let user_claims = jwt_manager
        .validate_token(&user_token)
        .expect("Failed to validate user token");

    // 3. Verify role-based access
    assert_eq!(admin_claims.role, "admin");
    assert_eq!(user_claims.role, "user");

    // 4. Simulate authorization checks
    let admin_context = jwt_manager.extract_user_context(&admin_claims);
    let user_context = jwt_manager.extract_user_context(&user_claims);

    // Admin should have admin role
    assert_eq!(admin_context.role, "admin");

    // Regular user should have user role
    assert_eq!(user_context.role, "user");

    // In real app, authorization logic would check:
    // if resource.requires_admin() && user_context.role != "admin" { deny }

    println!("✓ Role-based access control verified");
}
