// JWT Authentication Middleware
//
// This module provides JWT token generation, validation, and extraction
// for authenticating REST API requests and providing user context in Hooks.

use axum::{
    extract::Request,
    http::header::AUTHORIZATION,
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

const JWT_SECRET: &[u8] = b"flare_secret_key_change_in_production";
const TOKEN_EXPIRATION_HOURS: u64 = 1;

/// JWT Claims structure
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    /// User ID
    pub sub: String,
    /// User email
    pub email: String,
    /// User role
    pub role: String,
    /// Issued at
    pub iat: u64,
    /// Expiration time
    pub exp: u64,
}

/// User context extracted from JWT
#[derive(Debug, Clone)]
pub struct UserContext {
    pub user_id: String,
    pub email: String,
    pub role: String,
}

/// JWT Manager for token operations
#[derive(Clone)]
pub struct JwtManager {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
}

impl JwtManager {
    pub fn new() -> Self {
        Self {
            encoding_key: EncodingKey::from_secret(JWT_SECRET),
            decoding_key: DecodingKey::from_secret(JWT_SECRET),
        }
    }

    /// Generate a new JWT token for a user
    pub fn generate_token(&self, user_id: &str, email: &str, role: &str) -> anyhow::Result<String> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| anyhow::anyhow!("Time error: {}", e))?
            .as_secs();

        let claims = Claims {
            sub: user_id.to_string(),
            email: email.to_string(),
            role: role.to_string(),
            iat: now,
            exp: now + (TOKEN_EXPIRATION_HOURS * 3600),
        };

        let token = encode(&Header::default(), &claims, &self.encoding_key)
            .map_err(|e| anyhow::anyhow!("Token generation failed: {}", e))?;

        Ok(token)
    }

    /// Validate and decode a JWT token
    pub fn validate_token(&self, token: &str) -> anyhow::Result<Claims> {
        let claims = decode::<Claims>(token, &self.decoding_key, &Validation::default())
            .map_err(|e| anyhow::anyhow!("Token validation failed: {}", e))?
            .claims;

        Ok(claims)
    }

    /// Extract user context from JWT claims
    pub fn extract_user_context(&self, claims: &Claims) -> UserContext {
        UserContext {
            user_id: claims.sub.clone(),
            email: claims.email.clone(),
            role: claims.role.clone(),
        }
    }
}

impl Default for JwtManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Extract JWT token from Authorization header
pub fn extract_jwt_from_header(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            if value.starts_with("Bearer ") {
                Some(value["Bearer ".len()..].to_string())
            } else {
                None
            }
        })
}

/// Axum middleware to validate JWT and inject user context
/// Allows GET requests (read operations) without authentication for public content
/// Allows __auth__ collection operations (login/register) without authentication
/// Allows users collection creation with special header for registration
pub async fn jwt_middleware(
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let method = req.method();
    let uri = req.uri().to_string();

    // Allow GET requests without authentication (public read access)
    if method == axum::http::Method::GET {
        // Try to extract token for optional authentication
        if let Some(token) = extract_jwt_from_header(req.headers()) {
            let jwt_manager = JwtManager::new();
            if let Ok(claims) = jwt_manager.validate_token(&token) {
                let user_context = jwt_manager.extract_user_context(&claims);
                let mut req = req;
                req.extensions_mut().insert(user_context);
                return Ok(next.run(req).await);
            }
        }

        // Proceed without user context for unauthenticated GET requests
        return Ok(next.run(req).await);
    }

    // Allow __auth__ collection operations (login, register, password reset) without authentication
    if uri.contains("/collections/__auth__") || uri.contains("/call_hook/auth") {
        // Try to extract token for optional authentication, but don't require it
        if let Some(token) = extract_jwt_from_header(req.headers()) {
            let jwt_manager = JwtManager::new();
            if let Ok(claims) = jwt_manager.validate_token(&token) {
                let user_context = jwt_manager.extract_user_context(&claims);
                let mut req = req;
                req.extensions_mut().insert(user_context);
                return Ok(next.run(req).await);
            }
        }

        // Proceed without user context for unauthenticated auth operations
        return Ok(next.run(req).await);
    }

    // Allow users collection POST with X-Internal-Service header (for auth hook)
    // OR allow public user registration (without special header)
    if uri.contains("/collections/users") && method == axum::http::Method::POST {
        if let Some(_service_key) = req.headers().get("X-Internal-Service") {
            // This is an internal service request (from auth hook)
            // Generate admin user context
            let user_context = UserContext {
                user_id: "auth-hook-service".to_string(),
                email: "auth-hook@internal".to_string(),
                role: "admin".to_string(),
            };
            let mut req = req;
            req.extensions_mut().insert(user_context);
            return Ok(next.run(req).await);
        } else {
            // This is a public user registration
            // Allow without authentication for registration
            // Use a special "public-registration" user context
            let user_context = UserContext {
                user_id: "public-registration".to_string(),
                email: "public@registration".to_string(),
                role: "guest".to_string(),
            };
            let mut req = req;
            req.extensions_mut().insert(user_context);
            return Ok(next.run(req).await);
        }
    }

    // For other POST, PUT, DELETE operations, require authentication
    let token = extract_jwt_from_header(req.headers())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Validate token
    let jwt_manager = JwtManager::new();
    let claims = jwt_manager.validate_token(&token)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Extract user context
    let user_context = jwt_manager.extract_user_context(&claims);

    // Inject user context into request extensions
    let mut req = req;
    req.extensions_mut().insert(user_context);

    Ok(next.run(req).await)
}

/// Extension trait to extract UserContext from Request
pub trait RequestUserExt {
    fn user_context(&self) -> Option<&UserContext>;
}

impl RequestUserExt for Request {
    fn user_context(&self) -> Option<&UserContext> {
        self.extensions().get::<UserContext>()
    }
}

// ===== Tests =====

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn test_generate_and_validate_token() {
        let jwt_manager = JwtManager::new();

        // Generate token
        let token = jwt_manager
            .generate_token("user_123", "user@example.com", "user")
            .expect("Failed to generate token");

        assert!(!token.is_empty());

        // Validate token
        let claims = jwt_manager
            .validate_token(&token)
            .expect("Failed to validate token");

        assert_eq!(claims.sub, "user_123");
        assert_eq!(claims.email, "user@example.com");
        assert_eq!(claims.role, "user");
        assert!(claims.exp > claims.iat);
    }

    #[test]
    fn test_extract_user_context() {
        let jwt_manager = JwtManager::new();

        let token = jwt_manager
            .generate_token("user_456", "test@example.com", "admin")
            .expect("Failed to generate token");

        let claims = jwt_manager
            .validate_token(&token)
            .expect("Failed to validate token");

        let user_context = jwt_manager.extract_user_context(&claims);

        assert_eq!(user_context.user_id, "user_456");
        assert_eq!(user_context.email, "test@example.com");
        assert_eq!(user_context.role, "admin");
    }

    #[test]
    fn test_invalid_token_rejected() {
        let jwt_manager = JwtManager::new();

        let result = jwt_manager.validate_token("invalid_token");
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_jwt_from_header() {
        let mut headers = axum::http::HeaderMap::new();

        // Test with valid Bearer token
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer test_token_123"),
        );

        let token = extract_jwt_from_header(&headers);
        assert_eq!(token, Some("test_token_123".to_string()));

        // Test with missing Authorization header
        let headers2 = axum::http::HeaderMap::new();
        let token2 = extract_jwt_from_header(&headers2);
        assert_eq!(token2, None);

        // Test with invalid format (missing "Bearer ")
        let mut headers3 = axum::http::HeaderMap::new();
        headers3.insert(AUTHORIZATION, HeaderValue::from_static("invalid_format"));
        let token3 = extract_jwt_from_header(&headers3);
        assert_eq!(token3, None);
    }

    #[test]
    fn test_token_expiration() {
        let jwt_manager = JwtManager::new();

        let token = jwt_manager
            .generate_token("user_789", "expire@example.com", "user")
            .expect("Failed to generate token");

        let claims = jwt_manager
            .validate_token(&token)
            .expect("Failed to validate token");

        // Token should expire approximately 1 hour from now
        let expiration_window = claims.exp - claims.iat;
        assert_eq!(expiration_window, TOKEN_EXPIRATION_HOURS * 3600);
    }

    #[test]
    fn test_empty_token_rejected() {
        let jwt_manager = JwtManager::new();

        let result = jwt_manager.validate_token("");
        assert!(result.is_err());
    }

    #[test]
    fn test_malformed_token_rejected() {
        let jwt_manager = JwtManager::new();

        let malformed_tokens = vec![
            "not.a.token",
            "Bearer missing",
            "only_two_parts",
            "a.b.c.d.e", // too many parts
        ];

        for token in malformed_tokens {
            let result = jwt_manager.validate_token(token);
            assert!(result.is_err(), "Token '{}' should be rejected", token);
        }
    }

    #[test]
    fn test_token_with_special_characters() {
        let jwt_manager = JwtManager::new();

        // Test email with special characters
        let token = jwt_manager
            .generate_token("user_123", "user+test@example.com", "user")
            .expect("Failed to generate token with special characters");

        let claims = jwt_manager
            .validate_token(&token)
            .expect("Failed to validate token with special characters");

        assert_eq!(claims.email, "user+test@example.com");
    }

    #[test]
    fn test_multiple_roles() {
        let jwt_manager = JwtManager::new();

        let roles = vec!["user", "admin", "moderator", "guest"];

        for role in roles {
            let token = jwt_manager
                .generate_token("user_123", "user@example.com", role)
                .expect("Failed to generate token");

            let claims = jwt_manager
                .validate_token(&token)
                .expect("Failed to validate token");

            assert_eq!(claims.role, role);
        }
    }

    #[test]
    fn test_user_context_cloning() {
        let ctx = UserContext {
            user_id: "user_123".to_string(),
            email: "test@example.com".to_string(),
            role: "admin".to_string(),
        };

        let ctx_clone = ctx.clone();

        assert_eq!(ctx.user_id, ctx_clone.user_id);
        assert_eq!(ctx.email, ctx_clone.email);
        assert_eq!(ctx.role, ctx_clone.role);
    }

    #[test]
    fn test_authorization_header_case_insensitive() {
        let mut headers = axum::http::HeaderMap::new();

        // HeaderMap is case-insensitive, so both should work
        headers.insert("authorization", HeaderValue::from_static("Bearer token"));
        let token = extract_jwt_from_header(&headers);
        assert_eq!(token, Some("token".to_string()));

        let mut headers2 = axum::http::HeaderMap::new();
        headers2.insert(AUTHORIZATION, HeaderValue::from_static("Bearer token"));
        let token2 = extract_jwt_from_header(&headers2);
        assert_eq!(token2, Some("token".to_string()));
    }

    #[test]
    fn test_bearer_with_extra_spaces() {
        let mut headers = axum::http::HeaderMap::new();

        // Test with extra spaces (should still work)
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer  token_with_spaces  "));
        let token = extract_jwt_from_header(&headers);
        // The implementation should trim spaces
        assert!(token.is_some());
        assert!(token.unwrap().contains("token_with_spaces"));
    }

    #[test]
    fn test_jwt_manager_default() {
        let jwt_manager = JwtManager::default();

        let token = jwt_manager
            .generate_token("user_default", "default@example.com", "user")
            .expect("Failed to generate token");

        let claims = jwt_manager
            .validate_token(&token)
            .expect("Failed to validate token");

        assert_eq!(claims.sub, "user_default");
    }

    #[test]
    fn test_long_user_id() {
        let jwt_manager = JwtManager::new();

        let long_user_id = "user_very_long_id_1234567890abcdefghijklmnopqrstuvwxyz";

        let token = jwt_manager
            .generate_token(long_user_id, "user@example.com", "user")
            .expect("Failed to generate token with long user ID");

        let claims = jwt_manager
            .validate_token(&token)
            .expect("Failed to validate token");

        assert_eq!(claims.sub, long_user_id);
    }

    #[test]
    fn test_empty_user_fields() {
        let jwt_manager = JwtManager::new();

        // Test with empty strings (edge case)
        let token = jwt_manager
            .generate_token("", "", "")
            .expect("Failed to generate token with empty fields");

        let claims = jwt_manager
            .validate_token(&token)
            .expect("Failed to validate token");

        assert_eq!(claims.sub, "");
        assert_eq!(claims.email, "");
        assert_eq!(claims.role, "");
    }
}
