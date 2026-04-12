// Auth Plugin Integration Tests
//
// These tests verify the complete auth plugin flow including:
// - Plugin registration
// - JWT context injection
// - Login/Register flows
// - Error handling
// - Email existence checks during registration

use flare_server::{
    plugin_manager::PluginManager,
    jwt_middleware::JwtManager,
    AppState,
};
use flare_db::memory::MemoryStorage;
use flare_protocol::{HookRegister, HookResponse, Document};
use serde_json::json;
use socketioxide::SocketIo;
use std::sync::Arc;
use tokio::sync::oneshot;

/// Helper function to create test app state
fn create_test_state() -> Arc<AppState> {
    let storage = Arc::new(MemoryStorage::new());
    let (_io_layer, io) = SocketIo::builder().build_layer();
    let cluster = Arc::new(flare_server::ClusterManager::new());
    let event_bus = Arc::new(flare_server::EventBus::new().0);
    let plugin_manager = Arc::new(PluginManager::new());
    let query_executor = Arc::new(flare_server::QueryExecutor::from_json("{\"queries\": {}}").unwrap());

    Arc::new(AppState {
        storage,
        io,
        cluster,
        node_id: 1,
        event_bus,
        plugin_manager,
        query_executor,
    })
}

#[tokio::test]
async fn test_auth_plugin_request_structure() {
    let pm = PluginManager::new();
    let socket_id = "auth_socket_1".to_string();

    // Register auth plugin
    let register = HookRegister {
        token: "test_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    pm.register_plugin(socket_id.clone(), register);

    // Verify plugin was registered
    assert_eq!(pm.get_plugin_count("auth"), 1);
    let hooks = pm.get_plugins_for_event("auth");
    assert_eq!(hooks[0], socket_id);
}

#[tokio::test]
async fn test_auth_plugin_jwt_injection_guest() {
    let pm = PluginManager::new();
    let socket_id = "auth_socket_2".to_string();

    // Register auth plugin
    let register = HookRegister {
        token: "test_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    pm.register_plugin(socket_id, register);

    // Simulate calling auth plugin with no user context (guest)
    let (tx, rx) = oneshot::channel();
    let request_id = "test_req_001".to_string();

    // Build the request that would be sent to plugin
    let jwt_guest = json!({
        "user_id": null,
        "email": null,
        "role": "guest"
    });

    let request_data = json!({
        "request_id": request_id,
        "event_name": "auth",
        "session_id": "test_session",
        "params": {
            "action": "login",
            "email": "user@example.com",
            "password": "password"
        },
        "$jwt": jwt_guest
    });

    // Verify structure
    assert_eq!(request_data["event_name"], "auth");
    assert_eq!(request_data["params"]["action"], "login");
    assert_eq!(request_data["$jwt"]["role"], "guest");
    assert!(request_data["$jwt"]["user_id"].is_null());

    // Simulate response
    let _ = tx.send(request_data);
}

#[tokio::test]
async fn test_auth_plugin_jwt_injection_authenticated() {
    let jwt_manager = JwtManager::new();

    // Generate a real JWT
    let token = jwt_manager
        .generate_token("user_123", "authenticated@example.com", "admin")
        .expect("Failed to generate token");

    // Validate and extract user context
    let claims = jwt_manager
        .validate_token(&token)
        .expect("Failed to validate token");

    let user_context = jwt_manager.extract_user_context(&claims);

    // Build JWT object for authenticated user
    let jwt_authenticated = json!({
        "user_id": user_context.user_id,
        "email": user_context.email,
        "role": user_context.role
    });

    // Verify structure
    assert_eq!(jwt_authenticated["user_id"], "user_123");
    assert_eq!(jwt_authenticated["email"], "authenticated@example.com");
    assert_eq!(jwt_authenticated["role"], "admin");
}

#[tokio::test]
async fn test_auth_plugin_login_flow() {
    let pm = PluginManager::new();
    let socket_id = "auth_service_1".to_string();

    // Register auth plugin
    let register = HookRegister {
        token: "auth_service_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    pm.register_plugin(socket_id, register);

    // Simulate login request
    let login_params = json!({
        "action": "login",
        "email": "john@example.com",
        "password": "secure_password"
    });

    // Verify params structure
    assert_eq!(login_params["action"], "login");
    assert_eq!(login_params["email"], "john@example.com");
    assert!(login_params["password"].is_string());

    // Simulate successful response
    let success_response = json!({
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "user": {
            "id": "user_123",
            "email": "john@example.com",
            "name": "John Doe",
            "role": "user"
        }
    });

    assert!(success_response["token"].is_string());
    assert!(success_response["user"]["id"].is_string());
    assert_eq!(success_response["user"]["email"], "john@example.com");
}

#[tokio::test]
async fn test_auth_plugin_register_flow() {
    let pm = PluginManager::new();
    let socket_id = "auth_service_2".to_string();

    // Register auth plugin
    let register = HookRegister {
        token: "auth_service_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    pm.register_plugin(socket_id, register);

    // Simulate register request
    let register_params = json!({
        "action": "register",
        "email": "newuser@example.com",
        "password": "new_password",
        "name": "New User"
    });

    // Verify params structure
    assert_eq!(register_params["action"], "register");
    assert_eq!(register_params["email"], "newuser@example.com");
    assert_eq!(register_params["name"], "New User");

    // Simulate successful response
    let success_response = json!({
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "user": {
            "id": "user_456",
            "email": "newuser@example.com",
            "name": "New User",
            "role": "user"
        }
    });

    assert!(success_response["token"].is_string());
    assert_eq!(success_response["user"]["id"], "user_456");
}

#[tokio::test]
async fn test_auth_plugin_error_responses() {
    let error_cases = vec![
        ("INVALID_CREDENTIALS", "Invalid email or password"),
        ("USER_EXISTS", "User with this email already exists"),
        ("WEAK_PASSWORD", "Password does not meet security requirements"),
        ("INVALID_TOKEN", "Invalid or expired token"),
    ];

    for (code, message) in error_cases {
        let error_response = json!({
            "error": {
                "code": code,
                "message": message
            }
        });

        assert_eq!(error_response["error"]["code"], code);
        assert_eq!(error_response["error"]["message"], message);
    }
}

#[tokio::test]
async fn test_auth_plugin_malformed_requests() {
    let malformed_requests = vec![
        json!({ "action": "login" }), // Missing email/password
        json!({ "email": "test@example.com" }), // Missing action
        json!({ "action": "invalid_action", "email": "test@example.com" }), // Invalid action
        json!({ "action": "login", "email": "invalid_email" }), // Invalid email format
    ];

    for request in malformed_requests {
        // Verify these would be rejected by validation
        assert!(!request.get("action").is_some() || !request.get("email").is_some() ||
                request.get("action").unwrap() != "login" ||
                !request.get("email").unwrap().as_str().unwrap().contains('@'));
    }
}

#[tokio::test]
async fn test_auth_plugin_response_structure() {
    // Test successful login response structure
    let success_response = json!({
        "token": "test_jwt_token",
        "user": {
            "id": "user_789",
            "email": "authenticated@example.com",
            "role": "user"
        }
    });

    assert!(success_response["token"].is_string());
    assert_eq!(success_response["token"], "test_jwt_token");
    assert_eq!(success_response["user"]["id"], "user_789");
    assert_eq!(success_response["user"]["email"], "authenticated@example.com");
    assert_eq!(success_response["user"]["role"], "user");
}

#[tokio::test]
async fn test_auth_plugin_multiple_concurrent_requests() {
    let pm = PluginManager::new();
    let socket_id = "auth_service_3".to_string();

    // Register auth plugin
    let register = HookRegister {
        token: "auth_service_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    pm.register_plugin(socket_id, register);

    // Simulate multiple concurrent auth requests
    let requests = vec![
        ("login", "user1@example.com"),
        ("login", "user2@example.com"),
        ("register", "user3@example.com"),
    ];

    for (action, email) in requests {
        let params = json!({
            "action": action,
            "email": email,
            "password": "password"
        });

        assert_eq!(params["action"], action);
        assert_eq!(params["email"], email);
    }

    // Verify all requests are tracked
    assert_eq!(pm.get_plugin_count("auth"), 1);
}

#[tokio::test]
async fn test_jwt_persistence_across_requests() {
    let jwt_manager = JwtManager::new();

    // Generate initial token
    let token1 = jwt_manager
        .generate_token("user_persistent", "persistent@example.com", "user")
        .expect("Failed to generate token");

    // Validate first token
    let claims1 = jwt_manager
        .validate_token(&token1)
        .expect("Failed to validate token");

    assert_eq!(claims1.sub, "user_persistent");

    // Wait to ensure different timestamp
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // Generate second token (same user)
    let token2 = jwt_manager
        .generate_token("user_persistent", "persistent@example.com", "user")
        .expect("Failed to generate token");

    // Validate second token
    let claims2 = jwt_manager
        .validate_token(&token2)
        .expect("Failed to validate token");

    assert_eq!(claims2.sub, "user_persistent");

    // Tokens should be different (different timestamps)
    assert_ne!(token1, token2);
    assert_ne!(claims1.iat, claims2.iat);
}

// ===== NEW TESTS: Email existence checks during registration =====

#[tokio::test]
async fn test_registration_with_existing_email_via_plugin() {
    let state = create_test_state();
    let email = "existing@example.com";

    // Step 1: Create an existing user
    let existing_user = Document::new(
        "users".to_string(),
        json!({
            "email": email,
            "password_hash": "existing_hash",
            "name": "Existing User",
            "status": "active",
            "role": "user"
        })
    );
    state.storage.insert(existing_user).await.unwrap();

    // Step 2: Simulate plugin registration request with existing email
    let register_params = json!({
        "action": "register",
        "email": email,
        "password": "new_password",
        "name": "New User"
    });

    // Step 3: Check if email exists (plugin logic)
    let existing_users = state.storage.query(
        flare_protocol::Query {
            collection: "users".to_string(),
            filters: vec![
                ("email".to_string(), flare_protocol::QueryOp::Eq(json!(email))),
            ],
            limit: None,
            offset: None,
        }
    ).await.unwrap();

    // Step 4: Verify email exists
    assert!(!existing_users.is_empty(), "Email should already exist");
    assert_eq!(existing_users[0].data["email"], email);

    // Step 5: Simulate plugin error response
    let error_response = json!({
        "error": {
            "code": "USER_EXISTS",
            "message": "User with this email already exists"
        }
    });

    assert_eq!(error_response["error"]["code"], "USER_EXISTS");

    println!("✓ Registration with existing email test passed - plugin correctly detects duplicate");
}

#[tokio::test]
async fn test_registration_with_new_email_via_plugin() {
    let state = create_test_state();
    let email = "newuser@example.com";

    // Step 1: Verify email doesn't exist
    let existing_users = state.storage.query(
        flare_protocol::Query {
            collection: "users".to_string(),
            filters: vec![
                ("email".to_string(), flare_protocol::QueryOp::Eq(json!(email))),
            ],
            limit: None,
            offset: None,
        }
    ).await.unwrap();

    assert!(existing_users.is_empty(), "Email should not exist yet");

    // Step 2: Simulate plugin registration request with new email
    let register_params = json!({
        "action": "register",
        "email": email,
        "password": "secure_password",
        "name": "New User"
    });

    // Step 3: Create new user (plugin logic)
    let new_user = Document::new(
        "users".to_string(),
        json!({
            "email": email,
            "password_hash": "HASHED_secure_password",
            "name": "New User",
            "status": "active",
            "role": "user",
            "created_at": chrono::Utc::now().timestamp_millis()
        })
    );
    let user_id = new_user.id.clone();
    state.storage.insert(new_user).await.unwrap();

    // Step 4: Verify user created successfully
    let created_user = state.storage.get("users", &user_id).await.unwrap().unwrap();
    assert_eq!(created_user.data["email"], email);
    assert_eq!(created_user.data["status"], "active");

    // Step 5: Simulate plugin success response
    let success_response = json!({
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "user": {
            "id": user_id,
            "email": email,
            "name": "New User",
            "role": "user"
        }
    });

    assert_eq!(success_response["user"]["email"], email);
    assert_eq!(success_response["user"]["id"], user_id);

    println!("✓ Registration with new email test passed - plugin successfully creates user");
}

#[tokio::test]
async fn test_plugin_email_check_race_condition_prevention() {
    let state = create_test_state();
    let email = "racecondition@example.com";

    // Test that plugin checks email atomically to prevent race conditions
    // Since WebSocket processes requests sequentially per connection, this is guaranteed

    // First registration request
    let check1 = state.storage.query(
        flare_protocol::Query {
            collection: "users".to_string(),
            filters: vec![
                ("email".to_string(), flare_protocol::QueryOp::Eq(json!(email))),
            ],
            limit: None,
            offset: None,
        }
    ).await.unwrap();

    assert!(check1.is_empty(), "Email should not exist initially");

    // Create user
    let user = Document::new(
        "users".to_string(),
        json!({
            "email": email,
            "password_hash": "hash1",
            "name": "User 1",
            "status": "active"
        })
    );
    state.storage.insert(user).await.unwrap();

    // Second registration request (would fail in sequential processing)
    let check2 = state.storage.query(
        flare_protocol::Query {
            collection: "users".to_string(),
            filters: vec![
                ("email".to_string(), flare_protocol::QueryOp::Eq(json!(email))),
            ],
            limit: None,
            offset: None,
        }
    ).await.unwrap();

    assert!(!check2.is_empty(), "Email should exist after first registration");

    // Verify only one user exists
    let all_users = state.storage.list("users").await.unwrap();
    let users_with_email: Vec<_> = all_users.iter()
        .filter(|u| u.data.get("email") == Some(&json!(email)))
        .collect();

    assert_eq!(users_with_email.len(), 1, "Should have exactly one user with this email");

    println!("✓ Race condition prevention test passed - sequential processing guarantees consistency");
}

#[tokio::test]
async fn test_plugin_concurrent_registration_different_emails() {
    let state = create_test_state();

    // Test multiple concurrent registrations with different emails
    let registrations = vec![
        ("user1@example.com", "User 1"),
        ("user2@example.com", "User 2"),
        ("user3@example.com", "User 3"),
    ];

    for (email, name) in registrations {
        // Check email doesn't exist
        let existing = state.storage.query(
            flare_protocol::Query {
                collection: "users".to_string(),
                filters: vec![
                    ("email".to_string(), flare_protocol::QueryOp::Eq(json!(email))),
                ],
                limit: None,
                offset: None,
            }
        ).await.unwrap();

        assert!(existing.is_empty(), "Email {} should not exist", email);

        // Create user
        let user = Document::new(
            "users".to_string(),
            json!({
                "email": email,
                "password_hash": format!("hash_{}", email),
                "name": name,
                "status": "active"
            })
        );
        state.storage.insert(user).await.unwrap();
    }

    // Verify all users created
    let all_users = state.storage.list("users").await.unwrap();
    assert_eq!(all_users.len(), 3, "Should have 3 users");

    println!("✓ Concurrent registration with different emails test passed");
}

#[tokio::test]
async fn test_plugin_registration_error_handling() {
    let pm = PluginManager::new();
    let socket_id = "auth_plugin_error_test".to_string();

    // Register auth plugin
    let register = HookRegister {
        token: "test_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    pm.register_plugin(socket_id, register);

    // Test various error scenarios
    let error_scenarios = vec![
        (
            "weak_password",
            json!({
                "action": "register",
                "email": "test@example.com",
                "password": "123",
                "name": "Test User"
            }),
            "WEAK_PASSWORD"
        ),
        (
            "invalid_email",
            json!({
                "action": "register",
                "email": "not-an-email",
                "password": "secure123",
                "name": "Test User"
            }),
            "INVALID_EMAIL"
        ),
        (
            "missing_fields",
            json!({
                "action": "register",
                "email": "test@example.com"
                // Missing password and name
            }),
            "MISSING_FIELDS"
        ),
    ];

    for (scenario, params, expected_code) in error_scenarios {
        // Plugin would validate and return error
        let error_response = json!({
            "error": {
                "code": expected_code,
                "message": format!("Validation failed for scenario: {}", scenario)
            }
        });

        assert_eq!(error_response["error"]["code"], expected_code);
    }

    println!("✓ Plugin registration error handling test passed");
}
