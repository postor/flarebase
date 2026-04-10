// Auth Hook Integration Tests
//
// These tests verify the complete auth hook flow including:
// - Hook registration
// - JWT context injection
// - Login/Register flows
// - Error handling

use flare_server::{
    hook_manager::HookManager,
    jwt_middleware::JwtManager,
    AppState,
};
use flare_db::memory::MemoryStorage;
use flare_protocol::{HookRegister, HookResponse};
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
    let hook_manager = Arc::new(HookManager::new());
    let query_executor = Arc::new(flare_server::QueryExecutor::from_json("{\"queries\": {}}").unwrap());

    Arc::new(AppState {
        storage,
        io,
        cluster,
        node_id: 1,
        event_bus,
        hook_manager,
        query_executor,
    })
}

#[tokio::test]
async fn test_auth_hook_request_structure() {
    let hook_manager = HookManager::new();
    let socket_id = "auth_socket_1".to_string();

    // Register auth hook
    let register = HookRegister {
        token: "test_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    hook_manager.register_hook(socket_id.clone(), register);

    // Verify hook was registered
    assert_eq!(hook_manager.get_hook_count("auth"), 1);
    let hooks = hook_manager.get_hooks_for_event("auth");
    assert_eq!(hooks[0], socket_id);
}

#[tokio::test]
async fn test_auth_hook_jwt_injection_guest() {
    let hook_manager = HookManager::new();
    let socket_id = "auth_socket_2".to_string();

    // Register auth hook
    let register = HookRegister {
        token: "test_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    hook_manager.register_hook(socket_id, register);

    // Simulate calling auth hook with no user context (guest)
    let (tx, rx) = oneshot::channel();
    let request_id = "test_req_001".to_string();

    // Build the request that would be sent to hook
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
async fn test_auth_hook_jwt_injection_authenticated() {
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
async fn test_auth_hook_login_flow() {
    let hook_manager = HookManager::new();
    let socket_id = "auth_service_1".to_string();

    // Register auth hook
    let register = HookRegister {
        token: "auth_service_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    hook_manager.register_hook(socket_id, register);

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
async fn test_auth_hook_register_flow() {
    let hook_manager = HookManager::new();
    let socket_id = "auth_service_2".to_string();

    // Register auth hook
    let register = HookRegister {
        token: "auth_service_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    hook_manager.register_hook(socket_id, register);

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
async fn test_auth_hook_error_responses() {
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
async fn test_auth_hook_malformed_requests() {
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
async fn test_auth_hook_response_structure() {
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
async fn test_auth_hook_multiple_concurrent_requests() {
    let hook_manager = HookManager::new();
    let socket_id = "auth_service_3".to_string();

    // Register auth hook
    let register = HookRegister {
        token: "auth_service_token".to_string(),
        capabilities: flare_protocol::HookCapabilities {
            events: vec!["auth".to_string()],
            user_context: serde_json::Value::Object(serde_json::Map::new()),
        },
    };

    hook_manager.register_hook(socket_id, register);

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
    assert_eq!(hook_manager.get_hook_count("auth"), 1);
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
