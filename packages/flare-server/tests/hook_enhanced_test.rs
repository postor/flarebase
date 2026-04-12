/// Enhanced Plugin Manager tests with detailed validation

use flare_server::plugin_manager::PluginManager;
use flare_protocol::{HookRegister, HookCapabilities, HookResponse};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tokio::time::Duration;

struct EnhancedMockWebSocketManager {
    sent_messages: Arc<Mutex<HashMap<String, Vec<serde_json::Value>>>>,
}

impl EnhancedMockWebSocketManager {
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
async fn test_plugin_initial_state() {
    let pm = Arc::new(PluginManager::new());

    assert_eq!(pm.get_plugin_count("UserCreated"), 0,
        "Initial state should have no plugins registered");
}

#[tokio::test]
async fn test_plugin_registration_and_call() {
    let pm = Arc::new(PluginManager::new());
    let mock_ws = Arc::new(EnhancedMockWebSocketManager::new());

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["UserCreated".to_string(), "DocUpdated".to_string()],
            user_context: json!({ "service": "test-service" }),
        },
    };
    let socket_id = "socket-1".to_string();
    pm.register_plugin(socket_id.clone(), register);

    assert_eq!(pm.get_plugin_count("UserCreated"), 1,
        "Should have 1 plugin for UserCreated");
    assert_eq!(pm.get_plugin_count("DocUpdated"), 1,
        "Should have 1 plugin for DocUpdated");

    let hooks = pm.get_plugins_for_event("UserCreated");
    assert_eq!(hooks, vec![socket_id.clone()]);

    let pm_clone = pm.clone();
    let mock_ws_clone = mock_ws.clone();
    let call_task = tokio::spawn(async move {
        pm_clone.call_plugin(
            "UserCreated".to_string(),
            "session-1".to_string(),
            json!({ "userId": "123", "name": "Alice" }),
            move |plugin_sid, req_data| {
                mock_ws_clone.emit_to_socket(plugin_sid, req_data);
            }
        ).await
    });

    tokio::time::sleep(Duration::from_millis(100)).await;

    let messages = mock_ws.get_messages("socket-1");
    assert_eq!(messages.len(), 1, "Should have sent 1 message");
    assert_eq!(messages[0]["event_name"], "UserCreated");
    assert_eq!(messages[0]["session_id"], "session-1");
    assert_eq!(messages[0]["params"]["userId"], "123");
    assert_eq!(messages[0]["params"]["name"], "Alice");
    assert!(messages[0]["request_id"].is_string(), "Should have request_id");

    let request_id = messages[0]["request_id"].as_str().unwrap().to_string();
    let response = HookResponse {
        request_id,
        status: "success".to_string(),
        data: Some(json!({ "status": "processed" })),
        error: None,
    };
    pm.handle_response(response);

    let result = tokio::time::timeout(Duration::from_secs(5), call_task).await.unwrap().unwrap();
    assert!(result.is_ok(), "Should return Ok result");
    assert_eq!(result.unwrap()["status"], "processed");
}

#[tokio::test]
async fn test_concurrent_plugin_calls_detailed() {
    let pm = Arc::new(PluginManager::new());
    let mock_ws = Arc::new(EnhancedMockWebSocketManager::new());

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["Concurrent".to_string()],
            user_context: json!({}),
        },
    };
    pm.register_plugin("concurrent-socket".to_string(), register);

    let mut tasks = Vec::new();
    let expected_count = 10;

    for i in 0..expected_count {
        let pm_clone = pm.clone();
        let mock_ws_clone = mock_ws.clone();
        let task = tokio::spawn(async move {
            pm_clone.call_plugin(
                "Concurrent".to_string(),
                format!("session-{}", i),
                json!({ "index": i }),
                move |plugin_sid, req_data| {
                    mock_ws_clone.emit_to_socket(plugin_sid, req_data);
                }
            ).await
        });
        tasks.push(task);
    }

    tokio::time::sleep(Duration::from_millis(300)).await;

    let messages = mock_ws.get_messages("concurrent-socket");
    assert_eq!(messages.len(), expected_count,
        "Should have sent {} messages", expected_count);

    let mut request_ids = Vec::new();
    for (i, msg) in messages.iter().enumerate() {
        assert_eq!(msg["params"]["index"], i as i64,
            "Message {} should have correct index", i);
        request_ids.push(msg["request_id"].as_str().unwrap().to_string());
    }

    for request_id in request_ids {
        let response = HookResponse {
            request_id,
            status: "success".to_string(),
            data: Some(json!({ "ok": true })),
            error: None,
        };
        pm.handle_response(response);
    }

    for task in tasks {
        let result = tokio::time::timeout(Duration::from_secs(5), task).await.unwrap().unwrap();
        assert!(result.is_ok(), "All concurrent calls should succeed");
    }
}

#[tokio::test]
async fn test_plugin_error_response_detailed() {
    let pm = Arc::new(PluginManager::new());
    let mock_ws = Arc::new(EnhancedMockWebSocketManager::new());

    let register = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["ErrorTest".to_string()],
            user_context: json!({}),
        },
    };
    let socket_id = "error-socket".to_string();
    pm.register_plugin(socket_id.clone(), register);

    let pm_clone = pm.clone();
    let mock_ws_clone = mock_ws.clone();
    let call_task = tokio::spawn(async move {
        pm_clone.call_plugin(
            "ErrorTest".to_string(),
            "session-1".to_string(),
            json!({ "should_fail": true }),
            move |plugin_sid, req_data| {
                mock_ws_clone.emit_to_socket(plugin_sid, req_data);
            }
        ).await
    });

    tokio::time::sleep(Duration::from_millis(100)).await;

    let messages = mock_ws.get_messages("error-socket");
    assert_eq!(messages.len(), 1);

    let request_id = messages[0]["request_id"].as_str().unwrap().to_string();
    let error_response = HookResponse {
        request_id,
        status: "error".to_string(),
        data: None,
        error: Some(json!("Detailed error message")),
    };
    pm.handle_response(error_response);

    let result = tokio::time::timeout(Duration::from_secs(5), call_task).await.unwrap().unwrap();
    assert!(result.is_ok(), "Should return Ok even for plugin errors");
    assert_eq!(result.unwrap()["error"], "Detailed error message");
}

#[tokio::test]
async fn test_multiple_plugins_per_event() {
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
}

#[tokio::test]
async fn test_plugin_removal_detailed() {
    let pm = PluginManager::new();

    let register1 = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["Event1".to_string(), "Event2".to_string()],
            user_context: json!({}),
        },
    };
    let register2 = HookRegister {
        token: "test-token".to_string(),
        capabilities: HookCapabilities {
            events: vec!["Event1".to_string(), "Event2".to_string(), "Event3".to_string()],
            user_context: json!({}),
        },
    };
    pm.register_plugin("socket-1".to_string(), register1);
    pm.register_plugin("socket-2".to_string(), register2);

    assert_eq!(pm.get_plugin_count("Event1"), 2);
    assert_eq!(pm.get_plugin_count("Event2"), 2);
    assert_eq!(pm.get_plugin_count("Event3"), 1);

    pm.remove_plugin("socket-1");
    assert_eq!(pm.get_plugin_count("Event1"), 1);
    assert_eq!(pm.get_plugin_count("Event2"), 1);
    assert_eq!(pm.get_plugin_count("Event3"), 1); // unchanged

    pm.remove_plugin("socket-2");
    assert_eq!(pm.get_plugin_count("Event1"), 0);
    assert_eq!(pm.get_plugin_count("Event2"), 0);
    assert_eq!(pm.get_plugin_count("Event3"), 0);
}

#[tokio::test]
async fn test_plugin_call_no_plugin_registered() {
    let pm = PluginManager::new();

    let result = pm.call_plugin(
        "NonExistent".to_string(),
        "session-1".to_string(),
        json!({}),
        |_sid, _data| {}
    ).await;

    assert!(result.is_err(), "Should return error when no plugin registered");
    assert!(result.unwrap_err().to_string().contains("No plugin registered"));
}
