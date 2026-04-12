/// Plugin Manager unit tests (formerly HookManager tests)
/// Uses PluginManager with the plugin API

use flare_server::plugin_manager::PluginManager;
use flare_protocol::{HookRegister, HookCapabilities, HookResponse};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tokio::time::{timeout, Duration};

/// 模拟的 WebSocket 连接管理器
struct MockWebSocketManager {
    sent_messages: Arc<Mutex<HashMap<String, Vec<serde_json::Value>>>>,
}

impl MockWebSocketManager {
    fn new() -> Self {
        Self {
            sent_messages: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn emit_to_socket(&self, socket_id: String, message: serde_json::Value) {
        let mut messages = self.sent_messages.lock().unwrap();
        messages.entry(socket_id).or_default().push(message);
    }

    fn get_messages(&self, socket_id: &str) -> Vec<serde_json::Value> {
        let messages = self.sent_messages.lock().unwrap();
        messages.get(socket_id).cloned().unwrap_or_default()
    }
}

#[tokio::test]
async fn test_plugin_registration() {
    let pm = PluginManager::new();

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["UserCreated".to_string()],
            user_context: json!({ "service": "test-service" }),
        },
    };

    pm.register_plugin("socket-1".to_string(), register);

    assert_eq!(pm.get_plugin_count("UserCreated"), 1);
    let hooks = pm.get_plugins_for_event("UserCreated");
    assert_eq!(hooks[0], "socket-1");
}

#[tokio::test]
async fn test_plugin_removal() {
    let pm = PluginManager::new();

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["Event1".to_string(), "Event2".to_string()],
            user_context: json!({}),
        },
    };
    pm.register_plugin("socket-1".to_string(), register);

    assert_eq!(pm.get_plugin_count("Event1"), 1);
    assert_eq!(pm.get_plugin_count("Event2"), 1);

    pm.remove_plugin("socket-1");

    assert_eq!(pm.get_plugin_count("Event1"), 0);
    assert_eq!(pm.get_plugin_count("Event2"), 0);
}

#[tokio::test]
async fn test_plugin_call_with_response() {
    let pm = Arc::new(PluginManager::new());
    let mock_ws = Arc::new(MockWebSocketManager::new());

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["UserCreated".to_string()],
            user_context: json!({}),
        },
    };
    let socket_id = "socket-1".to_string();
    pm.register_plugin(socket_id.clone(), register);

    let pm_clone = pm.clone();
    let ws_clone = mock_ws.clone();
    let call_task = tokio::spawn(async move {
        pm_clone.call_plugin(
            "UserCreated".to_string(),
            "session-1".to_string(),
            json!({ "userId": "123" }),
            move |plugin_sid, req_data| {
                ws_clone.emit_to_socket(plugin_sid, req_data);
            }
        ).await
    });

    // Wait for emit_fn to fire
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Verify message was sent
    let messages = mock_ws.get_messages("socket-1");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["event_name"], "UserCreated");
    assert_eq!(messages[0]["params"]["userId"], "123");

    // Send response to resolve the oneshot
    let request_id = messages[0]["request_id"].as_str().unwrap().to_string();
    pm.handle_response(HookResponse {
        request_id,
        status: "success".to_string(),
        data: Some(json!({ "status": "processed" })),
        error: None,
    });

    // Verify call_plugin returns the result
    let result = timeout(Duration::from_secs(5), call_task).await.unwrap().unwrap();
    assert!(result.is_ok());
    assert_eq!(result.unwrap()["status"], "processed");
}

#[tokio::test]
async fn test_plugin_call_no_hook() {
    let pm = PluginManager::new();

    let result = pm.call_plugin(
        "NonExistent".to_string(),
        "session-1".to_string(),
        json!({}),
        |_sid, _data| {}
    ).await;

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("No plugin registered"));
}

#[tokio::test]
async fn test_plugin_timeout() {
    let pm = Arc::new(PluginManager::new());

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["Silent".to_string()],
            user_context: json!({}),
        },
    };
    pm.register_plugin("silent-socket".to_string(), register);

    // call_plugin with no response -> timeout
    let result = pm.call_plugin(
        "Silent".to_string(),
        "session-1".to_string(),
        json!({}),
        |_sid, _data| { /* intentionally no response */ }
    ).await;

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("timed out"));
}

#[tokio::test]
async fn test_plugin_error_response() {
    let pm = Arc::new(PluginManager::new());
    let mock_ws = Arc::new(MockWebSocketManager::new());

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["ErrorEvent".to_string()],
            user_context: json!({}),
        },
    };
    let socket_id = "error-socket".to_string();
    pm.register_plugin(socket_id.clone(), register);

    let pm_clone = pm.clone();
    let ws_clone = mock_ws.clone();
    let call_task = tokio::spawn(async move {
        pm_clone.call_plugin(
            "ErrorEvent".to_string(),
            "session-1".to_string(),
            json!({}),
            move |plugin_sid, req_data| {
                ws_clone.emit_to_socket(plugin_sid, req_data);
            }
        ).await
    });

    tokio::time::sleep(Duration::from_millis(100)).await;

    let messages = mock_ws.get_messages("error-socket");
    assert_eq!(messages.len(), 1);

    let request_id = messages[0]["request_id"].as_str().unwrap().to_string();
    pm.handle_response(HookResponse {
        request_id,
        status: "error".to_string(),
        data: None,
        error: Some(json!("Processing failed")),
    });

    let result = timeout(Duration::from_secs(5), call_task).await.unwrap().unwrap();
    assert!(result.is_ok());
    assert_eq!(result.unwrap()["error"], "Processing failed");
}

#[tokio::test]
async fn test_multiple_plugins_same_event() {
    let pm = PluginManager::new();

    for i in 1..=3 {
        let register = HookRegister {
            token: "test-token".to_string(),
            capabilities: HookCapabilities {
                events: vec!["SharedEvent".to_string()],
                user_context: json!({}),
            },
        };
        pm.register_plugin(format!("socket-{}", i), register);
    }

    assert_eq!(pm.get_plugin_count("SharedEvent"), 3);

    pm.remove_plugin("socket-2");

    assert_eq!(pm.get_plugin_count("SharedEvent"), 2);
    let hooks = pm.get_plugins_for_event("SharedEvent");
    assert!(!hooks.contains(&"socket-2".to_string()));
}

#[tokio::test]
async fn test_multi_event_registration() {
    let pm = PluginManager::new();

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["Event1".to_string(), "Event2".to_string(), "Event3".to_string()],
            user_context: json!({}),
        },
    };
    pm.register_plugin("multi-hook".to_string(), register);

    assert_eq!(pm.get_plugin_count("Event1"), 1);
    assert_eq!(pm.get_plugin_count("Event2"), 1);
    assert_eq!(pm.get_plugin_count("Event3"), 1);
}

#[tokio::test]
async fn test_concurrent_plugin_calls() {
    let pm = Arc::new(PluginManager::new());
    let mock_ws = Arc::new(MockWebSocketManager::new());

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["Concurrent".to_string()],
            user_context: json!({}),
        },
    };
    pm.register_plugin("concurrent-socket".to_string(), register);

    let mut tasks = Vec::new();
    for i in 0..5 {
        let pm_clone = pm.clone();
        let ws_clone = mock_ws.clone();
        let task = tokio::spawn(async move {
            pm_clone.call_plugin(
                "Concurrent".to_string(),
                format!("session-{}", i),
                json!({ "index": i }),
                move |plugin_sid, req_data| {
                    ws_clone.emit_to_socket(plugin_sid, req_data);
                }
            ).await
        });
        tasks.push(task);
    }

    tokio::time::sleep(Duration::from_millis(200)).await;

    let messages = mock_ws.get_messages("concurrent-socket");
    assert_eq!(messages.len(), 5);

    // Send responses for all 5
    for msg in &messages {
        let request_id = msg["request_id"].as_str().unwrap().to_string();
        pm.handle_response(HookResponse {
            request_id,
            status: "success".to_string(),
            data: Some(json!({ "processed": true })),
            error: None,
        });
    }

    // All tasks should complete
    for task in tasks {
        let result = timeout(Duration::from_secs(5), task).await.unwrap().unwrap();
        assert!(result.is_ok());
    }
}
