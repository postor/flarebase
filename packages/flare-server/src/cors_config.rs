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

    #[test]
    fn test_default_config() {
        let config = CorsConfig::default();
        assert!(config.allowed_origins.is_empty());
        assert!(config.allow_credentials);
        assert_eq!(config.max_age_secs, 3600);
    }
}
