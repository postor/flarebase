// CORS Configuration Tests
//
// These tests verify that CORS can be configured from a config file
// and that the configuration is correctly applied to the middleware.

use std::io::Write;
use tempfile::NamedTempFile;
use flare_server::cors_config::{CorsConfig, load_cors_config};

#[test]
fn test_cors_config_default() {
    // Test default CORS configuration
    let config = CorsConfig::default();

    assert!(config.allowed_origins.is_empty());
    assert!(config.allow_credentials);
    assert_eq!(config.max_age_secs, 3600);
}

#[test]
fn test_cors_config_from_json() {
    // Test loading CORS config from JSON
    let config_json = r#"
    {
        "allowed_origins": [
            "http://localhost:3000",
            "https://example.com"
        ],
        "allowed_methods": ["GET", "POST", "PUT", "DELETE"],
        "allowed_headers": ["content-type", "authorization"],
        "allow_credentials": true,
        "max_age_secs": 1800
    }
    "#;

    let mut temp_file = NamedTempFile::new().unwrap();
    temp_file.write_all(config_json.as_bytes()).unwrap();
    temp_file.flush().unwrap();

    let config = load_cors_config(temp_file.path()).unwrap();

    assert_eq!(config.allowed_origins.len(), 2);
    assert_eq!(config.allowed_origins[0], "http://localhost:3000");
    assert_eq!(config.allowed_origins[1], "https://example.com");
    assert_eq!(config.allowed_methods.len(), 4);
    assert!(config.allow_credentials);
    assert_eq!(config.max_age_secs, 1800);
}

#[test]
fn test_cors_config_wildcard_origin() {
    // Test wildcard origin configuration
    let config_json = r#"
    {
        "allowed_origins": ["*"],
        "allowed_methods": ["GET", "POST"],
        "allowed_headers": ["*"],
        "allow_credentials": false,
        "max_age_secs": 3600
    }
    "#;

    let mut temp_file = NamedTempFile::new().unwrap();
    temp_file.write_all(config_json.as_bytes()).unwrap();
    temp_file.flush().unwrap();

    let config = load_cors_config(temp_file.path()).unwrap();

    assert_eq!(config.allowed_origins.len(), 1);
    assert_eq!(config.allowed_origins[0], "*");
    assert!(!config.allow_credentials);
}

#[test]
fn test_cors_config_empty_origins() {
    // Test empty origins (should use Any)
    let config_json = r#"
    {
        "allowed_origins": [],
        "allowed_methods": ["GET"],
        "allowed_headers": ["content-type"],
        "allow_credentials": true,
        "max_age_secs": 3600
    }
    "#;

    let mut temp_file = NamedTempFile::new().unwrap();
    temp_file.write_all(config_json.as_bytes()).unwrap();
    temp_file.flush().unwrap();

    let config = load_cors_config(temp_file.path()).unwrap();

    assert!(config.allowed_origins.is_empty());
}

#[test]
fn test_cors_config_invalid_json() {
    // Test invalid JSON handling
    let config_json = r#"
    {
        "allowed_origins": ["http://localhost:3000",
        "allowed_methods": ["GET"]
    }
    "#; // Missing closing brace

    let mut temp_file = NamedTempFile::new().unwrap();
    temp_file.write_all(config_json.as_bytes()).unwrap();
    temp_file.flush().unwrap();

    let result = load_cors_config(temp_file.path());
    assert!(result.is_err());
}

#[test]
fn test_cors_config_missing_file() {
    // Test missing file handling
    let result = load_cors_config(std::path::Path::new("/nonexistent/cors_config.json"));
    assert!(result.is_err());
}

#[test]
fn test_cors_config_all_methods() {
    // Test all HTTP methods
    let config_json = r#"
    {
        "allowed_origins": ["*"],
        "allowed_methods": ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
        "allowed_headers": ["*"],
        "allow_credentials": false,
        "max_age_secs": 3600
    }
    "#;

    let mut temp_file = NamedTempFile::new().unwrap();
    temp_file.write_all(config_json.as_bytes()).unwrap();
    temp_file.flush().unwrap();

    let config = load_cors_config(temp_file.path()).unwrap();

    assert_eq!(config.allowed_methods.len(), 7);
}

#[test]
fn test_cors_config_production_origins() {
    // Test production environment origins
    let config_json = r#"
    {
        "allowed_origins": [
            "https://myapp.com",
            "https://www.myapp.com",
            "https://admin.myapp.com"
        ],
        "allowed_methods": ["GET", "POST", "PUT", "DELETE"],
        "allowed_headers": ["content-type", "authorization", "x-requested-with"],
        "allow_credentials": true,
        "max_age_secs": 7200
    }
    "#;

    let mut temp_file = NamedTempFile::new().unwrap();
    temp_file.write_all(config_json.as_bytes()).unwrap();
    temp_file.flush().unwrap();

    let config = load_cors_config(temp_file.path()).unwrap();

    assert_eq!(config.allowed_origins.len(), 3);
    assert_eq!(config.max_age_secs, 7200);
}

#[test]
fn test_cors_config_dev_mode() {
    // Test development mode configuration
    let config_json = r#"
    {
        "allowed_origins": [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001"
        ],
        "allowed_methods": ["GET", "POST", "PUT", "DELETE", "PATCH"],
        "allowed_headers": ["*"],
        "allow_credentials": true,
        "max_age_secs": 3600
    }
    "#;

    let mut temp_file = NamedTempFile::new().unwrap();
    temp_file.write_all(config_json.as_bytes()).unwrap();
    temp_file.flush().unwrap();

    let config = load_cors_config(temp_file.path()).unwrap();

    assert_eq!(config.allowed_origins.len(), 3);
    assert!(config.allow_credentials);
}
