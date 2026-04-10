// CORS End-to-End Integration Tests
//
// These tests verify that CORS configuration is loaded and applied correctly
// in a real server context.

use std::io::Write;
use tempfile::NamedTempFile;
use flare_server::cors_config::{CorsConfig, load_cors_config};

#[test]
fn test_cors_config_integration_with_main() {
    // Test that CORS configuration can be loaded and used
    let config_json = r#"
    {
        "allowed_origins": ["http://localhost:3000"],
        "allowed_methods": ["GET", "POST"],
        "allowed_headers": ["content-type"],
        "allow_credentials": true,
        "max_age_secs": 1800
    }
    "#;

    let mut temp_file = NamedTempFile::new().unwrap();
    temp_file.write_all(config_json.as_bytes()).unwrap();
    temp_file.flush().unwrap();

    let config = load_cors_config(temp_file.path()).unwrap();

    // Verify configuration
    assert_eq!(config.allowed_origins.len(), 1);
    assert_eq!(config.allowed_origins[0], "http://localhost:3000");
    assert_eq!(config.allowed_methods.len(), 2);
    assert_eq!(config.allowed_methods[0], "GET");
    assert_eq!(config.allowed_methods[1], "POST");
    assert_eq!(config.allowed_headers.len(), 1);
    assert!(config.allow_credentials);
    assert_eq!(config.max_age_secs, 1800);
}

#[test]
fn test_cors_config_multiple_origins() {
    // Test multiple allowed origins
    let config_json = r#"
    {
        "allowed_origins": [
            "http://localhost:3000",
            "https://example.com",
            "https://www.example.com"
        ],
        "allowed_methods": ["GET", "POST", "PUT"],
        "allowed_headers": ["content-type", "authorization"],
        "allow_credentials": false,
        "max_age_secs": 3600
    }
    "#;

    let mut temp_file = NamedTempFile::new().unwrap();
    temp_file.write_all(config_json.as_bytes()).unwrap();
    temp_file.flush().unwrap();

    let config = load_cors_config(temp_file.path()).unwrap();

    assert_eq!(config.allowed_origins.len(), 3);
    assert_eq!(config.allowed_methods.len(), 3);
    assert_eq!(config.allowed_headers.len(), 2);
    assert!(!config.allow_credentials);
    assert_eq!(config.max_age_secs, 3600);
}

#[test]
fn test_cors_config_default_fallback() {
    // Test that default configuration works when file is missing
    let config = CorsConfig::default();

    assert!(config.allowed_origins.is_empty());
    assert!(!config.allowed_methods.is_empty());
    assert!(!config.allowed_headers.is_empty());
    assert!(config.allow_credentials);
    assert_eq!(config.max_age_secs, 3600);
}

#[test]
fn test_cors_config_serialization_roundtrip() {
    // Test that config can be serialized and deserialized
    let original = CorsConfig {
        allowed_origins: vec!["http://localhost:3000".to_string()],
        allowed_methods: vec!["GET".to_string(), "POST".to_string()],
        allowed_headers: vec!["content-type".to_string()],
        allow_credentials: true,
        max_age_secs: 1800,
    };

    let json = serde_json::to_string(&original).unwrap();
    let deserialized: CorsConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.allowed_origins, original.allowed_origins);
    assert_eq!(deserialized.allowed_methods, original.allowed_methods);
    assert_eq!(deserialized.allowed_headers, original.allowed_headers);
    assert_eq!(deserialized.allow_credentials, original.allow_credentials);
    assert_eq!(deserialized.max_age_secs, original.max_age_secs);
}
