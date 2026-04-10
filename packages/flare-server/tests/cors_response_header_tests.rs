// CORS Configuration Value Verification Tests
//
// These tests verify that CORS configuration values are correctly parsed,
// validated, and can be used to configure CORS behavior.
// Tests include verification of exact values returned from configuration parsing.

use std::io::Write;
use tempfile::NamedTempFile;
use flare_server::cors_config::{CorsConfig, load_cors_config};

/// Helper to create a temp config file and load it
fn load_config_from_json(json: &str) -> CorsConfig {
    let mut temp_file = NamedTempFile::new().unwrap();
    temp_file.write_all(json.as_bytes()).unwrap();
    temp_file.flush().unwrap();
    load_cors_config(temp_file.path()).unwrap()
}

// ===== Access-Control-Allow-Origin Value Tests =====

#[test]
fn test_allow_origin_value_single_origin() {
    let config = load_config_from_json(r#"
    {
        "allowed_origins": ["http://localhost:3000"],
        "allowed_methods": ["GET"],
        "allowed_headers": ["content-type"]
    }
    "#);

    // Verify the exact origin value
    assert_eq!(config.allowed_origins.len(), 1);
    assert_eq!(config.allowed_origins[0], "http://localhost:3000");
}

#[test]
fn test_allow_origin_value_multiple_origins() {
    let config = load_config_from_json(r#"
    {
        "allowed_origins": [
            "http://localhost:3000",
            "http://localhost:3001",
            "https://example.com"
        ],
        "allowed_methods": ["GET"],
        "allowed_headers": ["content-type"]
    }
    "#);

    // Verify all origin values are correct
    assert_eq!(config.allowed_origins.len(), 3);
    assert_eq!(config.allowed_origins[0], "http://localhost:3000");
    assert_eq!(config.allowed_origins[1], "http://localhost:3001");
    assert_eq!(config.allowed_origins[2], "https://example.com");
}

#[test]
fn test_allow_origin_value_wildcard() {
    let config = load_config_from_json(r#"
    {
        "allowed_origins": ["*"],
        "allowed_methods": ["GET"],
        "allowed_headers": ["content-type"]
    }
    "#);

    // Verify wildcard is preserved
    assert_eq!(config.allowed_origins.len(), 1);
    assert_eq!(config.allowed_origins[0], "*");
}

#[test]
fn test_allow_origin_value_empty_allows_any() {
    let config = load_config_from_json(r#"
    {
        "allowed_origins": [],
        "allowed_methods": ["GET"],
        "allowed_headers": ["content-type"]
    }
    "#);

    // Empty list means allow any origin
    assert!(config.allowed_origins.is_empty());
}

// ===== Access-Control-Allow-Methods Value Tests =====

#[test]
fn test_allow_methods_value_single_method() {
    let config = load_config_from_json(r#"
    {
        "allowed_methods": ["GET"],
        "allowed_headers": ["content-type"]
    }
    "#);

    // Verify exact method value
    assert_eq!(config.allowed_methods.len(), 1);
    assert_eq!(config.allowed_methods[0], "GET");
}

#[test]
fn test_allow_methods_value_all_rest_methods() {
    let config = load_config_from_json(r#"
    {
        "allowed_methods": ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        "allowed_headers": ["content-type"]
    }
    "#);

    // Verify all method values
    assert_eq!(config.allowed_methods.len(), 6);
    assert_eq!(config.allowed_methods[0], "GET");
    assert_eq!(config.allowed_methods[1], "POST");
    assert_eq!(config.allowed_methods[2], "PUT");
    assert_eq!(config.allowed_methods[3], "DELETE");
    assert_eq!(config.allowed_methods[4], "PATCH");
    assert_eq!(config.allowed_methods[5], "OPTIONS");
}

#[test]
fn test_allow_methods_value_http_method_case_sensitivity() {
    // HTTP methods are case-sensitive, verify they're stored correctly
    let config = load_config_from_json(r#"
    {
        "allowed_methods": ["get", "post", "Put", "DELETE"],
        "allowed_headers": ["content-type"]
    }
    "#);

    // Methods should preserve original case
    assert_eq!(config.allowed_methods.len(), 4);
    assert_eq!(config.allowed_methods[0], "get");
    assert_eq!(config.allowed_methods[1], "post");
    assert_eq!(config.allowed_methods[2], "Put");
    assert_eq!(config.allowed_methods[3], "DELETE");
}

#[test]
fn test_allow_methods_default_value() {
    let config = CorsConfig::default();

    // Default methods should include common REST methods
    assert!(config.allowed_methods.contains(&"GET".to_string()));
    assert!(config.allowed_methods.contains(&"POST".to_string()));
    assert!(config.allowed_methods.contains(&"PUT".to_string()));
    assert!(config.allowed_methods.contains(&"DELETE".to_string()));
    assert!(config.allowed_methods.contains(&"PATCH".to_string()));
    assert!(config.allowed_methods.contains(&"OPTIONS".to_string()));
}

// ===== Access-Control-Allow-Headers Value Tests =====

#[test]
fn test_allow_headers_value_single_header() {
    let config = load_config_from_json(r#"
    {
        "allowed_headers": ["content-type"]
    }
    "#);

    // Verify exact header value
    assert_eq!(config.allowed_headers.len(), 1);
    assert_eq!(config.allowed_headers[0], "content-type");
}

#[test]
fn test_allow_headers_value_multiple_headers() {
    let config = load_config_from_json(r#"
    {
        "allowed_headers": [
            "content-type",
            "authorization",
            "x-custom-header",
            "accept"
        ]
    }
    "#);

    // Verify all header values
    assert_eq!(config.allowed_headers.len(), 4);
    assert_eq!(config.allowed_headers[0], "content-type");
    assert_eq!(config.allowed_headers[1], "authorization");
    assert_eq!(config.allowed_headers[2], "x-custom-header");
    assert_eq!(config.allowed_headers[3], "accept");
}

#[test]
fn test_allow_headers_value_wildcard() {
    let config = load_config_from_json(r#"
    {
        "allowed_headers": ["*"]
    }
    "#);

    // Wildcard allows all headers
    assert_eq!(config.allowed_headers.len(), 1);
    assert_eq!(config.allowed_headers[0], "*");
}

#[test]
fn test_allow_headers_default_value() {
    let config = CorsConfig::default();

    // Default headers should include common headers
    assert!(config.allowed_headers.contains(&"content-type".to_string()));
    assert!(config.allowed_headers.contains(&"authorization".to_string()));
    assert!(config.allowed_headers.contains(&"x-requested-with".to_string()));
    assert!(config.allowed_headers.contains(&"accept".to_string()));
}

// ===== Access-Control-Allow-Credentials Value Tests =====

#[test]
fn test_allow_credentials_value_true() {
    let config = load_config_from_json(r#"
    {
        "allow_credentials": true
    }
    "#);

    // Verify exact boolean value
    assert!(config.allow_credentials);
}

#[test]
fn test_allow_credentials_value_false() {
    let config = load_config_from_json(r#"
    {
        "allow_credentials": false
    }
    "#);

    // Verify exact boolean value
    assert!(!config.allow_credentials);
}

#[test]
fn test_allow_credentials_default_value() {
    let config = CorsConfig::default();

    // Default should be true (credentials allowed)
    assert!(config.allow_credentials);
}

// ===== Access-Control-Max-Age Value Tests =====

#[test]
fn test_max_age_value_one_hour() {
    let config = load_config_from_json(r#"
    {
        "max_age_secs": 3600
    }
    "#);

    // Verify exact max_age value
    assert_eq!(config.max_age_secs, 3600);
}

#[test]
fn test_max_age_value_two_hours() {
    let config = load_config_from_json(r#"
    {
        "max_age_secs": 7200
    }
    "#);

    assert_eq!(config.max_age_secs, 7200);
}

#[test]
fn test_max_age_value_half_hour() {
    let config = load_config_from_json(r#"
    {
        "max_age_secs": 1800
    }
    "#);

    assert_eq!(config.max_age_secs, 1800);
}

#[test]
fn test_max_age_value_one_minute() {
    let config = load_config_from_json(r#"
    {
        "max_age_secs": 60
    }
    "#);

    assert_eq!(config.max_age_secs, 60);
}

#[test]
fn test_max_age_value_large_value() {
    let config = load_config_from_json(r#"
    {
        "max_age_secs": 86400
    }
    "#);

    // 24 hours
    assert_eq!(config.max_age_secs, 86400);
}

#[test]
fn test_max_age_default_value() {
    let config = CorsConfig::default();

    // Default should be 3600 seconds (1 hour)
    assert_eq!(config.max_age_secs, 3600);
}

// ===== Combined Configuration Value Tests =====

#[test]
fn test_complete_cors_config_value_verification() {
    let config = load_config_from_json(r#"
    {
        "allowed_origins": [
            "http://localhost:3000",
            "https://myapp.com"
        ],
        "allowed_methods": ["GET", "POST", "PUT", "DELETE"],
        "allowed_headers": ["content-type", "authorization"],
        "allow_credentials": true,
        "max_age_secs": 7200
    }
    "#);

    // Verify all values match expected
    assert_eq!(config.allowed_origins.len(), 2);
    assert_eq!(config.allowed_origins[0], "http://localhost:3000");
    assert_eq!(config.allowed_origins[1], "https://myapp.com");

    assert_eq!(config.allowed_methods.len(), 4);
    assert_eq!(config.allowed_methods[0], "GET");
    assert_eq!(config.allowed_methods[1], "POST");
    assert_eq!(config.allowed_methods[2], "PUT");
    assert_eq!(config.allowed_methods[3], "DELETE");

    assert_eq!(config.allowed_headers.len(), 2);
    assert_eq!(config.allowed_headers[0], "content-type");
    assert_eq!(config.allowed_headers[1], "authorization");

    assert!(config.allow_credentials);
    assert_eq!(config.max_age_secs, 7200);
}

#[test]
fn test_config_value_roundtrip_serialization() {
    let original = CorsConfig {
        allowed_origins: vec![
            "http://localhost:3000".to_string(),
            "https://example.com".to_string(),
        ],
        allowed_methods: vec![
            "GET".to_string(),
            "POST".to_string(),
            "OPTIONS".to_string(),
        ],
        allowed_headers: vec![
            "content-type".to_string(),
            "authorization".to_string(),
        ],
        allow_credentials: true,
        max_age_secs: 3600,
    };

    // Serialize to JSON
    let json = serde_json::to_string(&original).unwrap();

    // Deserialize back
    let deserialized: CorsConfig = serde_json::from_str(&json).unwrap();

    // Verify all values are identical
    assert_eq!(deserialized.allowed_origins, original.allowed_origins);
    assert_eq!(deserialized.allowed_methods, original.allowed_methods);
    assert_eq!(deserialized.allowed_headers, original.allowed_headers);
    assert_eq!(deserialized.allow_credentials, original.allow_credentials);
    assert_eq!(deserialized.max_age_secs, original.max_age_secs);
}

#[test]
fn test_config_value_roundtrip_with_wildcard_origins() {
    let original = CorsConfig {
        allowed_origins: vec!["*".to_string()],
        allowed_methods: vec!["GET".to_string(), "POST".to_string()],
        allowed_headers: vec!["*".to_string()],
        allow_credentials: false,
        max_age_secs: 86400,
    };

    let json = serde_json::to_string(&original).unwrap();
    let deserialized: CorsConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.allowed_origins, original.allowed_origins);
    assert_eq!(deserialized.allowed_origins[0], "*");
}

#[test]
fn test_config_value_json_parse_with_extra_fields() {
    // Config should ignore extra fields
    let config = load_config_from_json(r#"
    {
        "allowed_origins": ["http://localhost:3000"],
        "allowed_methods": ["GET", "POST"],
        "allowed_headers": ["content-type"],
        "allow_credentials": true,
        "max_age_secs": 3600,
        "extra_field": "should_be_ignored"
    }
    "#);

    assert_eq!(config.allowed_origins[0], "http://localhost:3000");
}

// ===== Edge Case Value Tests =====

#[test]
fn test_empty_config_uses_defaults() {
    let config = load_config_from_json(r#"{}"#);

    // Should use default values
    assert!(config.allowed_origins.is_empty());
    assert_eq!(config.allowed_methods.len(), 6); // default methods
    assert!(!config.allowed_headers.is_empty()); // default headers
    assert!(config.allow_credentials); // default true
    assert_eq!(config.max_age_secs, 3600); // default 1 hour
}

#[test]
fn test_config_value_whitespace_in_strings() {
    let config = load_config_from_json(r#"
    {
        "allowed_origins": [" http://localhost:3000 "],
        "allowed_methods": [" GET "],
        "allowed_headers": [" content-type "]
    }
    "#);

    // Whitespace should be preserved (not trimmed)
    assert_eq!(config.allowed_origins[0], " http://localhost:3000 ");
    assert_eq!(config.allowed_methods[0], " GET ");
    assert_eq!(config.allowed_headers[0], " content-type ");
}
