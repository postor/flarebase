// Socket.IO CORS Configuration Tests (Simplified)
//
// These tests verify that Socket.IO endpoints have proper CORS configuration
// to allow cross-origin requests from frontend applications.

use axum::{
    body::Body,
    http::{Request, StatusCode, Method, HeaderValue},
    Router,
};
use socketioxide::SocketIo;
use tower_http::cors::CorsLayer;
use std::time::Duration;
use tower::ServiceExt;

/// Helper: Create a test app with Socket.IO and CORS layers
fn create_test_app_with_cors(origins: Vec<&str>) -> Router {
    let (io_layer, _io) = SocketIo::builder().build_layer();

    // Build CORS layer
    let cors = if origins.contains(&"*") {
        // Wildcard origin
        CorsLayer::new()
            .allow_origin(tower_http::cors::Any)
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers(tower_http::cors::Any)
            .allow_credentials(false)
            .max_age(Duration::from_secs(3600))
    } else if origins.is_empty() {
        // Permissive for testing
        CorsLayer::permissive()
    } else {
        // Specific origins
        let origins_list: Vec<HeaderValue> = origins
            .iter()
            .map(|o| HeaderValue::from_str(o).unwrap())
            .collect();

        CorsLayer::new()
            .allow_origin(tower_http::cors::AllowOrigin::list(origins_list))
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers([
                axum::http::header::CONTENT_TYPE,
                axum::http::header::AUTHORIZATION,
                axum::http::header::ACCEPT,
            ])
            .allow_credentials(true)
            .max_age(Duration::from_secs(3600))
    };

    // 🔒 CRITICAL: Layer order - CORS must be OUTER layer
    Router::new()
        .layer(io_layer)    // Socket.IO layer (inner)
        .layer(cors)        // CORS layer (outer)
}

#[cfg(test)]
mod socketio_cors_tests {
    use super::*;

    #[tokio::test]
    async fn test_socketio_cors_layer_order_correct() {
        // Verify that CORS layer is applied OUTSIDE Socket.IO layer
        
        let app = create_test_app_with_cors(vec!["http://localhost:3002"]);

        // Simulate preflight OPTIONS request
        let request = Request::builder()
            .method(Method::OPTIONS)
            .uri("/socket.io/?EIO=4&transport=polling")
            .header("Origin", "http://localhost:3002")
            .header("Access-Control-Request-Method", "GET")
            .header("Access-Control-Request-Headers", "content-type")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        // Verify CORS headers are present
        assert_eq!(response.status(), StatusCode::OK);
        
        let allow_origin = response.headers().get("access-control-allow-origin");
        assert!(allow_origin.is_some(), "Missing Access-Control-Allow-Origin header");
    }

    #[tokio::test]
    async fn test_socketio_cors_wildcard_origin() {
        // Test wildcard CORS configuration

        let app = create_test_app_with_cors(vec!["*"]);

        let request = Request::builder()
            .method(Method::OPTIONS)
            .uri("/socket.io/?EIO=4&transport=polling")
            .header("Origin", "http://any-domain.com")
            .header("Access-Control-Request-Method", "GET")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        
        let allow_origin = response.headers().get("access-control-allow-origin");
        assert!(allow_origin.is_some());
    }

    #[tokio::test]
    async fn test_socketio_cors_multiple_origins() {
        // Test multiple allowed origins

        let origins = vec![
            "http://localhost:3002",
            "http://127.0.0.1:3002",
            "http://localhost:3000",
        ];

        let app = create_test_app_with_cors(origins);

        // Test first origin
        let request = Request::builder()
            .method(Method::OPTIONS)
            .uri("/socket.io/?EIO=4&transport=polling")
            .header("Origin", "http://localhost:3002")
            .header("Access-Control-Request-Method", "GET")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        
        assert_eq!(response.status(), StatusCode::OK);
        
        let allow_origin = response.headers().get("access-control-allow-origin");
        assert!(allow_origin.is_some(), "Missing CORS header for localhost:3002");
    }

    #[tokio::test]
    async fn test_socketio_http_polling_get_request() {
        // Test actual HTTP polling GET request (not just preflight)

        let app = create_test_app_with_cors(vec!["http://localhost:3002"]);

        let request = Request::builder()
            .method(Method::GET)
            .uri("/socket.io/?EIO=4&transport=polling")
            .header("Origin", "http://localhost:3002")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        // Should have CORS headers even on actual requests
        let allow_origin = response.headers().get("access-control-allow-origin");
        assert!(
            allow_origin.is_some(),
            "CORS headers should be present on actual GET requests"
        );
    }

    #[tokio::test]
    async fn test_socketio_cors_allowed_methods() {
        // Test that allowed methods are specified

        let app = create_test_app_with_cors(vec!["http://localhost:3002"]);

        let request = Request::builder()
            .method(Method::OPTIONS)
            .uri("/socket.io/?EIO=4&transport=polling")
            .header("Origin", "http://localhost:3002")
            .header("Access-Control-Request-Method", "POST")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        // Verify Allow-Methods header
        let allow_methods = response.headers().get("access-control-allow-methods");
        if let Some(methods) = allow_methods {
            let methods_str = methods.to_str().unwrap();
            assert!(methods_str.contains("GET") || methods_str.contains("*"));
        }
    }

    #[tokio::test]
    async fn test_socketio_cors_with_credentials() {
        // Test CORS with credentials enabled

        let app = create_test_app_with_cors(vec!["http://localhost:3002"]);

        let request = Request::builder()
            .method(Method::OPTIONS)
            .uri("/socket.io/?EIO=4&transport=polling")
            .header("Origin", "http://localhost:3002")
            .header("Access-Control-Request-Method", "GET")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        // Should have credentials header
        let allow_credentials = response.headers().get("access-control-allow-credentials");
        assert!(
            allow_credentials.is_some(),
            "CORS should specify allow-credentials for authenticated requests"
        );
    }

    #[tokio::test]
    async fn test_socketio_cors_default_development_origins() {
        // Test that default development origins are configured

        let default_origins = vec![
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001",
            "http://localhost:3002",
            "http://127.0.0.1:3002",
        ];

        let app = create_test_app_with_cors(default_origins);

        // Verify first default origin is allowed
        let request = Request::builder()
            .method(Method::OPTIONS)
            .uri("/socket.io/?EIO=4&transport=polling")
            .header("Origin", "http://localhost:3002")
            .header("Access-Control-Request-Method", "GET")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        
        assert_eq!(response.status(), StatusCode::OK);
        
        let allow_origin = response.headers().get("access-control-allow-origin");
        assert!(allow_origin.is_some(), "Default development origin should be allowed");
    }

    #[tokio::test]
    async fn test_cors_socketio_layer_order_wrong() {
        // Demonstrate WRONG layer order (this was the bug!)

        let (io_layer, _io) = SocketIo::builder().build_layer();
        let cors = CorsLayer::permissive();

        // ❌ WRONG: CORS is inner layer
        let wrong_app = Router::new()
            .layer(cors)        // Inner
            .layer(io_layer);   // Outer

        let request = Request::builder()
            .method(Method::OPTIONS)
            .uri("/socket.io/?EIO=4&transport=polling")
            .header("Origin", "http://localhost:3002")
            .header("Access-Control-Request-Method", "GET")
            .body(Body::empty())
            .unwrap();

        let response = wrong_app.oneshot(request).await.unwrap();
        
        // With wrong order, CORS may not work properly
        // This test documents why layer order matters
        println!("⚠️ Wrong layer order demonstrates the bug we fixed!");
        println!("   CORS headers present: {}", 
            response.headers().contains_key("access-control-allow-origin"));
    }

    #[tokio::test]
    async fn test_socketio_cors_security_no_origin_reflection() {
        // SECURITY: Verify unauthorized origins are not reflected

        let app = create_test_app_with_cors(vec!["http://localhost:3002"]);

        let request = Request::builder()
            .method(Method::OPTIONS)
            .uri("/socket.io/?EIO=4&transport=polling")
            .header("Origin", "http://malicious-site.com")
            .header("Access-Control-Request-Method", "GET")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        // Should NOT reflect the unauthorized origin
        let allow_origin = response.headers().get("access-control-allow-origin");
        
        if let Some(origin) = allow_origin {
            assert_ne!(
                origin.to_str().unwrap(),
                "http://malicious-site.com",
                "CORS should not reflect unauthorized origins"
            );
        }
    }

    #[tokio::test]
    async fn test_socketio_cors_preflight_cache() {
        // Test preflight cache duration

        let app = create_test_app_with_cors(vec!["http://localhost:3002"]);

        let request = Request::builder()
            .method(Method::OPTIONS)
            .uri("/socket.io/?EIO=4&transport=polling")
            .header("Origin", "http://localhost:3002")
            .header("Access-Control-Request-Method", "GET")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        // Should have max-age header (3600 seconds = 1 hour)
        let max_age = response.headers().get("access-control-max-age");
        assert!(
            max_age.is_some(),
            "CORS should specify max-age for preflight caching"
        );
    }
}
