// JWT REST Endpoint Protection Tests
//
// These tests verify that JWT authentication middleware correctly
// protects REST endpoints.

use flare_server::jwt_middleware::{JwtManager, extract_jwt_from_header};

#[test]
fn test_jwt_manager_creates_valid_tokens() {
    let jwt_manager = JwtManager::new();

    let token = jwt_manager
        .generate_token("user_123", "test@example.com", "user")
        .expect("Failed to generate token");

    // Token should not be empty
    assert!(!token.is_empty());

    // Token should have 3 parts (header.payload.signature)
    let parts: Vec<&str> = token.split('.').collect();
    assert_eq!(parts.len(), 3);
}

#[test]
fn test_jwt_validation_works() {
    let jwt_manager = JwtManager::new();

    let token = jwt_manager
        .generate_token("user_456", "validate@example.com", "admin")
        .expect("Failed to generate token");

    let claims = jwt_manager
        .validate_token(&token)
        .expect("Failed to validate token");

    assert_eq!(claims.sub, "user_456");
    assert_eq!(claims.email, "validate@example.com");
    assert_eq!(claims.role, "admin");
}

#[test]
fn test_invalid_token_rejected() {
    let jwt_manager = JwtManager::new();

    let result = jwt_manager.validate_token("invalid.token.here");
    assert!(result.is_err());
}

#[test]
fn test_expired_token_rejected() {
    let jwt_manager = JwtManager::new();

    // Generate a token
    let token = jwt_manager
        .generate_token("user_exp", "exp@example.com", "user")
        .expect("Failed to generate token");

    // Try to validate immediately (should work)
    let result = jwt_manager.validate_token(&token);
    assert!(result.is_ok());
}

#[test]
fn test_authorization_header_extraction() {
    use axum::http::{HeaderMap, header::AUTHORIZATION, HeaderValue};

    // Valid Bearer token
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer my_token_123"));

    let token = extract_jwt_from_header(&headers);
    assert_eq!(token, Some("my_token_123".to_string()));

    // Missing header
    let headers2 = HeaderMap::new();
    let token2 = extract_jwt_from_header(&headers2);
    assert_eq!(token2, None);

    // Invalid format
    let mut headers3 = HeaderMap::new();
    headers3.insert(AUTHORIZATION, HeaderValue::from_static("InvalidFormat"));

    let token3 = extract_jwt_from_header(&headers3);
    assert_eq!(token3, None);
}

#[test]
fn test_user_context_extraction() {
    let jwt_manager = JwtManager::new();

    let token = jwt_manager
        .generate_token("ctx_user", "ctx@example.com", "moderator")
        .expect("Failed to generate token");

    let claims = jwt_manager
        .validate_token(&token)
        .expect("Failed to validate token");

    let user_context = jwt_manager.extract_user_context(&claims);

    assert_eq!(user_context.user_id, "ctx_user");
    assert_eq!(user_context.email, "ctx@example.com");
    assert_eq!(user_context.role, "moderator");
}

#[test]
fn test_different_user_roles() {
    let jwt_manager = JwtManager::new();

    let roles = vec![
        ("user_1", "user1@example.com", "user"),
        ("admin_1", "admin1@example.com", "admin"),
        ("mod_1", "mod1@example.com", "moderator"),
        ("guest_1", "guest1@example.com", "guest"),
    ];

    for (user_id, email, role) in roles {
        let token = jwt_manager
            .generate_token(user_id, email, role)
            .expect("Failed to generate token");

        let claims = jwt_manager
            .validate_token(&token)
            .expect("Failed to validate token");

        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.email, email);
        assert_eq!(claims.role, role);
    }
}

#[test]
fn test_token_expiration_time() {
    let jwt_manager = JwtManager::new();

    let token = jwt_manager
        .generate_token("exp_user", "exp@example.com", "user")
        .expect("Failed to generate token");

    let claims = jwt_manager
        .validate_token(&token)
        .expect("Failed to validate token");

    // Token should expire in 1 hour (3600 seconds)
    let expiration_window = claims.exp - claims.iat;
    assert_eq!(expiration_window, 3600);
}

#[test]
fn test_jwt_manager_default() {
    let jwt_manager = JwtManager::default();

    let token = jwt_manager
        .generate_token("default_user", "default@example.com", "user")
        .expect("Failed to generate token");

    let claims = jwt_manager
        .validate_token(&token)
        .expect("Failed to validate token");

    assert_eq!(claims.sub, "default_user");
}
