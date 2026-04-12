// CORS Configuration Module
//
// This module handles loading and applying CORS configuration from a JSON file.

use serde::{Deserialize, Serialize};
use std::path::Path;
use anyhow::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorsConfig {
    /// List of allowed origins. Empty list means allow any origin.
    /// Use "*" for wildcard.
    #[serde(default)]
    pub allowed_origins: Vec<String>,

    /// List of allowed HTTP methods
    #[serde(default = "default_allowed_methods")]
    pub allowed_methods: Vec<String>,

    /// List of allowed headers
    #[serde(default = "default_allowed_headers")]
    pub allowed_headers: Vec<String>,

    /// Allow credentials (cookies, authorization headers)
    #[serde(default = "default_allow_credentials")]
    pub allow_credentials: bool,

    /// Preflight cache max age in seconds
    #[serde(default = "default_max_age")]
    pub max_age_secs: u64,
}

fn default_allowed_methods() -> Vec<String> {
    vec![
        "GET".to_string(),
        "POST".to_string(),
        "PUT".to_string(),
        "DELETE".to_string(),
        "PATCH".to_string(),
        "OPTIONS".to_string(),
    ]
}

fn default_allowed_headers() -> Vec<String> {
    vec![
        "content-type".to_string(),
        "authorization".to_string(),
        "x-requested-with".to_string(),
        "accept".to_string(),
    ]
}

fn default_allow_credentials() -> bool {
    true
}

fn default_max_age() -> u64 {
    3600 // 1 hour
}

impl Default for CorsConfig {
    fn default() -> Self {
        Self {
            allowed_origins: vec![],
            allowed_methods: default_allowed_methods(),
            allowed_headers: default_allowed_headers(),
            allow_credentials: default_allow_credentials(),
            max_age_secs: default_max_age(),
        }
    }
}

/// Load CORS configuration from a JSON file
pub fn load_cors_config(path: &Path) -> Result<CorsConfig> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("Failed to read CORS config file: {}", e))?;

    let config: CorsConfig = serde_json::from_str(&content)
        .map_err(|e| anyhow::anyhow!("Failed to parse CORS config JSON: {}", e))?;

    Ok(config)
}

/// Create CORS configuration from environment variable
/// Falls back to default if variable not set
pub fn load_cors_config_from_env() -> CorsConfig {
    let config_path = std::env::var("CORS_CONFIG_PATH")
        .unwrap_or_else(|_| "cors_config.json".to_string());

    if Path::new(&config_path).exists() {
        tracing::info!("Loading CORS config from: {}", config_path);
        match load_cors_config(Path::new(&config_path)) {
            Ok(config) => {
                tracing::info!("CORS config loaded successfully");
                tracing::info!("Allowed origins: {:?}", config.allowed_origins);
                tracing::info!("Allow credentials: {}", config.allow_credentials);
                config
            }
            Err(e) => {
                tracing::warn!("Failed to load CORS config from {}: {}, using defaults", config_path, e);
                CorsConfig::default()
            }
        }
    } else {
        tracing::info!("CORS config file not found at {}, using defaults", config_path);
        CorsConfig::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ========== CorsConfig Default Tests ==========

    #[test]
    fn test_default_config() {
        let config = CorsConfig::default();
        assert!(config.allowed_origins.is_empty());
        assert!(config.allow_credentials);
        assert_eq!(config.max_age_secs, 3600);
    }

    #[test]
    fn test_default_config_has_expected_methods() {
        let config = CorsConfig::default();
        assert!(config.allowed_methods.contains(&"GET".to_string()));
        assert!(config.allowed_methods.contains(&"POST".to_string()));
        assert!(config.allowed_methods.contains(&"PUT".to_string()));
        assert!(config.allowed_methods.contains(&"DELETE".to_string()));
        assert!(config.allowed_methods.contains(&"PATCH".to_string()));
        assert!(config.allowed_methods.contains(&"OPTIONS".to_string()));
    }

    #[test]
    fn test_default_config_has_expected_headers() {
        let config = CorsConfig::default();
        assert!(config.allowed_headers.contains(&"content-type".to_string()));
        assert!(config.allowed_headers.contains(&"authorization".to_string()));
        assert!(config.allowed_headers.contains(&"x-requested-with".to_string()));
        assert!(config.allowed_headers.contains(&"accept".to_string()));
    }

    // ========== CorsConfig Serialization Tests ==========

    #[test]
    fn test_serialize_default_config() {
        let config = CorsConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        
        // Verify JSON contains expected fields
        assert!(json.contains("allowed_origins"));
        assert!(json.contains("allowed_methods"));
        assert!(json.contains("allowed_headers"));
        assert!(json.contains("allow_credentials"));
        assert!(json.contains("max_age_secs"));
    }

    #[test]
    fn test_deserialize_default_config() {
        let json = r#"{
            "allowed_origins": [],
            "allowed_methods": ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
            "allowed_headers": ["content-type", "authorization", "x-requested-with", "accept"],
            "allow_credentials": true,
            "max_age_secs": 3600
        }"#;
        
        let config: CorsConfig = serde_json::from_str(json).unwrap();
        assert!(config.allowed_origins.is_empty());
        assert!(config.allow_credentials);
        assert_eq!(config.max_age_secs, 3600);
    }

    #[test]
    fn test_serialize_deserialize_roundtrip() {
        let original = CorsConfig {
            allowed_origins: vec!["http://localhost:3000".to_string()],
            allowed_methods: vec!["GET".to_string(), "POST".to_string()],
            allowed_headers: vec!["content-type".to_string()],
            allow_credentials: false,
            max_age_secs: 7200,
        };
        
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: CorsConfig = serde_json::from_str(&json).unwrap();
        
        assert_eq!(deserialized.allowed_origins, original.allowed_origins);
        assert_eq!(deserialized.allowed_methods, original.allowed_methods);
        assert_eq!(deserialized.allowed_headers, original.allowed_headers);
        assert_eq!(deserialized.allow_credentials, original.allow_credentials);
        assert_eq!(deserialized.max_age_secs, original.max_age_secs);
    }

    #[test]
    fn test_deserialize_with_partial_fields() {
        // Test that missing fields use defaults
        let json = r#"{
            "allowed_origins": ["http://example.com"]
        }"#;
        
        let config: CorsConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.allowed_origins, vec!["http://example.com"]);
        // Other fields should use defaults
        assert!(config.allowed_methods.contains(&"GET".to_string()));
        assert!(config.allow_credentials);
        assert_eq!(config.max_age_secs, 3600);
    }

    // ========== CorsConfig Validation Tests ==========

    #[test]
    fn test_config_with_wildcard_origin() {
        let config = CorsConfig {
            allowed_origins: vec!["*".to_string()],
            ..CorsConfig::default()
        };
        assert_eq!(config.allowed_origins, vec!["*"]);
    }

    #[test]
    fn test_config_with_multiple_origins() {
        let origins = vec![
            "http://localhost:3000".to_string(),
            "http://localhost:3001".to_string(),
            "https://example.com".to_string(),
        ];
        let config = CorsConfig {
            allowed_origins: origins.clone(),
            ..CorsConfig::default()
        };
        assert_eq!(config.allowed_origins.len(), 3);
        assert_eq!(config.allowed_origins, origins);
    }

    #[test]
    fn test_config_with_empty_methods() {
        let config = CorsConfig {
            allowed_methods: vec![],
            ..CorsConfig::default()
        };
        assert!(config.allowed_methods.is_empty());
    }

    #[test]
    fn test_config_with_empty_headers() {
        let config = CorsConfig {
            allowed_headers: vec![],
            ..CorsConfig::default()
        };
        assert!(config.allowed_headers.is_empty());
    }

    #[test]
    fn test_config_with_zero_max_age() {
        let config = CorsConfig {
            max_age_secs: 0,
            ..CorsConfig::default()
        };
        assert_eq!(config.max_age_secs, 0);
    }

    #[test]
    fn test_config_with_large_max_age() {
        let config = CorsConfig {
            max_age_secs: 86400, // 24 hours
            ..CorsConfig::default()
        };
        assert_eq!(config.max_age_secs, 86400);
    }

    // ========== load_cors_config Tests ==========

    #[test]
    fn test_load_config_from_valid_json_file() {
        let json = r#"{
            "allowed_origins": ["http://localhost:3000", "http://localhost:3001"],
            "allowed_methods": ["GET", "POST"],
            "allowed_headers": ["content-type", "authorization"],
            "allow_credentials": true,
            "max_age_secs": 7200
        }"#;
        
        let temp_file = std::env::temp_dir().join("test_cors_config_valid.json");
        std::fs::write(&temp_file, json).unwrap();
        
        let config = load_cors_config(&temp_file).unwrap();
        assert_eq!(config.allowed_origins.len(), 2);
        assert!(config.allowed_origins.contains(&"http://localhost:3000".to_string()));
        assert!(config.allowed_origins.contains(&"http://localhost:3001".to_string()));
        assert_eq!(config.allowed_methods, vec!["GET", "POST"]);
        assert!(config.allow_credentials);
        assert_eq!(config.max_age_secs, 7200);
        
        // Cleanup
        std::fs::remove_file(&temp_file).ok();
    }

    #[test]
    fn test_load_config_from_invalid_json_file() {
        let invalid_json = r#"{ invalid json }"#;
        
        let temp_file = std::env::temp_dir().join("test_cors_config_invalid.json");
        std::fs::write(&temp_file, invalid_json).unwrap();
        
        let result = load_cors_config(&temp_file);
        assert!(result.is_err());
        
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("Failed to parse CORS config JSON"));
        
        // Cleanup
        std::fs::remove_file(&temp_file).ok();
    }

    #[test]
    fn test_load_config_from_nonexistent_file() {
        let result = load_cors_config(std::path::Path::new("/nonexistent/cors_config.json"));
        assert!(result.is_err());
        
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("Failed to read CORS config file"));
    }

    #[test]
    fn test_load_config_from_empty_json_file() {
        let empty_json = r#"{}"#;
        
        let temp_file = std::env::temp_dir().join("test_cors_config_empty.json");
        std::fs::write(&temp_file, empty_json).unwrap();
        
        let config = load_cors_config(&temp_file).unwrap();
        // Should use defaults for all fields
        assert!(config.allowed_origins.is_empty());
        assert!(!config.allowed_methods.is_empty());
        assert!(!config.allowed_headers.is_empty());
        assert!(config.allow_credentials);
        assert_eq!(config.max_age_secs, 3600);
        
        // Cleanup
        std::fs::remove_file(&temp_file).ok();
    }

    #[test]
    fn test_load_config_with_wildcard_origin() {
        let json = r#"{
            "allowed_origins": ["*"],
            "allow_credentials": false
        }"#;
        
        let temp_file = std::env::temp_dir().join("test_cors_config_wildcard.json");
        std::fs::write(&temp_file, json).unwrap();
        
        let config = load_cors_config(&temp_file).unwrap();
        assert_eq!(config.allowed_origins, vec!["*"]);
        assert!(!config.allow_credentials);
        
        // Cleanup
        std::fs::remove_file(&temp_file).ok();
    }

    // ========== load_cors_config_from_env Tests ==========

    #[test]
    fn test_load_config_from_env_with_valid_file() {
        let json = r#"{
            "allowed_origins": ["http://test.com"],
            "max_age_secs": 1800
        }"#;
        
        let temp_file = std::env::temp_dir().join("test_cors_env_config.json");
        std::fs::write(&temp_file, json).unwrap();
        
        // Set environment variable
        unsafe {
            std::env::set_var("CORS_CONFIG_PATH", temp_file.to_str().unwrap());
        }
        
        let config = load_cors_config_from_env();
        assert_eq!(config.allowed_origins, vec!["http://test.com"]);
        assert_eq!(config.max_age_secs, 1800);
        
        // Cleanup
        std::fs::remove_file(&temp_file).ok();
        unsafe {
            std::env::remove_var("CORS_CONFIG_PATH");
        }
    }

    #[test]
    fn test_load_config_from_env_with_nonexistent_file() {
        // Set environment variable to nonexistent file
        unsafe {
            std::env::set_var("CORS_CONFIG_PATH", "/nonexistent/cors_config.json");
        }
        
        // Should fall back to defaults without panicking
        let config = load_cors_config_from_env();
        
        // Should have default values
        assert!(config.allowed_origins.is_empty());
        assert!(config.allow_credentials);
        assert_eq!(config.max_age_secs, 3600);
        
        // Cleanup
        unsafe {
            std::env::remove_var("CORS_CONFIG_PATH");
        }
    }

    #[test]
    fn test_load_config_from_env_without_env_variable() {
        // Ensure CORS_CONFIG_PATH is not set
        unsafe {
            std::env::remove_var("CORS_CONFIG_PATH");
        }
        
        // Should use default path (cors_config.json) and fall back to defaults
        let config = load_cors_config_from_env();
        
        // Should have default values (unless cors_config.json exists in current directory)
        assert!(config.allowed_methods.contains(&"GET".to_string()));
        assert!(config.allow_credentials);
    }

    #[test]
    fn test_load_config_from_env_with_invalid_json_file() {
        let invalid_json = r#"not valid json"#;
        
        let temp_file = std::env::temp_dir().join("test_cors_env_invalid.json");
        std::fs::write(&temp_file, invalid_json).unwrap();
        
        unsafe {
            std::env::set_var("CORS_CONFIG_PATH", temp_file.to_str().unwrap());
        }
        
        // Should fall back to defaults without panicking
        let config = load_cors_config_from_env();
        
        // Should have default values
        assert!(config.allowed_origins.is_empty());
        assert!(config.allow_credentials);
        assert_eq!(config.max_age_secs, 3600);
        
        // Cleanup
        std::fs::remove_file(&temp_file).ok();
        unsafe {
            std::env::remove_var("CORS_CONFIG_PATH");
        }
    }

    // ========== Edge Cases and Boundary Tests ==========

    #[test]
    fn test_config_clone_trait() {
        let config1 = CorsConfig {
            allowed_origins: vec!["http://example.com".to_string()],
            allow_credentials: false,
            max_age_secs: 7200,
            ..CorsConfig::default()
        };
        
        let config2 = config1.clone();
        
        assert_eq!(config1.allowed_origins, config2.allowed_origins);
        assert_eq!(config1.allow_credentials, config2.allow_credentials);
        assert_eq!(config1.max_age_secs, config2.max_age_secs);
    }

    #[test]
    fn test_config_debug_trait() {
        let config = CorsConfig::default();
        let debug_str = format!("{:?}", config);
        
        // Debug output should contain key field names
        assert!(debug_str.contains("CorsConfig"));
        assert!(debug_str.contains("allowed_origins"));
    }

    #[test]
    fn test_config_with_special_characters_in_origins() {
        let origins = vec![
            "http://localhost:3000".to_string(),
            "https://sub.domain.example.com".to_string(),
            "http://127.0.0.1:8080".to_string(),
        ];
        
        let config = CorsConfig {
            allowed_origins: origins.clone(),
            ..CorsConfig::default()
        };
        
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: CorsConfig = serde_json::from_str(&json).unwrap();
        
        assert_eq!(deserialized.allowed_origins, origins);
    }

    #[test]
    fn test_config_serialize_and_deserialize_with_all_fields() {
        let original = CorsConfig {
            allowed_origins: vec![
                "http://localhost:3000".to_string(),
                "https://production.example.com".to_string(),
            ],
            allowed_methods: vec![
                "GET".to_string(),
                "POST".to_string(),
                "PUT".to_string(),
                "DELETE".to_string(),
                "PATCH".to_string(),
                "OPTIONS".to_string(),
            ],
            allowed_headers: vec![
                "content-type".to_string(),
                "authorization".to_string(),
                "x-custom-header".to_string(),
            ],
            allow_credentials: true,
            max_age_secs: 86400,
        };
        
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: CorsConfig = serde_json::from_str(&json).unwrap();
        
        assert_eq!(deserialized.allowed_origins, original.allowed_origins);
        assert_eq!(deserialized.allowed_methods, original.allowed_methods);
        assert_eq!(deserialized.allowed_headers, original.allowed_headers);
        assert_eq!(deserialized.allow_credentials, original.allow_credentials);
        assert_eq!(deserialized.max_age_secs, original.max_age_secs);
    }
}
